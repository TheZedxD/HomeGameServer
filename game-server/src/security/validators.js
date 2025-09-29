'use strict';

const { containsProfanity } = require('./profanityFilter');

const COMMON_PASSWORDS = new Set([
    '123456',
    'password',
    '12345678',
    'qwerty',
    'abc123',
    'password1',
    '111111',
    '1234567890',
    'letmein',
    'welcome',
]);

const PASSWORD_RATE_LIMIT_MAX_ATTEMPTS = 5;
const PASSWORD_RATE_LIMIT_WINDOW_MS = 60_000;
const passwordValidationAttempts = new Map();

const ACCOUNT_NAME_REGEX = /^[a-zA-Z0-9_-]{3,24}$/;
const DISPLAY_NAME_REGEX = /^[\p{L}\p{N} _'’.-]{1,24}$/u;
const ROOM_CODE_REGEX = /^[A-Z0-9]{3,10}$/;
const SERVER_GENERATED_ROOM_CODE_REGEX = /^[A-Z]+_[A-F0-9]{8}$/i;

function normalizeWhitespace(value) {
    return String(value)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function validateDisplayNameInput(name, options = {}) {
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

    if (!options.allowProfanity && containsProfanity(normalized)) {
        return { value: null, error: 'Display name contains inappropriate language.' };
    }

    if (typeof options.uniquenessCheck === 'function') {
        const conflict = options.uniquenessCheck(normalized);
        if (conflict && (!options.currentUsername || conflict !== options.currentUsername.toLowerCase())) {
            return { value: null, error: 'Display name is already in use.' };
        }
    }

    return { value: normalized, error: null };
}

function sanitizeDisplayName(name, options = {}) {
    const { value } = validateDisplayNameInput(name, options);
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

function getPasswordRateLimitBucket(key) {
    const now = Date.now();
    const bucket = passwordValidationAttempts.get(key);

    if (!bucket || now - bucket.windowStart > PASSWORD_RATE_LIMIT_WINDOW_MS) {
        const freshBucket = { windowStart: now, attempts: 0 };
        passwordValidationAttempts.set(key, freshBucket);
        return freshBucket;
    }

    return bucket;
}

function isRateLimitedForPassword(key) {
    const bucket = getPasswordRateLimitBucket(key);
    if (bucket.attempts >= PASSWORD_RATE_LIMIT_MAX_ATTEMPTS) {
        return true;
    }
    bucket.attempts += 1;
    return false;
}

function calculateShannonEntropy(value) {
    if (!value) {
        return 0;
    }

    const length = value.length;
    const counts = new Map();

    for (const char of value) {
        counts.set(char, (counts.get(char) || 0) + 1);
    }

    let entropy = 0;
    for (const count of counts.values()) {
        const probability = count / length;
        entropy -= probability * Math.log2(probability);
    }

    return entropy;
}

function validatePasswordInput(password, options = {}) {
    const { username = '', identifier } = options;
    const rateLimitKey = String(identifier || username || 'global').toLowerCase();

    if (isRateLimitedForPassword(rateLimitKey)) {
        return {
            valid: false,
            message: 'Too many password validation attempts. Please wait before trying again.'
        };
    }

    if (typeof password !== 'string') {
        return { valid: false, message: 'Password must be a string.' };
    }

    if (password.length < 12) {
        return { valid: false, message: 'Password must be at least 12 characters long.' };
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

    const normalizedPassword = password.toLowerCase();
    if (COMMON_PASSWORDS.has(normalizedPassword)) {
        return { valid: false, message: 'Password is too common and easily guessable.' };
    }

    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (normalizedUsername && normalizedPassword.includes(normalizedUsername)) {
        return { valid: false, message: 'Password must not contain your username.' };
    }

    const entropy = calculateShannonEntropy(password);
    if (entropy < 3) {
        return { valid: false, message: 'Password must have a minimum Shannon entropy of 3.0 bits.' };
    }

    return { valid: true, message: null };
}

function sanitizeRoomCode(roomCode) {
    if (typeof roomCode !== 'string') {
        return null;
    }

    const trimmed = roomCode.trim();
    if (!trimmed) {
        return null;
    }

    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ROOM_CODE_REGEX.test(upper)) {
        return upper;
    }

    if (SERVER_GENERATED_ROOM_CODE_REGEX.test(trimmed)) {
        const match = trimmed.match(/^([A-Z]+)_([A-F0-9]{8})$/i);
        if (!match) {
            return null;
        }
        const [, prefix, suffix] = match;
        return `${prefix.toLowerCase()}_${suffix.toLowerCase()}`;
    }

    const compactMatch = trimmed.match(/^([A-Z]+)([A-F0-9]{8})$/i);
    if (compactMatch) {
        const [, prefix, suffix] = compactMatch;
        return `${prefix.toLowerCase()}_${suffix.toLowerCase()}`;
    }

    return null;
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
