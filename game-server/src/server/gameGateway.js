'use strict';

const EventEmitter = require('events');
const {
    GameRegistry,
    PluginManager,
    GameFactory,
    GameRoomManager,
    ResourceMonitor,
    InMemoryGameRepository,
} = require('../core');
const { getPluginDirectory } = require('../plugins');

class ModularGameServer extends EventEmitter {
    constructor({ io, logger = console, pluginDirectory }) {
        super();
        this.io = io;
        this.logger = logger;
        this.registry = new GameRegistry();
        this.pluginManager = new PluginManager({ registry: this.registry, logger });
        this.factory = new GameFactory({ registry: this.registry });
        this.repository = new InMemoryGameRepository();
        this.roomManager = new GameRoomManager({ gameFactory: this.factory, repository: this.repository });
        this.resourceMonitor = new ResourceMonitor({ intervalMs: 3000 });
        this.resourceMonitor.start();
        this._init(pluginDirectory);
        this._wireRoomEvents();
        this._wirePluginEvents();
    }

    async _init(pluginDirectory) {
        const directory = pluginDirectory || getPluginDirectory();
        try {
            await this.pluginManager.loadFromDirectory(directory);
            this.io.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers }) => ({ id, name, minPlayers, maxPlayers })));
        } catch (error) {
            this.logger.error('Failed to load game plugins:', error);
        }
    }

    _wireRoomEvents() {
        const updateMetrics = () => {
            this.resourceMonitor.update({
                rooms: this.roomManager.rooms.size,
                activeGames: Array.from(this.roomManager.rooms.values()).filter(room => room.gameInstance).length,
                players: Array.from(this.roomManager.rooms.values()).reduce((sum, room) => sum + room.playerManager.players.size, 0),
            });
            this.io.emit('serverMetrics', this.resourceMonitor.getSnapshot());
        };

        const emitRooms = () => {
            this.io.emit('updateRoomList', this._serializeRooms());
            updateMetrics();
        };

        this.roomManager.on('roomCreated', () => emitRooms());
        this.roomManager.on('roomUpdated', ({ id }) => {
            const room = this.roomManager.getRoom(id);
            if (room) {
                this.io.to(id).emit('roomStateUpdate', room.toJSON());
            }
            emitRooms();
        });
        this.roomManager.on('roomRemoved', ({ roomId }) => {
            this.io.to(roomId).emit('roomClosed');
            emitRooms();
        });
        this.roomManager.on('gameStarted', ({ roomId, state }) => {
            const room = this.roomManager.getRoom(roomId);
            if (room) {
                this.io.to(roomId).emit('gameStart', {
                    gameState: state.state,
                    players: room.playerManager.list(),
                    gameId: room.gameId,
                });
            }
            updateMetrics();
        });
        this.roomManager.on('gameState', ({ roomId, state, version, context }) => {
            this.io.to(roomId).emit('gameStateUpdate', {
                state,
                version,
                context,
            });
        });
    }

    attachSocket(socket, { getPlayer, setPlayerRoom, clearPlayerRoom }) {
        socket.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers }) => ({ id, name, minPlayers, maxPlayers })));
        socket.emit('updateRoomList', this._serializeRooms());
        socket.on('createGame', (payload = {}) => {
            try {
                const { gameType, mode = 'lan', roomCode, minPlayers, maxPlayers } = payload;
                const definition = this._resolveGameDefinition(gameType);
                const player = getPlayer();
                const room = this.roomManager.createRoom({
                    hostId: socket.id,
                    gameId: definition.id,
                    mode,
                    preferredRoomId: mode === 'p2p' && roomCode ? String(roomCode).toUpperCase() : undefined,
                    playerLimits: {
                        minPlayers: minPlayers || definition.minPlayers,
                        maxPlayers: maxPlayers || definition.maxPlayers,
                    },
                    metadata: { mode },
                });
                this.roomManager.joinRoom(room.id, {
                    id: socket.id,
                    displayName: player?.username || player?.displayName || 'Player',
                    metadata: { account: player?.account || null },
                    isReady: true,
                });
                setPlayerRoom(room.id);
                socket.join(room.id);
                socket.emit('joinedMatchLobby', { room: room.toJSON(), yourId: socket.id });
                this.io.to(room.id).emit('roomStateUpdate', room.toJSON());
            } catch (error) {
                this.logger.error('Failed to create game:', error);
                socket.emit('error', error.message);
            }
        });

        socket.on('joinGame', async (roomIdRaw) => {
            try {
                const roomId = String(roomIdRaw || '').trim();
                if (!roomId) throw new Error('Room does not exist.');
                const room = this.roomManager.getRoom(roomId) || this.roomManager.getRoom(roomId.toUpperCase());
                if (!room) {
                    throw new Error(`Room ${roomId.toUpperCase()} does not exist.`);
                }
                if (room.playerManager.players.size >= room.playerManager.maxPlayers) {
                    throw new Error('Room is full.');
                }
                const player = getPlayer();
                await this.roomManager.joinRoom(room.id, {
                    id: socket.id,
                    displayName: player?.username || player?.displayName || 'Player',
                    metadata: { account: player?.account || null },
                    isReady: false,
                });
                setPlayerRoom(room.id);
                socket.join(room.id);
                socket.emit('joinedMatchLobby', { room: room.toJSON(), yourId: socket.id });
                this.io.to(room.id).emit('roomStateUpdate', room.toJSON());
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('playerReady', () => {
            const player = getPlayer();
            if (!player?.inRoom) return;
            try {
                const updated = this.roomManager.toggleReady(player.inRoom, socket.id);
                if (updated) {
                    this.io.to(player.inRoom).emit('roomStateUpdate', this.roomManager.getRoom(player.inRoom).toJSON());
                }
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('startGame', () => {
            const player = getPlayer();
            if (!player?.inRoom) return;
            const room = this.roomManager.getRoom(player.inRoom);
            if (!room || room.hostId !== socket.id) {
                socket.emit('error', 'Only the host can start the game.');
                return;
            }
            try {
                this.roomManager.startGame(player.inRoom);
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('submitMove', (commandDescriptor = {}) => {
            const player = getPlayer();
            if (!player?.inRoom) return;
            try {
                this.roomManager.submitCommand(player.inRoom, { ...commandDescriptor, playerId: socket.id });
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('undoMove', () => {
            const player = getPlayer();
            if (!player?.inRoom) return;
            try {
                this.roomManager.undoLast(player.inRoom, socket.id);
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('leaveGame', () => {
            const player = getPlayer();
            if (!player?.inRoom) return;
            this._leaveRoom(socket, player.inRoom, clearPlayerRoom);
        });

        socket.on('disconnect', () => {
            const player = getPlayer();
            if (player?.inRoom) {
                this._leaveRoom(socket, player.inRoom, clearPlayerRoom, { disconnect: true });
            }
        });
    }

    _leaveRoom(socket, roomId, clearPlayerRoom, { disconnect = false } = {}) {
        this.roomManager.leaveRoom(roomId, socket.id)
            .then(() => {
                socket.leave(roomId);
                clearPlayerRoom();
                const room = this.roomManager.getRoom(roomId);
                if (room) {
                    this.io.to(roomId).emit('roomStateUpdate', room.toJSON());
                }
                if (disconnect) {
                    this.io.to(roomId).emit('playerLeft', 'A player has disconnected.');
                }
            })
            .catch((error) => {
                this.logger.error('Failed to leave room:', error);
            });
    }

    notifyRoomUpdate(roomId) {
        const room = this.roomManager.getRoom(roomId);
        if (!room) {
            return;
        }
        this.io.to(roomId).emit('roomStateUpdate', room.toJSON());
        this.io.emit('updateRoomList', this._serializeRooms());
    }

    _wirePluginEvents() {
        const broadcast = () => {
            this.io.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers }) => ({ id, name, minPlayers, maxPlayers })));
        };
        this.pluginManager.on('pluginLoaded', broadcast);
        this.pluginManager.on('pluginUnloaded', broadcast);
        this.registry.on('updated', broadcast);
    }

    _serializeRooms() {
        const summary = {};
        for (const room of this.roomManager.rooms.values()) {
            if (room.metadata.mode === 'lan' && room.playerManager.players.size < room.playerManager.maxPlayers) {
                summary[room.id] = {
                    roomId: room.id,
                    gameType: room.gameId,
                    playerCount: room.playerManager.players.size,
                    maxPlayers: room.playerManager.maxPlayers,
                };
            }
        }
        return summary;
    }

    _resolveGameDefinition(gameType) {
        if (gameType && this.registry.get(gameType)) {
            return this.registry.get(gameType);
        }
        const available = this.registry.list();
        if (!available.length) {
            throw new Error('No games are currently available.');
        }
        return available[0];
    }
}

function createModularGameServer(options) {
    const server = new ModularGameServer(options);
    return server;
}

module.exports = {
    createModularGameServer,
};
