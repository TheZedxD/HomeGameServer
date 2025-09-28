"use strict";

const BASE_WORDS = [
    'abuse',
    'ass',
    'bastard',
    'damn',
    'darn',
    'hell',
    'jerk',
    'loser',
    'noob',
    'suck',
];

const customWords = new Set(BASE_WORDS.map((word) => word.toLowerCase()));

function normalizeToken(token) {
    return token
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function tokenize(text) {
    return String(text)
        .split(/\s+/)
        .map(normalizeToken)
        .filter(Boolean);
}

function containsProfanity(text) {
    if (typeof text !== 'string') {
        return false;
    }
    const tokens = tokenize(text);
    return tokens.some((token) => customWords.has(token));
}

function addProfanityWords(words) {
    if (!Array.isArray(words)) {
        return;
    }
    for (const word of words) {
        if (typeof word === 'string' && word.trim()) {
            customWords.add(word.trim().toLowerCase());
        }
    }
}

module.exports = {
    containsProfanity,
    addProfanityWords,
};
