'use strict';

function createSecurityHeadersMiddleware({
    cspDirectives,
    enableHsts = true,
    hstsMaxAgeSeconds = 31536000,
    referrerPolicy = 'no-referrer',
    permissionsPolicy = "camera=(), microphone=(), geolocation=()",
} = {}) {
    const directives = cspDirectives || {
        "default-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "script-src": "'self' 'unsafe-inline'",
        "img-src": "'self' data: blob:",
        "connect-src": "'self'",
        "font-src": "'self' data:",
        "frame-ancestors": "'none'",
        "base-uri": "'self'",
    };

    const cspHeader = Object.entries(directives)
        .map(([key, value]) => `${key} ${value}`)
        .join('; ');

    return function securityHeadersMiddleware(req, res, next) {
        res.setHeader('Content-Security-Policy', cspHeader);
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Referrer-Policy', referrerPolicy);
        res.setHeader('Permissions-Policy', permissionsPolicy);
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

        if (enableHsts && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
            res.setHeader('Strict-Transport-Security', `max-age=${hstsMaxAgeSeconds}; includeSubDomains`);
        }

        next();
    };
}

module.exports = {
    createSecurityHeadersMiddleware,
};
