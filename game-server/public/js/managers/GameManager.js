import { CheckersScene } from '../components/CheckersScene.js';
import { DEFAULT_GUEST_NAME } from './ProfileManager.js';

const PLAYER_COLOR_SWATCHES = {
  red: '#ff6b6b',
  black: '#f5f5dc'
};

export class GameManager {
  constructor(socket, uiManager, profileManager) {
    this.socket = socket;
    this.uiManager = uiManager;
    this.profileManager = profileManager;
    this.gameInstance = null;
    this.currentPlayers = null;
    this.myPlayerId = null;

    this.availableGames = [
      { id: 'checkers', name: 'Checkers', description: 'Classic 2-player strategy game.' }
    ];

    this.uiManager.setRoomJoinHandler((roomId) => this.joinGame(roomId));
    this.uiManager.bindLobbyControls({
      availableGames: this.availableGames,
      onReady: () => this.socket.emit('playerReady'),
      onStartGame: () => this.socket.emit('startGame'),
      onCreateGame: (game) => this.createGame(game),
      onJoinGame: (roomCode) => this.joinGame(roomCode)
    });

    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('Successfully connected to the game server with ID:', this.socket.id);
      this.syncProfileWithSocket(this.profileManager.profile);
    });
    this.socket.on('updateRoomList', (openRooms) => {
      this.uiManager.renderRoomList(openRooms);
    });
    this.socket.on('joinedMatchLobby', ({ room, yourId }) => {
      this.myPlayerId = yourId;
      this.uiManager.updateMatchLobby(room, this.myPlayerId);
      this.uiManager.setScoreboardVisibility(false);
      this.uiManager.showView('matchLobby');
    });
    this.socket.on('roomStateUpdate', (room) => {
      this.uiManager.updateMatchLobby(room, this.myPlayerId);
      this.syncCurrentPlayersWithRoom(room);
    });
    this.socket.on('gameStart', ({ gameState, players, mode }) => {
      this.currentPlayers = players;
      const myPlayer = players[this.myPlayerId];
      this.uiManager.showView('gameUI');
      if (this.uiManager.elements.game.mode) {
        this.uiManager.elements.game.mode.textContent = mode === 'p2p' ? 'Online (P2P)' : 'LAN';
      }
      if (this.uiManager.elements.game.color) {
        this.uiManager.elements.game.color.textContent = myPlayer.color.toUpperCase();
        const colorAccent = PLAYER_COLOR_SWATCHES[myPlayer.color] || '#f5f5dc';
        this.uiManager.elements.game.color.style.color = colorAccent;
        this.uiManager.elements.game.color.style.textShadow =
          myPlayer.color === 'red'
            ? '0 0 12px rgba(255, 99, 99, 0.85)'
            : '0 0 12px rgba(255, 235, 180, 0.7)';
      }

      this.uiManager.updateTurnIndicator(gameState);
      this.uiManager.syncCurrentPlayers(players);
      this.uiManager.setScoreboardVisibility(true);
      this.uiManager.updateScoreboardDisplay(gameState.score || { red: 0, black: 0 });
      this.startGame({
        socket: this.socket,
        myColor: myPlayer.color,
        gameState,
        roundMessage: `Round ${gameState.round || 1}`
      });
    });
    this.socket.on('gameStateUpdate', (gameState) => {
      if (this.gameInstance && this.gameInstance.scene.isActive('CheckersScene')) {
        this.gameInstance.scene.getScene('CheckersScene').updateGameState(gameState);
      }
      if (gameState.score) {
        this.uiManager.updateScoreboardDisplay(gameState.score);
      }
      this.uiManager.updateTurnIndicator(gameState);
      if (gameState.gameOver) {
        const winnerLabel = gameState.winnerName || this.formatColorLabel(gameState.winner);
        this.uiManager.showGameOver(`${winnerLabel} Wins!`);
        this.profileManager.loadProfile();
      }
    });
    this.socket.on('roundEnd', ({ winnerColor, winnerName, redScore, blackScore }) => {
      const announcement = `${winnerName || this.formatColorLabel(winnerColor)} wins the round!`;
      if (this.gameInstance && this.gameInstance.scene.isActive('CheckersScene')) {
        const scene = this.gameInstance.scene.getScene('CheckersScene');
        if (scene && typeof scene.showAnnouncement === 'function') {
          scene.showAnnouncement(announcement);
        }
      } else {
        this.uiManager.showToast(announcement, 'info');
      }
      this.uiManager.updateScoreboardDisplay({ red: redScore, black: blackScore });
    });
    this.socket.on('error', (message) => {
      if (typeof message === 'string' && message.includes('does not exist')) {
        const codeInput = this.uiManager.elements.lobby.onlineRoomCodeInput;
        const roomCode = (codeInput?.value || '').trim().toUpperCase();
        if (roomCode) {
          this.createGame({ id: 'checkers', name: 'Checkers' }, roomCode, 'p2p');
          return;
        }
      }
      this.uiManager.showToast(message, 'error');
    });
    this.socket.on('playerLeft', (message) => this.uiManager.showToast(message, 'info'));
    this.socket.on('illegalMove', (message) => this.uiManager.showToast(message, 'error'));
  }

  createGame(game, roomCode, mode = 'lan') {
    if (!game) return;
    const payload = { gameType: game.name, mode };
    if (roomCode) {
      payload.roomCode = roomCode;
    }
    this.socket.emit('createGame', payload);
    this.uiManager.elements.modals.createGame?.classList.add('hidden');
  }

  joinGame(roomId) {
    this.socket.emit('joinGame', roomId);
  }

  leaveGame() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('leaveGame');
    }
    this.destroyGameInstance();
    this.currentPlayers = null;
    this.uiManager.syncCurrentPlayers(null);
    this.uiManager.setScoreboardVisibility(false);
    this.uiManager.showView('mainLobby');
    this.uiManager.showToast('Returned to the main lobby.', 'info');
  }

  destroyGameInstance() {
    if (this.gameInstance) {
      this.gameInstance.destroy(true);
      this.gameInstance = null;
    }
  }

  startGame(config) {
    this.destroyGameInstance();
    const gameConfig = {
      type: Phaser.AUTO,
      width: 640,
      height: 640,
      parent: 'game-container',
      backgroundColor: '#0b3d0b',
      scene: new CheckersScene(config)
    };
    this.gameInstance = new Phaser.Game(gameConfig);
  }

  syncCurrentPlayersWithRoom(room) {
    if (!room || !this.currentPlayers) return;
    Object.entries(room.players).forEach(([id, player]) => {
      if (this.currentPlayers[id]) {
        this.currentPlayers[id].username = player.username;
      }
    });
    this.uiManager.syncCurrentPlayers(this.currentPlayers);
  }

  formatColorLabel(color) {
    if (!color) return DEFAULT_GUEST_NAME;
    return color.charAt(0).toUpperCase() + color.slice(1);
  }

  syncProfileWithSocket(profile) {
    if (!this.socket.connected) {
      return;
    }
    const activeProfile = profile || this.profileManager.getGuestProfile();
    const displayName = activeProfile.displayName || DEFAULT_GUEST_NAME;
    if (displayName) {
      this.socket.emit('setUsername', displayName);
    }
    if (!activeProfile.isGuest) {
      this.socket.emit('linkAccount', {
        accountName: activeProfile.username,
        displayName
      });
    }
  }
}
