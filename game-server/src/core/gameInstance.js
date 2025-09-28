'use strict';

class GameInstance {
    constructor({ id, playerManager, stateManager, ruleEngine, commandBus, metadata = {} }) {
        this.id = id;
        this.playerManager = playerManager;
        this.stateManager = stateManager;
        this.ruleEngine = ruleEngine;
        this.commandBus = commandBus;
        this.metadata = metadata;
    }

    getState() {
        return this.stateManager.snapshot();
    }
}

module.exports = GameInstance;
