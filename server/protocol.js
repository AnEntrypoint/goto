const crypto = require('crypto');
const zlib = require('zlib');

const PROTOCOL_VERSION = 1.1;
const SESSION_TTL = 1800000;
const RATE_LIMIT = 60;
const RATE_WINDOW = 1000;
const MSG_SIZE_LIMIT = 1024;
const COMPRESSION_THRESHOLD = 500;
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 30000;
const IDLE_TIMEOUT = 300000;
const TIMESTAMP_SKEW = 5000;
const MAX_SEQ = 65535;
const REPLAY_WINDOW = 60000;

const MESSAGE_TYPES = {
  HELLO: 0x00,
  AUTH: 0x01,
  INIT: 0x02,
  UPDATE: 0x03,
  GOAL: 0x04,
  STAGELOAD: 0x05,
  SPAWN: 0x06,
  REMOVE: 0x07,
  PAUSE: 0x08,
  RESUME: 0x09,
  GAME_WON: 0x0A,
  HEARTBEAT: 0x0B,
  INPUT: 0x0C,
  ACK: 0x0D,
  HEARTBEAT_RESPONSE: 0x0E,
  BATCH: 0x0F,
  ERROR: 0x10,
  PROTOCOL_UPGRADE: 0x11,
  RATE_LIMIT_WARNING: 0x12,
  SESSION_EXPIRED: 0x13,
  HELLO_ACK: 0x14
};

const CLIENT_TYPES = new Set(['HELLO', 'AUTH', 'INPUT', 'ACK', 'HEARTBEAT_RESPONSE', 'BATCH']);
const REQUIRED_FIELDS = {
  HELLO: ['data'],
  AUTH: ['data'],
  INPUT: ['data'],
  ACK: ['data'],
  HEARTBEAT_RESPONSE: ['data'],
  BATCH: ['data']
};

class ProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'ProtocolError';
  }
}

function fnv32(data) {
  let hash = 0x811c9dc5;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function validateTimestamp(ts) {
  const now = Date.now();
  const skew = Math.abs(now - ts);
  if (skew > TIMESTAMP_SKEW) {
    throw new ProtocolError('TIMESTAMP_INVALID', `Time skew ${skew}ms exceeds ${TIMESTAMP_SKEW}ms`, { skew, max: TIMESTAMP_SKEW });
  }
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&'"]/g, '');
}

function validateDirection(dir) {
  if (typeof dir !== 'number' || !isFinite(dir) || ![-1, 0, 1].includes(dir)) {
    throw new ProtocolError('INVALID_INPUT', 'Direction must be -1, 0, or 1', { received: dir, expected: '[-1, 0, 1]' });
  }
}

function validateAction(action) {
  const valid = ['move', 'jump', 'pause', 'resume', 'nextstage'];
  if (typeof action !== 'string' || !valid.includes(action)) {
    throw new ProtocolError('INVALID_INPUT', `Action must be one of: ${valid.join(', ')}`, { received: action, expected: valid });
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.replayLog = new Map();
  }

  create(clientId) {
    const sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
    this.sessions.set(sessionId, {
      sessionId,
      clientId,
      createdAt: Date.now(),
      expiryTime: Date.now() + SESSION_TTL,
      lastActivity: Date.now()
    });
    return sessionId;
  }

  validate(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiryTime < Date.now()) {
      throw new ProtocolError('SESSION_EXPIRED', 'Session token expired or invalid', { reason: 'timeout' });
    }
    session.lastActivity = Date.now();
    return session;
  }

  extend(sessionId) {
    const session = this.validate(sessionId);
    session.expiryTime = Date.now() + SESSION_TTL;
  }

  delete(sessionId) {
    this.sessions.delete(sessionId);
  }

  isReplayed(sessionId, seq) {
    const key = `${sessionId}:${seq}`;
    if (this.replayLog.has(key)) {
      throw new ProtocolError('DUPLICATE_REQUEST', 'Duplicate message detected', { seq, sessionId });
    }
    this.replayLog.set(key, Date.now());
  }

  cleanup() {
    const now = Date.now();
    for (const [key, time] of this.replayLog) {
      if (now - time > REPLAY_WINDOW) {
        this.replayLog.delete(key);
      }
    }
  }
}

class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  check(sessionId, vipToken = null) {
    if (vipToken && vipToken.startsWith('vip_')) {
      return { limited: false, remaining: 1000 };
    }

    const now = Date.now();
    if (!this.buckets.has(sessionId)) {
      this.buckets.set(sessionId, { window: now, count: 0 });
    }

    const bucket = this.buckets.get(sessionId);
    if (now - bucket.window >= RATE_WINDOW) {
      bucket.window = now;
      bucket.count = 0;
    }

    bucket.count++;
    const remaining = Math.max(0, RATE_LIMIT - bucket.count);
    const limited = bucket.count > RATE_LIMIT;

    return { limited, remaining, resetTime: bucket.window + RATE_WINDOW };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.window > RATE_WINDOW * 10) {
        this.buckets.delete(key);
      }
    }
  }
}

class ProtocolHandler {
  constructor() {
    this.sessions = new SessionManager();
    this.rateLimiter = new RateLimiter();
    this.awaitingAck = new Map();
    this.lastHeartbeat = new Map();
  }

  buildMessage(type, data, seq = 0, sessionId = 'server') {
    const checksum = fnv32(data);
    return {
      version: PROTOCOL_VERSION,
      type,
      seq,
      ts: Date.now(),
      checksum,
      sessionId,
      data
    };
  }

  buildError(code, message, details = {}, correlationId = null, sessionId = 'server') {
    return this.buildMessage('ERROR', {
      code,
      message,
      details,
      correlationId,
      timestamp: Date.now()
    }, 0, sessionId);
  }

  async parseMessage(rawData) {
    if (!rawData || rawData.length > MSG_SIZE_LIMIT) {
      throw new ProtocolError('MESSAGE_TOO_LARGE', `Message exceeds ${MSG_SIZE_LIMIT} bytes`, { size: rawData.length, limit: MSG_SIZE_LIMIT });
    }

    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch (e) {
      throw new ProtocolError('INVALID_INPUT', 'Failed to parse JSON', { error: e.message });
    }

    if (!data || typeof data !== 'object') {
      throw new ProtocolError('INVALID_INPUT', 'Message must be an object');
    }

    if (!data.type || typeof data.type !== 'string') {
      throw new ProtocolError('INVALID_MESSAGE_TYPE', 'Message type missing or invalid');
    }

    if (!CLIENT_TYPES.has(data.type)) {
      throw new ProtocolError('INVALID_MESSAGE_TYPE', `Unknown message type: ${data.type}`, { received: data.type, allowed: Array.from(CLIENT_TYPES) });
    }

    const requiredFields = REQUIRED_FIELDS[data.type] || [];
    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new ProtocolError('MISSING_FIELD', `Missing required field: ${field}`, { field, type: data.type });
      }
    }

    if (data.version) {
      if (typeof data.version !== 'number' || ![1.0, 1.1].includes(data.version)) {
        throw new ProtocolError('PROTOCOL_VERSION_MISMATCH', 'Unsupported protocol version', { requested: data.version, supported: [1.0, 1.1] });
      }
    }

    if (data.ts && typeof data.ts === 'number') {
      validateTimestamp(data.ts);
    }

    if (data.checksum && typeof data.checksum === 'string') {
      const computed = fnv32(data.data);
      if (computed !== data.checksum) {
        throw new ProtocolError('INVALID_CHECKSUM', 'Checksum mismatch', { expected: computed, received: data.checksum });
      }
    }

    let payload = data.data;
    if (data.compressed && typeof data.data === 'string') {
      try {
        payload = JSON.parse(zlib.inflateSync(Buffer.from(data.data, 'base64')).toString());
      } catch (e) {
        throw new ProtocolError('COMPRESSION_FAILED', 'Decompression failed', { error: e.message });
      }
    }

    return { type: data.type, data: payload, version: data.version || 1.0, seq: data.seq || 0, sessionId: data.sessionId, ts: data.ts, vipToken: data.vipToken };
  }

  async validateClientMessage(msg, sessionId) {
    if (msg.type === 'HELLO') {
      return;
    }

    if (!sessionId) {
      throw new ProtocolError('AUTHENTICATION_FAILED', 'Missing session ID', { reason: 'missing_session_id' });
    }

    this.sessions.validate(sessionId);

    if (msg.seq && msg.sessionId === sessionId) {
      this.sessions.isReplayed(sessionId, msg.seq);
    }

    const limit = this.rateLimiter.check(sessionId, msg.vipToken);
    if (limit.limited) {
      throw new ProtocolError('RATE_LIMIT', 'Rate limit exceeded', { limit: RATE_LIMIT, window: RATE_WINDOW, resetTime: limit.resetTime });
    }
  }

  validateInputMessage(action, direction) {
    validateAction(action);
    if (action === 'move') {
      validateDirection(direction);
    }
  }

  async compressIfNeeded(msg) {
    const str = JSON.stringify(msg);
    if (str.length > COMPRESSION_THRESHOLD) {
      const compressed = await new Promise((resolve, reject) => {
        zlib.deflate(Buffer.from(str), (err, result) => {
          if (err) reject(err);
          else resolve(result.toString('base64'));
        });
      });
      return {
        ...msg,
        compressed: true,
        data: compressed
      };
    }
    return msg;
  }

  recordHeartbeat(sessionId) {
    this.lastHeartbeat.set(sessionId, Date.now());
  }

  checkHeartbeatTimeout(sessionId) {
    const last = this.lastHeartbeat.get(sessionId);
    if (!last) return false;
    return Date.now() - last > HEARTBEAT_TIMEOUT;
  }

  cleanup() {
    this.sessions.cleanup();
    this.rateLimiter.cleanup();
  }
}

module.exports = {
  ProtocolHandler,
  SessionManager,
  RateLimiter,
  ProtocolError,
  fnv32,
  sanitizeString,
  validateDirection,
  validateAction,
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  CONSTANTS: {
    SESSION_TTL,
    RATE_LIMIT,
    RATE_WINDOW,
    MSG_SIZE_LIMIT,
    COMPRESSION_THRESHOLD,
    HEARTBEAT_INTERVAL,
    HEARTBEAT_TIMEOUT,
    IDLE_TIMEOUT,
    TIMESTAMP_SKEW,
    MAX_SEQ
  }
};
