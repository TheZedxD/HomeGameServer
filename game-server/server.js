// ============================================================================
// HomeGameServer - Simplified Local Multiplayer Server
// ============================================================================
// A lightweight, local-first game server for home/LAN gaming
// No authentication, no profiles - just pick a username and play!

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { createModularGameServer } = require('./src/server/gameGateway');
const { metricsCollector } = require('./src/monitoring/metrics');

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 8081;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// ============================================================================
// Global Error Handlers
// ============================================================================

// Handle unhandled promise rejections to prevent silent failures
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Promise Rejection:', reason);
  console.error('[Process] Promise:', promise);
  // Log but don't crash in production - let the app continue running
  if (!IS_PRODUCTION) {
    console.error('[Process] Stack:', reason?.stack || 'No stack trace available');
  }
});

// Handle uncaught exceptions - these are critical and should trigger shutdown
process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught Exception:', error);
  console.error('[Process] Stack:', error.stack);
  // Uncaught exceptions are serious - attempt graceful shutdown
  console.error('[Process] Attempting graceful shutdown due to uncaught exception...');
  process.exit(1);
});

// ============================================================================
// Simple Username Storage
// ============================================================================

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Simple in-memory user storage with file persistence
class UserStore {
  constructor() {
    this.users = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        this.users = new Map(Object.entries(data));
        console.log(`[UserStore] Loaded ${this.users.size} users`);
      }
    } catch (error) {
      console.error('[UserStore] Error loading users:', error);
      this.users = new Map();
    }
  }

  save() {
    try {
      const data = Object.fromEntries(this.users);
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[UserStore] Error saving users:', error);
    }
  }

  getOrCreate(username) {
    const cleanUsername = this.sanitizeUsername(username);

    if (!this.users.has(cleanUsername)) {
      this.users.set(cleanUsername, {
        username: cleanUsername,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        credits: 10000, // Starting credits for new users
        created: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
      this.save();
    } else {
      // Update last seen
      const user = this.users.get(cleanUsername);
      user.lastSeen = new Date().toISOString();
      // Ensure credits field exists for legacy users
      if (typeof user.credits !== 'number') {
        user.credits = 10000;
      }
      this.save();
    }

    return this.users.get(cleanUsername);
  }

  updateStats(username, result) {
    const user = this.getOrCreate(username);
    user.gamesPlayed++;

    if (result === 'win') {
      user.wins++;
    } else if (result === 'loss') {
      user.losses++;
    }

    this.save();
    return user;
  }

  sanitizeUsername(username) {
    if (!username || typeof username !== 'string') {
      return 'Guest' + Math.random().toString(36).substring(2, 8);
    }

    // Remove special characters, limit length
    return username
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .substring(0, 24) || 'Guest' + Math.random().toString(36).substring(2, 8);
  }

  // Credit management methods for ProfileService compatibility
  getBalance(username) {
    const user = this.getOrCreate(username);
    return user.credits;
  }

  updateBalance(username, newBalance) {
    const user = this.getOrCreate(username);
    user.credits = Math.max(0, newBalance); // Ensure credits never go negative
    this.save();
    return user.credits;
  }

  addCredits(username, amount) {
    const user = this.getOrCreate(username);
    user.credits = (user.credits || 0) + amount;
    this.save();
    return user.credits;
  }

  deductCredits(username, amount) {
    const user = this.getOrCreate(username);
    user.credits = Math.max(0, (user.credits || 0) - amount);
    this.save();
    return user.credits;
  }
}

const userStore = new UserStore();

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
const server = http.createServer(app);
// CORS Configuration: Allow all origins for local/LAN gaming
// This is safe because this server is designed for local home/LAN use only
// Set CORS_ORIGIN env var to restrict if needed (e.g., 'http://192.168.1.100:8081')
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// API Routes
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Network info
app.get('/api/network-info', (req, res) => {
  const networkInterfaces = require('os').networkInterfaces();
  let localIp = '127.0.0.1';

  // Find first non-internal IPv4 address
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
    if (localIp !== '127.0.0.1') break;
  }

  res.json({
    ip: localIp,
    port: PORT,
    hostname: require('os').hostname()
  });
});

// Get user stats
app.get('/api/user/:username', (req, res) => {
  const user = userStore.getOrCreate(req.params.username);
  res.json(user);
});

// Update user stats
app.post('/api/user/:username/stats', (req, res) => {
  const { result } = req.body;
  const user = userStore.updateStats(req.params.username, result);
  res.json(user);
});

// Get available games
app.get('/api/games', (req, res) => {
  res.json({
    games: [
      { id: 'checkers', name: 'Checkers', players: 2, type: 'board' },
      { id: 'war', name: 'War', players: 2, type: 'card' },
      { id: 'hearts', name: 'Hearts', players: 4, type: 'card' },
      { id: 'blackjack', name: 'Blackjack', players: [1, 6], type: 'casino' },
      { id: 'texas-holdem', name: 'Texas Hold\'em', players: [2, 8], type: 'casino' },
      { id: '5-card-stud', name: '5 Card Stud', players: [2, 8], type: 'casino' },
      { id: 'baccarat', name: 'Baccarat', players: [1, 6], type: 'casino' },
      { id: 'tictactoe', name: 'Tic Tac Toe', players: 2, type: 'board' },
      { id: 'capture-the-flag', name: 'Capture the Flag', players: 2, type: 'board' }
    ]
  });
});

// Metrics endpoint (optional)
app.get('/metrics', (req, res) => {
  const metrics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    users: userStore.users.size,
    timestamp: new Date().toISOString()
  };

  res.json(metrics);
});

// ============================================================================
// Game Server Setup
// ============================================================================

let modularGameServer = null;

// Initialize game server with userStore as profileService
modularGameServer = createModularGameServer({
  io: io,
  logger: console,
  profileService: userStore
});

// Room list update broadcaster
const emitOpenRoomsUpdate = () => {
  if (!modularGameServer) return;

  const rooms = modularGameServer._serializeRooms();
  const payload = {
    version: modularGameServer.roomListVersion || 1,
    rooms: rooms,
    timestamp: Date.now()
  };

  console.log(`[Server] Broadcasting room list update. Rooms: ${Object.keys(rooms).length}`);
  io.emit('updateRoomList', payload);
};

// Error handler for socket events
function emitSocketError({ socket, action, error, message = 'Operation failed', code = 'ERROR' }) {
  console.error(`[Socket] ${action} failed:`, error?.message || error);

  if (metricsCollector?.recordError) {
    metricsCollector.recordError(error, { action, transport: 'socket.io' });
  }

  if (socket?.connected) {
    socket.emit('error', { message, code, action });
  }
}

// ============================================================================
// Socket.IO Event Handlers
// ============================================================================

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Store username on socket
  socket.username = null;

  // User identification
  socket.on('identify', ({ username }) => {
    try {
      const user = userStore.getOrCreate(username);
      socket.username = user.username;

      console.log(`[Socket] User identified: ${socket.username} (${socket.id}) - Credits: ${user.credits}`);

      socket.emit('identified', {
        username: user.username,
        stats: {
          wins: user.wins,
          losses: user.losses,
          gamesPlayed: user.gamesPlayed,
          credits: user.credits
        }
      });
    } catch (error) {
      emitSocketError({ socket, action: 'identify', error });
    }
  });

  // Get user stats
  socket.on('getUserStats', ({ username }) => {
    try {
      const user = userStore.getOrCreate(username);
      socket.emit('userStats', {
        username: user.username,
        wins: user.wins,
        losses: user.losses,
        gamesPlayed: user.gamesPlayed,
        credits: user.credits
      });
    } catch (error) {
      emitSocketError({ socket, action: 'getUserStats', error });
    }
  });

  // Create room
  socket.on('createRoom', async ({ gameType, username }) => {
    try {
      if (!socket.username) {
        socket.username = userStore.sanitizeUsername(username);
      }

      const result = await modularGameServer.handleCreateRoom(socket, gameType);

      if (result.success) {
        console.log(`[Socket] Room created: ${result.roomId} by ${socket.username}`);
        emitOpenRoomsUpdate();
        // Emit the correct event that client expects
        socket.emit('joinedMatchLobby', { room: result.room, yourId: socket.id });
        // Also emit room state update to all players in the room
        io.to(result.roomId).emit('roomStateUpdate', result.room);
      } else {
        socket.emit('error', { message: result.error, code: 'CREATE_ROOM_FAILED' });
      }
    } catch (error) {
      emitSocketError({ socket, action: 'createRoom', error });
    }
  });

  // Join room
  socket.on('joinRoom', async ({ roomId, username }) => {
    try {
      if (!socket.username) {
        socket.username = userStore.sanitizeUsername(username);
      }

      const result = await modularGameServer.handleJoinRoom(socket, roomId);

      if (result.success) {
        console.log(`[Socket] User ${socket.username} joined room: ${roomId}`);
        emitOpenRoomsUpdate();
        // Emit the correct event that client expects
        socket.emit('joinedMatchLobby', { room: result.room, yourId: socket.id });
        // Also emit room state update to all players in the room
        io.to(result.roomId).emit('roomStateUpdate', result.room);
      } else {
        socket.emit('error', { message: result.error, code: 'JOIN_ROOM_FAILED' });
      }
    } catch (error) {
      emitSocketError({ socket, action: 'joinRoom', error });
    }
  });

  // Leave room
  socket.on('leaveRoom', async () => {
    try {
      const result = await modularGameServer.handleLeaveRoom(socket);

      if (result.success) {
        console.log(`[Socket] User ${socket.username} left room`);
        emitOpenRoomsUpdate();
        socket.emit('roomLeft', result);
      }
    } catch (error) {
      emitSocketError({ socket, action: 'leaveRoom', error });
    }
  });

  // Player ready
  socket.on('playerReady', () => {
    try {
      const result = modularGameServer.handlePlayerReady(socket);

      if (result.success) {
        console.log(`[Socket] Player ${socket.username} is ready`);
      }
    } catch (error) {
      emitSocketError({ socket, action: 'playerReady', error });
    }
  });

  // Start game
  socket.on('startGame', () => {
    try {
      const result = modularGameServer.handleStartGame(socket);

      if (result.success) {
        console.log(`[Socket] Game started in room`);
      } else {
        socket.emit('error', { message: result.error, code: 'START_GAME_FAILED' });
      }
    } catch (error) {
      emitSocketError({ socket, action: 'startGame', error });
    }
  });

  // Game action (legacy support)
  socket.on('gameAction', (action) => {
    try {
      modularGameServer.handleGameAction(socket, action);
    } catch (error) {
      emitSocketError({ socket, action: 'gameAction', error });
    }
  });

  // Submit move (modern event handler)
  socket.on('submitMove', (commandDescriptor) => {
    try {
      const rooms = Array.from(socket.rooms);
      for (const roomId of rooms) {
        if (roomId !== socket.id) {
          const room = modularGameServer.roomManager.getRoom(roomId);
          if (room && room.gameInstance) {
            console.log(`[Socket] Player ${socket.username} (${socket.id}) submitting move in room ${roomId}`);
            modularGameServer.roomManager.submitCommand(roomId, {
              ...commandDescriptor,
              playerId: socket.id
            });
            return;
          }
        }
      }
      socket.emit('error', { message: 'Not in an active game', code: 'NOT_IN_GAME' });
    } catch (error) {
      console.error('[Socket] submitMove error:', error);
      emitSocketError({ socket, action: 'submitMove', error, message: error.message || 'Move failed' });
    }
  });

  // Get room list
  socket.on('getRoomList', () => {
    try {
      const rooms = modularGameServer._serializeRooms();
      socket.emit('updateRoomList', {
        version: modularGameServer.roomListVersion || 1,
        rooms: rooms,
        timestamp: Date.now()
      });
    } catch (error) {
      emitSocketError({ socket, action: 'getRoomList', error });
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`[Socket] Client disconnected: ${socket.id} (${socket.username || 'unknown'})`);

    try {
      await modularGameServer.handleLeaveRoom(socket);
      emitOpenRoomsUpdate();
    } catch (error) {
      console.error('[Socket] Error during disconnect cleanup:', error);
    }
  });
});

// ============================================================================
// Server Startup
// ============================================================================

function startServer() {
  // Explicitly bind to 0.0.0.0 to accept connections from all network interfaces (LAN access)
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(80));
    console.log('  HomeGameServer - Local Multiplayer Server');
    console.log('='.repeat(80));
    console.log(`  Environment: ${NODE_ENV}`);
    console.log(`  Status: Ready for connections`);
    console.log('='.repeat(80));

    // Get network info
    const networkInterfaces = require('os').networkInterfaces();
    let localIp = '127.0.0.1';

    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
      if (localIp !== '127.0.0.1') break;
    }

    console.log('\n  📱 CONNECTION URLS:');
    console.log('  ─────────────────────────────────────────────────────');
    console.log(`  On this computer:   http://localhost:${PORT}`);
    console.log(`  On your phone/tablet: http://${localIp}:${PORT}`);
    console.log('  ─────────────────────────────────────────────────────');
    console.log('\n  💡 TIP: Make sure your phone is on the same WiFi network!');
    console.log('='.repeat(80) + '\n');
  });
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n[Server] Shutting down gracefully...');

  // Save user data
  userStore.save();

  // Close server
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force close after 5 seconds
  setTimeout(() => {
    console.error('[Server] Forcing shutdown...');
    process.exit(1);
  }, 5000);
}

// Start the server
startServer();

module.exports = { app, server, io, userStore };
