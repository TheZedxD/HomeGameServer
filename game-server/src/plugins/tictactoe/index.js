'use strict';

const { buildGameInstance } = require('../../core');

const BOARD_SIZE = 3;
const PLAYER_MARKERS = ['X', 'O'];
const SERIES_WINS_REQUIRED = 2;

class PlaceMarkStrategy {
    execute({ state, playerManager, playerId, payload }) {
        if (!playerManager.hasPlayer(playerId)) {
            return { error: 'Player not part of this game.' };
        }
        if (state.isComplete) {
            return { error: 'Series already complete.' };
        }
        if (state.isRoundComplete) {
            return { error: 'Round already finished. Reset to play again.' };
        }
        if (!state.turnOrder || state.turnOrder.length < 2) {
            return { error: 'Game is not ready yet.' };
        }
        const turnId = state.currentPlayerId || state.turnOrder[0];
        if (playerId !== turnId) {
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
            const winnerId = findPlayerByMarker(nextState.players, victory.marker);
            concludeRound(nextState, {
                result: 'win',
                playerId: winnerId,
                marker: victory.marker,
                winningLine: victory.line,
            });
        } else if (isBoardFull(nextState.board)) {
            concludeRound(nextState, { result: 'draw' });
        } else {
            const nextTurnId = getNextTurn(state.turnOrder, playerId);
            nextState.currentPlayerId = nextTurnId;
            nextState.turn = nextTurnId ? nextState.players?.[nextTurnId]?.marker || null : null;
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
        if (state.isComplete) {
            return { error: 'Series already finished.' };
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
        nextState.winnerName = null;
        nextState.winnerId = null;
        nextState.round += 1;
        nextState.roundOutcome = null;
        nextState.lastMove = null;
        nextState.awaitingReset = false;
        nextState.roundCompletedAt = null;
        const nextTurnId = getStartingPlayerForRound(state.turnOrder, nextState.round);
        nextState.currentPlayerId = nextTurnId;
        nextState.turn = nextTurnId ? nextState.players?.[nextTurnId]?.marker || null : null;

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

function normalizeScore(score = {}) {
    const normalized = {};
    for (const marker of PLAYER_MARKERS) {
        const value = Number.isFinite(Number(score?.[marker])) ? Number(score[marker]) : 0;
        normalized[marker] = value;
    }
    return normalized;
}

function concludeRound(state, outcome = {}) {
    const normalizedScore = normalizeScore(state.score);
    state.score = normalizedScore;
    state.isRoundComplete = true;
    state.roundOutcome = outcome || null;
    state.currentPlayerId = null;
    state.turn = null;
    state.roundCompletedAt = Date.now();

    if (outcome.result === 'win' && outcome.marker) {
        normalizedScore[outcome.marker] = (normalizedScore[outcome.marker] || 0) + 1;
        const winnerId = outcome.playerId || findPlayerByMarker(state.players, outcome.marker) || null;
        state.winner = winnerId;
        state.winnerId = winnerId;
        state.winnerName = winnerId ? state.players?.[winnerId]?.displayName || null : null;
        if (winnerId && normalizedScore[outcome.marker] >= SERIES_WINS_REQUIRED) {
            state.seriesWinner = winnerId;
            state.seriesWinnerMarker = outcome.marker;
            state.seriesWinnerName = state.winnerName;
            state.isComplete = true;
            state.gameOver = true;
            state.awaitingReset = false;
        } else {
            state.seriesWinner = state.seriesWinner || null;
            state.seriesWinnerMarker = state.seriesWinnerMarker || null;
            state.seriesWinnerName = state.seriesWinner ? state.players?.[state.seriesWinner]?.displayName || null : null;
            state.gameOver = false;
            state.awaitingReset = true;
        }
    } else {
        state.winner = null;
        state.winnerId = null;
        state.winnerName = null;
        state.seriesWinner = state.seriesWinner || null;
        state.seriesWinnerMarker = state.seriesWinnerMarker || null;
        state.seriesWinnerName = state.seriesWinner ? state.players?.[state.seriesWinner]?.displayName || null : null;
        state.gameOver = Boolean(state.seriesWinner);
        state.awaitingReset = !state.seriesWinner;
    }
}

function prepareNextRound(state) {
    const next = cloneState(state);
    const nextRound = (state.round || 1) + 1;
    next.board = createEmptyBoard();
    next.isRoundComplete = false;
    next.awaitingReset = false;
    next.roundOutcome = null;
    next.lastMove = null;
    next.winner = null;
    next.winnerId = null;
    next.winnerName = null;
    next.round = nextRound;
    next.roundCompletedAt = null;
    next.gameOver = Boolean(next.seriesWinner);
    const nextTurnId = getStartingPlayerForRound(next.turnOrder, nextRound);
    next.currentPlayerId = nextTurnId;
    next.turn = nextTurnId ? next.players?.[nextTurnId]?.marker || null : null;
    return next;
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
    const startingPlayerId = turnOrder[0] || null;
    const startingMarker = startingPlayerId ? assignments[startingPlayerId]?.marker || null : null;
    const nextState = {
        ...snapshot,
        board: createEmptyBoard(),
        turnOrder,
        players: assignments,
        turn: startingMarker,
        currentPlayerId: startingPlayerId,
        isRoundComplete: false,
        winner: null,
        winnerId: null,
        winnerName: null,
        round: 1,
        roundOutcome: null,
        lastMove: null,
        score: normalizeScore(snapshot?.score),
        seriesWinner: null,
        seriesWinnerMarker: null,
        seriesWinnerName: null,
        awaitingReset: false,
        roundCompletedAt: null,
        gameOver: false,
        isComplete: false,
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
        const roundNumber = state.round || 0;
        if (roundNumber <= lastEmittedRound) {
            return;
        }
        lastEmittedRound = roundNumber;
        const winnerId = state.roundOutcome?.playerId || state.seriesWinner || null;
        const winnerMarker = state.roundOutcome?.marker
            || state.seriesWinnerMarker
            || (winnerId ? state.players?.[winnerId]?.marker || null : null);
        const winnerName = winnerId ? state.players?.[winnerId]?.displayName || null : null;
        const eventPayload = {
            roomId,
            round: roundNumber,
            board: state.board.map(row => row.slice()),
            winnerId,
            winnerMarker,
            winnerName,
            outcome: state.roundOutcome || null,
            score: normalizeScore(state.score),
            seriesWinnerId: state.seriesWinner || null,
            seriesWinnerMarker: state.seriesWinnerMarker || null,
            seriesWinnerName: state.seriesWinnerName || null,
        };
        game.stateManager.emit('roundEnd', eventPayload);

        if (!state.seriesWinner && state.awaitingReset) {
            setTimeout(() => {
                game.stateManager.update((currentState) => {
                    if (!currentState.isRoundComplete || currentState.seriesWinner) {
                        return currentState;
                    }
                    if ((currentState.round || 0) !== roundNumber) {
                        return currentState;
                    }
                    return prepareNextRound(currentState);
                }, { system: 'tic-tac-toe:autoReset' });
            }, 1000);
        }
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
                        gameType: 'tic-tac-toe',
                        roomId,
                        board: createEmptyBoard(),
                        turn: null,
                        currentPlayerId: null,
                        turnOrder: [],
                        players: {},
                        round: 1,
                        isRoundComplete: false,
                        winner: null,
                        winnerId: null,
                        winnerName: null,
                        roundOutcome: null,
                        lastMove: null,
                        score: normalizeScore(),
                        seriesWinner: null,
                        seriesWinnerMarker: null,
                        seriesWinnerName: null,
                        awaitingReset: false,
                        roundCompletedAt: null,
                        gameOver: false,
                        isComplete: false,
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
