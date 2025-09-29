"use strict";

const { EventEmitter } = require("events");
const { safeRequire } = require("./safeRequire");

const RedisLib = safeRequire("ioredis");

const poolRegistry = new Map();

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

class RedisPool extends EventEmitter {
    constructor(options) {
        super();
        this.redisUrl = options.redisUrl;
        this.logger = options.logger || console;
        this.maxConnections = Math.min(options.maxConnections || 10, 10);
        this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
        this.backoffBaseMs = options.backoffBaseMs || 100;
        this.maxBackoffMs = options.maxBackoffMs || 5000;
        this.circuitBreakerThreshold = options.circuitBreakerThreshold || 5;
        this.circuitBreakerResetMs = options.circuitBreakerResetMs || 30000;
        this.connections = [];
        this.clientMap = new Map();
        this.waitQueue = [];
        this.circuitState = "closed";
        this.circuitOpenedAt = 0;
        this.failureCount = 0;
        this.halfOpenTrial = false;
        this.enabled = true;
        this.refCount = 0;
        this.metrics = {
            acquired: 0,
            released: 0,
            failures: 0,
            reconnectionAttempts: 0,
            totalConnections: 0,
            activeConnections: 0,
            queueSize: 0,
            lastError: null,
            lastFailureAt: null,
            lastSuccessAt: null,
            circuitState: this.circuitState,
        };

        this.logger.info?.("Redis pool initialised", {
            redisUrl: this._redactUrl(this.redisUrl),
            maxConnections: this.maxConnections,
        });
    }

    register() {
        this.refCount += 1;
        return this;
    }

    async releaseReference() {
        if (this.refCount > 0) {
            this.refCount -= 1;
        }
        if (this.refCount === 0) {
            await this.shutdown();
            if (poolRegistry.get(this.redisUrl) === this) {
                poolRegistry.delete(this.redisUrl);
            }
        }
    }

    isAvailable() {
        if (!this.enabled) {
            return false;
        }
        if (this.circuitState === "open") {
            if (this._shouldHalfOpen()) {
                this._transitionToHalfOpen();
                return true;
            }
            return false;
        }
        return this.connections.some((conn) => conn.ready && !conn.destroyed);
    }

    async acquire() {
        if (!this.enabled) {
            throw new Error("REDIS_DISABLED");
        }
        if (this.circuitState === "open") {
            if (!this._shouldHalfOpen()) {
                throw new Error("REDIS_CIRCUIT_OPEN");
            }
            this._transitionToHalfOpen();
        }

        const available = this.connections.find((conn) => conn.ready && !conn.busy && !conn.destroyed);
        if (available) {
            available.busy = true;
            available.lastUsed = Date.now();
            this.metrics.acquired += 1;
            this.metrics.activeConnections += 1;
            this._emitMetrics();
            return available.client;
        }

        if (this.connections.length < this.maxConnections) {
            const connection = await this._createConnection();
            connection.busy = true;
            connection.lastUsed = Date.now();
            this.connections.push(connection);
            this.metrics.acquired += 1;
            this.metrics.activeConnections += 1;
            this.metrics.totalConnections = this.connections.length;
            this._emitMetrics();
            return connection.client;
        }

        return new Promise((resolve, reject) => {
            this.waitQueue.push({ resolve, reject });
            this.metrics.queueSize = this.waitQueue.length;
            this._emitMetrics();
        });
    }

    release(client) {
        if (!client) {
            return;
        }
        const connection = this.clientMap.get(client);
        if (!connection) {
            return;
        }
        if (connection.busy) {
            connection.busy = false;
            this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);
            this.metrics.released += 1;
        }
        this._serveQueue();
        this._emitMetrics();
    }

    async run(callback) {
        const client = await this.acquire();
        try {
            const result = await callback(client);
            this._recordSuccess();
            return result;
        } catch (error) {
            this._recordFailure(error);
            throw error;
        } finally {
            this.release(client);
        }
    }

    async shutdown() {
        if (!this.enabled) {
            return;
        }
        this.enabled = false;
        while (this.waitQueue.length > 0) {
            const item = this.waitQueue.shift();
            item.reject?.(new Error("REDIS_POOL_SHUTDOWN"));
        }
        await Promise.allSettled(
            this.connections.map(async (connection) => {
                try {
                    connection.destroyed = true;
                    if (connection.client.status !== "end") {
                        await connection.client.quit();
                    }
                } catch (error) {
                    this.logger.warn?.("Failed to quit Redis client", error);
                }
            })
        );
        this.connections = [];
        this.clientMap.clear();
        this.metrics = {
            ...this.metrics,
            activeConnections: 0,
            totalConnections: 0,
            queueSize: 0,
            circuitState: "closed",
        };
        this.circuitState = "closed";
        this.halfOpenTrial = false;
        this._emitMetrics();
    }

    getHealthMetrics() {
        return {
            ...this.metrics,
            enabled: this.enabled,
            circuitState: this.circuitState,
        };
    }

    _emitMetrics() {
        this.emit("metrics", this.getHealthMetrics());
    }

    async _createConnection() {
        const client = new RedisLib(this.redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
        });
        const connection = {
            client,
            busy: false,
            ready: false,
            destroyed: false,
            reconnecting: false,
            lastUsed: Date.now(),
        };
        this.clientMap.set(client, connection);
        this._attachListeners(connection);
        await this._connectWithBackoff(connection);
        return connection;
    }

    _attachListeners(connection) {
        const client = connection.client;
        client.on("error", (error) => {
            this.metrics.lastError = error?.message || String(error);
            this.metrics.lastFailureAt = Date.now();
            this._recordFailure(error);
        });
        client.on("close", () => {
            this._handleDisconnect(connection, "close");
        });
        client.on("end", () => {
            this._handleDisconnect(connection, "end");
        });
        client.on("ready", () => {
            connection.ready = true;
            connection.reconnecting = false;
            this._recordSuccess();
            this._serveQueue();
        });
    }

    async _connectWithBackoff(connection) {
        for (let attempt = 1; attempt <= this.maxReconnectAttempts; attempt += 1) {
            try {
                this.metrics.reconnectionAttempts += 1;
                await connection.client.connect();
                connection.ready = true;
                this.metrics.lastSuccessAt = Date.now();
                this._recordSuccess();
                return;
            } catch (error) {
                connection.ready = false;
                this._recordFailure(error);
                if (attempt === this.maxReconnectAttempts) {
                    connection.destroyed = true;
                    throw error;
                }
                const delay = Math.min(this.maxBackoffMs, this.backoffBaseMs * 2 ** (attempt - 1));
                await wait(delay);
            }
        }
    }

    async _handleDisconnect(connection, reason) {
        if (connection.destroyed) {
            return;
        }
        connection.ready = false;
        if (!connection.reconnecting) {
            connection.reconnecting = true;
            try {
                await this._connectWithBackoff(connection);
            } catch (error) {
                this.logger.error?.("Redis connection lost", {
                    reason,
                    error: error?.message || String(error),
                });
                this._removeConnection(connection);
                this._openCircuit(error);
            }
        }
    }

    _removeConnection(connection) {
        connection.destroyed = true;
        this.clientMap.delete(connection.client);
        this.connections = this.connections.filter((item) => item !== connection);
        this.metrics.totalConnections = this.connections.length;
        this._emitMetrics();
    }

    _serveQueue() {
        while (this.waitQueue.length > 0) {
            const available = this.connections.find((conn) => conn.ready && !conn.busy && !conn.destroyed);
            if (!available) {
                break;
            }
            const queued = this.waitQueue.shift();
            if (!queued) {
                break;
            }
            available.busy = true;
            available.lastUsed = Date.now();
            this.metrics.acquired += 1;
            this.metrics.activeConnections += 1;
            this.metrics.queueSize = this.waitQueue.length;
            queued.resolve(available.client);
        }
        this.metrics.queueSize = this.waitQueue.length;
        this._emitMetrics();
    }

    _recordSuccess() {
        this.failureCount = 0;
        this.metrics.lastSuccessAt = Date.now();
        if (this.circuitState !== "closed") {
            this.circuitState = "closed";
            this.metrics.circuitState = this.circuitState;
            this.halfOpenTrial = false;
            this.logger.info?.("Redis circuit breaker closed", {
                redisUrl: this._redactUrl(this.redisUrl),
            });
        }
        this._emitMetrics();
    }

    _recordFailure(error) {
        this.failureCount += 1;
        this.metrics.failures += 1;
        this.metrics.lastError = error?.message || String(error);
        this.metrics.lastFailureAt = Date.now();
        if (this.failureCount >= this.circuitBreakerThreshold && this.circuitState !== "open") {
            this._openCircuit(error);
        } else {
            this.logger.warn?.("Redis pool failure", {
                redisUrl: this._redactUrl(this.redisUrl),
                failureCount: this.failureCount,
                error: this.metrics.lastError,
            });
        }
        this._emitMetrics();
    }

    _openCircuit(error) {
        this.circuitState = "open";
        this.metrics.circuitState = this.circuitState;
        this.circuitOpenedAt = Date.now();
        this.halfOpenTrial = false;
        const reason = error?.message || String(error);
        this.logger.error?.("Redis circuit breaker opened", {
            redisUrl: this._redactUrl(this.redisUrl),
            error: reason,
        });
        while (this.waitQueue.length > 0) {
            const queued = this.waitQueue.shift();
            queued.reject?.(new Error("REDIS_CIRCUIT_OPEN"));
        }
        this.metrics.queueSize = 0;
        this._emitMetrics();
    }

    _shouldHalfOpen() {
        if (this.circuitState !== "open") {
            return false;
        }
        return Date.now() - this.circuitOpenedAt >= this.circuitBreakerResetMs;
    }

    _transitionToHalfOpen() {
        if (this.circuitState === "open") {
            this.circuitState = "half-open";
            this.metrics.circuitState = this.circuitState;
            this.logger.warn?.("Redis circuit breaker half-open", {
                redisUrl: this._redactUrl(this.redisUrl),
            });
            this._emitMetrics();
        }
    }

    _redactUrl(url) {
        if (!url) {
            return "";
        }
        try {
            const parsed = new URL(url);
            if (parsed.password) {
                parsed.password = "***";
            }
            return parsed.toString();
        } catch (error) {
            return url;
        }
    }
}

class DisabledRedisPool {
    constructor(options = {}) {
        this.enabled = false;
        this.logger = options.logger || console;
        this.metrics = {
            enabled: false,
            circuitState: "offline",
            reason: options.reason || "disabled",
        };
    }

    register() {
        return this;
    }

    async releaseReference() {
        return undefined;
    }

    isAvailable() {
        return false;
    }

    async acquire() {
        throw new Error("REDIS_DISABLED");
    }

    release() {}

    async run() {
        throw new Error("REDIS_DISABLED");
    }

    async shutdown() {
        return undefined;
    }

    getHealthMetrics() {
        return { ...this.metrics };
    }

    on() {
        return this;
    }

    emit() {
        return false;
    }

    off() {
        return this;
    }
}

function getSharedRedisPool(options = {}) {
    if (!RedisLib || !options.redisUrl) {
        const logger = options.logger || console;
        if (options.redisUrl && !RedisLib) {
            logger.warn?.("Redis URL provided but ioredis is not available. Falling back to in-memory operations.");
        }
        return new DisabledRedisPool({ reason: RedisLib ? "no-url" : "missing-driver", logger });
    }
    const key = options.redisUrl;
    let pool = poolRegistry.get(key);
    if (!pool) {
        pool = new RedisPool(options);
        poolRegistry.set(key, pool);
    }
    return pool.register();
}

module.exports = {
    getSharedRedisPool,
    RedisPool,
};

