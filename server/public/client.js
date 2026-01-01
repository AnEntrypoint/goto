const canvas = document.getElementById('canvas');
if (!canvas) throw new Error('Canvas element not found');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2D context not available');
const info = document.getElementById('info');
if (!info) throw new Error('Info element not found');

class GameClient {
  constructor() {
    this.ws = null;
    this.playerId = 0;
    this.actors = new Map();
    this.frame = 0;
    this.stage = 1;
    this.levelName = '';
    this.keysHeld = { left: false, right: false };
    this.cameraX = 0;
    this.cameraY = 0;
    this.goalReached = false;
    this.goalTime = 0;
    this.goal = null;

    this.connect();
    this.setupInput();
    this.gameLoop();
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    const connectTimeout = setTimeout(() => {
      console.error('Connection timeout');
      info.textContent = 'Connection timeout';
    }, 10000);

    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => clearTimeout(connectTimeout));

    this.ws.onopen = () => {
      info.textContent = 'Connected!';
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      info.textContent = 'Disconnected';
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
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
              if (Array.isArray(msg.actors[name].pos)) actor.pos = [...msg.actors[name].pos];
              if (msg.actors[name].state && typeof msg.actors[name].state === 'object') {
                actor.state = { ...msg.actors[name].state };
              }
            }
          }
        }
        this.updateCamera();
        break;
      case 'goal':
        if (msg.playerId === this.playerId) {
          this.goalReached = true;
          this.goalTime = this.frame;
        }
        break;
      case 'stageload':
        this.stage = msg.stage;
        this.levelName = msg.levelName;
        this.goal = msg.goal;
        this.actors.clear();
        this.goalReached = false;
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
      state: data.state ? { ...data.state } : {}
    });
  }

  updateCamera() {
    const player = Array.from(this.actors.values()).find(a => a && a.state && a.state.player_id === this.playerId);
    if (player && Array.isArray(player.pos) && isFinite(player.pos[0]) && isFinite(player.pos[1])) {
      const targetX = player.pos[0] - canvas.width / 2;
      const targetY = Math.max(0, player.pos[1] - canvas.height / 3);
      if (Math.abs(targetX - this.cameraX) > 200 || Math.abs(targetY - this.cameraY) > 200) {
        this.cameraX = targetX;
        this.cameraY = targetY;
      } else {
        this.cameraX += (targetX - this.cameraX) * 0.1;
        this.cameraY += (targetY - this.cameraY) * 0.1;
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
  }

  updateMovement() {
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

    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);

    const actors = Array.from(this.actors.values()).sort((a, b) => {
      const order = { platform: 1, breakable_platform: 2, enemy: 3, player: 4 };
      return (order[a.type] || 0) - (order[b.type] || 0);
    });

    for (const actor of actors) {
      this.renderActor(actor);
    }

    if (!this.goalReached && this.goal) {
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(this.goal.x, this.goal.y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();

    this.renderUI();
  }

  renderActor(actor) {
    const [x, y] = actor.pos;

    ctx.fillStyle = {
      player: '#FFFFFF',
      enemy: '#FF4444',
      platform: '#8B7355',
      breakable_platform: '#CD853F'
    }[actor.type] || '#CCCCCC';

    let w, h;
    if (actor.type === 'platform' || actor.type === 'breakable_platform') {
      w = actor.state.width || 32;
      h = 16;
    } else {
      w = 32;
      h = 32;
    }

    ctx.fillRect(x - w / 2, y - h / 2, w, h);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);

    if (actor.type === 'player') {
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`P${actor.state.player_id || '?'}`, x, y);
    } else if (actor.type === 'enemy') {
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('❄', x, y - 2);
    }

    if (actor.state.on_ground && actor.type === 'player') {
      ctx.strokeStyle = '#00DD00';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4);
    }
  }

  renderUI() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 380, 80);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Stage ${this.stage}: ${this.levelName}`, 10, 10);
    ctx.fillText(`Player ${this.playerId}`, 10, 30);
    ctx.fillText(`Frame: ${this.frame}`, 10, 50);

    if (this.goalReached) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
      ctx.fillRect(canvas.width / 2 - 150, canvas.height / 2 - 50, 300, 100);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STAGE CLEAR!', canvas.width / 2, canvas.height / 2 - 10);

      if (this.stage < 4) {
        ctx.font = '14px Arial';
        ctx.fillText('Next stage in 3 seconds...', canvas.width / 2, canvas.height / 2 + 25);
        if (this.frame - this.goalTime === 180) {
          this.sendInput('nextstage');
        }
      } else {
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = '#FFD700';
        ctx.fillText('GAME COMPLETE!', canvas.width / 2, canvas.height / 2 + 30);
      }
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
