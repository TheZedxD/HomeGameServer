/**
 * Blackjack Plugin
 * Classic casino card game
 * Players: 1-7 (vs dealer)
 */

const { buildGameInstance, VotingStrategy } = require('../../core');
const { BettingManager } = require('../../core/bettingManager');
const { createDeck, shuffle, getCardDisplayName } = require('../war/cardUtils');

/**
 * Calculate hand value in Blackjack
 */
function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Adjust for aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

/**
 * Check if hand is blackjack (21 with 2 cards)
 */
function isBlackjack(hand) {
  return hand.length === 2 && calculateHandValue(hand) === 21;
}

/**
 * Check if hand is bust
 */
function isBust(hand) {
  return calculateHandValue(hand) > 21;
}

/**
 * Strategy for placing initial bet
 */
class PlaceBetStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    const { amount } = payload;
    const bettingManager = state._bettingManager;

    if (!amount || amount <= 0) {
      return { error: 'Invalid bet amount' };
    }

    if (state.phase !== 'betting') {
      return { error: 'Not in betting phase' };
    }

    if (state.playerBets[playerId] > 0) {
      return { error: 'Bet already placed' };
    }

    const result = bettingManager.placeBet(playerId, amount);

    if (result.error) {
      return result;
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        next.playerBets[playerId] = amount;
        next.pot = result.pot;

        // Check if all players have bet
        const allBet = next.playerOrder.every(pid => next.playerBets[pid] > 0);

        if (allBet) {
          // Deal initial cards
          next.phase = 'playing';

          // Deal 2 cards to each player
          next.playerOrder.forEach(pid => {
            next.hands[pid] = [
              { ...next.deck.shift(), faceUp: true },
              { ...next.deck.shift(), faceUp: true }
            ];
            next.handValues[pid] = calculateHandValue(next.hands[pid]);
            next.playerStatuses[pid] = 'playing';

            // Check for blackjack
            if (isBlackjack(next.hands[pid])) {
              next.playerStatuses[pid] = 'blackjack';
            }
          });

          // Deal 2 cards to dealer (one face down)
          next.dealerHand = [
            { ...next.deck.shift(), faceUp: true },
            { ...next.deck.shift(), faceUp: false }
          ];

          // Set first player as current
          next.currentPlayerId = next.playerOrder[0];

          // Skip player if they have blackjack
          while (next.currentPlayerId && next.playerStatuses[next.currentPlayerId] === 'blackjack') {
            const currentIndex = next.playerOrder.indexOf(next.currentPlayerId);
            if (currentIndex >= next.playerOrder.length - 1) {
              next.currentPlayerId = null;
              break;
            }
            next.currentPlayerId = next.playerOrder[currentIndex + 1];
          }

          // If no current player, move to dealer
          if (!next.currentPlayerId) {
            next.phase = 'dealer';
          }
        }

        return next;
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }
}

/**
 * Strategy for player actions (hit, stand, double, split)
 */
class PlayerActionStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    const { action } = payload;

    if (state.phase !== 'playing') {
      return { error: 'Not in playing phase' };
    }

    if (state.currentPlayerId !== playerId) {
      return { error: 'Not your turn' };
    }

    const bettingManager = state._bettingManager;

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        switch (action) {
          case 'hit':
            // Draw a card
            next.hands[playerId].push({ ...next.deck.shift(), faceUp: true });
            next.handValues[playerId] = calculateHandValue(next.hands[playerId]);

            // Check if bust
            if (isBust(next.hands[playerId])) {
              next.playerStatuses[playerId] = 'bust';
              return this.moveToNextPlayer(next);
            }
            break;

          case 'stand':
            next.playerStatuses[playerId] = 'stand';
            return this.moveToNextPlayer(next);

          case 'double':
            // Double the bet
            const currentBet = next.playerBets[playerId];
            const balance = bettingManager.getPlayerBalance(playerId);

            if (currentBet > balance) {
              return current; // Can't double, insufficient funds
            }

            bettingManager.placeBet(playerId, currentBet);
            next.playerBets[playerId] = currentBet * 2;
            next.pot = bettingManager.getPot();

            // Draw one card and stand
            next.hands[playerId].push({ ...next.deck.shift(), faceUp: true });
            next.handValues[playerId] = calculateHandValue(next.hands[playerId]);

            if (isBust(next.hands[playerId])) {
              next.playerStatuses[playerId] = 'bust';
            } else {
              next.playerStatuses[playerId] = 'stand';
            }

            return this.moveToNextPlayer(next);

          default:
            return current;
        }

        return next;
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }

  moveToNextPlayer(state) {
    const currentIndex = state.playerOrder.indexOf(state.currentPlayerId);

    // Move to next player
    if (currentIndex < state.playerOrder.length - 1) {
      state.currentPlayerId = state.playerOrder[currentIndex + 1];

      // Skip if player already finished
      while (state.currentPlayerId &&
             ['stand', 'bust', 'blackjack'].includes(state.playerStatuses[state.currentPlayerId])) {
        const nextIndex = state.playerOrder.indexOf(state.currentPlayerId);
        if (nextIndex >= state.playerOrder.length - 1) {
          state.currentPlayerId = null;
          break;
        }
        state.currentPlayerId = state.playerOrder[nextIndex + 1];
      }
    } else {
      state.currentPlayerId = null;
    }

    // If no more players, dealer plays
    if (!state.currentPlayerId) {
      return this.dealerPlay(state);
    }

    return state;
  }

  dealerPlay(state) {
    state.phase = 'dealer';

    // Flip dealer's hole card
    state.dealerHand[1].faceUp = true;

    // Dealer must hit on 16 or less, stand on 17 or more
    let dealerValue = calculateHandValue(state.dealerHand);

    while (dealerValue < 17) {
      state.dealerHand.push({ ...state.deck.shift(), faceUp: true });
      dealerValue = calculateHandValue(state.dealerHand);
    }

    // Determine winners
    return this.determineWinners(state);
  }

  determineWinners(state) {
    const dealerValue = calculateHandValue(state.dealerHand);
    const dealerBust = isBust(state.dealerHand);
    const dealerBlackjack = isBlackjack(state.dealerHand);

    const bettingManager = state._bettingManager;
    const results = {};

    state.playerOrder.forEach(playerId => {
      const playerHand = state.hands[playerId];
      const playerValue = state.handValues[playerId];
      const playerBet = state.playerBets[playerId];
      const playerStatus = state.playerStatuses[playerId];

      let result = 'lose';
      let payout = 0;

      if (playerStatus === 'bust') {
        // Player busts, loses bet
        result = 'lose';
      } else if (playerStatus === 'blackjack') {
        if (dealerBlackjack) {
          // Push
          result = 'push';
          payout = playerBet;
        } else {
          // Player wins 3:2
          result = 'blackjack';
          payout = playerBet + Math.floor(playerBet * 1.5);
        }
      } else if (dealerBust) {
        // Dealer busts, player wins
        result = 'win';
        payout = playerBet * 2;
      } else if (playerValue > dealerValue) {
        // Player has higher value
        result = 'win';
        payout = playerBet * 2;
      } else if (playerValue === dealerValue) {
        // Push
        result = 'push';
        payout = playerBet;
      } else {
        // Dealer wins
        result = 'lose';
      }

      results[playerId] = { result, payout, playerValue, dealerValue };

      // Update balance
      if (payout > 0) {
        const currentBalance = bettingManager.getPlayerBalance(playerId);
        bettingManager.playerBalances.set(playerId, currentBalance + payout);
      }

      state.finalBalances[playerId] = bettingManager.getPlayerBalance(playerId);
    });

    state.results = results;
    state.dealerValue = dealerValue;
    state.phase = 'complete';
    state.isComplete = true;

    return state;
  }
}

/**
 * Register Blackjack
 */
module.exports = {
  register(registry) {
    return registry.register({
      id: 'blackjack',
      name: 'Blackjack',
      minPlayers: 1,
      maxPlayers: 7,
      version: '1.0.0',
      description: 'Classic casino blackjack - beat the dealer!',
      category: 'casino',
      isCasino: true,
      minBet: 10,
      maxBet: 1000,

      create({ roomId, players = [], initialBalances = {} }) {
        // Create and shuffle deck (using multiple decks for blackjack)
        let deck = [];
        for (let i = 0; i < 6; i++) {
          deck = deck.concat(createDeck());
        }
        deck = shuffle(deck);

        // Initialize betting manager
        const bettingManager = new BettingManager({
          minBet: 10,
          maxBet: 1000,
          gameType: 'fixed'
        });

        // Create game instance
        const game = buildGameInstance({
          id: 'blackjack',
          minPlayers: 1,
          maxPlayers: 7,
          initialState: {
            roomId,
            gameType: 'blackjack',
            phase: 'betting', // betting, playing, dealer, complete
            hands: {},
            handValues: {},
            dealerHand: [],
            dealerValue: 0,
            deck: deck,
            pot: 0,
            minBet: 10,
            maxBet: 1000,
            playerBets: {},
            playerStatuses: {},
            players: {},
            playerOrder: [],
            currentPlayerId: null,
            isComplete: false,
            results: {},
            finalBalances: {},
            _bettingManager: bettingManager
          },
          strategies: {
            placeBet: new PlaceBetStrategy(),
            action: new PlayerActionStrategy(),
            vote: new VotingStrategy()
          }
        });

        // Initialize players
        players.forEach((player, index) => {
          game.playerManager.add(player);
          const state = game.getState();

          state.hands[player.id] = [];
          state.handValues[player.id] = 0;
          state.playerBets[player.id] = 0;
          state.playerStatuses[player.id] = 'waiting';
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

        // Listen for game completion
        game.stateManager.on('stateChanged', ({ current }) => {
          if (current.isComplete) {
            const winnings = {};

            current.playerOrder.forEach(playerId => {
              const result = current.results[playerId];
              if (result) {
                const initialBalance = initialBalances[playerId] || 1000;
                winnings[playerId] = current.finalBalances[playerId] - initialBalance;
              }
            });

            game.emit('roundEnd', {
              results: current.results,
              winnings,
              dealerValue: current.dealerValue,
              outcome: 'complete'
            });
          }
        });

        return game;
      }
    });
  }
};
