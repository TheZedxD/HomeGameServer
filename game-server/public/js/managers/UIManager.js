import {
  DEFAULT_GUEST_NAME,
  INSTALL_FLAG_KEY
} from './ProfileManager.js';
import { cacheElements } from '../ui/elements.js';
import { createToastManager } from '../ui/toast.js';
import { createProfileUI } from '../ui/profile.js';
import { createLobbyUI } from '../ui/lobby.js';
import { createGameUI } from '../ui/game.js';
import { createModalManager } from '../ui/modalManager.js';

function getLocalStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function setLocalStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('Unable to persist localStorage value.', error);
  }
}

export class UIManager {
  constructor() {
    this.currentView = null;
    this.elements = cacheElements();
    this.modalManager = createModalManager(this.elements);
    this.toast = createToastManager(this.elements.general.toastContainer);
    this.profileUI = createProfileUI(this.elements, this.toast, this.modalManager);
    this.lobbyUI = createLobbyUI(this.elements, this.toast, this.modalManager);
    this.gameUI = createGameUI(this.elements, this.modalManager);
    this.profileManager = null;
  }

  setProfileManager(manager) {
    this.profileManager = manager;
  }

  showView(viewName) {
    const { views = {}, modals = {}, lobby = {} } = this.elements || {};
    Object.values(views || {}).forEach((view) => {
      if (view && typeof view.classList?.add === 'function') {
        view.classList.add('hidden');
      }
    });

    const activeView = views?.[viewName];
    if (activeView && typeof activeView.classList?.remove === 'function') {
      activeView.classList.remove('hidden');
      this.currentView = viewName;
    } else if (viewName) {
      console.warn(`Requested view "${viewName}" does not exist in the cached elements.`);
    }

    const lobbyContainer = lobby?.lobbyListContainer;
    if (lobbyContainer && typeof lobbyContainer.classList?.toggle === 'function') {
      lobbyContainer.classList.toggle('hidden', viewName !== 'mainLobby');
    }

    const gameOverModal = modals?.gameOver;
    if (viewName !== 'gameUI' && gameOverModal) {
      if (this.modalManager && typeof this.modalManager.closeModal === 'function') {
        this.modalManager.closeModal(gameOverModal, { returnFocus: false });
      } else if (typeof gameOverModal.classList?.add === 'function') {
        gameOverModal.classList.add('hidden');
      }
    }
  }

  showToast(message, variant = 'info', options = {}) {
    this.toast.showToast(message, variant, options);
  }

  bindIdentityControls(profileManager) {
    this.setProfileManager(profileManager);
    this.profileUI.bindIdentityControls(profileManager);
  }

  bindProfileEvents(profileManager, options) {
    this.setProfileManager(profileManager);
    this.profileUI.bindProfileEvents(profileManager, options);
  }

  updateProfileUI(profile) {
    this.profileUI.updateProfile(profile);
    this.profileUI.toggleProfileActions(!profile?.isGuest);
    this.profileUI.maybeShowProfilePrompt(profile);
  }

  setRoomJoinHandler(handler) {
    this.lobbyUI.setRoomJoinHandler(handler);
  }

  renderRoomList(openRooms) {
    this.lobbyUI.renderRoomList(openRooms);
  }

  bindLobbyControls(options) {
    this.lobbyUI.bindLobbyControls(options);
  }

  updateAvailableGames(availableGames) {
    if (typeof this.lobbyUI.updateAvailableGames === 'function') {
      this.lobbyUI.updateAvailableGames(availableGames);
    }
  }

  updateMatchLobby(room, myPlayerId) {
    if (!room || typeof room !== 'object') {
      console.warn('Received invalid room payload for lobby update.', room);
      return;
    }

    const normalizedPlayers = (() => {
      if (!room.players) {
        return {};
      }
      if (Array.isArray(room.players)) {
        return room.players.reduce((acc, player = {}) => {
          const playerId =
            player.id || player.playerId || player.socketId || player.uuid || player._id;
          if (playerId) {
            acc[playerId] = player;
          }
          return acc;
        }, {});
      }
      if (typeof room.players === 'object') {
        return room.players;
      }
      return {};
    })();

    const normalizedRoom = {
      gameType: room.gameType || room.gameName || room.metadata?.name || 'Match',
      players: normalizedPlayers,
      hostId: room.hostId || room.host?.id || null,
      maxPlayers: room.maxPlayers || room.playerLimit || Object.keys(normalizedPlayers).length || 2
    };

    this.lobbyUI.updateMatchLobby(normalizedRoom, myPlayerId, (player, fallback) =>
      this.derivePlayerLabel(player, fallback)
    );
  }

  derivePlayerLabel(player, fallback) {
    if (!player) return fallback;
    const rawLabel =
      player.username ||
      player.name ||
      player.displayName ||
      player.playerName ||
      '';
    const sanitized = this.profileManager?.sanitizeName(rawLabel).slice(0, 24) || '';
    return sanitized || fallback || DEFAULT_GUEST_NAME;
  }

  syncCurrentPlayers(players) {
    this.gameUI.syncPlayers(players, (player, fallback) => this.derivePlayerLabel(player, fallback));
  }

  setGameType(gameId) {
    if (typeof this.gameUI.setGameType === 'function') {
      this.gameUI.setGameType(gameId);
    }
  }

  updateScoreboardDisplay(score, context) {
    this.gameUI.updateScoreboard(score, context);
  }

  setScoreboardVisibility(isVisible) {
    this.gameUI.setScoreboardVisibility(isVisible);
  }

  updateTurnIndicator(gameState, context) {
    this.gameUI.updateTurnIndicator(gameState, context);
  }

  showGameOver(message) {
    this.gameUI.showGameOver(message);
  }

  initializeServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SERVICE_WORKER_READY') {
        this.handleServiceWorkerReady();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .catch((error) => console.warn('Service worker registration failed.', error));
    });
  }

  async handleServiceWorkerReady() {
    const installFlag = getLocalStorageItem(INSTALL_FLAG_KEY);
    if (!installFlag) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      } catch (error) {
        console.warn('Unable to clear caches during initial install.', error);
      }
      try {
        localStorage.clear();
      } catch (error) {
        console.warn('Unable to clear localStorage during initial install.', error);
      }
    }
    setLocalStorageItem(INSTALL_FLAG_KEY, 'true');
  }
}
