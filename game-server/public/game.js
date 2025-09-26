// GAME.JS
// This file manages the entire front-end user experience, from UI interactions
// in the lobby to rendering the Phaser game and communicating with the server.

const socket = io();
let game; // This will hold the Phaser game instance
let myPlayerId;

// --- DOM Element References ---
// Central object to hold references to all key UI containers.
const ui = {
    mainLobby: document.getElementById('main-lobby'),
    matchLobby: document.getElementById('match-lobby'),
    gameUI: document.getElementById('game-ui'),
    createGameModal: document.getElementById('create-game-modal'),
};

const mainLobbyEls = {
    joinOnlineBtn: document.getElementById('join-online-btn'),
    onlineRoomCodeInput: document.getElementById('online-room-code'),
    showCreateGameModalBtn: document.getElementById('show-create-game-modal-btn'),
    roomList: document.getElementById('room-list'),
};

const modalEls = {
    gameSelectionList: document.getElementById('game-selection-list'),
    closeModalBtn: document.getElementById('close-modal-btn'),
};

const matchLobbyEls = {
    gameTypeTitle: document.getElementById('match-lobby-gametype'),
    player1Card: document.getElementById('player1-card'),
    player1Status: document.getElementById('player1-status'),
    player2Card: document.getElementById('player2-card'),
    player2Status: document.getElementById('player2-status'),
    readyBtn: document.getElementById('ready-btn'),
    startGameBtn: document.getElementById('start-game-btn'),
};

const gameEls = {
    mode: document.getElementById('game-mode'),
    color: document.getElementById('player-color'),
    turn: document.getElementById('turn-indicator'),
    gameOverMessage: document.getElementById('game-over-message'),
    winnerText: document.getElementById('winner-text'),
};

// --- Available Games Data ---
// This array makes it easy to add more games in the future.
const availableGames = [
    { id: 'checkers', name: 'Checkers', description: 'Classic 2-player strategy game.' },
    // { id: 'chess', name: 'Chess', description: 'The ultimate game of kings.' }, // Example of a future game
];

// --- UI State Management ---
// A simple function to switch between the main UI views.
function showUI(activeUI) {
    Object.values(ui).forEach(el => el.classList.add('hidden'));
    if (activeUI) activeUI.classList.remove('hidden');
}

// --- UI Event Listeners ---
// Connects the buttons and inputs to their respective functions.
mainLobbyEls.showCreateGameModalBtn.addEventListener('click', () => ui.createGameModal.classList.remove('hidden'));
modalEls.closeModalBtn.addEventListener('click', () => ui.createGameModal.classList.add('hidden'));
matchLobbyEls.readyBtn.addEventListener('click', () => socket.emit('playerReady'));
matchLobbyEls.startGameBtn.addEventListener('click', () => socket.emit('startGame'));
mainLobbyEls.joinOnlineBtn.addEventListener('click', () => {
    const roomCode = mainLobbyEls.onlineRoomCodeInput.value.trim();
    if (roomCode) {
        // We emit 'createGame' which will either create or join a P2P-designated room.
        // The server logic handles finding if it exists already.
        socket.emit('createGame', { gameType: 'Checkers', mode: 'p2p', roomCode });
    } else {
        alert('Please enter a room code.');
    }
});


// --- Socket.IO Event Handlers ---
// This section defines how the client reacts to messages from the server.

socket.on('connect', () => {
    console.log('Successfully connected to the game server with ID:', socket.id);
});

// Updates the list of available LAN games in the main lobby.
socket.on('updateRoomList', (openRooms) => {
    const rooms = Object.values(openRooms);
    if (rooms.length === 0) {
        mainLobbyEls.roomList.innerHTML = `<p style="color: var(--text-secondary);">No open games found. Create one!</p>`;
        return;
    }
    mainLobbyEls.roomList.innerHTML = rooms.map(room => `
        <div class="room-item">
            <div>
                <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.gameType}</p>
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">${room.roomId}</p>
            </div>
            <div style="text-align: right;">
                <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.playerCount}/${room.maxPlayers}</p>
                <button class="btn btn-success" onclick="joinGame('${room.roomId}')">Join</button>
            </div>
        </div>
    `).join('');
});

// Called when a player successfully enters a match lobby.
socket.on('joinedMatchLobby', ({ room, yourId }) => {
    myPlayerId = yourId;
    updateMatchLobby(room);
    showUI(ui.matchLobby);
});

// Called whenever the state of the match lobby changes (e.g., a player joins, readies up).
socket.on('roomStateUpdate', (room) => {
    updateMatchLobby(room);
});

// Triggered by the server when the host starts the game.
socket.on('gameStart', ({ gameState, players }) => {
    showUI(ui.gameUI);
    const myPlayer = players[myPlayerId];
    gameEls.mode.textContent = "LAN"; // This could be updated to show 'P2P' as well
    gameEls.color.textContent = myPlayer.color.toUpperCase();
    gameEls.color.style.color = myPlayer.color;
    updateTurnIndicator(gameState);
    
    // Initialize the Phaser game scene with all necessary data.
    startGameScene({
        socket: socket,
        myColor: myPlayer.color,
        gameState: gameState,
    });
});

// Updates the game board when a move is made.
socket.on('gameStateUpdate', (gameState) => {
    if (game && game.scene.isActive('CheckersScene')) {
        game.scene.getScene('CheckersScene').updateGameState(gameState);
    }
    updateTurnIndicator(gameState);
    if (gameState.gameOver) {
        gameEls.winnerText.textContent = `${gameState.winner.toUpperCase()} Wins!`;
        gameEls.gameOverMessage.classList.remove('hidden');
    }
});

// Handles generic errors sent from the server.
socket.on('error', (message) => alert(`Error: ${message}`));
socket.on('playerLeft', (message) => alert(message));


// --- Helper Functions ---

// Called from an onclick attribute in the dynamically generated room list.
function joinGame(roomId) {
    socket.emit('joinGame', roomId);
}

// Dynamically creates the game selection buttons in the modal.
function populateGameSelection() {
    modalEls.gameSelectionList.innerHTML = availableGames.map(game => `
        <button class="btn btn-primary" data-game-id="${game.id}">${game.name}</button>
    `).join('');

    // Add event listeners to the new buttons after they are created.
    modalEls.gameSelectionList.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', (e) => {
            const gameId = e.target.getAttribute('data-game-id');
            const selectedGame = availableGames.find(g => g.id === gameId);
            socket.emit('createGame', { gameType: selectedGame.name, mode: 'lan' });
            ui.createGameModal.classList.add('hidden');
        });
    });
}

// Updates the match lobby UI based on the latest room state from the server.
function updateMatchLobby(room) {
    matchLobbyEls.gameTypeTitle.textContent = `${room.gameType} Lobby`;
    const playerIds = Object.keys(room.players);

    // Update Player 1 Card (always the first player who joined)
    const p1 = room.players[playerIds[0]];
    matchLobbyEls.player1Card.classList.add('filled');
    matchLobbyEls.player1Card.querySelector('.player-name').textContent = `Player 1 ${playerIds[0] === room.hostId ? '(Host)' : ''}`;
    matchLobbyEls.player1Status.textContent = p1.isReady ? 'Ready' : 'Not Ready';
    matchLobbyEls.player1Status.className = `status ${p1.isReady ? 'ready' : 'not-ready'}`;
    
    // Update Player 2 Card
    if (playerIds.length > 1) {
        const p2 = room.players[playerIds[1]];
        matchLobbyEls.player2Card.classList.add('filled');
        matchLobbyEls.player2Card.querySelector('.player-name').textContent = `Player 2 ${playerIds[1] === room.hostId ? '(Host)' : ''}`;
        matchLobbyEls.player2Status.textContent = p2.isReady ? 'Ready' : 'Not Ready';
        matchLobbyEls.player2Status.className = `status ${p2.isReady ? 'ready' : 'not-ready'}`;
    } else {
        matchLobbyEls.player2Card.classList.remove('filled');
        matchLobbyEls.player2Card.querySelector('.player-name').textContent = 'Waiting for Player...';
        matchLobbyEls.player2Status.textContent = 'Not Ready';
        matchLobbyEls.player2Status.className = 'status not-ready';
    }

    // Update the text and color of this client's "Ready" button.
    const myPlayer = room.players[myPlayerId];
    if (!myPlayer) {
        console.warn('Unable to locate current player in room state update.');
        return;
    }
    if (myPlayer.isReady) {
        matchLobbyEls.readyBtn.textContent = 'Unready';
        matchLobbyEls.readyBtn.classList.remove('btn-warning');
        matchLobbyEls.readyBtn.classList.add('btn-secondary');
    } else {
        matchLobbyEls.readyBtn.textContent = 'Ready Up';
        matchLobbyEls.readyBtn.classList.add('btn-warning');
        matchLobbyEls.readyBtn.classList.remove('btn-secondary');
    }
    
    // Show and enable/disable the host's "Start Game" button.
    if (myPlayerId === room.hostId) {
        matchLobbyEls.startGameBtn.classList.remove('hidden');
        const allReady = Object.values(room.players).every(p => p.isReady);
        const roomFull = Object.keys(room.players).length === room.maxPlayers;
        matchLobbyEls.startGameBtn.disabled = !(allReady && roomFull);
    } else {
        matchLobbyEls.startGameBtn.classList.add('hidden');
    }
}

function updateTurnIndicator(gameState) {
    if (!gameState) return;
    gameEls.turn.textContent = `${gameState.turn.toUpperCase()}'s Turn`;
    gameEls.turn.style.color = gameState.turn === 'red' ? '#ef4444' : '#6b7280';
}

// Destroys any old game instance and creates a new one.
function startGameScene(config) {
    if (game) game.destroy(true);
    const gameConfig = {
        type: Phaser.AUTO, width: 640, height: 640,
        parent: 'game-container', backgroundColor: '#111827',
        scene: new CheckersScene(config)
    };
    game = new Phaser.Game(gameConfig);
}

// --- App Initialization ---
populateGameSelection();
showUI(ui.mainLobby);


// --- Phaser Scene for Checkers ---
// This class contains all the logic for drawing the board and handling clicks.
class CheckersScene extends Phaser.Scene {
    constructor(config) {
        super({ key: 'CheckersScene' });
        this.socket = config.socket;
        this.myColor = config.myColor;
        this.gameState = config.gameState; // Initial state
        this.pieceSprites = null;
        this.selectedPiece = null;
        this.BOARD_SIZE = 8;
        this.CELL_SIZE = 80;
    }

    create() {
        this.pieceSprites = this.add.group();
        this.drawBoard();
        this.renderPieces(); // Render initial state
        this.input.on('pointerdown', this.handleBoardClick, this);
    }

    drawBoard() {
        for (let y = 0; y < this.BOARD_SIZE; y++) {
            for (let x = 0; x < this.BOARD_SIZE; x++) {
                const color = (x + y) % 2 === 0 ? 0xeeeed2 : 0x769656; // Light and dark squares
                this.add.rectangle(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE, color).setOrigin(0, 0);
            }
        }
    }
    
    // This is the main update function called by the server.
    updateGameState(newGameState) {
        this.gameState = newGameState;
        this.renderPieces();
    }

    // Clears the board and redraws all pieces from the current gameState.
    renderPieces() {
        this.pieceSprites.clear(true, true);
        if (!this.gameState || !this.gameState.board) return;
        for (let y = 0; y < this.BOARD_SIZE; y++) {
            for (let x = 0; x < this.BOARD_SIZE; x++) {
                const pieceType = this.gameState.board[y][x];
                if (pieceType !== 0) {
                    const isKing = pieceType === 3 || pieceType === 4;
                    const pieceColor = ([1, 3].includes(pieceType)) ? 0xdc2626 : 0x1f2937; // Red or Black
                    const strokeColor = ([1, 3].includes(pieceType)) ? 0xf87171 : 0x4b5563;
                    const pieceSprite = this.add.container(x * this.CELL_SIZE + this.CELL_SIZE / 2, y * this.CELL_SIZE + this.CELL_SIZE / 2);
                    const circle = this.add.circle(0, 0, this.CELL_SIZE / 2 - 8, pieceColor).setStrokeStyle(4, strokeColor);
                    pieceSprite.add(circle);
                    if (isKing) pieceSprite.add(this.add.text(0, 0, '👑', { fontSize: '24px' }).setOrigin(0.5));
                    pieceSprite.setData({ gridX: x, gridY: y });
                    this.pieceSprites.add(pieceSprite);
                }
            }
        }
    }

    // Handles a click on the game board.
    handleBoardClick(pointer) {
        const gridX = Math.floor(pointer.x / this.CELL_SIZE);
        const gridY = Math.floor(pointer.y / this.CELL_SIZE);

        if (
            gridX < 0 ||
            gridY < 0 ||
            gridX >= this.BOARD_SIZE ||
            gridY >= this.BOARD_SIZE
        ) {
            return;
        }

        if (!this.gameState || this.gameState.turn !== this.myColor) return; // Ignore clicks if it's not our turn

        const pieceAtClick = this.gameState.board[gridY][gridX];
        const isMyPiece = (this.myColor === 'red' && [1, 3].includes(pieceAtClick)) || (this.myColor === 'black' && [2, 4].includes(pieceAtClick));

        if (this.selectedPiece) {
            // If a piece is already selected, this click is the destination.
            const from = { x: this.selectedPiece.x, y: this.selectedPiece.y };
            const to = { x: gridX, y: gridY };
            this.socket.emit('movePiece', { from, to });
            
            // Deselect the piece visually.
            this.selectedPiece.sprite.list[0].setStrokeStyle(4, this.selectedPiece.originalStroke);
            this.selectedPiece = null;

        } else if (isMyPiece) {
            // If no piece is selected and we clicked our own piece, select it.
            const sprite = this.pieceSprites.getChildren().find(p => p.data.get('gridX') === gridX && p.data.get('gridY') === gridY);
            if (sprite) {
                const circle = sprite.list[0];
                this.selectedPiece = { x: gridX, y: gridY, sprite: sprite, originalStroke: circle.strokeColor };
                circle.setStrokeStyle(6, 0xffff00); // Highlight with yellow
            }
        }
    }
}

