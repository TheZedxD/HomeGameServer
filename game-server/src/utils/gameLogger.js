'use strict';

/**
 * Game State and Turn Tracking Logger
 *
 * Specialized logging for game events, turn tracking, and state changes
 * to help debug multiplayer game issues.
 */

const { createLogger } = require('./logger');

class GameLogger {
  constructor(roomId, gameId) {
    this.roomId = roomId;
    this.gameId = gameId;
    this.logger = createLogger({
      component: 'GameState',
      roomId,
      gameId
    });
    this.turnHistory = [];
  }

  /**
   * Log game initialization
   */
  logGameStart(players, initialState) {
    this.logger.info({
      event: 'game_start',
      playerCount: players.length,
      players: players.map(p => ({ id: p.id, name: p.displayName })),
      initialState: this._sanitizeState(initialState)
    }, `[${this.gameId}] Game started with ${players.length} players`);
  }

  /**
   * Log turn progression
   */
  logTurn(playerId, currentPlayerId, turnData = {}) {
    const turnEntry = {
      timestamp: Date.now(),
      playerId,
      currentPlayerId,
      isValidTurn: playerId === currentPlayerId,
      ...turnData
    };

    this.turnHistory.push(turnEntry);

    // Keep only last 50 turns
    if (this.turnHistory.length > 50) {
      this.turnHistory.shift();
    }

    this.logger.info({
      event: 'turn_check',
      playerId,
      currentPlayerId,
      isValidTurn: turnEntry.isValidTurn,
      turnNumber: this.turnHistory.length,
      ...turnData
    }, `[${this.gameId}] Turn check: player ${playerId} ${turnEntry.isValidTurn ? '✓' : '✗'} (current: ${currentPlayerId})`);
  }

  /**
   * Log move submission
   */
  logMove(playerId, command, success, error = null) {
    this.logger.info({
      event: 'move_submitted',
      playerId,
      command: command.type || command.action,
      commandData: this._sanitizeCommand(command),
      success,
      error: error ? error.message : null
    }, `[${this.gameId}] Move by ${playerId}: ${command.type || command.action} ${success ? '✓' : '✗'}`);
  }

  /**
   * Log state changes
   */
  logStateChange(oldState, newState, reason) {
    const changes = this._detectStateChanges(oldState, newState);

    if (changes.length > 0) {
      this.logger.debug({
        event: 'state_change',
        reason,
        changes,
        newTurn: newState.currentPlayerId || newState.turn,
        round: newState.round,
        isComplete: newState.isComplete
      }, `[${this.gameId}] State changed: ${reason} (${changes.length} changes)`);
    }
  }

  /**
   * Log game completion
   */
  logGameEnd(winner, finalState) {
    this.logger.info({
      event: 'game_end',
      winner,
      totalTurns: this.turnHistory.length,
      finalState: this._sanitizeState(finalState)
    }, `[${this.gameId}] Game ended - Winner: ${winner || 'none'}`);

    // Log turn history summary
    this.logger.debug({
      event: 'game_summary',
      turnHistory: this.turnHistory
    }, `[${this.gameId}] Turn history: ${this.turnHistory.length} turns`);
  }

  /**
   * Log errors
   */
  logError(playerId, error, context = {}) {
    this.logger.error({
      event: 'game_error',
      playerId,
      error: error.message || error,
      stack: error.stack,
      ...context
    }, `[${this.gameId}] Error: ${error.message || error}`);
  }

  /**
   * Log player actions
   */
  logPlayerAction(playerId, action, data = {}) {
    this.logger.info({
      event: 'player_action',
      playerId,
      action,
      ...data
    }, `[${this.gameId}] Player ${playerId}: ${action}`);
  }

  /**
   * Log room events
   */
  logRoomEvent(event, data = {}) {
    this.logger.info({
      event: `room_${event}`,
      ...data
    }, `[${this.gameId}] Room event: ${event}`);
  }

  /**
   * Get turn history for debugging
   */
  getTurnHistory() {
    return this.turnHistory;
  }

  /**
   * Sanitize state for logging (remove large arrays, sensitive data)
   */
  _sanitizeState(state) {
    if (!state || typeof state !== 'object') return state;

    const sanitized = {};

    for (const [key, value] of Object.entries(state)) {
      // Include important state properties
      if (['currentPlayerId', 'turn', 'turnColor', 'round', 'isComplete',
           'isRoundComplete', 'playerOrder', 'activePlayerId', 'phase'].includes(key)) {
        sanitized[key] = value;
      }
      // Include player count but not full player data
      else if (key === 'players') {
        sanitized.playerCount = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize command for logging
   */
  _sanitizeCommand(command) {
    if (!command || typeof command !== 'object') return command;

    const { type, action, from, to, position, move, bet, card } = command;
    return { type, action, from, to, position, move, bet, card };
  }

  /**
   * Detect changes between states
   */
  _detectStateChanges(oldState, newState) {
    const changes = [];

    if (!oldState || !newState) return changes;

    const keysToCheck = ['currentPlayerId', 'turn', 'turnColor', 'round',
                         'phase', 'isComplete', 'isRoundComplete'];

    for (const key of keysToCheck) {
      if (oldState[key] !== newState[key]) {
        changes.push({
          property: key,
          from: oldState[key],
          to: newState[key]
        });
      }
    }

    return changes;
  }
}

/**
 * Create a game logger instance
 */
function createGameLogger(roomId, gameId) {
  return new GameLogger(roomId, gameId);
}

module.exports = {
  GameLogger,
  createGameLogger
};
