export function createGameUI(elements) {
  const { game, scoreboard, modals } = elements;
  let currentPlayers = null;
  let playerLabels = { red: 'Red', black: 'Black' };
  let latestScore = { red: 0, black: 0 };
  let deriveLabel = (player, fallback) => fallback;

  function syncPlayers(players, derivePlayerLabel) {
    currentPlayers = players;
    deriveLabel = derivePlayerLabel;
    refreshLabels();
    if (!players) {
      updateScoreboard({ red: 0, black: 0 });
    } else {
      updateScoreboard(latestScore);
    }
  }

  function refreshLabels() {
    if (!currentPlayers) {
      playerLabels = { red: 'Red', black: 'Black' };
      return;
    }
    const values = Object.values(currentPlayers || {});
    const redPlayer = values.find((player) => player.color === 'red');
    const blackPlayer = values.find((player) => player.color === 'black');
    playerLabels = {
      red: deriveLabel(redPlayer, 'Red'),
      black: deriveLabel(blackPlayer, 'Black')
    };
  }

  function updateScoreboard(score = { red: 0, black: 0 }) {
    refreshLabels();
    const { text } = scoreboard;
    if (!text) return;
    const redScore = score.red ?? 0;
    const blackScore = score.black ?? 0;
    latestScore = { red: redScore, black: blackScore };
    text.textContent = `${playerLabels.red}: ${redScore} – ${playerLabels.black}: ${blackScore}`;
  }

  function setScoreboardVisibility(isVisible) {
    scoreboard.container?.classList.toggle('hidden', !isVisible);
  }

  function updateTurnIndicator(gameState) {
    if (!gameState || !game.turn) return;
    const playerColorSwatches = { red: '#ff6b6b', black: '#f5f5dc' };
    game.turn.textContent = `${gameState.turn.toUpperCase()}'s Turn`;
    const color = playerColorSwatches[gameState.turn] || '#f5f5dc';
    game.turn.style.color = color;
    game.turn.style.textShadow =
      gameState.turn === 'red'
        ? '0 0 14px rgba(255, 102, 102, 0.8)'
        : '0 0 16px rgba(255, 225, 120, 0.65)';
  }

  function showGameOver(message) {
    if (!modals.gameOver || !game.winnerText) return;
    game.winnerText.textContent = message;
    modals.gameOver.classList.remove('hidden');
  }

  return {
    syncPlayers,
    updateScoreboard,
    setScoreboardVisibility,
    updateTurnIndicator,
    showGameOver
  };
}
