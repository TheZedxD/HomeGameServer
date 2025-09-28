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
      profilePrompt: document.getElementById('profile-prompt-modal')
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
      startGameButton: document.getElementById('start-game-btn')
    },
    identity: {
      quickInput: document.getElementById('displayNameInput'),
      quickSaveButton: document.getElementById('saveDisplayNameBtn'),
      input: document.getElementById('player-name-input'),
      saveButton: document.getElementById('save-name-btn'),
      preview: document.getElementById('player-name-preview'),
      status: document.getElementById('name-status')
    },
    profile: {
      corner: document.getElementById('profile-corner'),
      avatar: document.getElementById('profile-avatar'),
      displayName: document.getElementById('profile-display-name'),
      wins: document.getElementById('profile-wins'),
      signInButton: document.getElementById('sign-in-btn'),
      signOutButton: document.getElementById('sign-out-btn'),
      changeAvatarButton: document.getElementById('change-avatar-btn'),
      viewProfileButton: document.getElementById('view-profile-btn'),
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
