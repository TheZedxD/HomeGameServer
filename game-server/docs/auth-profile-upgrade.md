# Authentication & Profile Upgrade Guide

This document describes the migration path, security posture, and operational
considerations for the enhanced authentication and profile management system.

## Migration Strategy

1. **Stage the new infrastructure**
   - Deploy Redis and configure `REDIS_URL`, `PROFILE_CACHE_TTL_MS`, and
     `PROFILE_CACHE_MAX_ENTRIES` without routing traffic. The server degrades to
     in-memory caching when Redis is unreachable.
2. **Roll out JWT + double submit cookies**
   - Enable the new release in a canary environment. Existing sessions continue
     to function because legacy session cookies are still accepted during the
     transition.
   - Monitor `/api/session` responses to confirm that both session and JWT
     contexts are advertised correctly.
3. **Promote guest sessions**
   - Ensure clients request `/api/csrf-token` after authentication so that the
     new `homegame.csrf` cookie is present before issuing state-changing
     requests.
4. **Finalize rollout**
   - Once metrics confirm stability, disable the legacy CSRF token storage by
     expiring the old `_csrf` payloads. This can be done after two cache TTL
     periods to avoid disrupting outstanding requests.

## Security Analysis

| Area | Previous Approach | Enhanced Approach | Benefit |
| ---- | ----------------- | ---------------- | ------- |
| Authentication | Session cookie only | Session + JWT access token | Allows seamless reconnects and socket authentication without sacrificing server-side session control. |
| CSRF | Session-scoped token | Double-submit cookie with legacy fallback | Maintains protection while enabling stateless flows (e.g., WebSocket upgrades). |
| Guest upgrades | Manual transfer | Signed guest sessions with promotion | Prevents tampering and preserves progress atomically. |
| Avatar uploads | Raw write to disk | Sharp processing w/ format enforcement | Eliminates malicious payloads and strips metadata. |
| Display names | Regex validation | Regex + profanity + uniqueness | Blocks impersonation and unsafe content. |
| Session hygiene | Store-managed TTL | Active sweeping of stale files | Reduces disk usage and memory footprint. |

## Testing Recommendations

1. **Automated tests**
   - Run `npm test` to execute unit coverage, including profile uniqueness and
     avatar processing.
   - Execute `npm run lint` to validate security linting rules.
2. **Manual flows**
   - Create guest sessions, join a room, and then sign up. Verify that wins and
     last-played room information persist after upgrading the account.
   - Upload avatars of varying sizes and formats (PNG/JPEG/WebP). Confirm that
     outputs are normalized to the configured format and dimension.
   - Authenticate through Socket.IO and confirm errors are propagated when
     tokens are missing or invalid.
3. **Security checks**
   - Run `npm run security:scan` and verify no regressions.
   - Validate CSRF protection by attempting cross-site POST requests without the
     `homegame.csrf` cookie.

## Production Configuration Examples

```bash
# .env
SESSION_SECRET="super-secret-session"
JWT_SECRET="super-secret-jwt"
GUEST_SESSION_SECRET="super-secret-guest"
REDIS_URL="redis://redis.internal:6379"
PROFILE_CACHE_TTL_MS=30000
PROFILE_CACHE_MAX_ENTRIES=5000
AVATAR_MAX_DIMENSION=256
AVATAR_OUTPUT_FORMAT=webp
```

Ensure the upload directory (`public/uploads/profiles`) is writable by the
runtime user and served as static content via your CDN or reverse proxy with
cache-control headers as appropriate.
