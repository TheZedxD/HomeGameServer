'use strict';

const { buildGameInstance } = require('../../core');

class PlaceMarkStrategy {
    execute({ state, playerManager, playerId, payload }) {
        if (!playerManager.hasPlayer(playerId)) {
            return { error: 'Player not part of this game.' };
        }
        const playerOrder = playerManager.list().map(p => p.id);
        const turn = state.turn || playerOrder[0];
        if (playerId !== turn) {
            return { error: 'Not your turn.' };
        }
        const { row, col } = payload || {};
        if (![0, 1, 2].includes(row) || ![0, 1, 2].includes(col)) {
            return { error: 'Invalid move position.' };
        }
        if (state.board[row][col] !== null) {
            return { error: 'Cell already occupied.' };
        }
        const symbolIndex = playerOrder.indexOf(playerId);
        const symbol = symbolIndex === 0 ? 'X' : 'O';
        return {
            apply(current) {
                const next = JSON.parse(JSON.stringify(current));
                next.board[row][col] = symbol;
                next.turn = playerOrder[(symbolIndex + 1) % playerOrder.length];
                const winner = checkWinner(next.board);
                if (winner) {
                    next.winner = playerId;
                    next.isComplete = true;
                } else if (next.board.flat().every(cell => cell !== null)) {
                    next.isComplete = true;
                }
                return next;
            },
            getUndo() {
                return () => {
                    const reverted = JSON.parse(JSON.stringify(state));
                    return { state: reverted };
                };
            },
        };
    }
}

function checkWinner(board) {
    const lines = [
        [board[0][0], board[0][1], board[0][2]],
        [board[1][0], board[1][1], board[1][2]],
        [board[2][0], board[2][1], board[2][2]],
        [board[0][0], board[1][0], board[2][0]],
        [board[0][1], board[1][1], board[2][1]],
        [board[0][2], board[1][2], board[2][2]],
        [board[0][0], board[1][1], board[2][2]],
        [board[0][2], board[1][1], board[2][0]],
    ];
    return lines.some(line => line[0] && line.every(cell => cell === line[0]));
}

module.exports = {
    register(registry) {
        const definition = registry.register({
            id: 'tictactoe',
            name: 'Tic Tac Toe',
            minPlayers: 2,
            maxPlayers: 2,
            version: '1.0.0',
            create({ roomId, players }) {
                const game = buildGameInstance({
                    id: 'tictactoe',
                    minPlayers: 2,
                    maxPlayers: 2,
                    initialState: {
                        roomId,
                        board: [
                            [null, null, null],
                            [null, null, null],
                            [null, null, null],
                        ],
                        turn: players?.[0]?.id || null,
                        isComplete: false,
                        winner: null,
                    },
                    strategies: {
                        placeMark: new PlaceMarkStrategy(),
                    },
                });
                if (Array.isArray(players)) {
                    for (const participant of players) {
                        game.playerManager.addPlayer({
                            id: participant.id,
                            displayName: participant.displayName,
                            isReady: true,
                        });
                    }
                }
                return game;
            },
        });
        return definition;
    },
};
