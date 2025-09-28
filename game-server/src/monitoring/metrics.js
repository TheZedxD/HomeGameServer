'use strict';

const express = require('express');
const os = require('os');

class MetricsCollector {
    constructor() {
        this.maxSamples = 5000;
        this.httpSamples = [];
        this.httpSum = 0;
        this.httpCount = 0;
        this.httpErrorCount = 0;
        this.socketSamples = new Map();
        this.socketEventCount = 0;
        this.socketErrorCount = 0;
        this.socketConnections = 0;
        this.socketSums = new Map();
        this.securityEvents = new Map();
        this.gameMetrics = { rooms: 0, players: 0, activeGames: 0 };
        this.resourceSnapshot = collectResourceSnapshot();
        this.errorLog = [];
    }

    recordHttpSample({ durationMs, method, route, statusCode }) {
        if (!Number.isFinite(durationMs)) {
            return;
        }
        this.httpCount += 1;
        this.httpSum += durationMs;
        if (statusCode >= 400) {
            this.httpErrorCount += 1;
        }
        this.httpSamples.push({ durationMs, method, route, statusCode });
        if (this.httpSamples.length > this.maxSamples) {
            this.httpSamples.shift();
        }
    }

    recordSocketEvent({ eventName, durationMs, isError = false }) {
        this.socketEventCount += 1;
        if (isError) {
            this.socketErrorCount += 1;
        }
        if (!Number.isFinite(durationMs)) {
            return;
        }
        const samples = this.socketSamples.get(eventName) || [];
        samples.push(durationMs);
        if (samples.length > this.maxSamples) {
            samples.shift();
        }
        this.socketSamples.set(eventName, samples);
        const currentSum = this.socketSums.get(eventName) || 0;
        this.socketSums.set(eventName, currentSum + durationMs);
    }

    setSocketConnections(count) {
        this.socketConnections = Math.max(0, count);
    }

    incrementSocketConnections() {
        this.socketConnections += 1;
    }

    decrementSocketConnections() {
        this.socketConnections = Math.max(0, this.socketConnections - 1);
    }

    updateGameMetrics({ rooms, players, activeGames }) {
        if (typeof rooms === 'number') this.gameMetrics.rooms = rooms;
        if (typeof players === 'number') this.gameMetrics.players = players;
        if (typeof activeGames === 'number') this.gameMetrics.activeGames = activeGames;
    }

    updateResourceSnapshot(snapshot) {
        this.resourceSnapshot = snapshot;
    }

    recordSecurityEvent(name) {
        const current = this.securityEvents.get(name) || 0;
        this.securityEvents.set(name, current + 1);
    }

    recordError(error, context) {
        const entry = {
            message: error?.message || String(error),
            stack: error?.stack || null,
            context: context || null,
            timestamp: Date.now(),
        };
        this.errorLog.push(entry);
        if (this.errorLog.length > 100) {
            this.errorLog.shift();
        }
    }

    getHttpQuantiles() {
        if (!this.httpSamples.length) {
            return { p50: 0, p95: 0, p99: 0 };
        }
        const durations = this.httpSamples.map((sample) => sample.durationMs).sort((a, b) => a - b);
        return {
            p50: calculatePercentile(durations, 0.5),
            p95: calculatePercentile(durations, 0.95),
            p99: calculatePercentile(durations, 0.99),
        };
    }

    getSocketQuantiles() {
        const result = {};
        for (const [eventName, samples] of this.socketSamples.entries()) {
            if (!samples.length) {
                continue;
            }
            const sorted = [...samples].sort((a, b) => a - b);
            result[eventName] = {
                p50: calculatePercentile(sorted, 0.5),
                p95: calculatePercentile(sorted, 0.95),
                p99: calculatePercentile(sorted, 0.99),
                count: samples.length,
            };
        }
        return result;
    }

    renderPrometheus() {
        const lines = [];
        const httpQuantiles = this.getHttpQuantiles();
        lines.push('# HELP game_server_http_requests_total Total HTTP requests received');
        lines.push('# TYPE game_server_http_requests_total counter');
        lines.push(`game_server_http_requests_total ${this.httpCount}`);
        lines.push('# HELP game_server_http_request_errors_total HTTP requests resulting in error status codes');
        lines.push('# TYPE game_server_http_request_errors_total counter');
        lines.push(`game_server_http_request_errors_total ${this.httpErrorCount}`);
        lines.push('# HELP game_server_http_request_duration_seconds HTTP request duration in seconds');
        lines.push('# TYPE game_server_http_request_duration_seconds summary');
        lines.push(`game_server_http_request_duration_seconds_sum ${(this.httpSum / 1000).toFixed(6)}`);
        lines.push(`game_server_http_request_duration_seconds_count ${this.httpCount}`);
        lines.push(`game_server_http_request_duration_seconds{quantile="0.5"} ${(httpQuantiles.p50 / 1000).toFixed(6)}`);
        lines.push(`game_server_http_request_duration_seconds{quantile="0.95"} ${(httpQuantiles.p95 / 1000).toFixed(6)}`);
        lines.push(`game_server_http_request_duration_seconds{quantile="0.99"} ${(httpQuantiles.p99 / 1000).toFixed(6)}`);

        lines.push('# HELP game_server_socket_events_total Total Socket.IO events processed');
        lines.push('# TYPE game_server_socket_events_total counter');
        lines.push(`game_server_socket_events_total ${this.socketEventCount}`);
        lines.push('# HELP game_server_socket_event_errors_total Socket.IO events that resulted in errors');
        lines.push('# TYPE game_server_socket_event_errors_total counter');
        lines.push(`game_server_socket_event_errors_total ${this.socketErrorCount}`);
        lines.push('# HELP game_server_socket_connections Current active Socket.IO connections');
        lines.push('# TYPE game_server_socket_connections gauge');
        lines.push(`game_server_socket_connections ${this.socketConnections}`);

        const socketQuantiles = this.getSocketQuantiles();
        for (const [eventName, metrics] of Object.entries(socketQuantiles)) {
            const totalDuration = (this.socketSums.get(eventName) || 0) / 1000;
            lines.push(`# HELP game_server_socket_event_duration_seconds Duration for Socket.IO event ${eventName}`);
            lines.push('# TYPE game_server_socket_event_duration_seconds summary');
            lines.push(`game_server_socket_event_duration_seconds_sum{event="${eventName}"} ${totalDuration.toFixed(6)}`);
            lines.push(`game_server_socket_event_duration_seconds_count{event="${eventName}"} ${metrics.count}`);
            lines.push(`game_server_socket_event_duration_seconds{event="${eventName}",quantile="0.5"} ${(metrics.p50 / 1000).toFixed(6)}`);
            lines.push(`game_server_socket_event_duration_seconds{event="${eventName}",quantile="0.95"} ${(metrics.p95 / 1000).toFixed(6)}`);
            lines.push(`game_server_socket_event_duration_seconds{event="${eventName}",quantile="0.99"} ${(metrics.p99 / 1000).toFixed(6)}`);
        }

        lines.push('# HELP game_server_rooms_current Current active game rooms');
        lines.push('# TYPE game_server_rooms_current gauge');
        lines.push(`game_server_rooms_current ${this.gameMetrics.rooms}`);
        lines.push('# HELP game_server_players_current Current players connected to rooms');
        lines.push('# TYPE game_server_players_current gauge');
        lines.push(`game_server_players_current ${this.gameMetrics.players}`);
        lines.push('# HELP game_server_active_games_current Games currently running');
        lines.push('# TYPE game_server_active_games_current gauge');
        lines.push(`game_server_active_games_current ${this.gameMetrics.activeGames}`);

        const memory = this.resourceSnapshot.memory || process.memoryUsage();
        lines.push('# HELP game_server_process_memory_bytes Node.js process memory usage');
        lines.push('# TYPE game_server_process_memory_bytes gauge');
        lines.push(`game_server_process_memory_bytes{type="rss"} ${memory.rss}`);
        lines.push(`game_server_process_memory_bytes{type="heapTotal"} ${memory.heapTotal}`);
        lines.push(`game_server_process_memory_bytes{type="heapUsed"} ${memory.heapUsed}`);
        lines.push(`game_server_process_memory_bytes{type="external"} ${memory.external}`);

        lines.push('# HELP game_server_process_cpu_load CPU load average over 1 minute');
        lines.push('# TYPE game_server_process_cpu_load gauge');
        const cpuLoad = Array.isArray(this.resourceSnapshot.cpuLoad) ? this.resourceSnapshot.cpuLoad[0] : os.loadavg()[0];
        lines.push(`game_server_process_cpu_load ${cpuLoad}`);

        lines.push('# HELP game_server_security_events_total Security events recorded by the server');
        lines.push('# TYPE game_server_security_events_total counter');
        for (const [eventName, count] of this.securityEvents.entries()) {
            lines.push(`game_server_security_events_total{event="${eventName}"} ${count}`);
        }
        if (!this.securityEvents.size) {
            lines.push('game_server_security_events_total{event="none"} 0');
        }

        lines.push('# HELP game_server_error_log_total Number of captured server errors');
        lines.push('# TYPE game_server_error_log_total counter');
        lines.push(`game_server_error_log_total ${this.errorLog.length}`);

        return `${lines.join('\n')}\n`;
    }

    createRouter({ token } = {}) {
        const router = express.Router();
        router.get('/', (req, res) => {
            if (token) {
                const authHeader = req.headers.authorization || '';
                if (authHeader !== `Bearer ${token}`) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
            }
            res.type('text/plain').send(this.renderPrometheus());
            return undefined;
        });
        router.get('/errors', (req, res) => {
            res.json({ errors: this.errorLog.slice(-50) });
        });
        return router;
    }
}

function calculatePercentile(sortedValues, percentile) {
    if (!sortedValues.length) {
        return 0;
    }
    const index = Math.min(sortedValues.length - 1, Math.floor(percentile * sortedValues.length));
    return sortedValues[index];
}

function collectResourceSnapshot() {
    return {
        memory: process.memoryUsage(),
        cpuLoad: os.loadavg(),
        uptime: process.uptime(),
    };
}

module.exports = {
    MetricsCollector,
    metricsCollector: new MetricsCollector(),
    collectResourceSnapshot,
};
