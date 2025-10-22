'use strict';

const EventEmitter = require('events');
const GameRoom = require('./gameRoom');
const { generateRoomId } = require('./utils');

class GameRoomManager extends EventEmitter {
    constructor({ gameFactory, repository, logger = console }) {
        super();
        this.gameFactory = gameFactory;
        this.repository = repository;
        this.rooms = new Map();
        this.logger = logger;
    }

    _logError(action, error, context = {}) {
        this.logger.error?.(`[GameRoomManager] ${action} failed`, {
            error: error?.message,
            stack: error?.stack,
            context,
        });
    }

    createRoom({ hostId, gameId, mode = 'lan', preferredRoomId, metadata = {}, playerLimits }) {
        const roomId = preferredRoomId || generateRoomId(mode);
        const context = { action: 'createRoom', roomId, hostId, gameId };
        let room;
        try {
            if (this.rooms.has(roomId)) {
                throw new Error(`Room ${roomId} already exists.`);
            }
            room = new GameRoom({ id: roomId, hostId, gameId, metadata, playerLimits });
            this.rooms.set(roomId, room);
            this.emit('roomCreated', room.toJSON());
            return room;
        } catch (error) {
            if (room && this.rooms.get(roomId) === room) {
                this.rooms.delete(roomId);
            }
            room?.detachGame?.();
            this._logError('createRoom', error, context);
            throw error;
        }
    }

    deleteRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;
        const context = { action: 'deleteRoom', roomId };
        try {
            room.detachGame();
            this.rooms.delete(roomId);
            this.repository?.remove?.(roomId);
            this.emit('roomRemoved', { roomId });
            return room;
        } catch (error) {
            if (!this.rooms.has(roomId)) {
                this.rooms.set(roomId, room);
            }
            this._logError('deleteRoom', error, context);
            throw error;
        }
    }

    getRoom(roomId) {
        return this.rooms.get(roomId) || null;
    }

    listRooms() {
        return Array.from(this.rooms.values()).map(room => room.toJSON());
    }

    async joinRoom(roomId, player) {
        const context = { action: 'joinRoom', roomId, playerId: player?.id || null };
        const room = this.getRoom(roomId);
        if (!room) {
            throw new Error(`Room ${roomId} not found.`);
        }
        if (room.isClosing) {
            throw new Error(`Room ${roomId} is closing.`);
        }
        let playerState;
        try {
            playerState = room.playerManager.addPlayer(player);
            this.emit('roomUpdated', room.toJSON());
            return { room, player: playerState };
        } catch (error) {
            if (playerState) {
                try {
                    room.playerManager.removePlayer(playerState.id);
                } catch (recoveryError) {
                    this._logError('joinRoom:recovery', recoveryError, context);
                }
            }
            this._logError('joinRoom', error, context);
            throw error;
        }
    }

    async leaveRoom(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const context = { action: 'leaveRoom', roomId, playerId };
        let removed = null;
        try {
            removed = room.playerManager.removePlayer(playerId);
            if (room.playerManager.players.size === 0) {
                room.isClosing = true;
                this.deleteRoom(roomId);
            } else {
                this.emit('roomUpdated', room.toJSON());
            }
            return removed;
        } catch (error) {
            if (removed && !room.playerManager.players.has(playerId)) {
                try {
                    room.playerManager.players.set(removed.id, removed);
                } catch (recoveryError) {
                    this._logError('leaveRoom:recovery', recoveryError, context);
                }
            }
            room.isClosing = false;
            this._logError('leaveRoom', error, context);
            throw error;
        }
    }

    toggleReady(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        const context = { action: 'toggleReady', roomId, playerId };
        const player = room.playerManager.getPlayer(playerId);
        const previousReady = player?.isReady;
        try {
            const updated = room.playerManager.toggleReady(playerId);
            this.emit('roomUpdated', room.toJSON());
            return updated;
        } catch (error) {
            if (player && typeof previousReady === 'boolean') {
                player.isReady = previousReady;
            }
            this._logError('toggleReady', error, context);
            throw error;
        }
    }

    setReady(roomId, playerId, ready) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        const context = { action: 'setReady', roomId, playerId, ready: Boolean(ready) };
        const player = room.playerManager.getPlayer(playerId);
        const previousReady = player?.isReady;
        try {
            const updated = room.playerManager.setReady(playerId, ready);
            this.emit('roomUpdated', room.toJSON());
            return updated;
        } catch (error) {
            if (player && typeof previousReady === 'boolean') {
                player.isReady = previousReady;
            }
            this._logError('setReady', error, context);
            throw error;
        }
    }

    startGame(roomId) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        const context = { action: 'startGame', roomId };
        if (!room.playerManager.isReadyToStart()) {
            throw new Error('Not all players are ready.');
        }
        if (!this.gameFactory) {
            throw new Error('Game factory not configured.');
        }
        let synchronizer;
        let gameInstance;
        try {
            const definition = this.gameFactory.registry.get(room.gameId);
            gameInstance = this.gameFactory.create(room.gameId, {
                roomId,
                players: room.playerManager.list(),
                metadata: room.metadata,
                minPlayers: definition.minPlayers,
                maxPlayers: definition.maxPlayers,
            });
            synchronizer = room.attachGame(gameInstance);
            synchronizer.on('sync', async (payload) => {
                try {
                    await this.repository?.save?.(roomId, payload.state);
                } catch (repoError) {
                    this._logError('startGame:repositorySave', repoError, { ...context });
                }
                this.emit('gameState', payload);
            });
            const forwardRoundEnd = (payload) => {
                this.emit('roundEnd', payload);
            };
            synchronizer.on('roundEnd', forwardRoundEnd);
            room.once('gameDetached', () => {
                synchronizer.off('roundEnd', forwardRoundEnd);
            });
            this.emit('gameStarted', { roomId, state: gameInstance.getState() });
            return { room, gameInstance };
        } catch (error) {
            if (synchronizer) {
                try {
                    room.detachGame();
                } catch (detachError) {
                    this._logError('startGame:detachRecovery', detachError, context);
                }
            }
            this._logError('startGame', error, context);
            throw error;
        }
    }

    submitCommand(roomId, commandDescriptor) {
        const room = this.getRoom(roomId);
        if (!room?.gameInstance) {
            throw new Error('Game is not active.');
        }
        const context = { action: 'submitCommand', roomId, playerId: commandDescriptor?.playerId || null };
        try {
            const outcome = room.gameInstance.commandBus.dispatch(commandDescriptor);
            this.emit('roomUpdated', room.toJSON());
            return outcome;
        } catch (error) {
            this._logError('submitCommand', error, context);
            throw error;
        }
    }

    undoLast(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room?.gameInstance) {
            throw new Error('Game is not active.');
        }
        const context = { action: 'undoLast', roomId, playerId };
        try {
            const outcome = room.gameInstance.commandBus.undoLast(playerId);
            this.emit('roomUpdated', room.toJSON());
            return outcome;
        } catch (error) {
            this._logError('undoLast', error, context);
            throw error;
        }
    }
}

module.exports = GameRoomManager;
