// GAME.JS
// This file manages the entire front-end user experience, from UI interactions
// in the lobby to rendering the Phaser game and communicating with the server.

const socket = io();
let game; // This will hold the Phaser game instance
let myPlayerId;

// --- DOM Element References ---
// Central object to hold references to all key UI containers.
const ui = {
    mainLobby: document.getElementById('main-lobby'),
    matchLobby: document.getElementById('match-lobby'),
    gameUI: document.getElementById('game-ui'),
    createGameModal: document.getElementById('create-game-modal'),
};

const displayNameInput = document.getElementById('displayNameInput');
const saveDisplayNameBtn = document.getElementById('saveDisplayNameBtn');

const identityEls = {
    input: document.getElementById('player-name-input'),
    saveBtn: document.getElementById('save-name-btn'),
    preview: document.getElementById('player-name-preview'),
    status: document.getElementById('name-status'),
};

const mainLobbyEls = {
    joinOnlineBtn: document.getElementById('join-online-btn'),
    onlineRoomCodeInput: document.getElementById('online-room-code'),
    showCreateGameModalBtn: document.getElementById('show-create-game-modal-btn'),
    roomList: document.getElementById('room-list'),
};

const modalEls = {
    gameSelectionList: document.getElementById('game-selection-list'),
    closeModalBtn: document.getElementById('close-modal-btn'),
};

const matchLobbyEls = {
    gameTypeTitle: document.getElementById('match-lobby-gametype'),
    player1Card: document.getElementById('player1-card'),
    player1Status: document.getElementById('player1-status'),
    player2Card: document.getElementById('player2-card'),
    player2Status: document.getElementById('player2-status'),
    readyBtn: document.getElementById('ready-btn'),
    startGameBtn: document.getElementById('start-game-btn'),
};

const gameEls = {
    mode: document.getElementById('game-mode'),
    color: document.getElementById('player-color'),
    turn: document.getElementById('turn-indicator'),
    gameOverMessage: document.getElementById('game-over-message'),
    winnerText: document.getElementById('winner-text'),
};

const scoreboardEls = {
    container: document.getElementById('scoreboard'),
    text: document.getElementById('score-text'),
};

const profileEls = {
    corner: document.getElementById('profile-corner'),
    avatar: document.getElementById('profile-avatar'),
    displayName: document.getElementById('profile-display-name'),
    wins: document.getElementById('profile-wins'),
    signInBtn: document.getElementById('sign-in-btn'),
    signOutBtn: document.getElementById('sign-out-btn'),
    changeAvatarBtn: document.getElementById('change-avatar-btn'),
    viewProfileBtn: document.getElementById('view-profile-btn'),
    avatarInput: document.getElementById('avatar-upload-input'),
    avatarForm: document.getElementById('avatar-upload-form'),
};

const promptEls = {
    modal: document.getElementById('profile-prompt-modal'),
    editBtn: document.getElementById('prompt-edit-profile-btn'),
    dismissBtn: document.getElementById('prompt-dismiss-btn'),
};

const toastContainer = document.getElementById('toast-container');
const lobbyListEl = document.querySelector('aside.right-panels');
const exitToMenuBtn = document.getElementById('exit-to-menu-btn');
const gameOverExitBtn = document.getElementById('game-over-exit-btn');

const NAME_STORAGE_KEY = 'homegame.displayName';
const AVATAR_STORAGE_KEY = 'homegame.avatarPath';
const INSTALL_FLAG_KEY = 'homegame.installFlag';
const PROFILE_PROMPT_DISMISSED_KEY = 'homegame.profilePromptDismissed';
const DEFAULT_AVATAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" fill="#1c4a8c" />
  <circle cx="48" cy="34" r="20" fill="#ffffff" />
  <path d="M16 84c0-17.673 14.327-32 32-32s32 14.327 32 32" fill="#ffffff" opacity="0.85" />
</svg>
`.trim();
const DEFAULT_AVATAR_PATH = `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_AVATAR_SVG)}`;
const DEFAULT_GUEST_NAME = 'Guest';

let myDisplayName = '';
let currentPlayers = null;
let playerLabels = { red: 'Red', black: 'Black' };
let latestScore = { red: 0, black: 0 };
let sessionProfile = null;

// --- Available Games Data ---
// This array makes it easy to add more games in the future.
const availableGames = [
    { id: 'checkers', name: 'Checkers', description: 'Classic 2-player strategy game.' },
    // { id: 'chess', name: 'Chess', description: 'The ultimate game of kings.' }, // Example of a future game
];

const playerColorSwatches = {
    red: '#ff6b6b',
    black: '#f5f5dc'
};

initializeIdentity();
setupProfileEvents();
const storedAvatarPath = readLocalAvatarPath();
if (storedAvatarPath) {
    setAvatar(storedAvatarPath);
}
initializeServiceWorker();
bootstrapProfile();

// --- UI State Management ---
// A simple function to switch between the main UI views.
function showUI(activeUI) {
    Object.values(ui).forEach(el => el?.classList.add('hidden'));
    if (activeUI) activeUI.classList.remove('hidden');
    if (lobbyListEl) {
        const shouldShowLobby = activeUI === ui.mainLobby;
        lobbyListEl.classList.toggle('hidden', !shouldShowLobby);
    }
    if (activeUI !== ui.gameUI && gameEls.gameOverMessage) {
        gameEls.gameOverMessage.classList.add('hidden');
    }
}

function initializeIdentity() {
    const storedName = sanitizeName(readStoredName()).slice(0, 24);
    if (storedName) {
        myDisplayName = storedName;
        updateNamePreview(myDisplayName);
    } else {
        updateNamePreview(DEFAULT_GUEST_NAME);
    }

    if (identityEls.input) {
        identityEls.input.value = myDisplayName || '';
    }
    if (displayNameInput) {
        displayNameInput.value = myDisplayName || '';
    }

    identityEls.saveBtn?.addEventListener('click', submitDisplayName);
    identityEls.input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submitDisplayName();
        }
    });
    identityEls.input?.addEventListener('input', clearNameStatus);

    if (saveDisplayNameBtn) {
        saveDisplayNameBtn.addEventListener('click', saveAndEmitDisplayName);
    }
    if (displayNameInput) {
        displayNameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveAndEmitDisplayName();
            }
        });
    }
}

function sanitizeName(rawName) {
    if (rawName === null || rawName === undefined) return '';
    return String(rawName).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function submitDisplayName() {
    if (!identityEls.input) return;
    const result = applyDisplayName(identityEls.input.value, { showStatus: true });
    if (result) {
        showNameStatus('Name saved!', 'success');
    }
}

function saveAndEmitDisplayName() {
    const raw = displayNameInput?.value ?? '';
    applyDisplayName(raw, { showStatus: false });
}

function applyDisplayName(rawValue, { showStatus = true, persist = true } = {}) {
    const sanitized = sanitizeName(rawValue).slice(0, 24);
    if (!sanitized) {
        if (showStatus) {
            showNameStatus('Please enter a name with at least one character.', 'error');
        }
        return null;
    }

    myDisplayName = sanitized;
    if (identityEls.input) {
        identityEls.input.value = sanitized;
    }
    if (displayNameInput) {
        displayNameInput.value = sanitized;
    }
    updateNamePreview(sanitized);
    storeDisplayName(sanitized);
    if (persist) {
        persistDisplayNameToServer(sanitized);
    }
    if (sessionProfile) {
        sessionProfile.displayName = sanitized;
    }

    if (socket.connected) {
        socket.emit('setUsername', sanitized);
        if (sessionProfile) {
            socket.emit('linkAccount', {
                accountName: sessionProfile.username,
                displayName: sanitized
            });
        }
    }

    if (currentPlayers && myPlayerId && currentPlayers[myPlayerId]) {
        currentPlayers[myPlayerId].username = sanitized;
        refreshPlayerLabels();
        updateScoreboardDisplay(latestScore);
    }

    return sanitized;
}

function updateNamePreview(name) {
    if (identityEls.preview) {
        identityEls.preview.textContent = name || DEFAULT_GUEST_NAME;
    }
}

function showNameStatus(message, variant = 'success') {
    if (!identityEls.status) return;
    identityEls.status.textContent = message;
    identityEls.status.classList.remove('hidden', 'success', 'error');
    identityEls.status.classList.add(variant);
}

function clearNameStatus() {
    if (!identityEls.status) return;
    identityEls.status.classList.add('hidden');
    identityEls.status.textContent = '';
    identityEls.status.classList.remove('success', 'error');
}

function storeDisplayName(name) {
    try {
        localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch (error) {
        console.warn('Unable to persist display name to storage.', error);
    }
    try {
        localStorage.setItem('displayName', name);
    } catch (error) {
        console.warn('Unable to persist display name to storage (displayName key).', error);
    }
}

function persistDisplayNameToServer(name) {
    if (!name) return;
    fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name })
    }).catch((error) => {
        console.warn('Unable to persist display name to profile.', error);
    });
}

function readStoredName() {
    try {
        const preferred = localStorage.getItem('displayName');
        if (preferred) return preferred;
        return localStorage.getItem(NAME_STORAGE_KEY) || '';
    } catch (error) {
        return '';
    }
}

function setupProfileEvents() {
    profileEls.avatar?.addEventListener('error', () => {
        profileEls.avatar.src = DEFAULT_AVATAR_PATH;
    });
    profileEls.signInBtn?.addEventListener('click', () => {
        window.location.href = '/login';
    });
    profileEls.signOutBtn?.addEventListener('click', async () => {
        try {
            await fetch('/logout', { method: 'POST' });
        } catch (error) {
            console.warn('Failed to log out gracefully.', error);
        }
        window.location.href = '/login';
    });
    profileEls.changeAvatarBtn?.addEventListener('click', () => {
        profileEls.avatarInput?.click();
    });
    profileEls.avatarInput?.addEventListener('change', handleAvatarSelection);
    profileEls.viewProfileBtn?.addEventListener('click', () => {
        hideProfilePrompt(false);
        showUI(ui.mainLobby);
        identityEls.input?.focus();
    });
    promptEls.editBtn?.addEventListener('click', () => {
        hideProfilePrompt(false);
        showUI(ui.mainLobby);
        identityEls.input?.focus();
    });
    promptEls.dismissBtn?.addEventListener('click', () => hideProfilePrompt(true));
    exitToMenuBtn?.addEventListener('click', leaveGame);
    gameOverExitBtn?.addEventListener('click', () => {
        leaveGame();
        gameEls.gameOverMessage?.classList.add('hidden');
    });
}

function initializeServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SERVICE_WORKER_READY') {
            handleServiceWorkerReady();
        }
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/service-worker.js')
            .catch((error) => console.warn('Service worker registration failed.', error));
    });
}

async function handleServiceWorkerReady() {
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

function bootstrapProfile() {
    loadSessionProfile();
}

async function loadSessionProfile() {
    try {
        const response = await fetch('/api/session', { headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            throw new Error('Unable to load profile.');
        }
        const data = await response.json();
        if (!data.authenticated) {
            handleUnauthenticated();
            return;
        }

        sessionProfile = data.user;
        updateProfileUI(sessionProfile);
        toggleProfileActions({ authenticated: true });
        socket.emit('linkAccount', {
            accountName: sessionProfile.username,
            displayName: sessionProfile.displayName
        });
        applyDisplayName(sessionProfile.displayName, { showStatus: false, persist: false });
        maybeShowProfilePrompt(sessionProfile);
    } catch (error) {
        console.warn('Failed to load session profile.', error);
        handleUnauthenticated();
    }
}

function handleUnauthenticated() {
    toggleProfileActions({ authenticated: false });
    updateProfileUI({ username: DEFAULT_GUEST_NAME, displayName: DEFAULT_GUEST_NAME, wins: 0, avatarPath: null });
}

function toggleProfileActions({ authenticated }) {
    if (!profileEls.signInBtn || !profileEls.signOutBtn) return;
    if (authenticated) {
        profileEls.signInBtn.classList.add('hidden');
        profileEls.signOutBtn.classList.remove('hidden');
    } else {
        profileEls.signInBtn.classList.remove('hidden');
        profileEls.signOutBtn.classList.add('hidden');
    }
}

function updateProfileUI(profile) {
    if (!profile) return;
    const resolvedName = sanitizeName(profile.displayName || profile.username || DEFAULT_GUEST_NAME) || DEFAULT_GUEST_NAME;
    myDisplayName = resolvedName;
    if (profileEls.displayName) {
        profileEls.displayName.textContent = resolvedName;
    }
    if (identityEls.input) {
        identityEls.input.value = resolvedName;
    }
    if (displayNameInput) {
        displayNameInput.value = resolvedName;
    }
    updateNamePreview(resolvedName);
    storeDisplayName(resolvedName);

    const winsValue = Number(profile.wins) || 0;
    if (profileEls.wins) {
        profileEls.wins.textContent = winsValue;
    }

    const storedAvatar = readLocalAvatarPath();
    const avatarPath = storedAvatar || profile.avatarPath || DEFAULT_AVATAR_PATH;
    setAvatar(avatarPath);
    if (profile.avatarPath) {
        persistLocalAvatarPath(profile.avatarPath);
    }
}

function setAvatar(path, { bustCache = false } = {}) {
    if (!profileEls.avatar) return;
    const finalPath = path || DEFAULT_AVATAR_PATH;
    if (bustCache && typeof finalPath === 'string' && !finalPath.startsWith('data:')) {
        const url = new URL(finalPath, window.location.origin);
        url.searchParams.set('v', Date.now().toString());
        profileEls.avatar.src = url.pathname + url.search;
        return;
    }
    profileEls.avatar.src = finalPath;
}

function persistLocalAvatarPath(path) {
    if (!path) return;
    setLocalStorageItem(AVATAR_STORAGE_KEY, path);
}

function readLocalAvatarPath() {
    return getLocalStorageItem(AVATAR_STORAGE_KEY);
}

function hideProfilePrompt(remember = false) {
    if (!promptEls.modal) return;
    promptEls.modal.classList.add('hidden');
    if (remember) {
        setLocalStorageItem(PROFILE_PROMPT_DISMISSED_KEY, 'true');
    }
}

function maybeShowProfilePrompt(profile) {
    if (!promptEls.modal) return;
    const dismissed = getLocalStorageItem(PROFILE_PROMPT_DISMISSED_KEY) === 'true';
    if (dismissed) return;
    const cleanedName = sanitizeName(profile?.displayName || '');
    const missingName = !cleanedName || cleanedName.toLowerCase() === DEFAULT_GUEST_NAME.toLowerCase();
    const missingAvatar = !profile?.avatarPath && !readLocalAvatarPath();
    if (missingName || missingAvatar) {
        promptEls.modal.classList.remove('hidden');
    }
}

function handleAvatarSelection(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        showToast('Avatar must be smaller than 2MB.', 'error');
        profileEls.avatarForm?.reset();
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData
    })
        .then(async (response) => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Upload failed');
            }
            return response.json();
        })
        .then((data) => {
            if (!data?.avatarPath) {
                throw new Error('Upload did not return an avatar path.');
            }
            setAvatar(data.avatarPath, { bustCache: true });
            persistLocalAvatarPath(data.avatarPath);
            showToast('Avatar updated successfully.', 'success');
            hideProfilePrompt(true);
            if (sessionProfile) {
                sessionProfile.avatarPath = data.avatarPath;
            }
        })
        .catch((error) => {
            console.error('Avatar upload failed.', error);
            showToast('Unable to upload avatar. Please try another image.', 'error');
        })
        .finally(() => {
            profileEls.avatarForm?.reset();
        });
}

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

function showToast(message, variant = 'info', options = {}) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;
    toastContainer.appendChild(toast);

    const duration = typeof options.duration === 'number' ? options.duration : 4000;
    if (duration !== Infinity) {
        const timeout = setTimeout(() => {
            toast.remove();
        }, Math.max(1000, duration));
        toast.addEventListener('click', () => {
            clearTimeout(timeout);
            toast.remove();
        });
    } else {
        toast.addEventListener('click', () => toast.remove());
    }
}

// --- UI Event Listeners ---
// Connects the buttons and inputs to their respective functions.
mainLobbyEls.showCreateGameModalBtn.addEventListener('click', () => ui.createGameModal.classList.remove('hidden'));
modalEls.closeModalBtn.addEventListener('click', () => ui.createGameModal.classList.add('hidden'));
matchLobbyEls.readyBtn.addEventListener('click', () => socket.emit('playerReady'));
matchLobbyEls.startGameBtn.addEventListener('click', () => socket.emit('startGame'));
mainLobbyEls.joinOnlineBtn.addEventListener('click', () => {
    const roomCode = mainLobbyEls.onlineRoomCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
        showToast('Enter a room code before joining.', 'error');
        return;
    }

    socket.emit('joinGame', roomCode);
});


// --- Socket.IO Event Handlers ---
// This section defines how the client reacts to messages from the server.

socket.on('connect', () => {
    console.log('Successfully connected to the game server with ID:', socket.id);
    const stored = sanitizeName(readStoredName()).slice(0, 24);
    if (stored) {
        myDisplayName = stored;
        if (identityEls.input) {
            identityEls.input.value = stored;
        }
        if (displayNameInput) {
            displayNameInput.value = stored;
        }
        updateNamePreview(stored);
        socket.emit('setUsername', stored);
    }
    if (sessionProfile) {
        socket.emit('linkAccount', {
            accountName: sessionProfile.username,
            displayName: sessionProfile.displayName || stored
        });
    }
});

// Updates the list of available LAN games in the main lobby.
socket.on('updateRoomList', (openRooms) => {
    const rooms = Object.values(openRooms);
    if (rooms.length === 0) {
        mainLobbyEls.roomList.innerHTML = `<p style="color: var(--text-secondary);">No open games found. Create one!</p>`;
        return;
    }
    mainLobbyEls.roomList.innerHTML = rooms.map(room => `
        <div class="room-item">
            <div>
                <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.gameType}</p>
                <p style="color: var(--text-secondary); margin: 0; font-size: 0.9rem;">${room.roomId}</p>
            </div>
            <div style="text-align: right;">
                <p style="color: var(--text-primary); margin: 0; font-weight: 600;">${room.playerCount}/${room.maxPlayers}</p>
                <button class="btn btn-primary" onclick="joinGame('${room.roomId}')">Join</button>
            </div>
        </div>
    `).join('');
});

// Called when a player successfully enters a match lobby.
socket.on('joinedMatchLobby', ({ room, yourId }) => {
    myPlayerId = yourId;
    updateMatchLobby(room);
    if (scoreboardEls.container) {
        scoreboardEls.container.classList.add('hidden');
    }
    showUI(ui.matchLobby);
});

// Called whenever the state of the match lobby changes (e.g., a player joins, readies up).
socket.on('roomStateUpdate', (room) => {
    updateMatchLobby(room);
    syncCurrentPlayersWithRoom(room);
});

// Triggered by the server when the host starts the game.
socket.on('gameStart', ({ gameState, players, mode }) => {
    showUI(ui.gameUI);
    const myPlayer = players[myPlayerId];
    gameEls.mode.textContent = (mode === 'p2p') ? 'Online (P2P)' : 'LAN';
    gameEls.color.textContent = myPlayer.color.toUpperCase();
    const colorAccent = playerColorSwatches[myPlayer.color] || '#f5f5dc';
    gameEls.color.style.color = colorAccent;
    gameEls.color.style.textShadow = myPlayer.color === 'red'
        ? '0 0 12px rgba(255, 99, 99, 0.85)'
        : '0 0 12px rgba(255, 235, 180, 0.7)';
    updateTurnIndicator(gameState);

    currentPlayers = players;
    refreshPlayerLabels();
    if (scoreboardEls.container) {
        scoreboardEls.container.classList.remove('hidden');
    }
    updateScoreboardDisplay(gameState.score || { red: 0, black: 0 });

    // Initialize the Phaser game scene with all necessary data.
    startGameScene({
        socket: socket,
        myColor: myPlayer.color,
        gameState: gameState,
        roundMessage: `Round ${gameState.round || 1}`
    });
});

// Updates the game board when a move is made.
socket.on('gameStateUpdate', (gameState) => {
    if (game && game.scene.isActive('CheckersScene')) {
        game.scene.getScene('CheckersScene').updateGameState(gameState);
    }
    if (gameState.score) {
        updateScoreboardDisplay(gameState.score);
    }
    updateTurnIndicator(gameState);
    if (gameState.gameOver) {
        const winnerLabel = gameState.winnerName || formatColorLabel(gameState.winner);
        gameEls.winnerText.textContent = `${winnerLabel} Wins!`;
        gameEls.gameOverMessage.classList.remove('hidden');
        loadSessionProfile();
    }
});

socket.on('roundEnd', ({ winnerColor, winnerName, redScore, blackScore }) => {
    const announcement = `${winnerName || formatColorLabel(winnerColor)} wins the round!`;
    if (game && game.scene.isActive('CheckersScene')) {
        const scene = game.scene.getScene('CheckersScene');
        if (scene && typeof scene.showAnnouncement === 'function') {
            scene.showAnnouncement(announcement);
        }
    } else {
        showToast(announcement, 'info');
    }
    updateScoreboardDisplay({ red: redScore, black: blackScore });
});

// Handles generic errors sent from the server.
socket.on('error', (message) => {
    if (typeof message === 'string' && message.includes('does not exist')) {
        const roomCode = (mainLobbyEls.onlineRoomCodeInput.value || '').trim().toUpperCase();
        if (roomCode) {
            socket.emit('createGame', { gameType: 'Checkers', mode: 'p2p', roomCode });
            return;
        }
    }

    showToast(message, 'error');
});
socket.on('playerLeft', (message) => showToast(message, 'info'));
socket.on('illegalMove', (message) => showToast(message, 'error'));


// --- Helper Functions ---

// Called from an onclick attribute in the dynamically generated room list.
function joinGame(roomId) {
    socket.emit('joinGame', roomId);
}

// Dynamically creates the game selection buttons in the modal.
function populateGameSelection() {
    modalEls.gameSelectionList.innerHTML = availableGames.map(game => `
        <button class="btn btn-primary" data-game-id="${game.id}">${game.name}</button>
    `).join('');

    // Add event listeners to the new buttons after they are created.
    modalEls.gameSelectionList.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', (e) => {
            const gameId = e.target.getAttribute('data-game-id');
            const selectedGame = availableGames.find(g => g.id === gameId);
            socket.emit('createGame', { gameType: selectedGame.name, mode: 'lan' });
            ui.createGameModal.classList.add('hidden');
        });
    });
}

// Updates the match lobby UI based on the latest room state from the server.
function updateMatchLobby(room) {
    matchLobbyEls.gameTypeTitle.textContent = `${room.gameType} Lobby`;
    const playerIds = Object.keys(room.players);

    // Update Player 1 Card (always the first player who joined)
    const p1 = room.players[playerIds[0]];
    matchLobbyEls.player1Card.classList.add('filled');
    const p1Name = derivePlayerLabel(p1, 'Player 1');
    const p1HostSuffix = playerIds[0] === room.hostId ? ' (Host)' : '';
    matchLobbyEls.player1Card.querySelector('.player-name').textContent = `${p1Name}${p1HostSuffix}`;
    matchLobbyEls.player1Status.textContent = p1.isReady ? 'Ready' : 'Not Ready';
    matchLobbyEls.player1Status.className = `status ${p1.isReady ? 'ready' : 'not-ready'}`;

    // Update Player 2 Card
    if (playerIds.length > 1) {
        const p2 = room.players[playerIds[1]];
        matchLobbyEls.player2Card.classList.add('filled');
        const p2Name = derivePlayerLabel(p2, 'Player 2');
        const p2HostSuffix = playerIds[1] === room.hostId ? ' (Host)' : '';
        matchLobbyEls.player2Card.querySelector('.player-name').textContent = `${p2Name}${p2HostSuffix}`;
        matchLobbyEls.player2Status.textContent = p2.isReady ? 'Ready' : 'Not Ready';
        matchLobbyEls.player2Status.className = `status ${p2.isReady ? 'ready' : 'not-ready'}`;
    } else {
        matchLobbyEls.player2Card.classList.remove('filled');
        matchLobbyEls.player2Card.querySelector('.player-name').textContent = 'Waiting for Player...';
        matchLobbyEls.player2Status.textContent = 'Not Ready';
        matchLobbyEls.player2Status.className = 'status not-ready';
    }

    // Update the text and color of this client's "Ready" button.
    const myPlayer = room.players[myPlayerId];
    if (!myPlayer) {
        console.warn('Unable to locate current player in room state update.');
        return;
    }
    if (myPlayer.isReady) {
        matchLobbyEls.readyBtn.textContent = 'Unready';
        matchLobbyEls.readyBtn.classList.remove('btn-warning');
        matchLobbyEls.readyBtn.classList.add('btn-secondary');
    } else {
        matchLobbyEls.readyBtn.textContent = 'Ready Up';
        matchLobbyEls.readyBtn.classList.add('btn-warning');
        matchLobbyEls.readyBtn.classList.remove('btn-secondary');
    }
    
    // Show and enable/disable the host's "Start Game" button.
    if (myPlayerId === room.hostId) {
        matchLobbyEls.startGameBtn.classList.remove('hidden');
        const allReady = Object.values(room.players).every(p => p.isReady);
        const roomFull = Object.keys(room.players).length === room.maxPlayers;
        matchLobbyEls.startGameBtn.disabled = !(allReady && roomFull);
    } else {
        matchLobbyEls.startGameBtn.classList.add('hidden');
    }
}

function syncCurrentPlayersWithRoom(room) {
    if (!room || !currentPlayers) return;
    Object.entries(room.players).forEach(([id, player]) => {
        if (currentPlayers[id]) {
            currentPlayers[id].username = player.username;
        }
    });
    refreshPlayerLabels();
    updateScoreboardDisplay(latestScore);
}

function updateTurnIndicator(gameState) {
    if (!gameState) return;
    gameEls.turn.textContent = `${gameState.turn.toUpperCase()}'s Turn`;
    const turnColor = playerColorSwatches[gameState.turn] || '#f5f5dc';
    gameEls.turn.style.color = turnColor;
    gameEls.turn.style.textShadow = gameState.turn === 'red'
        ? '0 0 14px rgba(255, 102, 102, 0.8)'
        : '0 0 16px rgba(255, 225, 120, 0.65)';
}

function refreshPlayerLabels() {
    if (!currentPlayers) {
        playerLabels = { red: 'Red', black: 'Black' };
        return;
    }
    const playerValues = Object.values(currentPlayers || {});
    const redPlayer = playerValues.find(p => p.color === 'red');
    const blackPlayer = playerValues.find(p => p.color === 'black');
    playerLabels = {
        red: derivePlayerLabel(redPlayer, 'Red'),
        black: derivePlayerLabel(blackPlayer, 'Black')
    };
}

function derivePlayerLabel(player, fallback) {
    if (!player) return fallback;
    const rawLabel = player.username || player.name || player.displayName || player.playerName || '';
    const cleaned = sanitizeName(rawLabel).slice(0, 24);
    return cleaned || fallback;
}

function formatColorLabel(color) {
    if (!color) return '';
    return color.charAt(0).toUpperCase() + color.slice(1);
}

function updateScoreboardDisplay(score = { red: 0, black: 0 }) {
    refreshPlayerLabels();
    if (!scoreboardEls.text) return;
    const redScore = score.red ?? 0;
    const blackScore = score.black ?? 0;
    latestScore = { red: redScore, black: blackScore };
    scoreboardEls.text.textContent = `${playerLabels.red}: ${redScore} – ${playerLabels.black}: ${blackScore}`;
}

function leaveGame() {
    if (socket && socket.connected) {
        socket.emit('leaveGame');
    }
    if (game) {
        game.destroy(true);
        game = null;
    }
    currentPlayers = null;
    playerLabels = { red: 'Red', black: 'Black' };
    latestScore = { red: 0, black: 0 };
    if (scoreboardEls.container) {
        scoreboardEls.container.classList.add('hidden');
    }
    if (gameEls.gameOverMessage) {
        gameEls.gameOverMessage.classList.add('hidden');
    }
    showUI(ui.mainLobby);
    showToast('Returned to the main lobby.', 'info');
}

// Destroys any old game instance and creates a new one.
function startGameScene(config) {
    if (game) game.destroy(true);
    const gameConfig = {
        type: Phaser.AUTO, width: 640, height: 640,
        parent: 'game-container', backgroundColor: '#0b3d0b',
        scene: new CheckersScene(config)
    };
    game = new Phaser.Game(gameConfig);
}

// --- App Initialization ---
populateGameSelection();
showUI(ui.mainLobby);
window.joinGame = joinGame;


// --- Phaser Scene for Checkers ---
// This class contains all the logic for drawing the board and handling clicks.
class CheckersScene extends Phaser.Scene {
    constructor(config) {
        super({ key: 'CheckersScene' });
        this.socket = config.socket;
        this.myColor = config.myColor;
        this.gameState = config.gameState; // Initial state
        this.pieceSprites = null;
        this.selectedPiece = null;
        this.BOARD_SIZE = 8;
        this.CELL_SIZE = 80;
        this.pendingAnnouncement = config.roundMessage || null;
    }

    create() {
        this.pieceSprites = this.add.group();
        this.drawBoard();
        this.renderPieces(); // Render initial state
        this.input.on('pointerdown', this.handleBoardClick, this);
        if (this.pendingAnnouncement) {
            this.showAnnouncement(this.pendingAnnouncement);
            this.pendingAnnouncement = null;
        }
    }

    drawBoard() {
        const lightSquareColor = 0xc9d6a3;
        const darkSquareColor = 0x0a4f0a;
        for (let y = 0; y < this.BOARD_SIZE; y++) {
            for (let x = 0; x < this.BOARD_SIZE; x++) {
                const color = (x + y) % 2 === 0 ? lightSquareColor : darkSquareColor;
                this.add.rectangle(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE, color).setOrigin(0, 0);
            }
        }
    }
    
    // This is the main update function called by the server.
    updateGameState(newGameState) {
        this.gameState = newGameState;
        this.renderPieces();
    }

    // Clears the board and redraws all pieces from the current gameState.
    renderPieces() {
        this.pieceSprites.clear(true, true);
        if (!this.gameState || !this.gameState.board) return;
        for (let y = 0; y < this.BOARD_SIZE; y++) {
            for (let x = 0; x < this.BOARD_SIZE; x++) {
                const pieceType = this.gameState.board[y][x];
                if (pieceType !== 0) {
                    const isKing = pieceType === 3 || pieceType === 4;
                    const isRedPiece = [1, 3].includes(pieceType);
                    const pieceColor = isRedPiece ? 0xc0392b : 0x1e1b1b;
                    const strokeColor = isRedPiece ? 0xffa07a : 0xd4af37;
                    const pieceSprite = this.add.container(x * this.CELL_SIZE + this.CELL_SIZE / 2, y * this.CELL_SIZE + this.CELL_SIZE / 2);
                    const circle = this.add.circle(0, 0, this.CELL_SIZE / 2 - 8, pieceColor).setStrokeStyle(4, strokeColor);
                    pieceSprite.add(circle);
                    if (isKing) pieceSprite.add(this.add.text(0, 0, '👑', { fontSize: '24px', color: '#ffe066' }).setOrigin(0.5));
                    pieceSprite.setData({ gridX: x, gridY: y });
                    this.pieceSprites.add(pieceSprite);
                }
            }
        }
    }

    // Handles a click on the game board.
    handleBoardClick(pointer) {
        const gridX = Math.floor(pointer.x / this.CELL_SIZE);
        const gridY = Math.floor(pointer.y / this.CELL_SIZE);

        if (
            gridX < 0 ||
            gridY < 0 ||
            gridX >= this.BOARD_SIZE ||
            gridY >= this.BOARD_SIZE
        ) {
            return;
        }

        if (!this.gameState || this.gameState.turn !== this.myColor) return; // Ignore clicks if it's not our turn

        const pieceAtClick = this.gameState.board[gridY][gridX];
        const isMyPiece = (this.myColor === 'red' && [1, 3].includes(pieceAtClick)) || (this.myColor === 'black' && [2, 4].includes(pieceAtClick));

        if (this.selectedPiece) {
            // If a piece is already selected, this click is the destination.
            const from = { x: this.selectedPiece.x, y: this.selectedPiece.y };
            const to = { x: gridX, y: gridY };
            this.socket.emit('movePiece', { from, to });
            
            // Deselect the piece visually.
            this.selectedPiece.sprite.list[0].setStrokeStyle(4, this.selectedPiece.originalStroke);
            this.selectedPiece = null;

        } else if (isMyPiece) {
            // If no piece is selected and we clicked our own piece, select it.
            const sprite = this.pieceSprites.getChildren().find(p => p.data.get('gridX') === gridX && p.data.get('gridY') === gridY);
            if (sprite) {
                const circle = sprite.list[0];
                this.selectedPiece = { x: gridX, y: gridY, sprite: sprite, originalStroke: circle.strokeColor };
                circle.setStrokeStyle(6, 0xffd700); // Highlight with gold
            }
        }
    }

    showAnnouncement(message) {
        const centerX = this.cameras.main.width / 2;
        const centerY = this.cameras.main.height / 2;
        const announceText = this.add.text(centerX, centerY, message, {
            fontSize: '48px',
            color: '#ffffff',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5);
        announceText.setStroke('#000000', 8);
        this.tweens.add({
            targets: announceText,
            alpha: 0,
            duration: 1500,
            delay: 1000,
            onComplete: () => announceText.destroy()
        });
    }
}

