const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Engine, World, Body, Events, Composite } = require('matter-js');
const { Packr, addExtension } = require('msgpackr');

const PORT = process.env.PORT || 3009;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

const msgpack = new Packr({ useRecords: false, maxDepth: 10 });

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

const PHYSICS = {
  GRAVITY: 1200,
  JUMP_VELOCITY: -450,
  PLAYER_SPEED: 200,
  ENEMY_SPEED: 120,
  MAX_FALL_SPEED: 800,
  INVULNERABILITY_TIME: 1.5,
  RESPAWN_TIME: 5
};

const STATE_SCHEMAS = {
  player: {
    fields: ['player_id', 'speed', 'on_ground', 'lives', 'deaths', 'respawn_time', 'invulnerable', 'score', 'stage_time', '_coyote_counter'],
    defaults: { player_id: 0, speed: 200, on_ground: true, lives: 3, deaths: 0, respawn_time: 0, invulnerable: 0, score: 0, stage_time: 0, _coyote_counter: 0 }
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

function buildInitMessage(playerId, stage, levelName, goal, frame, actors) {
  return [MSG_TYPES.INIT, { playerId, stage, levelName, goal, frame, actors }];
}

function buildUpdateMessage(version, frame, stage, actors) {
  return [MSG_TYPES.UPDATE, { version, frame, stage, actors }];
}

function buildGoalMessage(playerId, stage) {
  return [MSG_TYPES.GOAL, { playerId, stage }];
}

function buildStageloadMessage(stage, levelName, goal, actors) {
  return [MSG_TYPES.STAGELOAD, { stage, levelName, goal, actors }];
}

function buildGameWonMessage(totalScore) {
  return [MSG_TYPES.GAME_WON, { totalScore }];
}

function buildPauseMessage() {
  return [MSG_TYPES.PAUSE, {}];
}

function buildResumeMessage() {
  return [MSG_TYPES.RESUME, {}];
}

function computeStateChecksum(actors) {
  let sum = 0;
  for (const [name, actor] of actors) {
    if (actor.state.removed) continue;
    const x = Math.round(actor.body.position.x);
    const y = Math.round(actor.body.position.y);
    const vx = Math.round(actor.body.velocity.x);
    const vy = Math.round(actor.body.velocity.y);
    sum += (x + y + vx + vy);
    if (actor.type === 'player') {
      const lives = actor.state.lives || 0;
      const score = actor.state.score || 0;
      sum += (lives + score);
    }
  }
  return sum & 0xFFFFFFFF;
}

function serializeActorState(actor) {
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
    base.w = state.width || 32;
    base.p = state.player_id || 0;
    base.l = state.lives !== undefined ? state.lives : 3;
    base.s = state.score || 0;
    base.d = state.deaths || 0;
    base.rt = Math.round((state.respawn_time || 0) * 10) / 10;
    base.iv = Math.round((state.invulnerable || 0) * 100) / 100;
    base.og = state.on_ground ? 1 : 0;
  } else if (actor.type === 'enemy') {
    base.og = state.on_ground ? 1 : 0;
  } else if (actor.type === 'platform') {
    base.w = state.width || 32;
  } else if (actor.type === 'breakable_platform') {
    base.w = state.width || 32;
    base.hc = state.hit_count || 0;
  }

  return base;
}

function serializeActorFull(actor) {
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
      width: state.width || 32,
      player_id: state.player_id,
      lives: state.lives,
      score: state.score,
      deaths: state.deaths,
      on_ground: state.on_ground
    };
  } else if (actor.type === 'enemy') {
    base.state = {
      on_ground: state.on_ground
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

function serializeActorDelta(actor, lastState) {
  const current = serializeActorState(actor);
  if (!lastState) return current;

  const delta = { n: current.n };
  for (const key in current) {
    if (key === 'n') continue;
    if (JSON.stringify(current[key]) !== JSON.stringify(lastState[key])) {
      delta[key] = current[key];
    }
  }
  return Object.keys(delta).length > 1 ? delta : null;
}

class PhysicsGame {
  constructor() {
    this.engine = Engine.create();
    this.engine.world.gravity.y = 0;
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
    this.inputRateLimit = new Map();
    this.loadStage(1);
  }

  loadStage(stageNum) {
    this.stage = stageNum;
    const savedPlayers = new Map();
    for (const [playerId, actor] of this.playerActors) {
      if (actor.state.removed) continue;
      savedPlayers.set(playerId, {
        player_id: playerId,
        lives: actor.state.lives,
        score: actor.state.score,
        deaths: actor.state.deaths,
        stage_time: actor.state.stage_time
      });
    }
    this.actors.clear();
    this.playerActors.clear();
    this.bodies.forEach(b => World.remove(this.engine.world, b));
    this.bodies.clear();
    this.lastActorState.clear();
    this.pausedPlayers.clear();
    this.nextNetId = 1;
    this.frame = 0;
    this.stage_over = false;
    this.stage_over_time = 0;
    this.paused = false;

    const levelPath = `levels/stage${stageNum}.json`;
    try {
      const filePath = path.join(__dirname, '..', 'game', levelPath);
      if (!fs.existsSync(filePath)) throw new Error(`Level file not found: ${filePath}`);
      const data = fs.readFileSync(filePath, 'utf8');
      this.level = JSON.parse(data);
      if (!this.level || typeof this.level !== 'object') throw new Error('Invalid level format');
    } catch (e) {
      console.error(`Failed to load stage ${stageNum}:`, e.message);
      this.level = { name: 'Error', platforms: [], enemies: [], goal: null };
    }

    if (this.level.platforms) {
      for (const p of this.level.platforms) {
        if (typeof p.x !== 'number' || typeof p.y !== 'number') {
          console.warn(`[LOAD] Skipping platform with invalid position: ${JSON.stringify(p)}`);
          continue;
        }
        this.spawn(p.breakable ? 'breakable_platform' : 'platform', [p.x, p.y], { max_hits: p.max_hits || 3, width: p.width || 32 });
      }
    }
    if (this.level.enemies) {
      for (const e of this.level.enemies) {
        if (typeof e.x !== 'number' || typeof e.y !== 'number') {
          console.warn(`[LOAD] Skipping enemy with invalid position: ${JSON.stringify(e)}`);
          continue;
        }
        this.spawn('enemy', [e.x, e.y], { speed: e.speed || 120, patrol_dir: e.dir || -1 });
      }
    }

    for (const [playerId, playerState] of savedPlayers) {
      const spawnPos = this.getSpawnPosition(playerId);
      const playerSpawnExtra = {
        player_id: playerId,
        lives: playerState.lives,
        score: playerState.score,
        deaths: playerState.deaths,
        stage_time: playerState.stage_time
      };
      this.spawn('player', spawnPos, playerSpawnExtra);
    }
  }

  spawn(type, pos, extra = {}) {
    const schema = STATE_SCHEMAS[type];
    if (!schema) {
      console.error(`[SPAWN] Unknown actor type: ${type}`);
      return null;
    }

    const width = extra.width || 32;
    const height = (type === 'platform' || type === 'breakable_platform') ? 16 : 32;
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
    state.width = width;
    state._goal_reached = false;
    state._landed_this_frame = false;
    state._hit_this_frame = null;

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
    this.frame++;

    if (!this.paused) {
      this.processPendingInput();
      this.updateRespawns();
      this.updateActors();

      // Save position BEFORE movement for swept collision detection
      for (const [name, actor] of this.actors) {
        if (!actor.body) continue;
        actor.body._prevPos = { x: actor.body.position.x, y: actor.body.position.y };
      }

      for (const [name, actor] of this.actors) {
        if (!actor.body) continue;
        actor.body.position.x += actor.body.velocity.x * (TICK_MS / 1000);
        actor.body.position.y += actor.body.velocity.y * (TICK_MS / 1000);
      }

      this.checkCollisions();
      this.checkGoal();
      this.updateGameState();
    }

    this.removeDeadActors();
  }

  processPendingInput() {
    for (const [playerId, input] of this.pendingInput) {
      if (input.action === 'move') {
        const rawDir = input.direction || 0;
        const dir = typeof rawDir === 'number' ? (rawDir > 0 ? 1 : rawDir < 0 ? -1 : 0) : 0;
        if (dir === 0) {
          this.heldInput.delete(playerId);
          const actor = this.playerActors.get(playerId);
          if (actor && !actor.state.removed) actor.body.velocity.x = 0;
        } else {
          this.heldInput.set(playerId, { action: 'move', direction: dir });
        }
      } else if (input.action === 'jump') {
        const actor = this.playerActors.get(playerId);
        if (actor && !actor.state.removed && (actor.state.on_ground || actor.state._coyote_counter < 6)) {
          actor.body.velocity.y = PHYSICS.JUMP_VELOCITY;
          actor.state._coyote_counter = 6;
        }
      }
    }
    this.pendingInput.clear();

    for (const [playerId, input] of this.heldInput) {
      const actor = this.playerActors.get(playerId);
      if (!actor || actor.state.removed) continue;
      if (input.action === 'move') {
        const dir = input.direction || 0;
        if (typeof dir === 'number') {
          const vel = dir * actor.state.speed;
          actor.body.velocity.x = vel;
        }
      }
    }
  }

  getSpawnPosition(playerId) {
    const baseX = 500 + (playerId - 1) * 50;
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

    for (let radius = 0; radius < searchRadius; radius += 20) {
      const candidates = [
        [baseX + radius, baseY],
        [baseX - radius, baseY],
        [baseX, baseY - radius],
        [baseX, baseY + radius]
      ];

      for (const pos of candidates) {
        if (isValidSpawn(pos)) {
          return pos;
        }
      }
    }
    return [baseX, baseY];
  }

  updateRespawns() {
    for (const [name, actor] of this.actors) {
      if (actor.type !== 'player') continue;

      if (actor.state.respawn_time > 0) {
        actor.state.respawn_time -= TICK_MS / 1000;

        if (actor.state.respawn_time <= 0) {
          const spawnPos = this.getSpawnPosition(actor.state.player_id);
          actor.body.position.x = spawnPos[0];
          actor.body.position.y = spawnPos[1];
          actor.body.velocity.x = 0;
          actor.body.velocity.y = 0;
          actor.state.respawn_time = -1;
          actor.state.on_ground = true;
          actor.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
        } else {
          actor.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
        }
      } else if (actor.state.invulnerable > 0) {
        actor.state.invulnerable = Math.max(0, actor.state.invulnerable - TICK_MS / 1000);
      }

      actor.state.stage_time += TICK_MS / 1000;
    }
  }

  updateActors() {
    for (const [name, actor] of this.actors) {
      if (actor.state.removed) continue;
      if (actor.type === 'enemy') {
        const dir = actor.state.patrol_dir > 0 ? 1 : -1;
        actor.body.velocity.x = dir * actor.state.speed;

        const minBound = 50;
        const maxBound = 1230;
        const turnDistance = 30;

        if ((actor.body.position.x < minBound + turnDistance && dir < 0) ||
            (actor.body.position.x > maxBound - turnDistance && dir > 0)) {
          actor.state.patrol_dir *= -1;
        }
      }

      if (actor.type === 'player' || actor.type === 'enemy') {
        if (!actor.state.on_ground) {
          actor.body.velocity.y = Math.min(
            actor.body.velocity.y + PHYSICS.GRAVITY * (TICK_MS / 1000),
            PHYSICS.MAX_FALL_SPEED
          );
        }
        if (actor.state._coyote_counter < 6) {
          actor.state._coyote_counter++;
        }
      }

      actor.state._landed_this_frame = false;

      if (actor.body.position.y > 750) {
        actor.state.removed = true;
      }
    }
  }

  checkCollisions() {
    const checked = new Set();
    const contactingPlatforms = new Map();

    for (const [name, actor] of this.actors) {
      if (actor.type === 'breakable_platform' && actor.state._hit_this_frame) {
        actor.state._hit_this_frame.clear();
      }
    }

    for (const [nameA, actorA] of this.actors) {
      if (actorA.type === 'player' || actorA.type === 'enemy') {
        contactingPlatforms.set(nameA, []);
      }
    }

    for (const [nameA, actorA] of this.actors) {
      for (const [nameB, actorB] of this.actors) {
        if (nameA === nameB) continue;
        if (actorA.state.removed || actorB.state.removed) continue;

        const pairKey = [nameA, nameB].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const bodyA = actorA.body;
        const bodyB = actorB.body;
        const aabbHits = this.checkAABB(bodyA, bodyB);

        if (aabbHits) {
          if (actorB.type === 'enemy' && actorA.type === 'player') {
            if (actorA.state.invulnerable <= 0) {
              actorA.state.deaths++;
              actorA.state.lives--;
              actorA.state.respawn_time = PHYSICS.RESPAWN_TIME;
              actorA.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
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

          if (movingActor && platformActor) {
            const prevY = movingBody._prevPos?.y || movingBody.position.y;
            const prevX = movingBody._prevPos?.x || movingBody.position.x;
            const platformTop = platformBody.position.y - (platformBody._height || 16) / 2;
            const platformBot = platformBody.position.y + (platformBody._height || 16) / 2;
            const platformLeft = platformBody.position.x - (platformBody._width || 32) / 2;
            const platformRight = platformBody.position.x + (platformBody._width || 32) / 2;
            const playerHH = (movingBody._height || 32) / 2;
            const playerHW = (movingBody._width || 32) / 2;
            const prevPlayerBottom = prevY + playerHH;
            const playerBottom = movingBody.position.y + playerHH;
            const playerLeft = movingBody.position.x - playerHW;
            const playerRight = movingBody.position.x + playerHW;
            const xOverlap = playerRight >= platformLeft && playerLeft <= platformRight;
            const landingFromAbove = xOverlap && movingBody.velocity.y > 0 && prevPlayerBottom < platformTop && playerBottom >= platformTop;
            const restingOnPlatform = xOverlap && playerBottom >= platformTop && playerBottom <= platformTop;

            if (landingFromAbove || restingOnPlatform) {
              movingBody.velocity.y = 0;
              movingActor.state._coyote_counter = 0;

              if (!contactingPlatforms.has(movingActor.name)) {
                contactingPlatforms.set(movingActor.name, []);
              }
              const contactList = contactingPlatforms.get(movingActor.name);
              if (contactList) {
                contactList.push(platformActor.name);
              }

              if (platformActor.type === 'breakable_platform') {
                if (!platformActor.state._hit_this_frame) {
                  platformActor.state._hit_this_frame = new Set();
                }
                if (!platformActor.state._hit_this_frame.has(movingActor.name)) {
                  platformActor.state._hit_this_frame.add(movingActor.name);
                  platformActor.state.hit_count++;
                  if (movingActor.type === 'player') {
                    movingActor.state.score += 10;
                  }
                }
                if (platformActor.state.hit_count >= platformActor.state.max_hits && !platformActor.state._confirmed_broken) {
                  platformActor.state._confirmed_broken = true;
                  platformActor.state.removed = true;
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
    const aHalfW = (bodyA._width || 32) / 2;
    const aHalfH = (bodyA._height || 32) / 2;
    const bHalfW = (bodyB._width || 32) / 2;
    const bHalfH = (bodyB._height || 32) / 2;
    const prevPosA = bodyA._prevPos || bodyA.position;
    const aTop = Math.min(prevPosA.y, bodyA.position.y) - aHalfH;
    const aBot = Math.max(prevPosA.y, bodyA.position.y) + aHalfH;
    const aLeft = Math.min(prevPosA.x, bodyA.position.x) - aHalfW;
    const aRight = Math.max(prevPosA.x, bodyA.position.x) + aHalfW;
    const bTop = bodyB.position.y - bHalfH;
    const bBot = bodyB.position.y + bHalfH;
    const bLeft = bodyB.position.x - bHalfW;
    const bRight = bodyB.position.x + bHalfW;
    const xOverlap = aRight >= bLeft && aLeft <= bRight;
    const yOverlap = aBot >= bTop && aTop <= bBot;
    return xOverlap && yOverlap;
  }

  checkGoal() {
    if (!this.level.goal || typeof this.level.goal.x !== 'number' || typeof this.level.goal.y !== 'number') return;
    for (const [_, actor] of this.actors) {
      if (actor.type === 'player' && !actor.state._goal_reached && !actor.state.removed && actor.body) {
        const dist = Math.hypot(actor.body.position.x - this.level.goal.x, actor.body.position.y - this.level.goal.y);
        if (dist < 40) {
          actor.state._goal_reached = true;
          this.broadcastGoalReached(actor.state.player_id);
        }
      }
    }
  }

  removeDeadActors() {
    for (const [name, actor] of this.actors) {
      if (actor.state.removed) {
        if (actor.type === 'player') {
          console.error(`[REMOVE] Removing player ${actor.state.player_id} (${name})`);
          this.playerActors.delete(actor.state.player_id);
        }
        World.remove(this.engine.world, actor.body);
        this.actors.delete(name);
        this.bodies.delete(name);
        this.lastActorState.delete(name);
      }
    }
  }

  updateGameState() {
    const activePlayers = Array.from(this.actors.values())
      .filter(a => a.type === 'player' && a.state.lives > 0);

    if (activePlayers.length === 0) {
      const connectedPlayers = Array.from(this.actors.values())
        .filter(a => a.type === 'player' && !a.state.removed && this.clients.has(a.state.player_id));
      if (connectedPlayers.length > 0 && !this.stage_over) {
        this.stage_over = true;
        this.stage_over_time = this.frame;
        console.error(`[GAMEOVER] All players eliminated at frame ${this.frame}`);
      }
    }

    if (this.stage_over && this.frame - this.stage_over_time >= 180) {
      console.error(`[RESTART] Reloading stage ${this.stage} after 3 seconds`);
      this.loadStage(this.stage);
      this.stage_over = false;
      this.clients.forEach((client) => {
        const spawnPos = this.getSpawnPosition(client.playerId);
        this.spawn('player', spawnPos, { player_id: client.playerId });
      });
    }
  }

  broadcastGoalReached(playerId) {
    if (this.stage_transitioning) return;

    const msg = buildGoalMessage(playerId, this.stage);
    this.broadcastToClients(msg);

    if (this.stage === 4) {
      const player = Array.from(this.actors.values()).find(a => !a.state.removed && a.state.player_id === playerId);
      const totalScore = player ? player.state.score || 0 : 0;
      setTimeout(() => {
        const winMsg = buildGameWonMessage(totalScore);
        this.broadcastToClients(winMsg);
      }, 1000);
    } else {
      this.stage_transitioning = true;
      setTimeout(() => {
        this.nextStage();
        this.stage_transitioning = false;
      }, 3000);
    }
  }

  broadcastStateUpdate(version) {
    const actors = {};
    for (const [name, actor] of this.actors) {
      if (actor.state.removed) continue;
      const delta = serializeActorDelta(actor, this.lastActorState.get(name));
      if (delta) {
        actors[name] = delta;
      }
    }
    for (const [name, actor] of this.actors) {
      if (actor.state.removed) continue;
      this.lastActorState.set(name, serializeActorState(actor));
    }
    if (this.lastActorState.size > 1000) {
      const activeNames = new Set(this.actors.keys());
      for (const [name] of this.lastActorState) {
        if (!activeNames.has(name)) {
          this.lastActorState.delete(name);
        }
      }
    }
    const data = { version, frame: this.frame, stage: this.stage, actors };
    if (this.frame % 10 === 0) {
      data.checksum = computeStateChecksum(this.actors);
    }
    const msg = [MSG_TYPES.UPDATE, data];
    this.broadcastToClients(msg);
  }

  serializeActor(actor) {
    return serializeActorFull(actor);
  }

  broadcastToClients(message) {
    let msg;
    try {
      msg = JSON.stringify(message);
    } catch (e) {
      console.error('JSON encode error:', e.message);
      return;
    }

    const msgSize = msg.length;
    stats.messagesSent++;
    stats.windowBytes += msgSize;
    stats.windowMessages++;

    const now = Date.now();
    const windowDuration = (now - stats.windowStartTime) / 1000;
    if (windowDuration >= 1) {
      stats.bytesPerSecond = Math.round(stats.windowBytes / windowDuration);
      stats.messagesSentPerSecond = Math.round(stats.windowMessages / windowDuration);
      stats.peakBytesPerSecond = Math.max(stats.peakBytesPerSecond, stats.bytesPerSecond);
      stats.windowBytes = 0;
      stats.windowMessages = 0;
      stats.windowStartTime = now;
    }

    const deadClients = [];
    this.clients.forEach((client, playerId) => {
      if (client && client.ws) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(msg);
          } catch (e) {
            console.error(`Broadcast error for player ${playerId}:`, e.message);
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

  nextStageClients() {
    const deadClients = [];
    const actors = Array.from(this.actors.values())
      .filter(a => !a.state.removed)
      .map(a => serializeActorFull(a));
    const msg = buildStageloadMessage(this.stage, this.level.name, this.level.goal, actors);
    this.clients.forEach((client, playerId) => {
      if (client && client.ws) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(JSON.stringify(msg));
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
const getNextPlayerId = () => ++nextPlayerId;
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
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  const playerId = getNextPlayerId();
  const spawnPos = game.getSpawnPosition(playerId);
  const actor = game.spawn('player', spawnPos, { player_id: playerId });
  if (!actor) {
    console.error(`Failed to spawn player ${playerId}`);
    ws.close();
    return;
  }

  const client = { ws, playerId };
  game.clients.set(playerId, client);

  const actors = Array.from(game.actors.values())
    .filter(a => !a.state.removed)
    .map(a => serializeActorFull(a));
  const initMsg = buildInitMessage(playerId, game.stage, game.level.name, game.level.goal, game.frame, actors);
  ws.send(JSON.stringify(initMsg));

  ws.on('message', (msg) => {
    try {
      if (!msg) return;
      const data = JSON.parse(msg.toString());
      if (!data || typeof data !== 'object') return;

      const { action, direction } = data;

      if (action === 'move') {
        if (typeof direction === 'number') {
          const dir = direction > 0 ? 1 : direction < 0 ? -1 : 0;
          game.pendingInput.set(playerId, { action: 'move', direction: dir });
        }
      } else if (action === 'jump') {
        game.pendingInput.set(playerId, { action: 'jump' });
      } else if (action === 'nextstage') {
        const actor = game.playerActors.get(playerId);
        if (actor && !actor.state.removed && actor.state._goal_reached && !game.stage_transitioning) {
          game.nextStage();
        }
      } else if (action === 'pause') {
        if (game.clients.has(playerId)) {
          game.pausedPlayers.add(playerId);
          const connectedCount = Array.from(game.pausedPlayers).filter(pid => game.clients.has(pid)).length;
          const allConnectedPaused = connectedCount > 0 && connectedCount === game.clients.size;
          if (allConnectedPaused) {
            game.paused = true;
            game.broadcastToClients(buildPauseMessage());
          }
        }
      } else if (action === 'resume') {
        game.pausedPlayers.delete(playerId);
        const connectedCount = Array.from(game.pausedPlayers).filter(pid => game.clients.has(pid)).length;
        const anyConnectedPaused = connectedCount > 0;
        if (!anyConnectedPaused && game.clients.size > 0) {
          game.paused = false;
          game.broadcastToClients(buildResumeMessage());
        }
      }
    } catch (e) {
      console.error('Parse error:', e.message);
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

    const connectedCount = Array.from(game.pausedPlayers).filter(pid => game.clients.has(pid)).length;
    const anyConnectedPaused = connectedCount > 0;
    if (game.paused && !anyConnectedPaused && game.clients.size > 0) {
      game.paused = false;
      game.broadcastToClients(buildResumeMessage());
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

app.get('/api/status', (req, res) => {
  const players = [];
  for (const [playerId, actor] of game.playerActors) {
    if (!game.actors.has(actor.name)) continue;
    const p = {
      id: actor.state.player_id,
      pos: [actor.body.position.x, actor.body.position.y],
      vel: [actor.body.velocity.x, actor.body.velocity.y],
      on_ground: actor.state.on_ground,
      lives: actor.state.lives,
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
  res.json(Array.from(game.actors.values())
    .filter(a => !a.state.removed)
    .map(a => {
      let state = {};
      if (a.type === 'player') {
        state = { width: a.state.width, player_id: a.state.player_id, lives: a.state.lives, score: a.state.score, deaths: a.state.deaths, on_ground: a.state.on_ground };
      } else if (a.type === 'enemy') {
        state = { on_ground: a.state.on_ground };
      } else if (a.type === 'platform') {
        state = { width: a.state.width };
      } else if (a.type === 'breakable_platform') {
        state = { width: a.state.width, hit_count: a.state.hit_count };
      }
      return { name: a.name, type: a.type, pos: [a.body.position.x, a.body.position.y], vel: [a.body.velocity.x, a.body.velocity.y], state };
    }));
});

app.get('/api/actor/:name', (req, res) => {
  const actor = game.actors.get(req.params.name);
  if (!actor || actor.state.removed) return res.status(404).json({ error: 'Actor not found' });
  let state = {};
  if (actor.type === 'player') {
    state = { width: actor.state.width, player_id: actor.state.player_id, lives: actor.state.lives, score: actor.state.score, deaths: actor.state.deaths, on_ground: actor.state.on_ground };
  } else if (actor.type === 'enemy') {
    state = { on_ground: actor.state.on_ground };
  } else if (actor.type === 'platform') {
    state = { width: actor.state.width };
  } else if (actor.type === 'breakable_platform') {
    state = { width: actor.state.width, hit_count: actor.state.hit_count };
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
  const num = parseInt(req.params.num);
  if (isNaN(num) || num < 1 || num > 4) return res.status(400).json({ error: 'Invalid stage' });
  if (num !== game.stage) game.loadStage(num);
  res.json({ stage: game.stage, name: game.level.name });
});

app.post('/api/spawn/:type', (req, res) => {
  const { x = 640, y = 360, ...extra } = req.body || {};
  if (req.params.type === 'player' && !extra.player_id) {
    const maxId = Array.from(game.playerActors.keys()).reduce((max, id) => Math.max(max, id), 0);
    extra.player_id = maxId + 1;
  }
  const actor = game.spawn(req.params.type, [x, y], extra);
  if (!actor) {
    return res.status(400).json({ error: 'Invalid actor type' });
  }
  res.json({ ok: true });
});

app.post('/api/input', (req, res) => {
  const { player_id, action, direction } = req.body || {};
  if (player_id === undefined || player_id === null || !action) {
    return res.status(400).json({ error: 'player_id and action required' });
  }
  if (!game.checkInputRateLimit(player_id)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  if (action === 'move') {
    if (typeof direction !== 'number') {
      return res.status(400).json({ error: 'direction must be a number' });
    }
    const dir = direction > 0 ? 1 : direction < 0 ? -1 : 0;
    game.pendingInput.set(player_id, { action: 'move', direction: dir });
  } else if (action === 'jump') {
    game.pendingInput.set(player_id, { action: 'jump' });
  }
  res.json({ ok: true });
});

app.get('/api/levels', (req, res) => {
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
  const num = parseInt(req.params.num);
  if (isNaN(num) || num < 1 || num > 4) return res.status(400).json({ error: 'Invalid stage' });
  const filePath = path.join(__dirname, '..', 'game', `levels/stage${num}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Level not found' });
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Invalid level format' });
  }
});

app.get('/api/stats', (req, res) => {
  const players = Array.from(game.playerActors.values())
    .filter(p => !p.state.removed)
    .map(p => ({
      id: p.state.player_id,
      score: p.state.score,
      lives: p.state.lives,
      deaths: p.state.deaths,
      stage_time: Math.round(p.state.stage_time * 10) / 10,
      x: Math.round(p.body.position.x),
      y: Math.round(p.body.position.y),
      vx: Math.round(p.body.velocity.x),
      vy: Math.round(p.body.velocity.y),
      respawning: p.state.respawn_time > 0
    }));

  const platforms = Array.from(game.actors.values())
    .filter(a => !a.state.removed && a.type.includes('platform'))
    .map(p => ({ name: p.name, hits: p.state.hit_count, max_hits: p.state.max_hits }));

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
  res.json({
    frame: game.frame,
    stage: game.stage,
    snapshot: Array.from(game.actors.values())
      .filter(a => !a.state.removed)
      .map(a => {
        let state = {};
        if (a.type === 'player') {
          state = { lives: a.state.lives, score: a.state.score, respawn_time: a.state.respawn_time, on_ground: a.state.on_ground };
        } else if (a.type === 'breakable_platform') {
          state = { hit_count: a.state.hit_count };
        }
        return { name: a.name, type: a.type, pos: [a.body.position.x, a.body.position.y], vel: [a.body.velocity.x, a.body.velocity.y], state };
      })
  });
});

let tickCount = 0;
let frameTimes = [];
const MAX_FRAME_HISTORY = 60;

setInterval(() => {
  const tickStart = Date.now();
  try {
    game.tick();
  } catch (e) {
    console.error(`[TICK_CRASH] Frame ${game.frame}: ${e.message}`);
    console.error(e.stack);
    game.paused = true;
    game.broadcastToClients([MSG_TYPES.UPDATE, { error: 'Game tick error' }]);
    return;
  }

  try {
    updateVersion++;
    game.broadcastStateUpdate(updateVersion);
    tickCount++;

    const tickTime = Date.now() - tickStart;
    frameTimes.push(tickTime);
    if (frameTimes.length > MAX_FRAME_HISTORY) {
      frameTimes.shift();
    }

    if (tickCount % 300 === 0) {
      const avgTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const maxTime = Math.max(...frameTimes);
      const fps = 1000 / TICK_MS;
      const health = avgTime < TICK_MS * 0.8 ? '✓' : avgTime < TICK_MS ? '⚠' : '✗';
      console.error(`[PERF] Frame ${game.frame} | ${health} Avg: ${avgTime.toFixed(1)}ms Max: ${maxTime}ms FPS: ${fps} | Clients: ${game.clients.size} Actors: ${game.actors.size}`);
    }
  } catch (e) {
    console.error(`[BROADCAST_CRASH] Frame ${game.frame}: ${e.message}`);
    console.error(e.stack);
  }
}, TICK_MS);

app.get('/api/perf', (req, res) => {
  const avgTime = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
  const maxTime = frameTimes.length > 0 ? Math.max(...frameTimes) : 0;
  const minTime = frameTimes.length > 0 ? Math.min(...frameTimes) : 0;
  res.json({
    frame: game.frame,
    fps: 1000 / TICK_MS,
    avgFrameMs: avgTime,
    maxFrameMs: maxTime,
    minFrameMs: minTime,
    tickMs: TICK_MS,
    uptime: Math.floor(tickCount / 60) + 's'
  });
});


server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
