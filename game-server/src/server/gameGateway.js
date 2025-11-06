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
const { sanitizeRoomCode, sanitizeTextInput } = require('../security/validators');

class ModularGameServer extends EventEmitter {
    constructor({ io, logger = console, pluginDirectory, profileService = null }) {
        super();
        this.io = io;
        this.logger = logger;
        this.profileService = profileService;
        this.roomListVersion = 0;
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
            this.io.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers, category, isCasino }) => ({
                id,
                name,
                minPlayers,
                maxPlayers,
                category: category || 'other',
                isCasino: isCasino || false
            })));
        } catch (error) {
            this.logger.error('Failed to load game plugins:', error);
        }
    }

    _wireRoomEvents() {
        const updateMetrics = () => {
            this.resourceMonitor.update({
                rooms: this.roomManager.rooms.size,
                activeGames: Array.from(this.roomManager.rooms.values()).filter((room) => room.gameInstance).length,
                players: Array.from(this.roomManager.rooms.values()).reduce(
                    (sum, room) => sum + room.playerManager.players.size,
                    0,
                ),
            });
            this.io.emit('serverMetrics', this.resourceMonitor.getSnapshot());
        };

        const emitRooms = () => {
            this.roomListVersion++;
            this.io.emit('updateRoomList', {
                version: this.roomListVersion,
                rooms: this._serializeRooms(),
                timestamp: Date.now(),
            });
            updateMetrics();
        };

        this.roomManager.on('roomCreated', () => emitRooms());

        this.roomManager.on('roomUpdated', ({ id }) => {
            const room = this.roomManager.getRoom(id);
            if (room) {
                this.io.to(id).emit('roomStateUpdate', {
                    ...this._enrichRoomData(room),
                    timestamp: Date.now(),
                });
            }
            emitRooms();
        });

        this.roomManager.on('roomRemoved', ({ roomId }) => {
            const reason = 'The host has closed the room';

            this.io.to(roomId).emit('roomClosing', {
                roomId,
                reason,
                secondsRemaining: 3,
            });

            setTimeout(() => {
                this.io.to(roomId).emit('roomClosed', { roomId, reason });
                emitRooms();
            }, 3000);
        });

        this.roomManager.on('gameStarted', ({ roomId, state }) => {
            const room = this.roomManager.getRoom(roomId);
            if (room) {
                const pm = room.playerManager.list();
                const enrichedPlayers = pm.map((p) => {
                    const info = (state.state.players || {})[p.id] || {};
                    return {
                        ...p,
                        color: info.color || p.metadata?.color || null,
                        marker: info.marker || p.metadata?.marker || null,
                        displayName: info.displayName || p.displayName || p.username || null,
                    };
                });
                this.io.to(roomId).emit('gameStart', {
                    gameState: state.state,
                    players: enrichedPlayers,
                    gameId: room.gameId,
                    mode: room.metadata.mode || 'lan',
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

        this.roomManager.on('roundEnd', ({ roomId, ...event }) => {
            if (!roomId) {
                return;
            }

            // Update player credits for casino games
            const room = this.roomManager.getRoom(roomId);
            if (room && this.profileService) {
                const gameDefinition = this.registry.get(room.gameId);
                const isCasinoGame = gameDefinition?.isCasino || false;

                if (isCasinoGame && event.state) {
                    const players = room.playerManager.list();
                    const finalBalances = event.state.finalBalances || {};

                    players.forEach(player => {
                        const username = player.metadata?.username || player.displayName;
                        const finalBalance = finalBalances[player.id];

                        if (username && typeof finalBalance === 'number') {
                            // Update the user's credit balance
                            this.profileService.updateBalance(username, finalBalance);
                            this.logger.info(`[Credits] Updated ${username} balance to ${finalBalance}`);
                        }
                    });
                }
            }

            this.io.to(roomId).emit('roundEnd', event);
        });
    }

    attachSocket(socket, { getPlayer, setPlayerRoom, clearPlayerRoom }) {
        const startGameLocks = new Map();

        socket.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers, category, isCasino }) => ({
            id,
            name,
            minPlayers,
            maxPlayers,
            category: category || 'other',
            isCasino: isCasino || false
        })));
        socket.emit('updateRoomList', {
            version: this.roomListVersion,
            rooms: this._serializeRooms(),
            timestamp: Date.now(),
        });
        socket.on('createGame', async (payload = {}) => {
            this.logger.debug('createGame received:', payload, 'from socket:', socket.id);
            try {
                if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                    throw new Error('Create game payload must be an object.');
                }

                const rawGameType = payload.gameType;
                if (typeof rawGameType !== 'string') {
                    throw new Error('Game type must be a non-empty string.');
                }

                const sanitizedGameType = sanitizeTextInput(rawGameType, { maxLength: 50 });
                if (!sanitizedGameType) {
                    throw new Error('Game type must be a non-empty string.');
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedGameType)) {
                    throw new Error('Game type may only contain letters, numbers, underscores, or hyphens.');
                }

                const definition = this._resolveGameDefinition(sanitizedGameType);

                const sanitizedMode = typeof payload.mode === 'string' ? payload.mode.trim().toLowerCase() : 'lan';
                const mode = sanitizedMode === 'p2p' ? 'p2p' : 'lan';

                let preferredRoomId;
                if (payload.roomCode !== undefined && payload.roomCode !== null && payload.roomCode !== '') {
                    const sanitizedRoomCode = sanitizeRoomCode(String(payload.roomCode));
                    if (!sanitizedRoomCode) {
                        throw new Error('Room code must be 3-10 characters using letters A-Z or numbers 0-9.');
                    }
                    preferredRoomId = sanitizedRoomCode;
                }

                const { minPlayers, maxPlayers } = payload;
                const player = getPlayer();
                const room = this.roomManager.createRoom({
                    hostId: socket.id,
                    gameId: definition.id,
                    mode,
                    preferredRoomId: mode === 'p2p' ? preferredRoomId : undefined,
                    playerLimits: {
                        minPlayers: minPlayers || definition.minPlayers,
                        maxPlayers: maxPlayers || definition.maxPlayers,
                    },
                    metadata: { mode },
                });
                this.logger.debug('Room created:', room.id);
                await this.roomManager.joinRoom(room.id, {
                    id: socket.id,
                    displayName: player?.username || player?.displayName || 'Player',
                    metadata: { account: player?.account || null },
                    isReady: true,
                });
                this.logger.debug('Host joined room:', room.id);
                setPlayerRoom(room.id);
                socket.join(room.id);
                socket.emit('joinedMatchLobby', { room: this._enrichRoomData(room), yourId: socket.id });
                this.io.to(room.id).emit('roomStateUpdate', this._enrichRoomData(room));
            } catch (error) {
                this.logger.error('Failed to create game:', error);
                socket.emit('error', error.message);
            }
        });

        socket.on('joinGame', async (roomIdRaw) => {
            try {
                if (typeof roomIdRaw !== 'string') {
                    throw new Error('Room code must be provided as a string.');
                }

                const sanitizedRoomId = sanitizeRoomCode(roomIdRaw);
                if (!sanitizedRoomId) {
                    throw new Error('Room code must be 3-10 characters using letters A-Z or numbers 0-9.');
                }

                const room = this.roomManager.getRoom(sanitizedRoomId);
                this.logger.debug('Player attempting to join room:', sanitizedRoomId, 'Socket ID:', socket.id);
                if (!room) {
                    throw new Error(`Room ${sanitizedRoomId} does not exist.`);
                }
                if (room.playerManager.players.size >= room.playerManager.maxPlayers) {
                    throw new Error('Room is full.');
                }
                const player = getPlayer();
                await this.roomManager.joinRoom(room.id, {
                    id: socket.id,
                    displayName: player?.username || player?.displayName || 'Guest',
                    metadata: { account: player?.account || null },
                    isReady: false,
                });
                const updatedRoom = this.roomManager.getRoom(room.id);
                this.logger.debug('Room after join:', sanitizedRoomId);
                setPlayerRoom(room.id);
                socket.join(room.id);
                const roomToUse = updatedRoom || room;
                socket.emit('joinedMatchLobby', { room: this._enrichRoomData(roomToUse), yourId: socket.id });
                this.io.to(room.id).emit('roomStateUpdate', this._enrichRoomData(roomToUse));
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('playerReady', () => {
            const player = getPlayer();
            if (!player || !player.inRoom) {
                socket.emit('error', 'Player not found or not in a room');
                return;
            }
            const playerRoomId = player.inRoom;
            try {
                const updated = this.roomManager.toggleReady(playerRoomId, socket.id);
                if (updated) {
                    const room = this.roomManager.getRoom(playerRoomId);
                    if (room) {
                        this.io.to(playerRoomId).emit('roomStateUpdate', this._enrichRoomData(room));
                    }
                }
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('startGame', async () => {
            const player = getPlayer();
            // Defensive check: ensure player exists and has a room
            if (!player || !player.inRoom) {
                socket.emit('error', 'Player not found or not in a room');
                return;
            }

            // Store room ID to avoid accessing player.inRoom after potential state changes
            const playerRoomId = player.inRoom;

            if (startGameLocks.get(playerRoomId)) {
                socket.emit('error', 'Game is already starting');
                return;
            }

            const room = this.roomManager.getRoom(playerRoomId);
            if (!room || room.hostId !== socket.id) {
                socket.emit('error', 'Only the host can start the game.');
                return;
            }

            startGameLocks.set(playerRoomId, true);

            try {
                // Check if this is a casino game and prepare balances
                const gameDefinition = this.registry.get(room.gameId);
                const isCasinoGame = gameDefinition?.isCasino || false;
                let initialBalances = {};

                if (isCasinoGame && this.profileService) {
                    // Get balances for all players in the room
                    const players = room.playerManager.list();
                    for (const p of players) {
                        // Try to get balance from profile
                        if (p.account) {
                            const balance = this.profileService.getBalance(p.account);
                            initialBalances[p.id] = balance !== null ? balance : 1000;
                        } else {
                            // Guest or no account, use default
                            initialBalances[p.id] = 1000;
                        }
                    }
                }

                this.roomManager.startGame(playerRoomId, { initialBalances });
            } catch (error) {
                socket.emit('error', error.message);
            } finally {
                setTimeout(() => {
                    startGameLocks.delete(playerRoomId);
                }, 2000);
            }
        });

        socket.on('submitMove', (commandDescriptor = {}) => {
            const player = getPlayer();
            if (!player || !player.inRoom) return;
            const playerRoomId = player.inRoom;
            try {
                this.roomManager.submitCommand(playerRoomId, { ...commandDescriptor, playerId: socket.id });
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('undoMove', () => {
            const player = getPlayer();
            if (!player || !player.inRoom) return;
            const playerRoomId = player.inRoom;
            try {
                this.roomManager.undoLast(playerRoomId, socket.id);
            } catch (error) {
                socket.emit('error', error.message);
            }
        });

        socket.on('leaveGame', () => {
            const player = getPlayer();
            if (!player || !player.inRoom) return;
            const playerRoomId = player.inRoom;
            this._leaveRoom(socket, playerRoomId, clearPlayerRoom);
        });

        socket.on('disconnect', () => {
            const player = getPlayer();
            if (player && player.inRoom) {
                const playerRoomId = player.inRoom;
                this._leaveRoom(socket, playerRoomId, clearPlayerRoom, { disconnect: true });
            }
        });
    }

    async _leaveRoom(socket, roomId, clearPlayerRoom, { disconnect = false } = {}) {
        try {
            const room = this.roomManager.getRoom(roomId);
            const wasGameActive = room?.gameInstance != null;
            const gameDefinition = room?.gameId ? this.registry.get(room.gameId) : null;
            const playersBeforeLeave = room?.playerManager.players.size || 0;

            await this.roomManager.leaveRoom(roomId, socket.id);

            // Safely handle socket.leave - socket might be disconnected
            try {
                if (socket && typeof socket.leave === 'function') {
                    socket.leave(roomId);
                }
            } catch (socketError) {
                this.logger.error('Failed to remove socket from room:', socketError);
            }

            // Safely execute clearPlayerRoom callback
            try {
                if (typeof clearPlayerRoom === 'function') {
                    clearPlayerRoom();
                }
            } catch (callbackError) {
                this.logger.error('Failed to clear player room:', callbackError);
            }

            const roomAfterLeave = this.roomManager.getRoom(roomId);
            const playersAfterLeave = roomAfterLeave?.playerManager.players.size || 0;

            if (wasGameActive && disconnect) {
                // Check if this is a 2-player game or if remaining players < minimum required
                const is2PlayerGame = gameDefinition?.maxPlayers === 2;
                const belowMinimum = gameDefinition?.minPlayers && playersAfterLeave < gameDefinition.minPlayers;

                if (is2PlayerGame || belowMinimum) {
                    // Close the room for 2-player games or if below minimum players
                    if (roomAfterLeave) {
                        this.io.to(roomId).emit('playerLeft', 'A player has disconnected. The match has ended.');

                        setTimeout(() => {
                            try {
                                this.io.to(roomId).emit('roomClosing', {
                                    roomId,
                                    reason: 'Player disconnected',
                                    secondsRemaining: 3,
                                });

                                setTimeout(() => {
                                    try {
                                        this.io.to(roomId).emit('roomClosed', { roomId, reason: 'Player disconnected' });
                                        this.roomManager.deleteRoom(roomId);
                                    } catch (innerError) {
                                        this.logger.error('Failed to close room in timeout:', innerError);
                                    }
                                }, 3000);
                            } catch (outerError) {
                                this.logger.error('Failed to emit room closing:', outerError);
                            }
                        }, 1000);
                    }
                } else {
                    // For multi-player games (3+ players), just notify and continue
                    if (roomAfterLeave) {
                        this.io.to(roomId).emit('playerLeft', 'A player has exited the game.');
                        this.io.to(roomId).emit('roomStateUpdate', this._enrichRoomData(roomAfterLeave));
                    }
                }
            } else if (roomAfterLeave) {
                this.io.to(roomId).emit('roomStateUpdate', this._enrichRoomData(roomAfterLeave));
                if (disconnect) {
                    this.io.to(roomId).emit('playerLeft', 'A player has disconnected.');
                }
            }
        } catch (error) {
            this.logger.error('Failed to leave room:', error);
        }
    }

    _enrichRoomData(room) {
        const roomData = room.toJSON();
        const gameDefinition = this.registry.get(room.gameId);
        const isCasinoGame = gameDefinition?.isCasino || false;

        roomData.isCasino = isCasinoGame;
        roomData.gameType = room.gameId;

        // Add balances to players if it's a casino game
        if (isCasinoGame && this.profileService && roomData.players) {
            roomData.players.forEach(player => {
                const username = player.metadata?.username || player.displayName;
                if (username) {
                    const balance = this.profileService.getBalance(username);
                    player.balance = balance !== null ? balance : 1000;
                } else {
                    player.balance = 1000; // Default for guests
                }
            });
        }

        return roomData;
    }

    notifyRoomUpdate(roomId) {
        const room = this.roomManager.getRoom(roomId);
        if (!room) {
            return;
        }
        this.io.to(roomId).emit('roomStateUpdate', this._enrichRoomData(room));
        this.io.emit('updateRoomList', this._serializeRooms());
    }

    _wirePluginEvents() {
        const broadcast = () => {
            this.io.emit('availableGames', this.registry.list().map(({ id, name, minPlayers, maxPlayers, category, isCasino }) => ({
                id,
                name,
                minPlayers,
                maxPlayers,
                category: category || 'other',
                isCasino: isCasino || false
            })));
        };
        this.pluginManager.on('pluginLoaded', broadcast);
        this.pluginManager.on('pluginUnloaded', broadcast);
        this.registry.on('updated', broadcast);
    }

    _serializeRooms() {
        const summary = {};
        for (const room of this.roomManager.rooms.values()) {
            if (room.playerManager.players.size < room.playerManager.maxPlayers) {
                summary[room.id] = {
                    roomId: room.id,
                    gameType: room.gameId,
                    mode: room.metadata.mode,
                    playerCount: room.playerManager.players.size,
                    maxPlayers: room.playerManager.maxPlayers,
                    hostId: room.hostId,
                };
            }
        }
        return summary;
    }

    _resolveGameDefinition(gameType) {
        const available = this.registry.list();
        if (!available.length) {
            throw new Error('No games are currently available.');
        }

        if (gameType) {
            const definition = this.registry.get(gameType);
            if (!definition) {
                throw new Error('Selected game type is not available.');
            }
            return definition;
        }

        return available[0];
    }

    // Handle methods for server.js compatibility
    async handleCreateRoom(socket, gameType) {
        try {
            const definition = this._resolveGameDefinition(gameType);
            const room = this.roomManager.createRoom({
                hostId: socket.id,
                gameId: definition.id,
                mode: 'lan',
                playerLimits: {
                    minPlayers: definition.minPlayers,
                    maxPlayers: definition.maxPlayers,
                },
                metadata: { mode: 'lan' },
            });

            await this.roomManager.joinRoom(room.id, {
                id: socket.id,
                displayName: socket.username || 'Player',
                metadata: { username: socket.username },
                isReady: true,
            });

            socket.join(room.id);

            return {
                success: true,
                roomId: room.id,
                room: this._enrichRoomData(room),
            };
        } catch (error) {
            this.logger.error('handleCreateRoom failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    async handleJoinRoom(socket, roomId) {
        try {
            const room = this.roomManager.getRoom(roomId);
            if (!room) {
                throw new Error(`Room ${roomId} does not exist.`);
            }

            await this.roomManager.joinRoom(room.id, {
                id: socket.id,
                displayName: socket.username || 'Guest',
                metadata: { username: socket.username },
                isReady: false,
            });

            socket.join(room.id);

            return {
                success: true,
                roomId: room.id,
                room: this._enrichRoomData(room),
            };
        } catch (error) {
            this.logger.error('handleJoinRoom failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    async handleLeaveRoom(socket) {
        try {
            const rooms = Array.from(socket.rooms);
            for (const roomId of rooms) {
                if (roomId !== socket.id) {
                    const room = this.roomManager.getRoom(roomId);
                    if (room) {
                        await this.roomManager.leaveRoom(roomId, socket.id);
                        socket.leave(roomId);
                    }
                }
            }

            return { success: true };
        } catch (error) {
            this.logger.error('handleLeaveRoom failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    handlePlayerReady(socket) {
        try {
            const rooms = Array.from(socket.rooms);
            for (const roomId of rooms) {
                if (roomId !== socket.id) {
                    const room = this.roomManager.getRoom(roomId);
                    if (room) {
                        room.playerManager.setReady(socket.id, true);
                        this.io.to(roomId).emit('roomStateUpdate', this._enrichRoomData(room));
                    }
                }
            }

            return { success: true };
        } catch (error) {
            this.logger.error('handlePlayerReady failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    handleStartGame(socket) {
        try {
            const rooms = Array.from(socket.rooms);
            for (const roomId of rooms) {
                if (roomId !== socket.id) {
                    const room = this.roomManager.getRoom(roomId);
                    if (room && room.hostId === socket.id) {
                        // Check if this is a casino game and prepare balances
                        const gameDefinition = this.registry.get(room.gameId);
                        const isCasinoGame = gameDefinition?.isCasino || false;
                        let initialBalances = {};

                        if (isCasinoGame && this.profileService) {
                            const players = room.playerManager.list();
                            for (const p of players) {
                                const username = p.metadata?.username || p.displayName;
                                if (username) {
                                    const balance = this.profileService.getBalance(username);
                                    initialBalances[p.id] = balance !== null ? balance : 1000;
                                } else {
                                    initialBalances[p.id] = 1000;
                                }
                            }
                        }

                        this.roomManager.startGame(roomId, { initialBalances });
                        return { success: true };
                    }
                }
            }

            return {
                success: false,
                error: 'Room not found or you are not the host',
            };
        } catch (error) {
            this.logger.error('handleStartGame failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    handleGameAction(socket, action) {
        try {
            const rooms = Array.from(socket.rooms);
            for (const roomId of rooms) {
                if (roomId !== socket.id) {
                    this.roomManager.submitCommand(roomId, { ...action, playerId: socket.id });
                    return { success: true };
                }
            }

            return {
                success: false,
                error: 'Not in a game room',
            };
        } catch (error) {
            this.logger.error('handleGameAction failed:', error);
            return {
                success: false,
                error: error.message,
            };
        }
    }
}

function createModularGameServer(options) {
    const server = new ModularGameServer(options);
    return server;
}

module.exports = {
    createModularGameServer,
};
