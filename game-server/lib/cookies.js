"use strict";

function parseCookies(header) {
    const cookies = {};
    if (!header || typeof header !== 'string') {
        return cookies;
    }
    const pairs = header.split(';');
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index === -1) {
            continue;
        }
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!key) {
            continue;
        }
        try {
            cookies[key] = decodeURIComponent(value);
        } catch (error) {
            cookies[key] = value;
        }
    }
    return cookies;
}

module.exports = {
    parseCookies,
};
