'use strict';

const GameInstance = require('./gameInstance');

class GameFactory {
    constructor({ registry }) {
        if (!registry) {
            throw new Error('GameFactory requires a GameRegistry.');
        }
        this.registry = registry;
    }

    create(gameId, options = {}) {
        const definition = this.registry.get(gameId);
        if (!definition) {
            throw new Error(`Unknown game type: ${gameId}`);
        }
        const instance = definition.create(options);
        if (!(instance instanceof GameInstance)) {
            throw new Error(`Game definition ${gameId} must return a GameInstance.`);
        }
        return instance;
    }
}

module.exports = GameFactory;
