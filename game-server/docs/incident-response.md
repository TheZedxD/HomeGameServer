# Incident Response Playbook

## Roles

- **Incident Commander (IC):** Coordinates response, communication, and resolution.
- **Communications Lead:** Provides stakeholder updates and manages customer messaging.
- **Operations Engineer:** Executes mitigations, performs rollbacks, restores services.
- **Security Engineer:** Handles abuse, intrusion attempts, and coordinates with WAF/CDN teams.

## Severity Levels

| Level | Definition | Examples |
| --- | --- | --- |
| SEV-1 | Full outage or security breach affecting >50% of users | Authentication failure, data exposure |
| SEV-2 | Major degradation impacting gameplay or latency SLOs | Socket latency >100 ms P95, persistent rate limiting |
| SEV-3 | Minor issues or isolated errors | Specific room failures, avatar upload failures |

## Response Workflow

1. **Detection:** Alerts fire from Prometheus (metrics above thresholds) or SIEM security events.
2. **Triage:** IC assesses severity, declares incident, and pages required roles.
3. **Containment:**
   - Apply connection throttles (`RATE_LIMIT_WRITE_MAX`, `SOCKET_EVENT_RATE_LIMIT`) if under attack.
   - Block offending IP ranges at the load balancer or CDN.
   - For performance regressions, scale out replicas and review recent deployments.
4. **Eradication & Recovery:**
   - Roll back using steps in `docs/production-checklist.md` if the deployment caused the issue.
   - Restore service dependencies (databases, caches) and verify via smoke tests.
   - Monitor `game_server_error_log_total` and `/metrics/errors` for residual exceptions.
5. **Post-Incident Review:**
   - Document timeline, impact, root cause, and follow-up actions.
   - Update runbooks, dashboards, and alerts as needed.

## Tooling

- **Metrics:** `/metrics`, Grafana dashboards, and alerting rules described in `docs/monitoring/metrics-and-alerting.md`.
- **Logs:** Centralised logging platform enriched with `/metrics/errors` output.
- **Security:** Firewall/WAF policies, automated rate limiting metrics (`game_server_security_events_total`).

## Communication Templates

- **Internal Update:** summary of issue, mitigation steps, ETA.
- **Customer Update:** status page entry referencing impact and next update time.
- **Postmortem:** distributed to engineering leadership within 48 hours.

## Continuous Improvement

Track incident metrics (frequency, MTTR) and prioritise backlog items that reduce recurrence. Regularly rehearse response drills simulating DDoS spikes, authentication failures, and plugin crashes.
