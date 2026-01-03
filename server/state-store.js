const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const PLAYER_SCORES_FILE = path.join(DATA_DIR, 'player_scores.json');
const PLAYER_SCORES_BACKUP = path.join(DATA_DIR, 'player_scores.json.bak');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.jsonl');
const STAGE_COMPLETIONS_FILE = path.join(DATA_DIR, 'stage_completions.json');
const COLLISION_LOG_FILE = path.join(DATA_DIR, 'collisions.jsonl');
const PLATFORM_HITS_FILE = path.join(DATA_DIR, 'platform_hits.jsonl');

const MAX_STORED_SCORES = 10000;
const CHECKPOINT_RETENTION_DAYS = 30;
const COLLISION_LOG_BUFFER_SIZE = 10000;
const AUDIT_LOG_MAX_ENTRIES = 100000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function computeChecksum(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function validateData(data, expectedSchema) {
  if (!data || typeof data !== 'object') return false;
  if (expectedSchema === 'playerScores') {
    return typeof data === 'object' && data !== null;
  }
  if (expectedSchema === 'leaderboard') {
    return Array.isArray(data);
  }
  return true;
}

function sanitizeScore(score) {
  if (typeof score !== 'number') return 0;
  if (score < 0) return 0;
  if (score > 999999) return 999999;
  return Math.floor(score);
}

function sanitizeLives(lives) {
  if (typeof lives !== 'number') return 3;
  if (lives < 0) return 0;
  if (lives > 9) return 9;
  return Math.floor(lives);
}

function sanitizeDeaths(deaths) {
  if (typeof deaths !== 'number') return 0;
  if (deaths < 0) return 0;
  if (deaths > 999) return 999;
  return Math.floor(deaths);
}

function writeAtomically(filePath, data) {
  const tmpFile = filePath + '.tmp';
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpFile, serialized, 'utf8');
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, filePath + '.bak');
  }
  fs.renameSync(tmpFile, filePath);
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return null;
    return JSON.parse(content);
  } catch (e) {
    console.error(`[DATA_INTEGRITY] Failed to read ${path.basename(filePath)}: ${e.message}`);
    return null;
  }
}

class DataStore {
  constructor() {
    ensureDataDir();
    this.playerScores = new Map();
    this.leaderboard = [];
    this.playerStageCompletions = new Map();
    this.collisionLogBuffer = [];
    this.nextPlayerIdCounter = 1;
    this.writeQueue = [];
    this.isProcessingQueue = false;
    this.auditLogEntries = 0;
    this.lastAuditLogDate = null;

    this.loadPlayerScores();
    this.loadLeaderboard();
    this.loadStageCompletions();
    this.cleanupOldAuditLogs();
  }

  loadPlayerScores() {
    const data = safeReadJson(PLAYER_SCORES_FILE);
    if (data) {
      if (data.version === 1 && data.scores) {
        for (const [playerId, score] of Object.entries(data.scores)) {
          const sanitized = sanitizeScore(score);
          this.playerScores.set(parseInt(playerId), sanitized);
        }
        const maxId = Math.max(...Array.from(this.playerScores.keys()), 0);
        this.nextPlayerIdCounter = maxId + 1;
      }
    }
  }

  loadLeaderboard() {
    const data = safeReadJson(LEADERBOARD_FILE);
    if (Array.isArray(data)) {
      this.leaderboard = data
        .filter(entry => typeof entry.player_id === 'number' && typeof entry.score === 'number')
        .map(entry => ({
          player_id: entry.player_id,
          score: sanitizeScore(entry.score),
          timestamp: entry.timestamp || Date.now()
        }))
        .sort((a, b) => b.score - a.score || a.player_id - b.player_id);
    }
  }

  loadStageCompletions() {
    const data = safeReadJson(STAGE_COMPLETIONS_FILE);
    if (data && typeof data === 'object') {
      for (const [playerId, stages] of Object.entries(data)) {
        if (Array.isArray(stages)) {
          this.playerStageCompletions.set(parseInt(playerId), stages);
        }
      }
    }
  }

  assignPlayerId() {
    const id = this.nextPlayerIdCounter++;
    this.playerScores.set(id, 0);
    this.queueWrite('playerScores', this.getPlayerScoresForPersist());
    return id;
  }

  recordPlayerJoin(playerId, username = `player_${playerId}`) {
    this.appendAuditLog({
      type: 'player_join',
      player_id: playerId,
      username,
      timestamp: Date.now(),
      frame: 0
    });
  }

  recordPlayerDisconnect(playerId) {
    this.appendAuditLog({
      type: 'player_disconnect',
      player_id: playerId,
      timestamp: Date.now(),
      frame: 0
    });
  }

  recordGoal(playerId, stage, frame, score) {
    this.appendAuditLog({
      type: 'goal',
      player_id: playerId,
      stage,
      frame,
      score: sanitizeScore(score),
      timestamp: Date.now()
    });
    this.addStageCompletion(playerId, stage);
  }

  recordDeath(playerId, frame) {
    this.appendAuditLog({
      type: 'death',
      player_id: playerId,
      frame,
      timestamp: Date.now()
    });
  }

  recordCollision(frame, actor1, actor2, result) {
    const entry = {
      frame,
      actor1: actor1.substring(0, 64),
      actor2: actor2.substring(0, 64),
      result,
      timestamp: Date.now()
    };
    this.collisionLogBuffer.push(entry);
    if (this.collisionLogBuffer.length > COLLISION_LOG_BUFFER_SIZE) {
      this.collisionLogBuffer.shift();
    }
    if (this.collisionLogBuffer.length % 1000 === 0) {
      this.flushCollisionLog();
    }
  }

  recordPlatformHit(frame, platformId, hitNum) {
    this.appendAuditLog({
      type: 'platform_hit',
      platform_id: platformId.substring(0, 64),
      hit_num: Math.max(0, Math.min(999, hitNum)),
      frame,
      timestamp: Date.now()
    });
  }

  recordEnemyDirectionChange(frame, enemyId, direction) {
    this.appendAuditLog({
      type: 'enemy_direction',
      enemy_id: enemyId.substring(0, 64),
      direction: direction === -1 ? -1 : 1,
      frame,
      timestamp: Date.now()
    });
  }

  addStageCompletion(playerId, stage) {
    if (!this.playerStageCompletions.has(playerId)) {
      this.playerStageCompletions.set(playerId, []);
    }
    const stages = this.playerStageCompletions.get(playerId);
    if (!stages.includes(stage)) {
      stages.push(stage);
    }
    this.queueWrite('stageCompletions', this.getStageCompletionsForPersist());
  }

  updatePlayerScore(playerId, newScore) {
    const sanitized = sanitizeScore(newScore);
    this.playerScores.set(playerId, sanitized);
    this.updateLeaderboard(playerId, sanitized);
    this.queueWrite('playerScores', this.getPlayerScoresForPersist());
    this.queueWrite('leaderboard', this.getLeaderboardForPersist());
  }

  updateLeaderboard(playerId, score) {
    const existingIdx = this.leaderboard.findIndex(e => e.player_id === playerId);
    if (existingIdx >= 0) {
      this.leaderboard[existingIdx].score = score;
      this.leaderboard[existingIdx].timestamp = Date.now();
    } else {
      this.leaderboard.push({ player_id: playerId, score, timestamp: Date.now() });
    }
    this.leaderboard.sort((a, b) => b.score - a.score || a.player_id - b.player_id);
  }

  getPlayerScoresForPersist() {
    const scores = {};
    for (const [playerId, score] of this.playerScores) {
      scores[playerId] = sanitizeScore(score);
    }
    return { version: 1, scores, checksum: computeChecksum(scores) };
  }

  getLeaderboardForPersist() {
    return this.leaderboard.map(e => ({
      player_id: e.player_id,
      score: sanitizeScore(e.score),
      timestamp: e.timestamp
    })).slice(0, 100);
  }

  getStageCompletionsForPersist() {
    const completions = {};
    for (const [playerId, stages] of this.playerStageCompletions) {
      completions[playerId] = stages;
    }
    return completions;
  }

  getLeaderboard(limit = 100) {
    return this.leaderboard.slice(0, Math.min(limit, 100));
  }

  getPlayerScore(playerId) {
    return sanitizeScore(this.playerScores.get(playerId) || 0);
  }

  getStageCompletions(playerId) {
    return this.playerStageCompletions.get(playerId) || [];
  }

  createSnapshot() {
    return {
      timestamp: Date.now(),
      playerScores: new Map(this.playerScores),
      leaderboard: [...this.leaderboard],
      stageCompletions: new Map(this.playerStageCompletions)
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    try {
      this.playerScores = new Map(snapshot.playerScores);
      this.leaderboard = Array.isArray(snapshot.leaderboard) ? [...snapshot.leaderboard] : [];
      this.playerStageCompletions = new Map(snapshot.stageCompletions);
      this.queueWrite('playerScores', this.getPlayerScoresForPersist());
      this.queueWrite('leaderboard', this.getLeaderboardForPersist());
      this.queueWrite('stageCompletions', this.getStageCompletionsForPersist());
      return true;
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Snapshot restore failed: ${e.message}`);
      return false;
    }
  }

  appendAuditLog(event) {
    if (!event || typeof event !== 'object') return;
    if (typeof event.timestamp !== 'number') event.timestamp = Date.now();
    if (typeof event.type !== 'string') return;

    const today = new Date().toISOString().split('T')[0];
    if (this.lastAuditLogDate && this.lastAuditLogDate !== today) {
      this.lastAuditLogDate = today;
    } else if (!this.lastAuditLogDate) {
      this.lastAuditLogDate = today;
    }

    const currentLog = this.lastAuditLogDate ?
      path.join(DATA_DIR, `audit.${this.lastAuditLogDate}.jsonl`) :
      AUDIT_LOG_FILE;

    try {
      fs.appendFileSync(currentLog, JSON.stringify(event) + '\n', 'utf8');
      this.auditLogEntries++;
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Failed to append audit log: ${e.message}`);
    }
  }

  flushCollisionLog() {
    if (this.collisionLogBuffer.length === 0) return;
    try {
      const lines = this.collisionLogBuffer.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(COLLISION_LOG_FILE, lines, 'utf8');
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Failed to flush collision log: ${e.message}`);
    }
  }

  queueWrite(dataType, data) {
    this.writeQueue.push({ dataType, data, timestamp: Date.now() });
    this.processWriteQueue();
  }

  processWriteQueue() {
    if (this.isProcessingQueue || this.writeQueue.length === 0) return;
    this.isProcessingQueue = true;

    const batch = this.writeQueue.splice(0, 10);

    try {
      for (const { dataType, data } of batch) {
        if (dataType === 'playerScores') {
          writeAtomically(PLAYER_SCORES_FILE, data);
        } else if (dataType === 'leaderboard') {
          writeAtomically(LEADERBOARD_FILE, data);
        } else if (dataType === 'stageCompletions') {
          writeAtomically(STAGE_COMPLETIONS_FILE, data);
        }
      }
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Write queue processing failed: ${e.message}`);
    } finally {
      this.isProcessingQueue = false;
      if (this.writeQueue.length > 0) {
        setImmediate(() => this.processWriteQueue());
      }
    }
  }

  cleanupOldAuditLogs() {
    try {
      const files = fs.readdirSync(DATA_DIR);
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        if (file.startsWith('audit.') && file.endsWith('.jsonl')) {
          const filePath = path.join(DATA_DIR, file);
          const stats = fs.statSync(filePath);
          if (stats.mtime.getTime() < thirtyDaysAgo) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Cleanup failed: ${e.message}`);
    }
  }

  validateLoadedData(data, schema) {
    if (!data) return null;
    if (schema === 'playerScores' && data.scores) {
      const validated = {};
      for (const [id, score] of Object.entries(data.scores)) {
        validated[id] = sanitizeScore(score);
      }
      return { version: 1, scores: validated, checksum: computeChecksum(validated) };
    }
    if (schema === 'leaderboard' && Array.isArray(data)) {
      return data
        .filter(e => typeof e.player_id === 'number' && typeof e.score === 'number')
        .map(e => ({
          player_id: e.player_id,
          score: sanitizeScore(e.score),
          timestamp: e.timestamp || Date.now()
        }));
    }
    return data;
  }

  getBackupPath(filePath) {
    return filePath + '.bak';
  }

  restoreFromBackup(filePath) {
    const backupPath = this.getBackupPath(filePath);
    try {
      if (fs.existsSync(backupPath)) {
        const content = fs.readFileSync(backupPath, 'utf8');
        writeAtomically(filePath, JSON.parse(content));
        return true;
      }
    } catch (e) {
      console.error(`[DATA_INTEGRITY] Backup restore failed for ${path.basename(filePath)}: ${e.message}`);
    }
    return false;
  }

  getSizeEstimate() {
    const playerScoresSize = Buffer.byteLength(JSON.stringify(this.getPlayerScoresForPersist()));
    const leaderboardSize = Buffer.byteLength(JSON.stringify(this.getLeaderboardForPersist()));
    return {
      playerScores: playerScoresSize,
      leaderboard: leaderboardSize,
      totalBytes: playerScoresSize + leaderboardSize,
      playerCount: this.playerScores.size
    };
  }

  listAuditLogs() {
    try {
      return fs.readdirSync(DATA_DIR)
        .filter(f => f.startsWith('audit') && f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: path.join(DATA_DIR, f),
          stat: fs.statSync(path.join(DATA_DIR, f))
        }));
    } catch (e) {
      return [];
    }
  }
}

module.exports = { DataStore, sanitizeScore, sanitizeLives, sanitizeDeaths, computeChecksum };
