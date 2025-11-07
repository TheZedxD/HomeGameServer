'use strict';

const EventEmitter = require('events');
const PlayerManager = require('./playerManager');
const StateSynchronizer = require('./stateSynchronizer');

class GameRoom extends EventEmitter {
    constructor({ id, hostId, gameId, metadata = {}, playerLimits }) {
        super();
        this.id = id;
        this.hostId = hostId;
        this.gameId = gameId;
        this.metadata = metadata;
        this.createdAt = Date.now();
        this.lastActivity = Date.now();
        this.playerLimits = playerLimits;
        this.playerManager = new PlayerManager(playerLimits);
        this.gameInstance = null;
        this.stateSynchronizer = null;
        this.stateManager = null;
        this.isClosing = false;
        this.disconnectedPlayers = new Map(); // Track temporarily disconnected players
    }

    /**
     * Update last activity timestamp
     */
    updateActivity() {
        this.lastActivity = Date.now();
    }

    /**
     * Check if room has been inactive for too long
     */
    isInactive(timeoutMs = 1800000) { // 30 minutes default
        return (Date.now() - this.lastActivity) > timeoutMs;
    }

    /**
     * Mark a player as temporarily disconnected
     */
    markPlayerDisconnected(playerId) {
        this.disconnectedPlayers.set(playerId, Date.now());
    }

    /**
     * Mark a player as reconnected
     */
    markPlayerReconnected(playerId) {
        this.disconnectedPlayers.delete(playerId);
    }

    /**
     * Clean up players who have been disconnected too long
     */
    cleanupDisconnectedPlayers(timeoutMs = 300000) { // 5 minutes default
        const now = Date.now();
        const toRemove = [];

        for (const [playerId, disconnectTime] of this.disconnectedPlayers) {
            if ((now - disconnectTime) > timeoutMs) {
                toRemove.push(playerId);
            }
        }

        for (const playerId of toRemove) {
            this.disconnectedPlayers.delete(playerId);
            if (this.playerManager.hasPlayer(playerId)) {
                try {
                    this.playerManager.removePlayer(playerId);
                } catch (error) {
                    console.error(`[GameRoom] Error removing timed-out player ${playerId}:`, error);
                }
            }
        }

        return toRemove.length;
    }

    attachGame(gameInstance) {
        if (this.stateSynchronizer) {
            this.stateSynchronizer.dispose();
            this.stateSynchronizer = null;
        }

        this.gameInstance = gameInstance;
        this.playerManager = gameInstance.playerManager;
        this.stateManager = gameInstance.stateManager;

        this.stateSynchronizer = new StateSynchronizer({
            stateManager: this.stateManager,
            roomId: this.id,
        });

        this.emit('gameAttached', { roomId: this.id, gameInstance });
        return this.stateSynchronizer;
    }

    detachGame() {
        if (this.stateSynchronizer) {
            try {
                this.stateSynchronizer.dispose();
            } catch (error) {
                console.warn('Error disposing synchronizer:', error);
            }
            this.stateSynchronizer = null;
        }

        if (this.gameInstance?.removeAllListeners) {
            this.gameInstance.removeAllListeners();
        }

        if (typeof this.gameInstance?.destroy === 'function') {
            try {
                this.gameInstance.destroy();
            } catch (error) {
                console.warn('Error destroying game instance:', error);
            }
        }

        if (this.stateManager?.removeAllListeners) {
            this.stateManager.removeAllListeners();
        }

        this.stateManager = null;
        this.gameInstance = null;
        this.playerManager = new PlayerManager(this.playerLimits);
        this.emit('gameDetached', { roomId: this.id });
    }

    toJSON() {
        return {
            id: this.id,
            hostId: this.hostId,
            gameId: this.gameId,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity,
            metadata: this.metadata,
            players: this.playerManager.list(),
            minPlayers: this.playerManager.minPlayers,
            maxPlayers: this.playerManager.maxPlayers,
            isGameActive: Boolean(this.gameInstance),
            disconnectedPlayerCount: this.disconnectedPlayers.size,
        };
    }

    /**
     * Cleanup and dispose of room resources
     */
    dispose() {
        this.detachGame();
        this.disconnectedPlayers.clear();
        this.removeAllListeners();
    }
}

module.exports = GameRoom;
