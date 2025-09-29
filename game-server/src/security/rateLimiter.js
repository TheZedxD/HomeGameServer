'use strict';

class SlidingWindowRateLimiter {
    constructor({ windowMs, max }) {
        this.windowMs = windowMs;
        this.max = max;
        this.storage = new Map();
        this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(windowMs, 30000));
        this.cleanupInterval.unref?.();
    }

    allow(key, weight = 1) {
        if (!key) {
            return true;
        }
        const now = Date.now();
        const bucket = this.storage.get(key) || [];
        const threshold = now - this.windowMs;
        while (bucket.length && bucket[0] <= threshold) {
            bucket.shift();
        }
        if (bucket.length + weight > this.max) {
            this.storage.set(key, bucket);
            return false;
        }
        for (let i = 0; i < weight; i += 1) {
            bucket.push(now);
        }
        this.storage.set(key, bucket);
        return true;
    }

    cleanup() {
        const now = Date.now();
        const threshold = now - this.windowMs;
        for (const [key, bucket] of this.storage.entries()) {
            while (bucket.length && bucket[0] <= threshold) {
                bucket.shift();
            }
            if (!bucket.length) {
                this.storage.delete(key);
            }
        }
    }
}

function createHttpRateLimiter({
    windowMs,
    max,
    message = 'Too many requests. Please slow down.',
    keyGenerator = (req) => req.ip || req.connection?.remoteAddress || 'anonymous',
    skip,
    weight = () => 1,
    onLimit,
} = {}) {
    const limiter = new SlidingWindowRateLimiter({ windowMs, max });
    return function rateLimitMiddleware(req, res, next) {
        if (typeof skip === 'function' && skip(req)) {
            return next();
        }
        const key = keyGenerator(req);
        const requestWeight = typeof weight === 'function' ? weight(req) : 1;
        if (limiter.allow(key, requestWeight)) {
            return next();
        }
        if (typeof onLimit === 'function') {
            onLimit(req);
        }
        res.status(429).json({ error: message });
        return undefined;
    };
}

function createSocketRateLimiter({ windowMs, max, keyGenerator = (socket) => {
    // Safely access nested properties with optional chaining
    const address = socket?.handshake?.address
        || socket?.request?.connection?.remoteAddress
        || socket?.conn?.remoteAddress;
    return address || socket?.id || 'unknown';
}, onLimit } = {}) {
    const limiter = new SlidingWindowRateLimiter({ windowMs, max });
    return function socketRateLimiter(packet, next) {
        const socket = this; // eslint-disable-line no-invalid-this
        const key = socket ? keyGenerator(socket, packet) : 'unknown';
        if (limiter.allow(key)) {
            return next();
        }
        if (typeof onLimit === 'function') {
            onLimit(socket, packet);
        }
        if (typeof socket.emit === 'function') {
            socket.emit('rateLimit', { event: packet?.[0] || 'unknown' });
        }
        return next(new Error('Rate limit exceeded'));
    };
}

module.exports = {
    SlidingWindowRateLimiter,
    createHttpRateLimiter,
    createSocketRateLimiter,
};
