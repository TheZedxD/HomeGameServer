'use strict';

const EventEmitter = require('events');
const GameRoom = require('./gameRoom');
const { generateRoomId } = require('./utils');

class GameRoomManager extends EventEmitter {
    constructor({ gameFactory, repository }) {
        super();
        this.gameFactory = gameFactory;
        this.repository = repository;
        this.rooms = new Map();
    }

    createRoom({ hostId, gameId, mode = 'lan', preferredRoomId, metadata = {}, playerLimits }) {
        const roomId = preferredRoomId || generateRoomId(mode);
        if (this.rooms.has(roomId)) {
            throw new Error(`Room ${roomId} already exists.`);
        }
        const room = new GameRoom({ id: roomId, hostId, gameId, metadata, playerLimits });
        this.rooms.set(roomId, room);
        this.emit('roomCreated', room.toJSON());
        return room;
    }

    deleteRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;
        room.detachGame();
        this.rooms.delete(roomId);
        this.repository?.remove?.(roomId);
        this.emit('roomRemoved', { roomId });
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId) || null;
    }

    listRooms() {
        return Array.from(this.rooms.values()).map(room => room.toJSON());
    }

    async joinRoom(roomId, player) {
        const room = this.getRoom(roomId);
        if (!room) {
            throw new Error(`Room ${roomId} not found.`);
        }
        const playerState = room.playerManager.addPlayer(player);
        this.emit('roomUpdated', room.toJSON());
        return { room, player: playerState };
    }

    async leaveRoom(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const removed = room.playerManager.removePlayer(playerId);
        if (room.playerManager.players.size === 0) {
            this.deleteRoom(roomId);
        } else {
            this.emit('roomUpdated', room.toJSON());
        }
        return removed;
    }

    toggleReady(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        const player = room.playerManager.toggleReady(playerId);
        this.emit('roomUpdated', room.toJSON());
        return player;
    }

    setReady(roomId, playerId, ready) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        const player = room.playerManager.setReady(playerId, ready);
        this.emit('roomUpdated', room.toJSON());
        return player;
    }

    startGame(roomId) {
        const room = this.getRoom(roomId);
        if (!room) throw new Error('Room not found');
        if (!room.playerManager.isReadyToStart()) {
            throw new Error('Not all players are ready.');
        }
        if (!this.gameFactory) {
            throw new Error('Game factory not configured.');
        }
        const definition = this.gameFactory.registry.get(room.gameId);
        const gameInstance = this.gameFactory.create(room.gameId, {
            roomId,
            players: room.playerManager.list(),
            metadata: room.metadata,
            minPlayers: definition.minPlayers,
            maxPlayers: definition.maxPlayers,
        });
        const synchronizer = room.attachGame(gameInstance);
        synchronizer.on('sync', async (payload) => {
            await this.repository?.save?.(roomId, payload.state);
            this.emit('gameState', payload);
        });
        this.emit('gameStarted', { roomId, state: gameInstance.getState() });
        return { room, gameInstance };
    }

    submitCommand(roomId, commandDescriptor) {
        const room = this.getRoom(roomId);
        if (!room?.gameInstance) {
            throw new Error('Game is not active.');
        }
        const outcome = room.gameInstance.commandBus.dispatch(commandDescriptor);
        this.emit('roomUpdated', room.toJSON());
        return outcome;
    }

    undoLast(roomId, playerId) {
        const room = this.getRoom(roomId);
        if (!room?.gameInstance) {
            throw new Error('Game is not active.');
        }
        const outcome = room.gameInstance.commandBus.undoLast(playerId);
        this.emit('roomUpdated', room.toJSON());
        return outcome;
    }
}

module.exports = GameRoomManager;
