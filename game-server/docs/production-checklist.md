# Production Deployment Checklist

## Pre-Deployment

- [ ] Confirm all unit/integration tests pass (`npm test`).
- [ ] Run security quality gate: `npm run security:scan`.
- [ ] Review `npm audit --json` output for residual vulnerabilities.
- [ ] Validate benchmarking results (`npm run benchmark`) against latency budgets (HTTP P95 <200 ms, Socket.IO P95 <50 ms).
- [ ] Ensure environment variables are defined (secrets, rate limits, metrics token).
- [ ] Update Grafana dashboards and Prometheus alerts if new metrics were introduced.

## Deployment Steps

1. Deploy behind a reverse proxy/ingress that terminates TLS and forwards the original IP (`X-Forwarded-For`).
2. Configure sticky sessions or Socket.IO adapters for multi-instance scaling.
3. Enable health checks pointing to `/healthz` for readiness.
4. Ensure `/metrics` is accessible only from monitoring networks and secured with `METRICS_TOKEN`.
5. Apply infrastructure-level DDoS/WAF policies (e.g., Cloudflare, AWS Shield) to complement in-app rate limiting.

## Post-Deployment Validation

- [ ] Verify `game_server_http_request_duration_seconds` and `game_server_socket_event_duration_seconds` stay within thresholds.
- [ ] Confirm `game_server_security_events_total` remains stable (no unexpected rate-limit spikes).
- [ ] Check `/metrics/errors` for new stack traces.
- [ ] Run a smoke test covering login, matchmaking, gameplay, and avatar upload flows.

## Rollback Plan

- Maintain previous release artifacts. If regressions occur:
  1. Re-deploy the last known-good version.
  2. Restore configuration backups (secrets, environment variables).
  3. Purge CDN caches if static assets changed.
  4. Document root cause in the incident tracker.

Refer to `docs/incident-response.md` for detailed incident playbooks.
