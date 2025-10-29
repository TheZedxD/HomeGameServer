/**
 * State Machines for Rooms and Players
 *
 * Implements finite state machines (FSM) with strict state transitions
 * to ensure game integrity and prevent invalid state changes.
 */

const EventEmitter = require('events');

// ===========================
// Room States and Transitions
// ===========================

/**
 * Room State Enum
 */
const RoomState = Object.freeze({
  INITIALIZING: 'INITIALIZING',   // Room being created
  LOBBY: 'LOBBY',                  // Waiting for players to join/ready
  STARTING: 'STARTING',            // Countdown to game start
  PLAYING: 'PLAYING',              // Game in progress
  PAUSED: 'PAUSED',                // Game temporarily paused
  ROUND_END: 'ROUND_END',          // Round completed, showing results
  ENDING: 'ENDING',                // Game finishing, cleanup in progress
  TERMINATED: 'TERMINATED',        // Room closed and no longer active
});

/**
 * Valid room state transitions
 */
const RoomTransitions = Object.freeze({
  [RoomState.INITIALIZING]: [RoomState.LOBBY, RoomState.TERMINATED],
  [RoomState.LOBBY]: [RoomState.STARTING, RoomState.TERMINATED],
  [RoomState.STARTING]: [RoomState.PLAYING, RoomState.LOBBY, RoomState.TERMINATED],
  [RoomState.PLAYING]: [RoomState.PAUSED, RoomState.ROUND_END, RoomState.ENDING, RoomState.TERMINATED],
  [RoomState.PAUSED]: [RoomState.PLAYING, RoomState.ENDING, RoomState.TERMINATED],
  [RoomState.ROUND_END]: [RoomState.STARTING, RoomState.LOBBY, RoomState.ENDING, RoomState.TERMINATED],
  [RoomState.ENDING]: [RoomState.TERMINATED],
  [RoomState.TERMINATED]: [], // Terminal state
});

/**
 * Room State Machine
 */
class RoomStateMachine extends EventEmitter {
  constructor(roomId, initialState = RoomState.INITIALIZING) {
    super();
    this.roomId = roomId;
    this.currentState = initialState;
    this.previousState = null;
    this.stateHistory = [{ state: initialState, timestamp: Date.now() }];
    this.metadata = {};
  }

  /**
   * Get current state
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check if state can transition to target
   */
  canTransition(targetState) {
    const allowedTransitions = RoomTransitions[this.currentState] || [];
    return allowedTransitions.includes(targetState);
  }

  /**
   * Transition to new state
   */
  transition(targetState, metadata = {}) {
    if (!this.canTransition(targetState)) {
      throw new Error(
        `Invalid room state transition: ${this.currentState} -> ${targetState}. ` +
        `Allowed: ${RoomTransitions[this.currentState]?.join(', ') || 'none'}`
      );
    }

    const previousState = this.currentState;
    this.previousState = previousState;
    this.currentState = targetState;
    this.metadata = metadata;

    // Record transition in history
    this.stateHistory.push({
      state: targetState,
      from: previousState,
      timestamp: Date.now(),
      metadata,
    });

    // Emit transition event
    this.emit('transition', {
      from: previousState,
      to: targetState,
      metadata,
    });

    // Emit specific state events
    this.emit(`enter:${targetState}`, { previousState, metadata });
    this.emit(`exit:${previousState}`, { targetState, metadata });

    return this;
  }

  /**
   * Check if currently in a specific state
   */
  is(state) {
    return this.currentState === state;
  }

  /**
   * Check if in any of the provided states
   */
  isAny(...states) {
    return states.includes(this.currentState);
  }

  /**
   * Check if room is active (not terminated)
   */
  isActive() {
    return this.currentState !== RoomState.TERMINATED;
  }

  /**
   * Check if room is in a playable state
   */
  isPlayable() {
    return this.isAny(RoomState.PLAYING, RoomState.PAUSED);
  }

  /**
   * Get state history
   */
  getHistory() {
    return [...this.stateHistory];
  }

  /**
   * Get time in current state (ms)
   */
  getTimeInState() {
    const lastTransition = this.stateHistory[this.stateHistory.length - 1];
    return Date.now() - lastTransition.timestamp;
  }

  /**
   * Serialize state for persistence or transmission
   */
  toJSON() {
    return {
      roomId: this.roomId,
      currentState: this.currentState,
      previousState: this.previousState,
      metadata: this.metadata,
      stateHistory: this.stateHistory,
    };
  }
}

// ===========================
// Player States and Transitions
// ===========================

/**
 * Player State Enum
 */
const PlayerState = Object.freeze({
  CONNECTING: 'CONNECTING',     // Initial connection
  CONNECTED: 'CONNECTED',       // Connected but not in room
  JOINING: 'JOINING',           // Joining a room
  IN_LOBBY: 'IN_LOBBY',         // In room lobby, not ready
  READY: 'READY',               // Ready to play
  PLAYING: 'PLAYING',           // Actively playing
  SPECTATING: 'SPECTATING',     // Watching game
  DISCONNECTED: 'DISCONNECTED', // Temporarily disconnected
  LEFT: 'LEFT',                 // Permanently left
});

/**
 * Valid player state transitions
 */
const PlayerTransitions = Object.freeze({
  [PlayerState.CONNECTING]: [PlayerState.CONNECTED, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.CONNECTED]: [PlayerState.JOINING, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.JOINING]: [PlayerState.IN_LOBBY, PlayerState.CONNECTED, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.IN_LOBBY]: [PlayerState.READY, PlayerState.SPECTATING, PlayerState.CONNECTED, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.READY]: [PlayerState.IN_LOBBY, PlayerState.PLAYING, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.PLAYING]: [PlayerState.IN_LOBBY, PlayerState.SPECTATING, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.SPECTATING]: [PlayerState.IN_LOBBY, PlayerState.DISCONNECTED, PlayerState.LEFT],
  [PlayerState.DISCONNECTED]: [PlayerState.CONNECTED, PlayerState.IN_LOBBY, PlayerState.PLAYING, PlayerState.LEFT],
  [PlayerState.LEFT]: [], // Terminal state
});

/**
 * Player State Machine
 */
class PlayerStateMachine extends EventEmitter {
  constructor(playerId, socketId, initialState = PlayerState.CONNECTING) {
    super();
    this.playerId = playerId;
    this.socketId = socketId;
    this.currentState = initialState;
    this.previousState = null;
    this.stateHistory = [{ state: initialState, timestamp: Date.now() }];
    this.metadata = {};

    // Connection tracking
    this.connectionAttempts = 0;
    this.lastDisconnectTime = null;
    this.lastActiveTime = Date.now();
  }

  /**
   * Get current state
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check if state can transition to target
   */
  canTransition(targetState) {
    const allowedTransitions = PlayerTransitions[this.currentState] || [];
    return allowedTransitions.includes(targetState);
  }

  /**
   * Transition to new state
   */
  transition(targetState, metadata = {}) {
    if (!this.canTransition(targetState)) {
      throw new Error(
        `Invalid player state transition: ${this.currentState} -> ${targetState}. ` +
        `Allowed: ${PlayerTransitions[this.currentState]?.join(', ') || 'none'}`
      );
    }

    const previousState = this.currentState;
    this.previousState = previousState;
    this.currentState = targetState;
    this.metadata = metadata;

    // Update activity timestamp
    this.lastActiveTime = Date.now();

    // Track disconnections
    if (targetState === PlayerState.DISCONNECTED) {
      this.lastDisconnectTime = Date.now();
      this.connectionAttempts++;
    }

    // Record transition in history
    this.stateHistory.push({
      state: targetState,
      from: previousState,
      timestamp: Date.now(),
      metadata,
    });

    // Emit transition event
    this.emit('transition', {
      from: previousState,
      to: targetState,
      metadata,
    });

    // Emit specific state events
    this.emit(`enter:${targetState}`, { previousState, metadata });
    this.emit(`exit:${previousState}`, { targetState, metadata });

    return this;
  }

  /**
   * Check if currently in a specific state
   */
  is(state) {
    return this.currentState === state;
  }

  /**
   * Check if in any of the provided states
   */
  isAny(...states) {
    return states.includes(this.currentState);
  }

  /**
   * Check if player is active
   */
  isActive() {
    return !this.isAny(PlayerState.DISCONNECTED, PlayerState.LEFT);
  }

  /**
   * Check if player is in a room
   */
  isInRoom() {
    return this.isAny(
      PlayerState.JOINING,
      PlayerState.IN_LOBBY,
      PlayerState.READY,
      PlayerState.PLAYING,
      PlayerState.SPECTATING
    );
  }

  /**
   * Check if player can perform game actions
   */
  canPlay() {
    return this.currentState === PlayerState.PLAYING;
  }

  /**
   * Get time since last activity (ms)
   */
  getIdleTime() {
    return Date.now() - this.lastActiveTime;
  }

  /**
   * Get time since disconnect (ms), or null if not disconnected
   */
  getDisconnectDuration() {
    if (!this.lastDisconnectTime) return null;
    return Date.now() - this.lastDisconnectTime;
  }

  /**
   * Mark player as active (update activity timestamp)
   */
  markActive() {
    this.lastActiveTime = Date.now();
    return this;
  }

  /**
   * Update socket ID (on reconnect)
   */
  updateSocket(newSocketId) {
    const oldSocketId = this.socketId;
    this.socketId = newSocketId;
    this.emit('socketUpdate', { oldSocketId, newSocketId });
    return this;
  }

  /**
   * Get state history
   */
  getHistory() {
    return [...this.stateHistory];
  }

  /**
   * Serialize state for persistence or transmission
   */
  toJSON() {
    return {
      playerId: this.playerId,
      socketId: this.socketId,
      currentState: this.currentState,
      previousState: this.previousState,
      metadata: this.metadata,
      connectionAttempts: this.connectionAttempts,
      lastDisconnectTime: this.lastDisconnectTime,
      lastActiveTime: this.lastActiveTime,
      idleTime: this.getIdleTime(),
      stateHistory: this.stateHistory,
    };
  }
}

// ===========================
// Exports
// ===========================

module.exports = {
  // Room FSM
  RoomState,
  RoomTransitions,
  RoomStateMachine,

  // Player FSM
  PlayerState,
  PlayerTransitions,
  PlayerStateMachine,
};
