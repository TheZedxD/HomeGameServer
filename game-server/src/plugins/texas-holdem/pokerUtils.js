/**
 * Poker Hand Evaluation Utilities
 * Evaluates poker hands and determines winners
 */

// Hand rankings (higher is better)
const HAND_RANKS = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10
};

const HAND_NAMES = {
  1: 'High Card',
  2: 'Pair',
  3: 'Two Pair',
  4: 'Three of a Kind',
  5: 'Straight',
  6: 'Flush',
  7: 'Full House',
  8: 'Four of a Kind',
  9: 'Straight Flush',
  10: 'Royal Flush'
};

// Convert rank to numeric value (Ace high for poker)
function getPokerValue(rank) {
  const values = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return values[rank] || 0;
}

/**
 * Evaluate a poker hand from 5-7 cards
 * Returns the best possible 5-card hand
 */
function evaluateHand(cards) {
  if (cards.length < 5) {
    return null;
  }

  // Get all possible 5-card combinations
  const combinations = getCombinations(cards, 5);

  // Evaluate each combination
  let bestHand = null;
  let bestRank = 0;

  for (const combo of combinations) {
    const evaluation = evaluateFiveCards(combo);
    if (evaluation.rank > bestRank ||
        (evaluation.rank === bestRank && bestHand && compareKickers(evaluation.kickers, bestHand.kickers) > 0)) {
      bestHand = evaluation;
      bestRank = evaluation.rank;
    }
  }

  return bestHand;
}

/**
 * Evaluate exactly 5 cards
 */
function evaluateFiveCards(cards) {
  const sorted = [...cards].sort((a, b) => getPokerValue(b.rank) - getPokerValue(a.rank));

  const isFlush = checkFlush(sorted);
  const isStraight = checkStraight(sorted);
  const groups = groupByRank(sorted);

  // Royal Flush (A, K, Q, J, 10 of same suit)
  if (isFlush && isStraight && getPokerValue(sorted[0].rank) === 14) {
    return {
      rank: HAND_RANKS.ROYAL_FLUSH,
      name: HAND_NAMES[HAND_RANKS.ROYAL_FLUSH],
      cards: sorted,
      kickers: sorted.map(c => getPokerValue(c.rank))
    };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return {
      rank: HAND_RANKS.STRAIGHT_FLUSH,
      name: HAND_NAMES[HAND_RANKS.STRAIGHT_FLUSH],
      cards: sorted,
      kickers: [getPokerValue(sorted[0].rank)]
    };
  }

  // Four of a Kind
  if (groups[4]) {
    return {
      rank: HAND_RANKS.FOUR_OF_A_KIND,
      name: HAND_NAMES[HAND_RANKS.FOUR_OF_A_KIND],
      cards: sorted,
      kickers: [getPokerValue(groups[4][0].rank), getPokerValue(groups[1][0].rank)]
    };
  }

  // Full House
  if (groups[3] && groups[2]) {
    return {
      rank: HAND_RANKS.FULL_HOUSE,
      name: HAND_NAMES[HAND_RANKS.FULL_HOUSE],
      cards: sorted,
      kickers: [getPokerValue(groups[3][0].rank), getPokerValue(groups[2][0].rank)]
    };
  }

  // Flush
  if (isFlush) {
    return {
      rank: HAND_RANKS.FLUSH,
      name: HAND_NAMES[HAND_RANKS.FLUSH],
      cards: sorted,
      kickers: sorted.map(c => getPokerValue(c.rank))
    };
  }

  // Straight
  if (isStraight) {
    return {
      rank: HAND_RANKS.STRAIGHT,
      name: HAND_NAMES[HAND_RANKS.STRAIGHT],
      cards: sorted,
      kickers: [getPokerValue(sorted[0].rank)]
    };
  }

  // Three of a Kind
  if (groups[3]) {
    const remaining = sorted.filter(c => c.rank !== groups[3][0].rank);
    return {
      rank: HAND_RANKS.THREE_OF_A_KIND,
      name: HAND_NAMES[HAND_RANKS.THREE_OF_A_KIND],
      cards: sorted,
      kickers: [
        getPokerValue(groups[3][0].rank),
        getPokerValue(remaining[0].rank),
        getPokerValue(remaining[1].rank)
      ]
    };
  }

  // Two Pair
  if (groups[2] && groups[2].length >= 4) {
    const pairs = [...groups[2]];
    const pair1Value = getPokerValue(pairs[0].rank);
    const pair2Value = getPokerValue(pairs[2].rank);
    const pairValues = [pair1Value, pair2Value].sort((a, b) => b - a);
    const remaining = sorted.filter(c =>
      getPokerValue(c.rank) !== pairValues[0] &&
      getPokerValue(c.rank) !== pairValues[1]
    );

    return {
      rank: HAND_RANKS.TWO_PAIR,
      name: HAND_NAMES[HAND_RANKS.TWO_PAIR],
      cards: sorted,
      kickers: [...pairValues, getPokerValue(remaining[0].rank)]
    };
  }

  // Pair
  if (groups[2]) {
    const remaining = sorted.filter(c => c.rank !== groups[2][0].rank);
    return {
      rank: HAND_RANKS.PAIR,
      name: HAND_NAMES[HAND_RANKS.PAIR],
      cards: sorted,
      kickers: [
        getPokerValue(groups[2][0].rank),
        getPokerValue(remaining[0].rank),
        getPokerValue(remaining[1].rank),
        getPokerValue(remaining[2].rank)
      ]
    };
  }

  // High Card
  return {
    rank: HAND_RANKS.HIGH_CARD,
    name: HAND_NAMES[HAND_RANKS.HIGH_CARD],
    cards: sorted,
    kickers: sorted.map(c => getPokerValue(c.rank))
  };
}

/**
 * Check if 5 cards form a flush
 */
function checkFlush(cards) {
  const suit = cards[0].suit;
  return cards.every(c => c.suit === suit);
}

/**
 * Check if 5 cards form a straight
 */
function checkStraight(cards) {
  const values = cards.map(c => getPokerValue(c.rank)).sort((a, b) => b - a);

  // Check normal straight
  let isStraight = true;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) {
      isStraight = false;
      break;
    }
  }

  // Check for wheel (A, 2, 3, 4, 5)
  if (!isStraight && values[0] === 14) {
    const wheelValues = [14, 5, 4, 3, 2];
    isStraight = JSON.stringify(values) === JSON.stringify(wheelValues);
  }

  return isStraight;
}

/**
 * Group cards by rank
 */
function groupByRank(cards) {
  const groups = {};

  for (const card of cards) {
    const value = getPokerValue(card.rank);
    for (let i = 1; i <= 4; i++) {
      if (!groups[i]) groups[i] = [];
    }
  }

  // Count occurrences
  const counts = {};
  for (const card of cards) {
    const rank = card.rank;
    counts[rank] = (counts[rank] || 0) + 1;
  }

  // Group by count
  for (const card of cards) {
    const count = counts[card.rank];
    if (!groups[count]) groups[count] = [];
    if (!groups[count].find(c => c.rank === card.rank)) {
      groups[count].push(card);
    }
  }

  // Fill remaining groups
  for (const card of cards) {
    const count = counts[card.rank];
    if (count === 1) {
      if (!groups[1]) groups[1] = [];
      if (!groups[1].find(c => c.rank === card.rank)) {
        groups[1].push(card);
      }
    }
  }

  return groups;
}

/**
 * Compare kickers (tiebreaker)
 */
function compareKickers(kickers1, kickers2) {
  for (let i = 0; i < Math.min(kickers1.length, kickers2.length); i++) {
    if (kickers1[i] > kickers2[i]) return 1;
    if (kickers1[i] < kickers2[i]) return -1;
  }
  return 0;
}

/**
 * Compare two hands and determine winner
 * Returns: 1 if hand1 wins, -1 if hand2 wins, 0 if tie
 */
function compareHands(hand1, hand2) {
  if (hand1.rank > hand2.rank) return 1;
  if (hand1.rank < hand2.rank) return -1;

  // Same rank, compare kickers
  return compareKickers(hand1.kickers, hand2.kickers);
}

/**
 * Get all combinations of k elements from array
 */
function getCombinations(array, k) {
  if (k === 1) return array.map(item => [item]);
  if (k === array.length) return [array];

  const result = [];

  function combine(start, combo) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }

    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }

  combine(0, []);
  return result;
}

/**
 * Determine winners from multiple players
 * Returns array of winning player IDs (can be multiple in case of tie)
 */
function determineWinners(players) {
  if (!players || players.length === 0) return [];
  if (players.length === 1) return [players[0].playerId];

  // Evaluate all hands
  const evaluations = players.map(player => ({
    playerId: player.playerId,
    hand: evaluateHand(player.cards),
    cards: player.cards
  }));

  // Find best hand(s)
  let bestEval = evaluations[0];
  let winners = [evaluations[0].playerId];

  for (let i = 1; i < evaluations.length; i++) {
    const comparison = compareHands(evaluations[i].hand, bestEval.hand);

    if (comparison > 0) {
      // New best hand
      bestEval = evaluations[i];
      winners = [evaluations[i].playerId];
    } else if (comparison === 0) {
      // Tie
      winners.push(evaluations[i].playerId);
    }
  }

  return { winners, bestHand: bestEval.hand };
}

module.exports = {
  HAND_RANKS,
  HAND_NAMES,
  evaluateHand,
  compareHands,
  determineWinners,
  getPokerValue
};
