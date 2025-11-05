// ============================================================================
// HomeGameServer - Simplified Frontend
// ============================================================================
// Simple username-based system with localStorage persistence

import { UIManager } from './managers/UIManager.js';
import { GameManager } from './managers/GameManager.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { createTutorialManager } from './ui/tutorial.js';

// ============================================================================
// Local Storage Manager
// ============================================================================

class LocalStorageManager {
  constructor() {
    this.STORAGE_KEY = 'homegameserver_user';
  }

  getUsername() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.username || null;
      }
    } catch (error) {
      console.error('[LocalStorage] Error reading username:', error);
    }
    return null;
  }

  setUsername(username) {
    try {
      const data = { username, savedAt: new Date().toISOString() };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[LocalStorage] Error saving username:', error);
      return false;
    }
  }

  clear() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('[LocalStorage] Error clearing data:', error);
    }
  }
}

// ============================================================================
// User Manager
// ============================================================================

class UserManager {
  constructor(socket, storage) {
    this.socket = socket;
    this.storage = storage;
    this.username = null;
    this.stats = {
      wins: 0,
      losses: 0,
      gamesPlayed: 0
    };
  }

  async initialize() {
    // Try to load username from localStorage
    const savedUsername = this.storage.getUsername();

    if (savedUsername) {
      await this.setUsername(savedUsername);
    } else {
      this.setGuestUsername();
    }

    this.updateUI();
  }

  setGuestUsername() {
    this.username = 'Guest' + Math.random().toString(36).substring(2, 8);
    this.updateUI();
  }

  async setUsername(username) {
    if (!username || username.trim() === '') {
      this.setGuestUsername();
      return;
    }

    // Sanitize username
    this.username = username.trim().substring(0, 24);

    // Save to localStorage
    this.storage.setUsername(this.username);

    // Identify with server
    this.socket.emit('identify', { username: this.username });

    // Get stats from server
    this.socket.emit('getUserStats', { username: this.username });

    this.updateUI();
  }

  updateStats(stats) {
    this.stats = {
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      gamesPlayed: stats.gamesPlayed || 0
    };
    this.updateUI();
  }

  updateUI() {
    // Update navbar
    const navUsername = document.getElementById('navbar-username');
    const navWins = document.getElementById('navbar-wins');

    if (navUsername) navUsername.textContent = this.username || 'Guest';
    if (navWins) navWins.textContent = this.stats.wins;

    // Update greeting
    const greeting = document.getElementById('player-name-preview');
    if (greeting) greeting.textContent = this.username || 'Guest';

    // Update stats overlay
    const statsUsername = document.getElementById('stats-username-display');
    const statsWins = document.getElementById('stats-wins');
    const statsLosses = document.getElementById('stats-losses');
    const statsGames = document.getElementById('stats-games');
    const statsWinrate = document.getElementById('stats-winrate');

    if (statsUsername) statsUsername.textContent = this.username || 'Guest';
    if (statsWins) statsWins.textContent = this.stats.wins;
    if (statsLosses) statsLosses.textContent = this.stats.losses;
    if (statsGames) statsGames.textContent = this.stats.gamesPlayed;

    if (statsWinrate) {
      const winrate = this.stats.gamesPlayed > 0
        ? Math.round((this.stats.wins / this.stats.gamesPlayed) * 100)
        : 0;
      statsWinrate.textContent = winrate + '%';
    }
  }
}

// ============================================================================
// Network Info
// ============================================================================

async function loadNetworkInfo() {
  const ipElement = document.getElementById('server-ip');
  const urlElement = document.getElementById('server-url');

  if (!ipElement || !urlElement) {
    return;
  }

  const setUnknown = () => {
    ipElement.textContent = 'Unknown';
    urlElement.textContent = 'Unknown';
  };

  try {
    const response = await fetch('/api/network-info', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const data = await response.json();
    const resolvedIp = typeof data.ip === 'string' && data.ip ? data.ip : '127.0.0.1';
    const parsedPort = Number.parseInt(data.port, 10);
    const resolvedPort = Number.isFinite(parsedPort) ? parsedPort : 8081;

    const remoteUrl = `http://${resolvedIp}:${resolvedPort}`;
    ipElement.textContent = resolvedIp;
    urlElement.textContent = `${remoteUrl} / http://localhost:${resolvedPort}`;
  } catch (error) {
    console.warn('[NetworkInfo] Unable to load network info:', error);
    setUnknown();
  }
}

// ============================================================================
// UI Event Handlers
// ============================================================================

function setupPauseMenuHandlers(uiManager, gameManager) {
  let isPaused = false;

  const pauseButton = uiManager.elements.game?.pauseButton;
  const resumeButton = uiManager.elements.game?.resumeButton;
  const pauseExitButton = uiManager.elements.game?.pauseExitButton;

  const togglePause = () => {
    isPaused = !isPaused;
    uiManager.gameUI.togglePauseMenu(isPaused);
  };

  const closePauseMenu = () => {
    isPaused = false;
    uiManager.gameUI.togglePauseMenu(false);
  };

  if (pauseButton) {
    pauseButton.addEventListener('click', togglePause);
  }

  if (resumeButton) {
    resumeButton.addEventListener('click', closePauseMenu);
  }

  if (pauseExitButton) {
    pauseExitButton.addEventListener('click', () => {
      closePauseMenu();
      gameManager.leaveGame();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && uiManager.currentView === 'gameUI') {
      const pauseMenu = uiManager.elements.modals?.pauseMenu;
      const gameOverModal = uiManager.elements.modals?.gameOver;

      if (gameOverModal && !gameOverModal.classList.contains('hidden')) {
        return;
      }

      if (pauseMenu && !pauseMenu.classList.contains('hidden')) {
        closePauseMenu();
      } else {
        togglePause();
      }
    }
  });
}

function setupStatsOverlay(userManager) {
  const statsButton = document.getElementById('stats-button');
  const statsOverlay = document.getElementById('stats-overlay');
  const closeStatsBtn = document.getElementById('close-stats-btn');
  const closeStatsModalBtn = document.getElementById('close-stats-modal-btn');

  const openStats = () => {
    if (statsOverlay) {
      userManager.updateUI(); // Refresh stats
      statsOverlay.classList.remove('hidden');
      statsOverlay.focus();
    }
  };

  const closeStats = () => {
    if (statsOverlay) {
      statsOverlay.classList.add('hidden');
    }
  };

  if (statsButton) {
    statsButton.addEventListener('click', openStats);
  }

  if (closeStatsBtn) {
    closeStatsBtn.addEventListener('click', closeStats);
  }

  if (closeStatsModalBtn) {
    closeStatsModalBtn.addEventListener('click', closeStats);
  }

  // Close on overlay click
  if (statsOverlay) {
    statsOverlay.addEventListener('click', (e) => {
      if (e.target === statsOverlay) {
        closeStats();
      }
    });
  }

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && statsOverlay && !statsOverlay.classList.contains('hidden')) {
      closeStats();
    }
  });
}

function setupNetworkToggle() {
  const networkToggle = document.getElementById('network-toggle');
  const networkFooter = document.getElementById('network-footer-body');
  const collapseBtn = document.getElementById('footer-collapse-btn');

  let isCollapsed = false;

  const toggleNetwork = () => {
    isCollapsed = !isCollapsed;

    if (networkFooter) {
      networkFooter.style.display = isCollapsed ? 'none' : 'block';
    }

    if (collapseBtn) {
      collapseBtn.textContent = isCollapsed ? '▲' : '▼';
    }
  };

  if (networkToggle) {
    networkToggle.addEventListener('click', toggleNetwork);
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', toggleNetwork);
  }
}

function setupUsernameInput(userManager) {
  const usernameInput = document.getElementById('username-input');
  const saveButton = document.getElementById('save-username-btn');

  if (!usernameInput || !saveButton) {
    return;
  }

  // Pre-fill with current username
  if (userManager.username) {
    usernameInput.value = userManager.username;
  }

  const saveUsername = async () => {
    const username = usernameInput.value.trim();

    if (!username) {
      alert('Please enter a username');
      return;
    }

    await userManager.setUsername(username);
    showToast('Username saved!', 'success');
  };

  saveButton.addEventListener('click', saveUsername);

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveUsername();
    }
  });
}

// ============================================================================
// Toast Notifications
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 3000);
}

// ============================================================================
// Application Initialization
// ============================================================================

async function initializeApp() {
  console.log('[App] Initializing HomeGameServer frontend...');

  // Initialize Socket.IO
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
    showToast('Connected to server', 'success');
  });

  socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err);
    showToast('Connection error', 'error');
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
    showToast('Disconnected from server', 'warning');
  });

  socket.on('reconnect', () => {
    console.log('[Socket] Reconnected');
    showToast('Reconnected to server', 'success');
  });

  // Initialize managers
  const storage = new LocalStorageManager();
  const userManager = new UserManager(socket, storage);
  const uiManager = new UIManager(socket);
  const gameManager = new GameManager(socket, uiManager);

  // Socket event handlers
  socket.on('identified', (data) => {
    console.log('[Socket] Identified as:', data.username);
    userManager.updateStats(data.stats);
  });

  socket.on('userStats', (data) => {
    console.log('[Socket] Received user stats:', data);
    userManager.updateStats(data);
  });

  socket.on('error', (error) => {
    console.error('[Socket] Server error:', error);
    showToast(error.message || 'An error occurred', 'error');
    ErrorHandler.handle(error, { source: 'server', action: error.action });
  });

  // Initialize user
  await userManager.initialize();

  // Setup UI
  setupPauseMenuHandlers(uiManager, gameManager);
  setupStatsOverlay(userManager);
  setupNetworkToggle();
  setupUsernameInput(userManager);

  // Load network info
  await loadNetworkInfo();

  // Setup error handler
  ErrorHandler.initialize();

  // Initialize tutorial system
  const tutorialManager = createTutorialManager();

  // Make toast manager globally accessible for tutorial
  window.toastManager = {
    show: showToast
  };

  console.log('[App] Initialization complete');

  // Make managers globally accessible for debugging
  window.debugInfo = {
    socket,
    userManager,
    uiManager,
    gameManager,
    storage,
    tutorialManager
  };
}

// ============================================================================
// Start Application
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('[Global] Uncaught error:', event.error);
  ErrorHandler.handle(event.error, { source: 'window', type: 'uncaught' });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled promise rejection:', event.reason);
  ErrorHandler.handle(event.reason, { source: 'window', type: 'promise' });
});
