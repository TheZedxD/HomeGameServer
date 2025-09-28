'use strict';

const EventEmitter = require('events');
const { deepClone } = require('./utils');

class GameStateManager extends EventEmitter {
    constructor(initialState = {}) {
        super();
        this.version = 0;
        this.state = deepClone(initialState);
    }

    snapshot() {
        return {
            version: this.version,
            state: deepClone(this.state),
        };
    }

    replace(nextState, context = {}) {
        const previous = this.snapshot();
        this.state = deepClone(nextState);
        this.version += 1;
        const current = this.snapshot();
        this.emit('stateChanged', { previous, current, context });
        return current;
    }

    update(mutator, context = {}) {
        const current = deepClone(this.state);
        const nextState = mutator(current);
        if (typeof nextState === 'undefined') {
            throw new Error('State mutator must return the next state object.');
        }
        return this.replace(nextState, context);
    }
}

module.exports = GameStateManager;
