/**
 * Card Game Utilities
 * Provides standard playing card deck generation, shuffling, and manipulation
 */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const SUIT_COLORS = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black'
};

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VALUES = {
  'A': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 11,
  'Q': 12,
  'K': 13
};

/**
 * Creates a standard 52-card deck
 * @param {boolean} includeJokers - Whether to include joker cards
 * @returns {Array} Array of card objects
 */
function createDeck(includeJokers = false) {
  const deck = [];
  let cardId = 0;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: cardId++,
        suit,
        rank,
        value: RANK_VALUES[rank],
        symbol: SUIT_SYMBOLS[suit],
        color: SUIT_COLORS[suit],
        faceUp: false
      });
    }
  }

  if (includeJokers) {
    deck.push({
      id: cardId++,
      suit: 'joker',
      rank: 'Joker',
      value: 0,
      symbol: '🃏',
      color: 'red',
      faceUp: false
    });
    deck.push({
      id: cardId++,
      suit: 'joker',
      rank: 'Joker',
      value: 0,
      symbol: '🃏',
      color: 'black',
      faceUp: false
    });
  }

  return deck;
}

/**
 * Shuffles an array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array (new instance)
 */
function shuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Deals cards from deck to players
 * @param {Array} deck - Deck to deal from
 * @param {number} numPlayers - Number of players
 * @param {number} cardsPerPlayer - Cards to deal to each player
 * @returns {Object} { hands: {}, remaining: [] }
 */
function dealCards(deck, numPlayers, cardsPerPlayer) {
  const hands = {};
  let deckCopy = [...deck];

  for (let player = 0; player < numPlayers; player++) {
    hands[player] = [];
    for (let card = 0; card < cardsPerPlayer; card++) {
      if (deckCopy.length > 0) {
        hands[player].push(deckCopy.shift());
      }
    }
  }

  return {
    hands,
    remaining: deckCopy
  };
}

/**
 * Draws cards from a deck
 * @param {Array} deck - Deck to draw from
 * @param {number} count - Number of cards to draw
 * @returns {Object} { drawn: [], remaining: [] }
 */
function drawCards(deck, count = 1) {
  const deckCopy = [...deck];
  const drawn = deckCopy.splice(0, count);

  return {
    drawn,
    remaining: deckCopy
  };
}

/**
 * Sorts cards by suit and rank
 * @param {Array} cards - Cards to sort
 * @returns {Array} Sorted cards
 */
function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const suitOrder = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (suitOrder !== 0) return suitOrder;
    return a.value - b.value;
  });
}

/**
 * Finds cards matching criteria
 * @param {Array} cards - Cards to search
 * @param {Object} criteria - Search criteria (suit, rank, value, etc)
 * @returns {Array} Matching cards
 */
function findCards(cards, criteria) {
  return cards.filter(card => {
    return Object.keys(criteria).every(key => card[key] === criteria[key]);
  });
}

/**
 * Creates a copy of a card with updated properties
 * @param {Object} card - Card to copy
 * @param {Object} updates - Properties to update
 * @returns {Object} Updated card
 */
function updateCard(card, updates) {
  return { ...card, ...updates };
}

/**
 * Flips a card face up or down
 * @param {Object} card - Card to flip
 * @param {boolean} faceUp - Whether card should be face up
 * @returns {Object} Updated card
 */
function flipCard(card, faceUp = true) {
  return { ...card, faceUp };
}

/**
 * Gets the display name for a card
 * @param {Object} card - Card object
 * @returns {string} Display name (e.g., "A♥", "K♠")
 */
function getCardDisplayName(card) {
  if (card.suit === 'joker') {
    return card.symbol;
  }
  return `${card.rank}${card.symbol}`;
}

module.exports = {
  SUITS,
  SUIT_SYMBOLS,
  SUIT_COLORS,
  RANKS,
  RANK_VALUES,
  createDeck,
  shuffle,
  dealCards,
  drawCards,
  sortCards,
  findCards,
  updateCard,
  flipCard,
  getCardDisplayName
};
