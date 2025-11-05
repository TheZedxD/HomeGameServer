import { ProfileManager } from './managers/ProfileManager.js';
import { UIManager } from './managers/UIManager.js';
import { GameManager } from './managers/GameManager.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { initializeWindowControls } from './ui/windowControls.js';

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
    console.warn('Unable to load network info.', error);
    setUnknown();
  }
}

function setupPauseMenuHandlers(uiManager, gameManager) {
  let isPaused = false;

  const pauseButton = uiManager.elements.game.pauseButton;
  const resumeButton = uiManager.elements.game.resumeButton;
  const pauseExitButton = uiManager.elements.game.pauseExitButton;

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
      const pauseMenu = uiManager.elements.modals.pauseMenu;
      const gameOverModal = uiManager.elements.modals.gameOver;

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

async function initializeApp() {
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    timeout: 10000
  });
  socket.on('connect', () => console.log('Socket connected:', socket.id));
  socket.on('connect_error', (err) => console.error('Connection error:', err));
  socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
  const profileManager = new ProfileManager();
  const uiManager = new UIManager();
  const gameManager = new GameManager(socket, uiManager, profileManager);

  window.uiManager = uiManager;

  initializeWindowControls(uiManager);

  uiManager.bindIdentityControls(profileManager);
  uiManager.bindProfileEvents(profileManager, {
    onLeaveGame: () => gameManager.leaveGame()
  });
  uiManager.initializeServiceWorker();
  uiManager.showView('mainLobby');
  uiManager.renderRoomList([]);
  uiManager.setScoreboardVisibility(false);

  setupPauseMenuHandlers(uiManager, gameManager);

  profileManager.subscribe((profile) => {
    uiManager.updateProfileUI(profile);
    gameManager.syncProfileWithSocket(profile);
  });

  uiManager.updateProfileUI(profileManager.profile);

  try {
    await ErrorHandler.handleAsyncOperation(() => profileManager.loadProfile(), 'profile load');
  } catch (error) {
    console.warn('Unable to load profile during initialization.', error);
  }

  ErrorHandler.handleAsyncOperation(() => profileManager.ensureCsrfToken(), 'CSRF token prefetch').catch((error) => {
    console.warn('Unable to prefetch CSRF token.', error);
  });

  loadNetworkInfo();
}

document.addEventListener('DOMContentLoaded', initializeApp);

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  ErrorHandler.showUserError('An unexpected error occurred. Please refresh the page.');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  ErrorHandler.showUserError('A network error occurred. Please check your connection.');
  event.preventDefault();
});
