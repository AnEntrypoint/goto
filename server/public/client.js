const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Canvas element not found');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D context not available');
const info = document.getElementById('info');
if (!info) throw new Error('Info element not found');

const particles = new ParticleSystem();
const sprites = new SpriteRenderer();
const sound = new SoundManager();

const MSG_TYPES = {
  INIT: 0,
  UPDATE: 1,
  GOAL: 2,
  STAGELOAD: 3,
  SPAWN: 4,
  REMOVE: 5,
  PAUSE: 6,
  RESUME: 7
};

let unpackr = null;
if (typeof Unpackr !== 'undefined') {
  unpackr = new Unpackr({ useRecords: false });
}

class FloatingNumber {
  constructor(value, x, y) {
    this.value = value;
    this.x = x;
    this.y = y;
    this.life = 1.5;
    this.alpha = 1.0;
  }

  update(dt) {
    this.life -= dt;
    this.alpha = Math.max(0, this.life / 1.5);
    this.y -= 50 * dt;
  }

  render(ctx) {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#FFFF00';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${this.value}`, this.x, this.y);
    ctx.restore();
  }

  isAlive() {
    return this.life > 0;
  }
}

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeIntensity = 0;
    this.zoom = 1;
    this.targetZoom = 1;
  }

  shake(intensity) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  update(targetX, targetY) {
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    this.x += (targetX - this.x) * easeOut(0.1);
    this.y += (targetY - this.y) * easeOut(0.1);
    this.zoom += (this.targetZoom - this.zoom) * 0.1;

    if (this.shakeIntensity > 0) {
      this.shakeX = (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeY = (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeIntensity *= 0.9;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  apply(ctx) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-(this.x + this.shakeX), -(this.y + this.shakeY));
  }
}

class GameClient {
  constructor() {
    this.ws = null;
    this.playerId = 0;
    this.actors = new Map();
    this.frame = 0;
    this.stage = 1;
    this.levelName = '';
    this.keysHeld = { left: false, right: false };
    this.camera = new Camera();
    this.goalReached = false;
    this.goalTime = 0;
    this.goal = null;
    this.lastActorState = new Map();
    this.debugMode = false;
    this.paused = false;
    this.screenFlash = 0;
    this.screenFlashColor = [0, 0, 0];
    this.floatingNumbers = [];

    this.connect();
    this.setupInput();
    this.gameLoop();
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    const connectTimeout = setTimeout(() => {
      console.error('Connection timeout');
      info.textContent = 'Connection timeout - retrying...';
      this.attemptReconnect();
    }, 10000);

    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => clearTimeout(connectTimeout));

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      info.textContent = 'Connected!';
    };

    this.ws.onmessage = (evt) => {
      try {
        let msg;
        if (evt.data instanceof ArrayBuffer) {
          if (!unpackr) throw new Error('msgpackr not loaded');
          const arr = unpackr.unpack(new Uint8Array(evt.data));
          msg = { type: arr[0], data: arr[1] };
        } else if (typeof evt.data === 'string') {
          msg = JSON.parse(evt.data);
        } else {
          const arr = unpackr.unpack(evt.data);
          msg = { type: arr[0], data: arr[1] };
        }
        this.handleMessageBinary(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      info.textContent = 'Disconnected - reconnecting...';
      this.attemptReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      this.attemptReconnect();
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      info.textContent = 'Connection lost. Please reload the page.';
      return;
    }
    this.reconnectAttempts++;
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.error(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delayMs}ms`);
    setTimeout(() => this.connect(), delayMs);
  }

  handleMessageBinary(msg) {
    if (typeof msg.type === 'number') {
      switch (msg.type) {
        case MSG_TYPES.INIT:
          return this.handleInit(msg.data);
        case MSG_TYPES.UPDATE:
          return this.handleUpdate(msg.data);
        case MSG_TYPES.GOAL:
          return this.handleGoal(msg.data);
        case MSG_TYPES.STAGELOAD:
          return this.handleStageload(msg.data);
        case MSG_TYPES.SPAWN:
          return this.handleSpawn(msg.data);
        case MSG_TYPES.REMOVE:
          return this.handleRemove(msg.data);
      }
    } else if (typeof msg.type === 'string') {
      return this.handleMessage(msg);
    }
  }

  handleInit(data) {
    this.playerId = data.playerId;
    this.stage = data.stage;
    this.levelName = data.levelName;
    this.frame = data.frame;
    this.goal = data.goal;
    this.goalReached = false;
    this.actors.clear();
    for (const actor of data.actors) {
      this.spawnActor(actor);
    }
    this.updateCamera();
  }

  handleUpdate(data) {
    if (data && typeof data.frame === 'number') this.frame = data.frame;
    if (data && typeof data.stage === 'number') this.stage = data.stage;
    if (data && data.actors && typeof data.actors === 'object') {
      for (const name in data.actors) {
        if (this.actors.has(name)) {
          const actor = this.actors.get(name);
          const delta = data.actors[name];
          const lastState = this.lastActorState.get(name) || {};

          if (delta.x !== undefined) actor.pos[0] = delta.x;
          if (delta.y !== undefined) actor.pos[1] = delta.y;
          if (delta.vx !== undefined) actor.vel[0] = delta.vx;
          if (delta.vy !== undefined) actor.vel[1] = delta.vy;

          const newState = {};
          if (delta.w !== undefined) newState.width = delta.w;
          if (delta.p !== undefined) newState.player_id = delta.p;
          if (delta.l !== undefined) newState.lives = delta.l;
          if (delta.s !== undefined) newState.score = delta.s;
          if (delta.d !== undefined) newState.deaths = delta.d;
          if (delta.rt !== undefined) newState.respawn_time = delta.rt;
          if (delta.iv !== undefined) newState.invulnerable = delta.iv;
          if (delta.og !== undefined) newState.on_ground = delta.og;
          if (delta.hc !== undefined) newState.hit_count = delta.hc;

          Object.assign(actor.state, newState);
          this.detectStateChanges(actor, lastState, newState);
          this.lastActorState.set(name, Object.assign({}, lastState, newState));
        }
      }
    }
    this.updateCamera();
  }

  handleGoal(data) {
    if (data.playerId === this.playerId) {
      this.goalReached = true;
      this.goalTime = this.frame;
      if (this.goal) {
        particles.emit('confetti', this.goal.x, this.goal.y);
        particles.emit('confetti', this.goal.x, this.goal.y);
      }
      sound.playGoal();
      this.camera.targetZoom = 1.2;
    }
  }

  handleStageload(data) {
    this.stage = data.stage;
    this.levelName = data.levelName;
    this.goal = data.goal;
    this.actors.clear();
    this.lastActorState.clear();
    this.floatingNumbers = [];
    this.goalReached = false;
    this.paused = false;
    for (const actor of data.actors) {
      this.spawnActor(actor);
    }
  }

  handleSpawn(data) {
    this.spawnActor(data.actor);
  }

  handleRemove(data) {
    this.actors.delete(data.name);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        this.playerId = msg.playerId;
        this.stage = msg.stage;
        this.levelName = msg.levelName;
        this.frame = msg.frame;
        this.goal = msg.goal;
        this.goalReached = false;
        this.actors.clear();
        for (const actor of msg.actors) {
          this.spawnActor(actor);
        }
        this.updateCamera();
        break;
      case 'spawn':
        this.spawnActor(msg.actor);
        break;
      case 'remove':
        this.actors.delete(msg.name);
        break;
      case 'update':
        if (msg && typeof msg.frame === 'number') this.frame = msg.frame;
        if (msg && typeof msg.stage === 'number') this.stage = msg.stage;
        if (msg && msg.actors && typeof msg.actors === 'object') {
          for (const name in msg.actors) {
            if (this.actors.has(name)) {
              const actor = this.actors.get(name);
              const lastState = this.lastActorState.get(name) || {};
              const newState = msg.actors[name].state || {};

              if (Array.isArray(msg.actors[name].pos)) actor.pos = [...msg.actors[name].pos];
              if (Array.isArray(msg.actors[name].vel)) actor.vel = [...msg.actors[name].vel];
              if (msg.actors[name].state && typeof msg.actors[name].state === 'object') {
                actor.state = { ...msg.actors[name].state };
              }

              this.detectStateChanges(actor, lastState, newState);
              this.lastActorState.set(name, { ...newState });
            }
          }
        }
        this.updateCamera();
        break;
      case 'goal':
        if (msg.playerId === this.playerId) {
          this.goalReached = true;
          this.goalTime = this.frame;
          if (this.goal) {
            particles.emit('confetti', this.goal.x, this.goal.y);
            particles.emit('confetti', this.goal.x, this.goal.y);
          }
          sound.playGoal();
          this.camera.targetZoom = 1.2;
        }
        break;
      case 'stageload':
        this.stage = msg.stage;
        this.levelName = msg.levelName;
        this.goal = msg.goal;
        this.actors.clear();
        this.lastActorState.clear();
        this.floatingNumbers = [];
        this.goalReached = false;
        this.paused = false;
        for (const actor of msg.actors) {
          this.spawnActor(actor);
        }
        break;
    }
  }

  spawnActor(data) {
    if (!data || !data.name || !data.type || !Array.isArray(data.pos)) return;
    this.actors.set(data.name, {
      name: data.name,
      type: data.type,
      pos: [...data.pos],
      vel: Array.isArray(data.vel) ? [...data.vel] : [0, 0],
      state: data.state ? { ...data.state } : {}
    });
  }

  updateCamera() {
    const player = Array.from(this.actors.values()).find(a => a && a.state && a.state.player_id === this.playerId);
    if (player && Array.isArray(player.pos) && isFinite(player.pos[0]) && isFinite(player.pos[1])) {
      const targetX = player.pos[0];
      const targetY = Math.max(0, player.pos[1]);
      this.camera.update(targetX, targetY);
    }
  }

  detectStateChanges(actor, lastState, newState) {
    if (actor.type === 'player') {
      const wasGrounded = lastState.on_ground;
      const isGrounded = newState.on_ground;
      const wasAirborne = !wasGrounded;
      const isAirborne = !isGrounded;

      if (wasAirborne && isGrounded) {
        particles.emit('land', actor.pos[0], actor.pos[1]);
        this.camera.shake(5);
        sound.playLand();
      } else if (wasGrounded && isAirborne && Math.abs(newState.vel_y) > 5) {
        particles.emit('jump', actor.pos[0], actor.pos[1]);
        sound.playJump();
      }

      const lastScore = lastState.score || 0;
      const newScore = newState.score || 0;
      if (newScore > lastScore) {
        const scoreDiff = newScore - lastScore;
        this.floatingNumbers.push(new FloatingNumber(scoreDiff, actor.pos[0], actor.pos[1]));
      }

      const lastLives = lastState.lives || 3;
      const newLives = newState.lives || 3;
      if (newLives < lastLives) {
        this.screenFlash = 0.8;
        this.screenFlashColor = [255, 0, 0];
      }
    } else if (actor.type === 'breakable_platform') {
      const lastHits = lastState.hit_count || 0;
      const newHits = newState.hit_count || 0;
      if (newHits > lastHits) {
        particles.emit('break', actor.pos[0], actor.pos[1]);
        sound.playBreak();
        this.camera.shake(3);
      }
    }
  }

  setupInput() {
    const keyMap = {
      'a': 'left', 'A': 'left',
      'd': 'right', 'D': 'right',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      ' ': 'jump', 'w': 'jump', 'W': 'jump', 'ArrowUp': 'jump'
    };

    document.addEventListener('keydown', (e) => {
      const action = keyMap[e.key];
      if (!action) return;

      if (action === 'jump') {
        this.sendInput('jump');
      } else {
        this.keysHeld[action] = true;
        this.updateMovement();
      }
    });

    document.addEventListener('keyup', (e) => {
      const action = keyMap[e.key];
      if (!action) return;

      if (action !== 'jump') {
        this.keysHeld[action] = false;
        this.updateMovement();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        this.debugMode = !this.debugMode;
      }
      if (e.key === 'm' || e.key === 'M') {
        sound.sfxEnabled = !sound.sfxEnabled;
        info.textContent = `SFX: ${sound.sfxEnabled ? 'ON' : 'OFF'}`;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.paused = !this.paused;
        if (this.paused) {
          this.keysHeld.left = false;
          this.keysHeld.right = false;
          this.sendInput('pause');
        } else {
          this.sendInput('resume');
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        if (this.goalReached) {
          this.sendInput('nextstage');
        }
      }
    });
  }

  updateMovement() {
    if (this.paused) return;
    let direction = 0;
    if (this.keysHeld.right) direction = 1;
    if (this.keysHeld.left) direction = -1;
    this.sendInput('move', direction);
  }

  sendInput(action, direction = 0.0) {
    if (!action || typeof action !== 'string') return;
    if (typeof direction !== 'number' || !isFinite(direction)) direction = 0;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ action, direction }));
      } catch (e) {
        console.error('Send error:', e.message);
      }
    }
  }

  render() {
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.paused) {
      ctx.save();
      this.camera.apply(ctx);

      const actors = Array.from(this.actors.values()).sort((a, b) => {
        const order = { platform: 1, breakable_platform: 2, enemy: 3, player: 4 };
        return (order[a.type] || 0) - (order[b.type] || 0);
      });

      for (const actor of actors) {
        this.renderActor(actor);
      }

      if (!this.goalReached && this.goal) {
        const pulse = Math.sin(this.frame * 0.05) * 0.3 + 0.7;
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(this.goal.x, this.goal.y, 15 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      particles.update(1 / 60);
      particles.render(ctx);

      for (let i = this.floatingNumbers.length - 1; i >= 0; i--) {
        const fn = this.floatingNumbers[i];
        fn.update(1 / 60);
        fn.render(ctx);
        if (!fn.isAlive()) {
          this.floatingNumbers.splice(i, 1);
        }
      }

      ctx.restore();
    }

    this.screenFlash *= 0.95;
    if (this.screenFlash > 0.01) {
      ctx.fillStyle = `rgba(${this.screenFlashColor[0]}, ${this.screenFlashColor[1]}, ${this.screenFlashColor[2]}, ${this.screenFlash})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    this.renderUI();
  }

  renderActor(actor) {
    let [x, y] = actor.pos;
    const vel = actor.vel || [0, 0];

    if (actor.type === 'player' || actor.type === 'enemy') {
      x += vel[0] * (1 / 60);
      y += vel[1] * (1 / 60);
    }

    const w = actor.state.width || 32;
    const h = (actor.type === 'platform' || actor.type === 'breakable_platform') ? 16 : 32;

    ctx.save();

    if (actor.type === 'player' && (actor.state.invulnerable || 0) > 0) {
      const blink = Math.floor((actor.state.invulnerable || 0) * 20) % 2;
      if (blink === 0) {
        ctx.globalAlpha = 0.5;
      }
    }

    switch (actor.type) {
      case 'player':
        sprites.drawPlayer(ctx, x, y, actor.state, this.frame);
        break;
      case 'enemy':
        sprites.drawEnemy(ctx, x, y, this.frame);
        break;
      case 'platform':
      case 'breakable_platform':
        const isDamaged = actor.type === 'breakable_platform' ? (actor.state.hit_count || 0) : 0;
        sprites.drawPlatform(ctx, x, y, w, h, isDamaged);
        break;
    }

    ctx.restore();
  }

  getLocalPlayer() {
    return Array.from(this.actors.values()).find(a => a.state && a.state.player_id === this.playerId && a.type === 'player');
  }

  renderUI() {
    const player = this.getLocalPlayer();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 500, 100);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Stage ${this.stage}: ${this.levelName}`, 10, 10);
    ctx.fillText(`Player ${this.playerId} | Score: ${player?.state.score || 0}`, 10, 30);
    const livesDisplay = player ? '❤'.repeat(Math.max(0, player.state.lives)) : '❤❤❤';
    ctx.fillText(`Lives: ${livesDisplay} | Time: ${(player?.state.stage_time || 0).toFixed(1)}s`, 10, 50);
    ctx.fillText(`Frame: ${this.frame}`, 10, 70);

    if (player && player.state.respawn_time > 0 && !this.goalReached) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#FF6666';
      ctx.font = 'bold 36px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ELIMINATED', canvas.width / 2, canvas.height / 2 - 40);

      const countdown = Math.ceil(player.state.respawn_time);
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(countdown, canvas.width / 2, canvas.height / 2 + 40);
    }

    if (player && player.state.lives <= 0 && !this.goalReached) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#FF0000';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 60);

      ctx.font = '24px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(`Final Score: ${player.state.score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.fillText('Reloading...', canvas.width / 2, canvas.height / 2 + 60);
    }

    if (this.goalReached) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.fillRect(canvas.width / 2 - 200, canvas.height / 2 - 80, 400, 160);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STAGE CLEAR!', canvas.width / 2, canvas.height / 2 - 30);

      ctx.font = '20px Arial';
      ctx.fillText(`Score: ${player?.state.score || 0}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.fillText(`Time: ${(player?.state.stage_time || 0).toFixed(1)}s`, canvas.width / 2, canvas.height / 2 + 50);

      if (this.stage < 4) {
        ctx.font = '14px Arial';
        ctx.fillText('Next stage in 3 seconds... (Press R to skip)', canvas.width / 2, canvas.height / 2 + 90);
        if (this.frame - this.goalTime === 180) {
          this.sendInput('nextstage');
        }
      } else {
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.fillText('GAME COMPLETE!', canvas.width / 2, canvas.height / 2 + 90);
      }
    }

    if (this.paused && !this.goalReached && (!player || player.state.lives > 0)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2 - 60);

      ctx.font = '20px Arial';
      ctx.fillText('ESC: Resume | M: Mute | F3: Debug', canvas.width / 2, canvas.height / 2 + 40);
    }

    if (this.debugMode) {
      this.renderDebugPanel();
    }
  }

  renderDebugPanel() {
    const player = this.getLocalPlayer();
    const logs = [];

    logs.push('[PLAYER STATE]');
    if (player) {
      logs.push(`pos: [${player.pos[0].toFixed(1)}, ${player.pos[1].toFixed(1)}]`);
      logs.push(`vel: [${(player.vel?.[0] || 0).toFixed(1)}, ${(player.vel?.[1] || 0).toFixed(1)}]`);
      logs.push(`on_ground: ${player.state.on_ground}`);
      logs.push(`lives: ${player.state.lives} | deaths: ${player.state.deaths}`);
      logs.push(`score: ${player.state.score} | time: ${(player.state.stage_time || 0).toFixed(1)}s`);
      logs.push(`respawn: ${(player.state.respawn_time || 0).toFixed(1)}s`);
      logs.push(`invuln: ${(player.state.invulnerable || 0).toFixed(2)}s`);
    }

    logs.push('[GAME STATE]');
    logs.push(`frame: ${this.frame} | stage: ${this.stage}`);
    logs.push(`actors: ${this.actors.size} total`);

    const enemies = Array.from(this.actors.values()).filter(a => a.type === 'enemy').length;
    const platforms = Array.from(this.actors.values()).filter(a => a.type.includes('platform')).length;
    logs.push(`enemies: ${enemies} | platforms: ${platforms}`);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(canvas.width - 400, 0, 400, logs.length * 18 + 20);

    ctx.fillStyle = '#00FF00';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < logs.length; i++) {
      ctx.fillText(logs[i], canvas.width - 390, 10 + i * 18);
    }
  }

  gameLoop() {
    this.render();
    requestAnimationFrame(() => this.gameLoop());
  }
}

window.addEventListener('load', () => {
  new GameClient();
});
