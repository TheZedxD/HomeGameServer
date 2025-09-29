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
        this.roundEndListener = (payload) => {
            this.emit('roundEnd', {
                roomId: this.roomId,
                ...payload,
            });
        };
        this.stateManager.on('roundEnd', this.roundEndListener);
    }

    dispose() {
        if (this.listener) {
            this.stateManager.off('stateChanged', this.listener);
        }
        if (this.roundEndListener) {
            this.stateManager.off('roundEnd', this.roundEndListener);
        }
    }
}

module.exports = StateSynchronizer;
