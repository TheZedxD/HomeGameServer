'use strict';

/**
 * Session Manager for Player Reconnection
 *
 * Tracks player sessions to allow reconnection after disconnects
 */

class SessionManager {
  constructor(sessionTimeoutMs = 300000) { // 5 minutes default
    this.sessions = new Map(); // socketId -> { username, roomId, lastSeen, playerData }
    this.usernameSessions = new Map(); // username -> socketId
    this.sessionTimeoutMs = sessionTimeoutMs;

    // Cleanup stale sessions periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 60000); // Check every minute
  }

  /**
   * Register a new session or update existing one
   */
  registerSession(socketId, username, roomId = null, playerData = {}) {
    const session = {
      socketId,
      username,
      roomId,
      playerData,
      lastSeen: Date.now(),
      createdAt: this.sessions.get(socketId)?.createdAt || Date.now()
    };

    this.sessions.set(socketId, session);
    this.usernameSessions.set(username, socketId);

    return session;
  }

  /**
   * Update session activity
   */
  updateActivity(socketId) {
    const session = this.sessions.get(socketId);
    if (session) {
      session.lastSeen = Date.now();
    }
  }

  /**
   * Get session by socket ID
   */
  getSession(socketId) {
    return this.sessions.get(socketId);
  }

  /**
   * Get session by username (for reconnection)
   */
  getSessionByUsername(username) {
    const socketId = this.usernameSessions.get(username);
    return socketId ? this.sessions.get(socketId) : null;
  }

  /**
   * Update room ID for a session
   */
  setSessionRoom(socketId, roomId) {
    const session = this.sessions.get(socketId);
    if (session) {
      session.roomId = roomId;
      session.lastSeen = Date.now();
    }
  }

  /**
   * Check if a username has an active session
   */
  hasActiveSession(username) {
    const session = this.getSessionByUsername(username);
    if (!session) return false;

    const age = Date.now() - session.lastSeen;
    return age < this.sessionTimeoutMs;
  }

  /**
   * Attempt to reconnect a player to their previous session
   */
  attemptReconnect(newSocketId, username) {
    const oldSession = this.getSessionByUsername(username);

    if (!oldSession) {
      return { canReconnect: false, reason: 'No previous session found' };
    }

    const age = Date.now() - oldSession.lastSeen;
    if (age >= this.sessionTimeoutMs) {
      // Session expired, clean it up
      this.removeSession(oldSession.socketId);
      return { canReconnect: false, reason: 'Session expired' };
    }

    // Transfer session to new socket ID
    const reconnectedSession = {
      ...oldSession,
      socketId: newSocketId,
      oldSocketId: oldSession.socketId,
      lastSeen: Date.now(),
      reconnectedAt: Date.now()
    };

    // Remove old session
    this.sessions.delete(oldSession.socketId);

    // Create new session with same data
    this.sessions.set(newSocketId, reconnectedSession);
    this.usernameSessions.set(username, newSocketId);

    return {
      canReconnect: true,
      session: reconnectedSession,
      roomId: oldSession.roomId,
      playerData: oldSession.playerData
    };
  }

  /**
   * Remove a session
   */
  removeSession(socketId) {
    const session = this.sessions.get(socketId);
    if (session) {
      this.sessions.delete(socketId);
      // Only remove username mapping if it points to this socket
      if (this.usernameSessions.get(session.username) === socketId) {
        this.usernameSessions.delete(session.username);
      }
    }
  }

  /**
   * Clean up sessions that have expired
   */
  cleanupStaleSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [socketId, session] of this.sessions.entries()) {
      const age = now - session.lastSeen;
      if (age >= this.sessionTimeoutMs) {
        this.removeSession(socketId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[SessionManager] Cleaned up ${cleaned} stale session(s)`);
    }
  }

  /**
   * Get statistics about sessions
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(s => {
        const age = Date.now() - s.lastSeen;
        return age < this.sessionTimeoutMs;
      }).length,
      sessionsWithRooms: Array.from(this.sessions.values()).filter(s => s.roomId).length
    };
  }

  /**
   * Shutdown - clean up resources
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    this.usernameSessions.clear();
  }
}

module.exports = { SessionManager };
