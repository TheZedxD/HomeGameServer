/**
 * War Card Game Plugin
 * A simple 2-player card game where players flip cards and the highest card wins
 */

const { buildGameInstance } = require('../../core');
const {
  createDeck,
  shuffle,
  dealCards,
  getCardDisplayName
} = require('./cardUtils');

/**
 * Strategy for playing a card in War
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

    // Check if round is complete
    if (state.isRoundComplete) {
      return { error: 'Round is complete' };
    }

    const hand = state.hands[playerId];
    if (!hand || hand.length === 0) {
      return { error: 'No cards left to play' };
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        // Draw top card from player's hand
        const card = next.hands[playerId].shift();
        card.faceUp = true;

        // Add to played cards
        next.playedCards[playerId] = card;
        next.lastMove = {
          playerId,
          playerName: player.displayName,
          card: getCardDisplayName(card)
        };

        // Check if both players have played
        const playerIds = Object.keys(next.hands);
        const allPlayed = playerIds.every(pid => next.playedCards[pid] !== null);

        if (allPlayed) {
          // Determine winner
          const cards = playerIds.map(pid => ({
            playerId: pid,
            card: next.playedCards[pid]
          }));

          cards.sort((a, b) => b.card.value - a.card.value);
          const winner = cards[0];
          const isWar = cards[0].card.value === cards[1].card.value;

          if (isWar) {
            // War! Both players put cards in the pot
            next.warPot.push(...cards.map(c => c.card));
            next.warCount++;
            next.isWar = true;
            next.currentPlayerId = playerIds[0]; // First player starts next war round
          } else {
            // Clear winner
            const winnerId = winner.playerId;
            const winnerPlayer = playerManager.get(winnerId);

            // Winner takes all cards in play plus any war pot
            const wonCards = [...cards.map(c => c.card), ...next.warPot];
            next.hands[winnerId].push(...wonCards);
            next.score[winnerId] += wonCards.length;

            next.winner = winnerPlayer.displayName;
            next.winnerId = winnerId;
            next.warPot = [];
            next.warCount = 0;
            next.isWar = false;
            next.isRoundComplete = true;

            // Check if game is over
            const hasCards = playerIds.filter(pid => next.hands[pid].length > 0);
            if (hasCards.length === 1) {
              const gameWinnerId = hasCards[0];
              const gameWinner = playerManager.get(gameWinnerId);
              next.isComplete = true;
              next.gameWinner = gameWinner.displayName;
              next.gameWinnerId = gameWinnerId;
            }
          }

          // Reset played cards for next round
          next.playedCards = {};
          playerIds.forEach(pid => next.playedCards[pid] = null);
        } else {
          // Move to next player
          const currentIndex = playerIds.indexOf(playerId);
          const nextIndex = (currentIndex + 1) % playerIds.length;
          next.currentPlayerId = playerIds[nextIndex];
        }

        next.round++;
        return next;
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }
}

/**
 * Strategy for resetting the round
 */
class ResetRoundStrategy {
  execute({ state, playerManager }) {
    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));
        next.isRoundComplete = false;
        next.winner = null;
        next.winnerId = null;
        next.lastMove = null;

        // Reset current player to first player
        const playerIds = Object.keys(next.hands);
        next.currentPlayerId = playerIds[0];

        return next;
      },
      getUndo() {
        return () => ({ state: JSON.parse(JSON.stringify(state)) });
      }
    };
  }
}

/**
 * Register the War card game
 */
module.exports = {
  register(registry) {
    return registry.register({
      id: 'war',
      name: 'War',
      minPlayers: 2,
      maxPlayers: 2,
      version: '1.0.0',
      description: 'Classic card game where highest card wins',
      category: 'cards',

      create({ roomId, players = [] }) {
        // Create and shuffle deck
        const deck = shuffle(createDeck());

        // Deal all cards to players
        const numPlayers = Math.max(players.length, 2);
        const cardsPerPlayer = Math.floor(deck.length / numPlayers);
        const { hands } = dealCards(deck, numPlayers, cardsPerPlayer);

        // Create game instance
        const game = buildGameInstance({
          id: 'war',
          minPlayers: 2,
          maxPlayers: 2,
          initialState: {
            roomId,
            gameType: 'war',
            hands: {},
            playedCards: {},
            warPot: [],
            warCount: 0,
            isWar: false,
            score: {},
            players: {},
            playerOrder: [],
            currentPlayerId: null,
            round: 1,
            isRoundComplete: false,
            isComplete: false,
            winner: null,
            winnerId: null,
            gameWinner: null,
            gameWinnerId: null,
            lastMove: null
          },
          strategies: {
            playCard: new PlayCardStrategy(),
            resetRound: new ResetRoundStrategy()
          }
        });

        // Initialize players
        players.forEach((player, index) => {
          game.getPlayerManager().add(player);
          const state = game.getState();
          state.hands[player.id] = hands[index] || [];
          state.playedCards[player.id] = null;
          state.score[player.id] = 0;
          state.players[player.id] = {
            id: player.id,
            displayName: player.displayName,
            index
          };
          state.playerOrder.push(player.id);
        });

        // Set first player
        const state = game.getState();
        if (state.playerOrder.length > 0) {
          state.currentPlayerId = state.playerOrder[0];
        }

        // Listen for round end
        game.getStateManager().on('stateChanged', ({ current }) => {
          if (current.isComplete && current.gameWinnerId) {
            game.emit('roundEnd', {
              round: current.round,
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
