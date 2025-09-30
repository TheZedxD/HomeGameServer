"use strict";

const { getSharedRedisPool } = require('../../lib/redisPool');

class ProfileCache {
    constructor(options = {}) {
        this.ttlMs = options.ttlMs || 15000;
        this.maxEntries = options.maxEntries || 1000;
        this.prefix = options.prefix || 'homegame:profile:';
        this.logger = options.logger || console;
        this.redisPool = null;
        this.redisMetrics = { enabled: false, circuitState: 'offline' };
        this.redisState = {
            status: 'disabled',
            lastError: null,
            lastChangedAt: this._now(),
            metrics: this.redisMetrics,
        };
        this.metrics = {
            hits: 0,
            misses: 0,
            redisErrors: 0,
        };
        this.memoryCache = new Map();
        this.pendingFetches = new Map();

        if (options.redisUrl) {
            this.redisPool = getSharedRedisPool({
                redisUrl: options.redisUrl,
                logger: this.logger,
                maxConnections: 10,
                circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
                circuitBreakerResetMs: options.circuitBreakerResetMs || 30000,
            });
            if (this.redisPool?.getHealthMetrics) {
                this.redisMetrics = this.redisPool.getHealthMetrics();
            }
            this.redisState = {
                status: this.redisPool?.isAvailable?.() ? 'initializing' : 'unavailable',
                lastError: null,
                lastChangedAt: this._now(),
                metrics: this.redisMetrics,
            };
            if (this.redisPool?.on) {
                this._redisMetricsListener = (metrics) => {
                    this.redisMetrics = metrics;
                    if (this.logger?.debug) {
                        this.logger.debug('Profile cache Redis metrics', metrics);
                    }
                };
                this.redisPool.on('metrics', this._redisMetricsListener);
            }
            this._updateRedisState(this.redisState.status);
        } else {
            this.logger.warn?.('Redis URL not provided. Profile cache operating in memory-only mode.');
            this._updateRedisState('disabled');
        }
    }

    _now() {
        return Date.now();
    }

    _purgeExpired() {
        const now = this._now();
        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.expiresAt <= now) {
                this.memoryCache.delete(key);
            }
        }
    }

    _evictIfNeeded() {
        if (this.memoryCache.size <= this.maxEntries) {
            return;
        }
        const overshoot = this.memoryCache.size - this.maxEntries;
        const keys = Array.from(this.memoryCache.keys());
        for (let i = 0; i < overshoot; i += 1) {
            const key = keys[i];
            this.memoryCache.delete(key);
        }
    }

    _setMemory(key, value, ttlMs) {
        const expiresAt = this._now() + (ttlMs || this.ttlMs);
        this.memoryCache.set(key, { value, expiresAt });
        this._evictIfNeeded();
    }

    getSync(key) {
        if (!key) {
            return null;
        }
        this._purgeExpired();
        const entry = this.memoryCache.get(key);
        if (entry) {
            if (entry.expiresAt > this._now()) {
                this.metrics.hits += 1;
                if (this.redisPool) {
                    this._updateRedisState(this.redisPool.isAvailable?.() ? 'healthy' : this.redisState.status);
                }
                return entry.value;
            }
            this.memoryCache.delete(key);
        }
        this.metrics.misses += 1;
        if (this._canUseRedis()) {
            this._hydrateFromRedis(key);
        }
        return null;
    }

    async get(key) {
        const cached = this.getSync(key);
        if (cached) {
            return cached;
        }
        if (!this._canUseRedis()) {
            return null;
        }

        try {
            const raw = await this.redisPool.run((client) => client.get(this.prefix + key));

            // Update state AFTER successful operation
            if (this.redisState.status !== 'healthy') {
                this._updateRedisState('healthy');
            }

            if (!raw) return null;

            const payload = JSON.parse(raw);
            this._setMemory(key, payload, this.ttlMs);
            return payload;
        } catch (error) {
            this.metrics.redisErrors += 1;
            const status = error?.message === 'REDIS_CIRCUIT_OPEN' ? 'unavailable' : 'degraded';
            this._updateRedisState(status, error);
            return null;
        }
    }

    async set(key, value, options = {}) {
        if (!key) {
            return;
        }
        const ttlMs = options.ttlMs || this.ttlMs;
        this._setMemory(key, value, ttlMs);

        if (!this._canUseRedis()) {
            this._updateRedisState('unavailable');
            return;
        }
        try {
            await this.redisPool.run((client) => client.set(this.prefix + key, JSON.stringify(value), 'PX', ttlMs));
            this._updateRedisState('healthy');
        } catch (error) {
            this.metrics.redisErrors += 1;
            const status = error?.message === 'REDIS_CIRCUIT_OPEN' ? 'unavailable' : 'degraded';
            this._updateRedisState(status, error);
            this.logger?.warn?.('Profile cache set failed:', error.message);
        }
    }

    async invalidate(key) {
        if (!key) {
            return;
        }
        this.memoryCache.delete(key);
        if (!this._canUseRedis()) {
            this._updateRedisState('unavailable');
            return;
        }
        try {
            await this.redisPool.run((client) => client.del(this.prefix + key));
            this._updateRedisState('healthy');
        } catch (error) {
            this.metrics.redisErrors += 1;
            const status = error?.message === 'REDIS_CIRCUIT_OPEN' ? 'unavailable' : 'degraded';
            this._updateRedisState(status, error);
            this.logger?.warn?.('Profile cache invalidate failed:', error.message);
        }
    }

    async shutdown() {
        if (this.redisPool && this._redisMetricsListener && this.redisPool.off) {
            this.redisPool.off('metrics', this._redisMetricsListener);
        }
        if (this.redisPool?.releaseReference) {
            await this.redisPool.releaseReference();
        }
    }

    stats() {
        return {
            ...this.metrics,
            size: this.memoryCache.size,
            ttlMs: this.ttlMs,
            redis: this.redisState,
        };
    }

    _hydrateFromRedis(key) {
        if (!this._canUseRedis()) {
            this._updateRedisState('unavailable');
            return;
        }
        if (this.pendingFetches.has(key)) {
            return;
        }
        const task = this.redisPool
            .run((client) => client.get(this.prefix + key))
            .then((raw) => {
                if (!raw) {
                    this._updateRedisState('healthy');
                    return;
                }
                try {
                    const payload = JSON.parse(raw);
                    this._setMemory(key, payload, this.ttlMs);
                    this._updateRedisState('healthy');
                } catch (error) {
                    this.metrics.redisErrors += 1;
                    this._updateRedisState('degraded', error);
                    this.logger?.warn?.('Profile cache hydration parse failed:', error.message);
                }
            })
            .catch((error) => {
                this.metrics.redisErrors += 1;
                const status = error?.message === 'REDIS_CIRCUIT_OPEN' ? 'unavailable' : 'degraded';
                this._updateRedisState(status, error);
                this.logger?.debug?.('Profile cache hydration failed:', error.message);
            })
            .finally(() => {
                this.pendingFetches.delete(key);
            });
        this.pendingFetches.set(key, task);
    }

    _canUseRedis() {
        return Boolean(this.redisPool && this.redisPool.enabled !== false);
    }

    _updateRedisState(status, error) {
        const metrics = this.redisPool?.getHealthMetrics?.() || this.redisMetrics;
        const previousState = this.redisState?.status;
        const hasChanged = previousState !== status;
        const errorMessage = error ? error.message || String(error) : null;

        // Always update metrics first
        this.redisMetrics = metrics;

        const newState = {
            status,
            lastError: errorMessage || this.redisState?.lastError || null,
            lastChangedAt: hasChanged ? this._now() : this.redisState?.lastChangedAt || this._now(),
            metrics,
        };

        // Use atomic update
        this.redisState = newState;

        if (hasChanged || error) {
            // Debounce logging
            clearTimeout(this._stateLogTimeout);
            this._stateLogTimeout = setTimeout(() => {
                this.logger?.info?.('Profile cache Redis health update', newState);
            }, 100);
        }
    }
}

function createProfileCache(options) {
    return new ProfileCache(options);
}

module.exports = {
    ProfileCache,
    createProfileCache,
};
