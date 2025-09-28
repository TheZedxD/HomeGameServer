'use strict';

const EventEmitter = require('events');

class Command {
    constructor({ type, payload, playerId }) {
        if (!type) {
            throw new Error('Command requires a type.');
        }
        this.type = type;
        this.payload = payload || {};
        this.playerId = playerId || null;
    }

    execute(/* context */) {
        throw new Error('execute() must be implemented.');
    }

    undo(/* context */) {
        throw new Error('undo() must be implemented.');
    }
}

class CommandBus extends EventEmitter {
    constructor({ stateManager, ruleEngine, playerManager }) {
        super();
        this.stateManager = stateManager;
        this.ruleEngine = ruleEngine;
        this.playerManager = playerManager;
        this.history = [];
    }

    dispatch(commandDescriptor) {
        const descriptor = normalizeDescriptor(commandDescriptor);
        const handler = this.ruleEngine.getStrategy(descriptor.type);
        if (!handler) {
            throw new Error(`No command handler for type ${descriptor.type}`);
        }
        const context = {
            state: this.stateManager.snapshot().state,
            playerManager: this.playerManager,
            playerId: descriptor.playerId,
            payload: descriptor.payload,
        };
        const outcome = handler.execute(context);
        if (!outcome || typeof outcome !== 'object') {
            throw new Error('Command handler must return an outcome object.');
        }
        if (outcome.error) {
            throw new Error(outcome.error);
        }
        if (typeof outcome.apply === 'function') {
            const nextState = outcome.apply(this.stateManager.snapshot().state);
            this.stateManager.replace(nextState, { command: descriptor });
        } else if (outcome.state) {
            this.stateManager.replace(outcome.state, { command: descriptor });
        }
        if (typeof outcome.getUndo === 'function') {
            this.history.push({ descriptor, undo: outcome.getUndo() });
        } else if (typeof outcome.undo === 'function') {
            this.history.push({ descriptor, undo: () => outcome.undo(this.stateManager) });
        }
        this.emit('commandExecuted', { descriptor, outcome });
        return outcome;
    }

    undoLast(playerId) {
        if (!this.history.length) {
            return null;
        }
        const last = this.history.pop();
        if (playerId && last.descriptor.playerId !== playerId) {
            this.history.push(last);
            throw new Error('Only the issuing player can undo this command.');
        }
        const undoResult = last.undo();
        if (undoResult?.state) {
            this.stateManager.replace(undoResult.state, { undoOf: last.descriptor });
        }
        this.emit('commandUndone', { descriptor: last.descriptor });
        return undoResult;
    }
}

function normalizeDescriptor(descriptor = {}) {
    const { type, payload, playerId } = descriptor;
    if (!type) {
        throw new Error('Command descriptor requires a type.');
    }
    return { type, payload: payload || {}, playerId: playerId || null };
}

module.exports = {
    Command,
    CommandBus,
};
