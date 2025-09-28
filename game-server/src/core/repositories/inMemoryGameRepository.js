'use strict';

class InMemoryGameRepository {
    constructor() {
        this.states = new Map();
    }

    async save(roomId, state) {
        this.states.set(roomId, state);
        return state;
    }

    async get(roomId) {
        return this.states.get(roomId) || null;
    }

    async remove(roomId) {
        this.states.delete(roomId);
    }
}

module.exports = InMemoryGameRepository;
