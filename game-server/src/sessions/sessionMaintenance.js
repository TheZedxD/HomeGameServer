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

    async function deleteFileWithRetry(filePath, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                fs.unlinkSync(filePath);
                return true;
            } catch (error) {
                if ((error.code === 'EACCES' || error.code === 'EBUSY') && attempt < maxRetries) {
                    const delayMs = Math.pow(2, attempt) * 100;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                throw error;
            }
        }
        return false;
    }

    async function cleanupExpiredSessions() {
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
                        await deleteFileWithRetry(filePath);
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
