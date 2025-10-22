import { CheckersScene } from '../components/CheckersScene.js';
import { CardGameScene } from '../components/CardGameScene.js';
import { DEFAULT_GUEST_NAME } from './ProfileManager.js';
import { ErrorHandler } from '../utils/ErrorHandler.js';

const PLAYER_COLOR_SWATCHES = {
  red: '#ff6b6b',
  black: '#f5f5dc'
};

const DEFAULT_GAME_METADATA = {
  checkers: {
    id: 'checkers',
    name: 'Checkers',
    description: 'Classic 2-player strategy game.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'board'
  },
  'tic-tac-toe': {
    id: 'tic-tac-toe',
    name: 'Tic-Tac-Toe',
    description: 'Classic 3×3 strategy game.',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'board'
  },
  war: {
    id: 'war',
    name: 'War',
    description: 'Classic card game - highest card wins!',
    minPlayers: 2,
    maxPlayers: 2,
    category: 'cards'
  },
  hearts: {
    id: 'hearts',
    name: 'Hearts',
    description: 'Avoid hearts and the Queen of Spades!',
    minPlayers: 4,
    maxPlayers: 4,
    category: 'cards'
  }
};

export class GameManager {
  constructor(socket, uiManager, profileManager) {
    this.socket = socket;
    this.uiManager = uiManager;
    this.profileManager = profileManager;
    this.gameInstance = null;
    this.currentPlayers = null;
    this.myPlayerId = null;
    this.activeGameId = null;
    this.roomListVersion = 0;
    this.gameOverShown = false;
    this.lastGameOverState = null;

    this.availableGames = this.normalizeAvailableGames([
      DEFAULT_GAME_METADATA.checkers,
      DEFAULT_GAME_METADATA['tic-tac-toe'],
      DEFAULT_GAME_METADATA.war,
      DEFAULT_GAME_METADATA.hearts
    ]);

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
    this.socket.on('availableGames', (games) => {
      this.availableGames = this.normalizeAvailableGames(games);
      this.uiManager.updateAvailableGames(this.availableGames);
    });
    this.socket.on('connect', () => {
      console.log('Successfully connected to the game server with ID:', this.socket.id);
      this.syncProfileWithSocket(this.profileManager.profile);
    });
    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      ErrorHandler.showUserError('Failed to connect to game server. Please refresh the page.');
    });
    this.socket.on('updateRoomList', (payload) => {
      if (payload.version && payload.version <= this.roomListVersion) {
        console.debug('Ignoring stale room list update');
        return;
      }
      this.roomListVersion = payload.version || 0;
      this.uiManager.renderRoomList(payload.rooms || payload);
    });
    this.socket.on('joinedMatchLobby', ({ room, yourId }) => {
      console.log('Joined match lobby:', room, 'My ID:', yourId);
      this.myPlayerId = yourId;
      this.uiManager.updateMatchLobby(room, this.myPlayerId);
      this.uiManager.setScoreboardVisibility(false);
      this.uiManager.showView('matchLobby');
    });
    this.socket.on('roomStateUpdate', (room) => {
      console.log('Room state update received:', room);
      this.uiManager.updateMatchLobby(room, this.myPlayerId);
      this.syncCurrentPlayersWithRoom(room);
    });
    this.socket.on('gameStart', ({ gameState, players, mode, gameId }) => {
      const normalizedState = this.normalizeGameState(gameState);
      this.activeGameId = gameId || normalizedState?.id || this.activeGameId || 'checkers';
      this.currentPlayers = this.normalizePlayers(players);
      const myPlayer = this.currentPlayers?.[this.myPlayerId] || {};
      this.uiManager.showView('gameUI');
      if (this.uiManager.elements.game.mode) {
        this.uiManager.elements.game.mode.textContent = mode === 'p2p' ? 'Online (P2P)' : 'LAN';
      }
      const playerColorLabel = this.uiManager.elements.game.color;
      if (playerColorLabel) {
        if (myPlayer.color) {
          playerColorLabel.textContent = myPlayer.color.toUpperCase();
          const colorAccent = PLAYER_COLOR_SWATCHES[myPlayer.color] || '#f5f5dc';
          playerColorLabel.style.color = colorAccent;
          playerColorLabel.style.textShadow =
            myPlayer.color === 'red'
              ? '0 0 12px rgba(255, 99, 99, 0.85)'
              : '0 0 12px rgba(255, 235, 180, 0.7)';
        } else if (myPlayer.marker) {
          playerColorLabel.textContent = myPlayer.marker.toUpperCase();
          playerColorLabel.style.color = '';
          playerColorLabel.style.textShadow = '';
        } else {
          playerColorLabel.textContent = '';
          playerColorLabel.style.color = '';
          playerColorLabel.style.textShadow = '';
        }
      }

      this.uiManager.setGameType(this.activeGameId);
      this.uiManager.updateTurnIndicator(normalizedState, { players: this.currentPlayers, gameId: this.activeGameId });
      this.uiManager.syncCurrentPlayers(this.currentPlayers);
      this.uiManager.setScoreboardVisibility(true);
      this.uiManager.updateScoreboardDisplay(
        normalizedState.score || {},
        { players: this.currentPlayers, gameId: this.activeGameId }
      );
      this.startGame({
        socket: this.socket,
        myColor: myPlayer.color,
        gameState: normalizedState,
        roundMessage: `Round ${normalizedState.round || 1}`
      });
    });
    this.socket.on('gameStateUpdate', (payload = {}) => {
      const nextState = this.normalizeGameState(payload);

      if (this.gameInstance && typeof this.gameInstance.updateGameState === 'function') {
        this.gameInstance.updateGameState(nextState);
      }

      if (nextState.score) {
        this.uiManager.updateScoreboardDisplay(nextState.score, {
          players: this.currentPlayers,
          gameId: this.activeGameId
        });
      }

      this.uiManager.updateTurnIndicator(nextState, {
        players: this.currentPlayers,
        gameId: this.activeGameId
      });

      if (nextState.gameOver || nextState.isComplete) {
        const stateKey = `${nextState.round}-${nextState.winner}-${nextState.winnerId}`;

        if (stateKey !== this.lastGameOverState) {
          this.lastGameOverState = stateKey;
          const winnerLabel = this.getWinnerAnnouncement(nextState);
          if (winnerLabel && !this.gameOverShown) {
            this.gameOverShown = true;
            this.uiManager.showGameOver(winnerLabel);
          }
        }
      } else {
        this.gameOverShown = false;
        this.lastGameOverState = null;
      }
    });
    this.socket.on('roundEnd', (event = {}) => {
      const { outcome, winnerColor, winnerMarker, winnerName, seriesWinnerName, seriesWinnerId, score, redScore, blackScore } = event;
      let announcement;
      if (seriesWinnerName && outcome?.result !== 'draw') {
        announcement = `${seriesWinnerName} wins the round and the series!`;
      } else if (seriesWinnerName) {
        announcement = `${seriesWinnerName} wins the series!`;
      } else if (outcome?.result === 'draw') {
        announcement = 'Round ended in a draw!';
      } else if (winnerName) {
        announcement = `${winnerName} wins the round!`;
      } else if (winnerColor) {
        announcement = `${this.formatColorLabel(winnerColor)} wins the round!`;
      } else if (winnerMarker) {
        announcement = `${winnerMarker} wins the round!`;
      } else {
        announcement = 'Round complete!';
      }
      if (this.gameInstance && typeof this.gameInstance.showAnnouncement === 'function') {
        this.gameInstance.showAnnouncement(announcement);
      } else {
        this.uiManager.showToast(announcement, 'info');
      }
      if (score) {
        this.uiManager.updateScoreboardDisplay(score, { players: this.currentPlayers, gameId: this.activeGameId });
      } else if (typeof redScore !== 'undefined' || typeof blackScore !== 'undefined') {
        this.uiManager.updateScoreboardDisplay(
          { red: redScore, black: blackScore },
          { players: this.currentPlayers, gameId: this.activeGameId }
        );
      }
      // Reload profile if current player won (handles both series and single game wins)
      const actualWinnerId = seriesWinnerId || event.winnerId;
      if (actualWinnerId && actualWinnerId === this.myPlayerId) {
        this.profileManager.loadProfile();
      }
    });

    this.socket.on('roomClosing', ({ reason, secondsRemaining }) => {
      this.uiManager.showToast(
        `${reason}. Returning to lobby in ${secondsRemaining}s...`,
        'warning',
        { duration: secondsRemaining * 1000 }
      );
    });

    this.socket.on('roomClosed', () => {
      this.leaveGame();
      this.uiManager.showToast('Room has been closed', 'info');
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
    this.socket.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        ErrorHandler.showUserError('Disconnected from server. Please refresh the page.');
      }
    });

    this.socket.emit = new Proxy(this.socket.emit, {
      apply: (target, thisArg, args) => {
        try {
          return Reflect.apply(target, thisArg, args);
        } catch (error) {
          console.error('Socket emission failed:', error);
          ErrorHandler.showUserError('Failed to communicate with server.');
          throw error;
        }
      }
    });
  }

  createGame(game, roomCode, mode = 'lan') {
    if (!game) return;
    const selectedGame = game.id ? game : DEFAULT_GAME_METADATA.checkers;
    const payload = { gameType: selectedGame.id, mode };
    if (roomCode) {
      payload.roomCode = roomCode;
    }
    this.socket.emit('createGame', payload);
    const modal = this.uiManager.elements.modals.createGame;
    if (this.uiManager.modalManager && modal) {
      this.uiManager.modalManager.closeModal(modal);
    } else {
      modal?.classList.add('hidden');
    }
  }

  joinGame(roomId) {
    this.socket.emit('joinGame', roomId);
  }

  leaveGame() {
    this.gameOverShown = false;
    this.lastGameOverState = null;

    if (this.socket && this.socket.connected) {
      this.socket.emit('leaveGame');
    }

    this.destroyGameInstance();
    this.currentPlayers = null;
    this.activeGameId = null;
    this.uiManager.syncCurrentPlayers(null);
    this.uiManager.setScoreboardVisibility(false);
    this.uiManager.showView('mainLobby');
    this.uiManager.showToast('Returned to the main lobby.', 'info');
  }

  destroyGameInstance() {
    if (this.gameInstance && typeof this.gameInstance.destroy === 'function') {
      this.gameInstance.destroy();
    }
    this.gameInstance = null;
  }

  startGame(config) {
    this.destroyGameInstance();

    // Determine which scene to use based on game type
    const gameType = this.activeGameId;
    const gameMetadata = DEFAULT_GAME_METADATA[gameType];

    if (gameMetadata?.category === 'cards') {
      // Use CardGameScene for card games
      this.gameInstance = new CardGameScene({
        ...config,
        playerId: this.myPlayerId,
        containerId: 'game-container'
      });
    } else {
      // Use CheckersScene for board games (checkers, tic-tac-toe)
      this.gameInstance = new CheckersScene({
        ...config,
        containerId: 'game-container'
      });
    }

    if (typeof this.gameInstance.init === 'function') {
      this.gameInstance.init();
    }
  }

  syncCurrentPlayersWithRoom(room) {
    if (!room || !this.currentPlayers) return;
    const updates = this.normalizePlayers(room.players);
    if (updates) {
      Object.entries(updates).forEach(([id, player]) => {
        if (this.currentPlayers[id]) {
          this.currentPlayers[id] = { ...this.currentPlayers[id], ...player };
        }
      });
    }
    this.uiManager.syncCurrentPlayers(this.currentPlayers);
  }

  formatColorLabel(color) {
    if (!color) return DEFAULT_GUEST_NAME;
    if (typeof color !== 'string') return DEFAULT_GUEST_NAME;
    if (color === 'red' || color === 'black') {
      return color.charAt(0).toUpperCase() + color.slice(1);
    }
    return color.toUpperCase();
  }

  normalizeGameState(payload) {
    if (!payload) return {};
    if (payload.state && typeof payload.state === 'object') {
      return payload.state;
    }
    return payload;
  }

  normalizePlayers(players) {
    if (!players) return null;
    if (Array.isArray(players)) {
      return players.reduce((acc, player) => {
        if (player?.id) {
          acc[player.id] = player;
        }
        return acc;
      }, {});
    }
    if (typeof players === 'object') {
      return { ...players };
    }
    return null;
  }

  getPlayerLabelById(playerId, fallback = DEFAULT_GUEST_NAME) {
    if (!playerId) return fallback;
    const player = this.currentPlayers?.[playerId];
    if (!player) {
      return fallback;
    }
    const rawLabel =
      player.username || player.displayName || player.playerName || player.name || '';
    const sanitized = this.profileManager?.sanitizeName(rawLabel || '').slice(0, 24) || '';
    if (sanitized) {
      return sanitized;
    }
    if (player.color) {
      return this.formatColorLabel(player.color);
    }
    if (player.marker) {
      return `${player.marker}`.toUpperCase();
    }
    return fallback;
  }

  getWinnerAnnouncement(state) {
    if (!state) return null;
    if (state.seriesWinner) {
      const label = state.seriesWinnerName || this.getPlayerLabelById(state.seriesWinner);
      return `${label} Wins the Series!`;
    }
    if (state.winnerName) {
      return `${state.winnerName} Wins!`;
    }
    if (state.winnerColor) {
      return `${this.formatColorLabel(state.winnerColor)} Wins!`;
    }
    if (state.winner) {
      return `${this.getPlayerLabelById(state.winner)} Wins!`;
    }
    return null;
  }

  normalizeAvailableGames(games) {
    const collection = Array.isArray(games)
      ? games
      : (games && typeof games === 'object' ? Object.values(games) : []);
    const source = collection.length ? collection : Object.values(DEFAULT_GAME_METADATA);
    return source.map((game) => {
      const defaults = DEFAULT_GAME_METADATA[game.id] || {};
      return {
        id: game.id || defaults.id || game.name,
        name: game.name || defaults.name || game.id || 'Unknown Game',
        description: game.description || defaults.description || '',
        minPlayers: game.minPlayers || defaults.minPlayers,
        maxPlayers: game.maxPlayers || defaults.maxPlayers
      };
    });
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
