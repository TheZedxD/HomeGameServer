/**
 * CasinoGameScene Component
 * Renders casino games (Blackjack, Texas Hold'em, 5 Card Stud, Baccarat)
 * with betting UI, animations, and voting system
 */

export class CasinoGameScene {
  constructor({ socket, playerId, gameType, gameState, containerId = 'game-canvas-container' }) {
    this.socket = socket;
    this.playerId = playerId;
    this.gameType = gameType;
    this.gameState = gameState;
    this.containerId = containerId;

    this.canvas = null;
    this.ctx = null;
    this.animations = [];
    this.buttons = [];
    this.hoveredButton = null;
    this.betInput = '';

    // Card dimensions
    this.cardWidth = 80;
    this.cardHeight = 112;
    this.cardRadius = 8;
    this.cardSpacing = 10;

    // Colors - matching the existing theme
    this.colors = {
      background: '#2d5016',
      cardFront: '#ffffff',
      cardBack: '#1e3a8a',
      cardBorder: '#000000',
      red: '#dc2626',
      black: '#000000',
      gold: '#fbbf24',
      green: '#22c55e',
      blue: '#60a5fa',
      darkGreen: '#166534'
    };

    // Voting state
    this.votingActive = false;
    this.playerVote = null;

    this.boundHandleClick = this.handleCanvasClick.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleKeyPress = this.handleKeyPress.bind(this);
  }

  /**
   * Initialize the casino game scene
   */
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container ${this.containerId} not found`);
      return;
    }

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'casino-game-canvas';
    this.canvas.style.display = 'block';
    this.canvas.style.margin = '0 auto';
    this.canvas.tabIndex = 1; // Make canvas focusable for keyboard input

    container.innerHTML = '';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();

    // Add event listeners
    this.canvas.addEventListener('click', this.boundHandleClick);
    this.canvas.addEventListener('mousemove', this.boundHandleMouseMove);
    this.canvas.addEventListener('keypress', this.boundHandleKeyPress);
    window.addEventListener('resize', () => this.resizeCanvas());

    // Start animation loop
    this.animate();

    // Show start animation
    this.showStartAnimation();

    // Initial render
    this.render();
  }

  /**
   * Resize canvas to fill container
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

    // Clear canvas with felt background
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, width, height);

    // Check if voting is active
    if (this.gameState.votingPhase) {
      this.renderVotingScreen(width, height);
      return;
    }

    // Render based on game type
    switch (this.gameType) {
      case 'blackjack':
        this.renderBlackjack(width, height);
        break;
      case 'texas-holdem':
        this.renderTexasHoldem(width, height);
        break;
      case '5-card-stud':
        this.renderFiveCardStud(width, height);
        break;
      case 'baccarat':
        this.renderBaccarat(width, height);
        break;
      default:
        this.renderError(width, height, `Unknown game: ${this.gameType}`);
    }

    // Render animations on top
    this.renderAnimations();
  }

  /**
   * Render Blackjack game
   */
  renderBlackjack(width, height) {
    const state = this.gameState;
    const centerX = width / 2;

    // Draw dealer section at top
    this.drawDealerSection(centerX, 50, state);

    // Draw player sections at bottom
    this.drawPlayerSections(width, height, state);

    // Draw pot and betting info
    this.drawPotInfo(width, height, state);

    // Draw action buttons for current player
    if (state.currentPlayerId === this.playerId && state.phase === 'playing') {
      this.drawBlackjackActions(width, height, state);
    } else if (state.phase === 'betting' && !state.playerBets?.[this.playerId]) {
      this.drawBettingUI(width, height, state);
    }

    // Draw phase indicator
    this.drawPhaseIndicator(width, state.phase);
  }

  /**
   * Render Texas Hold'em game
   */
  renderTexasHoldem(width, height) {
    const state = this.gameState;
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw community cards in center
    this.drawCommunityCards(centerX, centerY - 100, state);

    // Draw pot in center
    this.drawCentralPot(centerX, centerY, state);

    // Draw player positions around table
    this.drawPokerPlayers(width, height, state);

    // Draw action buttons for current player
    if (state.currentPlayerId === this.playerId) {
      this.drawPokerActions(width, height, state);
    }

    // Draw betting round indicator
    this.drawBettingRound(width, state.bettingRound);
  }

  /**
   * Render 5 Card Stud game
   */
  renderFiveCardStud(width, height) {
    const state = this.gameState;
    const centerX = width / 2;

    // Draw pot
    this.drawCentralPot(centerX, height / 2, state);

    // Draw player positions
    this.drawPokerPlayers(width, height, state);

    // Draw action buttons
    if (state.currentPlayerId === this.playerId) {
      this.drawPokerActions(width, height, state);
    }

    // Draw street indicator
    this.drawStreetIndicator(width, state.street);
  }

  /**
   * Render Baccarat game
   */
  renderBaccarat(width, height) {
    const state = this.gameState;
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw banker hand (top)
    this.drawBaccaratHand('Banker', state.bankerHand, centerX - 100, centerY - 150, state.bankerValue);

    // Draw player hand (bottom)
    this.drawBaccaratHand('Player', state.playerHand, centerX - 100, centerY + 50, state.playerValue);

    // Draw betting options
    if (state.phase === 'betting' && !state.playerBets?.[this.playerId]) {
      this.drawBaccaratBettingUI(width, height, state);
    }

    // Draw results
    if (state.phase === 'complete') {
      this.drawBaccaratResults(centerX, centerY, state);
    }
  }

  /**
   * Draw dealer section for Blackjack
   */
  drawDealerSection(centerX, y, state) {
    const dealerHand = state.dealerHand || [];
    const dealerValue = state.dealerValue || 0;

    // Draw "DEALER" label
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 20px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('DEALER', centerX, y - 10);

    // Draw dealer's cards
    if (dealerHand.length > 0) {
      const startX = centerX - (dealerHand.length * (this.cardWidth + this.cardSpacing)) / 2;
      dealerHand.forEach((card, index) => {
        const x = startX + index * (this.cardWidth + this.cardSpacing);
        this.drawCard(card, x, y, card.faceUp);
      });

      // Show value if dealer's turn or game complete
      if (state.phase === 'dealer' || state.phase === 'complete') {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 18px Arial';
        this.ctx.fillText(`Value: ${dealerValue}`, centerX, y + this.cardHeight + 25);
      }
    }
  }

  /**
   * Draw player sections for Blackjack
   */
  drawPlayerSections(width, height, state) {
    const playerOrder = state.playerOrder || [];
    const playerCount = playerOrder.length;
    const sectionWidth = width / Math.max(playerCount, 1);
    const y = height - this.cardHeight - 120;

    playerOrder.forEach((pid, index) => {
      const centerX = sectionWidth * index + sectionWidth / 2;
      const hand = state.hands?.[pid] || [];
      const handValue = state.handValues?.[pid] || 0;
      const bet = state.playerBets?.[pid] || 0;
      const balance = state.finalBalances?.[pid] || state._bettingManager?.getPlayerBalance?.(pid) || 0;
      const status = state.playerStatuses?.[pid] || 'playing';
      const isCurrentPlayer = state.currentPlayerId === pid;
      const isMe = pid === this.playerId;

      // Highlight current player
      if (isCurrentPlayer && state.phase === 'playing') {
        this.ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
        this.ctx.fillRect(centerX - sectionWidth / 2 + 10, y - 40, sectionWidth - 20, this.cardHeight + 100);
      }

      // Draw player name
      this.ctx.fillStyle = isMe ? this.colors.gold : '#ffffff';
      this.ctx.font = isMe ? 'bold 16px Arial' : '14px Arial';
      this.ctx.textAlign = 'center';
      const playerName = isMe ? 'YOU' : `Player ${index + 1}`;
      this.ctx.fillText(playerName, centerX, y - 25);

      // Draw cards
      if (hand.length > 0) {
        const startX = centerX - (hand.length * (this.cardWidth + this.cardSpacing)) / 2;
        hand.forEach((card, cardIndex) => {
          const x = startX + cardIndex * (this.cardWidth + this.cardSpacing);
          this.drawCard(card, x, y, card.faceUp);
        });
      }

      // Draw hand value
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '14px Arial';
      this.ctx.fillText(`Value: ${handValue}`, centerX, y + this.cardHeight + 20);

      // Draw status
      if (status !== 'playing') {
        const statusText = status.toUpperCase();
        const statusColor = status === 'bust' ? '#dc2626' : status === 'blackjack' ? '#fbbf24' : '#22c55e';
        this.ctx.fillStyle = statusColor;
        this.ctx.font = 'bold 14px Arial';
        this.ctx.fillText(statusText, centerX, y + this.cardHeight + 38);
      }

      // Draw bet and balance
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(`Bet: ${bet} chips`, centerX, y + this.cardHeight + 56);
      this.ctx.fillText(`Balance: ${balance} chips`, centerX, y + this.cardHeight + 72);
    });
  }

  /**
   * Draw community cards for poker
   */
  drawCommunityCards(centerX, y, state) {
    const communityCards = state.communityCards || [];
    if (communityCards.length === 0) return;

    // Draw label
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('COMMUNITY CARDS', centerX, y - 10);

    // Draw cards
    const startX = centerX - (communityCards.length * (this.cardWidth + this.cardSpacing)) / 2;
    communityCards.forEach((card, index) => {
      const x = startX + index * (this.cardWidth + this.cardSpacing);
      this.drawCard(card, x, y, true);
    });
  }

  /**
   * Draw poker players around table
   */
  drawPokerPlayers(width, height, state) {
    const playerOrder = state.playerOrder || [];
    const activePlayers = state._bettingManager?.getActivePlayers?.() || playerOrder;

    // Calculate positions in a circle
    const positions = this.calculatePlayerPositions(playerOrder.length, width, height);

    playerOrder.forEach((pid, index) => {
      const pos = positions[index];
      const hand = state.hands?.[pid] || [];
      const bet = state.playerBets?.[pid] || 0;
      const balance = state._bettingManager?.getPlayerBalance?.(pid) || 0;
      const currentBet = state._bettingManager?.getCurrentBet?.() || 0;
      const isActive = activePlayers.includes(pid);
      const isCurrentPlayer = state.currentPlayerId === pid;
      const isMe = pid === this.playerId;

      // Draw player area background
      const bgColor = isCurrentPlayer ? 'rgba(251, 191, 36, 0.3)' : 'rgba(0, 0, 0, 0.3)';
      this.ctx.fillStyle = bgColor;
      this.roundRect(this.ctx, pos.x - 60, pos.y - 30, 120, 140, 10);
      this.ctx.fill();

      // Draw player name
      this.ctx.fillStyle = isMe ? this.colors.gold : '#ffffff';
      this.ctx.font = isMe ? 'bold 14px Arial' : '12px Arial';
      this.ctx.textAlign = 'center';
      const playerName = isMe ? 'YOU' : `P${index + 1}`;
      this.ctx.fillText(playerName, pos.x, pos.y - 10);

      // Draw cards
      if (hand.length > 0) {
        const cardY = pos.y + 5;
        hand.forEach((card, cardIndex) => {
          const miniCardWidth = 40;
          const miniCardHeight = 56;
          const cardX = pos.x - (hand.length * miniCardWidth) / 2 + cardIndex * miniCardWidth;
          this.drawMiniCard(card, cardX, cardY, card.faceUp || isMe, miniCardWidth, miniCardHeight);
        });
      }

      // Draw bet
      if (bet > 0) {
        this.ctx.fillStyle = this.colors.green;
        this.ctx.font = 'bold 12px Arial';
        this.ctx.fillText(`Bet: ${bet}`, pos.x, pos.y + 75);
      }

      // Draw balance
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = '11px Arial';
      this.ctx.fillText(`${balance} chips`, pos.x, pos.y + 90);

      // Draw folded indicator
      if (!isActive && state.phase !== 'complete') {
        this.ctx.fillStyle = 'rgba(220, 38, 38, 0.7)';
        this.roundRect(this.ctx, pos.x - 55, pos.y - 25, 110, 130, 10);
        this.ctx.fill();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 16px Arial';
        this.ctx.fillText('FOLDED', pos.x, pos.y + 30);
      }
    });
  }

  /**
   * Calculate positions for players around table
   */
  calculatePlayerPositions(playerCount, width, height) {
    const positions = [];
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = width * 0.35;
    const radiusY = height * 0.35;

    for (let i = 0; i < playerCount; i++) {
      // Start from bottom (player) and go clockwise
      const angle = (Math.PI / 2) + (i * 2 * Math.PI / playerCount);
      positions.push({
        x: centerX + radiusX * Math.cos(angle),
        y: centerY + radiusY * Math.sin(angle)
      });
    }

    return positions;
  }

  /**
   * Draw Baccarat hand
   */
  drawBaccaratHand(label, hand, x, y, value) {
    if (!hand || hand.length === 0) return;

    // Draw label
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(label, x, y - 10);

    // Draw cards
    hand.forEach((card, index) => {
      const cardX = x + index * (this.cardWidth + this.cardSpacing);
      this.drawCard(card, cardX, y, true);
    });

    // Draw value
    if (value !== undefined) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 16px Arial';
      this.ctx.fillText(`Value: ${value}`, x, y + this.cardHeight + 25);
    }
  }

  /**
   * Draw a single card
   */
  drawCard(card, x, y, faceUp = true) {
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
    ctx.strokeStyle = this.colors.cardBorder;
    ctx.lineWidth = 1;
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
   * Draw mini card for poker table
   */
  drawMiniCard(card, x, y, faceUp, width, height) {
    const ctx = this.ctx;

    // Draw card background
    ctx.fillStyle = faceUp ? this.colors.cardFront : this.colors.cardBack;
    this.roundRect(ctx, x, y, width, height, 4);
    ctx.fill();

    // Draw border
    ctx.strokeStyle = this.colors.cardBorder;
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, y, width, height, 4);
    ctx.stroke();

    if (faceUp && card) {
      const color = card.color === 'red' ? this.colors.red : this.colors.black;

      // Draw rank
      ctx.fillStyle = color;
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(card.rank, x + 4, y + 14);

      // Draw suit
      ctx.font = '10px Arial';
      ctx.fillText(card.symbol, x + 4, y + 26);

      // Draw center symbol
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(card.symbol, x + width / 2, y + height / 2 + 7);
    }
  }

  /**
   * Draw action buttons for Blackjack
   */
  drawBlackjackActions(width, height, state) {
    this.buttons = [];
    const buttonY = height - 50;
    const buttonWidth = 100;
    const buttonHeight = 40;
    const spacing = 20;
    const actions = [];

    // Determine available actions
    const hand = state.hands?.[this.playerId] || [];
    const bet = state.playerBets?.[this.playerId] || 0;
    const balance = state._bettingManager?.getPlayerBalance?.(this.playerId) || 0;

    actions.push({ label: 'HIT', action: 'hit' });
    actions.push({ label: 'STAND', action: 'stand' });

    // Can double if first turn and has balance
    if (hand.length === 2 && balance >= bet) {
      actions.push({ label: 'DOUBLE', action: 'double' });
    }

    const totalWidth = actions.length * buttonWidth + (actions.length - 1) * spacing;
    let x = (width - totalWidth) / 2;

    actions.forEach(action => {
      this.buttons.push({
        x, y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
        label: action.label,
        action: action.action,
        color: action.action === 'stand' ? this.colors.green : this.colors.blue
      });
      x += buttonWidth + spacing;
    });

    this.drawButtons();
  }

  /**
   * Draw action buttons for Poker
   */
  drawPokerActions(width, height, state) {
    this.buttons = [];
    const buttonY = height - 50;
    const buttonWidth = 90;
    const buttonHeight = 40;
    const spacing = 15;
    const actions = [];

    const bettingManager = state._bettingManager;
    if (!bettingManager) return;

    const currentBet = bettingManager.getCurrentBet?.() || 0;
    const playerBet = state.playerBets?.[this.playerId] || 0;
    const balance = bettingManager.getPlayerBalance?.(this.playerId) || 0;
    const minRaise = bettingManager.minRaise || 10;

    // Fold
    actions.push({ label: 'FOLD', action: 'fold', color: this.colors.red });

    // Check or Call
    if (currentBet === playerBet) {
      actions.push({ label: 'CHECK', action: 'check', color: this.colors.green });
    } else {
      actions.push({ label: `CALL ${currentBet - playerBet}`, action: 'call', color: this.colors.blue });
    }

    // Raise
    if (balance >= currentBet - playerBet + minRaise) {
      actions.push({ label: 'RAISE', action: 'raise', color: this.colors.gold });
    }

    // All In
    if (balance > 0) {
      actions.push({ label: 'ALL IN', action: 'allIn', color: '#dc2626' });
    }

    const totalWidth = actions.length * buttonWidth + (actions.length - 1) * spacing;
    let x = (width - totalWidth) / 2;

    actions.forEach(action => {
      this.buttons.push({
        x, y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
        label: action.label,
        action: action.action,
        color: action.color
      });
      x += buttonWidth + spacing;
    });

    this.drawButtons();
  }

  /**
   * Draw betting UI for initial bet placement
   */
  drawBettingUI(width, height, state) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw betting panel
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.roundRect(this.ctx, centerX - 200, centerY - 100, 400, 200, 10);
    this.ctx.fill();

    // Draw title
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Place Your Bet', centerX, centerY - 60);

    // Draw balance
    const balance = state._bettingManager?.getPlayerBalance?.(this.playerId) || 0;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '16px Arial';
    this.ctx.fillText(`Balance: ${balance} chips`, centerX, centerY - 30);

    // Draw bet input
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.roundRect(this.ctx, centerX - 100, centerY - 10, 200, 40, 5);
    this.ctx.fill();

    this.ctx.fillStyle = '#000000';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.fillText(this.betInput || '0', centerX, centerY + 18);

    // Draw bet buttons
    this.buttons = [];
    const betAmounts = [10, 25, 50, 100, 500];
    const buttonWidth = 70;
    const buttonY = centerY + 50;
    const totalWidth = betAmounts.length * buttonWidth + (betAmounts.length - 1) * 10;
    let x = centerX - totalWidth / 2;

    betAmounts.forEach(amount => {
      this.buttons.push({
        x, y: buttonY,
        width: buttonWidth,
        height: 35,
        label: `${amount}`,
        action: 'setBet',
        value: amount,
        color: this.colors.blue
      });
      x += buttonWidth + 10;
    });

    // Draw confirm button
    this.buttons.push({
      x: centerX - 60,
      y: centerY + 95,
      width: 120,
      height: 40,
      label: 'CONFIRM',
      action: 'placeBet',
      color: this.colors.green
    });

    this.drawButtons();
  }

  /**
   * Draw Baccarat betting UI
   */
  drawBaccaratBettingUI(width, height, state) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw betting options
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Place Your Bet', centerX, centerY - 80);

    // Draw balance
    const balance = state._bettingManager?.getPlayerBalance?.(this.playerId) || 0;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '16px Arial';
    this.ctx.fillText(`Balance: ${balance} chips`, centerX, centerY - 50);

    // Draw bet amount input
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.roundRect(this.ctx, centerX - 80, centerY - 30, 160, 40, 5);
    this.ctx.fill();

    this.ctx.fillStyle = '#000000';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.fillText(this.betInput || '0', centerX, centerY - 2);

    // Draw betting option buttons
    this.buttons = [];
    const options = [
      { label: 'PLAYER', action: 'betPlayer', color: this.colors.blue },
      { label: 'BANKER', action: 'betBanker', color: this.colors.green },
      { label: 'TIE', action: 'betTie', color: this.colors.gold }
    ];

    const buttonWidth = 100;
    const buttonY = centerY + 30;
    const totalWidth = options.length * buttonWidth + (options.length - 1) * 20;
    let x = centerX - totalWidth / 2;

    options.forEach(option => {
      this.buttons.push({
        x, y: buttonY,
        width: buttonWidth,
        height: 40,
        label: option.label,
        action: option.action,
        color: option.color
      });
      x += buttonWidth + 20;
    });

    this.drawButtons();
  }

  /**
   * Draw buttons
   */
  drawButtons() {
    this.buttons.forEach(button => {
      const isHovered = this.hoveredButton === button;

      // Draw button background
      this.ctx.fillStyle = isHovered ? this.lightenColor(button.color) : button.color;
      this.roundRect(this.ctx, button.x, button.y, button.width, button.height, 8);
      this.ctx.fill();

      // Draw button border
      this.ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(0, 0, 0, 0.3)';
      this.ctx.lineWidth = isHovered ? 2 : 1;
      this.roundRect(this.ctx, button.x, button.y, button.width, button.height, 8);
      this.ctx.stroke();

      // Draw button text
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 14px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2 + 5);
    });
  }

  /**
   * Draw pot information
   */
  drawPotInfo(width, height, state) {
    const pot = state.pot || 0;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.roundRect(this.ctx, 10, height / 2 - 40, 150, 80, 8);
    this.ctx.fill();

    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('POT', 20, height / 2 - 15);

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 24px Arial';
    this.ctx.fillText(`${pot}`, 20, height / 2 + 15);
    this.ctx.font = '14px Arial';
    this.ctx.fillText('chips', 20, height / 2 + 32);
  }

  /**
   * Draw central pot for poker
   */
  drawCentralPot(centerX, centerY, state) {
    const pot = state.pot || 0;

    // Draw pot background
    this.ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, 60, 0, 2 * Math.PI);
    this.ctx.fill();

    this.ctx.strokeStyle = this.colors.gold;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // Draw pot amount
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('POT', centerX, centerY - 10);

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.fillText(`${pot}`, centerX, centerY + 20);
  }

  /**
   * Draw phase indicator
   */
  drawPhaseIndicator(width, phase) {
    const phaseLabels = {
      betting: 'PLACE YOUR BETS',
      playing: 'PLAYING',
      dealer: 'DEALER\'S TURN',
      complete: 'ROUND COMPLETE'
    };

    const label = phaseLabels[phase] || phase.toUpperCase();

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.roundRect(this.ctx, width - 210, 10, 200, 40, 8);
    this.ctx.fill();

    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(label, width - 110, 35);
  }

  /**
   * Draw betting round indicator
   */
  drawBettingRound(width, round) {
    const roundLabels = {
      'PRE_FLOP': 'PRE-FLOP',
      'FLOP': 'FLOP',
      'TURN': 'TURN',
      'RIVER': 'RIVER',
      'SHOWDOWN': 'SHOWDOWN'
    };

    const label = roundLabels[round] || round;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.roundRect(this.ctx, width - 210, 10, 200, 40, 8);
    this.ctx.fill();

    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(label, width - 110, 35);
  }

  /**
   * Draw street indicator for 5 Card Stud
   */
  drawStreetIndicator(width, street) {
    const label = `${street || 'FIRST'} STREET`.toUpperCase();

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.roundRect(this.ctx, width - 210, 10, 200, 40, 8);
    this.ctx.fill();

    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(label, width - 110, 35);
  }

  /**
   * Draw Baccarat results
   */
  drawBaccaratResults(centerX, centerY, state) {
    const winner = state.winner || 'Tie';

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.roundRect(this.ctx, centerX - 150, centerY - 50, 300, 100, 10);
    this.ctx.fill();

    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${winner} WINS!`, centerX, centerY + 10);
  }

  /**
   * Render voting screen
   */
  renderVotingScreen(width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw semi-transparent overlay
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(0, 0, width, height);

    // Draw voting panel
    this.ctx.fillStyle = 'rgba(45, 80, 22, 0.95)';
    this.roundRect(this.ctx, centerX - 300, centerY - 200, 600, 400, 15);
    this.ctx.fill();

    this.ctx.strokeStyle = this.colors.gold;
    this.ctx.lineWidth = 3;
    this.roundRect(this.ctx, centerX - 300, centerY - 200, 600, 400, 15);
    this.ctx.stroke();

    // Draw title
    this.ctx.fillStyle = this.colors.gold;
    this.ctx.font = 'bold 36px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Round Complete!', centerX, centerY - 140);

    // Draw subtitle
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '20px Arial';
    this.ctx.fillText('What would you like to do next?', centerX, centerY - 100);

    // Draw vote counts
    const votes = this.gameState.votes || {};
    const voteCount = { newGame: 0, lobby: 0 };
    Object.values(votes).forEach(vote => {
      if (vote === 'newGame') voteCount.newGame++;
      if (vote === 'lobby') voteCount.lobby++;
    });

    this.ctx.font = '16px Arial';
    this.ctx.fillText(`Votes: New Game (${voteCount.newGame}) | Lobby (${voteCount.lobby})`, centerX, centerY - 60);

    // Draw voting buttons
    this.buttons = [];

    // New Game button
    this.buttons.push({
      x: centerX - 250,
      y: centerY - 20,
      width: 200,
      height: 80,
      label: 'PLAY AGAIN',
      sublabel: 'Start new round',
      action: 'voteNewGame',
      color: this.colors.green,
      selected: this.playerVote === 'newGame'
    });

    // Return to Lobby button
    this.buttons.push({
      x: centerX + 50,
      y: centerY - 20,
      width: 200,
      height: 80,
      label: 'LOBBY',
      sublabel: 'Choose new game',
      action: 'voteLobby',
      color: this.colors.blue,
      selected: this.playerVote === 'lobby'
    });

    // Draw buttons with selection indicator
    this.buttons.forEach(button => {
      const isHovered = this.hoveredButton === button;
      const isSelected = button.selected;

      // Draw button background
      this.ctx.fillStyle = isSelected
        ? this.colors.gold
        : (isHovered ? this.lightenColor(button.color) : button.color);
      this.roundRect(this.ctx, button.x, button.y, button.width, button.height, 10);
      this.ctx.fill();

      // Draw button border
      this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0, 0, 0, 0.3)';
      this.ctx.lineWidth = isSelected ? 4 : 2;
      this.roundRect(this.ctx, button.x, button.y, button.width, button.height, 10);
      this.ctx.stroke();

      // Draw button text
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2 - 5);

      if (button.sublabel) {
        this.ctx.font = '14px Arial';
        this.ctx.fillText(button.sublabel, button.x + button.width / 2, button.y + button.height / 2 + 18);
      }

      // Draw checkmark if selected
      if (isSelected) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 32px Arial';
        this.ctx.fillText('✓', button.x + button.width - 25, button.y + 35);
      }
    });

    // Draw voting rules
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.font = '14px Arial';
    this.ctx.fillText('Majority rules • Ties go to lobby', centerX, centerY + 120);

    // Draw waiting message
    const totalPlayers = Object.keys(this.gameState.players || {}).length;
    const totalVotes = Object.keys(votes).length;

    if (totalVotes < totalPlayers) {
      this.ctx.fillStyle = this.colors.gold;
      this.ctx.font = 'italic 16px Arial';
      this.ctx.fillText(`Waiting for ${totalPlayers - totalVotes} more vote(s)...`, centerX, centerY + 150);
    } else {
      this.ctx.fillStyle = this.colors.green;
      this.ctx.font = 'bold 18px Arial';
      this.ctx.fillText('All votes received!', centerX, centerY + 150);
    }
  }

  /**
   * Handle canvas click
   */
  handleCanvasClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if clicked on a button
    for (const button of this.buttons) {
      if (this.isPointInRect(x, y, button)) {
        this.handleButtonClick(button);
        return;
      }
    }
  }

  /**
   * Handle button click
   */
  handleButtonClick(button) {
    switch (button.action) {
      case 'hit':
        this.socket?.emit('submitMove', {
          type: 'playerAction',
          playerId: this.playerId,
          payload: { action: 'hit' }
        });
        break;

      case 'stand':
        this.socket?.emit('submitMove', {
          type: 'playerAction',
          playerId: this.playerId,
          payload: { action: 'stand' }
        });
        break;

      case 'double':
        this.socket?.emit('submitMove', {
          type: 'playerAction',
          playerId: this.playerId,
          payload: { action: 'double' }
        });
        break;

      case 'fold':
        this.socket?.emit('submitMove', {
          type: 'pokerAction',
          playerId: this.playerId,
          payload: { action: 'fold' }
        });
        break;

      case 'check':
        this.socket?.emit('submitMove', {
          type: 'pokerAction',
          playerId: this.playerId,
          payload: { action: 'check' }
        });
        break;

      case 'call':
        this.socket?.emit('submitMove', {
          type: 'pokerAction',
          playerId: this.playerId,
          payload: { action: 'call' }
        });
        break;

      case 'raise':
        // For now, use minimum raise
        const bettingManager = this.gameState._bettingManager;
        const minRaise = bettingManager?.minRaise || 10;
        this.socket?.emit('submitMove', {
          type: 'pokerAction',
          playerId: this.playerId,
          payload: { action: 'raise', amount: minRaise }
        });
        break;

      case 'allIn':
        this.socket?.emit('submitMove', {
          type: 'pokerAction',
          playerId: this.playerId,
          payload: { action: 'allIn' }
        });
        break;

      case 'setBet':
        this.betInput = button.value.toString();
        this.render();
        break;

      case 'placeBet':
        const betAmount = parseInt(this.betInput) || 0;
        if (betAmount > 0) {
          this.socket?.emit('submitMove', {
            type: 'placeBet',
            playerId: this.playerId,
            payload: { amount: betAmount }
          });
          this.betInput = '';
        }
        break;

      case 'betPlayer':
      case 'betBanker':
      case 'betTie':
        const baccaratBet = parseInt(this.betInput) || 0;
        if (baccaratBet > 0) {
          const betType = button.action.replace('bet', '').toLowerCase();
          this.socket?.emit('submitMove', {
            type: 'placeBet',
            playerId: this.playerId,
            payload: { amount: baccaratBet, betType }
          });
          this.betInput = '';
        }
        break;

      case 'voteNewGame':
        this.playerVote = 'newGame';
        this.socket?.emit('submitMove', {
          type: 'vote',
          playerId: this.playerId,
          payload: { vote: 'newGame' }
        });
        this.render();
        break;

      case 'voteLobby':
        this.playerVote = 'lobby';
        this.socket?.emit('submitMove', {
          type: 'vote',
          playerId: this.playerId,
          payload: { vote: 'lobby' }
        });
        this.render();
        break;
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

    for (const button of this.buttons) {
      if (this.isPointInRect(x, y, button)) {
        if (this.hoveredButton !== button) {
          this.hoveredButton = button;
          this.canvas.style.cursor = 'pointer';
          this.render();
        }
        foundHover = true;
        break;
      }
    }

    if (!foundHover && this.hoveredButton) {
      this.hoveredButton = null;
      this.canvas.style.cursor = 'default';
      this.render();
    }
  }

  /**
   * Handle keyboard input
   */
  handleKeyPress(event) {
    // Handle numeric input for betting
    if (event.key >= '0' && event.key <= '9') {
      this.betInput += event.key;
      this.render();
    } else if (event.key === 'Backspace') {
      this.betInput = this.betInput.slice(0, -1);
      this.render();
    } else if (event.key === 'Enter') {
      // Submit bet
      const betButton = this.buttons.find(b => b.action === 'placeBet');
      if (betButton) {
        this.handleButtonClick(betButton);
      }
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
   * Lighten a color for hover effect
   */
  lightenColor(color) {
    // Simple lightening by adding opacity overlay
    return color.replace(')', ', 0.8)').replace('rgb', 'rgba').replace('#', 'rgba(') || color;
  }

  /**
   * Show start animation
   */
  showStartAnimation() {
    const gameNames = {
      'blackjack': 'BLACKJACK',
      'texas-holdem': 'TEXAS HOLD\'EM',
      '5-card-stud': '5 CARD STUD',
      'baccarat': 'BACCARAT'
    };

    const message = gameNames[this.gameType] || this.gameType.toUpperCase();

    this.animations.push({
      type: 'startGame',
      message: message,
      startTime: Date.now(),
      duration: 2000,
      update: function() {
        this.elapsed = Date.now() - this.startTime;
      },
      render: (ctx) => {
        const anim = this.animations[this.animations.length - 1];
        if (!anim || anim.type !== 'startGame') return;

        const progress = Math.min(anim.elapsed / anim.duration, 1);
        const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;

        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.save();
        ctx.globalAlpha = alpha;

        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, width, height);

        // Draw message
        ctx.fillStyle = this.colors.gold;
        ctx.font = 'bold 64px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(anim.message, width / 2, height / 2);

        // Draw subtitle
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Arial';
        ctx.fillText('Good Luck!', width / 2, height / 2 + 60);

        ctx.restore();
      },
      isComplete: function() {
        return this.elapsed >= this.duration;
      }
    });
  }

  /**
   * Show end animation with winner
   */
  showEndAnimation(winner, payout) {
    this.animations.push({
      type: 'endGame',
      winner: winner,
      payout: payout,
      startTime: Date.now(),
      duration: 3000,
      update: function() {
        this.elapsed = Date.now() - this.startTime;
      },
      render: (ctx) => {
        const anim = this.animations.find(a => a.type === 'endGame');
        if (!anim) return;

        const progress = Math.min(anim.elapsed / anim.duration, 1);
        const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;

        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.save();
        ctx.globalAlpha = alpha;

        // Draw semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, width, height);

        // Draw winner panel
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
        this.roundRect(ctx, width / 2 - 250, height / 2 - 100, 500, 200, 15);
        ctx.fill();

        // Draw winner text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(anim.winner, width / 2, height / 2 - 20);

        // Draw payout if applicable
        if (anim.payout > 0) {
          ctx.fillStyle = '#166534';
          ctx.font = 'bold 36px Arial';
          ctx.fillText(`+${anim.payout} chips`, width / 2, height / 2 + 40);
        }

        ctx.restore();
      },
      isComplete: function() {
        return this.elapsed >= this.duration;
      }
    });
  }

  /**
   * Update game state
   */
  updateGameState(newState) {
    const oldState = this.gameState;
    this.gameState = newState;

    // Check for end game animation
    if (newState.phase === 'complete' && oldState.phase !== 'complete') {
      const results = newState.results?.[this.playerId];
      if (results) {
        const winner = results.result === 'win' ? 'YOU WIN!' :
                      results.result === 'push' ? 'PUSH' : 'DEALER WINS';
        this.showEndAnimation(winner, results.payout || 0);
      }
    }

    // Check for voting phase
    if (newState.votingPhase && !oldState.votingPhase) {
      this.votingActive = true;
      this.playerVote = null;
    }

    this.render();
  }

  /**
   * Render animations
   */
  renderAnimations() {
    this.animations = this.animations.filter(anim => {
      if (anim.update) anim.update();
      if (anim.render) anim.render(this.ctx);
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
   * Render error message
   */
  renderError(width, height, message) {
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(message, width / 2, height / 2);
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.boundHandleClick);
      this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove);
      this.canvas.removeEventListener('keypress', this.boundHandleKeyPress);
      window.removeEventListener('resize', () => this.resizeCanvas());
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.animations = [];
    this.buttons = [];
  }
}
