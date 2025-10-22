'use strict';

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
};

class Logger {
    constructor(options = {}) {
        this.name = options.name || 'App';
        this.level = this._parseLevel(options.level || process.env.LOG_LEVEL || 'info');
        this.isDevelopment = process.env.NODE_ENV !== 'production';
    }

    _parseLevel(level) {
        const normalized = String(level).toLowerCase();
        return LOG_LEVELS[normalized] ?? LOG_LEVELS.info;
    }

    _shouldLog(level) {
        return LOG_LEVELS[level] >= this.level;
    }

    _format(level, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`;
        return [prefix, ...args];
    }

    debug(...args) {
        if (this.isDevelopment && this._shouldLog('debug')) {
            console.log(...this._format('debug', ...args));
        }
    }

    info(...args) {
        if (this._shouldLog('info')) {
            console.log(...this._format('info', ...args));
        }
    }

    warn(...args) {
        if (this._shouldLog('warn')) {
            console.warn(...this._format('warn', ...args));
        }
    }

    error(...args) {
        if (this._shouldLog('error')) {
            console.error(...this._format('error', ...args));
        }
    }

    log(...args) {
        this.info(...args);
    }
}

function createLogger(options = {}) {
    return new Logger(options);
}

module.exports = {
    Logger,
    createLogger
};
