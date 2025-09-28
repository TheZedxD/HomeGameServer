"use strict";

const crypto = require('crypto');
const { signJwt, verifyJwt } = require('./jwt');

const ACCESS_TOKEN_COOKIE = 'homegame.token';
const CSRF_TOKEN_COOKIE = 'homegame.csrf';
const TOKEN_DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days
const CSRF_TOKEN_MAX_AGE_MS = 1000 * 60 * 60; // 1 hour
const JWT_AUDIENCE = 'homegame-client';
const JWT_ISSUER = 'homegame-server';

function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

function createAccessToken(payload, secret, options = {}) {
    const baseClaims = {
        ...payload,
        type: 'access',
    };
    return signJwt(baseClaims, secret, {
        expiresIn: options.expiresIn || TOKEN_DEFAULT_EXPIRY_SECONDS,
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
    });
}

function verifyAccessToken(token, secret) {
    try {
        return verifyJwt(token, secret, {
            audience: JWT_AUDIENCE,
            issuer: JWT_ISSUER,
        });
    } catch (error) {
        return null;
    }
}

function setAccessTokenCookie(res, token, { secure }) {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        maxAge: TOKEN_DEFAULT_EXPIRY_SECONDS * 1000,
        path: '/',
    });
}

function setCsrfCookie(res, token, { secure }) {
    res.cookie(CSRF_TOKEN_COOKIE, token, {
        httpOnly: false,
        sameSite: 'strict',
        secure,
        maxAge: CSRF_TOKEN_MAX_AGE_MS,
        path: '/',
    });
}

function clearAuthCookies(res, { secure }) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
    });
    res.clearCookie(CSRF_TOKEN_COOKIE, {
        httpOnly: false,
        sameSite: 'strict',
        secure,
        path: '/',
    });
}

function getAccessTokenFromRequest(req) {
    return req.cookies?.[ACCESS_TOKEN_COOKIE] || null;
}

function getCsrfCookie(req) {
    return req.cookies?.[CSRF_TOKEN_COOKIE] || null;
}

module.exports = {
    ACCESS_TOKEN_COOKIE,
    CSRF_TOKEN_COOKIE,
    TOKEN_DEFAULT_EXPIRY_SECONDS,
    CSRF_TOKEN_MAX_AGE_MS,
    generateCsrfToken,
    createAccessToken,
    verifyAccessToken,
    setAccessTokenCookie,
    setCsrfCookie,
    clearAuthCookies,
    getAccessTokenFromRequest,
    getCsrfCookie,
};
