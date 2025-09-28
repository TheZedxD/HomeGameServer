'use strict';

const EventEmitter = require('events');
const os = require('os');

class ResourceMonitor extends EventEmitter {
    constructor({ intervalMs = 5000 } = {}) {
        super();
        this.intervalMs = intervalMs;
        this.timer = null;
        this.metrics = {
            rooms: 0,
            activeGames: 0,
            players: 0,
            lastUpdated: Date.now(),
            system: collectSystemMetrics(),
        };
    }

    update({ rooms, activeGames, players }) {
        if (typeof rooms === 'number') this.metrics.rooms = rooms;
        if (typeof activeGames === 'number') this.metrics.activeGames = activeGames;
        if (typeof players === 'number') this.metrics.players = players;
        this.metrics.lastUpdated = Date.now();
        this.emit('metrics', this.metrics);
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.metrics.system = collectSystemMetrics();
            this.emit('metrics', this.metrics);
        }, this.intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getSnapshot() {
        return { ...this.metrics, system: collectSystemMetrics() };
    }
}

function collectSystemMetrics() {
    const memory = process.memoryUsage();
    return {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        cpuLoad: os.loadavg()[0],
    };
}

module.exports = ResourceMonitor;
