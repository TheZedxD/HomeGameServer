'use strict';

const crypto = require('crypto');

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function generateRoomId(prefix = 'room') {
    return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
    return Date.now();
}

module.exports = {
    deepClone,
    generateRoomId,
    now,
};
