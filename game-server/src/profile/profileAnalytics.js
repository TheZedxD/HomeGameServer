"use strict";

const { getSharedRedisPool } = require('../../lib/redisPool');

class ProfileAnalytics {
    constructor(options = {}) {
        this.redisKey = options.redisKey || 'homegame:analytics:profiles';
        this.logger = options.logger || console;
        this.buffer = new Map();
        this.flushIntervalMs = options.flushIntervalMs || 10000;
        this.redisPool = null;
        this.redisMetrics = { enabled: false, circuitState: 'offline' };
        this.redisState = {
            status: 'disabled',
            lastError: null,
            lastChangedAt: Date.now(),
            metrics: this.redisMetrics,
        };

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
                lastChangedAt: Date.now(),
                metrics: this.redisMetrics,
            };
            if (this.redisPool?.on) {
                this._redisMetricsListener = (metrics) => {
                    this.redisMetrics = metrics;
                    if (this.logger?.debug) {
                        this.logger.debug('Profile analytics Redis metrics', metrics);
                    }
                };
                this.redisPool.on('metrics', this._redisMetricsListener);
            }
            this._updateRedisState(this.redisState.status);
        } else {
            this.logger.warn?.('Profile analytics Redis URL not provided. Operating in buffered mode.');
            this._updateRedisState('disabled');
        }

        this._startFlushTimer();
    }

    record(event, metadata = {}) {
        const key = `profile.${event}`;
        this.buffer.set(key, (this.buffer.get(key) || 0) + 1);
        if (this.logger?.debug) {
            this.logger.debug('Profile analytics event recorded:', key, metadata);
        }
    }

    async flush() {
        if (this.buffer.size === 0) {
            return;
        }
        const payload = Array.from(this.buffer.entries());
        this.buffer.clear();
        if (!this._canUseRedis()) {
            this._updateRedisState('unavailable');
            this.logger?.info?.('Profile analytics (no Redis):', payload);
            return;
        }
        try {
            await this.redisPool.run((client) => {
                const pipeline = client.pipeline();
                for (const [key, count] of payload) {
                    pipeline.hincrby(this.redisKey, key, count);
                }
                return pipeline.exec();
            });
            this._updateRedisState('healthy');
        } catch (error) {
            const status = error?.message === 'REDIS_CIRCUIT_OPEN' ? 'unavailable' : 'degraded';
            this._updateRedisState(status, error);
            this.logger?.warn?.('Failed to flush profile analytics to Redis:', error.message);
        }
    }

    async shutdown() {
        clearInterval(this._timer);
        await this.flush();
        if (this.redisPool && this._redisMetricsListener && this.redisPool.off) {
            this.redisPool.off('metrics', this._redisMetricsListener);
        }
        if (this.redisPool?.releaseReference) {
            await this.redisPool.releaseReference();
        }
    }

    _startFlushTimer() {
        this._timer = setInterval(() => {
            this.flush().catch((error) => {
                if (this.logger?.warn) {
                    this.logger.warn('Profile analytics flush failed:', error.message);
                }
            });
        }, this.flushIntervalMs);
        if (this._timer.unref) {
            this._timer.unref();
        }
    }

    _canUseRedis() {
        return Boolean(this.redisPool && this.redisPool.enabled !== false);
    }

    _updateRedisState(status, error) {
        const metrics = this.redisPool?.getHealthMetrics?.() || this.redisMetrics;
        const previousState = this.redisState?.status;
        const hasChanged = previousState !== status;
        const errorMessage = error ? error.message || String(error) : this.redisState?.lastError || null;
        this.redisMetrics = metrics;
        this.redisState = {
            status,
            lastError: errorMessage,
            lastChangedAt: hasChanged ? Date.now() : this.redisState?.lastChangedAt || Date.now(),
            metrics,
        };
        if (hasChanged || error) {
            this.logger?.info?.('Profile analytics Redis health update', {
                status,
                error: errorMessage,
                metrics,
            });
        }
    }
}

function createProfileAnalytics(options) {
    return new ProfileAnalytics(options);
}

module.exports = {
    ProfileAnalytics,
    createProfileAnalytics,
};
