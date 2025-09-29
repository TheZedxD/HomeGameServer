import { ProfileManager } from './managers/ProfileManager.js';
import { UIManager } from './managers/UIManager.js';
import { GameManager } from './managers/GameManager.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { initializeWindowControls } from './ui/windowControls.js';

async function loadNetworkInfo() {
  const ipElement = document.getElementById('server-ip');
  const urlElement = document.getElementById('server-url');
  const localUrlElement = document.getElementById('server-local-url');

  if (!ipElement || !urlElement) {
    return;
  }

  const setUnknown = () => {
    ipElement.textContent = 'Unknown';
    urlElement.textContent = 'Unknown';
    if (localUrlElement) {
      localUrlElement.textContent = 'Unknown';
    }
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
    const localUrl = `http://localhost:${resolvedPort}`;

    ipElement.textContent = resolvedIp;
    urlElement.textContent = remoteUrl;
    if (localUrlElement) {
      localUrlElement.textContent = localUrl;
    }
  } catch (error) {
    console.warn('Unable to load network info.', error);
    setUnknown();
  }
}

async function initializeApp() {
  const socket = io();
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
