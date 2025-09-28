"use strict";

const { safeRequire } = require('../../lib/safeRequire');
const RedisLib = safeRequire('ioredis');

class ProfileCache {
    constructor(options = {}) {
        this.ttlMs = options.ttlMs || 15000;
        this.maxEntries = options.maxEntries || 1000;
        this.prefix = options.prefix || 'homegame:profile:';
        this.logger = options.logger || console;
        this.metrics = {
            hits: 0,
            misses: 0,
            redisErrors: 0,
        };
        this.memoryCache = new Map();
        this.pendingFetches = new Map();
        this.redis = null;

        if (options.redisUrl && RedisLib) {
            this.redis = new RedisLib(options.redisUrl, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                enableReadyCheck: true,
            });

            this.redis.on('error', (err) => {
                this.metrics.redisErrors += 1;
                if (this.logger?.warn) {
                    this.logger.warn('Profile cache Redis error:', err.message);
                }
            });

            this.redis.connect().catch((error) => {
                this.metrics.redisErrors += 1;
                if (this.logger?.error) {
                    this.logger.error('Unable to connect to Redis profile cache:', error);
                }
            });
        } else if (options.redisUrl && !RedisLib) {
            this.logger.warn?.('Redis URL provided but ioredis is not installed. Falling back to in-memory cache.');
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
                return entry.value;
            }
            this.memoryCache.delete(key);
        }
        this.metrics.misses += 1;
        if (this.redis) {
            this._hydrateFromRedis(key);
        }
        return null;
    }

    async get(key) {
        const cached = this.getSync(key);
        if (cached) {
            return cached;
        }
        if (!this.redis) {
            return null;
        }
        try {
            const raw = await this.redis.get(this.prefix + key);
            if (!raw) {
                return null;
            }
            const payload = JSON.parse(raw);
            this._setMemory(key, payload, this.ttlMs);
            return payload;
        } catch (error) {
            this.metrics.redisErrors += 1;
            if (this.logger?.warn) {
                this.logger.warn('Profile cache get failed:', error.message);
            }
            return null;
        }
    }

    async set(key, value, options = {}) {
        if (!key) {
            return;
        }
        const ttlMs = options.ttlMs || this.ttlMs;
        this._setMemory(key, value, ttlMs);

        if (!this.redis) {
            return;
        }
        try {
            await this.redis.set(this.prefix + key, JSON.stringify(value), 'PX', ttlMs);
        } catch (error) {
            this.metrics.redisErrors += 1;
            if (this.logger?.warn) {
                this.logger.warn('Profile cache set failed:', error.message);
            }
        }
    }

    async invalidate(key) {
        if (!key) {
            return;
        }
        this.memoryCache.delete(key);
        if (this.redis) {
            try {
                await this.redis.del(this.prefix + key);
            } catch (error) {
                this.metrics.redisErrors += 1;
                if (this.logger?.warn) {
                    this.logger.warn('Profile cache invalidate failed:', error.message);
                }
            }
        }
    }

    async shutdown() {
        if (this.redis) {
            try {
                await this.redis.quit();
            } catch (error) {
                if (this.logger?.warn) {
                    this.logger.warn('Profile cache shutdown failed:', error.message);
                }
            }
        }
    }

    stats() {
        return {
            ...this.metrics,
            size: this.memoryCache.size,
            ttlMs: this.ttlMs,
        };
    }

    _hydrateFromRedis(key) {
        if (!this.redis) {
            return;
        }
        if (this.pendingFetches.has(key)) {
            return;
        }
        const task = this.redis
            .get(this.prefix + key)
            .then((raw) => {
                if (!raw) {
                    return;
                }
                const payload = JSON.parse(raw);
                this._setMemory(key, payload, this.ttlMs);
            })
            .catch((error) => {
                this.metrics.redisErrors += 1;
                if (this.logger?.debug) {
                    this.logger.debug('Profile cache hydration failed:', error.message);
                }
            })
            .finally(() => {
                this.pendingFetches.delete(key);
            });
        this.pendingFetches.set(key, task);
    }
}

function createProfileCache(options) {
    return new ProfileCache(options);
}

module.exports = {
    ProfileCache,
    createProfileCache,
};
