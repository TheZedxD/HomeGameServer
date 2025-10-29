/**
 * Unit Tests for State Machines
 *
 * Tests FSM transitions, validation, and state management
 */

const {
  RoomState,
  RoomStateMachine,
  PlayerState,
  PlayerStateMachine,
} = require('../../src/core/stateMachines');

describe('RoomStateMachine', () => {
  let fsm;

  beforeEach(() => {
    fsm = new RoomStateMachine('test-room-123');
  });

  describe('Initialization', () => {
    it('should initialize with INITIALIZING state', () => {
      expect(fsm.getState()).toBe(RoomState.INITIALIZING);
    });

    it('should have empty previous state', () => {
      expect(fsm.previousState).toBeNull();
    });

    it('should record initial state in history', () => {
      const history = fsm.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].state).toBe(RoomState.INITIALIZING);
    });
  });

  describe('Valid Transitions', () => {
    it('should transition from INITIALIZING to LOBBY', () => {
      fsm.transition(RoomState.LOBBY);
      expect(fsm.getState()).toBe(RoomState.LOBBY);
      expect(fsm.previousState).toBe(RoomState.INITIALIZING);
    });

    it('should transition from LOBBY to STARTING', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.STARTING);
      expect(fsm.getState()).toBe(RoomState.STARTING);
    });

    it('should transition from STARTING to PLAYING', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.STARTING);
      fsm.transition(RoomState.PLAYING);
      expect(fsm.getState()).toBe(RoomState.PLAYING);
    });

    it('should transition from PLAYING to PAUSED', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.STARTING);
      fsm.transition(RoomState.PLAYING);
      fsm.transition(RoomState.PAUSED);
      expect(fsm.getState()).toBe(RoomState.PAUSED);
    });

    it('should allow direct termination from any state', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.TERMINATED);
      expect(fsm.getState()).toBe(RoomState.TERMINATED);
    });
  });

  describe('Invalid Transitions', () => {
    it('should reject invalid transition', () => {
      fsm.transition(RoomState.LOBBY);

      expect(() => {
        fsm.transition(RoomState.PLAYING); // Cannot go directly from LOBBY to PLAYING
      }).toThrow(/Invalid room state transition/);
    });

    it('should reject transition from terminal state', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.TERMINATED);

      expect(() => {
        fsm.transition(RoomState.LOBBY);
      }).toThrow(/Invalid room state transition/);
    });
  });

  describe('State Checks', () => {
    it('should correctly identify current state', () => {
      fsm.transition(RoomState.LOBBY);
      expect(fsm.is(RoomState.LOBBY)).toBe(true);
      expect(fsm.is(RoomState.PLAYING)).toBe(false);
    });

    it('should check if in any of multiple states', () => {
      fsm.transition(RoomState.LOBBY);
      expect(fsm.isAny(RoomState.LOBBY, RoomState.STARTING)).toBe(true);
      expect(fsm.isAny(RoomState.PLAYING, RoomState.PAUSED)).toBe(false);
    });

    it('should identify active rooms', () => {
      expect(fsm.isActive()).toBe(true);

      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.TERMINATED);
      expect(fsm.isActive()).toBe(false);
    });

    it('should identify playable states', () => {
      fsm.transition(RoomState.LOBBY);
      expect(fsm.isPlayable()).toBe(false);

      fsm.transition(RoomState.STARTING);
      fsm.transition(RoomState.PLAYING);
      expect(fsm.isPlayable()).toBe(true);

      fsm.transition(RoomState.PAUSED);
      expect(fsm.isPlayable()).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit transition event', (done) => {
      fsm.on('transition', (event) => {
        expect(event.from).toBe(RoomState.INITIALIZING);
        expect(event.to).toBe(RoomState.LOBBY);
        done();
      });

      fsm.transition(RoomState.LOBBY);
    });

    it('should emit enter state event', (done) => {
      fsm.on(`enter:${RoomState.LOBBY}`, (event) => {
        expect(event.previousState).toBe(RoomState.INITIALIZING);
        done();
      });

      fsm.transition(RoomState.LOBBY);
    });

    it('should emit exit state event', (done) => {
      fsm.on(`exit:${RoomState.INITIALIZING}`, (event) => {
        expect(event.targetState).toBe(RoomState.LOBBY);
        done();
      });

      fsm.transition(RoomState.LOBBY);
    });
  });

  describe('History', () => {
    it('should track state history', () => {
      fsm.transition(RoomState.LOBBY);
      fsm.transition(RoomState.STARTING);
      fsm.transition(RoomState.PLAYING);

      const history = fsm.getHistory();
      expect(history).toHaveLength(4); // INITIALIZING + 3 transitions
      expect(history.map(h => h.state)).toEqual([
        RoomState.INITIALIZING,
        RoomState.LOBBY,
        RoomState.STARTING,
        RoomState.PLAYING,
      ]);
    });

    it('should track time in current state', (done) => {
      fsm.transition(RoomState.LOBBY);

      setTimeout(() => {
        const timeInState = fsm.getTimeInState();
        expect(timeInState).toBeGreaterThan(50);
        expect(timeInState).toBeLessThan(200);
        done();
      }, 100);
    });
  });
});

describe('PlayerStateMachine', () => {
  let fsm;

  beforeEach(() => {
    fsm = new PlayerStateMachine('player-123', 'socket-abc');
  });

  describe('Initialization', () => {
    it('should initialize with CONNECTING state', () => {
      expect(fsm.getState()).toBe(PlayerState.CONNECTING);
    });

    it('should store player and socket IDs', () => {
      expect(fsm.playerId).toBe('player-123');
      expect(fsm.socketId).toBe('socket-abc');
    });
  });

  describe('Valid Transitions', () => {
    it('should transition through connection flow', () => {
      fsm.transition(PlayerState.CONNECTED);
      expect(fsm.getState()).toBe(PlayerState.CONNECTED);

      fsm.transition(PlayerState.JOINING);
      expect(fsm.getState()).toBe(PlayerState.JOINING);

      fsm.transition(PlayerState.IN_LOBBY);
      expect(fsm.getState()).toBe(PlayerState.IN_LOBBY);

      fsm.transition(PlayerState.READY);
      expect(fsm.getState()).toBe(PlayerState.READY);

      fsm.transition(PlayerState.PLAYING);
      expect(fsm.getState()).toBe(PlayerState.PLAYING);
    });

    it('should handle disconnection and reconnection', () => {
      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.JOINING);
      fsm.transition(PlayerState.IN_LOBBY);
      fsm.transition(PlayerState.DISCONNECTED);

      expect(fsm.getState()).toBe(PlayerState.DISCONNECTED);
      expect(fsm.lastDisconnectTime).toBeTruthy();

      fsm.transition(PlayerState.IN_LOBBY); // Reconnect
      expect(fsm.getState()).toBe(PlayerState.IN_LOBBY);
    });
  });

  describe('State Checks', () => {
    it('should identify active players', () => {
      expect(fsm.isActive()).toBe(true);

      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.DISCONNECTED);
      expect(fsm.isActive()).toBe(false);

      fsm.transition(PlayerState.CONNECTED);
      expect(fsm.isActive()).toBe(true);
    });

    it('should identify players in rooms', () => {
      fsm.transition(PlayerState.CONNECTED);
      expect(fsm.isInRoom()).toBe(false);

      fsm.transition(PlayerState.JOINING);
      expect(fsm.isInRoom()).toBe(true);

      fsm.transition(PlayerState.IN_LOBBY);
      expect(fsm.isInRoom()).toBe(true);
    });

    it('should identify players who can play', () => {
      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.JOINING);
      fsm.transition(PlayerState.IN_LOBBY);

      expect(fsm.canPlay()).toBe(false);

      fsm.transition(PlayerState.READY);
      fsm.transition(PlayerState.PLAYING);
      expect(fsm.canPlay()).toBe(true);
    });
  });

  describe('Activity Tracking', () => {
    it('should track idle time', (done) => {
      setTimeout(() => {
        const idleTime = fsm.getIdleTime();
        expect(idleTime).toBeGreaterThan(50);
        done();
      }, 100);
    });

    it('should update activity on mark active', () => {
      const initialTime = Date.now();

      setTimeout(() => {
        fsm.markActive();
        const idleTime = fsm.getIdleTime();
        expect(idleTime).toBeLessThan(50);
      }, 100);
    });

    it('should track disconnect duration', () => {
      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.DISCONNECTED);

      setTimeout(() => {
        const duration = fsm.getDisconnectDuration();
        expect(duration).toBeGreaterThan(0);
      }, 50);
    });

    it('should track connection attempts', () => {
      expect(fsm.connectionAttempts).toBe(0);

      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.DISCONNECTED);
      expect(fsm.connectionAttempts).toBe(1);

      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.DISCONNECTED);
      expect(fsm.connectionAttempts).toBe(2);
    });
  });

  describe('Socket Management', () => {
    it('should update socket ID', (done) => {
      fsm.on('socketUpdate', (event) => {
        expect(event.oldSocketId).toBe('socket-abc');
        expect(event.newSocketId).toBe('socket-xyz');
        done();
      });

      fsm.updateSocket('socket-xyz');
      expect(fsm.socketId).toBe('socket-xyz');
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      fsm.transition(PlayerState.CONNECTED);
      fsm.transition(PlayerState.JOINING);

      const json = fsm.toJSON();

      expect(json.playerId).toBe('player-123');
      expect(json.currentState).toBe(PlayerState.JOINING);
      expect(json.stateHistory).toHaveLength(3);
    });
  });
});
