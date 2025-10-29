export function cacheElements() {
  return {
    views: {
      mainLobby: document.getElementById('main-lobby'),
      matchLobby: document.getElementById('match-lobby'),
      gameUI: document.getElementById('game-ui')
    },
    modals: {
      createGame: document.getElementById('create-game-modal'),
      gameOver: document.getElementById('game-over-message'),
      pauseMenu: document.getElementById('pause-menu'),
      profilePrompt: document.getElementById('profile-prompt-modal'),
      identityEditor: document.getElementById('identity-overlay')
    },
    lobby: {
      roomList: document.getElementById('room-list'),
      lobbyListContainer: document.querySelector('aside.lobby-list'),
      createGameButton: document.getElementById('show-create-game-modal-btn'),
      joinOnlineButton: document.getElementById('join-online-btn'),
      onlineRoomCodeInput: document.getElementById('online-room-code'),
      gameSelectionList: document.getElementById('game-selection-list'),
      closeModalButton: document.getElementById('close-modal-btn')
    },
    matchLobby: {
      title: document.getElementById('match-lobby-gametype'),
      player1Card: document.getElementById('player1-card'),
      player1Status: document.getElementById('player1-status'),
      player2Card: document.getElementById('player2-card'),
      player2Status: document.getElementById('player2-status'),
      readyButton: document.getElementById('ready-btn'),
      startGameButton: document.getElementById('start-game-btn'),
      leaveRoomButton: document.getElementById('leave-room-btn')
    },
    identity: {
      overlay: document.getElementById('identity-overlay'),
      openButton: document.getElementById('open-identity-overlay-btn'),
      closeButton: document.getElementById('close-identity-overlay-btn'),
      cancelButton: document.getElementById('identity-cancel-btn'),
      input: document.getElementById('identity-display-name'),
      saveButton: document.getElementById('identity-save-btn'),
      preview: document.getElementById('player-name-preview'),
      status: document.getElementById('identity-status')
    },
    profile: {
      corner: document.getElementById('profile-corner'),
      avatar: document.getElementById('profile-avatar'),
      avatarPreview: document.getElementById('profile-avatar-preview'),
      displayName: document.getElementById('profile-display-name'),
      overlayDisplayName: document.getElementById('profile-overlay-display-name'),
      wins: document.getElementById('profile-wins'),
      overlayWins: document.getElementById('profile-overlay-wins'),
      signInButton: document.getElementById('sign-in-btn'),
      signOutButton: document.getElementById('sign-out-btn'),
      changeAvatarButton: document.getElementById('change-avatar-btn'),
      avatarInput: document.getElementById('avatar-upload-input'),
      avatarForm: document.getElementById('avatar-upload-form')
    },
    prompt: {
      editButton: document.getElementById('prompt-edit-profile-btn'),
      dismissButton: document.getElementById('prompt-dismiss-btn')
    },
    game: {
      mode: document.getElementById('game-mode'),
      color: document.getElementById('player-color'),
      turn: document.getElementById('turn-indicator'),
      container: document.getElementById('game-container'),
      pauseButton: document.getElementById('pause-game-btn'),
      resumeButton: document.getElementById('resume-game-btn'),
      pauseExitButton: document.getElementById('pause-exit-to-menu-btn'),
      exitButton: document.getElementById('exit-to-menu-btn'),
      gameOverExitButton: document.getElementById('game-over-exit-btn'),
      winnerText: document.getElementById('winner-text')
    },
    scoreboard: {
      container: document.getElementById('scoreboard'),
      text: document.getElementById('score-text')
    },
    general: {
      toastContainer: document.getElementById('toast-container')
    }
  };
}
