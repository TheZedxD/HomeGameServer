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
        this.playerLimits = playerLimits;
        this.playerManager = new PlayerManager(playerLimits);
        this.gameInstance = null;
        this.stateSynchronizer = null;
        this.stateManager = null;
    }

    attachGame(gameInstance) {
        this.gameInstance = gameInstance;
        this.playerManager = gameInstance.playerManager;
        this.stateManager = gameInstance.stateManager;
        this.stateSynchronizer = new StateSynchronizer({ stateManager: this.stateManager, roomId: this.id });
        this.emit('gameAttached', { roomId: this.id, gameInstance });
        return this.stateSynchronizer;
    }

    detachGame() {
        if (this.stateSynchronizer) {
            this.stateSynchronizer.dispose();
            this.stateSynchronizer = null;
        }

        if (this.gameInstance?.removeAllListeners) {
            this.gameInstance.removeAllListeners();
        }

        if (typeof this.gameInstance?.destroy === 'function') {
            this.gameInstance.destroy();
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
            metadata: this.metadata,
            players: this.playerManager.list(),
            minPlayers: this.playerManager.minPlayers,
            maxPlayers: this.playerManager.maxPlayers,
            isGameActive: Boolean(this.gameInstance),
        };
    }
}

module.exports = GameRoom;
