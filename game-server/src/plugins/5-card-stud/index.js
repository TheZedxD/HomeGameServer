/**
 * 5 Card Stud Poker Plugin
 * Classic stud poker game with visible cards
 * Players: 2-8
 */

const { buildGameInstance, VotingStrategy } = require('../../core');
const { BettingManager } = require('../../core/bettingManager');
const { createDeck, shuffle, getCardDisplayName } = require('../../shared/cardUtils');
const { evaluateHand, determineWinners } = require('../texas-holdem/pokerUtils');

/**
 * Streets in 5 Card Stud
 */
const STREETS = {
  FIRST: 'first',      // 1 down, 1 up
  THIRD: 'third',      // 1 up (total 3 cards)
  FOURTH: 'fourth',    // 1 up (total 4 cards)
  FIFTH: 'fifth',      // 1 up (total 5 cards)
  SHOWDOWN: 'showdown'
};

/**
 * Strategy for poker betting actions
 */
class PokerBetStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    const { action, amount } = payload;
    const bettingManager = state._bettingManager;

    if (!bettingManager) {
      return { error: 'Betting manager not initialized' };
    }

    // Validate it's player's turn
    if (state.currentPlayerId !== playerId) {
      return { error: 'Not your turn' };
    }

    let result;

    switch (action) {
      case 'call':
        result = bettingManager.call(playerId);
        break;
      case 'raise':
        if (!amount || amount <= 0) {
          return { error: 'Invalid raise amount' };
        }
        result = bettingManager.raise(playerId, amount);
        break;
      case 'check':
        result = bettingManager.check(playerId);
        break;
      case 'fold':
        result = bettingManager.fold(playerId);
        break;
      case 'allIn':
        result = bettingManager.allIn(playerId);
        break;
      default:
        return { error: 'Invalid action' };
    }

    if (result.error) {
      return result;
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        // Update last action
        next.lastAction = {
          playerId,
          playerName: player.displayName,
          action: result.action,
          amount: result.amount || 0
        };

        // Update betting state from manager
        const bettingState = bettingManager.getState();
        next.pot = bettingState.pot;
        next.currentBet = bettingState.currentBet;

        // Update player statuses and bets
        next.playerOrder.forEach(pid => {
          const status = bettingManager.getPlayerStatus(pid);
          next.playerStatuses[pid] = status;
          next.playerBets[pid] = bettingManager.getPlayerCurrentBet(pid);
        });

        // Check if betting round is complete
        const activePlayers = bettingManager.getActivePlayers();
        const playersInHand = bettingManager.getPlayersInHand();

        if (playersInHand.length === 1) {
          // Only one player left, they win
          return completeGame(next, bettingManager, playerManager, playersInHand[0]);
        }

        if (bettingManager.isRoundComplete()) {
          // Move to next street
          return advanceStreet(next, bettingManager);
        } else {
          // Move to next active player
          moveToNextPlayer(next, bettingManager);
        }

        return next;
      },
      getUndo() {
        return { error: 'Undo not supported in poker' };
      }
    };
  }
}

/**
 * Move to next active player
 */
function moveToNextPlayer(state, bettingManager) {
  const activePlayers = bettingManager.getActivePlayers();
  const currentIndex = activePlayers.indexOf(state.currentPlayerId);
  const nextIndex = (currentIndex + 1) % activePlayers.length;
  state.currentPlayerId = activePlayers[nextIndex];
}

/**
 * Advance to next street
 */
function advanceStreet(state, bettingManager) {
  const streetOrder = [STREETS.FIRST, STREETS.THIRD, STREETS.FOURTH, STREETS.FIFTH, STREETS.SHOWDOWN];
  const currentStreetIndex = streetOrder.indexOf(state.street);

  if (currentStreetIndex < streetOrder.length - 1) {
    const nextStreet = streetOrder[currentStreetIndex + 1];
    state.street = nextStreet;

    if (nextStreet === STREETS.SHOWDOWN) {
      // Evaluate hands and determine winner
      return evaluateShowdown(state, bettingManager);
    } else {
      // Deal next card and start new betting round
      dealNextCard(state);
      bettingManager.startNewRound();

      // Set first player to act
      const playersInHand = bettingManager.getPlayersInHand();
      state.currentPlayerId = determineFirstToAct(state, playersInHand);
    }
  }

  return state;
}

/**
 * Deal next card face up to all active players
 */
function dealNextCard(state) {
  const playersInHand = state._bettingManager.getPlayersInHand();

  playersInHand.forEach(pid => {
    if (state.hands[pid] && state.deck.length > 0) {
      const card = { ...state.deck.shift(), faceUp: true };
      state.hands[pid].push(card);
    }
  });
}

/**
 * Determine which player acts first (player with highest showing cards)
 */
function determineFirstToAct(state, playersInHand) {
  let highestPlayer = playersInHand[0];
  let highestValue = getVisibleHandValue(state.hands[highestPlayer]);

  playersInHand.forEach(pid => {
    const value = getVisibleHandValue(state.hands[pid]);
    if (value > highestValue) {
      highestValue = value;
      highestPlayer = pid;
    }
  });

  return highestPlayer;
}

/**
 * Get value of visible (face-up) cards
 */
function getVisibleHandValue(hand) {
  const visibleCards = hand.filter(c => c.faceUp);
  const ranks = visibleCards.map(c => {
    const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    return values[c.rank] || 0;
  });
  return ranks.reduce((sum, r) => sum + r, 0);
}

/**
 * Evaluate showdown
 */
function evaluateShowdown(state, bettingManager) {
  const playersInHand = bettingManager.getPlayersInHand();

  // Evaluate each player's hand
  const handEvaluations = {};
  playersInHand.forEach(pid => {
    const hand = state.hands[pid] || [];
    handEvaluations[pid] = evaluateHand(hand);
  });

  // Determine winners
  const winners = determineWinners(handEvaluations);

  // Payout
  const payout = bettingManager.payout(winners, 'equal');

  // Update state
  state.phase = 'complete';
  state.winners = winners;
  state.handEvaluations = handEvaluations;
  state.results = {};

  winners.forEach(pid => {
    state.results[pid] = {
      result: 'win',
      payout: payout[pid] || 0,
      hand: handEvaluations[pid]
    };
  });

  // Record final balances
  state.finalBalances = {};
  state.playerOrder.forEach(pid => {
    state.finalBalances[pid] = bettingManager.getPlayerBalance(pid);
  });

  state.isComplete = true;

  return state;
}

/**
 * Complete game with single winner (all others folded)
 */
function completeGame(state, bettingManager, playerManager, winnerId) {
  const winner = playerManager.get(winnerId);
  const payout = bettingManager.payout([winnerId], 'equal');

  state.phase = 'complete';
  state.winners = [winnerId];
  state.results = {
    [winnerId]: {
      result: 'win',
      payout: payout[winnerId] || 0
    }
  };

  state.finalBalances = {};
  state.playerOrder.forEach(pid => {
    state.finalBalances[pid] = bettingManager.getPlayerBalance(pid);
  });

  state.isComplete = true;

  return state;
}

/**
 * Initialize game state
 */
function initializeGame({ playerOrder, initialBalances }) {
  const deck = shuffle(createDeck());
  const bettingManager = new BettingManager(playerOrder, initialBalances, 10, 1000, 'rounds');

  // Deal initial cards: 1 down, 1 up
  const hands = {};
  playerOrder.forEach(pid => {
    hands[pid] = [
      { ...deck.shift(), faceUp: false },  // Hole card (face down)
      { ...deck.shift(), faceUp: true }    // Door card (face up)
    ];
  });

  // Determine first player (highest door card)
  const firstPlayer = determineFirstToAct({ hands }, playerOrder);

  return {
    gameType: '5-card-stud',
    phase: 'playing',
    street: STREETS.FIRST,
    deck,
    hands,
    playerOrder,
    playerStatuses: playerOrder.reduce((acc, pid) => ({ ...acc, [pid]: 'active' }), {}),
    playerBets: playerOrder.reduce((acc, pid) => ({ ...acc, [pid]: 0 }), {}),
    pot: 0,
    currentBet: 0,
    currentPlayerId: firstPlayer,
    lastAction: null,
    winners: null,
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
      id: '5-card-stud',
      name: '5 Card Stud',
      description: 'Classic stud poker - bet on visible cards!',
      category: 'casino',
      isCasino: true,
      minPlayers: 2,
      maxPlayers: 8,
      minBet: 10,
      maxBet: 1000,
      create({ roomId, players, initialBalances }) {
        const instance = buildGameInstance({
          gameId: '5-card-stud',
          initialState: initializeGame({
            playerOrder: players.map(p => p.id),
            initialBalances
          })
        });

        // Register strategies
        instance.registerStrategy('pokerAction', new PokerBetStrategy());
        instance.registerStrategy('vote', new VotingStrategy());

        return instance;
      }
    });
  }
};
