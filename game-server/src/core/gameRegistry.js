'use strict';

const EventEmitter = require('events');

class GameRegistry extends EventEmitter {
    constructor() {
        super();
        this._definitions = new Map();
    }

    register(definition) {
        const normalized = normalizeDefinition(definition);
        if (this._definitions.has(normalized.id)) {
            throw new Error(`Game definition with id "${normalized.id}" already registered.`);
        }
        this._definitions.set(normalized.id, normalized);
        this.emit('registered', normalized);
        return normalized;
    }

    update(definition) {
        const normalized = normalizeDefinition(definition);
        this._definitions.set(normalized.id, normalized);
        this.emit('updated', normalized);
        return normalized;
    }

    unregister(id) {
        if (!this._definitions.has(id)) {
            return false;
        }
        const definition = this._definitions.get(id);
        this._definitions.delete(id);
        this.emit('unregistered', definition);
        return true;
    }

    get(id) {
        return this._definitions.get(id) || null;
    }

    list() {
        return Array.from(this._definitions.values());
    }
}

function normalizeDefinition(definition = {}) {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('Game definition must be an object.');
    }
    const { id, name, version, minPlayers, maxPlayers, create, category, isCasino, description, minBet, maxBet } = definition;
    if (!id || typeof id !== 'string') {
        throw new Error('Game definition requires an id.');
    }
    if (typeof create !== 'function') {
        throw new Error(`Game definition "${id}" must implement a create() factory.`);
    }
    return {
        id,
        name: name || id,
        version: version || '1.0.0',
        minPlayers: Number.isInteger(minPlayers) ? minPlayers : 2,
        maxPlayers: Number.isInteger(maxPlayers) ? maxPlayers : Math.max(4, minPlayers || 2),
        create,
        category: category || 'other',
        isCasino: isCasino || false,
        description: description || '',
        minBet: minBet || undefined,
        maxBet: maxBet || undefined,
    };
}

module.exports = GameRegistry;
