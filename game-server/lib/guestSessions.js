"use strict";

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GuestSessionManager {
    constructor(options) {
        this.filePath = options.filePath;
        this.secret = options.secret;
        this.ttl = options.ttl || 1000 * 60 * 60 * 24 * 2; // default 2 days
        this.cleanupIntervalMs = options.cleanupIntervalMs || 1000 * 60 * 30; // 30 minutes
        this.sessions = new Map();
        this._dirty = false;

        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this._loadFromDisk();
        this._scheduleCleanup();
    }

    createSession() {
        const id = crypto.randomUUID();
        const session = {
            id,
            createdAt: Date.now(),
            lastSeen: Date.now(),
            data: {
                displayName: null,
                wins: 0,
                lastRoom: null,
            },
        };
        this.sessions.set(id, session);
        this._markDirty();
        return { session, token: this._signSessionId(id) };
    }

    parseToken(token) {
        if (typeof token !== 'string') {
            return null;
        }
        const [id, signature] = token.split('.');
        if (!id || !signature) {
            return null;
        }
        const expected = this._createSignature(id);
        try {
            const providedBuffer = Buffer.from(signature, 'hex');
            const expectedBuffer = Buffer.from(expected, 'hex');
            if (providedBuffer.length !== expectedBuffer.length) {
                return null;
            }
            if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
                return null;
            }
            return id;
        } catch (error) {
            return null;
        }
    }

    getSessionByToken(token) {
        const id = this.parseToken(token);
        if (!id) {
            return null;
        }
        return this.getSession(id);
    }

    getSession(id) {
        if (!id) {
            return null;
        }
        const session = this.sessions.get(id);
        if (!session) {
            return null;
        }
        session.lastSeen = Date.now();
        this._markDirty();
        return session;
    }

    updateSession(id, updater) {
        const session = this.sessions.get(id);
        if (!session) {
            return null;
        }
        const nextData = typeof updater === 'function'
            ? updater({ ...session.data })
            : { ...session.data, ...updater };
        session.data = nextData;
        session.lastSeen = Date.now();
        this._markDirty();
        return session;
    }

    recordDisplayName(id, displayName) {
        if (!displayName) return;
        this.updateSession(id, (data) => ({
            ...data,
            displayName,
        }));
    }

    recordLastRoom(id, roomSnapshot) {
        if (!roomSnapshot) return;
        this.updateSession(id, (data) => ({
            ...data,
            lastRoom: {
                ...roomSnapshot,
                timestamp: Date.now(),
            },
        }));
    }

    recordWin(id) {
        this.updateSession(id, (data) => ({
            ...data,
            wins: (data.wins || 0) + 1,
        }));
    }

    promoteSession(id) {
        const session = this.sessions.get(id);
        if (!session) {
            return null;
        }
        this.sessions.delete(id);
        this._markDirty();
        return {
            id: session.id,
            data: session.data,
        };
    }

    cleanupExpired() {
        const now = Date.now();
        let removed = false;
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastSeen > this.ttl) {
                this.sessions.delete(id);
                removed = true;
            }
        }
        if (removed) {
            this._markDirty();
        }
    }

    stop() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
        }
    }

    _scheduleCleanup() {
        this._cleanupTimer = setInterval(() => {
            try {
                this.cleanupExpired();
                this._flushIfDirty();
            } catch (error) {
                console.error('Guest session cleanup failed:', error);
            }
        }, this.cleanupIntervalMs);
        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    _signSessionId(id) {
        return `${id}.${this._createSignature(id)}`;
    }

    _createSignature(id) {
        return crypto.createHmac('sha256', this.secret).update(id).digest('hex');
    }

    _loadFromDisk() {
        try {
            if (!fs.existsSync(this.filePath)) {
                return;
            }
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.sessions)) {
                return;
            }
            for (const entry of parsed.sessions) {
                if (!entry || !entry.id) continue;
                this.sessions.set(entry.id, {
                    id: entry.id,
                    createdAt: entry.createdAt || Date.now(),
                    lastSeen: entry.lastSeen || Date.now(),
                    data: entry.data || {},
                });
            }
        } catch (error) {
            console.error('Failed to load guest sessions:', error);
        }
    }

    _markDirty() {
        this._dirty = true;
        this._flushSoon();
    }

    _flushSoon() {
        if (this._flushTimer) {
            return;
        }
        this._flushTimer = setTimeout(() => {
            this._flushIfDirty();
        }, 200);
    }

    _flushIfDirty() {
        if (!this._dirty) {
            return;
        }
        this._dirty = false;
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
        const payload = {
            sessions: Array.from(this.sessions.values()).map((session) => ({
                id: session.id,
                createdAt: session.createdAt,
                lastSeen: session.lastSeen,
                data: session.data,
            })),
        };
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
        } catch (error) {
            console.error('Failed to persist guest sessions:', error);
        }
    }
}

module.exports = GuestSessionManager;
