// SERVER.JS
// Extended server implementation that now supports authentication, profile
// persistence, avatar uploads, and improved lobby/game management.

const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const os = require('os');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { Server } = require('socket.io');
const { createModularGameServer } = require('./src/server/gameGateway');

const { createSecurityHeadersMiddleware } = require('./src/security/headers');
const { createHttpRateLimiter, createSocketRateLimiter, SlidingWindowRateLimiter } = require('./src/security/rateLimiter');
const { metricsCollector, collectResourceSnapshot } = require('./src/monitoring/metrics');
const {
    sanitizeAccountName,
    sanitizeDisplayName,
    validateDisplayNameInput,
    validatePasswordInput,
} = require('./src/security/validators');
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
const { createProfileService } = require('./src/profile/profileService');
const { processAvatar } = require('./src/profile/avatarProcessor');
const { createSessionMaintenance } = require('./src/sessions/sessionMaintenance');
const { validateSignup } = require('./src/middleware/validation');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const DEFAULT_PORT = 8081;
let activePort = null;
const modularGameServer = createModularGameServer({
    io,
    logger: console,
    pluginDirectory: path.join(__dirname, 'src/plugins'),
});

const emitOpenRoomsUpdate = () => {
    const openRooms = getOpenRooms();
    console.log('Broadcasting updated room list to clients. Count:', Object.keys(openRooms).length);
    io.emit('updateRoomList', openRooms);
};

modularGameServer.roomManager.on('roomCreated', emitOpenRoomsUpdate);
modularGameServer.roomManager.on('roomUpdated', emitOpenRoomsUpdate);
modularGameServer.roomManager.on('roomRemoved', emitOpenRoomsUpdate);

function emitSocketError({ socket, player, action, error, message = 'Operation failed. Please try again.', code = 'OPERATION_FAILED' }) {
    const context = {
        userId: socket?.id || null,
        room: player?.inRoom || null,
        action,
    };

    console.error(`[Socket] ${action} failed`, {
        error: error?.message,
        stack: error?.stack,
        context,
    });

    if (typeof metricsCollector?.recordError === 'function') {
        metricsCollector.recordError(error, { eventName: action, transport: 'socket.io', ...context });
    }

    if (socket?.connected) {
        socket.emit('error', {
            message,
            code,
            action,
        });
    }
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const DEFAULT_SECRET_PLACEHOLDERS = new Set(
    [
        'change_me',
        'changeme',
        'default',
        'default_secret',
        'secret',
        'password',
        'session_secret',
        'jwt_secret',
        'guest_session_secret',
        'homegame_session_secret',
        'homegame_jwt_secret',
        'homegame_session_secret-guest',
        'guestsecret',
        'guest_secret',
    ].map((value) => value.toLowerCase()),
);

function generateSecureSecret(byteLength = 48) {
    return crypto.randomBytes(byteLength).toString('base64');
}

function isPlaceholderSecret(secret) {
    if (typeof secret !== 'string') {
        return true;
    }
    return DEFAULT_SECRET_PLACEHOLDERS.has(secret.trim().toLowerCase());
}

function hasStrongEntropy(secret) {
    if (typeof secret !== 'string') {
        return false;
    }

    if (secret.length < 32) {
        return false;
    }

    const uniqueChars = new Set(secret).size;
    const uniqueRatio = uniqueChars / secret.length;
    if (uniqueRatio < 0.25) {
        return false;
    }

    const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];
    const classesMatched = characterClasses.reduce(
        (count, regex) => (regex.test(secret) ? count + 1 : count),
        0,
    );

    return classesMatched >= 2;
}

function resolveSecret(secretName) {
    const envValue = process.env[secretName];

    if (envValue && !isPlaceholderSecret(envValue)) {
        if (IS_PRODUCTION && !hasStrongEntropy(envValue)) {
            console.error(
                `[Security] ${secretName} does not meet strength requirements. ` +
                    'Provide a secret with at least 32 characters and mixed character types.',
            );
            return { ok: false };
        }

        if (!IS_PRODUCTION && !hasStrongEntropy(envValue)) {
            console.warn(
                `[Security] ${secretName} appears to be weak. ` +
                    'Consider using at least 32 characters with mixed character types.',
            );
        }

        return { ok: true, value: envValue };
    }

    if (IS_PRODUCTION) {
        const reason = envValue
            ? 'uses an insecure default value'
            : 'is not set';
        console.error(
            `[Security] ${secretName} ${reason}. The server cannot start without a strong secret.`,
        );
        return { ok: false };
    }

    const generated = generateSecureSecret();
    console.warn(
        `[Security] Generated a secure random value for ${secretName} in development. ` +
            'Add this secret to your .env file to persist sessions across restarts.',
    );
    return { ok: true, value: generated };
}

function loadSecrets() {
    const secrets = {};
    const failures = [];

    ['SESSION_SECRET', 'JWT_SECRET', 'GUEST_SESSION_SECRET'].forEach((secretName) => {
        const result = resolveSecret(secretName);
        if (!result.ok) {
            failures.push(secretName);
            return;
        }

        secrets[secretName] = result.value;
        process.env[secretName] = result.value;
    });

    if (failures.length > 0) {
        console.error(
            `[Security] Startup aborted. Update the following secrets: ${failures.join(', ')}.`,
        );
        process.exit(1);
    }

    return secrets;
}

const {
    SESSION_SECRET,
    JWT_SECRET,
    GUEST_SESSION_SECRET,
} = loadSecrets();

modularGameServer.resourceMonitor.on('metrics', (snapshot) => {
    metricsCollector.updateGameMetrics({
        rooms: snapshot.rooms,
        players: snapshot.players,
        activeGames: snapshot.activeGames,
    });
    const fallback = collectResourceSnapshot();
    const system = snapshot.system || {};
    metricsCollector.updateResourceSnapshot({
        memory: {
            rss: system.rss ?? fallback.memory.rss,
            heapTotal: system.heapTotal ?? fallback.memory.heapTotal,
            heapUsed: system.heapUsed ?? fallback.memory.heapUsed,
            external: system.external ?? fallback.memory.external,
        },
        cpuLoad: [system.cpuLoad ?? fallback.cpuLoad[0]],
        uptime: fallback.uptime,
    });
});

modularGameServer.roomManager.on('roundEnd', async ({ seriesWinnerId }) => {
    if (!seriesWinnerId) {
        return;
    }
    try {
        await recordSeriesWin(seriesWinnerId);
    } catch (error) {
        console.warn('Failed to record series win:', error);
    }
});

const DATA_DIR = path.join(__dirname, 'data');
const USER_DATA_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads/profiles');
const SESSION_COOKIE_NAME = 'homegame.sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 1 day
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const SESSION_STORE_DIR = path.join(__dirname, '.sessions');
const GUEST_COOKIE_NAME = 'homegame.guest';
const GUEST_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 2; // 2 days
const CSRF_HEADER_NAME = 'x-csrf-token';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEY_LENGTH = 64;
const COOKIE_SECURE = IS_PRODUCTION;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_AVATAR_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);
const REDIS_URL = process.env.REDIS_URL || null;
const PROFILE_CACHE_TTL_MS = Number.parseInt(process.env.PROFILE_CACHE_TTL_MS || '15000', 10);
const PROFILE_CACHE_MAX_ENTRIES = Number.parseInt(process.env.PROFILE_CACHE_MAX_ENTRIES || '2000', 10);
const AVATAR_MAX_DIMENSION = Number.parseInt(process.env.AVATAR_MAX_DIMENSION || '256', 10);
const AVATAR_OUTPUT_FORMAT = (process.env.AVATAR_OUTPUT_FORMAT || 'webp').toLowerCase() === 'png' ? 'png' : 'webp';
const HTTP_BODY_LIMIT = process.env.HTTP_BODY_LIMIT || '256kb';
const FORM_BODY_LIMIT = process.env.FORM_BODY_LIMIT || '512kb';
const RATE_LIMIT_WRITE_MAX = Number.parseInt(process.env.RATE_LIMIT_WRITE_MAX || '300', 10);
const AUTH_RATE_LIMIT_MAX = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10);
const SOCKET_EVENT_RATE_LIMIT = Number.parseInt(process.env.SOCKET_EVENT_RATE_LIMIT || '80', 10);
const SOCKET_CONNECTION_RATE_LIMIT = Number.parseInt(process.env.SOCKET_CONNECTION_RATE_LIMIT || '120', 10);
const METRICS_TOKEN = process.env.METRICS_TOKEN || null;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

class CsrfTokenManager {
    constructor() {
        this.tokens = new Map();
        this.maxTokens = 10000;
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
        this.cleanupInterval.unref?.();
    }

    generate(sessionId) {
        if (this.tokens.size >= this.maxTokens) {
            this.cleanup();
        }
        const token = crypto.randomBytes(32).toString('hex');
        this.tokens.set(sessionId, { token, expiresAt: Date.now() + 3600000 });
        return token;
    }

    validate(sessionId, token) {
        const entry = this.tokens.get(sessionId);
        if (!entry) return false;
        if (Date.now() > entry.expiresAt) {
            this.tokens.delete(sessionId);
            return false;
        }
        return entry.token === token;
    }

    cleanup() {
        const now = Date.now();
        for (const [sessionId, entry] of this.tokens.entries()) {
            if (now > entry.expiresAt) {
                this.tokens.delete(sessionId);
            }
        }
    }

    revoke(sessionId) {
        if (sessionId) {
            this.tokens.delete(sessionId);
        }
    }

    destroy() {
        clearInterval(this.cleanupInterval);
        this.tokens.clear();
    }
}

const csrfTokenManager = new CsrfTokenManager();

function generateLegacyCsrfToken(sessionId) {
    return csrfTokenManager.generate(sessionId);
}

function validateCSRFToken(sessionId, token) {
    return csrfTokenManager.validate(sessionId, token);
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
const profileService = createProfileService({
    dataFile: USER_DATA_FILE,
    uploadDir: UPLOAD_DIR,
    cacheTtlMs: PROFILE_CACHE_TTL_MS,
    cacheOptions: {
        redisUrl: REDIS_URL,
        ttlMs: PROFILE_CACHE_TTL_MS,
        maxEntries: PROFILE_CACHE_MAX_ENTRIES,
    },
    analyticsOptions: {
        redisUrl: REDIS_URL,
    },
    logger: console,
});
profileService.initialize();

const guestSessionManager = new GuestSessionManager({
    filePath: path.join(DATA_DIR, 'guest-sessions.json'),
    secret: GUEST_SESSION_SECRET,
    ttl: GUEST_SESSION_TTL_MS,
});

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.locals.routePath = req.originalUrl.split('?')[0];
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const route = res.locals.routePath || req.route?.path || req.originalUrl.split('?')[0];
        metricsCollector.recordHttpSample({
            durationMs,
            method: req.method,
            route,
            statusCode: res.statusCode,
        });
    });
    next();
});

const securityHeadersMiddleware = createSecurityHeadersMiddleware();
app.use(securityHeadersMiddleware);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else {
            metricsCollector.recordSecurityEvent('cors_denied');
            return res.status(403).json({ error: 'Origin not allowed' });
        }
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

app.use(express.json({ limit: HTTP_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: FORM_BODY_LIMIT }));

const writeLimiter = createHttpRateLimiter({
    windowMs: 60000,
    max: RATE_LIMIT_WRITE_MAX,
    skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    onLimit: () => metricsCollector.recordSecurityEvent('http_rate_limit'),
});
app.use(writeLimiter);

const handshakeLimiter = new SlidingWindowRateLimiter({
    windowMs: 60000,
    max: SOCKET_CONNECTION_RATE_LIMIT,
});

const socketEventRateLimiterFactory = () => createSocketRateLimiter({
    windowMs: 1000,
    max: SOCKET_EVENT_RATE_LIMIT,
    onLimit: () => metricsCollector.recordSecurityEvent('socket_rate_limit'),
});

const authLimiter = createHttpRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: AUTH_RATE_LIMIT_MAX,
    keyGenerator: (req) => `${req.ip || req.connection?.remoteAddress || 'anonymous'}:auth`,
    message: 'Too many authentication attempts. Please wait before retrying.',
    onLimit: () => metricsCollector.recordSecurityEvent('auth_rate_limit'),
});
app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers?.cookie || '');
    next();
});

const sessionMiddleware = session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    store: new FileStore({
        path: SESSION_STORE_DIR,
        retries: 0,
        ttl: SESSION_TTL_SECONDS,
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

const sessionMaintenance = createSessionMaintenance({
    sessionDir: SESSION_STORE_DIR,
    ttlMs: SESSION_TTL_MS,
    logger: console,
});
sessionMaintenance.start();

async function gracefulShutdown(signal) {
    console.log(`Received ${signal}, starting graceful shutdown...`);

    server.close(async () => {
        console.log('HTTP server closed');

        try {
            await Promise.all([
                profileService.shutdown(),
                guestSessionManager.stop(),
                sessionMaintenance.stop(),
                csrfTokenManager.destroy(),
            ]);

            console.log('All services shut down successfully');
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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

app.get('/healthz', (req, res) => {
    const snapshot = collectResourceSnapshot();
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        metrics: {
            uptime: snapshot.uptime,
            memory: snapshot.memory,
            cpuLoad: snapshot.cpuLoad,
            activeConnections: metricsCollector.socketConnections,
        },
    });
});

const metricsRouter = metricsCollector.createRouter({ token: METRICS_TOKEN });
app.use('/metrics', metricsRouter);

const players = new WeakMap();

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

app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        services: {
            redis: profileService.cache.redisState.status,
            sessions: fs.existsSync(SESSION_STORE_DIR),
            profiles: fs.existsSync(USER_DATA_FILE),
        }
    };

    const isHealthy = Object.values(health.services).every(
        (s) => s === 'healthy' || s === true || s === 'disabled'
    );

    res.status(isHealthy ? 200 : 503).json(health);
});

app.get('/api/network-info', (req, res) => {
    const interfaces = os.networkInterfaces();
    let ipAddress = '127.0.0.1';

    for (const details of Object.values(interfaces)) {
        if (!details) {
            continue;
        }

        for (const iface of details) {
            if (iface && iface.family === 'IPv4' && !iface.internal && iface.address) {
                ipAddress = iface.address;
                break;
            }
        }

        if (ipAddress !== '127.0.0.1') {
            break;
        }
    }

    const envPort = Number.parseInt(process.env.PORT, 10);
    const fallbackPort = Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT;
    const port = Number.isInteger(activePort) ? activePort : fallbackPort;

    res.json({ ip: ipAddress, port });
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

app.post('/signup', authLimiter, csrfMiddleware, validateSignup, async (req, res, next) => {
    const rawUsername = req.body.username || '';
    const rawDisplayName = req.body.displayName || rawUsername;
    const password = req.body.password || '';

    const username = sanitizeAccountName(rawUsername);
    if (!username) {
        return res.status(400).send('Username is required and may only contain letters, numbers, underscores, and hyphens.');
    }

    const displayNameValidation = validateDisplayNameInput(rawDisplayName, {
        currentUsername: username,
        uniquenessCheck: (value) => profileService.ensureDisplayNameAvailability(value, username),
    });
    if (displayNameValidation.error) {
        return res.status(400).send(displayNameValidation.error);
    }
    const displayName = displayNameValidation.value || username;

    const { valid: isPasswordValid, message: passwordError } = validatePasswordInput(password, {
        username,
        identifier: req.ip,
    });
    if (!isPasswordValid) {
        return res.status(400).send(passwordError || 'Password does not meet complexity requirements.');
    }

    const store = readUserStore();
    const key = username.toLowerCase();
    if (store.users[key]) {
        return res.status(409).send('That username is already taken.');
    }

    const passwordHash = hashPassword(password);

    try {
        await profileService.upsert(key, {
            username,
            displayName,
            passwordHash,
            wins: 0,
            avatarPath: null,
        });
        await establishSession(req, res, key, () => res.redirect('/'));
    } catch (error) {
        if (!res.headersSent) {
            next(error);
        }
    }
});

app.post('/login', authLimiter, csrfMiddleware, async (req, res, next) => {
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

    try {
        if (updated) {
            await writeUserStore(store);
        }

        await establishSession(req, res, userKey, () => res.redirect('/'));
    } catch (error) {
        if (!res.headersSent) {
            next(error);
        }
    }
});

app.post('/logout', csrfMiddleware, (req, res) => {
    const sessionId = req.sessionID;
    csrfTokenManager.revoke(sessionId);

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

app.post('/api/profile', requireAuth, csrfMiddleware, async (req, res, next) => {
    const hasDisplayName = Object.prototype.hasOwnProperty.call(req.body, 'displayName');
    const displayNameValidation = hasDisplayName ? validateDisplayNameInput(req.body.displayName, {
        currentUsername: req.user.username,
        uniquenessCheck: (value) => profileService.ensureDisplayNameAvailability(value, req.user.username),
    }) : { value: null, error: null };
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

    try {
        await writeUserStore(store);

        const updated = getUserRecord(userKey);
        res.json({
            username: updated.username,
            displayName: updated.displayName || updated.username,
            wins: updated.wins || 0,
            avatarPath: updated.avatarPath || null
        });
    } catch (error) {
        if (!res.headersSent) {
            next(error);
        }
    }
});

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_SIZE,
        files: 1,
        fields: 2,
    },
    fileFilter: (req, file, cb) => {
        // Sanitize original filename immediately
        const sanitized = file.originalname
            .normalize('NFKC')
            .replace(/[^a-zA-Z0-9._-]/g, '')
            .slice(0, 100);

        if (!sanitized || sanitized.startsWith('.')) {
            return cb(new Error('Invalid filename'));
        }

        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedMimes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type'));
        }

        cb(null, true);
    }
}).single('avatar');

app.post('/api/profile/avatar', requireAuth, csrfMiddleware, (req, res) => {
    avatarUpload(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'Avatar must be smaller than 2MB.' });
            }
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file provided.' });
        }

        try {
            const processed = await processAvatar(req.file.buffer, {
                maxDimension: AVATAR_MAX_DIMENSION,
                outputFormat: AVATAR_OUTPUT_FORMAT,
            });

            const processedMime = processed.format === 'jpeg'
                ? 'image/jpeg'
                : `image/${processed.format}`;
            if (!ALLOWED_AVATAR_MIME_TYPES.has(processedMime)) {
                return res.status(400).json({
                    error: 'Processed avatar format is not permitted.',
                });
            }

            const timestamp = Date.now();
            const random = crypto.randomBytes(8).toString('hex');
            const safeBaseName = req.user.username.replace(/[^a-zA-Z0-9_-]/g, '');
            const finalName = `${safeBaseName || 'avatar'}-${timestamp}-${random}${processed.extension}`;
            const finalPath = path.join(UPLOAD_DIR, finalName);
            const uploadRoot = path.resolve(UPLOAD_DIR);
            const resolvedPath = path.resolve(finalPath);
            const relativePath = path.relative(uploadRoot, resolvedPath);
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                throw new Error('Resolved path escapes upload directory.');
            }

            await fs.promises.writeFile(resolvedPath, processed.buffer, { mode: 0o600 });

            await updateUserAvatar(req.user.username.toLowerCase(), `/uploads/profiles/${finalName}`);
            profileService.analytics.record('avatarProcessed', {
                username: req.user.username.toLowerCase(),
                width: processed.outputWidth,
                height: processed.outputHeight,
                format: processed.format,
            });

            res.json({
                avatarPath: `/uploads/profiles/${finalName}`,
                metadata: {
                    originalWidth: processed.width,
                    originalHeight: processed.height,
                    outputWidth: processed.outputWidth,
                    outputHeight: processed.outputHeight,
                    format: processed.format,
                },
            });
        } catch (error) {
            console.error('Avatar upload failed:', error);
            res.status(400).json({ error: 'Unable to process uploaded file.' });
        }
    });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    metricsCollector.recordError(err, { route: req.originalUrl, method: req.method });

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
        const forwardedFor = socket.handshake.headers?.['x-forwarded-for'];
        const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (socket.handshake.address || socket.request?.connection?.remoteAddress || socket.id);
        if (!handshakeLimiter.allow(ip)) {
            metricsCollector.recordSecurityEvent('socket_connection_rate_limit');
            return next(new Error('Too many connection attempts'));
        }
        socket.data.clientIp = ip;

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
        metricsCollector.recordError(error, { transport: 'socket.io', stage: 'handshake' });
        next(new Error('Authentication failed'));
    }
});

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);
    metricsCollector.incrementSocketConnections();
    const socketRateLimiter = socketEventRateLimiterFactory();
    socket.use(socketRateLimiter);
    instrumentSocketHandlers(socket);
    const identity = socket.data.identity || {};
    const guestSession = identity.guestSession;
    const authUser = identity.user;

    const playerState = {
        playerId: socket.id,
        inRoom: null,
        username: authUser?.displayName || guestSession?.data?.displayName || 'Guest',
        account: authUser?.username || null,
        guestId: guestSession?.id || null,
    };

    players.set(socket, playerState);
    socket.data.playerState = playerState;

    if (playerState.guestId) {
        guestSessionManager.recordDisplayName(playerState.guestId, playerState.username);
    }
    socket.emit('updateRoomList', getOpenRooms());

    const handlers = {
        linkAccount: null,
        setUsername: null,
        createGame: null,
        joinGame: null,
        playerReady: null,
        startGame: null,
        submitMove: null,
        undoMove: null,
        leaveGame: null,
    };

    handlers.linkAccount = ({ accountName, displayName }) => {
        const player = players.get(socket);
        if (!player) return;

        const previousState = player;
        let stateApplied = false;
        try {
            const sanitizedAccount = sanitizeAccountName(accountName || '');
            const displayCandidate = displayName || sanitizedAccount || '';
            const { value: sanitizedDisplay } = validateDisplayNameInput(displayCandidate, {
                currentUsername: sanitizedAccount,
                uniquenessCheck: (value) => profileService.ensureDisplayNameAvailability(value, sanitizedAccount),
            });

            const nextState = { ...player };
            if (sanitizedAccount) {
                nextState.account = sanitizedAccount;
            }

            if (sanitizedDisplay) {
                nextState.username = sanitizedDisplay;
            } else if (sanitizedAccount) {
                nextState.username = sanitizedAccount;
            }

            players.set(socket, nextState);
            socket.data.playerState = nextState;
            stateApplied = true;

            if (nextState.guestId) {
                guestSessionManager.recordDisplayName(nextState.guestId, nextState.username);
            }

            syncPlayerInRoom(socket);
        } catch (error) {
            if (stateApplied) {
                players.set(socket, previousState);
                socket.data.playerState = previousState;
            }
            emitSocketError({
                socket,
                player,
                action: 'linkAccount',
                error,
                message: 'Unable to link account at this time. Please try again.',
                code: 'LINK_ACCOUNT_FAILED',
            });
        }
    };

    handlers.setUsername = (rawName) => {
        const player = players.get(socket);
        if (!player) return;

        const previousState = player;
        let stateApplied = false;
        try {
            const { value: sanitized, error } = validateDisplayNameInput(rawName, {
                currentUsername: player.account,
                uniquenessCheck: (value) => profileService.ensureDisplayNameAvailability(value, player.account),
            });

            const nextState = { ...player };
            if (sanitized) {
                nextState.username = sanitized;
            } else if (error && !player.username) {
                nextState.username = 'Guest';
            }

            players.set(socket, nextState);
            socket.data.playerState = nextState;
            stateApplied = true;

            if (nextState.guestId) {
                guestSessionManager.recordDisplayName(nextState.guestId, nextState.username);
            }

            syncPlayerInRoom(socket);
        } catch (error) {
            if (stateApplied) {
                players.set(socket, previousState);
                socket.data.playerState = previousState;
            }
            emitSocketError({
                socket,
                player,
                action: 'setUsername',
                error,
                message: 'Unable to update username at this time. Please try again.',
                code: 'SET_USERNAME_FAILED',
            });
        }
    };

    socket.data.handlers = handlers;

    Object.entries(handlers).forEach(([event, handler]) => {
        if (handler) {
            socket.on(event, handler);
        }
    });

    const getPlayer = () => {
        const p = players.get(socket);
        console.log('getPlayer called:', socket.id, p);
        return p;
    };

    const setPlayerRoom = (roomId) => {
        const player = players.get(socket);
        if (player) {
            player.inRoom = roomId;
            console.log('Player room set:', socket.id, roomId);

            if (player.guestId) {
                guestSessionManager.recordLastRoom(player.guestId, {
                    roomId,
                    gameType: modularGameServer.roomManager.getRoom(roomId)?.gameId || null,
                });
            }

            syncPlayerInRoom(socket);
        }
    };

    const clearPlayerRoom = () => {
        const player = players.get(socket);
        if (!player) return;
        player.inRoom = null;
        console.log('Player room cleared:', socket.id);
    };

    modularGameServer.attachSocket(socket, {
        getPlayer,
        setPlayerRoom,
        clearPlayerRoom,
    });

    let cleanedUp = false;
    let disconnectHandler = null;
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;

        if (disconnectHandler) {
            try {
                socket.off('disconnect', disconnectHandler);
            } catch (error) {
                console.warn('[Socket] Failed to detach disconnect handler:', error);
            }
        }

        Object.entries(handlers).forEach(([event, handler]) => {
            if (!handler) {
                return;
            }
            try {
                socket.off(event, handler);
            } catch (error) {
                console.warn(`[Socket] Failed to detach handler for ${event}:`, error);
            }
        });

        for (const eventName of socket.eventNames()) {
            if (eventName === 'disconnect' || eventName === 'newListener' || eventName === 'removeListener') {
                continue;
            }
            try {
                socket.removeAllListeners(eventName);
            } catch (error) {
                console.warn(`[Socket] Failed to remove listeners for ${eventName}:`, error);
            }
        }

        players.delete(socket);
        delete socket.data.playerState;
        delete socket.data.handlers;

        metricsCollector.decrementSocketConnections();
        delete socket.data.cleanup;
    };

    disconnectHandler = () => {
        const player = getPlayer();

        try {
            console.log(`User disconnected: ${socket.id}`);

            if (player?.guestId) {
                guestSessionManager.recordLastRoom(player.guestId, null);
            }
            if (player) {
                player.inRoom = null;
            }

            io.emit('updateRoomList', getOpenRooms());
        } catch (error) {
            console.error('[Socket] disconnect cleanup failed', {
                error: error?.message,
                stack: error?.stack,
                context: {
                    userId: socket.id,
                    room: player?.inRoom || null,
                    action: 'disconnect',
                },
            });
            if (typeof metricsCollector?.recordError === 'function') {
                metricsCollector.recordError(error, {
                    eventName: 'disconnect',
                    transport: 'socket.io',
                    userId: socket.id,
                    room: player?.inRoom || null,
                });
            }
        } finally {
            cleanup();
        }
    };

    socket.once('disconnect', disconnectHandler);

    socket.data.cleanup = cleanup;
});

function syncPlayerInRoom(socket) {
    const player = players.get(socket);
    if (!player?.inRoom) return;
    const room = modularGameServer.roomManager.getRoom(player.inRoom);
    if (!room) return;
    const participant = room.playerManager.getPlayer(socket.id);
    if (!participant) return;
    participant.displayName = player.username || participant.displayName;
    participant.metadata = {
        ...(participant.metadata || {}),
        account: player.account || null,
        guestId: player.guestId || null,
    };
    modularGameServer.notifyRoomUpdate(room.id);
}

function getOpenRooms() {
    const openRooms = {};
    console.log('Getting open rooms, total rooms:', modularGameServer.roomManager.rooms.size);

    for (const room of modularGameServer.roomManager.rooms.values()) {
        const playerCount = room.playerManager.players.size;
        console.log('Room:', room.id, 'Players:', playerCount, 'Max:', room.playerManager.maxPlayers, 'Mode:', room.metadata.mode);

        if (playerCount < room.playerManager.maxPlayers) {
            openRooms[room.id] = {
                roomId: room.id,
                gameType: room.gameId,
                mode: room.metadata.mode,
                playerCount,
                maxPlayers: room.playerManager.maxPlayers,
                hostId: room.hostId,
            };
        }
    }

    console.log('Open rooms to broadcast:', openRooms);
    return openRooms;
}

function instrumentSocketHandlers(socket) {
    const listenerMap = new Map();
    const getEventMap = (eventName) => {
        let eventMap = listenerMap.get(eventName);
        if (!eventMap) {
            eventMap = new Map();
            listenerMap.set(eventName, eventMap);
        }
        return eventMap;
    };

    const trackWrapper = (eventName, handler, wrapped) => {
        if (!handler || typeof handler !== 'function') {
            return;
        }
        getEventMap(eventName).set(handler, wrapped);
    };

    const untrackWrapper = (eventName, handler) => {
        const eventMap = listenerMap.get(eventName);
        if (!eventMap) {
            return null;
        }
        if (!handler || typeof handler !== 'function') {
            listenerMap.delete(eventName);
            return null;
        }
        const wrapped = eventMap.get(handler);
        if (wrapped) {
            eventMap.delete(handler);
            if (eventMap.size === 0) {
                listenerMap.delete(eventName);
            }
        }
        return wrapped || null;
    };

    const executeHandler = async (eventName, handler, args) => {
        const start = process.hrtime.bigint();
        try {
            const result = handler(...args);
            if (result && typeof result.then === 'function') {
                const awaited = await result;
                const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
                metricsCollector.recordSocketEvent({ eventName, durationMs });
                return awaited;
            }
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
            metricsCollector.recordSocketEvent({ eventName, durationMs });
            return result;
        } catch (error) {
            const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
            metricsCollector.recordSocketEvent({ eventName, durationMs, isError: true });
            metricsCollector.recordError(error, { eventName, transport: 'socket.io' });
            throw error;
        }
    };

    const originalOn = socket.on.bind(socket);
    const originalOnce = socket.once.bind(socket);
    const originalOff = (socket.off ? socket.off.bind(socket) : socket.removeListener.bind(socket));
    const originalRemoveListener = socket.removeListener.bind(socket);

    socket.on = (eventName, handler) => {
        if (typeof handler !== 'function') {
            return originalOn(eventName, handler);
        }
        const wrapped = (...args) => executeHandler(eventName, handler, args);
        trackWrapper(eventName, handler, wrapped);
        return originalOn(eventName, wrapped);
    };

    socket.once = (eventName, handler) => {
        if (typeof handler !== 'function') {
            return originalOnce(eventName, handler);
        }
        const wrapped = async (...args) => {
            try {
                return await executeHandler(eventName, handler, args);
            } finally {
                untrackWrapper(eventName, handler);
            }
        };
        trackWrapper(eventName, handler, wrapped);
        return originalOnce(eventName, wrapped);
    };

    const detach = (eventName, handler, originalFn) => {
        if (typeof handler !== 'function') {
            return originalFn(eventName, handler);
        }
        const wrapped = untrackWrapper(eventName, handler);
        if (wrapped) {
            return originalFn(eventName, wrapped);
        }
        return originalFn(eventName, handler);
    };

    socket.off = (eventName, handler) => detach(eventName, handler, originalOff);
    socket.removeListener = (eventName, handler) => detach(eventName, handler, originalRemoveListener);
}

async function establishSession(req, res, usernameKey, onSuccess) {
    const previousSessionId = req.sessionID;

    await new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regeneration failed:', err);
                res.status(500).send('Unable to establish session.');
                return reject(err);
            }

            if (previousSessionId) {
                csrfTokenManager.revoke(previousSessionId);
            }

            req.session.username = usernameKey;
            req.session.createdAt = Date.now();
            req.session.lastAccess = Date.now();

            req.session.save(async (saveErr) => {
                if (saveErr) {
                    console.error('Session save failed:', saveErr);
                    res.status(500).send('Unable to persist session.');
                    return reject(saveErr);
                }

                try {
                    await issueAuthenticationState(req, res, usernameKey);
                    if (typeof onSuccess === 'function') {
                        await onSuccess();
                    }
                    resolve();
                } catch (error) {
                    console.error('Failed to finalize session state:', error);
                    if (!res.headersSent) {
                        res.status(500).send('Unable to persist session.');
                    }
                    reject(error);
                }
            });
        });
    });
}

/**
 * Persist a freshly authenticated user's state across cookies and
 * upgrade any guest metadata that was captured prior to sign-in.
 */
async function issueAuthenticationState(req, res, usernameKey) {
    let userRecord = getUserRecord(usernameKey);
    if (!userRecord) {
        return;
    }

    const transfer = transferGuestSession(req, res);
    if (transfer?.data) {
        const updated = await applyGuestProgressToUser(usernameKey, transfer.data);
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

    // Clear the guest cookie immediately
    res.clearCookie(GUEST_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        path: '/',
    });

    // Invalidate the token in the manager
    guestSessionManager.invalidateToken(req.cookies?.[GUEST_COOKIE_NAME]);

    req.guestSession = null;
    return promoted;
}

/**
 * Apply guest game progress to a durable user account.
 */
async function applyGuestProgressToUser(usernameKey, guestData) {
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
        const sanitized = sanitizeDisplayName(guestData.displayName, {
            currentUsername: usernameKey,
            uniquenessCheck: (value) => profileService.ensureDisplayNameAvailability(value, usernameKey),
        });
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
        await writeUserStore(store);
    }

    return record;
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }
    next();
}

function readUserStore() {
    return profileService.readStore();
}

async function writeUserStore(store) {
    return profileService.writeStore(store);
}

function getUserRecord(usernameKey) {
    return profileService.getProfile(usernameKey);
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

async function recordSeriesWin(winnerSocketId) {
    const socket = io.sockets.sockets.get(winnerSocketId);
    if (!socket) {
        return;
    }

    const participant = players.get(socket);
    if (!participant) {
        return;
    }
    if (participant.account) {
        await incrementUserWins(participant.account);
    } else if (participant.guestId) {
        guestSessionManager.recordWin(participant.guestId);
    }
}

async function incrementUserWins(accountName) {
    return profileService.incrementWins(accountName);
}

async function updateUserAvatar(usernameKey, avatarPath) {
    const previousPath = await profileService.updateAvatar(usernameKey, avatarPath);
    if (previousPath && previousPath.startsWith('/uploads/profiles/')) {
        const absolutePath = path.join(__dirname, 'public', previousPath);
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
            } catch (error) {
                console.warn('Unable to remove previous avatar:', error);
            }
        }
    }
}

function isPortAvailable(port) {
    return new Promise((resolve, reject) => {
        const tester = net.createServer()
            .once('error', (error) => {
                if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
                    resolve(false);
                    return;
                }
                reject(error);
            })
            .once('listening', () => {
                tester.close(() => resolve(true));
            });

        tester.unref();
        tester.listen(port);
    });
}

async function findAvailablePort(preferredPort) {
    if (!Number.isInteger(preferredPort) || preferredPort < 0) {
        preferredPort = DEFAULT_PORT;
    }

    if (preferredPort === 0) {
        return 0;
    }

    const seenPorts = new Set();
    const queue = [];

    if (preferredPort > 0) {
        queue.push(preferredPort);
        seenPorts.add(preferredPort);
    }

    if (!seenPorts.has(DEFAULT_PORT)) {
        queue.push(DEFAULT_PORT);
        seenPorts.add(DEFAULT_PORT);
    }

    while (queue.length > 0) {
        const candidate = queue.shift();
        if (await isPortAvailable(candidate)) {
            return candidate;
        }
    }

    for (let candidate = DEFAULT_PORT + 1; candidate <= 65535; candidate += 1) {
        if (seenPorts.has(candidate)) {
            continue;
        }
        if (await isPortAvailable(candidate)) {
            return candidate;
        }
    }

    throw new Error('No available ports found for the server to listen on.');
}

async function startServer() {
    try {
        const requestedPort = Number.parseInt(process.env.PORT, 10);
        const desiredPort = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : DEFAULT_PORT;
        const portToUse = await findAvailablePort(requestedPort);

        if (desiredPort !== portToUse && desiredPort !== 0) {
            console.warn(`[Startup] Port ${desiredPort} is unavailable. Falling back to ${portToUse}.`);
        }

        const listener = server.listen(portToUse, () => {
            activePort = listener.address().port;
            console.log(`Server listening on port ${activePort}`);
        });

        listener.on('error', (error) => {
            console.error('[Startup] Failed to bind server listener.', error);
            process.exit(1);
        });
    } catch (error) {
        console.error('[Startup] Could not determine an available port for the server.', error);
        process.exit(1);
    }
}

startServer();
