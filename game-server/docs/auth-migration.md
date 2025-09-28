# Authentication Modernization Overview

## Summary
The authentication layer now issues signed JSON Web Tokens (JWT) alongside legacy server sessions. JWTs are delivered via HttpOnly cookies while the CSRF double-submit pattern protects all state-changing requests. Anonymous players receive durable guest sessions that persist progress until an account upgrade occurs. Socket.IO connections are authenticated via the same cookie material to maintain continuity between HTTP and WebSocket flows.

## Migration Strategy
1. **Phase 1 – Parallel tokens**
   - Deploy the updated server without invalidating existing `homegame.sid` sessions. The middleware automatically mints JWTs for any active legacy session.
   - Monitor the `/api/session` response to confirm `authMethod` transitions from `session` to `jwt` as returning users receive the new cookies.
2. **Phase 2 – Client adoption**
   - Update front-end API clients to send the `x-csrf-token` header sourced from the new `homegame.csrf` cookie. Existing `_csrf` payloads remain supported for backward compatibility during the rollout.
   - Adjust Socket.IO clients to handle `connect_error` events so they can prompt a refresh when authentication fails.
3. **Phase 3 – Session retirement (optional)**
   - After verifying that all active clients rely on JWTs, gradually shorten the TTL of `homegame.sid` until it can be removed. The FileStore may then be decommissioned in favor of stateless auth plus guest persistence files.

## Security Analysis
| Area | Previous Implementation | New Implementation | Impact |
| ---- | ----------------------- | ------------------ | ------ |
| HTTP auth | Server-side `express-session` cookie | `express-session` + JWT (HttpOnly cookie) | Adds stateless validation for Socket.IO and API clients while maintaining compatibility |
| CSRF | Pseudo-random token stored server-side per session | Double-submit cookie (`homegame.csrf`) with legacy fallback | Simplifies validation and allows stateless flows without lowering security |
| Guest handling | Ephemeral in-memory per-socket names | File-backed guest session store with signed cookies | Preserves progress across reconnects and enables secure upgrades |
| Socket.IO | Unauthenticated handshake | Cookie-based middleware verifying JWT/guest signature | Prevents unauthorized socket access and standardizes error propagation |
| Data cleanup | Session map only | Scheduled guest-session pruning + logout regeneration | Reduces long-lived anonymous data and protects memory usage |

## Testing Recommendations
- **Unit/Integration**
  - Verify `/api/csrf-token` sets both JSON payload tokens and the `homegame.csrf` cookie.
  - Ensure `/api/session` returns accurate `authMethod`, `guest`, and `guestUpgrade` metadata for guest, legacy, and authenticated scenarios.
- **Authentication flows**
  1. Anonymous guest -> play match -> upgrade account -> confirm wins transfer.
  2. Legacy authenticated user -> hit `/api/session` -> confirm new JWT cookie minted without logout.
  3. Attempt authenticated POST with mismatched CSRF header and cookie -> expect HTTP 403.
  4. Socket.IO connection with missing/invalid cookies -> expect `connect_error` on client.
- **Regression**
  - Run existing gameplay integration tests to ensure room lifecycle unchanged.
  - Upload avatar workflow should now rely on `req.user` rather than session fields.

## Production Configuration
- Set strong secrets:
  ```bash
  export SESSION_SECRET="$(openssl rand -hex 32)"
  export JWT_SECRET="$(openssl rand -hex 32)"
  export GUEST_SESSION_SECRET="$(openssl rand -hex 32)"
  ```
- Enable TLS/HTTPS so secure cookies (`secure: true`) remain accessible.
- Configure a log monitor for `Socket authentication failed` entries to detect tampering attempts.
- Persist the `data/guest-sessions.json` file on a reliable volume and ensure appropriate file permissions (`600`).

