// Add event tracking to observability
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let lines = fs.readFileSync(serverPath, 'utf-8').split('\n');

console.log(`Processing ${lines.length} lines`);

// 1. Add connectedAt timestamp in ws.on('connection')
let connectionIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("ws.on('connection', (ws, req) => {")) {
    connectionIdx = i;
    break;
  }
}

if (connectionIdx > 0) {
  for (let i = connectionIdx; i < Math.min(connectionIdx + 50, lines.length); i++) {
    if (lines[i].includes('const client = {')) {
      // Find the next line with "ws:" and add connectedAt before it
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes('ws:')) {
          lines.splice(j, 0, '    connectedAt: Date.now(),');
          console.log('✓ Added connectedAt timestamp');
          break;
        }
      }
      break;
    }
  }
}

// 2. Add disconnect tracking
let closeIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("ws.on('close', () => {")) {
    closeIdx = i;
    break;
  }
}

if (closeIdx > 0) {
  const nextIdx = closeIdx + 1;
  const trackDisconnect = [
    "      if (client && typeof client.playerId === 'number') {",
    "        const durationSeconds = Math.floor((Date.now() - (client.connectedAt || Date.now())) / 1000);",
    "        const finalScore = client.actor ? (client.actor.state.score || 0) : 0;",
    "        game.playerDisconnects.recordDisconnect(client.playerId, 'close', durationSeconds, finalScore);",
    "      }"
  ];
  lines.splice(nextIdx, 0, ...trackDisconnect);
  console.log('✓ Added disconnect tracking');
}

// 3. Add actor spawn tracking
let spawnActorIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('spawnActor(type, name, x, y, extra = {}) {')) {
    spawnActorIdx = i;
    break;
  }
}

if (spawnActorIdx > 0) {
  // Find first line after opening brace and add tracking
  const bodyStart = spawnActorIdx + 1;
  lines.splice(bodyStart, 0, "    this.actorLifecycle.recordSpawn(type, name, this.frame);");
  console.log('✓ Added spawn tracking');
}

// 4. Add actor removal tracking
let removeDeadIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('removeDeadActors() {')) {
    removeDeadIdx = i;
    break;
  }
}

if (removeDeadIdx > 0) {
  // Find this.actors.delete(name); and add tracking before it
  for (let i = removeDeadIdx; i < Math.min(removeDeadIdx + 30, lines.length); i++) {
    if (lines[i].includes('this.actors.delete(name);')) {
      lines.splice(i, 0, "        this.actorLifecycle.recordRemoval(name, 'lifecycle', this.frame);");
      console.log('✓ Added removal tracking');
      break;
    }
  }
}

// 5. Add collision tracking - player-platform
let checkCollisionsIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('checkCollisions(actorSnapshot) {')) {
    checkCollisionsIdx = i;
    break;
  }
}

if (checkCollisionsIdx > 0) {
  // Find platform distance check
  for (let i = checkCollisionsIdx; i < Math.min(checkCollisionsIdx + 200, lines.length); i++) {
    if (lines[i].includes('if (pDistPlatform < 80)')) {
      const bodyStart = i + 1;
      if (!lines[bodyStart].includes('recordPlayerPlatform')) {
        lines.splice(bodyStart, 0, "            this.collisionStats.recordPlayerPlatform();");
        console.log('✓ Added player-platform collision tracking');
      }
      break;
    }
  }

  // Find enemy distance check
  for (let i = checkCollisionsIdx; i < Math.min(checkCollisionsIdx + 200, lines.length); i++) {
    if (lines[i].includes('if (pEnemyDist < 60)')) {
      const bodyStart = i + 1;
      if (!lines[bodyStart].includes('recordPlayerEnemy')) {
        lines.splice(bodyStart, 0, "          this.collisionStats.recordPlayerEnemy();");
        console.log('✓ Added player-enemy collision tracking');
      }
      break;
    }
  }
}

// 6. Add network broadcast tracking
let broadcastStateIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('broadcastStateUpdate(version) {')) {
    broadcastStateIdx = i;
    break;
  }
}

if (broadcastStateIdx > 0) {
  // Find ws.send call and add tracking
  for (let i = broadcastStateIdx; i < Math.min(broadcastStateIdx + 50, lines.length); i++) {
    if (lines[i].includes('ws.send(')) {
      // Add tracking before send
      const indent = '        ';
      const sendLine = lines[i];
      lines[i] = indent + "this.networkMetrics.recordBroadcastAttempt();";
      lines.splice(i + 1, 0, indent + "this.networkMetrics.recordMessageType('UPDATE');");
      lines.splice(i + 2, 0, indent + sendLine.trim());
      lines.splice(i + 3, 0, indent + "this.networkMetrics.recordBroadcastSuccess();");
      console.log('✓ Added broadcast tracking');
      break;
    }
  }
}

// 7. Add goal message tracking
let broadcastGoalIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('broadcastGoalReached(playerId, frameSnapshot) {')) {
    broadcastGoalIdx = i;
    break;
  }
}

if (broadcastGoalIdx > 0) {
  // Find MSG_TYPES.GOAL and add message type recording
  for (let i = broadcastGoalIdx; i < Math.min(broadcastGoalIdx + 30, lines.length); i++) {
    if (lines[i].includes('MSG_TYPES.GOAL')) {
      const nextIdx = i + 1;
      lines.splice(nextIdx, 0, "    this.networkMetrics.recordMessageType('GOAL');");
      console.log('✓ Added goal message tracking');
      break;
    }
  }
}

// Write back
const content = lines.join('\n');
fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Event tracking integration complete');
