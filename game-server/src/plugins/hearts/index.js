/**
 * Hearts Card Game Plugin
 * Classic 4-player trick-taking game
 * Objective: Avoid taking hearts (1 point each) and the Queen of Spades (13 points)
 * Lowest score wins!
 */

const { buildGameInstance } = require('../../core');
const {
  createDeck,
  shuffle,
  dealCards,
  getCardDisplayName,
  SUITS
} = require('./cardUtils');

/**
 * Strategy for playing a card in Hearts
 */
class PlayCardStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    // Check if it's player's turn
    if (state.currentPlayerId !== playerId) {
      return { error: 'Not your turn' };
    }

    const { cardId } = payload;
    if (cardId === undefined) {
      return { error: 'No card specified' };
    }

    const hand = state.hands[playerId];
    if (!hand || hand.length === 0) {
      return { error: 'No cards in hand' };
    }

    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      return { error: 'Card not in hand' };
    }

    const card = hand[cardIndex];

    // Validate card play
    const validation = this.validatePlay(state, playerId, card);
    if (validation.error) {
      return validation;
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        // Remove card from player's hand
        next.hands[playerId] = next.hands[playerId].filter(c => c.id !== cardId);

        // Add card to current trick
        next.currentTrick.push({
          playerId,
          playerName: player.displayName,
          card
        });

        // Set lead suit if this is the first card
        if (next.currentTrick.length === 1) {
          next.leadSuit = card.suit;
        }

        next.lastMove = {
          playerId,
          playerName: player.displayName,
          card: getCardDisplayName(card)
        };

        // Check if trick is complete
        const numPlayers = next.playerOrder.length;
        if (next.currentTrick.length === numPlayers) {
          // Determine trick winner
          const winner = this.determineTrickWinner(next.currentTrick, next.leadSuit);
          const winnerId = winner.playerId;

          // Award points for hearts and Queen of Spades
          let points = 0;
          let hasHearts = false;
          let hasQueenOfSpades = false;

          next.currentTrick.forEach(play => {
            if (play.card.suit === 'hearts') {
              points += 1;
              hasHearts = true;
            }
            if (play.card.suit === 'spades' && play.card.rank === 'Q') {
              points += 13;
              hasQueenOfSpades = true;
            }
          });

          next.score[winnerId] += points;
          next.tricks[winnerId] = (next.tricks[winnerId] || 0) + 1;

          // Store completed trick
          next.completedTricks.push({
            cards: [...next.currentTrick],
            winnerId,
            winnerName: winner.playerName,
            points
          });

          // Hearts are broken if a heart was played
          if (hasHearts) {
            next.heartsBroken = true;
          }

          // Reset for next trick
          next.currentTrick = [];
          next.leadSuit = null;
          next.currentPlayerId = winnerId; // Winner leads next trick

          // Check if hand is complete (all 13 tricks played)
          if (next.completedTricks.length === 13) {
            next.isRoundComplete = true;

            // Check for shooting the moon (one player took all 26 points)
            const shooterId = this.checkShootingMoon(next);
            if (shooterId) {
              // Shooting the moon: give 26 points to all other players
              next.playerOrder.forEach(pid => {
                if (pid !== shooterId) {
                  next.score[pid] += 26;
                } else {
                  next.score[pid] = 0; // Reset shooter's score for this round
                }
              });
              next.shootingMoon = true;
              next.shooterId = shooterId;
            }

            // Check for game over (someone reached 100 points)
            const maxScore = Math.max(...Object.values(next.score));
            if (maxScore >= 100) {
              next.isComplete = true;
              // Lowest score wins
              const scores = next.playerOrder.map(pid => ({
                playerId: pid,
                score: next.score[pid]
              }));
              scores.sort((a, b) => a.score - b.score);
              const winner = scores[0];
              next.gameWinnerId = winner.playerId;
              const winnerPlayer = playerManager.get(winner.playerId);
              next.gameWinner = winnerPlayer.displayName;
            }
          }
        } else {
          // Move to next player
          const currentIndex = next.playerOrder.indexOf(playerId);
          const nextIndex = (currentIndex + 1) % numPlayers;
          next.currentPlayerId = next.playerOrder[nextIndex];
        }

        return next;
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }

  validatePlay(state, playerId, card) {
    // First trick special rules
    if (state.completedTricks.length === 0 && state.currentTrick.length === 0) {
      // Player with 2 of clubs must lead
      const has2OfClubs = state.hands[playerId].some(
        c => c.suit === 'clubs' && c.rank === '2'
      );
      if (has2OfClubs && (card.suit !== 'clubs' || card.rank !== '2')) {
        return { error: 'Must lead with 2 of clubs' };
      }
    }

    // Must follow suit if possible
    if (state.leadSuit) {
      const hasLeadSuit = state.hands[playerId].some(c => c.suit === state.leadSuit);
      if (hasLeadSuit && card.suit !== state.leadSuit) {
        return { error: 'Must follow suit' };
      }
    }

    // Cannot lead hearts until hearts are broken (unless only hearts left)
    if (!state.leadSuit && card.suit === 'hearts' && !state.heartsBroken) {
      const hasNonHearts = state.hands[playerId].some(c => c.suit !== 'hearts');
      if (hasNonHearts) {
        return { error: 'Hearts not broken yet' };
      }
    }

    // Cannot play points on first trick
    if (state.completedTricks.length === 0) {
      if (card.suit === 'hearts' || (card.suit === 'spades' && card.rank === 'Q')) {
        return { error: 'Cannot play points on first trick' };
      }
    }

    return { valid: true };
  }

  determineTrickWinner(trick, leadSuit) {
    // Filter cards that followed lead suit
    const followedSuit = trick.filter(play => play.card.suit === leadSuit);

    // Highest card in lead suit wins
    followedSuit.sort((a, b) => b.card.value - a.card.value);
    return followedSuit[0];
  }

  checkShootingMoon(state) {
    // Check if any player took all 26 points
    for (const playerId of state.playerOrder) {
      if (state.score[playerId] === 26) {
        // Verify they took all hearts and queen of spades
        const playerTricks = state.completedTricks.filter(t => t.winnerId === playerId);
        const playerCards = playerTricks.flatMap(t => t.cards.map(c => c.card));

        const heartCount = playerCards.filter(c => c.suit === 'hearts').length;
        const hasQueenOfSpades = playerCards.some(
          c => c.suit === 'spades' && c.rank === 'Q'
        );

        if (heartCount === 13 && hasQueenOfSpades) {
          return playerId;
        }
      }
    }
    return null;
  }
}

/**
 * Register the Hearts card game
 */
module.exports = {
  register(registry) {
    return registry.register({
      id: 'hearts',
      name: 'Hearts',
      minPlayers: 4,
      maxPlayers: 4,
      version: '1.0.0',
      description: 'Classic trick-taking game - avoid hearts and the Queen of Spades!',
      category: 'cards',

      create({ roomId, players = [] }) {
        // Create and shuffle deck
        const deck = shuffle(createDeck());

        // Deal all cards to players (13 each for 4 players)
        const numPlayers = Math.max(players.length, 4);
        const cardsPerPlayer = 13;
        const { hands } = dealCards(deck, numPlayers, cardsPerPlayer);

        // Create game instance
        const game = buildGameInstance({
          id: 'hearts',
          minPlayers: 4,
          maxPlayers: 4,
          initialState: {
            roomId,
            gameType: 'hearts',
            hands: {},
            currentTrick: [],
            completedTricks: [],
            tricks: {},
            leadSuit: null,
            heartsBroken: false,
            score: {},
            players: {},
            playerOrder: [],
            currentPlayerId: null,
            isRoundComplete: false,
            isComplete: false,
            gameWinner: null,
            gameWinnerId: null,
            shootingMoon: false,
            shooterId: null,
            lastMove: null
          },
          strategies: {
            playCard: new PlayCardStrategy()
          }
        });

        // Initialize players
        players.forEach((player, index) => {
          game.getPlayerManager().add(player);
          const state = game.getState();
          state.hands[player.id] = hands[index] || [];
          state.score[player.id] = 0;
          state.tricks[player.id] = 0;
          state.players[player.id] = {
            id: player.id,
            displayName: player.displayName,
            index
          };
          state.playerOrder.push(player.id);
        });

        // Find player with 2 of clubs to start
        const state = game.getState();
        for (const playerId of state.playerOrder) {
          const has2OfClubs = state.hands[playerId].some(
            c => c.suit === 'clubs' && c.rank === '2'
          );
          if (has2OfClubs) {
            state.currentPlayerId = playerId;
            break;
          }
        }

        // Listen for round end
        game.getStateManager().on('stateChanged', ({ current }) => {
          if (current.isComplete && current.gameWinnerId) {
            game.emit('roundEnd', {
              score: current.score,
              winnerId: current.gameWinnerId,
              winnerName: current.gameWinner,
              outcome: 'win'
            });
          }
        });

        return game;
      }
    });
  }
};
