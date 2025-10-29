/**
 * Message Schemas with Zod
 *
 * Provides strict schema validation for all Socket.IO events.
 * All client messages are validated before processing to ensure:
 * - Type safety
 * - Input sanitization
 * - Protection against malformed data
 * - Versioning support
 */

const { z } = require('zod');

// ===========================
// Common Schema Helpers
// ===========================

// Room code: 6-character alphanumeric
const roomCodeSchema = z.string()
  .regex(/^[A-Z0-9]{6}$/, 'Room code must be 6 alphanumeric characters')
  .length(6, 'Room code must be exactly 6 characters');

// Game type identifier
const gameTypeSchema = z.string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Game type must be lowercase alphanumeric with hyphens');

// Player ID
const playerIdSchema = z.string()
  .min(1)
  .max(100);

// Display name
const displayNameSchema = z.string()
  .min(1, 'Display name required')
  .max(50, 'Display name too long')
  .regex(/^[a-zA-Z0-9_\- ]+$/, 'Display name contains invalid characters');

// Sequence number for replay protection
const sequenceNumberSchema = z.number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

// Version schema for protocol versioning
const versionSchema = z.string()
  .regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (x.y.z)')
  .default('1.0.0');

// ===========================
// Client-to-Server Events
// ===========================

/**
 * Create Game Event
 * Client requests to create a new game room
 */
const createGameSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    gameType: gameTypeSchema,
    mode: z.enum(['lan', 'p2p']).default('lan'),
    roomCode: roomCodeSchema.optional(),
    minPlayers: z.number().int().min(2).max(100).optional(),
    maxPlayers: z.number().int().min(2).max(100).optional(),
    options: z.record(z.any()).optional(), // Game-specific options
  }),
}).refine(
  data => !data.payload.maxPlayers || !data.payload.minPlayers || data.payload.maxPlayers >= data.payload.minPlayers,
  { message: 'maxPlayers must be greater than or equal to minPlayers' }
);

/**
 * Join Game Event
 * Client requests to join an existing room
 */
const joinGameSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    roomCode: roomCodeSchema,
    password: z.string().max(100).optional(),
  }),
});

/**
 * Player Ready Event
 * Client toggles ready state
 */
const playerReadySchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    ready: z.boolean().optional(), // If omitted, toggles
  }),
});

/**
 * Start Game Event
 * Host requests to start the game
 */
const startGameSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    forceStart: z.boolean().optional(), // Override ready checks
  }),
});

/**
 * Submit Move Event
 * Client submits a game action/command
 */
const submitMoveSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    type: z.string().min(1).max(50), // Command type (e.g., 'placeMark', 'bet')
    data: z.record(z.any()), // Command-specific data
    timestamp: z.number().int().positive().optional(), // Client timestamp
  }),
});

/**
 * Undo Move Event
 * Client requests to undo last action
 */
const undoMoveSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    confirm: z.boolean().default(true),
  }),
});

/**
 * Leave Game Event
 * Client requests to leave the room
 */
const leaveGameSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    reason: z.string().max(200).optional(),
  }),
});

/**
 * Chat Message Event
 * Client sends a chat message
 */
const chatMessageSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    message: z.string().min(1).max(500),
    type: z.enum(['text', 'emote', 'system']).default('text'),
  }),
});

/**
 * Ping Event
 * Client sends ping for latency measurement
 */
const pingSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    clientTime: z.number().int().positive(),
  }),
});

/**
 * Client State Sync Request
 * Client requests full state resync
 */
const requestSyncSchema = z.object({
  version: versionSchema,
  seq: sequenceNumberSchema.optional(),
  payload: z.object({
    reason: z.enum(['desync', 'reconnect', 'manual']).default('manual'),
  }),
});

// ===========================
// Server-to-Client Events
// ===========================

/**
 * Game State Update (Delta)
 * Server sends incremental state change
 */
const gameStateUpdateSchema = z.object({
  version: versionSchema,
  type: z.literal('delta'),
  serverTime: z.number().int().positive(),
  tick: z.number().int().min(0),
  delta: z.object({
    changes: z.array(z.object({
      path: z.string(), // JSON path to changed value
      value: z.any(),
      operation: z.enum(['set', 'delete', 'push', 'splice']),
    })),
  }),
  checksum: z.string().optional(), // Hash of full state for validation
});

/**
 * Game State Snapshot (Full)
 * Server sends complete game state
 */
const gameStateSnapshotSchema = z.object({
  version: versionSchema,
  type: z.literal('snapshot'),
  serverTime: z.number().int().positive(),
  tick: z.number().int().min(0),
  state: z.record(z.any()), // Full game state
  checksum: z.string().optional(),
});

/**
 * Room State Update
 * Server sends lobby/room metadata changes
 */
const roomStateUpdateSchema = z.object({
  version: versionSchema,
  roomCode: roomCodeSchema,
  state: z.object({
    players: z.array(z.object({
      id: playerIdSchema,
      displayName: displayNameSchema,
      isReady: z.boolean(),
      isHost: z.boolean(),
      avatarPath: z.string().optional(),
    })),
    gameType: gameTypeSchema,
    status: z.enum(['waiting', 'ready', 'playing', 'paused', 'ended']),
    minPlayers: z.number().int().min(2),
    maxPlayers: z.number().int().min(2),
  }),
});

/**
 * Error Event
 * Server sends error to client
 */
const errorSchema = z.object({
  version: versionSchema,
  error: z.object({
    code: z.string(), // Error code (e.g., 'ROOM_FULL', 'INVALID_MOVE')
    message: z.string(),
    details: z.record(z.any()).optional(),
    retryable: z.boolean().default(false),
  }),
});

/**
 * Pong Event
 * Server responds to ping
 */
const pongSchema = z.object({
  version: versionSchema,
  clientTime: z.number().int().positive(),
  serverTime: z.number().int().positive(),
});

// ===========================
// Schema Validation Helpers
// ===========================

/**
 * Validate message against schema
 *
 * @param {Object} schema - Zod schema
 * @param {Object} data - Data to validate
 * @returns {Object} { success: boolean, data: Object?, error: Object? }
 */
function validateMessage(schema, data) {
  try {
    const result = schema.parse(data);
    return { success: true, data: result, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid message format',
          details: error.errors,
        },
      };
    }

    return {
      success: false,
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Validation failed',
        details: { message: error.message },
      },
    };
  }
}

/**
 * Validate message with async support
 *
 * @param {Object} schema - Zod schema
 * @param {Object} data - Data to validate
 * @returns {Promise<Object>} Validation result
 */
async function validateMessageAsync(schema, data) {
  try {
    const result = await schema.parseAsync(data);
    return { success: true, data: result, error: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid message format',
          details: error.errors,
        },
      };
    }

    return {
      success: false,
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'Validation failed',
        details: { message: error.message },
      },
    };
  }
}

/**
 * Create a validator middleware for Socket.IO events
 *
 * @param {Object} schema - Zod schema
 * @returns {Function} Middleware function
 */
function createValidator(schema) {
  return (data, next) => {
    const result = validateMessage(schema, data);

    if (!result.success) {
      const error = new Error(result.error.message);
      error.code = result.error.code;
      error.details = result.error.details;
      return next(error);
    }

    // Replace data with validated/transformed data
    next(null, result.data);
  };
}

// ===========================
// Schema Registry
// ===========================

const schemas = {
  // Client-to-Server
  'createGame': createGameSchema,
  'joinGame': joinGameSchema,
  'playerReady': playerReadySchema,
  'startGame': startGameSchema,
  'submitMove': submitMoveSchema,
  'undoMove': undoMoveSchema,
  'leaveGame': leaveGameSchema,
  'chatMessage': chatMessageSchema,
  'ping': pingSchema,
  'requestSync': requestSyncSchema,

  // Server-to-Client
  'gameStateUpdate': gameStateUpdateSchema,
  'gameStateSnapshot': gameStateSnapshotSchema,
  'roomStateUpdate': roomStateUpdateSchema,
  'error': errorSchema,
  'pong': pongSchema,
};

/**
 * Get schema by event name
 *
 * @param {String} eventName - Event name
 * @returns {Object|null} Zod schema or null
 */
function getSchema(eventName) {
  return schemas[eventName] || null;
}

/**
 * Check if event has a schema
 *
 * @param {String} eventName - Event name
 * @returns {Boolean}
 */
function hasSchema(eventName) {
  return eventName in schemas;
}

module.exports = {
  // Schemas
  schemas,
  createGameSchema,
  joinGameSchema,
  playerReadySchema,
  startGameSchema,
  submitMoveSchema,
  undoMoveSchema,
  leaveGameSchema,
  chatMessageSchema,
  pingSchema,
  requestSyncSchema,
  gameStateUpdateSchema,
  gameStateSnapshotSchema,
  roomStateUpdateSchema,
  errorSchema,
  pongSchema,

  // Validation helpers
  validateMessage,
  validateMessageAsync,
  createValidator,
  getSchema,
  hasSchema,
};
