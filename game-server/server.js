// SERVER.JS
// Extended server implementation that now supports authentication, profile
// persistence, avatar uploads, and improved lobby/game management.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const createFileStore = require('connect-session-file');
const { Server } = require('socket.io');

const GuestSessionManager = require('./lib/guestSessions');
const {
    ACCESS_TOKEN_COOKIE,
    CSRF_TOKEN_COOKIE,
    createAccessToken,
    generateCsrfToken,
    getAccessTokenFromRequest,
    getCsrfCookie,
    setAccessTokenCookie,
    setCsrfCookie,
    clearAuthCookies,
    verifyAccessToken,
} = require('./lib/authTokens');
const { parseCookies } = require('./lib/cookies');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, 'data');
const USER_DATA_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads/profiles');
const SESSION_COOKIE_NAME = 'homegame.sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SESSION_STORE_DIR = path.join(DATA_DIR, 'sessions');
const SESSION_SECRET = process.env.SESSION_SECRET || 'homegame_session_secret';
const JWT_SECRET = process.env.JWT_SECRET || 'homegame_jwt_secret';
const GUEST_SESSION_SECRET = process.env.GUEST_SESSION_SECRET || `${SESSION_SECRET}-guest`;
const GUEST_COOKIE_NAME = 'homegame.guest';
const GUEST_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 2; // 2 days
const CSRF_HEADER_NAME = 'x-csrf-token';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEY_LENGTH = 64;
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2 MB

const csrfTokens = new Map();

function generateLegacyCsrfToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(sessionId, token);
    setTimeout(() => csrfTokens.delete(sessionId), 3600000); // 1 hour expiry
    return token;
}

function validateCSRFToken(sessionId, token) {
    return csrfTokens.get(sessionId) === token;
}

function tokensMatch(tokenA, tokenB) {
    if (typeof tokenA !== 'string' || typeof tokenB !== 'string') {
        return false;
    }
    const bufA = Buffer.from(tokenA);
    const bufB = Buffer.from(tokenB);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function csrfMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        return next();
    }

    const submittedToken = req.body?._csrf || req.headers[CSRF_HEADER_NAME];
    const cookieToken = getCsrfCookie(req);

    if (submittedToken && cookieToken && tokensMatch(submittedToken, cookieToken)) {
        return next();
    }

    const sessionId = req.sessionID;
    if (sessionId && submittedToken && validateCSRFToken(sessionId, submittedToken)) {
        return next();
    }

    return res.status(403).json({ error: 'Invalid CSRF token' });
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SESSION_STORE_DIR, { recursive: true });
initializeUserStore();

const guestSessionManager = new GuestSessionManager({
    filePath: path.join(DATA_DIR, 'guest-sessions.json'),
    secret: GUEST_SESSION_SECRET,
    ttl: GUEST_SESSION_TTL_MS,
});

process.on('exit', () => guestSessionManager.stop());
process.on('SIGTERM', () => guestSessionManager.stop());
process.on('SIGINT', () => guestSessionManager.stop());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers?.cookie || '');
    next();
});

const resolvedStoreFactory = typeof createFileStore === 'function'
    ? createFileStore(session)
    : null;
const FileStore = typeof resolvedStoreFactory === 'function'
    ? resolvedStoreFactory
    : createFileStore;

if (typeof FileStore !== 'function') {
    throw new Error('connect-session-file did not provide a valid session store constructor.');
}

const sessionMiddleware = session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    store: new FileStore({
        path: SESSION_STORE_DIR,
        ttl: Math.floor(SESSION_TTL_MS / 1000)
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge: SESSION_TTL_MS,
        sameSite: 'strict',
        secure: COOKIE_SECURE,
        httpOnly: true
    }
});

app.use(sessionMiddleware);

app.use((req, res, next) => {
    const guestToken = req.cookies?.[GUEST_COOKIE_NAME];
    let guestSession = guestSessionManager.getSessionByToken(guestToken);

    if (!guestSession) {
        const { session: createdSession, token } = guestSessionManager.createSession();
        guestSession = createdSession;
        res.cookie(GUEST_COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: COOKIE_SECURE,
            maxAge: GUEST_SESSION_TTL_MS,
            path: '/',
        });
    }

    req.guestSession = guestSession;
    next();
});

app.use((req, res, next) => {
    req.user = null;
    req.authContext = { method: null, payload: null };

    if (req.session) {
        if (!req.session.createdAt) {
            req.session.createdAt = Date.now();
        }
        req.session.lastAccess = Date.now();
    }

    if (req.session?.username) {
        const userRecord = getUserRecord(req.session.username);
        if (userRecord) {
            req.user = {
                username: userRecord.username,
                displayName: userRecord.displayName || userRecord.username,
                wins: userRecord.wins || 0,
                avatarPath: userRecord.avatarPath || null
            };
            req.authContext = { method: 'session', payload: { username: userRecord.username } };
        } else {
            req.session.username = null;
        }
    }

    if (!req.user) {
        const token = getAccessTokenFromRequest(req);
        if (token) {
            const payload = verifyAccessToken(token, JWT_SECRET);
            if (payload?.sub) {
                const userRecord = getUserRecord(payload.sub);
                if (userRecord) {
                    req.user = {
                        username: userRecord.username,
                        displayName: userRecord.displayName || userRecord.username,
                        wins: userRecord.wins || 0,
                        avatarPath: userRecord.avatarPath || null
                    };
                    req.authContext = { method: 'jwt', payload };
                    if (req.session) {
                        req.session.username = userRecord.username.toLowerCase();
                    }
                } else {
                    clearAuthCookies(res, { secure: COOKIE_SECURE });
                }
            } else {
                clearAuthCookies(res, { secure: COOKIE_SECURE });
            }
        }
    }

    if (req.user && req.authContext.method === 'session') {
        const hasAccessToken = Boolean(getAccessTokenFromRequest(req));
        if (!hasAccessToken) {
            const tokenPayload = {
                sub: req.user.username,
                displayName: req.user.displayName,
                wins: req.user.wins,
                avatarPath: req.user.avatarPath,
                guestWins: 0,
            };
            const accessToken = createAccessToken(tokenPayload, JWT_SECRET);
            setAccessTokenCookie(res, accessToken, { secure: COOKIE_SECURE });
        }
        if (!getCsrfCookie(req)) {
            setCsrfCookie(res, generateCsrfToken(), { secure: COOKIE_SECURE });
        }
    }

    next();
});

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

let players = {};
let rooms = {};
const MAX_PLAYERS_PER_ROOM = 2;

app.get('/api/csrf-token', (req, res) => {
    const sessionId = req.sessionID;
    if (!sessionId) {
        return res.status(401).json({ error: 'Session not established' });
    }

    if (req.session && !req.session.csrfSeeded) {
        req.session.csrfSeeded = Date.now();
    }

    const legacyToken = sessionId ? generateLegacyCsrfToken(sessionId) : null;
    const doubleSubmitToken = generateCsrfToken();
    setCsrfCookie(res, doubleSubmitToken, { secure: COOKIE_SECURE });

    res.json({ token: legacyToken || doubleSubmitToken, doubleSubmitToken });
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

app.post('/signup', csrfMiddleware, (req, res) => {
    const rawUsername = req.body.username || '';
    const rawDisplayName = req.body.displayName || rawUsername;
    const password = req.body.password || '';

    const username = sanitizeAccountName(rawUsername);
    const { value: validatedDisplayName } = validateDisplayNameInput(rawDisplayName);
    const displayName = validatedDisplayName || username;

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

    const passwordHash = hashPassword(password);
    store.users[key] = {
        username,
        displayName,
        passwordHash,
        wins: 0,
        avatarPath: null
    };
    writeUserStore(store);

    return establishSession(req, res, key, () => res.redirect('/'));
});

app.post('/login', csrfMiddleware, (req, res) => {
    const rawUsername = req.body.username || '';
    const password = req.body.password || '';
    const username = sanitizeAccountName(rawUsername);
    if (!username) {
        return res.status(400).send('Enter a valid username.');
    }

    const store = readUserStore();
    const userKey = username.toLowerCase();
    const userRecord = store.users[userKey];
    if (!userRecord) {
        return res.status(401).send('Invalid username or password.');
    }

    const { valid, updated } = verifyAndUpdatePassword(store, userKey, password);
    if (!valid) {
        return res.status(401).send('Invalid username or password.');
    }

    if (updated) {
        writeUserStore(store);
    }

    return establishSession(req, res, userKey, () => res.redirect('/'));
});

app.post('/logout', csrfMiddleware, (req, res) => {
    const sessionId = req.sessionID;
    if (sessionId) {
        csrfTokens.delete(sessionId);
    }

    clearAuthCookies(res, { secure: COOKIE_SECURE });

    const { session: newGuest, token: newGuestToken } = guestSessionManager.createSession();
    req.guestSession = newGuest;
    res.cookie(GUEST_COOKIE_NAME, newGuestToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        maxAge: GUEST_SESSION_TTL_MS,
        path: '/',
    });

    if (!req.session) {
        res.clearCookie(SESSION_COOKIE_NAME, {
            httpOnly: true,
            sameSite: 'strict',
            secure: COOKIE_SECURE,
            path: '/'
        });
        return res.status(204).end();
    }

    req.session.destroy((err) => {
        if (err) {
            console.error('Failed to destroy session:', err);
            return res.status(500).json({ error: 'Unable to logout.' });
        }
        res.clearCookie(SESSION_COOKIE_NAME, {
            httpOnly: true,
            sameSite: 'strict',
            secure: COOKIE_SECURE,
            path: '/'
        });
        res.status(204).end();
    });
});

app.get('/api/session', (req, res) => {
    const guestDetails = req.guestSession ? {
        wins: req.guestSession.data?.wins || 0,
        lastRoom: req.guestSession.data?.lastRoom || null,
    } : null;

    if (!req.user) {
        return res.json({ authenticated: false, guest: guestDetails });
    }
    res.json({
        authenticated: true,
        user: req.user,
        guest: guestDetails,
        authMethod: req.authContext?.method || null,
        guestUpgrade: req.guestUpgrade || null,
    });
});

app.get('/api/profile', requireAuth, (req, res) => {
    const userRecord = getUserRecord(req.user.username);
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

app.post('/api/profile', requireAuth, csrfMiddleware, (req, res) => {
    const hasDisplayName = Object.prototype.hasOwnProperty.call(req.body, 'displayName');
    const displayNameValidation = hasDisplayName ? validateDisplayNameInput(req.body.displayName) : { value: null, error: null };
    const wins = Number.isFinite(Number(req.body.wins)) ? Math.max(0, Number(req.body.wins)) : undefined;
    const store = readUserStore();
    const userKey = req.user.username.toLowerCase();
    const userRecord = store.users[userKey];
    if (!userRecord) {
        return res.status(404).json({ error: 'Profile not found.' });
    }

    if (displayNameValidation.error) {
        return res.status(400).json({ error: displayNameValidation.error });
    }

    if (hasDisplayName && displayNameValidation.value) {
        userRecord.displayName = displayNameValidation.value;
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

app.post('/api/profile/avatar', requireAuth, csrfMiddleware, (req, res) => {
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
            const uploadRoot = path.resolve(UPLOAD_DIR);
            const resolvedPath = path.resolve(finalPath);
            const relativePath = path.relative(uploadRoot, resolvedPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                throw new Error('Resolved path escapes upload directory.');
            }

            fs.writeFileSync(resolvedPath, fileInfo.buffer, { mode: 0o600 });

            updateUserAvatar(req.user.username.toLowerCase(), `/uploads/profiles/${finalName}`);
            res.json({ avatarPath: `/uploads/profiles/${finalName}` });
        } catch (error) {
            console.error('Avatar upload failed:', error);
            res.status(400).json({ error: 'Unable to process uploaded file.' });
        }
    });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use((err, req, res, next) => {
    console.error('Server error:', err);

    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
    }

    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid request data' });
    }

    const isDevelopment = process.env.NODE_ENV !== 'production';
    res.status(500).json({
        error: 'Internal server error',
        ...(isDevelopment && { details: err.message })
    });
});

// Authenticate Socket.IO handshakes using the same HTTP cookies as the REST API.
io.use((socket, next) => {
    try {
        const cookiesHeader = socket.handshake.headers?.cookie || '';
        const parsedCookies = parseCookies(cookiesHeader);

        let userRecord = null;
        const accessToken = parsedCookies[ACCESS_TOKEN_COOKIE];
        if (accessToken) {
            const payload = verifyAccessToken(accessToken, JWT_SECRET);
            if (payload?.sub) {
                const record = getUserRecord(payload.sub);
                if (record) {
                    userRecord = {
                        username: record.username,
                        displayName: record.displayName || record.username,
                        wins: record.wins || 0,
                        avatarPath: record.avatarPath || null,
                    };
                }
            }
        }

        let guestSession = null;
        const guestToken = parsedCookies[GUEST_COOKIE_NAME];
        if (guestToken) {
            guestSession = guestSessionManager.getSessionByToken(guestToken);
        }

        if (!userRecord && !guestSession) {
            const created = guestSessionManager.createSession();
            guestSession = created.session;
        }

        socket.data.identity = {
            user: userRecord,
            guestSession,
        };

        next();
    } catch (error) {
        console.error('Socket authentication failed:', error);
        next(new Error('Authentication failed'));
    }
});

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);
    const identity = socket.data.identity || {};
    const guestSession = identity.guestSession;
    const authUser = identity.user;

    players[socket.id] = {
        playerId: socket.id,
        inRoom: null,
        username: authUser?.displayName || guestSession?.data?.displayName || 'Guest',
        account: authUser?.username || null,
        guestId: guestSession?.id || null,
    };
    if (players[socket.id].guestId) {
        guestSessionManager.recordDisplayName(players[socket.id].guestId, players[socket.id].username);
    }
    socket.emit('updateRoomList', getOpenRooms());

    socket.on('linkAccount', ({ accountName, displayName }) => {
        if (!players[socket.id]) return;
        const sanitizedAccount = sanitizeAccountName(accountName || '');
        const displayCandidate = displayName || sanitizedAccount || '';
        const { value: sanitizedDisplay } = validateDisplayNameInput(displayCandidate);
        if (sanitizedAccount) {
            players[socket.id].account = sanitizedAccount;
        }
        if (sanitizedDisplay) {
            players[socket.id].username = sanitizedDisplay;
        } else if (sanitizedAccount) {
            players[socket.id].username = sanitizedAccount;
        }
        if (players[socket.id].guestId) {
            guestSessionManager.recordDisplayName(players[socket.id].guestId, players[socket.id].username);
        }
        syncPlayerInRoom(socket.id);
    });

    socket.on('setUsername', (rawName) => {
        if (!players[socket.id]) return;
        const { value: sanitized, error } = validateDisplayNameInput(rawName);
        if (sanitized) {
            players[socket.id].username = sanitized;
        } else if (error && !players[socket.id].username) {
            players[socket.id].username = 'Guest';
        }
        if (players[socket.id].guestId) {
            guestSessionManager.recordDisplayName(players[socket.id].guestId, players[socket.id].username);
        }
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
                    } else {
                        const guestId = getPlayerGuestByColor(room, winnerColor);
                        if (guestId) {
                            guestSessionManager.recordWin(guestId);
                        }
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
        account: players[socket.id]?.account || null,
        guestId: players[socket.id]?.guestId || null,
    };

    socket.join(roomId);
    console.log(`Player ${socket.id} joined room ${roomId}`);

    socket.emit('joinedMatchLobby', { room, yourId: socket.id });
    io.to(roomId).emit('roomStateUpdate', room);
    io.emit('updateRoomList', getOpenRooms());

    if (players[socket.id]?.guestId) {
        guestSessionManager.recordLastRoom(players[socket.id].guestId, {
            roomId,
            gameType: room.gameType,
            mode: room.mode,
        });
    }
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
        room.players[socketId].guestId = player.guestId;
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

function validateDisplayNameInput(name) {
    if (name === undefined || name === null) {
        return { value: null, error: 'Display name must contain at least one visible character.' };
    }

    const normalized = String(name)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) {
        return { value: null, error: 'Display name must contain at least one visible character.' };
    }

    if (normalized.length > 24) {
        return { value: null, error: 'Display name must be 24 characters or fewer.' };
    }

    const validCharacters = /^[\p{L}\p{N} _'’.-]+$/u;
    if (!validCharacters.test(normalized)) {
        return {
            value: null,
            error: 'Display name may only include letters, numbers, spaces, apostrophes, hyphens, or periods.'
        };
    }

    return { value: normalized, error: null };
}

function sanitizeDisplayName(name) {
    const { value } = validateDisplayNameInput(name);
    return value;
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

function getPlayerGuestByColor(room, color) {
    if (!room || !color) return null;
    const player = Object.values(room.players || {}).find(p => p.color === color);
    if (player?.guestId) {
        return player.guestId;
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

function establishSession(req, res, usernameKey, onSuccess) {
    const previousSessionId = req.sessionID;

    req.session.regenerate((err) => {
        if (err) {
            console.error('Session regeneration failed:', err);
            return res.status(500).send('Unable to establish session.');
        }

        if (previousSessionId) {
            csrfTokens.delete(previousSessionId);
        }

        req.session.username = usernameKey;
        req.session.createdAt = Date.now();
        req.session.lastAccess = Date.now();

        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('Session save failed:', saveErr);
                return res.status(500).send('Unable to persist session.');
            }

            issueAuthenticationState(req, res, usernameKey);

            if (typeof onSuccess === 'function') {
                onSuccess();
            }
        });
    });
}

/**
 * Persist a freshly authenticated user's state across cookies and
 * upgrade any guest metadata that was captured prior to sign-in.
 */
function issueAuthenticationState(req, res, usernameKey) {
    let userRecord = getUserRecord(usernameKey);
    if (!userRecord) {
        return;
    }

    const transfer = transferGuestSession(req, res);
    if (transfer?.data) {
        const updated = applyGuestProgressToUser(usernameKey, transfer.data);
        if (updated) {
            userRecord = updated;
        }
        req.guestUpgrade = transfer.data;
    }

    const tokenPayload = {
        sub: userRecord.username,
        displayName: userRecord.displayName || userRecord.username,
        wins: userRecord.wins || 0,
        avatarPath: userRecord.avatarPath || null,
        guestWins: transfer?.data?.wins || 0,
    };

    const accessToken = createAccessToken(tokenPayload, JWT_SECRET);
    setAccessTokenCookie(res, accessToken, { secure: COOKIE_SECURE });
    setCsrfCookie(res, generateCsrfToken(), { secure: COOKIE_SECURE });

    req.user = {
        username: tokenPayload.sub,
        displayName: tokenPayload.displayName,
        wins: tokenPayload.wins,
        avatarPath: tokenPayload.avatarPath,
    };
    req.authContext = { method: 'jwt', payload: tokenPayload };
}

/**
 * Promote an anonymous guest session into a permanent user account.
 * Returns the data payload that was associated with the guest, if any.
 */
function transferGuestSession(req, res) {
    if (!req.guestSession) {
        return null;
    }
    const promoted = guestSessionManager.promoteSession(req.guestSession.id);
    if (!promoted) {
        return null;
    }

    res.clearCookie(GUEST_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        path: '/',
    });
    req.guestSession = null;
    return promoted;
}

/**
 * Apply guest game progress to a durable user account.
 */
function applyGuestProgressToUser(usernameKey, guestData) {
    if (!guestData) {
        return null;
    }

    const store = readUserStore();
    const key = usernameKey.toLowerCase();
    const record = store.users[key];
    if (!record) {
        return null;
    }

    let mutated = false;

    if (Number.isFinite(Number(guestData.wins)) && guestData.wins > 0) {
        record.wins = (record.wins || 0) + Number(guestData.wins);
        mutated = true;
    }

    if (guestData.displayName && !record.displayName) {
        const sanitized = sanitizeDisplayName(guestData.displayName);
        if (sanitized) {
            record.displayName = sanitized;
            mutated = true;
        }
    }

    if (guestData.lastRoom) {
        record.lastGuestRoom = guestData.lastRoom;
        mutated = true;
    }

    if (mutated) {
        writeUserStore(store);
    }

    return record;
}

function requireAuth(req, res, next) {
    if (!req.user) {
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

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derivedKey = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS);
    return ['scrypt', SCRYPT_PARAMS.N, SCRYPT_PARAMS.r, SCRYPT_PARAMS.p, salt.toString('base64'), derivedKey.toString('base64')].join('$');
}

function legacyHashPassword(password, salt) {
    return crypto.createHash('sha256').update(`${password}:${salt}`).digest('hex');
}

function parseScryptHash(hash) {
    if (typeof hash !== 'string') {
        return null;
    }
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return null;
    }
    const [ , nStr, rStr, pStr, saltB64, keyB64 ] = parts;
    const N = Number.parseInt(nStr, 10);
    const r = Number.parseInt(rStr, 10);
    const p = Number.parseInt(pStr, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
        return null;
    }
    try {
        const salt = Buffer.from(saltB64, 'base64');
        const key = Buffer.from(keyB64, 'base64');
        if (!salt.length || !key.length) {
            return null;
        }
        return { N, r, p, salt, key };
    } catch (error) {
        return null;
    }
}

function verifyScryptPassword(password, hash) {
    const parsed = parseScryptHash(hash);
    if (!parsed) {
        return false;
    }
    const derived = crypto.scryptSync(password, parsed.salt, parsed.key.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p
    });
    return crypto.timingSafeEqual(parsed.key, derived);
}

function verifyAndUpdatePassword(store, usernameKey, password) {
    const record = store.users[usernameKey];
    if (!record) {
        return { valid: false, updated: false };
    }

    if (parseScryptHash(record.passwordHash)) {
        return { valid: verifyScryptPassword(password, record.passwordHash), updated: false };
    }

    if (record.salt) {
        const expected = legacyHashPassword(password, record.salt);
        if (expected === record.passwordHash) {
            record.passwordHash = hashPassword(password);
            delete record.salt;
            return { valid: true, updated: true };
        }
    }

    return { valid: false, updated: false };
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

function detectImageExtension(buffer) {
    if (!buffer || buffer.length < 4) {
        return null;
    }

    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
        buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
        return '.png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        const end = buffer.length;
        if (end >= 2 && buffer[end - 2] === 0xff && buffer[end - 1] === 0xd9) {
            return '.jpg';
        }
    }

    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'GIF8') {
        return '.gif';
    }

    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return '.webp';
    }

    return null;
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
    const filename = filenameMatch ? path.basename(filenameMatch[1]) : `upload-${Date.now()}`;
    const detectedExtension = detectImageExtension(fileBuffer);
    if (!detectedExtension) {
        throw new Error(`Unsupported image type for file ${filename}`);
    }

    return { buffer: fileBuffer, extension: detectedExtension };
}

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
