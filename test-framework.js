const WebSocket = require('ws');

class GameClient {
  constructor(port = 3006, host = 'localhost') {
    this.port = port;
    this.host = host;
    this.ws = null;
    this.playerId = 0;
    this.actors = new Map();
    this.stage = 1;
    this.stagesCompleted = [];
    this.frame = 0;
    this.messageHandlers = {};
    this.onReady = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          this.handleMessage(msg);
          if (this.messageHandlers[msg.type]) {
            this.messageHandlers[msg.type](msg);
          }
        } catch (e) {
          console.error('Message error:', e.message);
        }
      });

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('error', (e) => {
        reject(new Error(`Connection error: ${e.message}`));
      });

      this.ws.on('close', () => {
        console.log('Disconnected');
      });
    });
  }

  handleMessage(msg) {
    if (msg.type === 'init') {
      this.playerId = msg.playerId;
      this.stage = msg.stage;
      this.frame = msg.frame;
      msg.actors.forEach(a => {
        this.actors.set(a.name, { type: a.type, pos: [...a.pos], state: {...a.state} });
      });
      if (this.onReady) this.onReady();
    }

    if (msg.type === 'update') {
      this.frame = msg.frame;
      this.stage = msg.stage;
      for (const name in msg.actors) {
        if (this.actors.has(name)) {
          const a = this.actors.get(name);
          a.pos = msg.actors[name].pos;
          a.state = msg.actors[name].state;
        }
      }
    }

    if (msg.type === 'goal') {
      this.stagesCompleted.push(msg.stage);
    }

    if (msg.type === 'stageload') {
      this.stage = msg.stage;
      this.actors.clear();
      msg.actors.forEach(a => {
        this.actors.set(a.name, { type: a.type, pos: [...a.pos], state: {...a.state} });
      });
    }
  }

  getPlayer() {
    return [...this.actors.values()].find(a => a && a.state && a.state.player_id === this.playerId);
  }

  getEnemy(index = 0) {
    const enemies = [...this.actors.values()].filter(a => a && a.type === 'enemy');
    return enemies[index] || null;
  }

  send(action, direction = 0) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, direction }));
    }
  }

  nextStage() {
    this.send('nextstage');
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

class GameTest {
  constructor(testName, port = 3006) {
    this.testName = testName;
    this.client = new GameClient(port);
    this.results = [];
    this.timeout = 180000;
    this.timeoutHandle = null;
  }

  async run() {
    try {
      console.log(`\n[${this.testName}] Starting...\n`);
      await this.client.connect();
      this.scheduleTimeout();
      await this.execute();
      this.pass(`Test completed`);
    } catch (e) {
      this.fail(e.message);
    } finally {
      this.client.close();
      this.printResults();
      process.exit(this.results.some(r => r.status === 'FAIL') ? 1 : 0);
    }
  }

  scheduleTimeout() {
    this.timeoutHandle = setTimeout(() => {
      this.fail('Test timeout');
      this.client.close();
      this.printResults();
      process.exit(1);
    }, this.timeout);
  }

  clearTimeout() {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }
  }

  pass(msg) {
    this.results.push({ status: 'PASS', msg });
    console.log(`[✓] ${msg}`);
  }

  fail(msg) {
    this.results.push({ status: 'FAIL', msg });
    console.log(`[✗] ${msg}`);
  }

  log(msg) {
    console.log(`[*] ${msg}`);
  }

  printResults() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    console.log(`\n[${this.testName}] Results: ${passed} passed, ${failed} failed\n`);
  }

  async testClimbing(duration = 50000) {
    return new Promise((resolve) => {
      let dirPhase = 0;
      const climber = setInterval(() => {
        const p = this.client.getPlayer();
        if (!p) {
          clearInterval(climber);
          resolve();
          return;
        }

        let dir = (Math.floor(dirPhase / 5) % 2) === 0 ? 1 : -1;
        this.client.send('move', dir);
        if (p.state.on_ground) {
          this.client.send('jump');
        }
        dirPhase++;
      }, 150);

      setTimeout(() => {
        clearInterval(climber);
        resolve();
      }, duration);
    });
  }

  async testMovement(direction, duration = 3000) {
    return new Promise((resolve) => {
      this.client.send('move', direction);
      setTimeout(() => {
        this.client.send('move', 0);
        resolve();
      }, duration);
    });
  }

  async testFalling(maxDuration = 20000) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const p = this.client.getPlayer();
        if (p && !p.state.on_ground && p.pos[1] > 600) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, maxDuration);
    });
  }

  async testEnemyCollision(maxDuration = 30000) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const p = this.client.getPlayer();
        const e = this.client.getEnemy();

        if (p && e) {
          const dist = Math.hypot(p.pos[0] - e.pos[0], p.pos[1] - e.pos[1]);
          if (p.state.removed || dist < 20) {
            clearInterval(checkInterval);
            resolve(p.state.removed);
          }
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, maxDuration);
    });
  }

  async testStageProgression() {
    return new Promise((resolve) => {
      const stageCheckInterval = setInterval(() => {
        if (this.client.stagesCompleted.length > 0) {
          clearInterval(stageCheckInterval);
          this.client.nextStage();
          resolve(true);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(stageCheckInterval);
        resolve(false);
      }, 60000);
    });
  }

  async waitForStages(count) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.client.stagesCompleted.length >= count) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 180000);
    });
  }

  async waitForMessage(type, timeout = 10000) {
    return new Promise((resolve) => {
      const handler = (msg) => {
        delete this.client.messageHandlers[type];
        resolve(msg);
      };
      this.client.messageHandlers[type] = handler;
      setTimeout(() => {
        delete this.client.messageHandlers[type];
        resolve(null);
      }, timeout);
    });
  }
}

module.exports = { GameClient, GameTest };
