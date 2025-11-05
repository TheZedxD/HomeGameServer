/**
 * Baccarat Plugin
 * Classic casino card game - Player vs Banker
 * Players: 1-8 (all betting on same hand)
 */

const { buildGameInstance, VotingStrategy } = require('../../core');
const { BettingManager } = require('../../core/bettingManager');
const { createDeck, shuffle } = require('../../shared/cardUtils');

/**
 * Calculate Baccarat hand value (modulo 10)
 */
function calculateBaccaratValue(cards) {
  const sum = cards.reduce((total, card) => {
    let value;
    if (card.rank === 'A') {
      value = 1;
    } else if (['J', 'Q', 'K', '10'].includes(card.rank)) {
      value = 0;
    } else {
      value = parseInt(card.rank);
    }
    return total + value;
  }, 0);

  return sum % 10;
}

/**
 * Determine if third card should be drawn (Baccarat rules)
 */
function shouldDrawThirdCard(playerHand, bankerHand, playerValue, bankerValue) {
  const result = {
    playerDraws: false,
    bankerDraws: false
  };

  // Natural win (8 or 9)
  if (playerValue >= 8 || bankerValue >= 8) {
    return result;
  }

  // Player draws if 0-5
  if (playerValue <= 5) {
    result.playerDraws = true;
  }

  // Banker drawing rules (complex)
  if (!result.playerDraws) {
    // Player stands, banker draws on 0-5
    if (bankerValue <= 5) {
      result.bankerDraws = true;
    }
  } else {
    // Player drew, banker follows complex rules
    if (bankerValue <= 2) {
      result.bankerDraws = true;
    } else if (bankerValue === 3) {
      // Banker draws unless player's third card was 8
      result.bankerDraws = true; // Simplified for now
    } else if (bankerValue === 4) {
      // Banker draws if player's third card was 2-7
      result.bankerDraws = true; // Simplified
    } else if (bankerValue === 5) {
      // Banker draws if player's third card was 4-7
      result.bankerDraws = true; // Simplified
    } else if (bankerValue === 6) {
      // Banker draws if player's third card was 6-7
      result.bankerDraws = false; // Usually stands
    }
  }

  return result;
}

/**
 * Strategy for placing bets in Baccarat
 */
class BaccaratBetStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    if (state.phase !== 'betting') {
      return { error: 'Not betting phase' };
    }

    const { amount, betType } = payload;
    const bettingManager = state._bettingManager;

    if (!bettingManager) {
      return { error: 'Betting manager not initialized' };
    }

    if (!amount || amount <= 0) {
      return { error: 'Invalid bet amount' };
    }

    if (!['player', 'banker', 'tie'].includes(betType)) {
      return { error: 'Invalid bet type. Must be player, banker, or tie' };
    }

    // Place bet
    const result = bettingManager.placeBet(playerId, amount);
    if (result.error) {
      return result;
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        // Record bet type
        next.playerBets[playerId] = amount;
        next.betTypes[playerId] = betType;

        // Update pot
        next.pot = bettingManager.getPot();

        // Check if all players have bet
        const allBet = next.playerOrder.every(pid => next.playerBets[pid] > 0);

        if (allBet) {
          // Start the game
          dealInitialCards(next);
          evaluateHands(next, bettingManager, playerManager);
        }

        return next;
      },
      getUndo() {
        return { error: 'Undo not supported in baccarat' };
      }
    };
  }
}

/**
 * Deal initial two cards to player and banker
 */
function dealInitialCards(state) {
  state.phase = 'dealing';

  // Deal 2 cards to player
  state.playerHand = [
    { ...state.deck.shift(), faceUp: true },
    { ...state.deck.shift(), faceUp: true }
  ];

  // Deal 2 cards to banker
  state.bankerHand = [
    { ...state.deck.shift(), faceUp: true },
    { ...state.deck.shift(), faceUp: true }
  ];

  // Calculate values
  state.playerValue = calculateBaccaratValue(state.playerHand);
  state.bankerValue = calculateBaccaratValue(state.bankerHand);
}

/**
 * Evaluate hands and determine winner
 */
function evaluateHands(state, bettingManager, playerManager) {
  let playerValue = state.playerValue;
  let bankerValue = state.bankerValue;

  // Check for natural (8 or 9)
  const playerNatural = playerValue >= 8;
  const bankerNatural = bankerValue >= 8;

  if (!playerNatural && !bankerNatural) {
    // Determine if third cards should be drawn
    const thirdCardRules = shouldDrawThirdCard(
      state.playerHand,
      state.bankerHand,
      playerValue,
      bankerValue
    );

    // Draw third card for player if needed
    if (thirdCardRules.playerDraws && state.deck.length > 0) {
      const thirdCard = { ...state.deck.shift(), faceUp: true };
      state.playerHand.push(thirdCard);
      playerValue = calculateBaccaratValue(state.playerHand);
      state.playerValue = playerValue;
    }

    // Draw third card for banker if needed
    if (thirdCardRules.bankerDraws && state.deck.length > 0) {
      const thirdCard = { ...state.deck.shift(), faceUp: true };
      state.bankerHand.push(thirdCard);
      bankerValue = calculateBaccaratValue(state.bankerHand);
      state.bankerValue = bankerValue;
    }
  }

  // Determine winner
  let winner;
  if (playerValue > bankerValue) {
    winner = 'player';
  } else if (bankerValue > playerValue) {
    winner = 'banker';
  } else {
    winner = 'tie';
  }

  state.winner = winner;
  state.phase = 'complete';

  // Calculate payouts
  state.results = {};
  state.finalBalances = {};

  state.playerOrder.forEach(pid => {
    const betType = state.betTypes[pid];
    const betAmount = state.playerBets[pid];
    let payout = 0;

    if (betType === winner) {
      if (betType === 'player') {
        payout = betAmount * 2; // 1:1 (bet + winnings)
      } else if (betType === 'banker') {
        payout = betAmount * 1.95; // 1:1 minus 5% commission
      } else if (betType === 'tie') {
        payout = betAmount * 9; // 8:1 (bet + winnings)
      }
      bettingManager.adjustBalance(pid, payout - betAmount); // Adjust by profit only
    } else {
      // Lost bet (already taken from balance)
      payout = 0;
    }

    state.results[pid] = {
      result: betType === winner ? 'win' : 'lose',
      betType: betType,
      payout: payout,
      profit: payout - betAmount
    };

    state.finalBalances[pid] = bettingManager.getPlayerBalance(pid);
  });

  state.isComplete = true;
}

/**
 * Initialize game state
 */
function initializeGame({ playerOrder, initialBalances }) {
  const deck = shuffle(createDeck());
  const bettingManager = new BettingManager(playerOrder, initialBalances, 10, 1000, 'fixed');

  return {
    gameType: 'baccarat',
    phase: 'betting',
    deck,
    playerHand: [],
    bankerHand: [],
    playerValue: 0,
    bankerValue: 0,
    playerOrder,
    playerBets: playerOrder.reduce((acc, pid) => ({ ...acc, [pid]: 0 }), {}),
    betTypes: playerOrder.reduce((acc, pid) => ({ ...acc, [pid]: null }), {}),
    pot: 0,
    winner: null,
    results: null,
    finalBalances: null,
    isComplete: false,
    _bettingManager: bettingManager
  };
}

/**
 * Register the game plugin
 */
module.exports = {
  register: (registry) => {
    return registry.register({
      id: 'baccarat',
      name: 'Baccarat',
      description: 'Classic casino card game - bet on Player, Banker, or Tie!',
      category: 'casino',
      isCasino: true,
      minPlayers: 1,
      maxPlayers: 8,
      minBet: 10,
      maxBet: 1000,
      create({ roomId, players, initialBalances }) {
        const instance = buildGameInstance({
          gameId: 'baccarat',
          initialState: initializeGame({
            playerOrder: players.map(p => p.id),
            initialBalances
          })
        });

        // Register strategies
        instance.registerStrategy('placeBet', new BaccaratBetStrategy());
        instance.registerStrategy('vote', new VotingStrategy());

        return instance;
      }
    });
  }
};
