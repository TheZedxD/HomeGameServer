export function createGameUI(elements, modalManager) {
  const { game, scoreboard, modals } = elements;
  let currentPlayers = null;
  let latestScore = {};
  let deriveLabel = (player, fallback) => fallback;

  function setGameType() {}

  function syncPlayers(players, derivePlayerLabel) {
    currentPlayers = players;
    deriveLabel = derivePlayerLabel;
    if (!players) {
      latestScore = {};
      updateScoreboard({}, { players: null });
    } else {
      updateScoreboard(latestScore, { players: currentPlayers });
    }
  }

  function getScoreLabel(key, playersMap) {
    const fallbackLabel = typeof key === 'string' ? key.toUpperCase() : 'Player';
    if (!playersMap) {
      return fallbackLabel;
    }
    const roster = Object.values(playersMap || {});
    const byColor = roster.find((player) => player.color === key);
    if (byColor) {
      const base = deriveLabel(byColor, fallbackLabel);
      return `${base} (${String(key).toUpperCase()})`;
    }
    const byMarker = roster.find((player) => player.marker === key);
    if (byMarker) {
      const base = deriveLabel(byMarker, fallbackLabel);
      return byMarker.marker ? `${base} (${String(byMarker.marker).toUpperCase()})` : base;
    }
    const byId = roster.find((player) => player.id === key);
    if (byId) {
      return deriveLabel(byId, fallbackLabel);
    }
    return fallbackLabel;
  }

  function updateScoreboard(score = {}, context = {}) {
    const { text } = scoreboard;
    if (!text) return;
    const playersMap = context.players || currentPlayers;
    latestScore = typeof score === 'object' && score !== null ? { ...score } : {};
    const entries = [];
    const processed = new Set();

    Object.entries(latestScore).forEach(([key, value]) => {
      const label = getScoreLabel(key, playersMap);
      const normalizedValue = Number.isFinite(Number(value)) ? Number(value) : 0;
      entries.push(`${label}: ${normalizedValue}`);
      processed.add(key);
    });

    if (playersMap) {
      Object.values(playersMap).forEach((player) => {
        const identifier = player.color || player.marker || player.id;
        if (processed.has(identifier)) {
          return;
        }
        const fallbackLabel = identifier ? String(identifier).toUpperCase() : 'Player';
        const label = deriveLabel(player, fallbackLabel);
        const existing = Number.isFinite(Number(latestScore[identifier])) ? Number(latestScore[identifier]) : 0;
        entries.push(`${label}: ${existing}`);
      });
    }

    if (!entries.length) {
      text.textContent = 'No rounds played yet.';
    } else {
      text.textContent = entries.join(' – ');
    }
  }

  function setScoreboardVisibility(isVisible) {
    scoreboard.container?.classList.toggle('hidden', !isVisible);
  }

  function updateTurnIndicator(gameState = {}, context = {}) {
    if (!game.turn) return;
    const playersMap = context.players || currentPlayers;
    const colorPalette = { red: '#ff6b6b', black: '#f5f5dc' };
    const turnId = gameState.currentPlayerId || gameState.turn || null;
    let label = null;
    let accentColor = null;

    if (turnId && playersMap?.[turnId]) {
      const activePlayer = playersMap[turnId];
      const fallback = activePlayer.marker || activePlayer.color || 'Player';
      label = deriveLabel(activePlayer, fallback);
      if (activePlayer.color && colorPalette[activePlayer.color]) {
        accentColor = colorPalette[activePlayer.color];
      }
    }

    if (!label && typeof gameState.turnColor === 'string' && gameState.turnColor) {
      label = gameState.turnColor.toUpperCase();
      accentColor = colorPalette[gameState.turnColor] || null;
    }

    if (!label && typeof gameState.turn === 'string' && gameState.turn) {
      const fallback = playersMap?.[gameState.turn]
        ? deriveLabel(playersMap[gameState.turn], 'Player')
        : gameState.turn.length <= 3
          ? gameState.turn.toUpperCase()
          : gameState.turn;
      label = fallback;
    }

    if (!label) {
      game.turn.textContent = '';
      game.turn.style.color = '';
      game.turn.style.textShadow = '';
      return;
    }

    game.turn.textContent = `${label}'s Turn`;
    if (accentColor) {
      game.turn.style.color = accentColor;
      game.turn.style.textShadow =
        accentColor === colorPalette.red
          ? '0 0 14px rgba(255, 102, 102, 0.8)'
          : '0 0 16px rgba(255, 225, 120, 0.65)';
    } else {
      game.turn.style.color = '';
      game.turn.style.textShadow = '';
    }
  }

  function showGameOver(message) {
    if (!modals.gameOver || !game.winnerText) return;
    game.winnerText.textContent = message;
    if (modalManager) {
      modalManager.openModal(modals.gameOver);
    } else {
      modals.gameOver.classList.remove('hidden');
    }
  }

  function togglePauseMenu(show) {
    if (!modals.pauseMenu) return;
    if (show) {
      if (modalManager) {
        modalManager.openModal(modals.pauseMenu);
      } else {
        modals.pauseMenu.classList.remove('hidden');
      }
    } else {
      if (modalManager) {
        modalManager.closeModal(modals.pauseMenu);
      } else {
        modals.pauseMenu.classList.add('hidden');
      }
    }
  }

  return {
    syncPlayers,
    updateScoreboard,
    setScoreboardVisibility,
    updateTurnIndicator,
    showGameOver,
    togglePauseMenu,
    setGameType
  };
}
