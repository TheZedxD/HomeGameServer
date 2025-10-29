/**
 * Server Tick Manager
 *
 * Implements a high-precision server tick loop for authoritative game simulation.
 * Target: 20-30 Hz with p95 tick duration < 10ms under load.
 *
 * Features:
 * - Fixed timestep simulation
 * - Delta time accumulation
 * - Tick rate monitoring and adaptation
 * - Snapshot broadcasting at configurable rate
 * - Performance metrics collection
 */

const EventEmitter = require('events');
const { performance } = require('perf_hooks');

class TickManager extends EventEmitter {
  /**
   * Create a new TickManager
   *
   * @param {Object} config - Configuration object
   * @param {Number} config.tickRate - Target tick rate in Hz (default: 30)
   * @param {Number} config.snapshotRate - Snapshot broadcast rate in Hz (default: 10)
   * @param {Number} config.maxDeltaTime - Maximum delta time accumulation in ms (default: 100)
   * @param {Object} logger - Logger instance
   */
  constructor(config = {}, logger = console) {
    super();

    this.config = {
      tickRate: config.tickRate || 30,
      snapshotRate: config.snapshotRate || 10,
      maxDeltaTime: config.maxDeltaTime || 100,
      warningThreshold: config.warningThreshold || 10, // ms
      ...config,
    };

    this.logger = logger;

    // Computed timing
    this.tickInterval = Math.floor(1000 / this.config.tickRate); // ms per tick
    this.snapshotInterval = Math.floor(1000 / this.config.snapshotRate); // ms per snapshot

    // Tick state
    this.isRunning = false;
    this.isPaused = false;
    this.currentTick = 0;
    this.startTime = 0;
    this.lastTickTime = 0;
    this.accumulatedDelta = 0;

    // Snapshot tracking
    this.lastSnapshotTime = 0;
    this.lastSnapshotTick = 0;

    // Performance metrics
    this.metrics = {
      tickDurations: [],
      maxTickDuration: 0,
      minTickDuration: Infinity,
      avgTickDuration: 0,
      slowTicks: 0, // Ticks exceeding warning threshold
      skippedTicks: 0,
      totalTicks: 0,
      ticksPerSecond: 0,
      lastMetricsReset: Date.now(),
    };

    // Interval tracking
    this.tickIntervalId = null;
    this.metricsIntervalId = null;

    // Room registry
    this.rooms = new Map(); // roomId -> room instance
  }

  /**
   * Start the tick loop
   */
  start() {
    if (this.isRunning) {
      this.logger.warn?.('TickManager already running') ||
        console.warn('TickManager already running');
      return this;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.startTime = performance.now();
    this.lastTickTime = this.startTime;
    this.lastSnapshotTime = this.startTime;
    this.currentTick = 0;

    this.logger.info?.(
      { tickRate: this.config.tickRate, snapshotRate: this.config.snapshotRate },
      `Starting tick loop: ${this.config.tickRate} Hz (${this.tickInterval}ms interval)`
    ) || console.log(`Starting tick loop: ${this.config.tickRate} Hz`);

    // Use setInterval for consistent timing
    this.tickIntervalId = setInterval(() => this._tick(), this.tickInterval);

    // Metrics reporting every 5 seconds
    this.metricsIntervalId = setInterval(() => this._reportMetrics(), 5000);

    this.emit('start', { tickRate: this.config.tickRate });

    return this;
  }

  /**
   * Stop the tick loop
   */
  stop() {
    if (!this.isRunning) {
      return this;
    }

    this.isRunning = false;
    this.isPaused = false;

    if (this.tickIntervalId) {
      clearInterval(this.tickIntervalId);
      this.tickIntervalId = null;
    }

    if (this.metricsIntervalId) {
      clearInterval(this.metricsIntervalId);
      this.metricsIntervalId = null;
    }

    this.logger.info?.(
      { totalTicks: this.currentTick, avgTickDuration: this.metrics.avgTickDuration.toFixed(2) },
      'Stopped tick loop'
    ) || console.log('Stopped tick loop');

    this.emit('stop', {
      totalTicks: this.currentTick,
      metrics: this.getMetrics(),
    });

    return this;
  }

  /**
   * Pause the tick loop (stops simulation but keeps interval running)
   */
  pause() {
    if (!this.isRunning || this.isPaused) {
      return this;
    }

    this.isPaused = true;
    this.logger.info?.('Tick loop paused') || console.log('Tick loop paused');
    this.emit('pause', { tick: this.currentTick });

    return this;
  }

  /**
   * Resume the tick loop
   */
  resume() {
    if (!this.isRunning || !this.isPaused) {
      return this;
    }

    this.isPaused = false;
    this.lastTickTime = performance.now();
    this.logger.info?.('Tick loop resumed') || console.log('Tick loop resumed');
    this.emit('resume', { tick: this.currentTick });

    return this;
  }

  /**
   * Internal tick function
   */
  _tick() {
    if (this.isPaused) {
      return;
    }

    const tickStartTime = performance.now();
    const deltaTime = tickStartTime - this.lastTickTime;

    // Accumulate delta time
    this.accumulatedDelta += deltaTime;

    // Cap accumulated delta to prevent spiral of death
    if (this.accumulatedDelta > this.config.maxDeltaTime) {
      const skipped = Math.floor((this.accumulatedDelta - this.config.maxDeltaTime) / this.tickInterval);
      this.metrics.skippedTicks += skipped;
      this.accumulatedDelta = this.config.maxDeltaTime;

      this.logger.warn?.(
        { skippedTicks: skipped, accumulatedDelta: this.accumulatedDelta },
        'Tick loop falling behind, skipping ticks'
      ) || console.warn(`Skipped ${skipped} ticks`);
    }

    // Fixed timestep update
    while (this.accumulatedDelta >= this.tickInterval) {
      this.currentTick++;
      this.accumulatedDelta -= this.tickInterval;

      // Emit tick event with fixed timestep
      this.emit('tick', {
        tick: this.currentTick,
        deltaTime: this.tickInterval,
        serverTime: Date.now(),
      });

      // Update all registered rooms
      for (const [roomId, room] of this.rooms) {
        try {
          this.emit('roomTick', {
            roomId,
            room,
            tick: this.currentTick,
            deltaTime: this.tickInterval,
          });
        } catch (error) {
          this.logger.error?.(
            { roomId, error: error.message, stack: error.stack },
            'Error in room tick'
          ) || console.error(`Error in room tick ${roomId}:`, error);

          this.emit('tickError', { roomId, error });
        }
      }

      this.metrics.totalTicks++;
    }

    // Check if snapshot should be broadcast
    if (tickStartTime - this.lastSnapshotTime >= this.snapshotInterval) {
      this.emit('snapshot', {
        tick: this.currentTick,
        serverTime: Date.now(),
        ticksSinceLastSnapshot: this.currentTick - this.lastSnapshotTick,
      });

      this.lastSnapshotTime = tickStartTime;
      this.lastSnapshotTick = this.currentTick;
    }

    // Calculate tick duration
    const tickEndTime = performance.now();
    const tickDuration = tickEndTime - tickStartTime;

    // Update metrics
    this._updateMetrics(tickDuration);

    // Warn if tick duration exceeds threshold
    if (tickDuration > this.config.warningThreshold) {
      this.logger.warn?.(
        { tickDuration: tickDuration.toFixed(2), threshold: this.config.warningThreshold },
        'Slow tick detected'
      ) || console.warn(`Slow tick: ${tickDuration.toFixed(2)}ms`);

      this.emit('slowTick', { tick: this.currentTick, duration: tickDuration });
    }

    this.lastTickTime = tickStartTime;
  }

  /**
   * Update performance metrics
   */
  _updateMetrics(tickDuration) {
    this.metrics.tickDurations.push(tickDuration);

    // Keep only last 1000 tick durations
    if (this.metrics.tickDurations.length > 1000) {
      this.metrics.tickDurations.shift();
    }

    this.metrics.maxTickDuration = Math.max(this.metrics.maxTickDuration, tickDuration);
    this.metrics.minTickDuration = Math.min(this.metrics.minTickDuration, tickDuration);

    if (tickDuration > this.config.warningThreshold) {
      this.metrics.slowTicks++;
    }

    // Calculate average
    const sum = this.metrics.tickDurations.reduce((acc, val) => acc + val, 0);
    this.metrics.avgTickDuration = sum / this.metrics.tickDurations.length;
  }

  /**
   * Report metrics periodically
   */
  _reportMetrics() {
    const now = Date.now();
    const elapsed = (now - this.metrics.lastMetricsReset) / 1000; // seconds

    this.metrics.ticksPerSecond = this.metrics.totalTicks / elapsed;

    const p95 = this._calculatePercentile(95);
    const p99 = this._calculatePercentile(99);

    this.logger.info?.(
      {
        tick: this.currentTick,
        tps: this.metrics.ticksPerSecond.toFixed(2),
        avgDuration: this.metrics.avgTickDuration.toFixed(2),
        p95: p95.toFixed(2),
        p99: p99.toFixed(2),
        slowTicks: this.metrics.slowTicks,
        skippedTicks: this.metrics.skippedTicks,
        rooms: this.rooms.size,
      },
      'Tick metrics'
    );

    this.emit('metrics', this.getMetrics());
  }

  /**
   * Calculate percentile from tick durations
   */
  _calculatePercentile(percentile) {
    if (this.metrics.tickDurations.length === 0) {
      return 0;
    }

    const sorted = [...this.metrics.tickDurations].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * Register a room for tick updates
   */
  registerRoom(roomId, room) {
    this.rooms.set(roomId, room);
    this.logger.debug?.({ roomId }, 'Room registered for tick updates');
    this.emit('roomRegistered', { roomId, totalRooms: this.rooms.size });
    return this;
  }

  /**
   * Unregister a room from tick updates
   */
  unregisterRoom(roomId) {
    const removed = this.rooms.delete(roomId);
    if (removed) {
      this.logger.debug?.({ roomId }, 'Room unregistered from tick updates');
      this.emit('roomUnregistered', { roomId, totalRooms: this.rooms.size });
    }
    return this;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const p50 = this._calculatePercentile(50);
    const p95 = this._calculatePercentile(95);
    const p99 = this._calculatePercentile(99);

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentTick: this.currentTick,
      tickRate: this.config.tickRate,
      snapshotRate: this.config.snapshotRate,
      ticksPerSecond: this.metrics.ticksPerSecond,
      totalTicks: this.metrics.totalTicks,
      avgTickDuration: this.metrics.avgTickDuration,
      minTickDuration: this.metrics.minTickDuration,
      maxTickDuration: this.metrics.maxTickDuration,
      p50TickDuration: p50,
      p95TickDuration: p95,
      p99TickDuration: p99,
      slowTicks: this.metrics.slowTicks,
      skippedTicks: this.metrics.skippedTicks,
      activeRooms: this.rooms.size,
      uptime: this.isRunning ? performance.now() - this.startTime : 0,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      tickDurations: [],
      maxTickDuration: 0,
      minTickDuration: Infinity,
      avgTickDuration: 0,
      slowTicks: 0,
      skippedTicks: 0,
      totalTicks: 0,
      ticksPerSecond: 0,
      lastMetricsReset: Date.now(),
    };

    this.logger.info?.('Metrics reset');
    return this;
  }

  /**
   * Get current tick number
   */
  getCurrentTick() {
    return this.currentTick;
  }

  /**
   * Get server time in milliseconds
   */
  getServerTime() {
    return Date.now();
  }

  /**
   * Check if tick loop is running
   */
  isTickLoopRunning() {
    return this.isRunning && !this.isPaused;
  }
}

module.exports = TickManager;
