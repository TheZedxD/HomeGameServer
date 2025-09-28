# Monitoring & Alerting

The server exposes production-ready telemetry for Prometheus and Grafana dashboards.

## Metrics Endpoints

- `GET /metrics` – Prometheus-format metrics. Protected by `METRICS_TOKEN` bearer authentication.
- `GET /metrics/errors` – JSON payload with the most recent server exceptions.
- `GET /healthz` – Lightweight readiness endpoint that returns uptime, memory usage, CPU load, and active Socket.IO connections.

## Prometheus Scrape Configuration

```yaml
scrape_configs:
  - job_name: 'homegame-server'
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets: ['game.example.com']
    authorization:
      credentials: "$METRICS_TOKEN"
    tls_config:
      insecure_skip_verify: false
```

## Grafana Dashboard Highlights

Key metrics exported by `src/monitoring/metrics.js`:

- `game_server_http_requests_total`, `game_server_http_request_duration_seconds{quantile="0.95"}` – tracks API throughput and latency SLO (target <200 ms at P95).
- `game_server_socket_events_total`, `game_server_socket_event_duration_seconds{quantile="0.95"}` – Socket.IO activity with per-event latency.
- `game_server_socket_connections` – active WebSocket sessions (scale target: 10,000+ connections).
- `game_server_rooms_current`, `game_server_players_current`, `game_server_active_games_current` – gameplay context metrics.
- `game_server_security_events_total{event="http_rate_limit"}` – surfaces abuse signals for alerting.

### Suggested Alerts

| Metric | Condition | Action |
| --- | --- | --- |
| `game_server_http_request_duration_seconds{quantile="0.95"}` | >0.2 for 5 minutes | Scale service, inspect database/cache health. |
| `game_server_socket_event_duration_seconds{event="submitMove",quantile="0.95"}` | >0.05 | Inspect game plugin performance. |
| `game_server_security_events_total{event="socket_rate_limit"}` | Increase >50/min | Trigger DDoS mitigation or block offending IP ranges. |
| `game_server_error_log_total` | Increases rapidly | Consult `/metrics/errors` or aggregated logs for stack traces. |

### Historical Trending

- Retain HTTP and Socket.IO histograms to compare peak hours vs baseline.
- Track `game_server_process_memory_bytes{type="heapUsed"}` alongside GC logs to detect leaks.
- Use Grafana annotations for deployments to correlate regressions.

## Log Aggregation

Forward server logs and `/metrics/errors` payloads to a SIEM (e.g., Elastic, Datadog). Each error record contains stack traces and contextual metadata for triage.

## Integrating with Incident Response

Alerts should notify the on-call rotation defined in `docs/incident-response.md`. Security events (CORS denials, rate limiting) are automatically counted and can feed automated blocking workflows.
