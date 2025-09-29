'use strict';

const { buildGameInstance } = require('../../core');

const BOARD_SIZE = 3;
const PLAYER_MARKERS = ['X', 'O'];

class PlaceMarkStrategy {
    execute({ state, playerManager, playerId, payload }) {
        if (!playerManager.hasPlayer(playerId)) {
            return { error: 'Player not part of this game.' };
        }
        if (state.isRoundComplete) {
            return { error: 'Round already finished. Reset to play again.' };
        }
        if (!state.turnOrder || state.turnOrder.length < 2) {
            return { error: 'Game is not ready yet.' };
        }
        if (state.turn !== playerId) {
            return { error: 'It is not your turn.' };
        }

        const { row, col } = payload || {};
        if (!isValidCoordinate(row) || !isValidCoordinate(col)) {
            return { error: 'Invalid board position.' };
        }
        if (state.board?.[row]?.[col] !== null) {
            return { error: 'Cell already occupied.' };
        }

        const marker = state.players?.[playerId]?.marker;
        if (!marker) {
            return { error: 'No marker assigned to this player.' };
        }

        const originalState = cloneState(state);
        const nextState = cloneState(state);
        nextState.board[row][col] = marker;
        nextState.lastMove = { playerId, marker, row, col, placedAt: Date.now() };

        const victory = detectWinner(nextState.board);
        if (victory) {
            nextState.isRoundComplete = true;
            nextState.winner = findPlayerByMarker(nextState.players, victory.marker);
            nextState.roundOutcome = {
                result: 'win',
                playerId: nextState.winner,
                marker: victory.marker,
                winningLine: victory.line,
            };
            nextState.turn = null;
        } else if (isBoardFull(nextState.board)) {
            nextState.isRoundComplete = true;
            nextState.winner = null;
            nextState.roundOutcome = { result: 'draw' };
            nextState.turn = null;
        } else {
            nextState.turn = getNextTurn(state.turnOrder, playerId);
            nextState.roundOutcome = null;
        }

        return {
            apply() {
                return nextState;
            },
            getUndo() {
                return () => ({ state: originalState });
            },
        };
    }
}

class ResetRoundStrategy {
    execute({ state, playerManager }) {
        if (!state.isRoundComplete) {
            return { error: 'Round is still in progress.' };
        }
        if (!state.turnOrder || state.turnOrder.length < 2) {
            return { error: 'Not enough players to reset the round.' };
        }
        if (playerManager.list().length < state.turnOrder.length) {
            return { error: 'All players must be present to reset the round.' };
        }

        const originalState = cloneState(state);
        const nextState = cloneState(state);
        nextState.board = createEmptyBoard();
        nextState.isRoundComplete = false;
        nextState.winner = null;
        nextState.round += 1;
        nextState.roundOutcome = null;
        nextState.lastMove = null;
        nextState.turn = getStartingPlayerForRound(state.turnOrder, nextState.round);

        return {
            apply() {
                return nextState;
            },
            getUndo() {
                return () => ({ state: originalState });
            },
        };
    }
}

function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function isValidCoordinate(value) {
    return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

function cloneState(state = {}) {
    return JSON.parse(JSON.stringify(state));
}

function detectWinner(board) {
    const lines = [];
    for (let i = 0; i < BOARD_SIZE; i += 1) {
        lines.push({ line: `row-${i}`, cells: [board[i][0], board[i][1], board[i][2]] });
        lines.push({ line: `col-${i}`, cells: [board[0][i], board[1][i], board[2][i]] });
    }
    lines.push({ line: 'diag-main', cells: [board[0][0], board[1][1], board[2][2]] });
    lines.push({ line: 'diag-anti', cells: [board[0][2], board[1][1], board[2][0]] });

    for (const entry of lines) {
        if (entry.cells[0] && entry.cells.every(cell => cell === entry.cells[0])) {
            return { marker: entry.cells[0], line: entry.line };
        }
    }
    return null;
}

function isBoardFull(board) {
    return board.every(row => row.every(cell => cell !== null));
}

function findPlayerByMarker(players = {}, marker) {
    return Object.keys(players).find(id => players[id]?.marker === marker) || null;
}

function getNextTurn(order, currentPlayerId) {
    const index = order.indexOf(currentPlayerId);
    if (index === -1) {
        return order[0] || null;
    }
    return order[(index + 1) % order.length] || null;
}

function getStartingPlayerForRound(order, roundNumber) {
    if (!order.length) {
        return null;
    }
    const offset = (roundNumber - 1) % order.length;
    return order[offset];
}

function initializeGameState(game, participants) {
    const players = Array.isArray(participants) ? participants : [];
    const assignments = {};
    const turnOrder = [];

    players.slice(0, PLAYER_MARKERS.length).forEach((participant, index) => {
        const marker = PLAYER_MARKERS[index];
        const added = game.playerManager.addPlayer({
            id: participant.id,
            displayName: participant.displayName || participant.username || `Player ${index + 1}`,
            isReady: true,
            metadata: { marker },
        });
        turnOrder.push(added.id);
        assignments[added.id] = {
            id: added.id,
            marker,
            displayName: added.displayName,
        };
    });

    const snapshot = game.stateManager.snapshot().state;
    const nextState = {
        ...snapshot,
        board: createEmptyBoard(),
        turnOrder,
        players: assignments,
        turn: turnOrder[0] || null,
        isRoundComplete: false,
        winner: null,
        round: 1,
        roundOutcome: null,
        lastMove: null,
    };

    game.stateManager.replace(nextState, { system: 'tic-tac-toe:init' });
}

function attachRoundEndEmitter(game, roomId) {
    let lastEmittedRound = 0;
    const handler = ({ current }) => {
        const { state } = current;
        if (!state.isRoundComplete) {
            return;
        }
        if (state.round <= lastEmittedRound) {
            return;
        }
        lastEmittedRound = state.round;
        const winnerId = state.winner || null;
        const winnerMarker = winnerId ? state.players?.[winnerId]?.marker || null : null;
        const eventPayload = {
            roomId,
            round: state.round,
            board: state.board.map(row => row.slice()),
            winnerId,
            winnerMarker,
            outcome: state.roundOutcome || null,
        };
        game.stateManager.emit('roundEnd', eventPayload);
    };
    game.stateManager.on('stateChanged', handler);
}

module.exports = {
    register(registry) {
        return registry.register({
            id: 'tic-tac-toe',
            name: 'Tic-Tac-Toe',
            minPlayers: 2,
            maxPlayers: 2,
            version: '1.0.0',
            create({ roomId, players = [] }) {
                const game = buildGameInstance({
                    id: 'tic-tac-toe',
                    minPlayers: 2,
                    maxPlayers: 2,
                    initialState: {
                        roomId,
                        board: createEmptyBoard(),
                        turn: null,
                        turnOrder: [],
                        players: {},
                        round: 1,
                        isRoundComplete: false,
                        winner: null,
                        roundOutcome: null,
                        lastMove: null,
                    },
                    strategies: {
                        placeMark: new PlaceMarkStrategy(),
                        resetRound: new ResetRoundStrategy(),
                    },
                });

                initializeGameState(game, players);
                attachRoundEndEmitter(game, roomId);

                return game;
            },
        });
    },
};
