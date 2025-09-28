import { ProfileManager } from './managers/ProfileManager.js';
import { UIManager } from './managers/UIManager.js';
import { GameManager } from './managers/GameManager.js';

async function initializeApp() {
  const socket = io();
  const profileManager = new ProfileManager();
  const uiManager = new UIManager();
  const gameManager = new GameManager(socket, uiManager, profileManager);

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
    await profileManager.loadProfile();
  } catch (error) {
    console.warn('Unable to load profile during initialization.', error);
  }

  profileManager.ensureCsrfToken().catch((error) => {
    console.warn('Unable to prefetch CSRF token.', error);
  });
}

document.addEventListener('DOMContentLoaded', initializeApp);
