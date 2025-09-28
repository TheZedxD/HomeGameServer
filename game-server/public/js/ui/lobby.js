import { validateRoomCode } from '../utils/validation.js';

export function createLobbyUI(elements, toast) {
  const { lobby, matchLobby, modals } = elements;
  let joinHandler = null;

  function setRoomJoinHandler(handler) {
    joinHandler = handler;
  }

  function renderRoomList(openRooms = []) {
    const target = lobby.roomList;
    if (!target) return;
    const rooms = Array.isArray(openRooms) ? openRooms : Object.values(openRooms);
    if (!rooms.length) {
      target.innerHTML = '<p style="color: var(--text-secondary);">No open games found. Create one!</p>';
      return;
    }

    target.innerHTML = '';
    rooms.forEach((room) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'room-item';

      const details = document.createElement('div');
      details.innerHTML = `
        <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.gameType}</p>
        <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">${room.roomId}</p>
      `;

      const actions = document.createElement('div');
      actions.style.textAlign = 'right';
      actions.innerHTML = `
        <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.playerCount}/${room.maxPlayers}</p>
      `;

      const joinButton = document.createElement('button');
      joinButton.className = 'btn btn-primary';
      joinButton.type = 'button';
      joinButton.textContent = 'Join';
      joinButton.addEventListener('click', () => joinHandler?.(room.roomId));
      actions.appendChild(joinButton);

      wrapper.appendChild(details);
      wrapper.appendChild(actions);
      target.appendChild(wrapper);
    });
  }

  function populateGameSelection(availableGames = [], onSelect) {
    const list = lobby.gameSelectionList;
    if (!list) return;
    list.innerHTML = '';
    availableGames.forEach((game) => {
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.type = 'button';
      button.textContent = game.name;
      button.addEventListener('click', () => {
        onSelect?.(game);
        modals.createGame?.classList.add('hidden');
      });
      list.appendChild(button);
    });
  }

  function initializeModalDismissal() {
    const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
    overlays.forEach((overlay) => {
      const modalContent = overlay.querySelector('.modal-content');
      modalContent?.addEventListener('click', (event) => event.stopPropagation());
      overlay.addEventListener('click', (event) => {
        if (event.target !== overlay) return;
        overlay.classList.add('hidden');
      });
    });
  }

  function bindLobbyControls({ availableGames = [], onReady, onStartGame, onCreateGame, onJoinGame }) {
    lobby.createGameButton?.addEventListener('click', () => {
      modals.createGame?.classList.remove('hidden');
    });

    lobby.closeModalButton?.addEventListener('click', () => {
      modals.createGame?.classList.add('hidden');
    });

    matchLobby.readyButton?.addEventListener('click', () => onReady?.());
    matchLobby.startGameButton?.addEventListener('click', () => onStartGame?.());

    lobby.joinOnlineButton?.addEventListener('click', () => {
      const rawCode = lobby.onlineRoomCodeInput?.value ?? '';
      const validation = validateRoomCode(rawCode);
      if (!validation.valid) {
        toast.showToast(validation.message, 'error');
        return;
      }
      onJoinGame?.(validation.value);
    });

    initializeModalDismissal();
    populateGameSelection(availableGames, onCreateGame);
  }

  function updateMatchLobby(room, myPlayerId, derivePlayerLabel) {
    matchLobby.title.textContent = `${room.gameType} Lobby`;
    const playerIds = Object.keys(room.players);

    const player1 = room.players[playerIds[0]];
    matchLobby.player1Card.classList.add('filled');
    const p1Name = derivePlayerLabel(player1, 'Player 1');
    const p1HostSuffix = playerIds[0] === room.hostId ? ' (Host)' : '';
    matchLobby.player1Card.querySelector('.player-name').textContent = `${p1Name}${p1HostSuffix}`;
    matchLobby.player1Status.textContent = player1.isReady ? 'Ready' : 'Not Ready';
    matchLobby.player1Status.className = `status ${player1.isReady ? 'ready' : 'not-ready'}`;

    if (playerIds.length > 1) {
      const player2 = room.players[playerIds[1]];
      matchLobby.player2Card.classList.add('filled');
      const p2Name = derivePlayerLabel(player2, 'Player 2');
      const p2HostSuffix = playerIds[1] === room.hostId ? ' (Host)' : '';
      matchLobby.player2Card.querySelector('.player-name').textContent = `${p2Name}${p2HostSuffix}`;
      matchLobby.player2Status.textContent = player2.isReady ? 'Ready' : 'Not Ready';
      matchLobby.player2Status.className = `status ${player2.isReady ? 'ready' : 'not-ready'}`;
    } else {
      matchLobby.player2Card.classList.remove('filled');
      matchLobby.player2Card.querySelector('.player-name').textContent = 'Waiting for Player...';
      matchLobby.player2Status.textContent = 'Not Ready';
      matchLobby.player2Status.className = 'status not-ready';
    }

    const myPlayer = room.players[myPlayerId];
    if (!myPlayer) {
      console.warn('Unable to locate current player in room state update.');
      return;
    }

    if (myPlayer.isReady) {
      matchLobby.readyButton.textContent = 'Unready';
      matchLobby.readyButton.classList.remove('btn-warning');
      matchLobby.readyButton.classList.add('btn-secondary');
    } else {
      matchLobby.readyButton.textContent = 'Ready Up';
      matchLobby.readyButton.classList.add('btn-warning');
      matchLobby.readyButton.classList.remove('btn-secondary');
    }

    if (myPlayerId === room.hostId) {
      matchLobby.startGameButton.classList.remove('hidden');
      const allReady = Object.values(room.players).every((player) => player.isReady);
      const roomFull = Object.keys(room.players).length === room.maxPlayers;
      matchLobby.startGameButton.disabled = !(allReady && roomFull);
    } else {
      matchLobby.startGameButton.classList.add('hidden');
    }
  }

  return {
    setRoomJoinHandler,
    renderRoomList,
    bindLobbyControls,
    updateMatchLobby
  };
}
