/**
 * Unit Tests for Deterministic RNG
 */

const { DeterministicRNG, createRNG, generateRoomSeed } = require('../../src/utils/rng');

describe('DeterministicRNG', () => {
  describe('Basic Random Generation', () => {
    it('should generate reproducible numbers with same seed', () => {
      const rng1 = new DeterministicRNG('test-seed');
      const rng2 = new DeterministicRNG('test-seed');

      const values1 = [rng1.random(), rng1.random(), rng1.random()];
      const values2 = [rng2.random(), rng2.random(), rng2.random()];

      expect(values1).toEqual(values2);
    });

    it('should generate different numbers with different seeds', () => {
      const rng1 = new DeterministicRNG('seed-1');
      const rng2 = new DeterministicRNG('seed-2');

      const value1 = rng1.random();
      const value2 = rng2.random();

      expect(value1).not.toBe(value2);
    });

    it('should generate numbers between 0 and 1', () => {
      const rng = new DeterministicRNG('test');

      for (let i = 0; i < 100; i++) {
        const value = rng.random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });

  describe('Integer Generation', () => {
    it('should generate integers in range', () => {
      const rng = new DeterministicRNG('test');

      for (let i = 0; i < 100; i++) {
        const value = rng.randomInt(1, 10);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThan(10);
        expect(Number.isInteger(value)).toBe(true);
      }
    });
  });

  describe('Array Operations', () => {
    it('should choose random element', () => {
      const rng = new DeterministicRNG('test');
      const array = [1, 2, 3, 4, 5];

      const choice = rng.choice(array);
      expect(array).toContain(choice);
    });

    it('should shuffle array reproducibly', () => {
      const rng1 = new DeterministicRNG('shuffle-seed');
      const rng2 = new DeterministicRNG('shuffle-seed');

      const array = [1, 2, 3, 4, 5];
      const shuffled1 = rng1.shuffle(array);
      const shuffled2 = rng2.shuffle(array);

      expect(shuffled1).toEqual(shuffled2);
    });
  });

  describe('State Management', () => {
    it('should track call count', () => {
      const rng = new DeterministicRNG('test');

      expect(rng.getCallCount()).toBe(0);
      rng.random();
      expect(rng.getCallCount()).toBe(1);
      rng.random();
      rng.random();
      expect(rng.getCallCount()).toBe(3);
    });

    it('should reset to initial state', () => {
      const rng = new DeterministicRNG('test-seed');

      const value1 = rng.random();
      rng.random();
      rng.random();

      rng.reset();
      const value2 = rng.random();

      expect(value1).toBe(value2);
      expect(rng.getCallCount()).toBe(1);
    });
  });
});

describe('generateRoomSeed', () => {
  it('should generate consistent seed for same inputs', () => {
    const seed1 = generateRoomSeed('room-123', 1234567890);
    const seed2 = generateRoomSeed('room-123', 1234567890);

    expect(seed1).toBe(seed2);
  });

  it('should generate different seeds for different rooms', () => {
    const timestamp = Date.now();
    const seed1 = generateRoomSeed('room-1', timestamp);
    const seed2 = generateRoomSeed('room-2', timestamp);

    expect(seed1).not.toBe(seed2);
  });
});
