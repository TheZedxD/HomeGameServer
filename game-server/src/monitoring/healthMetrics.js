/**
 * Health and Metrics Monitoring
 *
 * Provides comprehensive observability with:
 * - /healthz endpoint for health checks
 * - /metrics endpoint with Prometheus-compatible format
 * - Counters, gauges, and histograms
 * - System resource monitoring
 */

const os = require('os');
const { performance } = require('perf_hooks');

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.processStartTime = performance.now();

    // Counters (monotonically increasing)
    this.counters = {
      http_requests_total: 0,
      http_requests_failed: 0,
      socket_connections_total: 0,
      socket_disconnections_total: 0,
      socket_errors_total: 0,
      game_rooms_created_total: 0,
      game_rooms_closed_total: 0,
      game_moves_total: 0,
      game_moves_rejected_total: 0,
      rate_limit_hits_total: 0,
      validation_errors_total: 0,
      reconnects_total: 0,
      dropped_events_total: 0,
    };

    // Gauges (can go up or down)
    this.gauges = {
      rooms_active: 0,
      players_active: 0,
      socket_connections_current: 0,
      memory_usage_bytes: 0,
      cpu_usage_percent: 0,
      tick_rate_hz: 0,
      tick_duration_ms: 0,
    };

    // Histograms (track distribution of values)
    this.histograms = {
      http_request_duration_ms: [],
      socket_event_duration_ms: [],
      tick_duration_ms: [],
      game_move_duration_ms: [],
      bytes_in: [],
      bytes_out: [],
    };

    // Labels for dimensions
    this.labels = new Map();

    // Track histogram buckets
    this.histogramBuckets = {
      duration_ms: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      bytes: [100, 1000, 10000, 100000, 1000000],
    };
  }

  // ===========================
  // Counter Methods
  // ===========================

  incrementCounter(name, value = 1, labels = {}) {
    if (!(name in this.counters)) {
      this.counters[name] = 0;
    }
    this.counters[name] += value;

    if (Object.keys(labels).length > 0) {
      this._recordLabels(name, labels);
    }
  }

  getCounter(name) {
    return this.counters[name] || 0;
  }

  // ===========================
  // Gauge Methods
  // ===========================

  setGauge(name, value, labels = {}) {
    this.gauges[name] = value;

    if (Object.keys(labels).length > 0) {
      this._recordLabels(name, labels);
    }
  }

  incrementGauge(name, value = 1, labels = {}) {
    if (!(name in this.gauges)) {
      this.gauges[name] = 0;
    }
    this.gauges[name] += value;

    if (Object.keys(labels).length > 0) {
      this._recordLabels(name, labels);
    }
  }

  decrementGauge(name, value = 1, labels = {}) {
    this.incrementGauge(name, -value, labels);
  }

  getGauge(name) {
    return this.gauges[name] || 0;
  }

  // ===========================
  // Histogram Methods
  // ===========================

  recordHistogram(name, value, labels = {}) {
    if (!(name in this.histograms)) {
      this.histograms[name] = [];
    }

    this.histograms[name].push(value);

    // Keep only last 1000 values to prevent memory bloat
    if (this.histograms[name].length > 1000) {
      this.histograms[name].shift();
    }

    if (Object.keys(labels).length > 0) {
      this._recordLabels(name, labels);
    }
  }

  getHistogramStats(name) {
    const values = this.histograms[name] || [];
    if (values.length === 0) {
      return {
        count: 0,
        sum: 0,
        avg: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((acc, val) => acc + val, 0);
    const avg = sum / count;

    return {
      count,
      sum,
      avg,
      min: sorted[0],
      max: sorted[count - 1],
      p50: sorted[Math.floor(count * 0.50)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  // ===========================
  // System Metrics
  // ===========================

  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Memory metrics
    this.setGauge('memory_usage_bytes', memUsage.rss);
    this.setGauge('memory_heap_total_bytes', memUsage.heapTotal);
    this.setGauge('memory_heap_used_bytes', memUsage.heapUsed);
    this.setGauge('memory_external_bytes', memUsage.external);

    // CPU metrics (user + system time in microseconds)
    this.setGauge('cpu_user_time_us', cpuUsage.user);
    this.setGauge('cpu_system_time_us', cpuUsage.system);

    // Load average (1, 5, 15 minutes)
    const loadAvg = os.loadavg();
    this.setGauge('load_average_1m', loadAvg[0]);
    this.setGauge('load_average_5m', loadAvg[1]);
    this.setGauge('load_average_15m', loadAvg[2]);

    // Uptime
    this.setGauge('process_uptime_seconds', Math.floor((Date.now() - this.startTime) / 1000));
  }

  // ===========================
  // Label Management
  // ===========================

  _recordLabels(metricName, labels) {
    const key = `${metricName}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`;
    if (!this.labels.has(metricName)) {
      this.labels.set(metricName, new Set());
    }
    this.labels.get(metricName).add(key);
  }

  // ===========================
  // Prometheus Export
  // ===========================

  toPrometheusFormat() {
    let output = [];

    // Collect system metrics first
    this.collectSystemMetrics();

    // Export counters
    for (const [name, value] of Object.entries(this.counters)) {
      output.push(`# HELP ${name} Total count of ${name.replace(/_/g, ' ')}`);
      output.push(`# TYPE ${name} counter`);
      output.push(`${name} ${value}`);
      output.push('');
    }

    // Export gauges
    for (const [name, value] of Object.entries(this.gauges)) {
      output.push(`# HELP ${name} Current value of ${name.replace(/_/g, ' ')}`);
      output.push(`# TYPE ${name} gauge`);
      output.push(`${name} ${value}`);
      output.push('');
    }

    // Export histograms
    for (const [name, values] of Object.entries(this.histograms)) {
      if (values.length === 0) continue;

      const stats = this.getHistogramStats(name);
      const buckets = this._determineBuckets(name);

      output.push(`# HELP ${name} Distribution of ${name.replace(/_/g, ' ')}`);
      output.push(`# TYPE ${name} histogram`);

      // Histogram buckets
      const sorted = [...values].sort((a, b) => a - b);
      let cumulativeCount = 0;

      for (const bucket of buckets) {
        const count = sorted.filter(v => v <= bucket).length;
        cumulativeCount = count;
        output.push(`${name}_bucket{le="${bucket}"} ${cumulativeCount}`);
      }

      output.push(`${name}_bucket{le="+Inf"} ${values.length}`);
      output.push(`${name}_sum ${stats.sum}`);
      output.push(`${name}_count ${stats.count}`);
      output.push('');
    }

    return output.join('\n');
  }

  _determineBuckets(name) {
    if (name.includes('duration') || name.includes('_ms')) {
      return this.histogramBuckets.duration_ms;
    } else if (name.includes('bytes')) {
      return this.histogramBuckets.bytes;
    }
    return [1, 10, 100, 1000, 10000];
  }

  // ===========================
  // JSON Export
  // ===========================

  toJSON() {
    this.collectSystemMetrics();

    const histogramStats = {};
    for (const name of Object.keys(this.histograms)) {
      histogramStats[name] = this.getHistogramStats(name);
    }

    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      histograms: histogramStats,
    };
  }

  // ===========================
  // Reset Methods
  // ===========================

  reset() {
    for (const key of Object.keys(this.counters)) {
      this.counters[key] = 0;
    }
    for (const key of Object.keys(this.histograms)) {
      this.histograms[key] = [];
    }
    this.labels.clear();
  }
}

// ===========================
// Health Check
// ===========================

class HealthChecker {
  constructor() {
    this.checks = new Map();
    this.status = 'healthy';
  }

  /**
   * Register a health check
   *
   * @param {String} name - Check name
   * @param {Function} checkFn - Async function that returns { healthy: boolean, message?: string }
   */
  registerCheck(name, checkFn) {
    this.checks.set(name, checkFn);
  }

  /**
   * Run all health checks
   *
   * @returns {Object} Health status
   */
  async runChecks() {
    const results = {};
    let overallHealthy = true;

    for (const [name, checkFn] of this.checks) {
      try {
        const result = await checkFn();
        results[name] = {
          healthy: result.healthy !== false,
          message: result.message || null,
          timestamp: Date.now(),
        };

        if (!results[name].healthy) {
          overallHealthy = false;
        }
      } catch (error) {
        results[name] = {
          healthy: false,
          message: error.message,
          error: error.stack,
          timestamp: Date.now(),
        };
        overallHealthy = false;
      }
    }

    this.status = overallHealthy ? 'healthy' : 'unhealthy';

    return {
      status: this.status,
      checks: results,
      timestamp: Date.now(),
    };
  }

  /**
   * Get basic health status (fast, no async checks)
   */
  getBasicHealth() {
    return {
      status: this.status,
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  }
}

// ===========================
// Singleton Instances
// ===========================

const metricsCollector = new MetricsCollector();
const healthChecker = new HealthChecker();

// Register default health checks
healthChecker.registerCheck('memory', async () => {
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  return {
    healthy: heapUsedPercent < 90, // Unhealthy if using >90% of heap
    message: `Heap usage: ${heapUsedPercent.toFixed(2)}%`,
  };
});

healthChecker.registerCheck('uptime', async () => {
  const uptime = process.uptime();

  return {
    healthy: uptime > 1, // Healthy after 1 second of uptime
    message: `Uptime: ${uptime.toFixed(0)}s`,
  };
});

module.exports = {
  MetricsCollector,
  HealthChecker,
  metricsCollector,
  healthChecker,
};
