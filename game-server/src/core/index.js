'use strict';

module.exports = {
    GameRegistry: require('./gameRegistry'),
    PluginManager: require('./pluginManager'),
    GameFactory: require('./gameFactory'),
    GameRoomManager: require('./gameRoomManager'),
    GameStateManager: require('./gameStateManager'),
    PlayerManager: require('./playerManager'),
    RuleEngine: require('./ruleEngine'),
    Command: require('./command').Command,
    CommandBus: require('./command').CommandBus,
    GameInstance: require('./gameInstance'),
    buildGameInstance: require('./gameBuilder').buildGameInstance,
    StateSynchronizer: require('./stateSynchronizer'),
    ResourceMonitor: require('./resourceMonitor'),
    InMemoryGameRepository: require('./repositories/inMemoryGameRepository'),
    BettingManager: require('./bettingManager').BettingManager,
    VotingManager: require('./votingManager').VotingManager,
    VotingStrategy: require('./votingStrategy').VotingStrategy,
};
