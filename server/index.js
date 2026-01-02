const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { Engine, World, Body, Events, Composite } = require('matter-js');

const PORT = process.env.PORT || 3008;
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

class PhysicsGame {
  constructor() {
    this.engine = Engine.create();
    this.engine.world.gravity.y = 1.5;
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

    World.add(this.engine.world, body);

    const actor = {
      name: body.label,
      type,
      net_id: this.nextNetId++,
      body,
      state: {
        player_id: extra.player_id,
        speed: extra.speed || (type === 'player' ? 200 : 100),
        patrol_dir: extra.patrol_dir || -1,
        on_ground: false,
        hit_count: 0,
        max_hits: extra.max_hits || 3,
        width: extra.width || 32,
        removed: false,
        _landed_this_frame: false,
        _pending_jump: false,
        _coyote_counter: 0,
        lives: type === 'player' ? 3 : 0,
        deaths: 0,
        respawn_time: 0,
        invulnerable: 0,
        score: 0,
        stage_time: 0,
        _last_vel_y: 0
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
    this.processPendingInput();
    this.updateRespawns();
    this.updateActors();

    for (const [name, actor] of this.actors) {
      if (!actor.body) continue;
      actor.body.position.x += actor.body.velocity.x * (TICK_MS / 1000);
      actor.body.position.y += actor.body.velocity.y * (TICK_MS / 1000);
    }

    this.checkCollisions();
    this.checkGoal();
    this.updateGameState();
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
          actor.body.velocity.y = -13;
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

  updateRespawns() {
    for (const [name, actor] of this.actors) {
      if (actor.type !== 'player') continue;

      if (actor.state.respawn_time > 0) {
        actor.state.respawn_time -= TICK_MS / 1000;
        if (this.frame % 30 === 0) {
          console.error(`[RESPAWN] Player ${actor.state.player_id}: respawn_time=${actor.state.respawn_time.toFixed(1)}s`);
        }

        if (actor.state.respawn_time <= 0) {
          const spawnPos = [500 + (actor.state.player_id - 1) * 50, 664];
          actor.body.position.x = spawnPos[0];
          actor.body.position.y = spawnPos[1];
          actor.body.velocity.x = 0;
          actor.body.velocity.y = 0;
          actor.state.respawn_time = 0;
          actor.state.on_ground = true;
          console.error(`[RESPAWN] Player ${actor.state.player_id} respawned at [${spawnPos[0]}, ${spawnPos[1]}]`);
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

        if (actor.body.position.x <= 0 || actor.body.position.x >= 1280) {
          actor.state.patrol_dir *= -1;
        }
      }

      if ((actor.type === 'player' || actor.type === 'enemy') && !actor.state.on_ground) {
        actor.body.velocity.y += 800 * (TICK_MS / 1000);
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
    for (const [nameA, actorA] of this.actors) {
      actorA.state._landed_this_frame = false;

      for (const [nameB, actorB] of this.actors) {
        if (nameA >= nameB) continue;

        const bodyA = actorA.body;
        const bodyB = actorB.body;

        const aabbHits = this.checkAABB(bodyA, bodyB);
        if (actorA.type === 'player' && actorB.type === 'platform' && aabbHits) {
          const vy = bodyA.velocity.y;
          const yCheck = bodyA.position.y + 16 < bodyB.position.y + 8;
          console.error(`[CHECK] Player vs ${actorB.name}: vy=${vy.toFixed(1)}, dy_check=${yCheck} (player_y+16=${(bodyA.position.y + 16).toFixed(1)} < platform_y+8=${(bodyB.position.y + 8).toFixed(1)})`);
        }

        if (aabbHits) {
          if (actorB.type === 'enemy' && actorA.type === 'player') {
            console.error(`[COLLISION] Player ${actorA.name} hit by enemy ${actorB.name} at distance dx=${Math.abs(bodyA.position.x - bodyB.position.x).toFixed(1)}, dy=${Math.abs(bodyA.position.y - bodyB.position.y).toFixed(1)}`);
            if (actorA.state.invulnerable <= 0) {
              actorA.state.deaths++;
              actorA.state.lives--;
              actorA.state.respawn_time = 5;
              actorA.state.invulnerable = 1.5;
              console.error(`[DEATH] Player ${actorA.state.player_id} died (lives left: ${actorA.state.lives})`);
            }
          }

          if ((actorA.type === 'player' || actorA.type === 'enemy') && (actorB.type === 'platform' || actorB.type === 'breakable_platform')) {
            if (bodyA.velocity.y > 0 && bodyA.position.y + 16 < bodyB.position.y + 8) {
              if (actorA.type === 'player') {
                console.error(`[LAND] Player landed on ${actorB.name} at Y ${bodyA.position.y.toFixed(1)}`);
              }
              bodyA.velocity.y = 0;
              bodyA.position.y = bodyB.position.y - 24;
              actorA.state.on_ground = true;
              actorA.state._landed_this_frame = true;
              actorA.state._coyote_counter = 0;

              if (actorB.type === 'breakable_platform' && !actorB.state._broken_by) {
                actorB.state._broken_by = nameA;
                actorB.state.hit_count++;
                if (actorA.type === 'player') {
                  actorA.state.score += 10;
                  console.error(`[SCORE] Player ${actorA.state.player_id} scored +10 (total: ${actorA.state.score}) for landing on breakable platform`);
                }
                if (actorB.state.hit_count >= actorB.state.max_hits) {
                  actorB.state.removed = true;
                  console.error(`[BREAK] Platform ${actorB.name} broke (hit_count: ${actorB.state.hit_count}/${actorB.state.max_hits})`);
                }
              }
            }
          }
        }
      }

      if (!actorA.state._landed_this_frame && (actorA.type === 'player' || actorA.type === 'enemy')) {
        actorA.state.on_ground = false;
      }
    }
  }

  checkAABB(bodyA, bodyB) {
    const aMin = Math.sqrt(2) * bodyA.circleRadius || 16;
    const bMin = Math.sqrt(2) * bodyB.circleRadius || 16;
    const dx = Math.abs(bodyA.position.x - bodyB.position.x);
    const dy = Math.abs(bodyA.position.y - bodyB.position.y);
    return dx < aMin + bMin && dy < aMin + bMin;
  }

  checkGoal() {
    if (!this.level.goal) return;
    for (const [_, actor] of this.actors) {
      if (actor.type === 'player') {
        const dist = Math.hypot(actor.body.position.x - this.level.goal.x, actor.body.position.y - this.level.goal.y);
        if (dist < 40) {
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
        }
        World.remove(this.engine.world, actor.body);
        this.actors.delete(name);
        this.bodies.delete(name);
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
        const spawnPos = [500 + (client.playerId - 1) * 50, 664];
        this.spawn('player', spawnPos, { player_id: client.playerId });
      });
    }
  }

  broadcastGoalReached(playerId) {
    this.broadcastToClients({ type: 'goal', playerId, stage: this.stage });
  }

  broadcastStateUpdate(version) {
    const update = { type: 'update', version, frame: this.frame, stage: this.stage, actors: {} };
    for (const [name, actor] of this.actors) {
      update.actors[name] = {
        pos: [actor.body.position.x, actor.body.position.y],
        vel: [actor.body.velocity.x, actor.body.velocity.y],
        state: {
          on_ground: actor.state.on_ground,
          width: actor.state.width,
          player_id: actor.state.player_id,
          lives: actor.state.lives,
          score: actor.state.score,
          deaths: actor.state.deaths,
          respawn_time: actor.state.respawn_time,
          invulnerable: actor.state.invulnerable,
          hit_count: actor.state.hit_count,
          stage_time: Math.round(actor.state.stage_time * 10) / 10
        }
      };
    }
    this.broadcastToClients(update);
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
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
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
      this.loadStage(this.stage + 1);
      this.clients.forEach((client) => {
        const spawnPos = [500 + (client.playerId - 1) * 50, 664];
        this.spawn('player', spawnPos, { player_id: client.playerId });
      });

      const msg = JSON.stringify({
        type: 'stageload',
        stage: this.stage,
        levelName: this.level.name,
        goal: this.level.goal,
        actors: Array.from(this.actors.values()).map(a => this.serializeActor(a))
      });
      this.clients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(msg);
        }
      });
    }
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const game = new PhysicsGame();
let nextPlayerId = 1;
let updateVersion = 0;

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  const spawnPos = [500 + (playerId - 1) * 50, 664];
  game.spawn('player', spawnPos, { player_id: playerId });

  const client = { ws, playerId };
  game.clients.set(playerId, client);

  const initMsg = JSON.stringify({
    type: 'init',
    playerId,
    stage: game.stage,
    levelName: game.level.name,
    goal: game.level.goal,
    frame: game.frame,
    actors: Array.from(game.actors.values()).map(a => game.serializeActor(a))
  });
  ws.send(initMsg);

  ws.on('message', (msg) => {
    try {
      if (!msg) return;
      const data = JSON.parse(msg.toString());
      if (!data || typeof data !== 'object') return;
      if (data.action === 'nextstage') {
        game.nextStage();
      } else {
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
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
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
setInterval(() => {
  try {
    game.tick();
    updateVersion++;
    game.broadcastStateUpdate(updateVersion);
    tickCount++;
    if (tickCount % 60 === 0) {
      console.error(`[TICK] Frame ${game.frame}, Clients: ${game.clients.size}, HeldInput: ${game.heldInput.size}`);
    }
  } catch (e) {
    console.error('Game tick error:', e.message, e.stack);
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
