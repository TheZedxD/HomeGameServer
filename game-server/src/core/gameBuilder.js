'use strict';

const GameInstance = require('./gameInstance');
const GameStateManager = require('./gameStateManager');
const PlayerManager = require('./playerManager');
const RuleEngine = require('./ruleEngine');
const { CommandBus } = require('./command');

function buildGameInstance({ id, initialState, minPlayers, maxPlayers, strategies = {}, metadata = {} }) {
    const playerManager = new PlayerManager({ minPlayers, maxPlayers });
    const stateManager = new GameStateManager(initialState);
    const ruleEngine = new RuleEngine(id);
    for (const [key, strategy] of Object.entries(strategies)) {
        ruleEngine.registerStrategy(key, strategy);
    }
    const commandBus = new CommandBus({ stateManager, ruleEngine, playerManager });
    return new GameInstance({ id, playerManager, stateManager, ruleEngine, commandBus, metadata });
}

module.exports = {
    buildGameInstance,
};
