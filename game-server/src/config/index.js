/**
 * Configuration Loader with Schema Validation
 *
 * Loads and validates all environment configuration with strict schema enforcement.
 * Provides sensible defaults and ensures type safety across the application.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse time string (e.g., "15m", "7d", "30s") to milliseconds
 */
function parseTimeToMs(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return null;

  const match = timeStr.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}. Use format like "15m", "7d", "30s"`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') return value;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse integer with validation
 */
function parseInteger(value, defaultValue, min = null, max = null, name = 'value') {
  const parsed = value ? parseInt(value, 10) : defaultValue;

  if (isNaN(parsed)) {
    throw new Error(`${name} must be a valid integer`);
  }

  if (min !== null && parsed < min) {
    throw new Error(`${name} must be at least ${min}, got ${parsed}`);
  }

  if (max !== null && parsed > max) {
    throw new Error(`${name} must be at most ${max}, got ${parsed}`);
  }

  return parsed;
}

/**
 * Validate secret strength
 */
function validateSecret(secret, name, required = true, minLength = 32) {
  if (!secret || secret.length === 0) {
    if (required) {
      throw new Error(
        `${name} is required. Generate one with: openssl rand -base64 ${Math.ceil(minLength * 0.75)}`
      );
    }
    return null;
  }

  if (secret.length < minLength) {
    throw new Error(
      `${name} must be at least ${minLength} characters long for security. Current length: ${secret.length}`
    );
  }

  // Check for basic entropy (should have variety of characters)
  const hasLower = /[a-z]/.test(secret);
  const hasUpper = /[A-Z]/.test(secret);
  const hasDigit = /[0-9]/.test(secret);
  const hasSpecial = /[^a-zA-Z0-9]/.test(secret);

  const varietyCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (varietyCount < 2) {
    console.warn(
      `Warning: ${name} has low entropy. Consider using a stronger secret with mixed character types.`
    );
  }

  return secret;
}

/**
 * Load environment variables from .env file if it exists
 */
function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env');

  if (!fs.existsSync(envPath)) {
    console.warn('No .env file found. Using environment variables and defaults.');
    return;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      // Skip comments and empty lines
      if (!line || line.trim().startsWith('#') || !line.includes('=')) {
        continue;
      }

      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();

      // Only set if not already in environment
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  } catch (error) {
    console.error(`Error loading .env file: ${error.message}`);
  }
}

/**
 * Load and validate configuration
 */
function loadConfig() {
  // Load .env file first
  loadEnvFile();

  const env = process.env;
  const isDevelopment = env.NODE_ENV !== 'production';
  const isTest = env.NODE_ENV === 'test';

  // Configuration object with validation
  const config = {
    // Environment
    env: env.NODE_ENV || 'development',
    isDevelopment,
    isProduction: env.NODE_ENV === 'production',
    isTest,

    // Server
    server: {
      port: parseInteger(env.PORT, 8081, 1, 65535, 'PORT'),
      originWhitelist: env.ORIGIN_WHITELIST
        ? env.ORIGIN_WHITELIST.split(',').map(o => o.trim())
        : isDevelopment
          ? ['http://localhost:8081', 'http://127.0.0.1:8081']
          : [],
      devCorsAll: parseBoolean(env.DEV_CORS_ALL, false),
    },

    // Secrets (required in production, test mode can skip)
    secrets: {
      session: validateSecret(env.SESSION_SECRET, 'SESSION_SECRET', !isTest),
      jwt: validateSecret(env.JWT_SECRET, 'JWT_SECRET', !isTest),
      jwtRefresh: validateSecret(env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', !isTest),
      guestSession: validateSecret(env.GUEST_SESSION_SECRET, 'GUEST_SESSION_SECRET', !isTest),
      csrf: validateSecret(env.CSRF_SECRET, 'CSRF_SECRET', !isTest),
      metricsToken: env.METRICS_TOKEN || null,
    },

    // Game Server Tick Configuration
    tick: {
      rate: parseInteger(env.TICK_RATE, 30, 20, 60, 'TICK_RATE'),
      snapshotRate: parseInteger(env.SNAPSHOT_RATE, 10, 5, 30, 'SNAPSHOT_RATE'),
      durationWarningMs: parseInteger(env.TICK_DURATION_WARNING_MS, 10, 1, 1000, 'TICK_DURATION_WARNING_MS'),
      deterministicRng: parseBoolean(env.DETERMINISTIC_RNG, true),
    },

    // JWT Configuration
    jwt: {
      accessTokenExpiry: env.JWT_ACCESS_TOKEN_EXPIRY || '15m',
      refreshTokenExpiry: env.JWT_REFRESH_TOKEN_EXPIRY || '7d',
      issuer: env.JWT_ISSUER || 'homegame-server',
      audience: env.JWT_AUDIENCE || 'homegame-client',
      // Computed values
      accessTokenExpiryMs: parseTimeToMs(env.JWT_ACCESS_TOKEN_EXPIRY || '15m'),
      refreshTokenExpiryMs: parseTimeToMs(env.JWT_REFRESH_TOKEN_EXPIRY || '7d'),
    },

    // Session Configuration
    session: {
      ttlMs: parseInteger(env.SESSION_TTL_MS, 86400000, 60000, null, 'SESSION_TTL_MS'),
      guestTtlMs: parseInteger(env.GUEST_SESSION_TTL_MS, 172800000, 60000, null, 'GUEST_SESSION_TTL_MS'),
    },

    // Rate Limiting
    rateLimit: {
      writeMax: parseInteger(env.RATE_LIMIT_WRITE_MAX, 300, 1, 10000, 'RATE_LIMIT_WRITE_MAX'),
      authMax: parseInteger(env.AUTH_RATE_LIMIT_MAX, 10, 1, 1000, 'AUTH_RATE_LIMIT_MAX'),
      socketEventLimit: parseInteger(env.SOCKET_EVENT_RATE_LIMIT, 80, 1, 1000, 'SOCKET_EVENT_RATE_LIMIT'),
      socketConnectionLimit: parseInteger(env.SOCKET_CONNECTION_RATE_LIMIT, 120, 1, 1000, 'SOCKET_CONNECTION_RATE_LIMIT'),
      burst: parseInteger(env.RATE_LIMIT_BURST, 10, 1, 100, 'RATE_LIMIT_BURST'),
    },

    // Socket.IO Configuration
    socketIO: {
      maxHttpBufferSize: parseInteger(env.MAX_HTTP_BUFFER_SIZE, 1048576, 1024, 10485760, 'MAX_HTTP_BUFFER_SIZE'),
      pingTimeout: parseInteger(env.PING_TIMEOUT, 20000, 5000, 120000, 'PING_TIMEOUT'),
      pingInterval: parseInteger(env.PING_INTERVAL, 25000, 5000, 120000, 'PING_INTERVAL'),
      connectionTimeout: parseInteger(env.CONNECTION_TIMEOUT, 45000, 5000, 300000, 'CONNECTION_TIMEOUT'),
    },

    // Room Configuration
    room: {
      maxPlayersPerRoom: parseInteger(env.MAX_PLAYERS_PER_ROOM, 8, 2, 100, 'MAX_PLAYERS_PER_ROOM'),
      idleTimeoutMs: parseInteger(env.ROOM_IDLE_TIMEOUT_MS, 1800000, 60000, null, 'ROOM_IDLE_TIMEOUT_MS'),
      maxRooms: parseInteger(env.MAX_ROOMS, 100, 1, 10000, 'MAX_ROOMS'),
      enableCleanup: parseBoolean(env.ENABLE_ROOM_CLEANUP, true),
      cleanupIntervalMs: parseInteger(env.ROOM_CLEANUP_INTERVAL_MS, 60000, 10000, 600000, 'ROOM_CLEANUP_INTERVAL_MS'),
    },

    // Input Validation & Security
    security: {
      maxCommandPayloadSize: parseInteger(env.MAX_COMMAND_PAYLOAD_SIZE, 10240, 256, 1048576, 'MAX_COMMAND_PAYLOAD_SIZE'),
      enableInputSanitization: parseBoolean(env.ENABLE_INPUT_SANITIZATION, true),
      enableSequenceValidation: parseBoolean(env.ENABLE_SEQUENCE_VALIDATION, true),
      maxSequenceDrift: parseInteger(env.MAX_SEQUENCE_DRIFT, 100, 10, 10000, 'MAX_SEQUENCE_DRIFT'),
      enableProfanityFilter: parseBoolean(env.ENABLE_PROFANITY_FILTER, true),
    },

    // File Upload Configuration
    upload: {
      maxSize: parseInteger(env.MAX_UPLOAD_SIZE, 2097152, 1024, 10485760, 'MAX_UPLOAD_SIZE'),
      avatarMaxDimension: parseInteger(env.AVATAR_MAX_DIMENSION, 256, 64, 2048, 'AVATAR_MAX_DIMENSION'),
      avatarOutputFormat: ['webp', 'png'].includes(env.AVATAR_OUTPUT_FORMAT)
        ? env.AVATAR_OUTPUT_FORMAT
        : 'webp',
    },

    // HTTP Body Limits
    http: {
      bodyLimit: env.HTTP_BODY_LIMIT || '256kb',
      formBodyLimit: env.FORM_BODY_LIMIT || '512kb',
    },

    // Redis Configuration
    redis: {
      url: env.REDIS_URL || null,
      keyPrefix: env.REDIS_KEY_PREFIX || 'homegame:',
      enableCache: parseBoolean(env.ENABLE_REDIS_CACHE, false),
      profileCacheTtlMs: parseInteger(env.PROFILE_CACHE_TTL_MS, 15000, 1000, 3600000, 'PROFILE_CACHE_TTL_MS'),
      profileCacheMaxEntries: parseInteger(env.PROFILE_CACHE_MAX_ENTRIES, 2000, 100, 100000, 'PROFILE_CACHE_MAX_ENTRIES'),
    },

    // Logging Configuration
    logging: {
      level: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(env.LOG_LEVEL)
        ? env.LOG_LEVEL
        : 'info',
      pretty: parseBoolean(env.LOG_PRETTY, isDevelopment),
      dir: env.LOG_DIR || null,
      enableRotation: parseBoolean(env.ENABLE_LOG_ROTATION, false),
      maxSize: parseInteger(env.LOG_MAX_SIZE, 10485760, 1024, null, 'LOG_MAX_SIZE'),
      maxFiles: parseInteger(env.LOG_MAX_FILES, 7, 1, 365, 'LOG_MAX_FILES'),
    },

    // Metrics & Observability
    metrics: {
      enable: parseBoolean(env.ENABLE_METRICS, true),
      intervalMs: parseInteger(env.METRICS_INTERVAL_MS, 5000, 1000, 60000, 'METRICS_INTERVAL_MS'),
      enableProfiling: parseBoolean(env.ENABLE_PROFILING, false),
      enableTracing: parseBoolean(env.ENABLE_TRACING, false),
      traceSampleRate: parseFloat(env.TRACE_SAMPLE_RATE) || 0.1,
    },

    // Database Configuration
    database: {
      userDataFile: env.USER_DATA_FILE || 'data/users.json',
      enableFileLocking: parseBoolean(env.ENABLE_FILE_LOCKING, true),
      lockRetries: parseInteger(env.FILE_LOCK_RETRIES, 3, 1, 10, 'FILE_LOCK_RETRIES'),
      lockRetryDelayMs: parseInteger(env.FILE_LOCK_RETRY_DELAY_MS, 100, 10, 5000, 'FILE_LOCK_RETRY_DELAY_MS'),
    },

    // Feature Flags
    features: {
      enableGuestSessions: parseBoolean(env.ENABLE_GUEST_SESSIONS, true),
      enableUserRegistration: parseBoolean(env.ENABLE_USER_REGISTRATION, true),
      enableAvatarUploads: parseBoolean(env.ENABLE_AVATAR_UPLOADS, true),
      enablePluginHotReload: parseBoolean(env.ENABLE_PLUGIN_HOT_RELOAD, isDevelopment),
      enableGameUndo: parseBoolean(env.ENABLE_GAME_UNDO, true),
    },

    // Development & Testing
    dev: {
      debug: parseBoolean(env.DEBUG, false),
      testMode: parseBoolean(env.TEST_MODE, isTest),
      testSeed: env.TEST_SEED || null,
    },
  };

  // Computed properties
  config.tick.intervalMs = Math.floor(1000 / config.tick.rate);
  config.tick.snapshotIntervalMs = Math.floor(1000 / config.tick.snapshotRate);

  // Validation: Snapshot rate should not exceed tick rate
  if (config.tick.snapshotRate > config.tick.rate) {
    throw new Error(
      `SNAPSHOT_RATE (${config.tick.snapshotRate}) cannot exceed TICK_RATE (${config.tick.rate})`
    );
  }

  // Validation: Ping interval should be less than ping timeout
  if (config.socketIO.pingInterval >= config.socketIO.pingTimeout) {
    throw new Error(
      `PING_INTERVAL (${config.socketIO.pingInterval}) must be less than PING_TIMEOUT (${config.socketIO.pingTimeout})`
    );
  }

  return Object.freeze(config);
}

/**
 * Print configuration summary (safe - no secrets)
 */
function printConfigSummary(config) {
  console.log('='.repeat(80));
  console.log('HomeGameServer Configuration');
  console.log('='.repeat(80));
  console.log(`Environment: ${config.env}`);
  console.log(`Server Port: ${config.server.port}`);
  console.log(`Tick Rate: ${config.tick.rate} Hz (${config.tick.intervalMs}ms interval)`);
  console.log(`Snapshot Rate: ${config.tick.snapshotRate} Hz (${config.tick.snapshotIntervalMs}ms interval)`);
  console.log(`Max Rooms: ${config.room.maxRooms}`);
  console.log(`Max Players/Room: ${config.room.maxPlayersPerRoom}`);
  console.log(`Log Level: ${config.logging.level}`);
  console.log(`Metrics Enabled: ${config.metrics.enable}`);
  console.log(`Redis Enabled: ${config.redis.url ? 'Yes' : 'No'}`);
  console.log(`CORS Origins: ${config.server.originWhitelist.join(', ') || 'None configured'}`);
  console.log('='.repeat(80));
}

// Export singleton instance
let configInstance = null;

function getConfig(reload = false) {
  if (!configInstance || reload) {
    try {
      configInstance = loadConfig();

      // Print summary on first load in non-test mode
      if (!configInstance.isTest && !reload) {
        printConfigSummary(configInstance);
      }
    } catch (error) {
      console.error('Configuration Error:', error.message);
      console.error('\nPlease check your .env file and ensure all required variables are set.');
      console.error('See .env.example for a template.\n');
      process.exit(1);
    }
  }

  return configInstance;
}

module.exports = {
  getConfig,
  loadConfig,
  parseTimeToMs,
  parseBoolean,
  parseInteger,
  validateSecret,
};
