'use strict';

class RuleEngine {
    constructor(gameId) {
        this.gameId = gameId;
        this.strategies = new Map();
    }

    registerStrategy(key, strategy) {
        if (!strategy || typeof strategy.execute !== 'function') {
            throw new Error(`Strategy for ${key} must implement execute()`);
        }
        this.strategies.set(key, strategy);
    }

    getStrategy(key) {
        return this.strategies.get(key);
    }

    execute(key, payload) {
        const strategy = this.getStrategy(key);
        if (!strategy) {
            throw new Error(`No strategy registered for ${key} in ${this.gameId}`);
        }
        return strategy.execute(payload);
    }
}

module.exports = RuleEngine;
