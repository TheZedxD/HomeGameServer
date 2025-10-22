/**
 * Texas Hold'em Poker Plugin
 * Classic casino poker game with betting rounds
 * Players: 2-9
 */

const { buildGameInstance } = require('../../core');
const { BettingManager } = require('../../core/bettingManager');
const { createDeck, shuffle, getCardDisplayName } = require('../war/cardUtils');
const { evaluateHand, determineWinners } = require('./pokerUtils');

/**
 * Betting rounds in Texas Hold'em
 */
const BETTING_ROUNDS = {
  PRE_FLOP: 'pre-flop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
};

/**
 * Strategy for placing bets
 */
class BetStrategy {
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

        // Update player statuses
        next.playerOrder.forEach(pid => {
          const status = bettingManager.getPlayerStatus(pid);
          next.playerStatuses[pid] = status;
          next.playerBets[pid] = bettingManager.getPlayerCurrentBet(pid);
        });

        // Check if we need to move to next player or next round
        const activePlayers = bettingManager.getActivePlayers();
        const playersInHand = bettingManager.getPlayersInHand();

        if (playersInHand.length === 1) {
          // Only one player left, they win
          next.isComplete = true;
          next.winnerId = playersInHand[0];
          const winner = playerManager.get(playersInHand[0]);
          next.winner = winner.displayName;
          return next;
        }

        if (bettingManager.isRoundComplete()) {
          // Move to next betting round
          return this.advanceRound(next, playerManager, bettingManager);
        } else {
          // Move to next active player
          return this.moveToNextPlayer(next, bettingManager);
        }
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }

  moveToNextPlayer(state, bettingManager) {
    const activePlayers = bettingManager.getActivePlayers();
    const currentIndex = activePlayers.indexOf(state.currentPlayerId);
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    state.currentPlayerId = activePlayers[nextIndex];
    return state;
  }

  advanceRound(state, playerManager, bettingManager) {
    const roundOrder = [
      BETTING_ROUNDS.PRE_FLOP,
      BETTING_ROUNDS.FLOP,
      BETTING_ROUNDS.TURN,
      BETTING_ROUNDS.RIVER,
      BETTING_ROUNDS.SHOWDOWN
    ];

    const currentIndex = roundOrder.indexOf(state.bettingRound);
    const nextRound = roundOrder[currentIndex + 1];

    if (!nextRound) {
      // Game should be over
      state.isComplete = true;
      return state;
    }

    state.bettingRound = nextRound;

    // Deal community cards
    switch (nextRound) {
      case BETTING_ROUNDS.FLOP:
        // Burn one, deal 3
        state.deck.shift();
        state.communityCards.push(
          { ...state.deck.shift(), faceUp: true },
          { ...state.deck.shift(), faceUp: true },
          { ...state.deck.shift(), faceUp: true }
        );
        break;

      case BETTING_ROUNDS.TURN:
        // Burn one, deal 1
        state.deck.shift();
        state.communityCards.push({ ...state.deck.shift(), faceUp: true });
        break;

      case BETTING_ROUNDS.RIVER:
        // Burn one, deal 1
        state.deck.shift();
        state.communityCards.push({ ...state.deck.shift(), faceUp: true });
        break;

      case BETTING_ROUNDS.SHOWDOWN:
        // Determine winner
        return this.showdown(state, playerManager, bettingManager);
    }

    // Start new betting round
    bettingManager.startRound(nextRound);

    // Reset to first active player (after dealer button)
    const activePlayers = bettingManager.getActivePlayers();
    if (activePlayers.length > 0) {
      state.currentPlayerId = activePlayers[0];
    }

    // Reset player bets for display
    state.playerOrder.forEach(pid => {
      state.playerBets[pid] = 0;
    });

    return state;
  }

  showdown(state, playerManager, bettingManager) {
    // Get all players still in hand
    const playersInHand = bettingManager.getPlayersInHand();

    // Evaluate hands
    const playerHands = playersInHand.map(playerId => {
      const hand = state.hands[playerId] || [];
      const cards = [...hand, ...state.communityCards];
      return {
        playerId,
        cards,
        evaluation: evaluateHand(cards)
      };
    });

    // Determine winner(s)
    const { winners, bestHand } = determineWinners(playerHands.map(ph => ({
      playerId: ph.playerId,
      cards: ph.cards
    })));

    // Payout
    bettingManager.payout(winners, 'equal');

    state.winners = winners;
    state.winningHand = bestHand;
    state.isComplete = true;
    state.bettingRound = BETTING_ROUNDS.SHOWDOWN;

    // Store final balances
    state.playerOrder.forEach(pid => {
      state.finalBalances[pid] = bettingManager.getPlayerBalance(pid);
    });

    return state;
  }
}

/**
 * Register Texas Hold'em
 */
module.exports = {
  register(registry) {
    return registry.register({
      id: 'texas-holdem',
      name: 'Texas Hold\'em',
      minPlayers: 2,
      maxPlayers: 9,
      version: '1.0.0',
      description: 'Classic Texas Hold\'em poker with betting',
      category: 'casino',
      isCasino: true,
      minBet: 10,
      maxBet: 1000,

      create({ roomId, players = [], initialBalances = {} }) {
        // Create and shuffle deck
        const deck = shuffle(createDeck());

        // Initialize betting manager
        const bettingManager = new BettingManager({
          minBet: 10,
          maxBet: 1000,
          gameType: 'rounds'
        });

        // Deal hole cards (2 per player)
        const hands = {};
        players.forEach(player => {
          hands[player.id] = [
            { ...deck.shift(), faceUp: false },
            { ...deck.shift(), faceUp: false }
          ];
        });

        // Create game instance
        const game = buildGameInstance({
          id: 'texas-holdem',
          minPlayers: 2,
          maxPlayers: 9,
          initialState: {
            roomId,
            gameType: 'texas-holdem',
            hands: {},
            communityCards: [],
            deck: deck,
            pot: 0,
            currentBet: 0,
            minBet: 10,
            maxBet: 1000,
            playerBets: {},
            playerStatuses: {},
            players: {},
            playerOrder: [],
            dealerIndex: 0,
            currentPlayerId: null,
            bettingRound: BETTING_ROUNDS.PRE_FLOP,
            isComplete: false,
            winners: null,
            winningHand: null,
            lastAction: null,
            finalBalances: {},
            _bettingManager: bettingManager
          },
          strategies: {
            bet: new BetStrategy()
          }
        });

        // Initialize players
        players.forEach((player, index) => {
          game.getPlayerManager().add(player);
          const state = game.getState();

          state.hands[player.id] = hands[player.id];
          state.playerBets[player.id] = 0;
          state.playerStatuses[player.id] = 'active';
          state.players[player.id] = {
            id: player.id,
            displayName: player.displayName,
            index
          };
          state.playerOrder.push(player.id);
          state.finalBalances[player.id] = 0;

          // Initialize betting manager for player
          const balance = initialBalances[player.id] || 1000;
          bettingManager.initializePlayer(player.id, balance);
        });

        // Post blinds
        const state = game.getState();
        if (state.playerOrder.length >= 2) {
          const smallBlindIndex = (state.dealerIndex + 1) % state.playerOrder.length;
          const bigBlindIndex = (state.dealerIndex + 2) % state.playerOrder.length;

          const smallBlindId = state.playerOrder[smallBlindIndex];
          const bigBlindId = state.playerOrder[bigBlindIndex];

          // Post small blind (5)
          bettingManager.placeBet(smallBlindId, 5);
          state.playerBets[smallBlindId] = 5;

          // Post big blind (10)
          bettingManager.placeBet(bigBlindId, 10);
          state.playerBets[bigBlindId] = 10;

          // Update pot
          state.pot = bettingManager.getPot();
          state.currentBet = 10;

          // Start with player after big blind
          const firstPlayerIndex = (bigBlindIndex + 1) % state.playerOrder.length;
          state.currentPlayerId = state.playerOrder[firstPlayerIndex];
        }

        // Listen for game completion
        game.getStateManager().on('stateChanged', ({ current }) => {
          if (current.isComplete) {
            const winners = Array.isArray(current.winners) ? current.winners : [current.winnerId];
            const winnings = {};

            winners.forEach(winnerId => {
              winnings[winnerId] = current.finalBalances[winnerId] - (initialBalances[winnerId] || 1000);
            });

            game.emit('roundEnd', {
              winners,
              winnings,
              pot: current.pot,
              winningHand: current.winningHand,
              outcome: 'complete'
            });
          }
        });

        return game;
      }
    });
  }
};
