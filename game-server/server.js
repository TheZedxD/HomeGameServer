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
        created: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
      this.save();
    } else {
      // Update last seen
      const user = this.users.get(cleanUsername);
      user.lastSeen = new Date().toISOString();
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
}

const userStore = new UserStore();

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
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

// Initialize game server
modularGameServer = createModularGameServer({
  io: io,
  logger: console
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

      console.log(`[Socket] User identified: ${socket.username} (${socket.id})`);

      socket.emit('identified', {
        username: user.username,
        stats: {
          wins: user.wins,
          losses: user.losses,
          gamesPlayed: user.gamesPlayed
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
        gamesPlayed: user.gamesPlayed
      });
    } catch (error) {
      emitSocketError({ socket, action: 'getUserStats', error });
    }
  });

  // Create room
  socket.on('createRoom', ({ gameType, username }) => {
    try {
      if (!socket.username) {
        socket.username = userStore.sanitizeUsername(username);
      }

      const result = modularGameServer.handleCreateRoom(socket, gameType);

      if (result.success) {
        console.log(`[Socket] Room created: ${result.roomId} by ${socket.username}`);
        emitOpenRoomsUpdate();
        socket.emit('roomCreated', result);
      } else {
        socket.emit('error', { message: result.error, code: 'CREATE_ROOM_FAILED' });
      }
    } catch (error) {
      emitSocketError({ socket, action: 'createRoom', error });
    }
  });

  // Join room
  socket.on('joinRoom', ({ roomId, username }) => {
    try {
      if (!socket.username) {
        socket.username = userStore.sanitizeUsername(username);
      }

      const result = modularGameServer.handleJoinRoom(socket, roomId);

      if (result.success) {
        console.log(`[Socket] User ${socket.username} joined room: ${roomId}`);
        emitOpenRoomsUpdate();
        socket.emit('roomJoined', result);
      } else {
        socket.emit('error', { message: result.error, code: 'JOIN_ROOM_FAILED' });
      }
    } catch (error) {
      emitSocketError({ socket, action: 'joinRoom', error });
    }
  });

  // Leave room
  socket.on('leaveRoom', () => {
    try {
      const result = modularGameServer.handleLeaveRoom(socket);

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

  // Game action
  socket.on('gameAction', (action) => {
    try {
      modularGameServer.handleGameAction(socket, action);
    } catch (error) {
      emitSocketError({ socket, action: 'gameAction', error });
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
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id} (${socket.username || 'unknown'})`);

    try {
      modularGameServer.handleLeaveRoom(socket);
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
  server.listen(PORT, () => {
    console.log('\n' + '='.repeat(80));
    console.log('  HomeGameServer - Local Multiplayer Server');
    console.log('='.repeat(80));
    console.log(`  Environment: ${NODE_ENV}`);
    console.log(`  Server: http://localhost:${PORT}`);
    console.log(`  Status: Ready for connections`);
    console.log('='.repeat(80) + '\n');

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

    console.log(`  Local: http://localhost:${PORT}`);
    console.log(`  Network: http://${localIp}:${PORT}`);
    console.log('');
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
