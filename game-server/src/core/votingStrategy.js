/**
 * VotingStrategy
 * Shared strategy for handling post-game voting
 */

const { VotingManager } = require('./votingManager');

class VotingStrategy {
  execute({ state, playerManager, playerId, payload = {} }) {
    const player = playerManager.get(playerId);
    if (!player) {
      return { error: 'Player not found' };
    }

    // Check if game is complete
    if (!state.isComplete) {
      return { error: 'Game must be complete before voting' };
    }

    const { vote } = payload;
    if (!vote) {
      return { error: 'Vote is required' };
    }

    return {
      apply(current) {
        const next = JSON.parse(JSON.stringify(current));

        // Initialize voting if not already started
        if (!next.votingPhase) {
          next.votingPhase = true;
          next.votes = {};
          next._votingManager = new VotingManager(next.playerOrder);
        }

        // Record the vote
        const votingManager = next._votingManager;
        const voteResult = votingManager.vote(playerId, vote);

        if (voteResult.error) {
          return { error: voteResult.error };
        }

        // Update votes in state
        next.votes = votingManager.getVotes();

        // If voting complete, set the result
        if (voteResult.complete) {
          next.votingComplete = true;
          next.votingResult = voteResult.result;

          // The room manager will handle the actual transition
          // based on votingResult (newGame or lobby)
        }

        return next;
      },
      getUndo() {
        return { error: 'Undo not supported for voting' };
      }
    };
  }
}

module.exports = { VotingStrategy };
