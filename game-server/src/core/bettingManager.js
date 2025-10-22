/**
 * BettingManager - Handles betting mechanics for casino games
 * Supports different betting types: fixed bets (Blackjack) and round-based betting (Texas Hold'em)
 */

const EventEmitter = require('events');

class BettingManager extends EventEmitter {
  constructor({ minBet = 10, maxBet = 1000, gameType = 'fixed' } = {}) {
    super();
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.gameType = gameType; // 'fixed' or 'rounds'

    // Pot management
    this.pot = 0;
    this.sidePots = [];

    // Player bets tracking
    this.playerBets = new Map(); // playerId -> currentBet
    this.playerTotalBets = new Map(); // playerId -> totalInPot
    this.playerBalances = new Map(); // playerId -> available balance
    this.playerStatus = new Map(); // playerId -> 'active'|'folded'|'allIn'

    // Round tracking (for games like Texas Hold'em)
    this.currentRound = null;
    this.currentBet = 0; // Current bet to match in this round
    this.lastRaiser = null;
  }

  /**
   * Initialize player for betting
   */
  initializePlayer(playerId, balance) {
    this.playerBets.set(playerId, 0);
    this.playerTotalBets.set(playerId, 0);
    this.playerBalances.set(playerId, balance);
    this.playerStatus.set(playerId, 'active');
    this.emit('playerInitialized', { playerId, balance });
  }

  /**
   * Get player's available balance
   */
  getPlayerBalance(playerId) {
    return this.playerBalances.get(playerId) || 0;
  }

  /**
   * Get player's current bet in the current round
   */
  getPlayerCurrentBet(playerId) {
    return this.playerBets.get(playerId) || 0;
  }

  /**
   * Get player's total contribution to the pot
   */
  getPlayerTotalBet(playerId) {
    return this.playerTotalBets.get(playerId) || 0;
  }

  /**
   * Get player's status
   */
  getPlayerStatus(playerId) {
    return this.playerStatus.get(playerId) || 'active';
  }

  /**
   * Place a bet (for fixed bet games like Blackjack)
   */
  placeBet(playerId, amount) {
    const balance = this.getPlayerBalance(playerId);

    if (amount < this.minBet) {
      return { error: `Minimum bet is ${this.minBet}` };
    }

    if (amount > this.maxBet) {
      return { error: `Maximum bet is ${this.maxBet}` };
    }

    if (amount > balance) {
      return { error: 'Insufficient balance' };
    }

    // Deduct from balance
    this.playerBalances.set(playerId, balance - amount);

    // Add to current bet
    const currentBet = this.getPlayerCurrentBet(playerId);
    this.playerBets.set(playerId, currentBet + amount);

    // Add to total bet
    const totalBet = this.getPlayerTotalBet(playerId);
    this.playerTotalBets.set(playerId, totalBet + amount);

    // Add to pot
    this.pot += amount;

    this.emit('betPlaced', { playerId, amount, newBalance: this.getPlayerBalance(playerId), pot: this.pot });

    return { success: true, balance: this.getPlayerBalance(playerId), pot: this.pot };
  }

  /**
   * Call - match the current bet (for round-based games)
   */
  call(playerId) {
    const status = this.getPlayerStatus(playerId);
    if (status !== 'active') {
      return { error: 'Player cannot call' };
    }

    const currentBet = this.getPlayerCurrentBet(playerId);
    const amountToCall = this.currentBet - currentBet;

    if (amountToCall <= 0) {
      return { error: 'No bet to call' };
    }

    const balance = this.getPlayerBalance(playerId);

    // Check if player can afford to call
    if (amountToCall > balance) {
      // All-in
      return this.allIn(playerId);
    }

    // Place the call
    this.playerBalances.set(playerId, balance - amountToCall);
    this.playerBets.set(playerId, this.currentBet);

    const totalBet = this.getPlayerTotalBet(playerId);
    this.playerTotalBets.set(playerId, totalBet + amountToCall);

    this.pot += amountToCall;

    this.emit('playerCalled', { playerId, amount: amountToCall, pot: this.pot });

    return { success: true, action: 'call', amount: amountToCall, pot: this.pot };
  }

  /**
   * Raise - increase the current bet
   */
  raise(playerId, amount) {
    const status = this.getPlayerStatus(playerId);
    if (status !== 'active') {
      return { error: 'Player cannot raise' };
    }

    const currentBet = this.getPlayerCurrentBet(playerId);
    const amountToCall = this.currentBet - currentBet;
    const totalAmount = amountToCall + amount;

    if (amount < this.minBet) {
      return { error: `Minimum raise is ${this.minBet}` };
    }

    const balance = this.getPlayerBalance(playerId);

    if (totalAmount > balance) {
      return { error: 'Insufficient balance' };
    }

    // Place the raise
    this.playerBalances.set(playerId, balance - totalAmount);
    this.playerBets.set(playerId, this.currentBet + amount);

    const totalBet = this.getPlayerTotalBet(playerId);
    this.playerTotalBets.set(playerId, totalBet + totalAmount);

    this.pot += totalAmount;
    this.currentBet += amount;
    this.lastRaiser = playerId;

    this.emit('playerRaised', { playerId, amount, totalAmount, pot: this.pot, currentBet: this.currentBet });

    return { success: true, action: 'raise', amount: totalAmount, pot: this.pot, currentBet: this.currentBet };
  }

  /**
   * Check - stay in without betting (only if no bet to match)
   */
  check(playerId) {
    const status = this.getPlayerStatus(playerId);
    if (status !== 'active') {
      return { error: 'Player cannot check' };
    }

    const currentBet = this.getPlayerCurrentBet(playerId);
    if (currentBet < this.currentBet) {
      return { error: 'Must call or fold' };
    }

    this.emit('playerChecked', { playerId });

    return { success: true, action: 'check' };
  }

  /**
   * Fold - give up and lose current bets
   */
  fold(playerId) {
    const status = this.getPlayerStatus(playerId);
    if (status !== 'active') {
      return { error: 'Player already folded or all-in' };
    }

    this.playerStatus.set(playerId, 'folded');

    this.emit('playerFolded', { playerId });

    return { success: true, action: 'fold' };
  }

  /**
   * All-in - bet all remaining balance
   */
  allIn(playerId) {
    const status = this.getPlayerStatus(playerId);
    if (status !== 'active') {
      return { error: 'Player cannot go all-in' };
    }

    const balance = this.getPlayerBalance(playerId);

    if (balance <= 0) {
      return { error: 'No balance to bet' };
    }

    // Place all remaining chips
    this.playerBalances.set(playerId, 0);

    const currentBet = this.getPlayerCurrentBet(playerId);
    this.playerBets.set(playerId, currentBet + balance);

    const totalBet = this.getPlayerTotalBet(playerId);
    this.playerTotalBets.set(playerId, totalBet + balance);

    this.pot += balance;
    this.playerStatus.set(playerId, 'allIn');

    // Update current bet if all-in is higher
    if (currentBet + balance > this.currentBet) {
      this.currentBet = currentBet + balance;
    }

    this.emit('playerAllIn', { playerId, amount: balance, pot: this.pot });

    return { success: true, action: 'allIn', amount: balance, pot: this.pot };
  }

  /**
   * Start a new betting round
   */
  startRound(roundName) {
    this.currentRound = roundName;
    this.currentBet = 0;
    this.lastRaiser = null;

    // Reset current bets for this round
    for (const playerId of this.playerBets.keys()) {
      this.playerBets.set(playerId, 0);
    }

    this.emit('roundStarted', { round: roundName, pot: this.pot });
  }

  /**
   * Payout to winner(s)
   */
  payout(winners, splitType = 'equal') {
    if (!Array.isArray(winners) || winners.length === 0) {
      return { error: 'No winners specified' };
    }

    const payouts = new Map();

    if (splitType === 'equal') {
      // Split pot equally among winners
      const amountPerWinner = Math.floor(this.pot / winners.length);
      const remainder = this.pot % winners.length;

      winners.forEach((playerId, index) => {
        const payout = amountPerWinner + (index === 0 ? remainder : 0);
        const currentBalance = this.getPlayerBalance(playerId);
        this.playerBalances.set(playerId, currentBalance + payout);
        payouts.set(playerId, payout);
      });
    } else if (splitType === 'custom') {
      // Custom payout distribution (used for side pots)
      // Winners should be an array of { playerId, amount }
      winners.forEach(({ playerId, amount }) => {
        const currentBalance = this.getPlayerBalance(playerId);
        this.playerBalances.set(playerId, currentBalance + amount);
        payouts.set(playerId, amount);
      });
    }

    const oldPot = this.pot;
    this.pot = 0;

    this.emit('payoutComplete', { winners, payouts: Array.from(payouts.entries()), oldPot });

    return { success: true, payouts: Array.from(payouts.entries()) };
  }

  /**
   * Get current pot size
   */
  getPot() {
    return this.pot;
  }

  /**
   * Get all active players
   */
  getActivePlayers() {
    const active = [];
    for (const [playerId, status] of this.playerStatus.entries()) {
      if (status === 'active' || status === 'allIn') {
        active.push(playerId);
      }
    }
    return active;
  }

  /**
   * Get all players who haven't folded
   */
  getPlayersInHand() {
    const inHand = [];
    for (const [playerId, status] of this.playerStatus.entries()) {
      if (status !== 'folded') {
        inHand.push(playerId);
      }
    }
    return inHand;
  }

  /**
   * Check if betting round is complete
   */
  isRoundComplete() {
    const activePlayers = this.getActivePlayers();

    if (activePlayers.length <= 1) {
      return true;
    }

    // All active players must have matched the current bet
    for (const playerId of activePlayers) {
      const status = this.getPlayerStatus(playerId);
      if (status === 'allIn') continue; // All-in players don't need to match

      const currentBet = this.getPlayerCurrentBet(playerId);
      if (currentBet < this.currentBet) {
        return false;
      }
    }

    return true;
  }

  /**
   * Reset betting manager for new game
   */
  reset() {
    this.pot = 0;
    this.sidePots = [];
    this.currentRound = null;
    this.currentBet = 0;
    this.lastRaiser = null;

    // Reset player bets but keep balances
    for (const playerId of this.playerBets.keys()) {
      this.playerBets.set(playerId, 0);
      this.playerTotalBets.set(playerId, 0);
      this.playerStatus.set(playerId, 'active');
    }

    this.emit('reset');
  }

  /**
   * Get betting state snapshot
   */
  getState() {
    return {
      pot: this.pot,
      currentBet: this.currentBet,
      currentRound: this.currentRound,
      minBet: this.minBet,
      maxBet: this.maxBet,
      players: Array.from(this.playerBalances.keys()).map(playerId => ({
        id: playerId,
        balance: this.getPlayerBalance(playerId),
        currentBet: this.getPlayerCurrentBet(playerId),
        totalBet: this.getPlayerTotalBet(playerId),
        status: this.getPlayerStatus(playerId)
      }))
    };
  }
}

module.exports = {
  BettingManager
};
