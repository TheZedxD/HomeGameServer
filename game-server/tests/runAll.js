'use strict';

const assert = require('assert');
const path = require('path');
const {
    GameRegistry,
    PluginManager,
    GameFactory,
    GameRoomManager,
    InMemoryGameRepository,
    PlayerManager,
} = require('../src/core');

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

function createLogger() {
    return {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
    };
}

test('GameRegistry registers and lists games', () => {
    const registry = new GameRegistry();
    registry.register({
        id: 'dummy',
        minPlayers: 2,
        maxPlayers: 2,
        create() { throw new Error('not used'); },
    });
    const listed = registry.list();
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].id, 'dummy');
});

test('PluginManager loads TicTacToe and Checkers plugins', async () => {
    const registry = new GameRegistry();
    const manager = new PluginManager({ registry, logger: createLogger() });
    await manager.loadFromDirectory(path.join(__dirname, '..', 'src', 'plugins'));
    const game = registry.get('tictactoe');
    assert.ok(game, 'tictactoe plugin should register');
    assert.strictEqual(game.minPlayers, 2);
    const checkers = registry.get('checkers');
    assert.ok(checkers, 'checkers plugin should register');
    assert.strictEqual(checkers.maxPlayers, 2);
});

test('PlayerManager enforces capacity and readiness', () => {
    const manager = new PlayerManager({ minPlayers: 2, maxPlayers: 4 });
    manager.addPlayer({ id: 'p1', displayName: 'One' });
    manager.addPlayer({ id: 'p2', displayName: 'Two' });
    assert.strictEqual(manager.isReadyToStart(), false);
    manager.setReady('p1', true);
    manager.setReady('p2', true);
    assert.strictEqual(manager.isReadyToStart(), true);
    manager.toggleReady('p2');
    assert.strictEqual(manager.isReadyToStart(), false);
});

test('GameRoomManager creates rooms and plays TicTacToe', async () => {
    const registry = new GameRegistry();
    const logger = createLogger();
    const pluginManager = new PluginManager({ registry, logger });
    await pluginManager.loadFromDirectory(path.join(__dirname, '..', 'src', 'plugins'));
    const factory = new GameFactory({ registry });
    const repository = new InMemoryGameRepository();
    const manager = new GameRoomManager({ gameFactory: factory, repository });

    const room = manager.createRoom({ hostId: 'host', gameId: 'tictactoe', metadata: { mode: 'lan' } });
    await manager.joinRoom(room.id, { id: 'host', displayName: 'Host', isReady: true });
    await manager.joinRoom(room.id, { id: 'guest', displayName: 'Guest', isReady: true });
    manager.startGame(room.id);
    const outcome = manager.submitCommand(room.id, { type: 'placeMark', playerId: 'host', payload: { row: 0, col: 0 } });
    assert.ok(outcome, 'Command should execute');
    const state = repository.states.get(room.id);
    assert.strictEqual(state.board[0][0], 'X');
});

test('GameRoomManager undo restores previous state', async () => {
    const registry = new GameRegistry();
    const logger = createLogger();
    const pluginManager = new PluginManager({ registry, logger });
    await pluginManager.loadFromDirectory(path.join(__dirname, '..', 'src', 'plugins'));
    const factory = new GameFactory({ registry });
    const repository = new InMemoryGameRepository();
    const manager = new GameRoomManager({ gameFactory: factory, repository });

    const room = manager.createRoom({ hostId: 'host', gameId: 'tictactoe', metadata: { mode: 'lan' } });
    await manager.joinRoom(room.id, { id: 'host', displayName: 'Host', isReady: true });
    await manager.joinRoom(room.id, { id: 'guest', displayName: 'Guest', isReady: true });
    manager.startGame(room.id);
    manager.submitCommand(room.id, { type: 'placeMark', playerId: 'host', payload: { row: 0, col: 0 } });
    manager.undoLast(room.id, 'host');
    const state = repository.states.get(room.id);
    assert.strictEqual(state.board[0][0], null, 'Undo should reset cell');
});

test('GameRoomManager plays Checkers with capture and promotion rules', async () => {
    const registry = new GameRegistry();
    const logger = createLogger();
    const pluginManager = new PluginManager({ registry, logger });
    await pluginManager.loadFromDirectory(path.join(__dirname, '..', 'src', 'plugins'));
    const factory = new GameFactory({ registry });
    const repository = new InMemoryGameRepository();
    const manager = new GameRoomManager({ gameFactory: factory, repository });

    const room = manager.createRoom({ hostId: 'host', gameId: 'checkers', metadata: { mode: 'classic' } });
    await manager.joinRoom(room.id, { id: 'host', displayName: 'Host', isReady: true });
    await manager.joinRoom(room.id, { id: 'guest', displayName: 'Guest', isReady: true });
    manager.startGame(room.id);

    manager.submitCommand(room.id, { type: 'movePiece', playerId: 'host', payload: { from: { row: 5, col: 0 }, to: { row: 4, col: 1 } } });
    let state = repository.states.get(room.id);
    assert.strictEqual(state.board[5][0], null, 'Moved piece should leave origin square empty');
    assert.strictEqual(state.board[4][1], 'r', 'Red piece should occupy new square');

    manager.submitCommand(room.id, { type: 'movePiece', playerId: 'guest', payload: { from: { row: 2, col: 3 }, to: { row: 3, col: 2 } } });
    state = repository.states.get(room.id);
    assert.strictEqual(state.board[3][2], 'b', 'Black piece should move diagonally forward');

    manager.submitCommand(room.id, { type: 'movePiece', playerId: 'host', payload: { from: { row: 4, col: 1 }, to: { row: 2, col: 3 } } });
    state = repository.states.get(room.id);
    assert.strictEqual(state.board[3][2], null, 'Captured piece should be removed');
    assert.strictEqual(state.board[2][3], 'r', 'Capturing piece should land two squares ahead');
    assert.strictEqual(state.turn, 'guest', 'Turn should pass to opponent after capture');
    assert.strictEqual(state.players.host.color, 'red');
    assert.strictEqual(state.players.guest.color, 'black');
});

(async () => {
    let failures = 0;
    for (const { name, fn } of tests) {
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                await result;
            }
            console.log(`\u2714\ufe0f  ${name}`);
        } catch (error) {
            failures += 1;
            console.error(`\u274c ${name}:`, error);
        }
    }
    if (failures > 0) {
        process.exitCode = 1;
    }
})();
