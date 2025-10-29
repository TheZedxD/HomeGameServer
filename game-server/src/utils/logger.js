'use strict';

/**
 * Structured Logging with Pino
 *
 * Provides context-rich, structured logging with support for:
 * - JSON logging for production
 * - Pretty printing for development
 * - Child loggers with context (roomId, playerId, etc.)
 * - Log rotation and file output
 * - Performance optimized
 */

const pino = require('pino');
const fs = require('fs');
const path = require('path');

let pinoInstance = null;
let config = null;

/**
 * Initialize pino logger with configuration
 */
function initializeLogger(appConfig = null) {
  config = appConfig;

  const pinoConfig = {
    level: config?.logging?.level || process.env.LOG_LEVEL || 'info',
    // Base configuration for all log entries
    base: {
      pid: process.pid,
      hostname: require('os').hostname(),
      env: config?.env || process.env.NODE_ENV || 'development',
    },
    // Timestamp function
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };

  // Transport configuration for development (pretty printing)
  const isDevelopment = config?.isDevelopment ?? process.env.NODE_ENV !== 'production';
  const usePretty = config?.logging?.pretty ?? isDevelopment;

  if (usePretty) {
    pinoConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    };
  }

  // File logging configuration
  const logDir = config?.logging?.dir;
  if (logDir) {
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'server.log');

    // Multi-stream configuration (console + file)
    const streams = [
      { stream: process.stdout },
      { stream: fs.createWriteStream(logFile, { flags: 'a' }) },
    ];

    pinoInstance = pino(pinoConfig, pino.multistream(streams));
  } else {
    pinoInstance = pino(pinoConfig);
  }

  return pinoInstance;
}

/**
 * Get or create the logger instance
 */
function getLogger() {
  if (!pinoInstance) {
    pinoInstance = initializeLogger();
  }
  return pinoInstance;
}

/**
 * Create a child logger with additional context
 *
 * @param {Object} bindings - Context to bind to all log entries
 * @returns {Object} Child logger
 *
 * @example
 * const logger = createLogger({ roomId: 'abc123', playerId: 'player-1' });
 * logger.info('Player joined room'); // Includes roomId and playerId in log
 */
function createLogger(bindings = {}) {
  const logger = getLogger();
  return bindings && Object.keys(bindings).length > 0
    ? logger.child(bindings)
    : logger;
}

/**
 * Create a logger for a specific module/component
 *
 * @param {String} name - Module or component name
 * @returns {Object} Logger with module context
 */
function createModuleLogger(name) {
  return createLogger({ module: name });
}

/**
 * Create a request logger middleware for Express
 *
 * @returns {Function} Express middleware
 */
function createRequestLogger() {
  const logger = getLogger();

  return (req, res, next) => {
    const startTime = Date.now();

    // Log on response finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      logger.info({
        req: {
          method: req.method,
          url: req.url,
          headers: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
          },
          remoteAddress: req.ip || req.connection.remoteAddress,
        },
        res: {
          statusCode: res.statusCode,
        },
        responseTime: duration,
      }, `${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
    });

    next();
  };
}

/**
 * Logger wrapper class for backward compatibility
 * Maintains the same API as the old logger
 */
class Logger {
  constructor(options = {}) {
    this.name = options.name || 'App';
    this.context = options.context || {};
    this.logger = createLogger({ component: this.name, ...this.context });
  }

  /**
   * Add context to logger (creates child logger)
   */
  child(bindings) {
    return new Logger({
      name: this.name,
      context: { ...this.context, ...bindings },
    });
  }

  trace(...args) {
    this._log('trace', ...args);
  }

  debug(...args) {
    this._log('debug', ...args);
  }

  info(...args) {
    this._log('info', ...args);
  }

  warn(...args) {
    this._log('warn', ...args);
  }

  error(...args) {
    this._log('error', ...args);
  }

  fatal(...args) {
    this._log('fatal', ...args);
  }

  log(...args) {
    this.info(...args);
  }

  /**
   * Internal method to handle logging with structured data
   */
  _log(level, ...args) {
    // Handle different argument patterns:
    // 1. logger.info('message')
    // 2. logger.info({ key: 'value' }, 'message')
    // 3. logger.info('message', error)

    if (args.length === 0) return;

    const firstArg = args[0];
    const isObject = typeof firstArg === 'object' && firstArg !== null && !(firstArg instanceof Error);

    if (isObject) {
      // Structured logging: logger.info({ roomId: 'abc' }, 'message')
      const [data, ...rest] = args;
      const message = rest.find(arg => typeof arg === 'string') || '';
      const error = rest.find(arg => arg instanceof Error);

      if (error) {
        this.logger[level]({ ...data, err: error }, message);
      } else {
        this.logger[level](data, message);
      }
    } else if (firstArg instanceof Error) {
      // Error logging: logger.error(error)
      const [error, ...rest] = args;
      const message = rest.find(arg => typeof arg === 'string') || error.message;
      this.logger[level]({ err: error }, message);
    } else {
      // Simple message: logger.info('message')
      this.logger[level](args.join(' '));
    }
  }
}

module.exports = {
  initializeLogger,
  getLogger,
  createLogger,
  createModuleLogger,
  createRequestLogger,
  Logger,
};
