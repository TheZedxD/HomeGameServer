/**
 * CardGameScene Component
 * Renders card games with visual card elements, animations, and interactions
 */

export class CardGameScene {
  constructor({ socket, playerId, gameState, containerId = 'game-canvas-container' }) {
    this.socket = socket;
    this.playerId = playerId;
    this.gameState = gameState;
    this.containerId = containerId;

    this.canvas = null;
    this.ctx = null;
    this.selectedCard = null;
    this.hoveredCard = null;
    this.animations = [];

    // Card dimensions
    this.cardWidth = 80;
    this.cardHeight = 112;
    this.cardRadius = 8;
    this.cardSpacing = 10;

    // Colors
    this.colors = {
      background: '#2d5016',
      cardFront: '#ffffff',
      cardBack: '#1e3a8a',
      cardBorder: '#000000',
      red: '#dc2626',
      black: '#000000',
      selected: '#fbbf24',
      hover: '#60a5fa'
    };

    this.boundHandleClick = this.handleBoardClick.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
  }

  /**
   * Initialize the card game scene
   */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container ${this.containerId} not found`);
      return;
    }

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'card-game-canvas';
    this.canvas.style.display = 'block';
    this.canvas.style.margin = '0 auto';

    container.innerHTML = '';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();

    // Add event listeners
    this.canvas.addEventListener('click', this.boundHandleClick);
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    window.addEventListener('resize', () => this.resizeCanvas());

    // Start animation loop
    this.animate();

    // Initial render
    this.render();
  }

  /**
   * Resize canvas to fill container while maintaining aspect ratio
   */
  resizeCanvas() {
    if (!this.canvas) return;

    const container = document.getElementById(this.containerId);
    const dpr = window.devicePixelRatio || 1;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    this.canvas.width = containerWidth * dpr;
    this.canvas.height = containerHeight * dpr;
    this.canvas.style.width = `${containerWidth}px`;
    this.canvas.style.height = `${containerHeight}px`;

    this.ctx.scale(dpr, dpr);
    this.render();
  }

  /**
   * Main render function
   */
  render() {
    if (!this.ctx) return;

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    // Clear canvas
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, width, height);

    // Draw different sections based on game type
    if (this.gameState.gameType === 'war') {
      this.renderWar(width, height);
    } else if (this.gameState.gameType === 'hearts') {
      this.renderHearts(width, height);
    }

    // Draw animations
    this.renderAnimations();
  }

  /**
   * Render War game
   */
  renderWar(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw turn indicator
    if (this.gameState.currentPlayerId) {
      const isMyTurn = this.gameState.currentPlayerId === this.playerId;
      const turnText = isMyTurn ? 'YOUR TURN - Click your deck to play!' : "Opponent's Turn";
      this.ctx.fillStyle = isMyTurn ? '#22c55e' : '#ffffff';
      this.ctx.font = 'bold 18px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(turnText, centerX, 30);
    }

    // Draw played cards in center
    const playedCards = this.gameState.playedCards || {};
    const playerIds = Object.keys(playedCards);

    playerIds.forEach((pid, index) => {
      const card = playedCards[pid];
      if (card) {
        const x = centerX + (index === 0 ? -100 : 100);
        const y = centerY - this.cardHeight / 2;
        const playerName = this.gameState.players[pid]?.displayName || `Player ${index + 1}`;
        const isCurrentPlayer = pid === this.playerId;

        this.drawCard(card, x, y, true);

        // Draw player name with highlight if it's them
        this.ctx.fillStyle = isCurrentPlayer ? '#fbbf24' : '#ffffff';
        this.ctx.font = isCurrentPlayer ? 'bold 16px Arial' : 'bold 14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(playerName, x + this.cardWidth / 2, y - 10);
      }
    });

    // Draw war status
    if (this.gameState.isWar) {
      this.ctx.fillStyle = '#fbbf24';
      this.ctx.font = 'bold 48px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 3;
      this.ctx.strokeText('WAR!', centerX, 80);
      this.ctx.fillText('WAR!', centerX, 80);
    }

    // Draw player's hand at bottom
    this.drawPlayerHand(width, height);

    // Draw opponent's card count at top
    this.drawOpponentCards(width, height);

    // Draw scores
    this.drawScores(width, height);
  }

  /**
   * Render Hearts game
   */
  renderHearts(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw turn indicator
    if (this.gameState.currentPlayerId) {
      const isMyTurn = this.gameState.currentPlayerId === this.playerId;
      const currentPlayer = this.gameState.players?.[this.gameState.currentPlayerId];
      const turnText = isMyTurn ? 'YOUR TURN - Select a card!' : `${currentPlayer?.displayName || "Player"}'s Turn`;
      this.ctx.fillStyle = isMyTurn ? '#22c55e' : '#ffffff';
      this.ctx.font = 'bold 18px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(turnText, centerX, 30);
    }

    // Draw current trick in center
    const currentTrick = this.gameState.currentTrick || [];
    const positions = [
      { x: centerX, y: centerY + 60 },      // South (player)
      { x: centerX + 80, y: centerY },      // East
      { x: centerX, y: centerY - 60 },      // North
      { x: centerX - 80, y: centerY }       // West
    ];

    currentTrick.forEach((play, index) => {
      const pos = positions[index];
      this.drawCard(play.card, pos.x - this.cardWidth / 2, pos.y - this.cardHeight / 2, true);

      // Draw player name
      const isCurrentPlayer = play.playerId === this.playerId;
      this.ctx.fillStyle = isCurrentPlayer ? '#fbbf24' : '#ffffff';
      this.ctx.font = isCurrentPlayer ? 'bold 14px Arial' : '12px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(play.playerName, pos.x, pos.y - this.cardHeight / 2 - 5);
    });

    // Draw player's hand at bottom
    this.drawPlayerHand(width, height);

    // Draw other players' card counts
    this.drawAllPlayerCards(width, height);

    // Draw scores
    this.drawScores(width, height);

    // Draw hearts broken indicator
    if (this.gameState.heartsBroken) {
      this.ctx.fillStyle = '#dc2626';
      this.ctx.font = 'bold 16px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText('♥ Hearts Broken', width - 10, 30);
    }
  }

  /**
   * Draw player's hand
   */
  drawPlayerHand(width, height) {
    const hand = this.gameState.hands?.[this.playerId] || [];
    if (hand.length === 0) return;

    const totalWidth = hand.length * (this.cardWidth + this.cardSpacing);
    let startX = (width - totalWidth) / 2;
    const y = height - this.cardHeight - 20;

    hand.forEach((card, index) => {
      const x = startX + index * (this.cardWidth + this.cardSpacing);
      const isSelected = this.selectedCard?.id === card.id;
      const isHovered = this.hoveredCard?.id === card.id;
      const offsetY = isSelected ? -20 : (isHovered ? -10 : 0);

      this.drawCard(card, x, y + offsetY, true, isSelected, isHovered);

      // Store card position for hit detection
      card._bounds = {
        x, y: y + offsetY,
        width: this.cardWidth,
        height: this.cardHeight
      };
    });
  }

  /**
   * Draw opponent's card count (War)
   */
  drawOpponentCards(width, height) {
    const playerIds = Object.keys(this.gameState.hands || {});
    const opponentId = playerIds.find(pid => pid !== this.playerId);

    if (opponentId) {
      const opponentHand = this.gameState.hands[opponentId] || [];
      const opponentName = this.gameState.players[opponentId]?.displayName || 'Opponent';

      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 16px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`${opponentName}: ${opponentHand.length} cards`, width / 2, 30);

      // Draw card back to represent opponent's hand
      const x = width / 2 - this.cardWidth / 2;
      this.drawCard(null, x, 50, false);
    }
  }

  /**
   * Draw all players' card counts (Hearts)
   */
  drawAllPlayerCards(width, height) {
    const playerIds = this.gameState.playerOrder || [];
    const positions = [
      { x: width / 2, y: height - 40, label: 'You' },
      { x: width - 100, y: height / 2, label: 'East' },
      { x: width / 2, y: 40, label: 'North' },
      { x: 100, y: height / 2, label: 'West' }
    ];

    playerIds.forEach((pid, index) => {
      if (pid === this.playerId) return; // Skip player's own hand

      const hand = this.gameState.hands[pid] || [];
      const playerName = this.gameState.players[pid]?.displayName || positions[index]?.label;
      const pos = positions[index];

      if (pos) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${playerName}: ${hand.length}`, pos.x, pos.y);
      }
    });
  }

  /**
   * Draw scores
   */
  drawScores(width, height) {
    const scores = this.gameState.score || {};
    let y = 60;

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'left';

    Object.entries(scores).forEach(([pid, score]) => {
      const playerName = this.gameState.players[pid]?.displayName || pid;
      const isCurrentPlayer = pid === this.playerId;

      this.ctx.fillStyle = isCurrentPlayer ? '#fbbf24' : '#ffffff';
      this.ctx.fillText(`${playerName}: ${score}`, 10, y);
      y += 20;
    });
  }

  /**
   * Draw a single card
   */
  drawCard(card, x, y, faceUp = true, isSelected = false, isHovered = false) {
    const ctx = this.ctx;

    // Draw shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    // Draw card background
    ctx.fillStyle = faceUp ? this.colors.cardFront : this.colors.cardBack;
    this.roundRect(ctx, x, y, this.cardWidth, this.cardHeight, this.cardRadius);
    ctx.fill();

    ctx.restore();

    // Draw border
    if (isSelected) {
      ctx.strokeStyle = this.colors.selected;
      ctx.lineWidth = 3;
    } else if (isHovered) {
      ctx.strokeStyle = this.colors.hover;
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = this.colors.cardBorder;
      ctx.lineWidth = 1;
    }
    this.roundRect(ctx, x, y, this.cardWidth, this.cardHeight, this.cardRadius);
    ctx.stroke();

    if (faceUp && card) {
      // Draw card content
      const color = card.color === 'red' ? this.colors.red : this.colors.black;

      // Draw rank in corners
      ctx.fillStyle = color;
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(card.rank, x + 8, y + 22);

      ctx.textAlign = 'right';
      ctx.save();
      ctx.translate(x + this.cardWidth - 8, y + this.cardHeight - 8);
      ctx.rotate(Math.PI);
      ctx.fillText(card.rank, 0, 0);
      ctx.restore();

      // Draw suit symbol in corners
      ctx.font = '16px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(card.symbol, x + 8, y + 38);

      ctx.textAlign = 'right';
      ctx.save();
      ctx.translate(x + this.cardWidth - 8, y + this.cardHeight - 24);
      ctx.rotate(Math.PI);
      ctx.fillText(card.symbol, 0, 0);
      ctx.restore();

      // Draw large suit symbol in center
      ctx.font = 'bold 40px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(card.symbol, x + this.cardWidth / 2, y + this.cardHeight / 2 + 15);
    } else if (!faceUp) {
      // Draw card back pattern
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(x + 10, y + 10, this.cardWidth - 20, this.cardHeight - 20);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 15, y + 15, this.cardWidth - 30, this.cardHeight - 30);
    }
  }

  /**
   * Helper to draw rounded rectangles
   */
  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Handle board click
   */
  handleBoardClick(event) {
    if (!this.gameState || this.gameState.currentPlayerId !== this.playerId) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if clicked on a card in hand
    const hand = this.gameState.hands?.[this.playerId] || [];
    for (const card of hand) {
      if (card._bounds && this.isPointInRect(x, y, card._bounds)) {
        this.onCardClick(card);
        return;
      }
    }
  }

  /**
   * Handle mouse move for hover effects
   */
  handleMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let foundHover = false;
    const hand = this.gameState.hands?.[this.playerId] || [];

    for (const card of hand) {
      if (card._bounds && this.isPointInRect(x, y, card._bounds)) {
        if (this.hoveredCard?.id !== card.id) {
          this.hoveredCard = card;
          this.render();
        }
        foundHover = true;
        this.canvas.style.cursor = 'pointer';
        break;
      }
    }

    if (!foundHover && this.hoveredCard) {
      this.hoveredCard = null;
      this.canvas.style.cursor = 'default';
      this.render();
    }
  }

  /**
   * Check if point is inside rectangle
   */
  isPointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.width &&
           y >= rect.y && y <= rect.y + rect.height;
  }

  /**
   * Handle card click
   */
  onCardClick(card) {
    // Check if it's player's turn
    if (this.gameState.currentPlayerId !== this.playerId) {
      return;
    }

    // Select card
    this.selectedCard = card;
    this.render();

    // Emit play card event based on game type
    if (this.gameState.gameType === 'war') {
      // For War, play card immediately
      this.socket?.emit('submitMove', {
        type: 'playCard',
        playerId: this.playerId
      });
      this.selectedCard = null;

      // Show brief feedback
      this.showBriefMessage('Card Played!');
    } else if (this.gameState.gameType === 'hearts') {
      // For Hearts, emit the specific card
      this.socket?.emit('submitMove', {
        type: 'playCard',
        playerId: this.playerId,
        payload: { cardId: card.id }
      });
      this.selectedCard = null;

      // Show brief feedback
      this.showBriefMessage('Card Played!');
    }
  }

  /**
   * Show a brief message overlay
   */
  showBriefMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'brief-message';
    messageEl.textContent = message;
    messageEl.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fbbf24;
      padding: 15px 30px;
      border-radius: 8px;
      font-size: 20px;
      font-weight: bold;
      z-index: 1000;
      pointer-events: none;
      animation: fadeOut 1s ease-out;
    `;

    const container = document.getElementById(this.containerId);
    container.appendChild(messageEl);

    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.parentNode.removeChild(messageEl);
      }
    }, 1000);
  }

  /**
   * Update game state
   */
  updateGameState(newState) {
    const oldState = this.gameState;
    this.gameState = newState;

    // Trigger animations based on state changes
    if (oldState && newState) {
      this.checkForAnimations(oldState, newState);
    }

    this.render();
  }

  /**
   * Check for state changes that should trigger animations
   */
  checkForAnimations(oldState, newState) {
    // Check if cards were played
    if (newState.lastMove && newState.lastMove !== oldState.lastMove) {
      // Could add card play animation here
    }

    // Check if round completed
    if (newState.isRoundComplete && !oldState.isRoundComplete) {
      this.showAnnouncement(newState.winner ? `${newState.winner} wins the round!` : 'Round complete');
    }

    // Check if game completed
    if (newState.isComplete && !oldState.isComplete) {
      this.showAnnouncement(newState.gameWinner ? `${newState.gameWinner} wins the game!` : 'Game complete');
    }
  }

  /**
   * Show announcement message
   */
  showAnnouncement(message) {
    const announcement = document.createElement('div');
    announcement.className = 'game-announcement';
    announcement.textContent = message;
    announcement.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 40px;
      border-radius: 10px;
      font-size: 24px;
      font-weight: bold;
      z-index: 1000;
      animation: fadeInOut 2s ease-in-out;
    `;

    document.getElementById(this.containerId).appendChild(announcement);
    setTimeout(() => announcement.remove(), 2000);
  }

  /**
   * Render animations
   */
  renderAnimations() {
    // Animation system for future enhancements
    this.animations = this.animations.filter(anim => {
      anim.update();
      anim.render(this.ctx);
      return !anim.isComplete();
    });
  }

  /**
   * Animation loop
   */
  animate() {
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.boundHandleClick);
      this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
      window.removeEventListener('resize', () => this.resizeCanvas());
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.animations = [];
  }
}
