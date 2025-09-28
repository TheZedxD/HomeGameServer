import {
  DEFAULT_GUEST_NAME,
  INSTALL_FLAG_KEY
} from './ProfileManager.js';
import { cacheElements } from '../ui/elements.js';
import { createToastManager } from '../ui/toast.js';
import { createProfileUI } from '../ui/profile.js';
import { createLobbyUI } from '../ui/lobby.js';
import { createGameUI } from '../ui/game.js';

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
    this.toast = createToastManager(this.elements.general.toastContainer);
    this.profileUI = createProfileUI(this.elements, this.toast);
    this.lobbyUI = createLobbyUI(this.elements, this.toast);
    this.gameUI = createGameUI(this.elements);
    this.profileManager = null;
  }

  setProfileManager(manager) {
    this.profileManager = manager;
  }

  showView(viewName) {
    const { views, modals, lobby } = this.elements;
    Object.values(views).forEach((view) => view?.classList.add('hidden'));
    const activeView = views[viewName];
    if (activeView) {
      activeView.classList.remove('hidden');
      this.currentView = viewName;
    }
    lobby.lobbyListContainer?.classList.toggle('hidden', viewName !== 'mainLobby');
    if (viewName !== 'gameUI') {
      modals.gameOver?.classList.add('hidden');
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

  updateMatchLobby(room, myPlayerId) {
    this.lobbyUI.updateMatchLobby(room, myPlayerId, (player, fallback) =>
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

  updateScoreboardDisplay(score) {
    this.gameUI.updateScoreboard(score);
  }

  setScoreboardVisibility(isVisible) {
    this.gameUI.setScoreboardVisibility(isVisible);
  }

  updateTurnIndicator(gameState) {
    this.gameUI.updateTurnIndicator(gameState);
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
