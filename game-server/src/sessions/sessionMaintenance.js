"use strict";

const fs = require('fs');
const path = require('path');

function createSessionMaintenance(options = {}) {
    const sessionDir = options.sessionDir;
    const ttlMs = options.ttlMs || 1000 * 60 * 60 * 24 * 7;
    const sweepIntervalMs = options.sweepIntervalMs || 1000 * 60 * 30;
    const logger = options.logger || console;
    let timer = null;

    if (!sessionDir) {
        throw new Error('Session maintenance requires a sessionDir path.');
    }

    function cleanupExpiredSessions() {
        try {
            const entries = fs.readdirSync(sessionDir);
            const now = Date.now();
            for (const entry of entries) {
                const filePath = path.join(sessionDir, entry);
                let stats;
                try {
                    stats = fs.statSync(filePath);
                } catch (error) {
                    continue;
                }
                const ageMs = now - stats.mtimeMs;
                if (ageMs > ttlMs * 1.5) {
                    try {
                        fs.unlinkSync(filePath);
                        logger.debug?.('Removed expired session file:', filePath);
                    } catch (error) {
                        logger.warn?.('Unable to remove expired session file:', filePath, error.message);
                    }
                }
            }
        } catch (error) {
            logger.warn?.('Session maintenance sweep failed:', error.message);
        }
    }

    return {
        start() {
            if (timer) {
                return;
            }
            timer = setInterval(cleanupExpiredSessions, sweepIntervalMs);
            if (timer.unref) {
                timer.unref();
            }
            cleanupExpiredSessions();
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        sweepNow: cleanupExpiredSessions,
    };
}

module.exports = {
    createSessionMaintenance,
};
