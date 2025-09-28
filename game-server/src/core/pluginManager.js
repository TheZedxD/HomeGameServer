'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class PluginManager extends EventEmitter {
    constructor({ registry, logger = console } = {}) {
        super();
        if (!registry) {
            throw new Error('PluginManager requires a GameRegistry instance.');
        }
        this.registry = registry;
        this.logger = logger;
        this.plugins = new Map();
        this.watchers = new Map();
    }

    async loadFromDirectory(directory) {
        const resolved = path.resolve(directory);
        await fs.promises.mkdir(resolved, { recursive: true });
        const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await this.loadPlugin(path.join(resolved, entry.name));
            } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js') {
                await this.loadPlugin(path.join(resolved, entry.name));
            }
        }
        this._watch(resolved);
    }

    async loadPlugin(pluginPath) {
        const resolved = path.resolve(pluginPath);
        delete require.cache[resolved];

        try {
            const pluginModule = require(resolved);
            const plugin = pluginModule.default || pluginModule;
            if (!plugin || typeof plugin.register !== 'function') {
                throw new Error(`Plugin at ${resolved} must export a register(registry) function.`);
            }
            const definition = plugin.register(this.registry, {
                logger: this.logger,
            });
            if (!definition || !definition.id) {
                throw new Error(`Plugin at ${resolved} did not register a game definition.`);
            }
            this.plugins.set(definition.id, { definition, path: resolved });
            this.emit('pluginLoaded', definition);
            this.logger.info?.(`Loaded game plugin: ${definition.id}@${definition.version}`);
            return definition;
        } catch (error) {
            this.logger.error?.(`Failed to load plugin ${resolved}:`, error);
            throw error;
        }
    }

    unload(id) {
        const existing = this.plugins.get(id);
        if (!existing) return false;
        this.registry.unregister(id);
        delete require.cache[existing.path];
        this.plugins.delete(id);
        this.emit('pluginUnloaded', existing.definition);
        return true;
    }

    reload(id) {
        const existing = this.plugins.get(id);
        if (!existing) {
            throw new Error(`Cannot reload unknown plugin ${id}`);
        }
        this.unload(id);
        return this.loadPlugin(existing.path);
    }

    _watch(directory) {
        if (this.watchers.has(directory)) {
            return;
        }
        try {
            const watcher = fs.watch(directory, { persistent: false }, async (event, filename) => {
                if (!filename) return;
                const filePath = path.join(directory, filename);
                try {
                    const existing = Array.from(this.plugins.values()).find(p => p.path === filePath);
                    if (existing) {
                        await this.reload(existing.definition.id);
                    } else if (event === 'rename') {
                        const stats = await fs.promises.stat(filePath).catch(() => null);
                        if (stats) {
                            await this.loadPlugin(filePath);
                        }
                    }
                } catch (error) {
                    this.logger.error?.('Plugin hot-reload failed:', error);
                }
            });
            this.watchers.set(directory, watcher);
        } catch (error) {
            this.logger.warn?.('Plugin directory watching unavailable:', error.message);
        }
    }

    close() {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}

module.exports = PluginManager;
