import { ProfileManager } from './managers/ProfileManager.js';
import { UIManager } from './managers/UIManager.js';
import { GameManager } from './managers/GameManager.js';
import { ErrorHandler } from './utils/ErrorHandler.js';

async function initializeApp() {
  const socket = io();
  const profileManager = new ProfileManager();
  const uiManager = new UIManager();
  const gameManager = new GameManager(socket, uiManager, profileManager);

  window.uiManager = uiManager;

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
