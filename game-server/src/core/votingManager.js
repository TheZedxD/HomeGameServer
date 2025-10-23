/**
 * VotingManager
 * Handles post-game voting for "new game" vs "return to lobby"
 *
 * Voting Rules:
 * - All players must vote
 * - Majority wins
 * - Ties go to lobby
 * - 2 players: if either votes lobby, go to lobby
 */

class VotingManager {
  constructor(playerIds) {
    this.playerIds = [...playerIds];
    this.votes = {}; // { playerId: 'newGame' | 'lobby' }
    this.result = null;
  }

  /**
   * Record a player's vote
   * @param {string} playerId
   * @param {string} vote - 'newGame' or 'lobby'
   * @returns {{error?: string, complete?: boolean, result?: string}}
   */
  vote(playerId, vote) {
    if (!this.playerIds.includes(playerId)) {
      return { error: 'Player not in game' };
    }

    if (this.result !== null) {
      return { error: 'Voting already complete' };
    }

    if (vote !== 'newGame' && vote !== 'lobby') {
      return { error: 'Invalid vote. Must be "newGame" or "lobby"' };
    }

    // Record the vote
    this.votes[playerId] = vote;

    // Check if voting is complete
    const allVoted = this.playerIds.every(pid => this.votes[pid] !== undefined);

    if (allVoted) {
      this.result = this.calculateResult();
      return { complete: true, result: this.result };
    }

    return { complete: false };
  }

  /**
   * Calculate the voting result based on rules
   * @returns {string} - 'newGame' or 'lobby'
   */
  calculateResult() {
    const voteCount = { newGame: 0, lobby: 0 };

    // Count votes
    Object.values(this.votes).forEach(vote => {
      voteCount[vote]++;
    });

    // Special case: 2 players
    if (this.playerIds.length === 2) {
      // If either player votes lobby, go to lobby
      if (voteCount.lobby > 0) {
        return 'lobby';
      }
      return 'newGame';
    }

    // General case: Majority rules
    if (voteCount.newGame > voteCount.lobby) {
      return 'newGame';
    } else if (voteCount.lobby > voteCount.newGame) {
      return 'lobby';
    } else {
      // Tie: go to lobby
      return 'lobby';
    }
  }

  /**
   * Get current vote counts
   * @returns {{newGame: number, lobby: number}}
   */
  getVoteCounts() {
    const counts = { newGame: 0, lobby: 0 };
    Object.values(this.votes).forEach(vote => {
      counts[vote]++;
    });
    return counts;
  }

  /**
   * Check if all players have voted
   * @returns {boolean}
   */
  isComplete() {
    return this.playerIds.every(pid => this.votes[pid] !== undefined);
  }

  /**
   * Get the final result (null if not complete)
   * @returns {string | null}
   */
  getResult() {
    return this.result;
  }

  /**
   * Get all votes
   * @returns {Object}
   */
  getVotes() {
    return { ...this.votes };
  }

  /**
   * Get players who haven't voted yet
   * @returns {string[]}
   */
  getPendingPlayers() {
    return this.playerIds.filter(pid => this.votes[pid] === undefined);
  }
}

module.exports = { VotingManager };
