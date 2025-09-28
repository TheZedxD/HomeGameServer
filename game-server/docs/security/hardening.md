# Security Hardening Overview

This document describes the security controls enforced by the production game server and how to operate the security toolchain.

## HTTP & WebSocket Protection

- **Security headers** enforce CSP, HSTS, and cross-origin isolation for all HTTP responses via `createSecurityHeadersMiddleware`. This mitigates XSS, clickjacking, and mixed-content issues.
- **Origin whitelisting** rejects CORS requests from unknown domains. Configure `ALLOWED_ORIGINS` for production deployments.
- **Session management** uses HttpOnly, Secure cookies with rolling renewal and CSRF protection. JWTs issued per session allow stateless Socket.IO authentication.
- **Rate limiting** guards against brute-force and DDoS attacks:
  - Global write limiter (POST/PUT/PATCH/DELETE) with `RATE_LIMIT_WRITE_MAX`.
  - Authentication limiter (`AUTH_RATE_LIMIT_MAX`) for login/sign-up.
  - Socket handshake limiter (`SOCKET_CONNECTION_RATE_LIMIT`) and per-event limiter (`SOCKET_EVENT_RATE_LIMIT`).
- **Input validation** centralised in `src/security/validators.js` enforces safe usernames, display names, room codes, and strong passwords.
- **File upload controls** restrict avatar uploads to 2 MB and perform type detection before persistence.

## Automated Security Testing

Run a full security scan locally or in CI:

```bash
npm run security:scan
```

This command executes:

1. `scripts/security-lint.js` – static checks for dangerous patterns, powered by `config/security-rules.json` (customisable per game plugin).
2. `npm audit --json` – blocks builds with high/critical vulnerabilities.

Integrate the script as a quality gate in CI/CD pipelines. The script exits with a non-zero status when findings exist.

## Dependency Management

- Keep `package-lock.json` committed to lock dependency versions.
- Review `npm audit` reports regularly and patch vulnerable packages.
- Document risk acceptance for unavoidable third-party issues.

## Secrets & Configuration

Environment variables drive secure defaults:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET`, `JWT_SECRET`, `GUEST_SESSION_SECRET` | Cryptographic secrets for cookies and tokens. Rotate periodically. |
| `ALLOWED_ORIGINS` | Comma-separated list of trusted front-end domains. |
| `METRICS_TOKEN` | Bearer token required to query `/metrics`. |
| `RATE_LIMIT_WRITE_MAX`, `AUTH_RATE_LIMIT_MAX` | Tune HTTP rate limiting thresholds. |
| `SOCKET_EVENT_RATE_LIMIT`, `SOCKET_CONNECTION_RATE_LIMIT` | Socket.IO throttling thresholds. |

Ensure these values are injected securely (e.g., Kubernetes secrets, AWS Parameter Store).

## Operational Security Tasks

- Review `docs/production-checklist.md` before each deployment.
- Monitor `/metrics` (protected by bearer token) for `game_server_security_events_total` spikes.
- Investigate error logs via `/metrics/errors` endpoint – integrates with SIEM or log collectors.

## Incident Response Hooks

Security events (rate limit triggers, CORS blocks, runtime exceptions) are recorded in the metrics registry for alerting pipelines. Refer to `docs/incident-response.md` for detailed runbooks.
