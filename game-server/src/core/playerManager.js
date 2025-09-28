'use strict';

const EventEmitter = require('events');

class PlayerManager extends EventEmitter {
    constructor({ minPlayers = 2, maxPlayers = 4 } = {}) {
        super();
        this.minPlayers = minPlayers;
        this.maxPlayers = maxPlayers;
        this.players = new Map();
    }

    addPlayer(player) {
        if (!player || !player.id) {
            throw new Error('Player requires an id.');
        }
        if (this.players.has(player.id)) {
            return this.players.get(player.id);
        }
        if (this.players.size >= this.maxPlayers) {
            throw new Error('Player capacity reached.');
        }
        const normalized = {
            id: player.id,
            displayName: player.displayName || `Player ${this.players.size + 1}`,
            isReady: Boolean(player.isReady),
            metadata: player.metadata || {},
            joinedAt: Date.now(),
        };
        this.players.set(normalized.id, normalized);
        this.emit('playerJoined', normalized);
        return normalized;
    }

    removePlayer(id) {
        if (!this.players.has(id)) {
            return null;
        }
        const removed = this.players.get(id);
        this.players.delete(id);
        this.emit('playerLeft', removed);
        return removed;
    }

    setReady(id, isReady) {
        const player = this.players.get(id);
        if (!player) return null;
        player.isReady = Boolean(isReady);
        this.emit('playerReadyState', { id, isReady: player.isReady });
        return player;
    }

    toggleReady(id) {
        const player = this.players.get(id);
        if (!player) return null;
        player.isReady = !player.isReady;
        this.emit('playerReadyState', { id, isReady: player.isReady });
        return player;
    }

    getPlayer(id) {
        return this.players.get(id) || null;
    }

    list() {
        return Array.from(this.players.values());
    }

    isReadyToStart() {
        if (this.players.size < this.minPlayers) {
            return false;
        }
        return this.list().every(player => player.isReady);
    }

    hasPlayer(id) {
        return this.players.has(id);
    }

    clear() {
        this.players.clear();
    }

    toJSON() {
        return {
            minPlayers: this.minPlayers,
            maxPlayers: this.maxPlayers,
            players: this.list(),
        };
    }
}

module.exports = PlayerManager;
