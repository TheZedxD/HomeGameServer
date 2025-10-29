# HomeGameServer API Documentation

## Overview

HomeGameServer provides a real-time, server-authoritative game server with WebSocket communication via Socket.IO.

**Protocol Version:** 1.0.0
**Tick Rate:** 20-30 Hz (configurable)
**Snapshot Rate:** 5-30 Hz (configurable)

---

## Socket.IO Events

All events follow a versioned, schema-validated format for security and compatibility.

### Message Format

```javascript
{
  version: "1.0.0",        // Protocol version
  seq: 123,                // Optional sequence number for replay protection
  payload: {               // Event-specific data
    // ...
  }
}
```

---

## Client ’ Server Events

### 1. createGame

Create a new game room.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 1,                  // Optional
  payload: {
    gameType: "tictactoe", // Game identifier
    mode: "lan",           // "lan" or "p2p"
    roomCode: "ABC123",    // Optional 6-char code
    minPlayers: 2,         // Optional
    maxPlayers: 2,         // Optional
    options: {}            // Game-specific options
  }
}
```

**Response:** `joinedMatchLobby` with room details

**Errors:**
- `INVALID_GAME_TYPE`: Unknown game
- `ROOM_CODE_EXISTS`: Code already in use
- `VALIDATION_ERROR`: Invalid payload

---

### 2. joinGame

Join an existing room.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 2,
  payload: {
    roomCode: "ABC123",    // Required 6-char code
    password: "secret"     // Optional
  }
}
```

**Response:** `joinedMatchLobby`

**Errors:**
- `ROOM_NOT_FOUND`: Invalid room code
- `ROOM_FULL`: Maximum players reached
- `ROOM_STARTED`: Game already in progress
- `INVALID_PASSWORD`: Wrong password

---

### 3. playerReady

Toggle ready state in lobby.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 3,
  payload: {
    ready: true            // Optional, toggles if omitted
  }
}
```

**Response:** `roomStateUpdate`

---

### 4. startGame

Host starts the game (host only).

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 4,
  payload: {
    forceStart: false      // Optional, override ready checks
  }
}
```

**Response:** `gameStart` with initial state

**Errors:**
- `NOT_HOST`: Only host can start
- `NOT_ALL_READY`: Players not ready
- `INSUFFICIENT_PLAYERS`: Below minimum

---

### 5. submitMove

Submit a game action.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 5,
  payload: {
    type: "placeMark",     // Command type
    data: {                // Command-specific
      row: 0,
      col: 1
    },
    timestamp: 1234567890  // Optional client timestamp
  }
}
```

**Response:** `gameStateUpdate` (delta) or `gameStateSnapshot` (full)

**Errors:**
- `INVALID_MOVE`: Move not allowed
- `OUT_OF_TURN`: Not player's turn
- `INVALID_COMMAND`: Unknown command type
- `VALIDATION_ERROR`: Invalid command data

---

### 6. undoMove

Undo last action (if enabled).

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 6,
  payload: {
    confirm: true
  }
}
```

**Response:** `gameStateUpdate`

**Errors:**
- `UNDO_DISABLED`: Feature not enabled
- `NO_MOVES_TO_UNDO`: Nothing to undo

---

### 7. leaveGame

Leave the current room.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 7,
  payload: {
    reason: "User requested" // Optional
  }
}
```

**Response:** `roomClosed` or `playerLeft`

---

### 8. ping

Measure latency.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 8,
  payload: {
    clientTime: 1234567890 // Client timestamp in ms
  }
}
```

**Response:** `pong` with server time

---

### 9. requestSync

Request full state resync.

**Schema:**
```javascript
{
  version: "1.0.0",
  seq: 9,
  payload: {
    reason: "desync"       // "desync", "reconnect", "manual"
  }
}
```

**Response:** `gameStateSnapshot`

---

## Server ’ Client Events

### 1. gameStateUpdate (Delta)

Incremental state change broadcast every tick.

**Schema:**
```javascript
{
  version: "1.0.0",
  type: "delta",
  serverTime: 1234567890,
  tick: 1523,
  delta: {
    changes: [
      {
        path: "board.0.1",      // JSON path
        value: "X",             // New value
        operation: "set"        // "set", "delete", "push", "splice"
      }
    ]
  },
  checksum: "abc123"            // Optional state hash
}
```

---

### 2. gameStateSnapshot (Full)

Complete game state broadcast (every SNAPSHOT_RATE).

**Schema:**
```javascript
{
  version: "1.0.0",
  type: "snapshot",
  serverTime: 1234567890,
  tick: 1523,
  state: {
    // Full game state object
    board: [["X", null, null], ...],
    currentPlayerId: "player-1",
    turn: "X",
    // ...
  },
  checksum: "abc123"
}
```

---

### 3. roomStateUpdate

Lobby/room metadata changes.

**Schema:**
```javascript
{
  version: "1.0.0",
  roomCode: "ABC123",
  state: {
    players: [
      {
        id: "player-1",
        displayName: "Alice",
        isReady: true,
        isHost: true,
        avatarPath: "/avatars/player-1.webp"
      }
    ],
    gameType: "tictactoe",
    status: "waiting",           // "waiting", "ready", "playing", "paused", "ended"
    minPlayers: 2,
    maxPlayers: 2
  }
}
```

---

### 4. error

Error notification.

**Schema:**
```javascript
{
  version: "1.0.0",
  error: {
    code: "ROOM_FULL",
    message: "Room has reached maximum capacity",
    details: {
      maxPlayers: 4,
      currentPlayers: 4
    },
    retryable: false
  }
}
```

**Common Error Codes:**
- `VALIDATION_ERROR`: Invalid message format
- `ROOM_NOT_FOUND`: Room doesn't exist
- `ROOM_FULL`: Max players reached
- `NOT_HOST`: Action requires host privileges
- `INVALID_MOVE`: Move not allowed by game rules
- `OUT_OF_TURN`: Not player's turn
- `RATE_LIMIT`: Too many requests
- `SERVER_ERROR`: Internal server error

---

### 5. pong

Latency measurement response.

**Schema:**
```javascript
{
  version: "1.0.0",
  clientTime: 1234567890,      // Echoed from ping
  serverTime: 1234567950       // Server timestamp
}
```

**Calculate latency:** `(Date.now() - clientTime) / 2`

---

## REST API Endpoints

### Health & Monitoring

#### GET /healthz

Basic health check (fast, no auth required).

**Response:**
```json
{
  "status": "healthy",
  "uptime": 12345,
  "timestamp": 1234567890
}
```

**Status Codes:**
- `200`: Healthy
- `503`: Unhealthy

---

#### GET /health

Detailed health check with component status.

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "memory": {
      "healthy": true,
      "message": "Heap usage: 45.2%",
      "timestamp": 1234567890
    },
    "uptime": {
      "healthy": true,
      "message": "Uptime: 12345s",
      "timestamp": 1234567890
    }
  },
  "timestamp": 1234567890
}
```

---

#### GET /metrics

Prometheus-compatible metrics (requires `METRICS_TOKEN`).

**Headers:**
```
Authorization: Bearer <METRICS_TOKEN>
```

**Response:** (text/plain; Prometheus format)
```
# HELP http_requests_total Total count of http requests total
# TYPE http_requests_total counter
http_requests_total 1523

# HELP rooms_active Current value of rooms active
# TYPE rooms_active gauge
rooms_active 12

# HELP tick_duration_ms Distribution of tick duration ms
# TYPE tick_duration_ms histogram
tick_duration_ms_bucket{le="1"} 1200
tick_duration_ms_bucket{le="5"} 1450
tick_duration_ms_bucket{le="10"} 1500
tick_duration_ms_sum 7523.5
tick_duration_ms_count 1500
```

**Key Metrics:**
- `http_requests_total`: Total HTTP requests
- `socket_connections_total`: Total WebSocket connections
- `rooms_active`: Current active rooms
- `players_active`: Current active players
- `tick_duration_ms`: Tick loop performance
- `game_moves_total`: Total game actions processed
- `rate_limit_hits_total`: Rate limit violations
- `memory_usage_bytes`: Process memory usage

---

### Network Information

#### GET /api/network-info

Get server network information.

**Response:**
```json
{
  "port": 8081,
  "addresses": ["192.168.1.100", "10.0.0.50"],
  "protocol": "http"
}
```

---

## Rate Limits

### HTTP Endpoints
- **Write operations:** 300 requests/minute per IP
- **Auth endpoints:** 10 attempts/5 minutes per IP

### Socket.IO
- **Events:** 80 events/second per socket
- **Connections:** 120 connections/minute per IP
- **Burst:** 10 events allowed before rate limiting kicks in

**Response on rate limit:**
```javascript
{
  version: "1.0.0",
  error: {
    code: "RATE_LIMIT",
    message: "Too many requests",
    details: {
      limit: 80,
      window: "1s",
      retryAfter: 500
    },
    retryable: true
  }
}
```

---

## Sequence Numbers & Replay Protection

Enable with `ENABLE_SEQUENCE_VALIDATION=true`.

**Client Implementation:**
```javascript
let sequenceNumber = 0;

socket.emit('submitMove', {
  version: '1.0.0',
  seq: ++sequenceNumber,
  payload: { /* ... */ }
});
```

**Server Behavior:**
- Accepts messages within `MAX_SEQUENCE_DRIFT` (default: 100)
- Rejects duplicate or out-of-order messages
- Sequence resets on disconnect

---

## Error Handling

### Client-Side Pattern
```javascript
socket.on('error', (errorEvent) => {
  console.error(`[${errorEvent.error.code}] ${errorEvent.error.message}`);

  if (errorEvent.error.retryable) {
    // Retry after delay
    setTimeout(() => retry(), errorEvent.error.details?.retryAfter || 1000);
  } else {
    // Show error to user
    showError(errorEvent.error.message);
  }
});
```

---

## Examples

### Creating and Joining a Game

**Client 1 (Host):**
```javascript
socket.emit('createGame', {
  version: '1.0.0',
  payload: {
    gameType: 'tictactoe',
    mode: 'lan',
    minPlayers: 2,
    maxPlayers: 2
  }
});

socket.on('joinedMatchLobby', (data) => {
  console.log('Room created:', data.roomCode);
});
```

**Client 2 (Joiner):**
```javascript
socket.emit('joinGame', {
  version: '1.0.0',
  payload: {
    roomCode: 'ABC123'
  }
});
```

### Playing a Move
```javascript
socket.emit('submitMove', {
  version: '1.0.0',
  seq: ++sequenceNumber,
  payload: {
    type: 'placeMark',
    data: { row: 1, col: 1 }
  }
});

socket.on('gameStateUpdate', (update) => {
  // Apply delta to local state
  applyDelta(gameState, update.delta);
});

socket.on('gameStateSnapshot', (snapshot) => {
  // Replace local state entirely
  gameState = snapshot.state;
});
```

### Measuring Latency
```javascript
const clientTime = Date.now();

socket.emit('ping', {
  version: '1.0.0',
  payload: { clientTime }
});

socket.on('pong', (pong) => {
  const latency = (Date.now() - pong.clientTime) / 2;
  console.log(`Latency: ${latency}ms`);
});
```

---

## Security Best Practices

1. **Always validate message versions** before processing
2. **Implement sequence numbers** for critical game actions
3. **Use checksums** to detect state desync
4. **Handle rate limits gracefully** with exponential backoff
5. **Never trust client timestamps** - use server time for game logic
6. **Sanitize all user input** - display names, messages, etc.
7. **Use HTTPS/WSS in production**
8. **Configure CORS origin whitelist** - never use `*` in production

---

## Performance Targets

- **Tick rate:** 20-30 Hz
- **Tick duration p95:** < 10ms under 200 clients
- **Latency:** < 100ms within local network
- **Memory:** Stable under continuous load
- **CPU:** < 50% under 200 concurrent players

---

For implementation details, see the source code in `game-server/src/`.
