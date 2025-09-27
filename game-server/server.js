// SERVER.JS
// Extended server implementation that now supports authentication, profile
// persistence, avatar uploads, and improved lobby/game management.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, 'data');
const USER_DATA_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads/profiles');
const SESSION_COOKIE_NAME = 'homegame.sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2 MB

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
initializeUserStore();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessions = new Map();
let players = {};
let rooms = {};
const MAX_PLAYERS_PER_ROOM = 2;

app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie || '');
    const sessionId = req.cookies[SESSION_COOKIE_NAME];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (Date.now() - session.createdAt > SESSION_TTL_MS) {
            sessions.delete(sessionId);
        } else {
            session.lastAccess = Date.now();
            req.session = session;
            const userRecord = getUserRecord(session.username);
            if (userRecord) {
                req.user = {
                    username: userRecord.username,
                    displayName: userRecord.displayName || userRecord.username,
                    wins: userRecord.wins || 0,
                    avatarPath: userRecord.avatarPath || null
                };
            }
        }
    }
    next();
});

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.get('/', (req, res) => {
    if (!req.user) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/login', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/signup', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public/signup.html'));
});

app.post('/signup', (req, res) => {
    const rawUsername = req.body.username || '';
    const rawDisplayName = req.body.displayName || rawUsername;
    const password = req.body.password || '';

    const username = sanitizeAccountName(rawUsername);
    const displayName = sanitizeDisplayName(rawDisplayName);

    if (!username) {
        return res.status(400).send('Username is required and may only contain letters, numbers, underscores, and hyphens.');
    }
    if (password.length < 6) {
        return res.status(400).send('Password must be at least 6 characters long.');
    }

    const store = readUserStore();
    const key = username.toLowerCase();
    if (store.users[key]) {
        return res.status(409).send('That username is already taken.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    store.users[key] = {
        username,
        displayName,
        passwordHash,
        salt,
        wins: 0,
        avatarPath: null
    };
    writeUserStore(store);

    issueSession(res, key);
    res.redirect('/');
});

app.post('/login', (req, res) => {
    const rawUsername = req.body.username || '';
    const password = req.body.password || '';
    const username = sanitizeAccountName(rawUsername);
    if (!username) {
        return res.status(400).send('Enter a valid username.');
    }

    const userRecord = getUserRecord(username.toLowerCase());
    if (!userRecord) {
        return res.status(401).send('Invalid username or password.');
    }

    const hash = hashPassword(password, userRecord.salt);
    if (hash !== userRecord.passwordHash) {
        return res.status(401).send('Invalid username or password.');
    }

    issueSession(res, username.toLowerCase());
    res.redirect('/');
});

app.post('/logout', (req, res) => {
    const sessionId = req.cookies[SESSION_COOKIE_NAME];
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.status(204).end();
});

app.get('/api/session', (req, res) => {
    if (!req.user) {
        return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: req.user });
});

app.get('/api/profile', requireAuth, (req, res) => {
    const userRecord = getUserRecord(req.session.username);
    if (!userRecord) {
        return res.status(404).json({ error: 'Profile not found.' });
    }
    res.json({
        username: userRecord.username,
        displayName: userRecord.displayName || userRecord.username,
        wins: userRecord.wins || 0,
        avatarPath: userRecord.avatarPath || null
    });
});

app.post('/api/profile', requireAuth, (req, res) => {
    const displayName = sanitizeDisplayName(req.body.displayName || '');
    const wins = Number.isFinite(Number(req.body.wins)) ? Math.max(0, Number(req.body.wins)) : undefined;
    const store = readUserStore();
    const userKey = req.session.username;
    const userRecord = store.users[userKey];
    if (!userRecord) {
        return res.status(404).json({ error: 'Profile not found.' });
    }

    if (displayName) {
        userRecord.displayName = displayName;
    }
    if (wins !== undefined) {
        userRecord.wins = wins;
    }
    writeUserStore(store);

    const updated = getUserRecord(userKey);
    res.json({
        username: updated.username,
        displayName: updated.displayName || updated.username,
        wins: updated.wins || 0,
        avatarPath: updated.avatarPath || null
    });
});

app.post('/api/profile/avatar', requireAuth, (req, res) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
        return res.status(400).json({ error: 'Invalid upload request.' });
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
        return res.status(400).json({ error: 'Upload boundary not found.' });
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk) => {
        if (aborted) return;
        total += chunk.length;
        if (total > MAX_UPLOAD_SIZE) {
            aborted = true;
            res.status(413).json({ error: 'File is too large. Maximum size is 2MB.' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });

    req.on('end', () => {
        if (aborted) return;
        try {
            const buffer = Buffer.concat(chunks);
            const fileInfo = extractMultipartFile(buffer, boundary);
            if (!fileInfo || !fileInfo.buffer.length) {
                return res.status(400).json({ error: 'No file provided.' });
            }

            const timestamp = Date.now();
            const safeBaseName = req.user.username.replace(/[^a-zA-Z0-9_-]/g, '');
            const finalName = `${safeBaseName || 'avatar'}-${timestamp}${fileInfo.extension}`;
            const finalPath = path.join(UPLOAD_DIR, finalName);
            fs.writeFileSync(finalPath, fileInfo.buffer);

            updateUserAvatar(req.session.username, `/uploads/profiles/${finalName}`);
            res.json({ avatarPath: `/uploads/profiles/${finalName}` });
        } catch (error) {
            console.error('Avatar upload failed:', error);
            res.status(400).json({ error: 'Unable to process uploaded file.' });
        }
    });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);
    players[socket.id] = { playerId: socket.id, inRoom: null, username: null, account: null };
    socket.emit('updateRoomList', getOpenRooms());

    socket.on('linkAccount', ({ accountName, displayName }) => {
        if (!players[socket.id]) return;
        const sanitizedAccount = sanitizeAccountName(accountName || '');
        const sanitizedDisplay = sanitizeDisplayName(displayName || sanitizedAccount);
        if (sanitizedAccount) {
            players[socket.id].account = sanitizedAccount;
        }
        if (sanitizedDisplay) {
            players[socket.id].username = sanitizedDisplay;
        }
        syncPlayerInRoom(socket.id);
    });

    socket.on('setUsername', (rawName) => {
        if (!players[socket.id]) return;
        const sanitized = sanitizeDisplayName(rawName);
        players[socket.id].username = sanitized;
        syncPlayerInRoom(socket.id);
    });

    socket.on('createGame', ({ gameType = 'Checkers', mode = 'lan', roomCode }) => {
        const normalizedMode = mode || 'lan';
        const normalizedGameType = gameType || 'Checkers';
        const roomId = normalizedMode === 'p2p' && roomCode
            ? String(roomCode).toUpperCase()
            : `room_${Math.random().toString(36).substr(2, 5)}`;

        if (normalizedMode === 'p2p' && rooms[roomId]) {
            return joinRoom(socket, roomId);
        }

        rooms[roomId] = {
            roomId,
            hostId: socket.id,
            gameType: normalizedGameType,
            mode: normalizedMode,
            maxPlayers: MAX_PLAYERS_PER_ROOM,
            players: {},
            gameState: null,
            score: { red: 0, black: 0 },
            round: 1
        };

        console.log(`[${normalizedMode.toUpperCase()}] Room created: ${roomId} for ${normalizedGameType}`);
        joinRoom(socket, roomId);
    });

    socket.on('joinGame', (roomIdRaw) => {
        const raw = roomIdRaw ? String(roomIdRaw).trim() : '';
        if (!raw) {
            return socket.emit('error', 'Room does not exist.');
        }

        let roomId = raw;
        let room = rooms[roomId];

        if (!room) {
            roomId = raw.toUpperCase();
            room = rooms[roomId];
        }

        if (!room) {
            return socket.emit('error', `Room ${raw.toUpperCase()} does not exist.`);
        }

        const maxPlayers = room.maxPlayers ?? MAX_PLAYERS_PER_ROOM;
        if (Object.keys(room.players).length >= maxPlayers) {
            return socket.emit('error', 'Room is full.');
        }

        joinRoom(socket, roomId);
    });

    socket.on('playerReady', () => {
        const player = players[socket.id];
        if (!player) return;
        const roomId = player.inRoom;
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            const participant = rooms[roomId].players[socket.id];
            participant.isReady = !participant.isReady;
            console.log(`Player ${socket.id} in room ${roomId} is now ${participant.isReady ? 'READY' : 'NOT READY'}`);
            io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
        }
    });

    socket.on('leaveGame', () => {
        handlePlayerDeparture(socket, { notify: true });
    });

    socket.on('startGame', () => {
        const player = players[socket.id];
        const roomId = player?.inRoom;
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            const allReady = Object.values(room.players).every(p => p.isReady);
            if (allReady && Object.keys(room.players).length === room.maxPlayers) {
                console.log(`Host starting game in room ${roomId}`);
                const playerIds = Object.keys(room.players);
                room.players[playerIds[0]].color = 'red';
                room.players[playerIds[1]].color = 'black';

                room.score = { red: 0, black: 0 };
                room.round = 1;
                room.gameState = initializeCheckersState(room.players, room.round, room.score);
                io.to(roomId).emit('gameStart', { gameState: room.gameState, players: room.players, mode: room.mode });
            } else {
                socket.emit('error', 'Cannot start: Not all players are ready or the room is not full.');
            }
        }
    });

    socket.on('movePiece', (moveData) => {
        const player = players[socket.id];
        const roomId = player?.inRoom;
        const room = rooms[roomId];
        if (!room || !room.gameState) return;

        const validationResult = validateCheckersMove(room.gameState, moveData.from, moveData.to, socket.id);

        if (validationResult.isValid) {
            room.gameState = validationResult.newGameState;
            const winner = checkForWinner(room.gameState);
            if (winner) {
                const winnerColor = winner;
                const { winnerName, isMatchWin } = finalizeRoundWin(room, winnerColor);

                if (isMatchWin) {
                    const account = getPlayerAccountByColor(room, winnerColor);
                    if (account) {
                        incrementUserWins(account);
                    }
                }

                io.to(roomId).emit('gameStateUpdate', room.gameState);

                if (isMatchWin) {
                    return;
                }

                io.to(roomId).emit('roundEnd', {
                    winnerColor,
                    winnerName,
                    redScore: room.score.red,
                    blackScore: room.score.black,
                    round: room.round
                });

                room.round += 1;
                room.gameState = initializeCheckersState(room.players, room.round, room.score);

                setTimeout(() => {
                    io.to(roomId).emit('gameStart', { gameState: room.gameState, players: room.players, mode: room.mode });
                }, 2000);
            } else {
                room.gameState.score = { ...room.score };
                io.to(roomId).emit('gameStateUpdate', room.gameState);
            }
        } else {
            socket.emit('illegalMove', validationResult.reason);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        handlePlayerDeparture(socket, { notify: false, disconnect: true });
        delete players[socket.id];
        io.emit('updateRoomList', getOpenRooms());
    });
});

function joinRoom(socket, roomId) {
    const player = players[socket.id];
    const room = rooms[roomId];

    if (!room) {
        return socket.emit('error', `Room ${roomId} does not exist.`);
    }

    const maxPlayers = room.maxPlayers ?? MAX_PLAYERS_PER_ROOM;
    const currentPlayerCount = Object.keys(room.players).length;
    if (currentPlayerCount >= maxPlayers && !room.players[socket.id]) {
        return socket.emit('error', 'Room is full.');
    }

    player.inRoom = roomId;
    room.players[socket.id] = {
        playerId: socket.id,
        isReady: false,
        username: players[socket.id]?.username || null,
        account: players[socket.id]?.account || null
    };

    socket.join(roomId);
    console.log(`Player ${socket.id} joined room ${roomId}`);

    socket.emit('joinedMatchLobby', { room, yourId: socket.id });
    io.to(roomId).emit('roomStateUpdate', room);
    io.emit('updateRoomList', getOpenRooms());
}

function handlePlayerDeparture(socket, { notify = false, disconnect = false } = {}) {
    const player = players[socket.id];
    if (!player) return;
    const roomId = player.inRoom;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) {
        player.inRoom = null;
        return;
    }

    delete room.players[socket.id];
    player.inRoom = null;
    socket.leave(roomId);

    if (Object.keys(room.players).length === 0) {
        console.log(`Room ${roomId} is empty, deleting.`);
        delete rooms[roomId];
    } else {
        if (room.hostId === socket.id) {
            room.hostId = Object.keys(room.players)[0];
            console.log(`Host disconnected. New host is ${room.hostId}`);
        }
        io.to(roomId).emit('roomStateUpdate', room);
        if (notify) {
            io.to(roomId).emit('playerLeft', 'A player has left the match.');
        } else if (disconnect) {
            io.to(roomId).emit('playerLeft', 'The other player has disconnected.');
        }
    }

    io.emit('updateRoomList', getOpenRooms());
}

function syncPlayerInRoom(socketId) {
    const player = players[socketId];
    if (!player) return;
    const roomId = player.inRoom;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[socketId]) {
        room.players[socketId].username = player.username;
        room.players[socketId].account = player.account;
        io.to(roomId).emit('roomStateUpdate', room);
    }
}

function getOpenRooms() {
    const openRooms = {};
    for (const id in rooms) {
        if (rooms[id].mode === 'lan' && Object.keys(rooms[id].players).length < rooms[id].maxPlayers) {
            openRooms[id] = {
                roomId: id,
                gameType: rooms[id].gameType,
                playerCount: Object.keys(rooms[id].players).length,
                maxPlayers: rooms[id].maxPlayers
            };
        }
    }
    return openRooms;
}

function sanitizeDisplayName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 24);
}

function sanitizeAccountName(name) {
    if (typeof name !== 'string') return null;
    const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleaned) return null;
    return cleaned.slice(0, 24);
}

function getPlayerNameByColor(room, color) {
    if (!room || !color) return null;
    const player = Object.values(room.players || {}).find(p => p.color === color);
    const username = player?.username;
    if (typeof username === 'string') {
        const trimmed = username.replace(/\s+/g, ' ').trim();
        if (trimmed) {
            return trimmed.slice(0, 24);
        }
    }
    return null;
}

function getPlayerAccountByColor(room, color) {
    if (!room || !color) return null;
    const player = Object.values(room.players || {}).find(p => p.color === color);
    const account = player?.account;
    if (typeof account === 'string' && account) {
        return sanitizeAccountName(account);
    }
    return null;
}

function finalizeRoundWin(room, winnerColor) {
    const winnerName = getPlayerNameByColor(room, winnerColor) || winnerColor.toUpperCase();
    room.score[winnerColor] += 1;
    room.gameState.score = { ...room.score };

    const matchComplete = room.score[winnerColor] >= 2;
    if (matchComplete) {
        room.gameState.gameOver = true;
        room.gameState.winner = winnerColor;
        room.gameState.winnerName = winnerName;
    } else {
        room.gameState.gameOver = false;
        room.gameState.winner = null;
        room.gameState.winnerName = null;
        room.gameState.roundWinner = winnerColor;
    }

    return { winnerName, isMatchWin: matchComplete };
}

function initializeCheckersState(players, round = 1, score = { red: 0, black: 0 }) {
  let board = [ [0, 2, 0, 2, 0, 2, 0, 2], [2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0] ];
  const redPlayerId = Object.values(players).find(p => p.color === 'red')?.playerId;
  const blackPlayerId = Object.values(players).find(p => p.color === 'black')?.playerId;
  return {
    board: board,
    turn: 'red',
    players: { red: redPlayerId, black: blackPlayerId },
    gameOver: false,
    winner: null,
    winnerName: null,
    round,
    score: { ...score }
  };
}

function validateCheckersMove(gameState, from, to, playerId) {
    const { board, turn, players } = gameState;
    const playerColor = players.red === playerId ? 'red' : 'black';
    if (turn !== playerColor) return { isValid: false, reason: "It's not your turn." };
    if (!board[from.y] || !board[from.y][from.x] || !board[to.y] || board[to.y][to.x] !== 0) return { isValid: false, reason: 'Invalid start or end position.' };
    const piece = board[from.y][from.x]; const isKing = piece === 3 || piece === 4;
    const opponentPieces = playerColor === 'red' ? [2, 4] : [1, 3];
    const dx = to.x - from.x; const dy = to.y - from.y;
    if (!isKing) {
        if (playerColor === 'red' && dy >= 0) return { isValid: false, reason: 'Regular pieces can only move forward.' };
        if (playerColor === 'black' && dy <= 0) return { isValid: false, reason: 'Regular pieces can only move forward.' };
    }
    const newGameState = JSON.parse(JSON.stringify(gameState));
    if (Math.abs(dx) === 1 && Math.abs(dy) === 1) { newGameState.board[to.y][to.x] = piece; newGameState.board[from.y][from.x] = 0; }
    else if (Math.abs(dx) === 2 && Math.abs(dy) === 2) {
        const jumpedX = from.x + dx/2; const jumpedY = from.y + dy/2;
        if (!opponentPieces.includes(board[jumpedY][jumpedX])) return { isValid: false, reason: 'Invalid jump.'};
        newGameState.board[to.y][to.x] = piece; newGameState.board[from.y][from.x] = 0; newGameState.board[jumpedY][jumpedX] = 0;
    } else { return { isValid: false, reason: 'Invalid move.' }; }
    if (playerColor === 'red' && to.y === 0) newGameState.board[to.y][to.x] = 3;
    if (playerColor === 'black' && to.y === 7) newGameState.board[to.y][to.x] = 4;
    newGameState.turn = playerColor === 'red' ? 'black' : 'red';
    return { isValid: true, newGameState };
}

function checkForWinner(gameState) {
    let redPieces = 0; let blackPieces = 0;
    for(let r of gameState.board) { for(let c of r) {
        if (c === 1 || c === 3) redPieces++; if (c === 2 || c === 4) blackPieces++;
    } }
    if (redPieces === 0) return 'black'; if (blackPieces === 0) return 'red';
    return null;
}

function issueSession(res, usernameKey) {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { id: sessionId, username: usernameKey, createdAt: Date.now() });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(cookie => {
        const [name, ...rest] = cookie.trim().split('=');
        const value = rest.join('=');
        cookies[name] = decodeURIComponent(value || '');
    });
    return cookies;
}

function requireAuth(req, res, next) {
    if (!req.user || !req.session?.username) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }
    next();
}

function initializeUserStore() {
    if (!fs.existsSync(USER_DATA_FILE)) {
        fs.writeFileSync(USER_DATA_FILE, JSON.stringify({ users: {} }, null, 2));
    }
}

function readUserStore() {
    try {
        const raw = fs.readFileSync(USER_DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.users || typeof parsed.users !== 'object') {
            return { users: {} };
        }
        return parsed;
    } catch (error) {
        console.error('Failed to read user store:', error);
        return { users: {} };
    }
}

function writeUserStore(store) {
    fs.writeFileSync(USER_DATA_FILE, JSON.stringify(store, null, 2));
}

function getUserRecord(usernameKey) {
    if (!usernameKey) return null;
    const store = readUserStore();
    return store.users[usernameKey.toLowerCase()] || null;
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(`${password}:${salt}`).digest('hex');
}

function incrementUserWins(accountName) {
    const key = accountName.toLowerCase();
    const store = readUserStore();
    if (!store.users[key]) return;
    store.users[key].wins = (store.users[key].wins || 0) + 1;
    writeUserStore(store);
}

function updateUserAvatar(usernameKey, avatarPath) {
    const store = readUserStore();
    if (!store.users[usernameKey]) return;
    const existingPath = store.users[usernameKey].avatarPath;
    if (existingPath && existingPath.startsWith('/uploads/profiles/')) {
        const absolutePath = path.join(__dirname, 'public', existingPath);
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
            } catch (error) {
                console.warn('Unable to remove previous avatar:', error);
            }
        }
    }
    store.users[usernameKey].avatarPath = avatarPath;
    writeUserStore(store);
}

function extractMultipartFile(buffer, boundary) {
    const boundaryText = `--${boundary}`;
    const boundaryBuffer = Buffer.from(boundaryText);
    const headerDelimiter = Buffer.from('\r\n\r\n');
    let start = buffer.indexOf(boundaryBuffer);
    if (start === -1) {
        throw new Error('Boundary not found in form data.');
    }

    start += boundaryBuffer.length + 2; // Skip boundary and CRLF
    const headerEnd = buffer.indexOf(headerDelimiter, start);
    if (headerEnd === -1) {
        throw new Error('Malformed part headers.');
    }

    const headers = buffer.slice(start, headerEnd).toString('utf8');
    const contentStart = headerEnd + headerDelimiter.length;
    const closingBoundary = Buffer.from(`\r\n${boundaryText}--`);
    let contentEnd = buffer.indexOf(closingBoundary, contentStart);
    if (contentEnd === -1) {
        const nextBoundary = Buffer.from(`\r\n${boundaryText}`);
        contentEnd = buffer.indexOf(nextBoundary, contentStart);
        if (contentEnd === -1) {
            throw new Error('Malformed multipart payload.');
        }
    }

    let fileEnd = contentEnd;
    if (buffer[fileEnd - 2] === 13 && buffer[fileEnd - 1] === 10) {
        fileEnd -= 2;
    }

    const fileBuffer = buffer.slice(contentStart, fileEnd);
    const filenameMatch = headers.match(/filename="([^"]*)"/i);
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const filename = filenameMatch ? path.basename(filenameMatch[1]) : `upload-${Date.now()}`;
    const ext = path.extname(filename).toLowerCase();
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const safeExtension = allowedExtensions.includes(ext) ? ext : '.png';
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';

    if (!allowedExtensions.includes(ext) && contentType.startsWith('image/')) {
        const subtype = contentType.split('/')[1] || 'png';
        const derivedExt = `.${subtype.toLowerCase()}`;
        if (allowedExtensions.includes(derivedExt)) {
            return { buffer: fileBuffer, extension: derivedExt };
        }
    }

    return { buffer: fileBuffer, extension: safeExtension };
}

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
