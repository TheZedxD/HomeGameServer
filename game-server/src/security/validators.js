'use strict';

const ACCOUNT_NAME_REGEX = /^[a-zA-Z0-9_-]{3,24}$/;
const DISPLAY_NAME_REGEX = /^[\p{L}\p{N} _'’.-]{1,24}$/u;
const ROOM_CODE_REGEX = /^[A-Z0-9]{3,10}$/;

function normalizeWhitespace(value) {
    return String(value)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function validateDisplayNameInput(name) {
    if (name === undefined || name === null) {
        return { value: null, error: 'Display name must contain at least one visible character.' };
    }

    const normalized = normalizeWhitespace(name);

    if (!normalized) {
        return { value: null, error: 'Display name must contain at least one visible character.' };
    }

    if (normalized.length > 24) {
        return { value: null, error: 'Display name must be 24 characters or fewer.' };
    }

    if (!DISPLAY_NAME_REGEX.test(normalized)) {
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
    if (typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    if (!ACCOUNT_NAME_REGEX.test(trimmed)) {
        const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
        return ACCOUNT_NAME_REGEX.test(cleaned) ? cleaned : null;
    }
    return trimmed;
}

function validatePasswordInput(password) {
    if (typeof password !== 'string') {
        return { valid: false, message: 'Password must be a string.' };
    }
    if (password.length < 10) {
        return { valid: false, message: 'Password must be at least 10 characters long.' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one uppercase letter.' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one lowercase letter.' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one number.' };
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain at least one special character.' };
    }
    return { valid: true, message: null };
}

function sanitizeRoomCode(roomCode) {
    if (typeof roomCode !== 'string') {
        return null;
    }
    const upper = roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ROOM_CODE_REGEX.test(upper) ? upper : null;
}

function sanitizeTextInput(input, { maxLength = 256, allowNewLines = false } = {}) {
    if (typeof input !== 'string') {
        return null;
    }
    let normalized = allowNewLines ? input.replace(/[\r]+/g, '') : normalizeWhitespace(input);
    if (!allowNewLines) {
        normalized = normalized.replace(/\s+/g, ' ');
    }
    normalized = normalized.slice(0, maxLength);
    return normalized;
}

function validateIntegerRange(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return { valid: false, value: null };
    }
    if (numeric < min || numeric > max) {
        return { valid: false, value: null };
    }
    return { valid: true, value: numeric };
}

module.exports = {
    sanitizeAccountName,
    sanitizeDisplayName,
    sanitizeRoomCode,
    sanitizeTextInput,
    validateDisplayNameInput,
    validateIntegerRange,
    validatePasswordInput,
};
