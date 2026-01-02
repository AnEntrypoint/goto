const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Engine, World, Body, Events, Composite } = require('matter-js');
const { Packr, addExtension } = require('msgpackr');

const PORT = process.env.PORT || 3008;
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

function computeStateChecksum(actors) {
  let sum = 0;
  for (const [name, actor] of actors) {
    const x = Math.round(actor.body.position.x);
    const y = Math.round(actor.body.position.y);
    const vx = Math.round(actor.body.velocity.x);
    const vy = Math.round(actor.body.velocity.y);
    const lives = actor.state.lives || 0;
    const score = actor.state.score || 0;
    sum += (x + y + vx + vy + lives + score);
  }
  return sum & 0xFFFFFFFF;
}

function serializeActorState(actor) {
  return {
    n: actor.name,
    t: actor.type,
    x: Math.round(actor.body.position.x * 10) / 10,
    y: Math.round(actor.body.position.y * 10) / 10,
    vx: Math.round(actor.body.velocity.x * 10) / 10,
    vy: Math.round(actor.body.velocity.y * 10) / 10,
    w: actor.state.width,
    p: actor.state.player_id || 0,
    l: actor.state.lives || 0,
    s: actor.state.score || 0,
    d: actor.state.deaths || 0,
    rt: Math.round(actor.state.respawn_time * 10) / 10,
    iv: Math.round(actor.state.invulnerable * 100) / 100,
    og: actor.state.on_ground ? 1 : 0,
    hc: actor.state.hit_count || 0
  };
}

function serializeActorFull(actor) {
  return {
    name: actor.name,
    type: actor.type,
    net_id: actor.net_id,
    pos: [actor.body.position.x, actor.body.position.y],
    vel: [actor.body.velocity.x, actor.body.velocity.y],
    state: {
      width: actor.state.width,
      player_id: actor.state.player_id,
      lives: actor.state.lives,
      score: actor.state.score,
      deaths: actor.state.deaths,
      on_ground: actor.state.on_ground,
      hit_count: actor.state.hit_count
    }
  };
}

function serializeActorDelta(actor, lastState) {
  const current = serializeActorState(actor);
  if (!lastState) return current;

  const delta = {};
  for (const key in current) {
    if (JSON.stringify(current[key]) !== JSON.stringify(lastState[key])) {
      delta[key] = current[key];
    }
  }
  return Object.keys(delta).length > 0 ? delta : null;
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
    this.contacts = new Map();
    this.paused = false;
    this.pausedPlayers = new Set();
    this.lastActorState = new Map();
    this.loadStage(1);
  }

  loadStage(stageNum) {
    this.stage = stageNum;
    this.actors.clear();
    this.bodies.forEach(b => World.remove(this.engine.world, b));
    this.bodies.clear();
    this.contacts.clear();
    this.nextNetId = 1;
    this.frame = 0;
    this.stage_over = false;
    this.stage_over_time = 0;

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
        this.spawn(p.breakable ? 'breakable_platform' : 'platform', [p.x, p.y], { max_hits: p.max_hits || 3, width: p.width || 32 });
      }
    }
    if (this.level.enemies) {
      for (const e of this.level.enemies) {
        this.spawn('enemy', [e.x, e.y], { speed: e.speed || 100, patrol_dir: e.dir || -1 });
      }
    }
  }

  spawn(type, pos, extra = {}) {
    const width = extra.width || 32;
    const height = (type === 'platform' || type === 'breakable_platform') ? 16 : 32;
    const isStatic = type === 'platform' || type === 'breakable_platform';

    const body = Body.create({
      position: { x: pos[0], y: pos[1] },
      isStatic,
      friction: isStatic ? 0.5 : 0,
      restitution: 0,
      label: `${type}_${this.nextNetId}`,
      collisionFilter: { category: type === 'player' ? 1 : 2 },
      circleRadius: Math.max(width, height) / 2
    });
    body._width = width;
    body._height = height;

    World.add(this.engine.world, body);

    const actor = {
      name: body.label,
      type,
      net_id: this.nextNetId++,
      body,
      state: {
        player_id: extra.player_id,
        speed: extra.speed || (type === 'player' ? PHYSICS.PLAYER_SPEED : PHYSICS.ENEMY_SPEED),
        patrol_dir: extra.patrol_dir || -1,
        on_ground: type === "player" ? true : false,
        hit_count: 0,
        max_hits: extra.max_hits || 3,
        width: extra.width || 32,
        removed: false,
        _coyote_counter: 0,
        lives: type === 'player' ? 3 : 0,
        deaths: 0,
        respawn_time: 0,
        invulnerable: 0,
        score: 0,
        stage_time: 0
      }
    };

    console.error(`[SPAWN] Adding ${type} as "${actor.name}" to actors map (actor: ${JSON.stringify({name:actor.name, type, player_id:actor.state.player_id})})`);
    this.actors.set(actor.name, actor);
    console.error(`[SPAWN] Actors map size after add: ${this.actors.size}`);
    this.bodies.set(actor.name, body);

    if (type === 'player' && extra.player_id) {
      this.playerActors.set(extra.player_id, actor);
      console.error(`[SPAWN] Player ${extra.player_id} spawned as ${actor.name} (net_id=${actor.net_id})`);
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
        const dir = input.direction || 0;
        if (dir === 0) {
          this.heldInput.delete(playerId);
        } else {
          this.heldInput.set(playerId, { action: 'move', direction: dir });
        }
      } else if (input.action === 'jump') {
        const actor = this.playerActors.get(playerId);
        if (actor && (actor.state.on_ground || actor.state._coyote_counter < 6)) {
          actor.body.velocity.y = PHYSICS.JUMP_VELOCITY;
          actor.state._coyote_counter = 6;
        }
      }
    }
    this.pendingInput.clear();

    for (const [playerId, input] of this.heldInput) {
      const actor = this.playerActors.get(playerId);
      if (!actor) {
        console.error(`[INPUT] Player ${playerId} actor not found`);
        continue;
      }
      if (input.action === 'move') {
        const vel = input.direction * actor.state.speed;
        actor.body.velocity.x = vel;
        if (this.frame % 60 === 0) {
          console.error(`[INPUT] Player ${playerId}: setting velocity.x = ${vel} (dir=${input.direction}, speed=${actor.state.speed}), body.pos.x=${actor.body.position.x.toFixed(1)}`);
        }
      }
    }
  }

  getSpawnPosition(playerId) {
    const baseX = 500 + (playerId - 1) * 50;
    const baseY = 656;
    const searchRadius = 100;

    for (let radius = 0; radius < searchRadius; radius += 20) {
      const candidates = [
        [baseX + radius, baseY],
        [baseX - radius, baseY],
        [baseX, baseY - radius],
        [baseX, baseY + radius]
      ];

      for (const pos of candidates) {
        const occupied = Array.from(this.actors.values()).some(a =>
          a.type === 'player' &&
          a.state.player_id !== playerId &&
          Math.abs(a.body.position.x - pos[0]) < 40 &&
          Math.abs(a.body.position.y - pos[1]) < 40
        );
        if (!occupied) {
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
        if (this.frame % 30 === 0) {
          console.error(`[RESPAWN] Player ${actor.state.player_id}: respawn_time=${actor.state.respawn_time.toFixed(1)}s`);
        }

        if (actor.state.respawn_time <= 0 && actor.state.respawn_time > -0.016) {
          const spawnPos = this.getSpawnPosition(actor.state.player_id);
          actor.body.position.x = spawnPos[0];
          actor.body.position.y = spawnPos[1];
          actor.body.velocity.x = 0;
          actor.body.velocity.y = 0;
          actor.state.respawn_time = -1;
          actor.state.on_ground = true;
          console.error(`[RESPAWN] Player ${actor.state.player_id} respawned at [${spawnPos[0].toFixed(1)}, ${spawnPos[1].toFixed(1)}]`);
        }
      }

      if (actor.state.invulnerable > 0) {
        actor.state.invulnerable -= TICK_MS / 1000;
      }

      actor.state.stage_time += TICK_MS / 1000;
    }
  }

  updateActors() {
    for (const [name, actor] of this.actors) {
      if (actor.type === 'enemy') {
        const dir = actor.state.patrol_dir;
        actor.body.velocity.x = dir * actor.state.speed;

        const minBound = 50;
        const maxBound = 1230;
        const turnDistance = 30;

        if ((actor.body.position.x < minBound + turnDistance && dir < 0) ||
            (actor.body.position.x > maxBound - turnDistance && dir > 0)) {
          actor.state.patrol_dir *= -1;
        }
      }

      if ((actor.type === 'player' || actor.type === 'enemy') && !actor.state.on_ground) {
        actor.body.velocity.y = Math.min(
          actor.body.velocity.y + PHYSICS.GRAVITY * (TICK_MS / 1000),
          PHYSICS.MAX_FALL_SPEED
        );
      }

      actor.state._landed_this_frame = false;
      if (actor.state._coyote_counter < 6) {
        actor.state._coyote_counter++;
      }

      if (actor.body.position.y > 750) {
        if (actor.type === 'player') {
          console.error(`[FALL] Player ${actor.state.player_id} fell below Y=750 at Y=${actor.body.position.y.toFixed(1)}`);
        }
        actor.state.removed = true;
      }
    }
  }

  checkCollisions() {
    const checked = new Set();
    let checkCount = 0;
    let hitCount = 0;
    const contactingPlatforms = new Map();

    // Log first 100 frames to see what's happening
    const verbose = this.frame < 100;

    for (const [nameA, actorA] of this.actors) {
      if (actorA.type === 'player' || actorA.type === 'enemy') {
        contactingPlatforms.set(nameA, []);
      }

      for (const [nameB, actorB] of this.actors) {
        if (nameA === nameB) continue;

        const pairKey = [nameA, nameB].sort().join('|');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        checkCount++;

        const bodyA = actorA.body;
        const bodyB = actorB.body;

        const aabbHits = this.checkAABB(bodyA, bodyB);

        // Debug first player-platform pair
        if (verbose && nameA.includes('player') && nameB.includes('platform') && nameB === 'platform_1') {
          const dx = Math.abs(bodyA.position.x - bodyB.position.x);
          const dy = Math.abs(bodyA.position.y - bodyB.position.y);
          console.error(`[DBG-${this.frame}] ${nameA}@(${bodyA.position.x.toFixed(0)},${bodyA.position.y.toFixed(0)}) vs ${nameB}@(${bodyB.position.x.toFixed(0)},${bodyB.position.y.toFixed(0)}) dx=${dx.toFixed(0)} dy=${dy.toFixed(0)} HIT=${aabbHits}`);
        }
        if (actorA.type === 'player' && actorB.type === 'platform' && this.frame % 120 === 0) {
          const dx = Math.abs(bodyA.position.x - bodyB.position.x);
          const dy = Math.abs(bodyA.position.y - bodyB.position.y);
          const aW = (bodyA._width || 32) / 2;
          const aH = (bodyA._height || 32) / 2;
          const bW = (bodyB._width || 32) / 2;
          const bH = (bodyB._height || 16) / 2;
          console.error(`[AABB] ${nameA}@(${bodyA.position.x.toFixed(0)},${bodyA.position.y.toFixed(0)}) vs ${nameB}@(${bodyB.position.x.toFixed(0)},${bodyB.position.y.toFixed(0)}) | dx=${dx.toFixed(1)}<${(aW+bW).toFixed(1)}? dy=${dy.toFixed(1)}<${(aH+bH).toFixed(1)}? hit=${aabbHits}`);
        }

        if (aabbHits) {
          hitCount++;
          if (this.frame % 60 === 0) {
            console.error(`[HIT] ${nameA} collided with ${nameB}`);
          }
          if (actorB.type === 'enemy' && actorA.type === 'player') {
            console.error(`[COLLISION] Player ${actorA.name} hit by enemy ${actorB.name} at distance dx=${Math.abs(bodyA.position.x - bodyB.position.x).toFixed(1)}, dy=${Math.abs(bodyA.position.y - bodyB.position.y).toFixed(1)}`);
            if (actorA.state.invulnerable <= 0) {
              actorA.state.deaths++;
              actorA.state.lives--;
              actorA.state.respawn_time = PHYSICS.RESPAWN_TIME;
              actorA.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
              console.error(`[DEATH] Player ${actorA.state.player_id} died (lives left: ${actorA.state.lives})`);
            }
          }

          // Handle player/enemy landing on platform (check both directions)
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
            const platformTop = platformBody.position.y - (platformBody._height || 16) / 2;
            const platformBot = platformBody.position.y + (platformBody._height || 16) / 2;
            const playerHH = (movingBody._height || 32) / 2;
            const prevPlayerBottom = prevY + playerHH;
            const playerBottom = movingBody.position.y + playerHH;
            const landingFromAbove = movingBody.velocity.y > 0 && prevPlayerBottom < platformTop && playerBottom >= platformTop;
            const restingOnPlatform = movingBody.velocity.y <= 0 && playerBottom > platformTop - 2 && playerBottom < platformBot + 2;

            if (landingFromAbove || restingOnPlatform) {
              if (movingActor.type === 'player') {
                console.error(`[LAND] Player landed on ${platformActor.name} at Y ${movingBody.position.y.toFixed(1)}`);
              }
              movingBody.velocity.y = 0;
              movingBody.position.y = platformBody.position.y - (movingBody._height || 32) / 2 - (platformBody._height || 16) / 2;
              movingActor.state._coyote_counter = 0;

              // Track contact for on_ground determination
              if (contactingPlatforms.has(movingActor.name)) {
                contactingPlatforms.get(movingActor.name).push(platformActor.name);
              }

              if (platformActor.type === 'breakable_platform') {
                const alreadyHit = platformActor.state._broken_by === movingActor.name;
                if (!alreadyHit) {
                  platformActor.state._broken_by = movingActor.name;
                  platformActor.state.hit_count++;
                  if (movingActor.type === 'player') {
                    movingActor.state.score += 10;
                    console.error(`[SCORE] Player ${movingActor.state.player_id} scored +10 (total: ${movingActor.state.score}) for damaging platform ${platformActor.name}`);
                  }
                }
                if (platformActor.state.hit_count >= platformActor.state.max_hits && !platformActor.state._confirmed_broken) {
                  platformActor.state._confirmed_broken = true;
                  platformActor.state.removed = true;
                  console.error(`[BREAK] Platform ${platformActor.name} broke (${platformActor.state.hit_count}/${platformActor.state.max_hits} hits)`);
                }
              }
            }
          }
        }
      }
    }

    // Set on_ground based on actual platform contact
    for (const [actorName, contactList] of contactingPlatforms) {
      const actor = this.actors.get(actorName);
      if (actor) {
        actor.state.on_ground = contactList.length > 0;
      }
    }

    if (this.frame % 120 === 0) {
      console.error(`[COLLISION-STATS] Checked ${checkCount} pairs, ${hitCount} hits, actors=${this.actors.size}`);
    }
  }

  checkAABB(bodyA, bodyB) {
    const aHalfW = (bodyA._width || 32) / 2;
    const aHalfH = (bodyA._height || 32) / 2;
    const bHalfW = (bodyB._width || 32) / 2;
    const bHalfH = (bodyB._height || 16) / 2;
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
    if (!this.level.goal) return;
    for (const [_, actor] of this.actors) {
      if (actor.type === 'player' && !actor.state._goal_reached) {
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
      .filter(a => a.type === 'player' && a.state.lives > 0 && a.state.respawn_time <= 0);

    if (activePlayers.length === 0) {
      const deadPlayers = Array.from(this.actors.values())
        .filter(a => a.type === 'player');
      if (deadPlayers.length > 0 && !this.stage_over) {
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
        const spawnPos = [500 + (client.playerId - 1) * 50,656];
        this.spawn('player', spawnPos, { player_id: client.playerId });
      });
    }
  }

  broadcastGoalReached(playerId) {
    const msg = buildGoalMessage(playerId, this.stage);
    this.broadcastToClients(msg);

    if (this.stage === 4) {
      const player = Array.from(this.actors.values()).find(a => a.state.player_id === playerId);
      const totalScore = player ? player.state.score || 0 : 0;
      setTimeout(() => {
        const winMsg = buildGameWonMessage(totalScore);
        this.broadcastToClients(winMsg);
      }, 1000);
    } else {
      setTimeout(() => this.nextStage(), 3000);
    }
  }

  broadcastStateUpdate(version) {
    const actors = {};
    for (const [name, actor] of this.actors) {
      const delta = serializeActorDelta(actor, this.lastActorState.get(name));
      if (delta) {
        actors[name] = delta;
      }
    }
    for (const [name, actor] of this.actors) {
      this.lastActorState.set(name, serializeActorState(actor));
    }
    const data = { version, frame: this.frame, stage: this.stage, actors };
    if (this.frame % 10 === 0) {
      data.checksum = computeStateChecksum(this.actors);
    }
    const msg = [MSG_TYPES.UPDATE, data];
    this.broadcastToClients(msg);
  }

  serializeActor(actor) {
    return {
      name: actor.name,
      type: actor.type,
      net_id: actor.net_id,
      pos: [actor.body.position.x, actor.body.position.y],
      vel: [actor.body.velocity.x, actor.body.velocity.y],
      state: {
        width: actor.state.width,
        player_id: actor.state.player_id,
        lives: actor.state.lives,
        score: actor.state.score,
        deaths: actor.state.deaths,
        on_ground: actor.state.on_ground,
        hit_count: actor.state.hit_count
      }
    };
  }

  broadcastToClients(message) {
    let msg;
    try {
      if (Array.isArray(message)) {
        msg = msgpack.pack(message);
      } else if (typeof message === 'string') {
        msg = message;
      } else {
        msg = msgpack.pack(message);
      }
    } catch (e) {
      console.error('Msgpack encode error:', e.message);
      return;
    }

    const msgSize = typeof msg === 'string' ? msg.length : msg.length;
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

    this.clients.forEach((client) => {
      if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(msg);
        } catch (e) {
          console.error('Broadcast error:', e.message);
        }
      }
    });
  }

  nextStage() {
    if (this.stage < 4) {
      this.pausedPlayers.clear();
      this.paused = false;
      this.loadStage(this.stage + 1);
      this.clients.forEach((client) => {
        const spawnPos = [500 + (client.playerId - 1) * 50,656];
        this.spawn('player', spawnPos, { player_id: client.playerId });
      });

      const actors = Array.from(this.actors.values()).map(a => serializeActorFull(a));
      const msg = buildStageloadMessage(this.stage, this.level.name, this.level.goal, actors);
      this.clients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(msgpack.pack(msg));
        }
      });
    } else if (this.stage === 4) {
      console.error('[GAME] Stage 4 complete! All stages finished.');
      this.stage_over = true;
      this.stage_over_time = this.frame;
    }
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const game = new PhysicsGame();
let nextPlayerId = 1;
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

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  const spawnPos = [500 + (playerId - 1) * 50,656];
  game.spawn('player', spawnPos, { player_id: playerId });

  const client = { ws, playerId };
  game.clients.set(playerId, client);

  const actors = Array.from(game.actors.values()).map(a => serializeActorFull(a));
  const initMsg = buildInitMessage(playerId, game.stage, game.level.name, game.level.goal, game.frame, actors);
  ws.send(msgpack.pack(initMsg));

  ws.on('message', (msg) => {
    try {
      if (!msg) return;
      const data = JSON.parse(msg.toString());
      if (!data || typeof data !== 'object') return;

      const action = data.action;
      if (typeof action !== 'string') {
        if (!data.action && typeof data.direction === 'number' && typeof data.action !== 'undefined') {
          game.pendingInput.set(playerId, data);
        }
        return;
      }

      if (action === 'nextstage') {
        game.nextStage();
      } else if (action === 'pause') {
        game.pausedPlayers.add(playerId);
        if (game.pausedPlayers.size === game.clients.size) {
          game.paused = true;
          console.error(`[PAUSE] All ${game.clients.size} players paused`);
        }
      } else if (action === 'resume') {
        game.pausedPlayers.delete(playerId);
        if (game.pausedPlayers.size < game.clients.size) {
          game.paused = false;
          console.error(`[RESUME] Game resumed (${game.clients.size - game.pausedPlayers.size} playing)`);
        }
      } else if (action === 'move' || action === 'jump') {
        if (typeof data.direction !== 'number' && action === 'move') return;
        game.pendingInput.set(playerId, data);
      }
    } catch (e) {
      console.error('Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    for (const [name, actor] of game.actors) {
      if (actor && actor.state && actor.state.player_id === playerId) {
        actor.state.removed = true;
      }
    }
    game.clients.delete(playerId);
    game.heldInput.delete(playerId);
    game.pausedPlayers.delete(playerId);
    if (game.pausedPlayers.size < game.clients.size && game.paused) {
      game.paused = false;
      console.error(`[RESUME] Game resumed (player ${playerId} disconnected)`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

app.get('/api/stats', (req, res) => {
  const uptime = Math.round((Date.now() - stats.initTime) / 1000);
  res.json({
    uptime,
    messagesSent: stats.messagesSent,
    bytesPerSecond: stats.bytesPerSecond,
    messagesSentPerSecond: stats.messagesSentPerSecond,
    peakBytesPerSecond: stats.peakBytesPerSecond,
    avgBytesPerMessage: stats.messagesSent > 0 ? Math.round((stats.windowBytes) / stats.windowMessages) : 0,
    encoding: 'msgpack'
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    frame: game.frame,
    stage: game.stage,
    clients: game.clients.size,
    actors: game.actors.size,
    players: Array.from(game.playerActors.values()).map(a => ({
      id: a.state.player_id,
      pos: [a.body.position.x, a.body.position.y],
      vel: [a.body.velocity.x, a.body.velocity.y],
      on_ground: a.state.on_ground
    }))
  });
});

app.get('/api/actors', (req, res) => {
  res.json(Array.from(game.actors.values()).map(a => ({
    name: a.name,
    type: a.type,
    pos: [a.body.position.x, a.body.position.y],
    vel: [a.body.velocity.x, a.body.velocity.y],
    state: a.state
  })));
});

app.get('/api/actor/:name', (req, res) => {
  const actor = game.actors.get(req.params.name);
  if (!actor) return res.status(404).json({ error: 'Actor not found' });
  res.json({
    name: actor.name,
    type: actor.type,
    pos: [actor.body.position.x, actor.body.position.y],
    vel: [actor.body.velocity.x, actor.body.velocity.y],
    state: actor.state
  });
});

app.post('/api/stage/:num', (req, res) => {
  const num = parseInt(req.params.num);
  if (num < 1 || num > 4) return res.status(400).json({ error: 'Invalid stage' });
  game.nextStage = () => {
    if (game.stage < 4) game.loadStage(game.stage + 1);
  };
  if (num !== game.stage) game.loadStage(num);
  res.json({ stage: game.stage, name: game.level.name });
});

app.post('/api/spawn/:type', (req, res) => {
  const { x = 640, y = 360, ...extra } = req.body || {};
  if (req.params.type === 'player' && !extra.player_id) {
    extra.player_id = Math.max(...Array.from(game.playerActors.keys()), 0) + 1;
  }
  game.spawn(req.params.type, [x, y], extra);
  res.json({ ok: true });
});

app.get('/api/levels', (req, res) => {
  const levels = [1, 2, 3, 4].map(n => {
    const filePath = path.join(__dirname, '..', 'game', `levels/stage${n}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { stage: n, name: data.name, platforms: data.platforms.length, enemies: data.enemies.length };
  }).filter(Boolean);
  res.json(levels);
});

app.get('/api/level/:num', (req, res) => {
  const num = parseInt(req.params.num);
  const filePath = path.join(__dirname, '..', 'game', `levels/stage${num}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Level not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
});

app.get('/api/stats', (req, res) => {
  const players = Array.from(game.playerActors.values()).map(p => ({
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
    .filter(a => a.type.includes('platform'))
    .map(p => ({ name: p.name, hits: p.state.hit_count, max_hits: p.state.max_hits }));

  const enemies = Array.from(game.actors.values())
    .filter(a => a.type === 'enemy').length;

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
    snapshot: Array.from(game.actors.values()).map(a => ({
      name: a.name,
      type: a.type,
      pos: [a.body.position.x, a.body.position.y],
      vel: [a.body.velocity.x, a.body.velocity.y],
      state: {
        lives: a.state.lives,
        score: a.state.score,
        respawn_time: a.state.respawn_time,
        on_ground: a.state.on_ground,
        hit_count: a.state.hit_count
      }
    }))
  });
});

let tickCount = 0;
let frameTimes = [];
const MAX_FRAME_HISTORY = 60;

setInterval(() => {
  const tickStart = Date.now();
  try {
    game.tick();
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
    console.error('Game tick error:', e.message, e.stack);
  }
}, TICK_MS);

app.get('/api/perf', (req, res) => {
  const avgTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const maxTime = Math.max(...frameTimes);
  const minTime = Math.min(...frameTimes);
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

app.post('/api/stress/respawn-all', (req, res) => {
  let respawned = 0;
  for (const [id, actor] of game.playerActors) {
    actor.state.deaths++;
    actor.state.lives = Math.max(0, actor.state.lives - 1);
    actor.state.respawn_time = PHYSICS.RESPAWN_TIME;
    actor.state.invulnerable = PHYSICS.INVULNERABILITY_TIME;
    respawned++;
  }
  res.json({ respawned, frame: game.frame });
});

app.post('/api/stress/spawn-enemies/:count', (req, res) => {
  const count = Math.min(parseInt(req.params.count) || 1, 50);
  for (let i = 0; i < count; i++) {
    const x = 100 + Math.random() * 1080;
    const y = 100 + Math.random() * 500;
    game.spawn('enemy', [x, y], { speed: PHYSICS.ENEMY_SPEED });
  }
  res.json({ spawned: count, total_enemies: Array.from(game.actors.values()).filter(a => a.type === 'enemy').length });
});

app.post('/api/stress/break-platforms/:count', (req, res) => {
  const count = Math.min(parseInt(req.params.count) || 1, 50);
  const platforms = Array.from(game.actors.values()).filter(a => a.type === 'breakable_platform');
  let broken = 0;
  for (let i = 0; i < Math.min(count, platforms.length); i++) {
    const p = platforms[i];
    p.state.hit_count = p.state.max_hits;
    p.state.removed = true;
    broken++;
  }
  res.json({ broken, remaining: platforms.length - broken });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
