// SERVER.JS
// This version is updated to support the new "Match Lobby" and "Ready" system.

const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const path = require('path');
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

let players = {};
let rooms = {}; // For both LAN and P2P staging
const MAX_PLAYERS_PER_ROOM = 2;

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);
    players[socket.id] = { playerId: socket.id, inRoom: null };
    socket.emit('updateRoomList', getOpenRooms());

    // --- Lobby Management ---
    socket.on('createGame', ({ gameType, mode, roomCode }) => {
        const roomId = mode === 'p2p' ? roomCode : `room_${Math.random().toString(36).substr(2, 5)}`;
        
        rooms[roomId] = {
            roomId,
            hostId: socket.id,
            gameType,
            mode,
            maxPlayers: 2, // Hardcoded for now
            players: {},
            gameState: null,
            score: { red: 0, black: 0 },
            round: 1
        };
        
        console.log(`[${mode.toUpperCase()}] Room created: ${roomId} for ${gameType}`);
        joinRoom(socket, roomId);
    });

    socket.on('joinGame', (roomId) => {
        if (rooms[roomId] && Object.keys(rooms[roomId].players).length < rooms[roomId].maxPlayers) {
            joinRoom(socket, roomId);
        } else {
            socket.emit('error', 'Room is full or does not exist.');
        }
    });

    // --- Match Lobby (Staging Area) Logic ---
    socket.on('playerReady', () => {
        const roomId = players[socket.id].inRoom;
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            const player = rooms[roomId].players[socket.id];
            player.isReady = !player.isReady; // Toggle ready state
            console.log(`Player ${socket.id} in room ${roomId} is now ${player.isReady ? 'READY' : 'NOT READY'}`);
            io.to(roomId).emit('roomStateUpdate', rooms[roomId]);
        }
    });

    socket.on('startGame', () => {
        const roomId = players[socket.id].inRoom;
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            const allReady = Object.values(room.players).every(p => p.isReady);
            if (allReady && Object.keys(room.players).length === room.maxPlayers) {
                 console.log(`Host starting game in room ${roomId}`);
                 // Assign colors based on join order
                 const playerIds = Object.keys(room.players);
                 room.players[playerIds[0]].color = 'red';
                 room.players[playerIds[1]].color = 'black';

                 room.score = { red: 0, black: 0 };
                 room.round = 1;
                 room.gameState = initializeCheckersState(room.players, room.round, room.score);
                 io.to(roomId).emit('gameStart', { gameState: room.gameState, players: room.players });
            } else {
                 socket.emit('error', 'Cannot start: Not all players are ready or the room is not full.');
            }
        }
    });

    // --- In-Game Logic ---
    socket.on('movePiece', (moveData) => {
        const roomId = players[socket.id].inRoom;
        const room = rooms[roomId];
        if (!room || !room.gameState) return;

        const validationResult = validateCheckersMove(room.gameState, moveData.from, moveData.to, socket.id);

        if (validationResult.isValid) {
            room.gameState = validationResult.newGameState;
            const winner = checkForWinner(room.gameState);
            if (winner) {
                const winnerColor = winner;
                const winnerSocketId = Object.keys(room.players).find(pid => room.players[pid].color === winnerColor);
                const winnerPlayer = winnerSocketId ? room.players[winnerSocketId] : null;
                const winnerName = winnerPlayer?.username || winnerPlayer?.name || winnerPlayer?.displayName || winnerColor;

                room.score[winnerColor] += 1;
                room.gameState.score = { ...room.score };

                if (room.score[winnerColor] >= 2) {
                    room.gameState.gameOver = true;
                    room.gameState.winner = winnerColor;
                    room.gameState.winnerName = winnerName;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);
                } else {
                    room.gameState.gameOver = false;
                    room.gameState.winner = null;
                    room.gameState.roundWinner = winnerColor;
                    io.to(roomId).emit('gameStateUpdate', room.gameState);

                    io.to(roomId).emit('roundEnd', {
                        winnerColor,
                        winnerName,
                        redScore: room.score.red,
                        blackScore: room.score.black,
                        round: room.round
                    });

                    room.round += 1;
                    room.gameState = initializeCheckersState(room.players, room.round, room.score);

                    setTimeout(() => {
                        io.to(roomId).emit('gameStart', { gameState: room.gameState, players: room.players });
                    }, 2000);
                }
            } else {
                room.gameState.score = { ...room.score };
                io.to(roomId).emit('gameStateUpdate', room.gameState);
            }
        } else {
            socket.emit('illegalMove', validationResult.reason);
        }
    });

    // --- Disconnection Handling ---
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomId = players[socket.id]?.inRoom;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            delete room.players[socket.id];
            console.log(`Player ${socket.id} removed from room ${roomId}`);
            
            if (Object.keys(room.players).length === 0) {
                console.log(`Room ${roomId} is empty, deleting.`);
                delete rooms[roomId];
            } else {
                // If host disconnects, make another player the new host
                if (room.hostId === socket.id) {
                    room.hostId = Object.keys(room.players)[0];
                    console.log(`Host disconnected. New host is ${room.hostId}`);
                }
                // Notify remaining players of the change
                io.to(roomId).emit('roomStateUpdate', room);
                io.to(roomId).emit('playerLeft', 'The other player has disconnected.');
            }
        }
        delete players[socket.id];
        io.emit('updateRoomList', getOpenRooms());
    });
});

function joinRoom(socket, roomId) {
    const player = players[socket.id];
    const room = rooms[roomId];

    player.inRoom = roomId;
    room.players[socket.id] = {
        playerId: socket.id,
        isReady: false
    };
    
    socket.join(roomId);
    console.log(`Player ${socket.id} joined room ${roomId}`);
    
    socket.emit('joinedMatchLobby', { room, yourId: socket.id });
    // Notify everyone in the room (including sender) about the new state
    io.to(roomId).emit('roomStateUpdate', room);
    // Update the public lobby list for everyone else
    io.emit('updateRoomList', getOpenRooms());
}

function getOpenRooms() {
    const openRooms = {};
    for (const id in rooms) {
        if (rooms[id].mode === 'lan' && Object.keys(rooms[id].players).length < rooms[id].maxPlayers) {
            openRooms[id] = {
                roomId: id,
                gameType: rooms[id].gameType,
                playerCount: Object.keys(rooms[id].players).length,
                maxPlayers: rooms[id].maxPlayers
            };
        }
    }
    return openRooms;
}

// --- Checkers Game State and Rules Engine (Unchanged) ---
function initializeCheckersState(players, round = 1, score = { red: 0, black: 0 }) {
  let board = [ [0, 2, 0, 2, 0, 2, 0, 2], [2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0] ];
  const redPlayerId = Object.values(players).find(p => p.color === 'red')?.playerId;
  const blackPlayerId = Object.values(players).find(p => p.color === 'black')?.playerId;
  return {
    board: board,
    turn: 'red',
    players: { red: redPlayerId, black: blackPlayerId },
    gameOver: false,
    winner: null,
    winnerName: null,
    round,
    score: { ...score }
  };
}
function validateCheckersMove(gameState, from, to, playerId) {
    const { board, turn, players } = gameState;
    const playerColor = players.red === playerId ? 'red' : 'black';
    if (turn !== playerColor) return { isValid: false, reason: "It's not your turn." };
    if (!board[from.y] || !board[from.y][from.x] || !board[to.y] || board[to.y][to.x] !== 0) return { isValid: false, reason: "Invalid start or end position." };
    const piece = board[from.y][from.x]; const isKing = piece === 3 || piece === 4;
    const opponentPieces = playerColor === 'red' ? [2, 4] : [1, 3];
    const dx = to.x - from.x; const dy = to.y - from.y;
    if (!isKing) {
        if (playerColor === 'red' && dy >= 0) return { isValid: false, reason: "Regular pieces can only move forward." };
        if (playerColor === 'black' && dy <= 0) return { isValid: false, reason: "Regular pieces can only move forward." };
    }
    const newGameState = JSON.parse(JSON.stringify(gameState));
    if (Math.abs(dx) === 1 && Math.abs(dy) === 1) { newGameState.board[to.y][to.x] = piece; newGameState.board[from.y][from.x] = 0; }
    else if (Math.abs(dx) === 2 && Math.abs(dy) === 2) {
        const jumpedX = from.x + dx/2; const jumpedY = from.y + dy/2;
        if (!opponentPieces.includes(board[jumpedY][jumpedX])) return { isValid: false, reason: "Invalid jump."};
        newGameState.board[to.y][to.x] = piece; newGameState.board[from.y][from.x] = 0; newGameState.board[jumpedY][jumpedX] = 0;
    } else { return { isValid: false, reason: "Invalid move." }; }
    if (playerColor === 'red' && to.y === 0) newGameState.board[to.y][to.x] = 3;
    if (playerColor === 'black' && to.y === 7) newGameState.board[to.y][to.x] = 4;
    newGameState.turn = playerColor === 'red' ? 'black' : 'red';
    return { isValid: true, newGameState };
}
function checkForWinner(gameState) {
    let redPieces = 0; let blackPieces = 0;
    for(let r of gameState.board) { for(let c of r) {
        if (c === 1 || c === 3) redPieces++; if (c === 2 || c === 4) blackPieces++;
    } }
    if (redPieces === 0) return 'black'; if (blackPieces === 0) return 'red';
    return null;
}

const PORT = process.env.PORT || 8081;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
