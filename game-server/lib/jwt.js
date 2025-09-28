"use strict";

const crypto = require('crypto');

function base64UrlEncode(input) {
    if (typeof input === 'object') {
        input = JSON.stringify(input);
    }
    return Buffer.from(String(input)).toString('base64url');
}

function base64UrlDecode(str) {
    return Buffer.from(str, 'base64url').toString('utf8');
}

function signJwt(payload, secret, options = {}) {
    const header = {
        alg: 'HS256',
        typ: 'JWT',
    };
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn || 0;
    const body = {
        iat: issuedAt,
        ...(expiresIn ? { exp: issuedAt + Number(expiresIn) } : {}),
        ...(options.notBefore ? { nbf: issuedAt + Number(options.notBefore) } : {}),
        ...(options.audience ? { aud: options.audience } : {}),
        ...(options.issuer ? { iss: options.issuer } : {}),
        ...payload,
    };
    const encodedHeader = base64UrlEncode(header);
    const encodedPayload = base64UrlEncode(body);
    const signature = createSignature(`${encodedHeader}.${encodedPayload}`, secret);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token, secret, options = {}) {
    if (typeof token !== 'string') {
        throw new Error('Invalid token');
    }
    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('Invalid token');
    }
    const [encodedHeader, encodedPayload, signature] = segments;
    const expectedSignature = createSignature(`${encodedHeader}.${encodedPayload}`, secret);
    const provided = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new Error('Invalid signature');
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && now >= payload.exp) {
        throw new Error('Token expired');
    }
    if (typeof payload.nbf === 'number' && now < payload.nbf) {
        throw new Error('Token not yet valid');
    }
    if (options.audience && payload.aud !== options.audience) {
        throw new Error('Invalid audience');
    }
    if (options.issuer && payload.iss !== options.issuer) {
        throw new Error('Invalid issuer');
    }
    return payload;
}

function createSignature(content, secret) {
    return crypto.createHmac('sha256', secret).update(content).digest('base64url');
}

module.exports = {
    signJwt,
    verifyJwt,
};
