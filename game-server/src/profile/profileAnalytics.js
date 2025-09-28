"use strict";

const { safeRequire } = require('../../lib/safeRequire');
const RedisLib = safeRequire('ioredis');

class ProfileAnalytics {
    constructor(options = {}) {
        this.redisKey = options.redisKey || 'homegame:analytics:profiles';
        this.logger = options.logger || console;
        this.buffer = new Map();
        this.flushIntervalMs = options.flushIntervalMs || 10000;
        this.redis = null;

        if (options.redisUrl && RedisLib) {
            this.redis = new RedisLib(options.redisUrl, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                enableReadyCheck: true,
            });
            this.redis.on('error', (err) => {
                if (this.logger?.warn) {
                    this.logger.warn('Profile analytics Redis error:', err.message);
                }
            });
            this.redis.connect().catch((error) => {
                if (this.logger?.error) {
                    this.logger.error('Failed to connect analytics Redis client:', error);
                }
            });
        } else if (options.redisUrl && !RedisLib) {
            this.logger.warn?.('Redis analytics disabled: ioredis not installed.');
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
        if (!this.redis) {
            if (this.logger?.info) {
                this.logger.info('Profile analytics (no Redis):', payload);
            }
            return;
        }
        try {
            const pipeline = this.redis.pipeline();
            for (const [key, count] of payload) {
                pipeline.hincrby(this.redisKey, key, count);
            }
            await pipeline.exec();
        } catch (error) {
            if (this.logger?.warn) {
                this.logger.warn('Failed to flush profile analytics to Redis:', error.message);
            }
        }
    }

    async shutdown() {
        clearInterval(this._timer);
        await this.flush();
        if (this.redis) {
            try {
                await this.redis.quit();
            } catch (error) {
                if (this.logger?.warn) {
                    this.logger.warn('Failed to shutdown analytics Redis client:', error.message);
                }
            }
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
}

function createProfileAnalytics(options) {
    return new ProfileAnalytics(options);
}

module.exports = {
    ProfileAnalytics,
    createProfileAnalytics,
};
