'use strict';

const EventEmitter = require('events');

class StateSynchronizer extends EventEmitter {
    constructor({ stateManager, roomId }) {
        super();
        this.stateManager = stateManager;
        this.roomId = roomId;
        this.listener = ({ current, context }) => {
            this.emit('sync', {
                roomId: this.roomId,
                state: current.state,
                version: current.version,
                context,
            });
        };
        this.stateManager.on('stateChanged', this.listener);
        this._timers = new Set();
        this.roundEndListener = (payload) => {
            this.emit('roundEnd', {
                roomId: this.roomId,
                ...payload,
            });
        };
        this.stateManager.on('roundEnd', this.roundEndListener);
    }

    dispose() {
        if (this.stateManager) {
            if (this.listener) {
                this.stateManager.off('stateChanged', this.listener);
            }
            if (this.roundEndListener) {
                this.stateManager.off('roundEnd', this.roundEndListener);
            }
        }

        if (this._timers?.size) {
            for (const timer of this._timers) {
                clearTimeout(timer);
                clearInterval(timer);
            }
            this._timers.clear();
        }

        this.removeAllListeners();

        this.listener = null;
        this.roundEndListener = null;
        this.stateManager = null;
        this.roomId = null;
        this._timers = null;
    }
}

module.exports = StateSynchronizer;
