"use strict";

const fs = require('fs');
const path = require('path');
const { createProfileCache } = require('./profileCache');
const { createProfileAnalytics } = require('./profileAnalytics');
const lockfile = (() => {
    try {
        return require('proper-lockfile');
    } catch (error) {
        return {
            lock: async () => async () => {},
        };
    }
})();

class ProfileService {
    constructor(options) {
        if (!options || !options.dataFile) {
            throw new Error('ProfileService requires a dataFile path.');
        }

        this.dataFile = options.dataFile;
        this.uploadDir = options.uploadDir;
        this.logger = options.logger || console;
        this.cacheTtlMs = options.cacheTtlMs || 5000;
        this.cache = createProfileCache({
            ...(options.cacheOptions || {}),
            logger: this.logger,
        });
        this.analytics = createProfileAnalytics({
            ...(options.analyticsOptions || {}),
            logger: this.logger,
        });

        this._storeCache = { data: null, mtime: 0, expiresAt: 0 };
        this._displayNameIndex = new Map();
        this._watchHandler = null;
        this._writeQueue = Promise.resolve();
        this._writeLock = null;
    }

    initialize() {
        this._ensureDataFile();
        this._loadInitialStore();
        this._watchHandler = () => {
            this.logger.debug?.('User store changed on disk. Invalidating cache.');
            this._storeCache = { data: null, mtime: 0, expiresAt: 0 };
            this._displayNameIndex = new Map();
        };
        fs.watchFile(this.dataFile, { interval: this.cacheTtlMs }, this._watchHandler);
    }

    async shutdown() {
        if (this._watchHandler) {
            fs.unwatchFile(this.dataFile, this._watchHandler);
        }
        await this.analytics.shutdown();
        await this.cache.shutdown();
    }

    readStore() {
        const now = Date.now();
        if (this._storeCache.data && this._storeCache.expiresAt > now) {
            return this._storeCache.data;
        }
        try {
            const stats = fs.statSync(this.dataFile);
            if (this._storeCache.data && this._storeCache.mtime === stats.mtimeMs) {
                this._storeCache.expiresAt = now + this.cacheTtlMs;
                return this._storeCache.data;
            }
            const raw = fs.readFileSync(this.dataFile, 'utf8');
            const parsed = JSON.parse(raw);
            const normalized = { users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {} };
            this._storeCache = {
                data: normalized,
                mtime: stats.mtimeMs,
                expiresAt: now + this.cacheTtlMs,
            };
            this._rebuildDisplayNameIndex(normalized.users);
            return normalized;
        } catch (error) {
            this.logger.error?.('Failed to read profile store:', error);
            return { users: {} };
        }
    }

    async writeStore(store) {
        const task = this._writeQueue.then(async () => {
            const normalized = { users: store?.users || {} };
            const tempFile = `${this.dataFile}.tmp.${Date.now()}`;

            const release = await lockfile.lock(this.dataFile, {
                stale: 10000,
                retries: { retries: 3, minTimeout: 100 },
            }).catch(() => null);

            if (release) {
                this._writeLock = release;
            }

            try {
                await fs.promises.writeFile(tempFile, JSON.stringify(normalized, null, 2));
                await fs.promises.rename(tempFile, this.dataFile);

                const now = Date.now();
                this._storeCache = {
                    data: normalized,
                    mtime: now,
                    expiresAt: now + this.cacheTtlMs,
                };
                this._rebuildDisplayNameIndex(normalized.users);
            } finally {
                await fs.promises.unlink(tempFile).catch(() => {});
                if (release) {
                    await release();
                }
                this._writeLock = null;
            }
        });

        this._writeQueue = task.catch((error) => {
            this.logger.error?.('Failed to write profile store:', error);
        });

        return task;
    }

    getProfile(username) {
        if (!username) {
            return null;
        }
        const key = String(username).toLowerCase();
        const cached = this.cache.getSync(key);
        if (cached) {
            return { ...cached };
        }
        const store = this.readStore();
        const record = store.users[key];
        if (record) {
            void this._setCacheEntry(key, record);
            return { ...record };
        }
        return null;
    }

    async getProfileAsync(username) {
        if (!username) {
            return null;
        }
        const key = String(username).toLowerCase();
        const cached = this.cache.getSync(key);
        if (cached) {
            return { ...cached };
        }
        const remote = await this.cache.get(key);
        if (remote) {
            return { ...remote };
        }
        const store = this.readStore();
        const record = store.users[key];
        if (record) {
            await this._setCacheEntry(key, record);
            return { ...record };
        }
        return null;
    }

    ensureDisplayNameAvailability(displayName, excludeUsername) {
        if (!displayName) {
            return null;
        }
        const owner = this._displayNameIndex.get(displayName.toLowerCase());
        if (!owner) {
            return null;
        }
        if (excludeUsername && owner === excludeUsername.toLowerCase()) {
            return null;
        }
        return owner;
    }

    async updateProfile(username, updates) {
        if (!username) {
            return null;
        }
        const key = String(username).toLowerCase();
        const store = this.readStore();
        const record = store.users[key];
        if (!record) {
            return null;
        }

        let mutated = false;
        if (Object.prototype.hasOwnProperty.call(updates, 'displayName') && typeof updates.displayName === 'string') {
            record.displayName = updates.displayName;
            mutated = true;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'wins') && Number.isFinite(Number(updates.wins))) {
            record.wins = Number(updates.wins);
            mutated = true;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'avatarPath')) {
            record.avatarPath = updates.avatarPath;
            mutated = true;
        }

        if (mutated) {
            await this.writeStore(store);
            void this._setCacheEntry(key, record);
            this.analytics.record('update', { username: key });
        }

        return { ...record };
    }

    async incrementWins(username, amount = 1) {
        const key = String(username || '').toLowerCase();
        if (!key) {
            return;
        }
        const store = this.readStore();
        if (!store.users[key]) {
            return;
        }
        store.users[key].wins = (store.users[key].wins || 0) + Number(amount || 0);
        const totalWins = store.users[key].wins;
        await this.writeStore(store);
        void this._setCacheEntry(key, store.users[key]);
        this.analytics.record('win', { username: key });
        return totalWins;
    }

    async updateAvatar(username, avatarPath) {
        const key = String(username || '').toLowerCase();
        if (!key) {
            return null;
        }
        const store = this.readStore();
        const record = store.users[key];
        if (!record) {
            return null;
        }
        const previousPath = record.avatarPath;
        record.avatarPath = avatarPath;
        await this.writeStore(store);
        void this._setCacheEntry(key, record);
        this.analytics.record('avatarUpload', { username: key });
        return previousPath || null;
    }

    async upsert(username, payload) {
        const key = String(username || '').toLowerCase();
        if (!key) {
            return null;
        }
        const store = this.readStore();
        store.users[key] = { ...(store.users[key] || { username }), ...payload };
        await this.writeStore(store);
        void this._setCacheEntry(key, store.users[key]);
        return { ...store.users[key] };
    }

    listProfiles() {
        const store = this.readStore();
        return Object.values(store.users).map((user) => ({ ...user }));
    }

    recordView(username) {
        if (!username) {
            return;
        }
        this.analytics.record('view', { username: String(username).toLowerCase() });
    }

    stats() {
        return {
            cache: this.cache.stats(),
            displayNames: this._displayNameIndex.size,
        };
    }

    async _setCacheEntry(key, value, options = {}) {
        try {
            await this.cache.set(key, value, options);
        } catch (error) {
            this.logger.error?.('Failed to update profile cache:', error);
        }
    }

    _ensureDataFile() {
        if (!fs.existsSync(path.dirname(this.dataFile))) {
            fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
        }
        if (!fs.existsSync(this.dataFile)) {
            fs.writeFileSync(this.dataFile, JSON.stringify({ users: {} }, null, 2));
        }
    }

    _loadInitialStore() {
        try {
            const stats = fs.statSync(this.dataFile);
            const raw = fs.readFileSync(this.dataFile, 'utf8');
            const parsed = JSON.parse(raw);
            const normalized = { users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {} };
            this._storeCache = {
                data: normalized,
                mtime: stats.mtimeMs,
                expiresAt: Date.now() + this.cacheTtlMs,
            };
            this._rebuildDisplayNameIndex(normalized.users);
        } catch (error) {
            this.logger.error?.('Failed to warm profile service cache:', error);
        }
    }

    _rebuildDisplayNameIndex(users) {
        const index = new Map();
        for (const record of Object.values(users)) {
            if (record && record.displayName) {
                index.set(String(record.displayName).toLowerCase(), String(record.username || '').toLowerCase());
            }
        }
        this._displayNameIndex = index;
    }
}

function createProfileService(options) {
    return new ProfileService(options);
}

module.exports = {
    ProfileService,
    createProfileService,
};
