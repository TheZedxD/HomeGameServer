'use strict';

const { buildGameInstance } = require('../../core');

const BOARD_SIZE = 8;
const COLORS = ['red', 'black'];

class MovePieceStrategy {
    execute({ state, playerManager, playerId, payload }) {
        if (!playerManager.hasPlayer(playerId)) {
            return { error: 'Player not part of this game.' };
        }
        if (state.isComplete) {
            return { error: 'Game already complete.' };
        }
        const order = playerManager.list().map(p => p.id);
        if (!order.includes(playerId)) {
            return { error: 'Unknown player turn.' };
        }
        const turn = state.turn || order[0];
        if (playerId !== turn) {
            return { error: 'Not your turn.' };
        }

        const color = state.players?.[playerId]?.color;
        if (!color) {
            return { error: 'Player color not assigned.' };
        }

        const mustContinue = state.mustContinue;
        if (mustContinue && mustContinue.playerId !== playerId) {
            return { error: 'Other player must complete capture.' };
        }

        const from = payload?.from;
        const sequence = Array.isArray(payload?.sequence) && payload.sequence.length
            ? payload.sequence
            : (payload?.to ? [payload.to] : []);

        if (!isValidCoordinate(from) || sequence.length === 0 || !sequence.every(isValidCoordinate)) {
            return { error: 'Invalid move coordinates.' };
        }
        if (mustContinue && (from.row !== mustContinue.from.row || from.col !== mustContinue.from.col)) {
            return { error: 'Must continue capture with the same piece.' };
        }

        const original = cloneState(state);
        const board = cloneBoard(state.board);
        let piece = board[from.row][from.col];
        if (!piece) {
            return { error: 'No piece at origin square.' };
        }
        if (!belongsToColor(piece, color)) {
            return { error: 'Cannot move opponent piece.' };
        }

        board[from.row][from.col] = null;
        let currentRow = from.row;
        let currentCol = from.col;
        let capturedAny = false;

        for (const destination of sequence) {
            const { row: destRow, col: destCol } = destination;
            if (board[destRow][destCol]) {
                return { error: 'Destination square occupied.' };
            }
            const rowDiff = destRow - currentRow;
            const colDiff = destCol - currentCol;
            if (Math.abs(rowDiff) !== Math.abs(colDiff)) {
                return { error: 'Move must be diagonal.' };
            }
            const step = Math.abs(rowDiff);
            if (step === 1) {
                if (mustContinue) {
                    return { error: 'Must continue capturing.' };
                }
                if (capturedAny) {
                    return { error: 'Cannot make simple move after capture in same command.' };
                }
                if (!isKing(piece)) {
                    const forward = getForwardDirection(color);
                    if (rowDiff !== forward) {
                        return { error: 'Non-king pieces must move forward.' };
                    }
                }
            } else if (step === 2) {
                const jumpedRow = currentRow + rowDiff / 2;
                const jumpedCol = currentCol + colDiff / 2;
                const jumpedPiece = board[jumpedRow][jumpedCol];
                if (!jumpedPiece || !isOpponentPiece(jumpedPiece, color)) {
                    return { error: 'Jump must capture opponent piece.' };
                }
                board[jumpedRow][jumpedCol] = null;
                capturedAny = true;
                if (!isKing(piece)) {
                    const forward = getForwardDirection(color);
                    if (rowDiff !== forward * 2) {
                        return { error: 'Non-king pieces must capture forward.' };
                    }
                }
            } else {
                return { error: 'Move distance invalid.' };
            }
            currentRow = destRow;
            currentCol = destCol;
        }

        if (!capturedAny && !mustContinue && hasAnyCapture(state.board, color)) {
            return { error: 'Capture available: must capture.' };
        }

        const promoted = shouldPromote(piece, color, currentRow);
        if (promoted) {
            piece = promote(piece);
        }
        board[currentRow][currentCol] = piece;

        const next = cloneState(state);
        next.board = board;
        next.lastMove = {
            playerId,
            from,
            path: sequence,
            captured: capturedAny,
            promoted,
        };

        const opponentId = order.find(id => id !== playerId) || null;
        let nextTurn = opponentId;
        let nextMustContinue = null;

        if (capturedAny) {
            const canContinue = canPieceCapture(board, currentRow, currentCol, piece, color);
            if (canContinue) {
                nextTurn = playerId;
                nextMustContinue = { playerId, from: { row: currentRow, col: currentCol } };
            }
        }

        next.mustContinue = nextMustContinue;
        next.turn = nextTurn;

        const opponentColor = getOppositeColor(color);
        const opponentPieces = countPieces(board, opponentColor);
        const playerPieces = countPieces(board, color);
        const opponentHasMoves = opponentPieces > 0 && hasAnyMoves(board, opponentColor);
        const playerHasMoves = playerPieces > 0 && hasAnyMoves(board, color);

        if (opponentPieces === 0 || !opponentHasMoves) {
            next.isComplete = true;
            next.winner = playerId;
            next.turn = null;
            next.mustContinue = null;
        } else if (playerPieces === 0 || !playerHasMoves) {
            next.isComplete = true;
            next.winner = opponentId;
            next.turn = null;
            next.mustContinue = null;
        }

        return {
            apply() {
                return next;
            },
            getUndo() {
                const previous = cloneState(original);
                return () => ({ state: previous });
            },
        };
    }
}

function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            if ((row + col) % 2 === 1) {
                board[row][col] = 'b';
            }
        }
    }
    for (let row = BOARD_SIZE - 3; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            if ((row + col) % 2 === 1) {
                board[row][col] = 'r';
            }
        }
    }
    return board;
}

function isValidCoordinate(coord) {
    return coord && Number.isInteger(coord.row) && Number.isInteger(coord.col)
        && coord.row >= 0 && coord.row < BOARD_SIZE && coord.col >= 0 && coord.col < BOARD_SIZE;
}

function cloneBoard(board = []) {
    return board.map(row => row.slice());
}

function cloneState(state = {}) {
    return JSON.parse(JSON.stringify(state));
}

function getForwardDirection(color) {
    return color === 'red' ? -1 : 1;
}

function isKing(piece) {
    return piece === 'R' || piece === 'B';
}

function belongsToColor(piece, color) {
    return piece && getPieceColor(piece) === color;
}

function getPieceColor(piece) {
    if (!piece) return null;
    return piece.toLowerCase() === 'r' ? 'red' : 'black';
}

function isOpponentPiece(piece, color) {
    const pieceColor = getPieceColor(piece);
    return pieceColor && pieceColor !== color;
}

function shouldPromote(piece, color, row) {
    if (isKing(piece)) return false;
    return (color === 'red' && row === 0) || (color === 'black' && row === BOARD_SIZE - 1);
}

function promote(piece) {
    return piece === 'r' ? 'R' : 'B';
}

function getOppositeColor(color) {
    return color === 'red' ? 'black' : 'red';
}

function countPieces(board, color) {
    let count = 0;
    for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            if (belongsToColor(board[row][col], color)) {
                count += 1;
            }
        }
    }
    return count;
}

function canPieceCapture(board, row, col, piece, color) {
    const directions = getMoveDirections(piece, color);
    for (const [dRow, dCol] of directions) {
        const midRow = row + dRow;
        const midCol = col + dCol;
        const landingRow = row + dRow * 2;
        const landingCol = col + dCol * 2;
        if (!isValidCoordinate({ row: landingRow, col: landingCol })) {
            continue;
        }
        if (board[landingRow][landingCol] !== null) {
            continue;
        }
        if (isValidCoordinate({ row: midRow, col: midCol }) && isOpponentPiece(board[midRow][midCol], color)) {
            return true;
        }
    }
    return false;
}

function canPieceMove(board, row, col, piece, color) {
    const directions = getMoveDirections(piece, color);
    for (const [dRow, dCol] of directions) {
        const nextRow = row + dRow;
        const nextCol = col + dCol;
        if (isValidCoordinate({ row: nextRow, col: nextCol }) && board[nextRow][nextCol] === null) {
            return true;
        }
        const landingRow = row + dRow * 2;
        const landingCol = col + dCol * 2;
        if (!isValidCoordinate({ row: landingRow, col: landingCol })) {
            continue;
        }
        if (board[landingRow][landingCol] !== null) {
            continue;
        }
        const midRow = row + dRow;
        const midCol = col + dCol;
        if (isValidCoordinate({ row: midRow, col: midCol }) && isOpponentPiece(board[midRow][midCol], color)) {
            return true;
        }
    }
    return false;
}

function hasAnyCapture(board, color) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            const piece = board[row][col];
            if (belongsToColor(piece, color) && canPieceCapture(board, row, col, piece, color)) {
                return true;
            }
        }
    }
    return false;
}

function hasAnyMoves(board, color) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
            const piece = board[row][col];
            if (belongsToColor(piece, color) && canPieceMove(board, row, col, piece, color)) {
                return true;
            }
        }
    }
    return false;
}

function getMoveDirections(piece, color) {
    if (isKing(piece)) {
        return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    }
    const forward = getForwardDirection(color);
    return [[forward, 1], [forward, -1]];
}

function registerPlayers(game, players = []) {
    players.forEach((participant, index) => {
        const color = COLORS[index % COLORS.length];
        const added = game.playerManager.addPlayer({
            id: participant.id,
            displayName: participant.displayName,
            isReady: participant.isReady !== false,
            metadata: { color },
        });
        game.stateManager.update((current) => {
            const next = cloneState(current);
            next.players = next.players || {};
            next.players[added.id] = {
                color,
                displayName: added.displayName,
            };
            next.playerOrder = next.playerOrder || [];
            if (!next.playerOrder.includes(added.id)) {
                next.playerOrder.push(added.id);
            }
            if (!next.turn) {
                next.turn = next.playerOrder[0];
            }
            return next;
        });
    });
}

module.exports = {
    register(registry) {
        return registry.register({
            id: 'checkers',
            name: 'Checkers',
            minPlayers: 2,
            maxPlayers: 2,
            version: '1.0.0',
            create({ roomId, players }) {
                const initialPlayers = Array.isArray(players) ? players : [];
                const initialOrder = initialPlayers.map(p => p.id);
                const game = buildGameInstance({
                    id: 'checkers',
                    minPlayers: 2,
                    maxPlayers: 2,
                    initialState: {
                        roomId,
                        board: createInitialBoard(),
                        turn: initialOrder[0] || null,
                        isComplete: false,
                        winner: null,
                        mustContinue: null,
                        players: initialPlayers.reduce((acc, player, index) => {
                            const color = COLORS[index % COLORS.length];
                            acc[player.id] = {
                                color,
                                displayName: player.displayName,
                            };
                            return acc;
                        }, {}),
                        playerOrder: initialOrder,
                        lastMove: null,
                    },
                    strategies: {
                        movePiece: new MovePieceStrategy(),
                    },
                });
                if (initialPlayers.length) {
                    registerPlayers(game, initialPlayers);
                }
                return game;
            },
        });
    },
};
