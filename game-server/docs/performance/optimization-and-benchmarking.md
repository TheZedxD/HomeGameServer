# Performance Optimization & Benchmarking

## Server Optimizations

- **HTTP response metrics** captured by `metricsCollector` ensure 95th percentile latency stays below 200 ms.
- **User store cache** maintains an in-memory index of `users.json` with automatic invalidation via `fs.watchFile`, removing repeated disk reads for authentication calls.
- **Socket.IO instrumentation** wraps every event handler to measure latency and surface slow game logic.
- **Rate limiting** prevents abusive clients from starving resources, ensuring headroom for legitimate traffic.
- **Static compression** is handled upstream (reverse proxy) – responses are kept lean via caching headers and JSON serialization.

## Database / Storage Strategy

Although the current implementation uses a JSON store, the cache pattern mirrors production databases:

1. Read requests served from the in-memory index (`userStoreIndex`).
2. Writes persist to disk and refresh the cache immediately.
3. A `fs.watchFile` listener invalidates the cache if external processes modify `users.json`.

For real databases, mirror this pattern with primary key indexes and read replicas. Enable query logging to detect slow operations.

## Socket.IO Scaling

- Each connection is rate limited (`SOCKET_EVENT_RATE_LIMIT`) to guard against event floods.
- `metricsCollector` exposes per-event latency – optimise handlers that exceed the 50 ms target.
- Deploy behind a load balancer with sticky sessions or Socket.IO adapters (Redis, NATS) for 10k+ concurrent players.

## Memory Management

- Resource monitor snapshots feed `game_server_process_memory_bytes` metrics. Track heap usage to detect leaks.
- Garbage collection pressure can be diagnosed via Node’s `--trace-gc` flag in staging.
- Avoid retaining large objects in closures; release references on room teardown.

## Benchmarking Workflow

Use the lightweight benchmark script to validate latency targets after changes:

```bash
# With the server running locally
npm run benchmark
# Customize target, requests, and concurrency
BENCHMARK_URL=http://localhost:3000/api/csrf-token \
BENCHMARK_REQUESTS=500 \
BENCHMARK_CONCURRENCY=40 \
npm run benchmark
```

The script prints throughput plus P50/P95/P99 latencies. Capture results per build and compare against baseline budgets.

## Capacity Planning Checklist

- Watch `game_server_socket_connections` to understand peak concurrency; scale horizontally before approaching limits.
- Keep CPU utilization <70%: track `game_server_process_cpu_load` and correlate with event spikes.
- Ensure authentication and profile endpoints stay below 100 ms by monitoring the HTTP quantiles.
