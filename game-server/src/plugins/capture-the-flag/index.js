'use strict';

const { buildGameInstance } = require('../../core');

class CaptureFlagMoveStrategy {
    execute({ state, payload, playerManager, playerId }) {
        if (!playerManager.hasPlayer(playerId)) {
            return { error: 'Unknown player.' };
        }
        if (state.isComplete) {
            return { error: 'Game has ended.' };
        }
        const { team, flagCaptured } = payload || {};
        if (!['red', 'blue'].includes(team)) {
            return { error: 'Invalid team.' };
        }
        const player = playerManager.getPlayer(playerId);
        return {
            apply(current) {
                const next = JSON.parse(JSON.stringify(current));
                next.events.push({
                    type: 'captureAttempt',
                    team,
                    playerId,
                    timestamp: Date.now(),
                });
                if (flagCaptured) {
                    next.scores[team] += 1;
                    if (next.scores[team] >= next.scoreToWin) {
                        next.isComplete = true;
                        next.winner = team;
                    }
                }
                next.turnIndex = (next.turnIndex + 1) % playerManager.list().length;
                next.activePlayerId = playerManager.list()[next.turnIndex].id;
                return next;
            },
            getUndo() {
                return () => ({ state: JSON.parse(JSON.stringify(state)) });
            },
            metadata: { playerDisplayName: player.displayName },
        };
    }
}

module.exports = {
    register(registry) {
        return registry.register({
            id: 'capture-the-flag',
            name: 'Capture the Flag',
            minPlayers: 4,
            maxPlayers: 8,
            version: '1.0.0',
            create({ roomId, players = [] }) {
                const game = buildGameInstance({
                    id: 'capture-the-flag',
                    minPlayers: 4,
                    maxPlayers: 8,
                    initialState: {
                        roomId,
                        scores: { red: 0, blue: 0 },
                        scoreToWin: 3,
                        events: [],
                        isComplete: false,
                        winner: null,
                        activePlayerId: players[0]?.id || null,
                        turnIndex: 0,
                    },
                    strategies: {
                        performTurn: new CaptureFlagMoveStrategy(),
                    },
                });
                players.forEach((participant, index) => {
                    game.playerManager.addPlayer({
                        id: participant.id,
                        displayName: participant.displayName,
                        metadata: {
                            team: index % 2 === 0 ? 'red' : 'blue',
                        },
                        isReady: true,
                    });
                });
                return game;
            },
        });
    },
};
