const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Engine, World, Body, Events, Composite } = require('matter-js');

const PORT = process.env.PORT || 3008;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
if (Math.abs(TICK_MS - 16.666666666666668) > 0.01) {
  throw new Error(`Tick rate mismatch: TICK_MS=${TICK_MS}, expected ~16.67ms`);
}

const MSG_TYPES = {
  INIT: 0,
  UPDATE: 1,
  GOAL: 2,
  STAGELOAD: 3,
  SPAWN: 4,
  REMOVE: 5,
  PAUSE: 6,
  RESUME: 7,
  GAME_WON: 8
};
const MSG_TYPE_VALUES = Object.values(MSG_TYPES);
if (new Set(MSG_TYPE_VALUES).size !== MSG_TYPE_VALUES.length) {
  throw new Error('MSG_TYPES contains duplicate values');
}

const PHYSICS = {
  GRAVITY: 1200,
  JUMP_VELOCITY: -450,
  PLAYER_SPEED: 200,
  ENEMY_SPEED: 120,
  MAX_FALL_SPEED: 800,
  INVULNERABILITY_TIME: 1.5,
  RESPAWN_TIME: 5
};
if (PHYSICS.GRAVITY <= 0 || PHYSICS.MAX_FALL_SPEED <= 0 || PHYSICS.PLAYER_SPEED <= 0 ||
    PHYSICS.ENEMY_SPEED <= 0 || PHYSICS.INVULNERABILITY_TIME <= 0 || PHYSICS.RESPAWN_TIME <= 0 ||
    PHYSICS.JUMP_VELOCITY >= 0) {
  throw new Error('Invalid PHYSICS constants: gravity/speed/times must be positive, jump_velocity must be negative');
}

const STATE_SCHEMAS = {
  player: {
    fields: ['player_id', 'speed', 'on_ground', 'lives', 'deaths', 'respawn_time', 'invulnerable', 'score', 'stage_time', '_coyote_counter', '_respawn_frames_remaining', '_invulnerable_frames_remaining'],
    defaults: { player_id: 0, speed: 200, on_ground: true, lives: 3, deaths: 0, respawn_time: 0, invulnerable: 0, score: 0, stage_time: 0, _coyote_counter: 0, _respawn_frames_remaining: 0, _invulnerable_frames_remaining: 0 }
  },
  enemy: {
    fields: ['speed', 'patrol_dir', 'on_ground', '_coyote_counter'],
    defaults: { speed: 120, patrol_dir: -1, on_ground: true, _coyote_counter: 0 }
  },
  platform: {
    fields: ['width'],
    defaults: { width: 32 }
  },
  breakable_platform: {
    fields: ['width', 'hit_count', 'max_hits'],
    defaults: { width: 32, hit_count: 0, max_hits: 3 }
  }
};
if (STATE_SCHEMAS.player.defaults.lives < 0 || STATE_SCHEMAS.player.defaults.speed < 0 ||
    STATE_SCHEMAS.enemy.defaults.speed < 0 || STATE_SCHEMAS.breakable_platform.defaults.max_hits < 1 ||
    STATE_SCHEMAS.platform.defaults.width < 1) {
  throw new Error('Invalid STATE_SCHEMAS defaults: must be non-negative and sensible');
}

function validateLevelFiles() {
  for (let i = 1; i <= 4; i++) {
    const filePath = path.join(__dirname, '..', 'game', `levels/stage${i}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Level file not found: ${filePath}`);
    }
  }
}
validateLevelFiles();

function buildInitMessage(playerId, stage, levelName, goal, frame, actors, paused = false) {
  return [MSG_TYPES.INIT, { playerId, stage, levelName, goal, frame, actors, paused }];
}

function buildUpdateMessage(version, frame, stage, actors) {
  return [MSG_TYPES.UPDATE, { version, frame, stage, actors }];
}

function buildGoalMessage(playerId, stage, frame) {
  return [MSG_TYPES.GOAL, { playerId, stage, frame }];
}

function buildStageloadMessage(stage, levelName, goal, actors, frame, paused = false) {
  return [MSG_TYPES.STAGELOAD, { stage, levelName, goal, actors, frame, paused }];
}

function buildGameWonMessage(totalScore, frame) {
  return [MSG_TYPES.GAME_WON, { totalScore, frame }];
}

function buildPauseMessage(frame) {
  return [MSG_TYPES.PAUSE, { frame }];
}

function buildResumeMessage(frame) {
  return [MSG_TYPES.RESUME, { frame }];
}

function computeStateChecksum(actors) {
  let hash = 2166136261;
  let actorCount = 0;
  for (const [name, actor] of actors) {
    if (actor.state.removed) continue;
    actorCount++;
    const x = Math.round(actor.body.position.x);
    const y = Math.round(actor.body.position.y);
    const vx = Math.round(actor.body.velocity.x);
    const vy = Math.round(actor.body.velocity.y);
    hash ^= x; hash = (hash * 16777619) >>> 0;
    hash ^= y; hash = (hash * 16777619) >>> 0;
    hash ^= vx; hash = (hash * 16777619) >>> 0;
    hash ^= vy; hash = (hash * 16777619) >>> 0;
    if (actor.type === 'player') {
      const lives = actor.state.lives || 0;
      const score = actor.state.score || 0;
      const deaths = actor.state.deaths || 0;
      hash ^= lives; hash = (hash * 16777619) >>> 0;
      hash ^= score; hash = (hash * 16777619) >>> 0;
      hash ^= deaths; hash = (hash * 16777619) >>> 0;
    } else if (actor.type === 'breakable_platform') {
      const hitCount = actor.state.hit_count || 0;
      hash ^= hitCount; hash = (hash * 16777619) >>> 0;
    }
  }
  hash ^= actorCount; hash = (hash * 16777619) >>> 0;
  return hash;
}

function normalizeDirection(dir) {
  if (typeof dir !== 'number') return 0;
  return dir > 0 ? 1 : dir < 0 ? -1 : 0;
}

function serializeActorState(actor) {
  if (!actor || !actor.body) {
    const name = actor?.name || 'unknown';
    console.error(`[SERIAL] ERROR: Invalid actor for serialization: ${name}, skipping`);
    return null;
  }
  if (!isFinite(actor.body.position.x) || !isFinite(actor.body.position.y) ||
      !isFinite(actor.body.velocity.x) || !isFinite(actor.body.velocity.y)) {
    console.error(`[SERIAL] ERROR: Invalid position/velocity NaN: ${actor.name}, skipping`);
    return null;
  }
  const base = {
    n: actor.name,
    t: actor.type,
    x: Math.round(actor.body.position.x * 10) / 10,
    y: Math.round(actor.body.position.y * 10) / 10,
    vx: Math.round(actor.body.velocity.x * 10) / 10,
    vy: Math.round(actor.body.velocity.y * 10) / 10
  };

  const state = actor.state;
  if (actor.type === 'player') {
    base.p = state.player_id || 0;
    base.l = state.lives !== undefined ? state.lives : 3;
    base.s = state.score || 0;
    base.d = state.deaths || 0;
    base.rt = Math.round((state.respawn_time || 0) * 10) / 10;
    base.iv = Math.round((state.invulnerable || 0) * 10) / 10;
    base.og = state.on_ground ? 1 : 0;
    base.spd = state.speed || 200;
  } else if (actor.type === 'enemy') {
    base.og = state.on_ground ? 1 : 0;
    const pd = state.patrol_dir;
    if (typeof pd !== 'number' || (pd !== 1 && pd !== -1)) {
      console.warn(`[SERIAL] WARN: Enemy patrol_dir invalid ${pd}, using -1`);
      base.pd = -1;
    } else {
      base.pd = pd;
    }
    base.spd = state.speed || 120;
  } else if (actor.type === 'platform') {
    base.w = state.width || 32;
  } else if (actor.type === 'breakable_platform') {
    base.w = state.width || 32;
    base.hc = state.hit_count || 0;
    base.mh = state.max_hits || 3;
    base.removed = actor.state.removed ? 1 : 0;
  }

  return base;
}

function serializeActorFull(actor) {
  if (!actor || !actor.body) {
    const name = actor?.name || 'unknown';
    console.error(`[SERIAL] ERROR: Invalid actor for full serialization: ${name}, skipping`);
    return null;
  }
  if (!isFinite(actor.body.position.x) || !isFinite(actor.body.position.y) ||
      !isFinite(actor.body.velocity.x) || !isFinite(actor.body.velocity.y)) {
    console.error(`[SERIAL] ERROR: Invalid position/velocity NaN in full serialization: ${actor.name}, skipping`);
    return null;
  }
  if (!isFinite(actor.net_id) || actor.net_id < 1 || actor.net_id > 2147483647) {
    console.error(`[SERIAL] ERROR: Invalid net_id ${actor.net_id} for ${actor.name}, skipping`);
    return null;
  }
  const base = {
    name: actor.name,
    type: actor.type,
    net_id: actor.net_id,
    pos: [actor.body.position.x, actor.body.position.y],
    vel: [actor.body.velocity.x, actor.body.velocity.y],
    state: {}
  };

  const state = actor.state;
  if (actor.type === 'player') {
    base.state = {
      player_id: state.player_id,
      lives: state.lives,
      score: state.score,
      deaths: state.deaths,
      on_ground: state.on_ground,
      speed: state.speed || 200,
      invulnerable: state.invulnerable || 0,
      respawn_time: state.respawn_time || 0
    };
  } else if (actor.type === 'enemy') {
    base.state = {
      on_ground: state.on_ground,
      patrol_dir: state.patrol_dir,
      speed: state.speed || 120
    };
  } else if (actor.type === 'platform') {
    base.state = {
      width: state.width || 32
    };
  } else if (actor.type === 'breakable_platform') {
    base.state = {
      width: state.width || 32,
      hit_count: state.hit_count || 0,
      max_hits: state.max_hits || 3
    };
  }

  return base;
}


class PhysicsGame {
  constructor() {
    this.engine = Engine.create();
    this.engine.world.gravity.y = 0;
    this.engine.world.gravity.x = 0;
    this.actors = new Map();
    this.bodies = new Map();
    this.clients = new Map();
    this.playerActors = new Map();
    this.nextNetId = 1;
    this.frame = 0;
    this.stage = 1;
    this.level = null;
    this.pendingInput = new Map();
    this.heldInput = new Map();
    this.paused = false;
    this.pausedPlayers = new Set();
    this.lastActorState = new Map();
    this.stage_transitioning = false;
    this.loading = false;
    this.inputRateLimit = new Map();
    this.stageTransitionTimeouts = [];
    this.MAX_ACTORS = 1500;
    this.loadStage(1);
  }

  clearStageTransitionTimeouts() {
    for (const timeoutId of this.stageTransitionTimeouts) {
      clearTimeout(timeoutId);
    }
    this.stageTransitionTimeouts.length = 0;
  }

  loadStage(stageNum) {
    this.loading = true;
    this.stage = stageNum;
    this.clearStageTransitionTimeouts();
    const savedPlayers = new Map();
    try {
      for (const [playerId, actor] of this.playerActors) {
        if (!actor || actor.state.removed) continue;
        if (typeof actor.state.lives !== 'number') actor.state.lives = 3;
        if (typeof actor.state.score !== 'number') actor.state.score = 0;
        if (typeof actor.state.deaths !== 'number') actor.state.deaths = 0;
        if (typeof actor.state.stage_time !== 'number') actor.state.stage_time = 0;
        savedPlayers.set(playerId, {
          player_id: playerId,
          lives: actor.state.lives,
          score: actor.state.score,
          deaths: actor.state.deaths,
          stage_time: actor.state.stage_time
        });
      }
    } catch (e) {
      console.error(`[LOAD_SAVE_PLAYERS] Stage ${stageNum}: ${e.message}`);
      savedPlayers.clear();
    }

    try {
      this.actors.clear();
      this.playerActors.clear();
      const bodiesToRemove = Array.from(this.bodies.values());
      for (const b of bodiesToRemove) {
        try {
          World.remove(this.engine.world, b);
        } catch (e) {
          console.error(`[LOAD_BODY_REMOVE] Failed to remove body: ${e.message}`);
        }
      }
      this.bodies.clear();
      this.lastActorState.clear();
      this.pausedPlayers.clear();
      this.frame = 0;
      this.stage_over = false;
      this.stage_over_time = 0;
      this.level = null;
    } catch (e) {
      console.error(`[LOAD_CLEAR] Stage ${stageNum}: ${e.message}`);
    }

    const levelPath = `levels/stage${stageNum}.json`;
    try {
      const filePath = path.join(__dirname, '..', 'game', levelPath);
      if (!fs.existsSync(filePath)) throw new Error(`Level file not found: ${filePath}`);
      const stats = fs.statSync(filePath);
      if (stats.size > 10485760) throw new Error(`Level file too large: ${stats.size} bytes (max 10MB)`);
      const data = fs.readFileSync(filePath, 'utf8');
      this.level = JSON.parse(data);
      if (!this.level || typeof this.level !== 'object') throw new Error('Invalid level format');
      if (typeof this.level.name !== 'string' || this.level.name.length > 100) this.level.name = `Stage ${stageNum}`;
      if (!this.level.goal || typeof this.level.goal.x !== 'number' || typeof this.level.goal.y !== 'number' ||
          this.level.goal.x < 0 || this.level.goal.x > 1280 || this.level.goal.y < 0 || this.level.goal.y > 720) {
        throw new Error(`Invalid level goal: ${JSON.stringify(this.level.goal)}`);
      }
    } catch (e) {
      console.error(`[LOAD_FILE] Failed to load stage ${stageNum}: ${e.message}`);
      this.level = { name: 'Error', platforms: [], enemies: [], goal: { x: 640, y: 360 } };
    }

    const MAX_PLATFORMS = 1000;
    const MAX_ENEMIES = 500;
    let platformCount = 0;
    if (Array.isArray(this.level.platforms)) {
      for (const p of this.level.platforms) {
        if (platformCount >= MAX_PLATFORMS) {
          console.warn(`[LOAD] Platform limit (${MAX_PLATFORMS}) reached`);
          break;
        }
        try {
          if (!p || typeof p !== 'object') {
            console.warn(`[LOAD_PLATFORM] Invalid platform object`);
            continue;
          }
          if (typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y) ||
              p.x < 0 || p.x > 1280 || p.y < 0 || p.y > 720) {
            console.warn(`[LOAD_PLATFORM] Invalid position: x=${p.x}, y=${p.y}`);
            continue;
          }
          const width = typeof p.width === 'number' && p.width > 0 && p.width <= 256 ? p.width : 32;
          const max_hits = typeof p.max_hits === 'number' && p.max_hits > 0 ? p.max_hits : 3;
          const isBreakable = p.breakable === true;
          const actor = this.spawn(isBreakable ? 'breakable_platform' : 'platform', [p.x, p.y], { max_hits, width });
          if (actor) platformCount++;
        } catch (e) {
          console.error(`[LOAD_PLATFORM] Error: ${e.message}`);
        }
      }
    }

    let enemyCount = 0;
    if (Array.isArray(this.level.enemies)) {
      for (const e of this.level.enemies) {
        if (enemyCount >= MAX_ENEMIES) {
          console.warn(`[LOAD] Enemy limit (${MAX_ENEMIES}) reached`);
          break;
        }
        try {
          if (!e || typeof e !== 'object') {
            console.warn(`[LOAD_ENEMY] Invalid enemy object`);
            continue;
          }
          if (typeof e.x !== 'number' || typeof e.y !== 'number' || !isFinite(e.x) || !isFinite(e.y) ||
              e.x < 0 || e.x > 1280 || e.y < 0 || e.y > 720) {
            console.warn(`[LOAD_ENEMY] Invalid position: x=${e.x}, y=${e.y}`);
            continue;
          }
          const speed = typeof e.speed === 'number' && e.speed > 0 && e.speed <= 500 ? e.speed : 120;
          const dir = e.patrol_dir !== undefined ? e.patrol_dir : e.dir;
          const patrol_dir = typeof dir === 'number' && (dir === 1 || dir === -1) ? dir : -1;
          const actor = this.spawn('enemy', [e.x, e.y], { speed, patrol_dir });
          if (actor) enemyCount++;
        } catch (e) {
          console.error(`[LOAD_ENEMY] Error: ${e.message}`);
        }
      }
    }

    try {
      for (const [playerId, playerState] of savedPlayers) {
        try {
          const spawnPos = this.getSpawnPosition(playerId);
          if (!spawnPos || !Array.isArray(spawnPos) || spawnPos.length < 2 ||
              typeof spawnPos[0] !== 'number' || typeof spawnPos[1] !== 'number') {
            console.error(`[LOAD_PLAYER] Invalid spawn position for player ${playerId}`);
            continue;
          }
          const playerSpawnExtra = {
            player_id: playerId,
            lives: Math.max(0, playerState.lives || 3),
            score: Math.max(0, playerState.score || 0),
            deaths: Math.max(0, playerState.deaths || 0),
            stage_time: Math.max(0, playerState.stage_time || 0)
          };
          this.spawn('player', spawnPos, playerSpawnExtra);
        } catch (e) {
          console.error(`[LOAD_PLAYER] Error for player ${playerId}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[LOAD_PLAYERS] Error: ${e.message}`);
    }

    try {
      this.pendingInput.clear();
      this.heldInput.clear();
    } catch (e) {
      console.error(`[LOAD_INPUT_CLEAR] Error: ${e.message}`);
    }
    this.loading = false;
  }

  spawn(type, pos, extra = {}) {
    if (typeof type !== 'string') {
      console.error(`[SPAWN] Invalid actor type (not string): ${type}`);
      return null;
    }
    const schema = STATE_SCHEMAS[type];
    if (!schema) {
      console.error(`[SPAWN] Unknown actor type: ${type}`);
      return null;
    }

    if (this.actors.size >= this.MAX_ACTORS) {
      console.error(`[SPAWN] Actor limit (${this.MAX_ACTORS}) reached, rejecting ${type}`);
      return null;
    }

    if (!Array.isArray(pos) || pos.length < 2 || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
      console.error(`[SPAWN] Invalid position for ${type}: ${JSON.stringify(pos)}`);
      return null;
    }

    let width = Math.max(1, extra.width || 32);
    let height = (type === 'platform' || type === 'breakable_platform') ? 16 : 32;
    if (height <= 0) height = 16;
    if (width <= 0) width = 32;
    const isStatic = type === 'platform' || type === 'breakable_platform';

    const body = Body.create({
      position: { x: pos[0], y: pos[1] },
      isStatic,
      friction: isStatic ? 0.5 : 0,
      restitution: 0,
      label: `${type}_${this.nextNetId}`,
      collisionFilter: { category: type === 'player' ? 1 : 2 }
    });
    body._width = width;
    body._height = height;
    body._prevPos = { x: pos[0], y: pos[1] };

    World.add(this.engine.world, body);

    const state = { removed: false };
    const allowedFields = new Set(schema.fields);
    for (const field of schema.fields) {
      if (extra.hasOwnProperty(field) && allowedFields.has(field)) {
        state[field] = extra[field];
      } else if (schema.defaults.hasOwnProperty(field)) {
        state[field] = schema.defaults[field];
      }
    }
    for (const field in extra) {
      if (!allowedFields.has(field)) {
        console.warn(`[SPAWN] Rejected invalid field "${field}" for type "${type}"`);
      }
    }
    if (type === 'platform' || type === 'breakable_platform') {
      state.width = width;
    }
    if (type === 'player' || type === 'enemy') {
      if (typeof state.speed !== 'number' || state.speed <= 0) {
        state.speed = type === 'player' ? PHYSICS.PLAYER_SPEED : PHYSICS.ENEMY_SPEED;
      }
    }
    if (type === 'enemy' && state.patrol_dir !== -1 && state.patrol_dir !== 1) {
      state.patrol_dir = -1;
    }
    if (type === 'player') {
      state._goal_reached = false;
      state._landed_this_frame = false;
    }
    if (type === 'breakable_platform') {
      state._hit_this_frame = new Set();
    }

    if (this.nextNetId > 2147483647) {
      console.error(`[NETID_OVERFLOW] net_id counter reset`);
      this.nextNetId = 1;
    }
    const actor = {
      name: body.label,
      type,
      net_id: this.nextNetId++,
      body,
      state
    };

    this.actors.set(actor.name, actor);
    this.bodies.set(actor.name, body);

    if (type === 'player' && extra.player_id !== undefined && extra.player_id !== null) {
      this.playerActors.set(extra.player_id, actor);
    }

    return actor;
  }

  tick() {
    const wasPaused = this.paused;
    if (!wasPaused) {
      if (this.frame >= 2147483647) {
        console.error(`[FRAME_OVERFLOW] Frame ${this.frame} would overflow, resetting to 0`);
        this.frame = 0;
      }
      this.frame++;
      const frameSnapshot = this.frame;

      try {
        this.processPendingInput();
      } catch (e) {
        console.error(`[TICK_INPUT_ERROR] Frame ${frameSnapshot}: ${e.message}`);
        this.pendingInput.clear();
        this.heldInput.clear();
      }

      try {
        this.updateRespawns();
      } catch (e) {
        console.error(`[TICK_RESPAWN_ERROR] Frame ${frameSnapshot}: ${e.message}`);
      }

      try {
        this.updateActors();
      } catch (e) {
        console.error(`[TICK_UPDATE_ERROR] Frame ${frameSnapshot}: ${e.message}`);
      }

      let actorSnapshot = [];
      try {
        actorSnapshot = Array.from(this.actors.entries());
      } catch (e) {
        console.error(`[TICK_SNAPSHOT_ERROR] Frame ${frameSnapshot}: ${e.message}`);
        actorSnapshot = [];
      }

      for (const [name, actor] of actorSnapshot) {
        if (!actor || !actor.body || actor.state.removed) continue;
        if (actor.body._prevPos) {
          actor.body._prevPos.x = actor.body.position.x;
          actor.body._prevPos.y = actor.body.position.y;
        } else {
          actor.body._prevPos = { x: actor.body.position.x, y: actor.body.position.y };
        }
      }

      for (const [name, actor] of actorSnapshot) {
        if (!actor || !actor.body || actor.state.removed) continue;
        try {
          const vx = actor.body.velocity.x;
          const vy = actor.body.velocity.y;
          if (!isFinite(vx) || !isFinite(vy)) {
            console.error(`[NAN_VELOCITY] Actor ${name} has NaN velocity: ${vx}, ${vy}`);
            actor.state.removed = true;
            continue;
          }
          const newX = actor.body.position.x + vx * (TICK_MS / 1000);
          const newY = actor.body.position.y + vy * (TICK_MS / 1000);
          if (!isFinite(newX) || !isFinite(newY)) {
            console.error(`[NAN_POSITION] Actor ${name} position would be NaN: ${newX}, ${newY}`);
            actor.state.removed = true;
            continue;
          }
          actor.body.position.x = newX;
          actor.body.position.y = newY;
          if (actor.body.position.x < -1000 || actor.body.position.x > 2280 ||
              actor.body.position.y < -1000 || actor.body.position.y > 1720) {
            console.error(`[BOUNDS] Actor ${name} out of bounds: ${actor.body.position.x}, ${actor.body.position.y}`);
            actor.state.removed = true;
          }
        } catch (e) {
          console.error(`[TICK_PHYSICS_ERROR] Actor ${name}: ${e.message}`);
          actor.state.removed = true;
        }
      }

      try {
        this.checkCollisions(actorSnapshot);
      } catch (e) {
        console.error(`[TICK_COLLISION_ERROR] Frame ${frameSnapshot}: ${e.message}`);
      }

      try {
        if (!this.paused) {
          this.checkGoal(frameSnapshot);
        }
      } catch (e) {
        console.error(`[TICK_GOAL_ERROR] Frame ${frameSnapshot}: ${e.message}`);
      }

      try {
        this.updateGameState(frameSnapshot);
      } catch (e) {
        console.error(`[TICK_GAMESTATE_ERROR] Frame ${frameSnapshot}: ${e.message}`);
      }

      this._tickFrameSnapshot = frameSnapshot;
    }

    try {
      this.removeDeadActors();
    } catch (e) {
      console.error(`[TICK_CLEANUP_ERROR] Frame ${this.frame}: ${e.message}`);
    }
  }

  processPendingInput() {
    if (this.loading) return;
    for (const [playerId, input] of this.pendingInput) {
      if (!input || typeof input !== 'object') {
        console.error(`[INPUT] Invalid input object for player ${playerId}`);
        continue;
      }
      const actor = this.playerActors.get(playerId);
      if (!actor || actor.state.removed || actor.state.respawn_time > 0) {
        continue;
      }
      if (input.action === 'move') {
        if (typeof input.direction !== 'number') {
          console.warn(`[INPUT] Move action has non-number direction for player ${playerId}: ${input.direction}`);
          continue;
        }
        const rawDir = input.direction;
        if (!isFinite(rawDir)) {
          console.error(`[INPUT] Direction is not finite for player ${playerId}: ${rawDir}`);
          continue;
        }
        const dir = normalizeDirection(rawDir);
        if (dir === 0) {
          this.heldInput.delete(playerId);
        } else {
          this.heldInput.set(playerId, { action: 'move', direction: dir });
        }
      } else if (input.action === 'jump') {
        if (actor && actor.body && (actor.state.on_ground || actor.state._coyote_counter < 6)) {
          actor.body.velocity.y = PHYSICS.JUMP_VELOCITY;
          actor.state._coyote_counter = 6;
        }
      } else {
        console.warn(`[INPUT] Unknown action for player ${playerId}: ${input.action}`);
      }
    }
    this.pendingInput.clear();

    for (const [playerId, input] of this.heldInput) {
      if (!input || typeof input !== 'object') {
        this.heldInput.delete(playerId);
        continue;
      }
      const actor = this.playerActors.get(playerId);
      if (!actor || !actor.body || actor.state.removed || actor.state.respawn_time > 0) continue;
      if (input.action === 'move') {
        const dir = input.direction;
        if (typeof dir !== 'number' || !isFinite(dir)) {
          console.warn(`[INPUT] Held move direction invalid for player ${playerId}: ${dir}`);
          continue;
        }
        if (!isFinite(actor.state.speed) || actor.state.speed <= 0) {
          console.error(`[INPUT] Player ${playerId} has invalid speed ${actor.state.speed}`);
          continue;
        }
        const vel = dir * actor.state.speed;
        if (!isFinite(vel)) {
          console.error(`[INPUT] Computed velocity is not finite for player ${playerId}: ${vel}`);
          continue;
        }
        actor.body.velocity.x = vel;
      }
    }
  }

  getSpawnPosition(playerId) {
    const maxX = 1230;
    const minX = 50;
    const spreadX = (maxX - minX) / Math.max(1, this.playerActors.size + 1);
    const baseX = minX + spreadX * playerId;
    const baseY = 656;
    const searchRadius = 100;

    const isValidSpawn = (pos) => {
      const playerRadius = 16;

      for (const actor of this.actors.values()) {
        if (actor.state.removed) continue;
        const dx = Math.abs(actor.body.position.x - pos[0]);
        const dy = Math.abs(actor.body.position.y - pos[1]);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (actor.type === 'player' && actor.state.player_id !== playerId && dist < 60) {
          return false;
        }
        if (actor.type === 'enemy' && dist < 60) {
          return false;
        }
      }

      const onPlatform = Array.from(this.actors.values()).some(a =>
        !a.state.removed &&
        (a.type === 'platform' || a.type === 'breakable_platform') &&
        Math.abs(a.body.position.x - pos[0]) < 40 &&
        Math.abs(a.body.position.y - (pos[1] + 24)) < 12
      );

      return onPlatform;
    };

    for (let radius = 0; radius < searchRadius; radius += 10) {
      const candidates = [
        [baseX + radius, baseY],
        [baseX - radius, baseY],
        [baseX, baseY - radius],
        [baseX, baseY + radius],
        [baseX + radius, baseY + radius],
        [baseX - radius, baseY + radius],
        [baseX + radius, baseY - radius],
        [baseX - radius, baseY - radius]
      ];

      for (const pos of candidates) {
        if (isValidSpawn(pos)) {
          return pos;
        }
      }
    }

    const fallback = [baseX, baseY];
    if (isValidSpawn(fallback)) {
      console.warn(`[SPAWN] Using fallback spawn position for player ${playerId}: [${baseX}, ${baseY}]`);
      return fallback;
    }

    console.error(`[SPAWN] No valid spawn position found for player ${playerId}, forced to [${baseX}, ${baseY}]`);
    return fallback;
  }

  updateRespawns() {
    const tickSeconds = TICK_MS / 1000;
    for (const [name, actor] of this.actors) {
      if (actor.type !== 'player' || actor.state.removed) continue;

      if (actor.state._respawn_frames_remaining > 0) {
        actor.state._respawn_frames_remaining--;
        try {
          game.heldInput.delete(actor.state.player_id);
        } catch (e) {
          console.error(`[RESPAWN_INPUT_CLEANUP] Player ${actor.state.player_id}: ${e.message}`);
        }

        if (actor.state._respawn_frames_remaining <= 0) {
          try {
            let spawnPos = this.getSpawnPosition(actor.state.player_id);
            if (!spawnPos || !Array.isArray(spawnPos) || spawnPos.length < 2 ||
                typeof spawnPos[0] !== 'number' || typeof spawnPos[1] !== 'number') {
              console.error(`[RESPAWN] Invalid spawn position type, using fallback`);
              spawnPos = [640, 100];
            }
            if (!isFinite(spawnPos[0]) || !isFinite(spawnPos[1])) {
              console.error(`[RESPAWN] Spawn position NaN, using fallback`);
              spawnPos = [640, 100];
            }
            if (!actor.body) {
              console.error(`[RESPAWN] Actor body missing, skipping respawn`);
            } else {
              actor.body.position.x = spawnPos[0];
              actor.body.position.y = spawnPos[1];
              if (actor.body._prevPos) {
                actor.body._prevPos.x = spawnPos[0];
                actor.body._prevPos.y = spawnPos[1];
              } else {
                actor.body._prevPos = { x: spawnPos[0], y: spawnPos[1] };
              }
              actor.body.velocity.x = 0;
              actor.body.velocity.y = 0;
              actor.state.respawn_time = 0;
              actor.state._respawn_frames_remaining = 0;
              actor.state.on_ground = true;
              actor.state._coyote_counter = 0;
              actor.state._goal_reached = false;
              actor.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
              actor.state._invulnerable_frames_remaining = Math.round(PHYSICS.INVULNERABILITY_TIME * TICK_RATE);
              console.log(`[RESPAWN] Player ${actor.state.player_id} respawned at [${spawnPos[0]}, ${spawnPos[1]}]`);
            }
          } catch (e) {
            console.error(`[RESPAWN_ERROR] Player ${actor.state.player_id}: ${e.message}`);
            actor.state._respawn_frames_remaining = 0;
          }
        }
      }

      if (actor.state._respawn_frames_remaining <= 0 && actor.state._invulnerable_frames_remaining > 0) {
        actor.state._invulnerable_frames_remaining--;
        actor.state.invulnerable = Math.max(0, actor.state._invulnerable_frames_remaining / TICK_RATE);
      }

      if (actor.state._respawn_frames_remaining <= 0 && !this.paused) {
        const newStageTime = actor.state.stage_time + tickSeconds;
        if (!isFinite(newStageTime) || newStageTime > 2147483647) {
          console.error(`[STAGE_TIME_OVERFLOW] Player ${actor.state.player_id} stage_time overflow`);
          actor.state.stage_time = 2147483647;
        } else {
          actor.state.stage_time = newStageTime;
        }
      }
    }
  }

  updateActors() {
    for (const [name, actor] of this.actors) {
      if (actor.state.removed) continue;
      if (actor.type === 'enemy') {
        const pd = actor.state.patrol_dir;
        if (typeof pd !== 'number' || (pd !== 1 && pd !== -1)) {
          console.error(`[PATROL_DIR] Enemy ${name} has invalid patrol_dir ${pd}, resetting to -1`);
          actor.state.patrol_dir = -1;
        }
        const dir = actor.state.patrol_dir > 0 ? 1 : -1;
        if (!isFinite(actor.state.speed) || actor.state.speed <= 0) {
          console.error(`[ENEMY_SPEED] Enemy ${name} has invalid speed ${actor.state.speed}, resetting to 120`);
          actor.state.speed = 120;
        }
        actor.body.velocity.x = dir * actor.state.speed;

        const minBound = 50;
        const maxBound = 1230;
        const turnDistance = 30;

        if ((actor.body.position.x < minBound + turnDistance && dir < 0) ||
            (actor.body.position.x > maxBound - turnDistance && dir > 0)) {
          actor.state.patrol_dir = actor.state.patrol_dir > 0 ? -1 : 1;
        }
      }

      if (actor.type === 'player' || actor.type === 'enemy') {
        if (!actor.state.on_ground) {
          actor.body.velocity.y = Math.min(
            actor.body.velocity.y + PHYSICS.GRAVITY * (TICK_MS / 1000),
            PHYSICS.MAX_FALL_SPEED
          );
          if (actor.state._coyote_counter < 6) {
            actor.state._coyote_counter++;
          }
        } else if (actor.body.velocity.y === 0 && actor.body.position.y < 700) {
          actor.body.velocity.y = 20;
        }
        if (!isFinite(actor.body.velocity.x) || !isFinite(actor.body.velocity.y)) {
          console.error(`[NAN] Actor ${name} has invalid velocity: ${actor.body.velocity.x}, ${actor.body.velocity.y}`);
          actor.state.removed = true;
        }
      }

      actor.state._landed_this_frame = false;

      if (actor.type === 'player') {
        if (actor.body.position.y > 750 || actor.body.position.x < -50 || actor.body.position.x > 1330) {
          actor.state.removed = true;
        }
      }
    }
  }

  checkCollisions(actorSnapshot) {
    const checked = new Set();
    const contactingPlatforms = new Map();
    const hitByEnemyThisFrame = new Set();

    for (const [name, actor] of actorSnapshot) {
      if (actor.type === 'breakable_platform' && !actor.state.removed) {
        if (actor.state._hit_this_frame && actor.state._hit_this_frame.clear) {
          actor.state._hit_this_frame.clear();
        }
      }
    }

    for (const [nameA, actorA] of actorSnapshot) {
      if (!actorA.state.removed && (actorA.type === 'player' || actorA.type === 'enemy')) {
        if (!contactingPlatforms.has(nameA)) {
          contactingPlatforms.set(nameA, []);
        }
      }
    }

    for (const [nameA, actorA] of actorSnapshot) {
      for (const [nameB, actorB] of actorSnapshot) {
        if (nameA === nameB) continue;
        if (actorA.state.removed || actorB.state.removed) continue;

        const pairKey = [nameA, nameB].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const bodyA = actorA.body;
        const bodyB = actorB.body;
        const aabbHits = this.checkAABB(bodyA, bodyB);

        if (aabbHits) {
          let player = null, enemy = null;
          if (actorA.type === 'player' && actorB.type === 'enemy') {
            player = actorA;
            enemy = actorB;
          } else if (actorB.type === 'player' && actorA.type === 'enemy') {
            player = actorB;
            enemy = actorA;
          }
          if (player && enemy && player.state.invulnerable <= 0) {
            if (!hitByEnemyThisFrame.has(player.name)) {
              hitByEnemyThisFrame.add(player.name);
              player.state.deaths = Math.min(player.state.deaths + 1, 2147483647);
              player.state.lives = Math.max(0, player.state.lives - 1);
              player.state.respawn_time = PHYSICS.RESPAWN_TIME;
              player.state._respawn_frames_remaining = Math.round(PHYSICS.RESPAWN_TIME * TICK_RATE);
              player.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
              player.state._invulnerable_frames_remaining = Math.round(PHYSICS.INVULNERABILITY_TIME * TICK_RATE);
            }
          }

          let movingActor, platformActor, movingBody, platformBody;
          if ((actorA.type === 'player' || actorA.type === 'enemy') && (actorB.type === 'platform' || actorB.type === 'breakable_platform')) {
            movingActor = actorA;
            platformActor = actorB;
            movingBody = bodyA;
            platformBody = bodyB;
          } else if ((actorB.type === 'player' || actorB.type === 'enemy') && (actorA.type === 'platform' || actorA.type === 'breakable_platform')) {
            movingActor = actorB;
            platformActor = actorA;
            movingBody = bodyB;
            platformBody = bodyA;
          }

          if (movingActor && platformActor && !platformActor.state.removed) {
            const movW = movingBody._width || 32;
            const movH = movingBody._height || 32;
            const platW = platformBody._width || 32;
            const platH = Math.max(1, platformBody._height || 16);
            if (!isFinite(movW) || !isFinite(movH) || movW <= 0 || movH <= 0 ||
                !isFinite(platW) || !isFinite(platH) || platW <= 0 || platH <= 0) {
              console.error(`[COLLISION] Invalid dimensions for collision: mov=${movW}x${movH}, plat=${platW}x${platH}`);
            } else {
              const prevY = movingBody._prevPos?.y || movingBody.position.y;
              const prevX = movingBody._prevPos?.x || movingBody.position.x;
              const platformTop = platformBody.position.y - platH / 2;
              const platformBot = platformBody.position.y + platH / 2;
              const platformLeft = platformBody.position.x - platW / 2;
              const platformRight = platformBody.position.x + platW / 2;
              const playerHH = movH / 2;
              const playerHW = movW / 2;
              const prevPlayerBottom = prevY + playerHH;
              const playerBottom = movingBody.position.y + playerHH;
              const playerLeft = movingBody.position.x - playerHW;
              const playerRight = movingBody.position.x + playerHW;
              const xOverlap = playerRight >= platformLeft && playerLeft <= platformRight;
              const landingFromAbove = xOverlap && movingBody.velocity.y > 0 && prevPlayerBottom < platformTop && playerBottom >= platformTop;
              const restingOnPlatform = xOverlap && playerBottom >= platformTop && playerBottom <= platformBot;

              if (landingFromAbove || restingOnPlatform) {
                movingBody.velocity.y = 0;
                if (!movingActor.state._landed_this_frame) {
                  movingActor.state._coyote_counter = 0;
                  movingActor.state._landed_this_frame = true;
                }

                try {
                  if (!contactingPlatforms.has(movingActor.name)) {
                    contactingPlatforms.set(movingActor.name, []);
                  }
                  const contactList = contactingPlatforms.get(movingActor.name);
                  if (contactList && Array.isArray(contactList)) {
                    contactList.push(platformActor.name);
                  } else {
                    console.error(`[COLLISION] contactList invalid for ${movingActor.name}`);
                  }
                } catch (e) {
                  console.error(`[COLLISION_CONTACT] Error: ${e.message}`);
                }

                if (platformActor.type === 'breakable_platform' && !platformActor.state.removed) {
                  if (!platformActor.state._hit_this_frame) {
                    platformActor.state._hit_this_frame = new Set();
                  }
                  if (!platformActor.state._hit_this_frame.has(movingActor.name)) {
                    platformActor.state._hit_this_frame.add(movingActor.name);
                    const hitCountBefore = platformActor.state.hit_count;
                    const hitCountAfter = Math.min(hitCountBefore + 1, 2147483647);
                    platformActor.state.hit_count = hitCountAfter;
                    if (movingActor.type === 'player' && hitCountBefore < platformActor.state.max_hits && hitCountAfter >= platformActor.state.max_hits) {
                      if (!isFinite(movingActor.state.score) || movingActor.state.score < 0) {
                        console.error(`[SCORE] Invalid player score ${movingActor.state.score}, resetting to 0`);
                        movingActor.state.score = 0;
                      }
                      movingActor.state.score = Math.min(movingActor.state.score + 10, 2147483647);
                    }
                  }
                  if (platformActor.state.hit_count >= platformActor.state.max_hits && !platformActor.state._confirmed_broken) {
                    platformActor.state._confirmed_broken = true;
                    platformActor.state.removed = true;
                    console.error(`[REMOVE] Breakable platform ${platformActor.name} broken`);
                  }
                }
              }
            }
          }
        }
      }
    }

    for (const [actorName, contactList] of contactingPlatforms) {
      const actor = this.actors.get(actorName);
      if (actor) {
        actor.state.on_ground = contactList.length > 0;
      }
    }
    for (const [name, actor] of this.actors) {
      if ((actor.type === 'player' || actor.type === 'enemy') && !contactingPlatforms.has(name)) {
        actor.state.on_ground = false;
      }
    }
  }

  checkAABB(bodyA, bodyB) {
    const aW = bodyA._width || 32;
    const aH = bodyA._height || 32;
    const bW = bodyB._width || 32;
    const bH = bodyB._height || 32;
    if (!isFinite(aW) || !isFinite(aH) || !isFinite(bW) || !isFinite(bH) || aW <= 0 || aH <= 0 || bW <= 0 || bH <= 0) {
      return false;
    }
    const aHalfW = aW / 2;
    const aHalfH = aH / 2;
    const bHalfW = bW / 2;
    const bHalfH = bH / 2;
    const prevPosA = bodyA._prevPos || bodyA.position;
    const prevPosB = bodyB._prevPos || bodyB.position;
    const aTop = Math.min(prevPosA.y, bodyA.position.y) - aHalfH;
    const aBot = Math.max(prevPosA.y, bodyA.position.y) + aHalfH;
    const aLeft = Math.min(prevPosA.x, bodyA.position.x) - aHalfW;
    const aRight = Math.max(prevPosA.x, bodyA.position.x) + aHalfW;
    const bTop = Math.min(prevPosB.y, bodyB.position.y) - bHalfH;
    const bBot = Math.max(prevPosB.y, bodyB.position.y) + bHalfH;
    const bLeft = Math.min(prevPosB.x, bodyB.position.x) - bHalfW;
    const bRight = Math.max(prevPosB.x, bodyB.position.x) + bHalfW;
    const xOverlap = aRight >= bLeft && aLeft <= bRight;
    const yOverlap = aBot >= bTop && aTop <= bBot;
    return xOverlap && yOverlap;
  }

  checkGoal(frameSnapshot) {
    if (this.stage_transitioning) return;
    if (!this.level.goal || typeof this.level.goal.x !== 'number' || typeof this.level.goal.y !== 'number') return;
    for (const [playerId, actor] of this.playerActors) {
      if (!actor.state._goal_reached && !actor.state.removed && actor.body && actor.state.respawn_time <= 0) {
        const dx = actor.body.position.x - this.level.goal.x;
        const dy = actor.body.position.y - this.level.goal.y;
        const distSquared = dx * dx + dy * dy;
        if (distSquared < 1600) {
          actor.state._goal_reached = true;
          this.broadcastGoalReached(actor.state.player_id, frameSnapshot);
        }
      }
    }
  }

  removeDeadActors() {
    const toRemove = [];
    try {
      for (const [name, actor] of this.actors) {
        if (actor && actor.state && actor.state.removed) {
          toRemove.push(name);
        }
      }
    } catch (e) {
      console.error(`[REMOVE_SCAN] Error: ${e.message}`);
      return;
    }

    for (const name of toRemove) {
      try {
        const actor = this.actors.get(name);
        if (!actor) {
          console.warn(`[REMOVE] Actor ${name} already removed`);
          continue;
        }

        if (actor.type === 'player') {
          const playerId = actor.state.player_id;
          console.error(`[REMOVE] Removing player ${playerId}`);
          try {
            this.playerActors.delete(playerId);
            this.pendingInput.delete(playerId);
            this.heldInput.delete(playerId);
            this.inputRateLimit.delete(playerId);
          } catch (e) {
            console.error(`[REMOVE_PLAYER_MAPS] ${playerId}: ${e.message}`);
          }
        }

        try {
          if (actor.state._hit_this_frame && typeof actor.state._hit_this_frame.clear === 'function') {
            actor.state._hit_this_frame.clear();
          }
          actor.state._hit_this_frame = null;
        } catch (e) {
          console.error(`[REMOVE_HIT_FRAME] ${name}: ${e.message}`);
        }

        try {
          if (actor.body && actor.body._prevPos) {
            actor.body._prevPos = null;
          }
          if (actor.body) {
            World.remove(this.engine.world, actor.body);
          }
        } catch (e) {
          console.error(`[REMOVE_WORLD] ${name}: ${e.message}`);
        }

        this.actors.delete(name);
        this.bodies.delete(name);
        this.lastActorState.delete(name);
      } catch (e) {
        console.error(`[REMOVE_ACTOR] ${name}: ${e.message}`);
      }
    }
  }

  updateGameState(frameSnapshot) {
    try {
      const activePlayers = Array.from(this.actors.values())
        .filter(a => a && a.type === 'player' && a.state && a.state.lives > 0 && a.state.respawn_time <= 0);

      if (activePlayers.length === 0) {
        try {
          const connectedPlayers = Array.from(this.actors.values())
            .filter(a => a && a.type === 'player' && !a.state.removed && this.clients.has(a.state.player_id));
          if (connectedPlayers.length > 0) {
            if (!this.stage_over) {
              this.stage_over = true;
              this.stage_over_time = Date.now();
              console.error(`[GAMEOVER] All players eliminated at frame ${frameSnapshot}`);
            }
          }
        } catch (e) {
          console.error(`[GAMESTATE_ACTIVE] Error: ${e.message}`);
        }
      }

      if (this.stage_over && !this.stage_transitioning) {
        try {
          const now = Date.now();
          if (typeof this.stage_over_time !== 'number' || !isFinite(this.stage_over_time)) {
            console.error(`[GAMESTATE] Invalid stage_over_time, resetting`);
            this.stage_over = false;
            return;
          }
          const elapsed = Math.max(0, now - this.stage_over_time);
          if (elapsed >= 3000) {
            console.error(`[RESTART] Reloading stage ${this.stage}`);
            this.stage_transitioning = true;
            try {
              this.loadStage(this.stage);
              this.stage_over = false;
              this.nextStageClients();
            } catch (e) {
              console.error(`[RESTART_ERROR] Failed to reload: ${e.message}`);
              this.stage_over = false;
            } finally {
              this.stage_transitioning = false;
            }
          }
        } catch (e) {
          console.error(`[GAMESTATE_TRANSITION] Error: ${e.message}`);
          this.stage_transitioning = false;
        }
      }
    } catch (e) {
      console.error(`[GAMESTATE] Error: ${e.message}`);
    }
  }

  broadcastGoalReached(playerId, frameSnapshot) {
    const msg = buildGoalMessage(playerId, this.stage, frameSnapshot);
    this.broadcastToClients(msg);

    if (this.stage_transitioning) {
      console.warn(`[GOAL] Player ${playerId} reached goal but stage already transitioning, skipping transition`);
      return;
    }

    this.stage_transitioning = true;
    this._stageTransitionPending = true;

    if (this.stage === 4) {
      const player = Array.from(this.actors.values()).find(a => !a.state.removed && a.state.player_id === playerId);
      const totalScore = player ? player.state.score || 0 : 0;
      const mainTimeout = setTimeout(() => {
        try {
          const winMsg = buildGameWonMessage(totalScore, this.frame);
          this.broadcastToClients(winMsg);
        } finally {
          this.stage_transitioning = false;
          this._stageTransitionPending = false;
        }
      }, 1000);
      this.stageTransitionTimeouts.push(mainTimeout);
      const safetyTimeout = setTimeout(() => {
        if (this.stage_transitioning) {
          console.error('[STAGE_TRANSITION_TIMEOUT] Force clearing stage_transitioning flag');
          this.stage_transitioning = false;
          this._stageTransitionPending = false;
        }
        clearTimeout(mainTimeout);
      }, 5000);
      this.stageTransitionTimeouts.push(safetyTimeout);
    } else {
      const mainTimeout = setTimeout(() => {
        try {
          this.nextStage();
        } finally {
          this.stage_transitioning = false;
          this._stageTransitionPending = false;
        }
      }, 3000);
      this.stageTransitionTimeouts.push(mainTimeout);
      const safetyTimeout = setTimeout(() => {
        if (this.stage_transitioning) {
          console.error('[STAGE_TRANSITION_TIMEOUT] Force clearing stage_transitioning flag');
          this.stage_transitioning = false;
          this._stageTransitionPending = false;
        }
        clearTimeout(mainTimeout);
      }, 10000);
      this.stageTransitionTimeouts.push(safetyTimeout);
    }
  }

  broadcastStateUpdate(version) {
    let toDelete = [];
    try {
      for (const [name] of this.lastActorState) {
        const actor = this.actors.get(name);
        if (!actor || actor.state.removed) {
          toDelete.push(name);
        }
      }
      for (const name of toDelete) {
        this.lastActorState.delete(name);
      }
    } catch (e) {
      console.error(`[BROADCAST_CLEANUP] Error: ${e.message}`);
      toDelete = [];
    }

    let actorSnapshot = [];
    try {
      actorSnapshot = Array.from(this.actors.entries());
    } catch (e) {
      console.error(`[BROADCAST_SNAPSHOT] Error: ${e.message}`);
      actorSnapshot = [];
    }

    const actors = {};
    const currentState = new Map();
    let serializationFailures = 0;
    for (const [name, actor] of actorSnapshot) {
      try {
        if (!actor || actor.state.removed) continue;
        const current = serializeActorState(actor);
        if (!current) {
          serializationFailures++;
          continue;
        }
        currentState.set(name, current);
        const lastState = this.lastActorState.get(name);
        const delta = lastState ? this._computeDelta(current, lastState) : current;
        if (delta) {
          actors[name] = delta;
        }
      } catch (e) {
        console.error(`[BROADCAST_SERIALIZE] Actor ${name}: ${e.message}`);
        serializationFailures++;
      }
    }
    if (serializationFailures > 0) {
      console.error(`[BROADCAST_RISK] ${serializationFailures} actors failed serialization`);
    }

    try {
      for (const [name, current] of currentState) {
        this.lastActorState.set(name, current);
      }
    } catch (e) {
      console.error(`[BROADCAST_CACHE] Failed to update cache: ${e.message}`);
    }

    const data = { version, frame: this._tickFrameSnapshot || this.frame, stage: this.stage };
    if (Object.keys(actors).length > 0) {
      data.actors = actors;
    }

    if ((this._tickFrameSnapshot || this.frame) % 10 === 0) {
      try {
        let checksum = computeStateChecksum(this.actors);
        checksum = (checksum + (this._tickFrameSnapshot || this.frame)) >>> 0;
        if (checksum === 0) {
          console.warn(`[CHECKSUM] Checksum is 0`);
        }
        data.checksum = checksum;
      } catch (e) {
        console.error(`[CHECKSUM] Failed: ${e.message}`);
      }
    }

    const msg = [MSG_TYPES.UPDATE, data];
    try {
      this.broadcastToClients(msg);
    } catch (e) {
      console.error(`[BROADCAST] Failed: ${e.message}`);
    }
  }

  _computeDelta(current, lastState) {
    if (!lastState) return current;
    if (current.t !== lastState.t) {
      console.error(`[DELTA] ERROR: Type mismatch for ${current.n}: was ${lastState.t}, now ${current.t}`);
      return current;
    }
    const delta = { n: current.n };
    let hasChanges = false;
    for (const key in current) {
      if (key === 'n') continue;
      if (!(key in lastState)) {
        console.warn(`[DELTA] WARN: New key ${key} not in lastState for ${current.n}`);
        delta[key] = current[key];
        hasChanges = true;
      } else if (typeof current[key] === 'number' && typeof lastState[key] === 'number') {
        if (Math.abs(current[key] - lastState[key]) > 0.01) {
          delta[key] = current[key];
          hasChanges = true;
        }
      } else if (current[key] !== lastState[key]) {
        delta[key] = current[key];
        hasChanges = true;
      }
    }
    return hasChanges ? delta : null;
  }

  serializeActor(actor) {
    return serializeActorFull(actor);
  }

  broadcastToClients(message) {
    if (!message || typeof message !== 'object') {
      console.error('[BROADCAST] Invalid message object');
      return;
    }
    let msg;
    try {
      msg = JSON.stringify(message);
    } catch (e) {
      console.error(`[BROADCAST] JSON encode error: ${e.message}`);
      return;
    }

    const msgSize = msg.length;
    if (msgSize > 1000000) {
      console.error(`[BROADCAST] Message too large: ${msgSize} bytes (max 1MB)`);
      return;
    }
    stats.messagesSent = (stats.messagesSent + 1) >>> 0;
    const newWindowBytes = stats.windowBytes + msgSize;
    if (newWindowBytes > 2147483647) {
      console.error('[STATS_OVERFLOW] Window bytes would overflow, resetting window early');
      stats.windowBytes = 0;
      stats.windowMessages = 0;
      stats.windowStartTime = Date.now();
    } else {
      stats.windowBytes = newWindowBytes;
    }
    stats.windowMessages++;

    const now = Date.now();
    const windowDuration = (now - stats.windowStartTime) / 1000;
    if (windowDuration >= 1) {
      stats.bytesPerSecond = Math.round(Math.max(0, Math.min(1000000, stats.windowBytes / Math.max(windowDuration, 0.1))));
      stats.messagesSentPerSecond = Math.round(Math.max(0, Math.min(100000, stats.windowMessages / Math.max(windowDuration, 0.1))));
      stats.peakBytesPerSecond = Math.max(stats.peakBytesPerSecond, stats.bytesPerSecond);
      stats.windowBytes = 0;
      stats.windowMessages = 0;
      stats.windowStartTime = now;
    }

    const deadClients = [];
    this.clients.forEach((client, playerId) => {
      if (client && client.ws) {
        if (client.ws.readyState === WebSocket.OPEN) {
          if (client.ws.bufferedAmount > 1000000) {
            console.error(`[BACKPRESSURE_DISCONNECT] Player ${playerId} buffer overflow: ${client.ws.bufferedAmount} bytes, disconnecting`);
            deadClients.push(playerId);
          } else {
            try {
              client.ws.send(msg);
            } catch (e) {
              console.error(`Broadcast error for player ${playerId}:`, e.message);
              deadClients.push(playerId);
            }
          }
        } else if (client.ws.readyState !== WebSocket.CONNECTING) {
          deadClients.push(playerId);
        }
      } else {
        deadClients.push(playerId);
      }
    });
    for (const playerId of deadClients) {
      this.clients.delete(playerId);
      this.heldInput.delete(playerId);
      this.pendingInput.delete(playerId);
      this.pausedPlayers.delete(playerId);
      this.inputRateLimit.delete(playerId);
      const actor = this.playerActors.get(playerId);
      if (actor && !actor.state.removed) {
        actor.state.removed = true;
      }
      this.playerActors.delete(playerId);
    }
  }

  nextStageClients() {
    const deadClients = [];
    let serializationFailures = 0;
    const actors = Array.from(this.actors.values())
      .filter(a => !a.state.removed)
      .map(a => {
        const serialized = serializeActorFull(a);
        if (!serialized) serializationFailures++;
        return serialized;
      })
      .filter(a => a !== null);
    if (serializationFailures > 0) {
      console.error(`[STAGELOAD_RISK] ${serializationFailures} actors failed serialization during stage load`);
    }
    if (actors.length === 0) {
      console.warn('[STAGELOAD] WARNING: No actors to send during stage load');
    }
    const msg = buildStageloadMessage(this.stage, this.level.name, this.level.goal, actors, this.frame, this.paused);
    let msgStr;
    try {
      msgStr = JSON.stringify(msg);
    } catch (e) {
      console.error('JSON encode error in nextStageClients:', e.message);
      return;
    }
    this.clients.forEach((client, playerId) => {
      if (client && client.ws) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(msgStr);
          } catch (e) {
            console.error(`Stage load error for player ${playerId}:`, e.message);
            deadClients.push(playerId);
          }
        } else if (client.ws.readyState !== WebSocket.CONNECTING) {
          deadClients.push(playerId);
        }
      } else {
        deadClients.push(playerId);
      }
    });
    for (const playerId of deadClients) {
      this.clients.delete(playerId);
      this.heldInput.delete(playerId);
      this.pendingInput.delete(playerId);
      this.pausedPlayers.delete(playerId);
      this.inputRateLimit.delete(playerId);
      const actor = this.playerActors.get(playerId);
      if (actor) {
        actor.state.removed = true;
      }
      this.playerActors.delete(playerId);
    }
  }

  nextStage() {
    if (this.stage < 1 || this.stage > 4) {
      console.error(`[STAGE] Invalid current stage: ${this.stage}`);
      return;
    }
    if (this.stage < 4) {
      this.pausedPlayers.clear();
      this.paused = false;
      this.loadStage(this.stage + 1);
      this.nextStageClients();
    } else if (this.stage === 4) {
      this.stage_over = true;
      this.stage_over_time = this.frame;
    }
  }

  checkInputRateLimit(playerId) {
    const now = Date.now();
    const lastInput = this.inputRateLimit.get(playerId);
    if (lastInput && (now - lastInput) < 16) {
      return false;
    }
    this.inputRateLimit.set(playerId, now);
    return true;
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const game = new PhysicsGame();
let nextPlayerId = 0;
const getNextPlayerId = () => {
  if (nextPlayerId >= 2147483647) {
    console.error('[PLAYERID_OVERFLOW] Player ID counter reset');
    nextPlayerId = 0;
  }
  return ++nextPlayerId;
};
const ipRateLimit = new Map();
const IP_RATE_LIMIT_TTL = 3600000;

const checkIPRateLimit = (ip) => {
  const now = Date.now();
  const entry = ipRateLimit.get(ip);
  if (entry && now - entry < 100) {
    return false;
  }
  ipRateLimit.set(ip, now);
  if (ipRateLimit.size > 10000) {
    for (const [ipAddr, timestamp] of ipRateLimit) {
      if (now - timestamp > IP_RATE_LIMIT_TTL) {
        ipRateLimit.delete(ipAddr);
      }
    }
  }
  return true;
};

setInterval(() => {
  try {
    game.clients.forEach((client, playerId) => {
      try {
        if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
          client.ws.isAlive = false;
          client.ws.ping();
          const timeoutId = setTimeout(() => {
            try {
              if (client && client.ws && client.ws.isAlive === false) {
                client.ws.close();
              }
            } catch (e) {
              console.error(`[PING_TIMEOUT] Failed to close client ${playerId}: ${e.message}`);
            }
          }, 5000);
        }
      } catch (e) {
        console.error(`[PING] Client ${playerId} error: ${e.message}`);
      }
    });
  } catch (e) {
    console.error(`[PING_INTERVAL] Error: ${e.message}`);
  }
}, 30000);

setInterval(() => {
  const now = Date.now();
  const timeout = 3600000;
  for (const [ip, lastRequest] of ipRateLimit) {
    if (now - lastRequest > timeout) {
      ipRateLimit.delete(ip);
    }
  }
}, 600000);

setInterval(() => {
  try {
    const now = Date.now();
    const idleTimeout = 600000;
    const deadClients = [];
    try {
      game.clients.forEach((client, playerId) => {
        try {
          if (!client || typeof client.lastActivity !== 'number') {
            console.warn(`[IDLE] Client ${playerId} has invalid lastActivity`);
            deadClients.push(playerId);
            return;
          }
          if (now - client.lastActivity > idleTimeout) {
            console.error(`[TIMEOUT] Player ${playerId} idle, closing`);
            if (client.ws && client.ws.readyState === WebSocket.OPEN) {
              try {
                client.ws.close(1000, 'Idle timeout');
              } catch (e) {
                console.error(`[TIMEOUT_CLOSE] Failed to close ${playerId}: ${e.message}`);
              }
            }
            deadClients.push(playerId);
          }
        } catch (e) {
          console.error(`[IDLE] Client ${playerId} error: ${e.message}`);
          deadClients.push(playerId);
        }
      });
    } catch (e) {
      console.error(`[IDLE_SCAN] Error: ${e.message}`);
    }

    for (const playerId of deadClients) {
      try {
        game.clients.delete(playerId);
        game.pausedPlayers.delete(playerId);
        game.heldInput.delete(playerId);
        game.pendingInput.delete(playerId);
        game.inputRateLimit.delete(playerId);
        const actor = game.playerActors.get(playerId);
        if (actor && !actor.state.removed) {
          actor.state.removed = true;
        }
        game.playerActors.delete(playerId);
      } catch (e) {
        console.error(`[IDLE_CLEANUP] Player ${playerId}: ${e.message}`);
      }
    }

    try {
      const pausedSnapshot = Array.from(game.pausedPlayers);
      const connectedCount = pausedSnapshot.filter(pid => game.clients.has(pid)).length;
      const anyConnectedPaused = connectedCount > 0;
      if (game.paused && !anyConnectedPaused && game.clients.size > 0) {
        game.paused = false;
        game.broadcastToClients(buildResumeMessage(game._tickFrameSnapshot || game.frame));
      } else if (game.clients.size === 0 && (game.paused || game.pausedPlayers.size > 0)) {
        game.paused = false;
        game.pausedPlayers.clear();
      }
    } catch (e) {
      console.error(`[IDLE_PAUSE] Error: ${e.message}`);
    }
  } catch (e) {
    console.error(`[IDLE_INTERVAL] Error: ${e.message}`);
  }
}, 60000);
let updateVersion = 0;
const stats = {
  messagesSent: 0,
  bytesPerSecond: 0,
  messagesSentPerSecond: 0,
  peakBytesPerSecond: 0,
  initTime: Date.now(),
  windowBytes: 0,
  windowMessages: 0,
  windowStartTime: Date.now()
};

app.use((req, res, next) => {
  res.set('X-RateLimit-Limit', '1000');
  res.set('X-RateLimit-Remaining', '999');
  res.set('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

wss.on('connection', (ws) => {
  if (game.clients.size >= 100) {
    console.error(`[CONNECT] Connection rejected: max players reached`);
    ws.close(1008, 'Server full');
    return;
  }
  const playerId = getNextPlayerId();
  console.error(`[CONNECT] Player ${playerId} connected (${game.clients.size + 1}/${100})`);
  const spawnPos = game.getSpawnPosition(playerId);
  const actor = game.spawn('player', spawnPos, { player_id: playerId });
  if (!actor) {
    console.error(`Failed to spawn player ${playerId}`);
    ws.close();
    return;
  }

  const client = { ws, playerId, lastActivity: Date.now() };
  game.clients.set(playerId, client);

  const actors = Array.from(game.actors.values())
    .filter(a => !a.state.removed)
    .map(a => serializeActorFull(a))
    .filter(a => a !== null);
  const initMsg = buildInitMessage(playerId, game.stage, game.level.name, game.level.goal, game.frame, actors, game.paused);
  ws.send(JSON.stringify(initMsg));

  ws.on('message', (msg) => {
    try {
      if (!msg || msg.length > 10000) return;
      let data;
      try {
        data = JSON.parse(msg.toString());
      } catch (parseErr) {
        console.error(`[PARSE] Invalid JSON from player ${playerId}: ${parseErr.message}`);
        return;
      }
      if (!data || typeof data !== 'object') return;

      const { action, direction } = data;
      if (typeof action !== 'string') return;

      const validActions = ['move', 'jump', 'nextstage', 'pause', 'resume'];
      if (!validActions.includes(action)) return;

      const client = game.clients.get(playerId);
      if (client) {
        client.lastActivity = Date.now();
      }

      if (action === 'move') {
        if (typeof direction !== 'number' || isNaN(direction) || !isFinite(direction)) return;
        const dir = normalizeDirection(direction);
        if (game.playerActors.has(playerId) && game.clients.has(playerId)) {
          game.pendingInput.set(playerId, { action: 'move', direction: dir });
        }
      } else if (action === 'jump') {
        if (game.playerActors.has(playerId) && game.clients.has(playerId)) {
          game.pendingInput.set(playerId, { action: 'jump' });
        }
      } else if (action === 'nextstage') {
        const actor = game.playerActors.get(playerId);
        if (actor && !actor.state.removed && actor.state._goal_reached && !game.stage_transitioning) {
          game.nextStage();
        }
      } else if (action === 'pause') {
        if (game.clients.has(playerId)) {
          game.pausedPlayers.add(playerId);
          const pausedSnapshot = Array.from(game.pausedPlayers);
          const connectedCount = pausedSnapshot.filter(pid => game.clients.has(pid)).length;
          const allConnectedPaused = connectedCount > 0 && connectedCount === game.clients.size;
          if (allConnectedPaused && !game.paused) {
            game.paused = true;
            game.broadcastToClients(buildPauseMessage(game._tickFrameSnapshot || game.frame));
          }
        }
      } else if (action === 'resume') {
        if (game.clients.has(playerId)) {
          game.pausedPlayers.delete(playerId);
          const pausedSnapshot = Array.from(game.pausedPlayers);
          const connectedCount = pausedSnapshot.filter(pid => game.clients.has(pid)).length;
          const anyConnectedPaused = connectedCount > 0;
          if (!anyConnectedPaused && game.clients.size > 0 && game.paused) {
            game.paused = false;
            game.broadcastToClients(buildResumeMessage(game._tickFrameSnapshot || game.frame));
          }
        }
      }
    } catch (e) {
      console.error(`[ERROR] Player ${playerId} action handler error: ${e.message}`);
    }
  });

  ws.on('close', () => {
    console.error(`[DISCONNECT] Player ${playerId}`);
    for (const [name, actor] of game.actors) {
      if (actor && actor.state && actor.state.player_id === playerId) {
        actor.state.removed = true;
      }
    }
    game.clients.delete(playerId);
    game.heldInput.delete(playerId);
    game.pendingInput.delete(playerId);
    game.inputRateLimit.delete(playerId);
    game.pausedPlayers.delete(playerId);
    game.playerActors.delete(playerId);
    ws.isAlive = undefined;

    const pausedSnapshot = Array.from(game.pausedPlayers);
    const connectedCount = pausedSnapshot.filter(pid => game.clients.has(pid)).length;
    const anyConnectedPaused = connectedCount > 0;
    const noClientsRemain = game.clients.size === 0;
    if (game.paused && !anyConnectedPaused && (game.clients.size > 0 || noClientsRemain)) {
      game.paused = false;
      game.pausedPlayers.clear();
      if (game.clients.size > 0) {
        game.broadcastToClients(buildResumeMessage(game._tickFrameSnapshot || game.frame));
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] Player ${playerId} WebSocket error: ${err.message}`);
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

app.get('/api/status', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const players = [];
  for (const [playerId, actor] of game.playerActors) {
    if (!game.actors.has(actor.name) || actor.state.removed) continue;
    const p = {
      id: actor.state.player_id,
      pos: [actor.body.position.x, actor.body.position.y],
      vel: [actor.body.velocity.x, actor.body.velocity.y],
      on_ground: actor.state.on_ground,
      lives: actor.state.lives,
      score: actor.state.score,
      respawning: actor.state.respawn_time > 0
    };
    players.push(p);
  }
  const response = {
    frame: game.frame,
    stage: game.stage,
    clients: game.clients.size,
    actors: game.actors.size,
    players
  };
  res.json(response);
});

app.get('/api/actors', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  res.json(Array.from(game.actors.values())
    .filter(a => !a.state.removed)
    .map(a => {
      let state = {};
      if (a.type === 'player') {
        state = { player_id: a.state.player_id, lives: a.state.lives, score: a.state.score, deaths: a.state.deaths, on_ground: a.state.on_ground, invulnerable: a.state.invulnerable };
      } else if (a.type === 'enemy') {
        state = { on_ground: a.state.on_ground, patrol_dir: a.state.patrol_dir, speed: a.state.speed };
      } else if (a.type === 'platform') {
        state = { width: a.state.width };
      } else if (a.type === 'breakable_platform') {
        state = { width: a.state.width, hit_count: a.state.hit_count, max_hits: a.state.max_hits };
      }
      return { name: a.name, type: a.type, pos: [a.body.position.x, a.body.position.y], vel: [a.body.velocity.x, a.body.velocity.y], state };
    }));
});

app.get('/api/actor/:name', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const actor = game.actors.get(req.params.name);
  if (!actor || actor.state.removed) return res.status(404).json({ error: 'Actor not found' });
  let state = {};
  if (actor.type === 'player') {
    state = { player_id: actor.state.player_id, lives: actor.state.lives, score: actor.state.score, deaths: actor.state.deaths, on_ground: actor.state.on_ground, invulnerable: actor.state.invulnerable };
  } else if (actor.type === 'enemy') {
    state = { on_ground: actor.state.on_ground, patrol_dir: actor.state.patrol_dir, speed: actor.state.speed };
  } else if (actor.type === 'platform') {
    state = { width: actor.state.width };
  } else if (actor.type === 'breakable_platform') {
    state = { width: actor.state.width, hit_count: actor.state.hit_count, max_hits: actor.state.max_hits };
  }
  res.json({
    name: actor.name,
    type: actor.type,
    pos: [actor.body.position.x, actor.body.position.y],
    vel: [actor.body.velocity.x, actor.body.velocity.y],
    state
  });
});

app.post('/api/stage/:num', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const num = parseInt(req.params.num);
  if (isNaN(num) || num < 1 || num > 4) return res.status(400).json({ error: 'Invalid stage' });
  if (num !== game.stage) game.loadStage(num);
  res.json({ stage: game.stage, name: game.level.name });
});

app.post('/api/spawn/:type', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const validTypes = ['player', 'enemy', 'platform', 'breakable_platform'];
  if (!validTypes.includes(req.params.type)) {
    return res.status(400).json({ error: 'Invalid actor type' });
  }
  let { x = 640, y = 360, ...extra } = req.body || {};
  if (typeof x !== 'number' || x < 0 || x > 1280) x = 640;
  if (typeof y !== 'number' || y < 0 || y > 720) y = 360;
  if (extra.width !== undefined) {
    if (typeof extra.width !== 'number' || extra.width <= 0 || extra.width > 256) delete extra.width;
  }
  if (extra.max_hits !== undefined) {
    if (typeof extra.max_hits !== 'number' || extra.max_hits <= 0) delete extra.max_hits;
  }
  if (extra.speed !== undefined) {
    if (typeof extra.speed !== 'number' || extra.speed <= 0 || extra.speed > 500) delete extra.speed;
  }
  if (extra.patrol_dir !== undefined) {
    if (typeof extra.patrol_dir !== 'number' || (extra.patrol_dir !== -1 && extra.patrol_dir !== 1)) delete extra.patrol_dir;
  }
  if (req.params.type === 'player') {
    if (extra.player_id === undefined || extra.player_id === null) {
      extra.player_id = getNextPlayerId();
    }
    if (game.playerActors.has(extra.player_id)) {
      return res.status(400).json({ error: 'Player ID already exists' });
    }
    if (extra.lives !== undefined) {
      if (typeof extra.lives !== 'number' || extra.lives < 0) delete extra.lives;
    }
    if (extra.score !== undefined) {
      if (typeof extra.score !== 'number' || extra.score < 0) delete extra.score;
    }
    if (extra.deaths !== undefined) {
      if (typeof extra.deaths !== 'number' || extra.deaths < 0) delete extra.deaths;
    }
    if (extra.stage_time !== undefined) {
      if (typeof extra.stage_time !== 'number' || extra.stage_time < 0) delete extra.stage_time;
    }
    const spawnPos = game.getSpawnPosition(extra.player_id);
    extra._spawn_x = x;
    extra._spawn_y = y;
    const actor = game.spawn(req.params.type, spawnPos, extra);
    if (!actor) {
      return res.status(400).json({ error: 'Failed to spawn player' });
    }
  } else {
    const actor = game.spawn(req.params.type, [x, y], extra);
    if (!actor) {
      return res.status(400).json({ error: 'Failed to spawn actor' });
    }
  }
  res.json({ ok: true });
});

app.post('/api/input', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const { player_id, action, direction } = req.body || {};
  if (typeof player_id !== 'number' || !Number.isInteger(player_id) || player_id < 1 || player_id > 2147483647) {
    return res.status(400).json({ error: 'player_id must be integer 1-2147483647' });
  }
  if (!action || typeof action !== 'string' || !['move', 'jump'].includes(action)) {
    return res.status(400).json({ error: 'action must be "move" or "jump"' });
  }
  if (!game.checkInputRateLimit(player_id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  if (action === 'move') {
    if (typeof direction !== 'number' || !isFinite(direction)) {
      return res.status(400).json({ error: 'direction must be a finite number' });
    }
    const dir = normalizeDirection(direction);
    if (dir !== 0) {
      game.pendingInput.set(player_id, { action: 'move', direction: dir });
    }
  } else if (action === 'jump') {
    game.pendingInput.set(player_id, { action: 'jump' });
  }
  res.json({ ok: true });
});

app.get('/api/levels', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const levels = [1, 2, 3, 4].map(n => {
    const filePath = path.join(__dirname, '..', 'game', `levels/stage${n}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { stage: n, name: data.name || `Stage ${n}`, platforms: (data.platforms || []).length, enemies: (data.enemies || []).length };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
  res.json(levels);
});

app.get('/api/level/:num', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const numStr = req.params.num.trim();
  const num = Number.parseInt(numStr, 10);
  if (!Number.isInteger(num) || num < 1 || num > 4) {
    return res.status(400).json({ error: 'Invalid stage number (1-4)' });
  }
  const filePath = path.join(__dirname, '..', 'game', `levels/stage${num}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Level not found' });
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.platforms) || !Array.isArray(data.enemies)) {
      return res.status(500).json({ error: 'Level missing required fields (platforms, enemies)' });
    }
    if (!data.goal || typeof data.goal.x !== 'number' || typeof data.goal.y !== 'number') {
      return res.status(500).json({ error: 'Level missing goal position' });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: `Invalid level format: ${e.message}` });
  }
});

app.get('/api/stats', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const players = Array.from(game.playerActors.values())
    .filter(p => !p.state.removed)
    .map(p => {
      if (!p.body || !isFinite(p.body.position.x) || !isFinite(p.body.position.y)) {
        console.error(`[STATS] Invalid player position: ${p.state.player_id}`);
        return null;
      }
      return {
        id: p.state.player_id,
        score: p.state.score || 0,
        lives: p.state.lives || 0,
        deaths: p.state.deaths || 0,
        stage_time: Math.round((p.state.stage_time || 0) * 10) / 10,
        x: Math.round(p.body.position.x),
        y: Math.round(p.body.position.y),
        vx: Math.round(p.body.velocity.x),
        vy: Math.round(p.body.velocity.y),
        respawning: p.state.respawn_time > 0
      };
    })
    .filter(Boolean);

  const platforms = Array.from(game.actors.values())
    .filter(a => !a.state.removed && (a.type === 'platform' || a.type === 'breakable_platform'))
    .map(p => {
      const obj = { name: p.name, type: p.type };
      if (p.type === 'breakable_platform') {
        obj.hits = p.state.hit_count || 0;
        obj.max_hits = p.state.max_hits || 3;
      }
      return obj;
    });

  const enemies = Array.from(game.actors.values())
    .filter(a => !a.state.removed && a.type === 'enemy').length;

  res.json({
    frame: game.frame,
    stage: game.stage,
    clients: game.clients.size,
    players,
    enemies,
    platforms,
    stage_over: game.stage_over || false
  });
});

app.get('/api/frame/:num', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const snapshot = Array.from(game.actors.values())
    .filter(a => !a.state.removed)
    .map(a => {
      if (!a.body || !isFinite(a.body.position.x) || !isFinite(a.body.position.y) ||
          !isFinite(a.body.velocity.x) || !isFinite(a.body.velocity.y)) {
        console.error(`[FRAME] Invalid actor position/velocity: ${a.name}`);
        return null;
      }
      let state = {};
      if (a.type === 'player') {
        state = { lives: a.state.lives || 0, score: a.state.score || 0, respawn_time: a.state.respawn_time || 0, on_ground: a.state.on_ground ? 1 : 0 };
      } else if (a.type === 'enemy') {
        state = { on_ground: a.state.on_ground ? 1 : 0 };
      } else if (a.type === 'breakable_platform') {
        state = { hit_count: a.state.hit_count || 0 };
      } else if (a.type === 'platform') {
        state = { width: a.state.width || 32 };
      }
      return { name: a.name, type: a.type, pos: [a.body.position.x, a.body.position.y], vel: [a.body.velocity.x, a.body.velocity.y], state };
    })
    .filter(Boolean);
  res.json({
    frame: game.frame,
    stage: game.stage,
    snapshot
  });
});

app.get('/health', (req, res) => {
  const isHealthy = !game.paused && game.frame > 0 && game.clients.size >= 0;
  if (isHealthy) {
    res.status(200).json({ status: 'healthy', frame: game.frame, stage: game.stage, clients: game.clients.size });
  } else {
    res.status(503).json({ status: 'unhealthy', reason: game.paused ? 'paused' : 'no_frames' });
  }
});

let tickCount = 0;
let frameTimes = [];
const MAX_FRAME_HISTORY = 60;

let tickInterval = setInterval(() => {
  const tickStart = Date.now();
  try {
    try {
      game.tick();
    } catch (e) {
      console.error(`[TICK_CRASH] Frame ${game.frame}: ${e.message}`);
      console.error(e.stack);
      game.paused = true;
      try {
        game.pendingInput.clear();
        game.heldInput.clear();
      } catch (ce) {
        console.error(`[TICK_CRASH_CLEANUP] Failed to clear input: ${ce.message}`);
      }
      try {
        game.broadcastToClients([MSG_TYPES.UPDATE, { error: 'Game tick error', frame: game.frame }]);
      } catch (be) {
        console.error(`[TICK_CRASH_BROADCAST] Failed to notify clients: ${be.message}`);
      }
      return;
    }

    try {
      if (updateVersion >= 2147483647) {
        console.error('[VERSION_OVERFLOW] Resetting version');
        updateVersion = 0;
      }
      updateVersion++;
      game.broadcastStateUpdate(updateVersion);
      tickCount++;
    } catch (e) {
      console.error(`[BROADCAST_CRASH] Frame ${game.frame}: ${e.message}`);
      console.error(e.stack);
    }

    try {
      const tickTime = Math.max(0, Date.now() - tickStart);
      if (isFinite(tickTime) && tickTime >= 0) {
        frameTimes.push(tickTime);
        if (frameTimes.length > MAX_FRAME_HISTORY) {
          frameTimes.shift();
        }
      }

      if (tickCount % 300 === 0) {
        try {
          const avgTime = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
          const maxTime = frameTimes.length > 0 ? Math.max(...frameTimes) : 0;
          const fps = 1000 / TICK_MS;
          const health = avgTime < TICK_MS * 0.8 ? '✓' : avgTime < TICK_MS ? '⚠' : '✗';
          console.log(`[PERF] Frame ${game.frame} | ${health} Avg: ${avgTime.toFixed(1)}ms Max: ${maxTime}ms FPS: ${fps} | Clients: ${game.clients.size} Actors: ${game.actors.size}`);
        } catch (e) {
          console.error(`[PERF_CALC] Error: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[TICK_PERF] Error: ${e.message}`);
    }
  } catch (e) {
    console.error(`[TICK_INTERVAL] Unhandled error: ${e.message}`);
    console.error(e.stack);
  }
}, TICK_MS);

app.get('/api/perf', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  let avgTime = 0, maxTime = 0, minTime = 0;
  if (frameTimes.length > 0) {
    avgTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    maxTime = Math.max(...frameTimes);
    minTime = Math.min(...frameTimes);
    if (!isFinite(avgTime)) avgTime = 0;
    if (!isFinite(maxTime)) maxTime = 0;
    if (!isFinite(minTime)) minTime = 0;
  }
  const uptimeSeconds = Math.floor((tickCount * TICK_MS) / 1000);
  res.json({
    frame: game.frame,
    fps: Math.round(1000 / TICK_MS),
    avgFrameMs: Math.round(avgTime * 10) / 10,
    maxFrameMs: Math.round(maxTime),
    minFrameMs: Math.round(minTime),
    tickMs: TICK_MS,
    uptimeSeconds,
    healthStatus: !game.paused ? 'running' : 'paused'
  });
});
const gracefulShutdown = (signal) => {
  console.error(`[SHUTDOWN] Received ${signal}, closing server gracefully`);
  clearInterval(tickInterval);
  game.clearStageTransitionTimeouts();
  game.clients.forEach((client, playerId) => {
    try {
      if (client && client.ws) {
        client.ws.close(1001, 'Server shutting down');
      }
    } catch (e) {
      console.error(`[SHUTDOWN_ERROR] Failed to close client ${playerId}: ${e.message}`);
    }
  });
  server.close(() => {
    console.error('[SHUTDOWN] Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[SHUTDOWN] Force exit due to timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
