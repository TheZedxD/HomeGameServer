/**
 * Deterministic Random Number Generator (RNG)
 *
 * Provides seeded random number generation for reproducible game states.
 * Uses seedrandom library for high-quality, deterministic randomness.
 *
 * Benefits:
 * - Replay game sessions from seed
 * - Debugging with reproducible randomness
 * - Fair gameplay verification
 * - State synchronization across clients
 */

const seedrandom = require('seedrandom');
const crypto = require('crypto');

/**
 * Deterministic RNG class
 */
class DeterministicRNG {
  /**
   * Create a new RNG instance
   *
   * @param {String|Number} seed - Seed value for reproducibility
   * @param {Object} options - Configuration options
   */
  constructor(seed, options = {}) {
    this.seed = seed !== undefined ? seed : this._generateSeed();
    this.initialSeed = this.seed;
    this.options = {
      state: options.state || false, // Whether to save/restore state
      ...options,
    };

    // Initialize seedrandom with state tracking if enabled
    this.rng = this.options.state
      ? seedrandom(String(this.seed), { state: true })
      : seedrandom(String(this.seed));

    this.callCount = 0;
    this.history = options.trackHistory ? [] : null;
  }

  /**
   * Generate a cryptographically secure seed
   *
   * @returns {String} Hex seed
   */
  _generateSeed() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate a random float between 0 (inclusive) and 1 (exclusive)
   *
   * @returns {Number} Random float [0, 1)
   */
  random() {
    const value = this.rng();
    this.callCount++;

    if (this.history) {
      this.history.push({ call: this.callCount, value, method: 'random' });
    }

    return value;
  }

  /**
   * Generate a random integer between min (inclusive) and max (exclusive)
   *
   * @param {Number} min - Minimum value (inclusive)
   * @param {Number} max - Maximum value (exclusive)
   * @returns {Number} Random integer [min, max)
   */
  randomInt(min, max) {
    if (max === undefined) {
      max = min;
      min = 0;
    }

    const range = max - min;
    if (range <= 0) {
      throw new Error('max must be greater than min');
    }

    return Math.floor(this.random() * range) + min;
  }

  /**
   * Generate a random float between min (inclusive) and max (exclusive)
   *
   * @param {Number} min - Minimum value (inclusive)
   * @param {Number} max - Maximum value (exclusive)
   * @returns {Number} Random float [min, max)
   */
  randomFloat(min, max) {
    if (max === undefined) {
      max = min;
      min = 0;
    }

    const range = max - min;
    if (range <= 0) {
      throw new Error('max must be greater than min');
    }

    return this.random() * range + min;
  }

  /**
   * Generate a random boolean with optional bias
   *
   * @param {Number} probability - Probability of true (default: 0.5)
   * @returns {Boolean} Random boolean
   */
  randomBoolean(probability = 0.5) {
    if (probability < 0 || probability > 1) {
      throw new Error('Probability must be between 0 and 1');
    }

    return this.random() < probability;
  }

  /**
   * Choose a random element from an array
   *
   * @param {Array} array - Array to choose from
   * @returns {*} Random element
   */
  choice(array) {
    if (!Array.isArray(array) || array.length === 0) {
      throw new Error('Array must be non-empty');
    }

    const index = this.randomInt(0, array.length);
    return array[index];
  }

  /**
   * Shuffle an array in-place using Fisher-Yates algorithm
   *
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array (same reference)
   */
  shuffle(array) {
    if (!Array.isArray(array)) {
      throw new Error('Input must be an array');
    }

    const arr = [...array]; // Create copy to avoid mutation
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }

  /**
   * Sample n unique random elements from an array
   *
   * @param {Array} array - Array to sample from
   * @param {Number} n - Number of elements to sample
   * @returns {Array} Array of sampled elements
   */
  sample(array, n) {
    if (!Array.isArray(array)) {
      throw new Error('Input must be an array');
    }

    if (n > array.length) {
      throw new Error('Sample size cannot exceed array length');
    }

    const shuffled = this.shuffle(array);
    return shuffled.slice(0, n);
  }

  /**
   * Generate a random string of specified length
   *
   * @param {Number} length - Length of string
   * @param {String} charset - Character set to use
   * @returns {String} Random string
   */
  randomString(length, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(this.randomInt(0, charset.length));
    }
    return result;
  }

  /**
   * Generate a normally distributed random number (Box-Muller transform)
   *
   * @param {Number} mean - Mean of distribution (default: 0)
   * @param {Number} stdDev - Standard deviation (default: 1)
   * @returns {Number} Normally distributed random number
   */
  randomNormal(mean = 0, stdDev = 1) {
    // Box-Muller transform
    const u1 = this.random();
    const u2 = this.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  /**
   * Generate a weighted random choice
   *
   * @param {Array} items - Array of items
   * @param {Array} weights - Array of weights (same length as items)
   * @returns {*} Randomly selected item based on weights
   */
  weightedChoice(items, weights) {
    if (!Array.isArray(items) || !Array.isArray(weights)) {
      throw new Error('Items and weights must be arrays');
    }

    if (items.length !== weights.length) {
      throw new Error('Items and weights must have same length');
    }

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      throw new Error('Total weight must be positive');
    }

    let random = this.random() * totalWeight;

    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }

    // Fallback (shouldn't reach here due to floating point)
    return items[items.length - 1];
  }

  /**
   * Get RNG state for serialization
   *
   * @returns {Object} State object
   */
  getState() {
    if (!this.options.state) {
      throw new Error('State tracking not enabled. Initialize with { state: true }');
    }

    return {
      seed: this.initialSeed,
      callCount: this.callCount,
      rngState: this.rng.state(),
      history: this.history,
    };
  }

  /**
   * Restore RNG from saved state
   *
   * @param {Object} state - State object from getState()
   */
  setState(state) {
    if (!this.options.state) {
      throw new Error('State tracking not enabled. Initialize with { state: true }');
    }

    this.initialSeed = state.seed;
    this.callCount = state.callCount;
    this.history = state.history || null;
    this.rng = seedrandom('', { state: state.rngState });
  }

  /**
   * Reset RNG to initial seed
   */
  reset() {
    this.rng = this.options.state
      ? seedrandom(String(this.initialSeed), { state: true })
      : seedrandom(String(this.initialSeed));

    this.callCount = 0;
    if (this.history) {
      this.history = [];
    }
  }

  /**
   * Get current seed
   *
   * @returns {String|Number} Current seed
   */
  getSeed() {
    return this.initialSeed;
  }

  /**
   * Get number of random calls made
   *
   * @returns {Number} Call count
   */
  getCallCount() {
    return this.callCount;
  }

  /**
   * Get call history (if tracking enabled)
   *
   * @returns {Array|null} History array or null
   */
  getHistory() {
    return this.history ? [...this.history] : null;
  }
}

/**
 * Create a new seeded RNG instance
 *
 * @param {String|Number} seed - Optional seed value
 * @param {Object} options - Configuration options
 * @returns {DeterministicRNG} RNG instance
 */
function createRNG(seed, options = {}) {
  return new DeterministicRNG(seed, options);
}

/**
 * Generate a unique seed from room ID and timestamp
 *
 * @param {String} roomId - Room identifier
 * @param {Number} timestamp - Optional timestamp (default: now)
 * @returns {String} Seed string
 */
function generateRoomSeed(roomId, timestamp = Date.now()) {
  const data = `${roomId}-${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

module.exports = {
  DeterministicRNG,
  createRNG,
  generateRoomSeed,
};
