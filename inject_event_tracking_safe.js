// Safe event tracking injection
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// 1. Add connectedAt timestamp tracking in ws.on('connection')
const connectionIdx = content.indexOf("ws.on('connection', (ws, req) => {");
const clientCreationIdx = content.indexOf('const client = {', connectionIdx);
const clientBodyIdx = content.indexOf('{', clientCreationIdx) + 1;
const afterClientCreate = content.indexOf('ws:', clientBodyIdx);
const beforeWs = content.lastIndexOf('\n', afterClientCreate);

const connectedAt = `connectedAt: Date.now(),\n    `;
content = content.slice(0, beforeWs) + '\n    ' + connectedAt + content.slice(beforeWs + 1);

// 2. Track player disconnect with duration and score
const closeHandlerIdx = content.indexOf("ws.on('close', () => {", connectionIdx);
if (closeHandlerIdx > 0) {
  const closeBodyIdx = closeHandlerIdx + 20;
  const firstLine = content.indexOf('\n', closeBodyIdx) + 1;
  const trackDisconnect = `      if (client && typeof client.playerId === 'number') {
        const durationSeconds = Math.floor((Date.now() - (client.connectedAt || Date.now())) / 1000);
        const finalScore = client.actor ? (client.actor.state.score || 0) : 0;
        game.playerDisconnects.recordDisconnect(client.playerId, 'close', durationSeconds, finalScore);
      }
`;
  content = content.slice(0, firstLine) + trackDisconnect + content.slice(firstLine);
}

// 3. Track network broadcast with message counts
const broadcastStateIdx = content.indexOf('broadcastStateUpdate(version) {');
if (broadcastStateIdx > 0) {
  const forLoopIdx = content.indexOf('for (const [playerId, client] of this.clients)', broadcastStateIdx);
  const wsSendIdx = content.indexOf('ws.send(', forLoopIdx);
  const beforeSend = content.lastIndexOf('\n', wsSendIdx) + 1;

  const trackMsg = `        this.networkMetrics.recordBroadcastAttempt();
        this.networkMetrics.recordMessageType('UPDATE');
`;
  const sendLine = content.slice(beforeSend, content.indexOf(';', wsSendIdx) + 1);
  const wrappedSend = `try {
          ${sendLine.trim()}
          this.networkMetrics.recordBroadcastSuccess();
        } catch (broadcastErr) {
          this.networkMetrics.recordBroadcastFailure();
        }`;

  content = content.slice(0, beforeSend) + trackMsg + wrappedSend + content.slice(content.indexOf(';', wsSendIdx) + 1);
}

// 4. Track collision detection
const checkCollisionsIdx = content.indexOf('checkCollisions(actorSnapshot) {');
if (checkCollisionsIdx > 0) {
  // Player-platform collision
  const platformDistIdx = content.indexOf('const pDistPlatform = Math.hypot(', checkCollisionsIdx);
  if (platformDistIdx > 0) {
    const platformCheckIdx = content.indexOf('if (pDistPlatform < 80)', platformDistIdx);
    if (platformCheckIdx > 0) {
      const insideCheck = content.indexOf('{', platformCheckIdx) + 1;
      const nextLine = content.indexOf('\n', insideCheck) + 1;
      content = content.slice(0, nextLine) + '            this.collisionStats.recordPlayerPlatform();\n' + content.slice(nextLine);
    }
  }

  // Player-enemy collision
  const enemyDistIdx = content.indexOf('const pEnemyDist = Math.hypot(', checkCollisionsIdx);
  if (enemyDistIdx > 0) {
    const enemyCheckIdx = content.indexOf('if (pEnemyDist < 60)', enemyDistIdx);
    if (enemyCheckIdx > 0) {
      const insideCheck = content.indexOf('{', enemyCheckIdx) + 1;
      const nextLine = content.indexOf('\n', insideCheck) + 1;
      content = content.slice(0, nextLine) + '          this.collisionStats.recordPlayerEnemy();\n' + content.slice(nextLine);
    }
  }
}

// 5. Track actor spawning
const spawnActorIdx = content.indexOf('spawnActor(type, name, x, y, extra = {}) {');
if (spawnActorIdx > 0) {
  const methodBodyStart = content.indexOf('{', spawnActorIdx) + 1;
  const firstLineEnd = content.indexOf('\n', methodBodyStart) + 1;
  content = content.slice(0, firstLineEnd) + '    this.actorLifecycle.recordSpawn(type, name, this.frame);\n' + content.slice(firstLineEnd);
}

// 6. Track actor removal
const removeDeadIdx = content.indexOf('removeDeadActors() {');
if (removeDeadIdx > 0) {
  const deleteIdx = content.indexOf('this.actors.delete(name);', removeDeadIdx);
  const beforeDelete = content.lastIndexOf('\n', deleteIdx) + 1;
  content = content.slice(0, beforeDelete) + "        this.actorLifecycle.recordRemoval(name, 'lifecycle', this.frame);\n" + content.slice(beforeDelete);
}

// 7. Track frame count for SLOs
const slosRecordIdx = content.indexOf('this.slos.recordFrame();');
if (slosRecordIdx < 0) {
  // Add after tick profiling
  const profileRecordIdx = content.indexOf('const profileResult = this.frameProfiler.recordTick();');
  if (profileRecordIdx > 0) {
    const nextLine = content.indexOf('\n', profileRecordIdx) + 1;
    content = content.slice(0, nextLine) + '      this.slos.recordFrame();\n' + content.slice(nextLine);
  }
}

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Event tracking safely injected');
console.log('✓ connectedAt timestamp for duration tracking');
console.log('✓ Player disconnect recording with score');
console.log('✓ Broadcast success/failure tracking');
console.log('✓ Collision statistics (player-platform, player-enemy)');
console.log('✓ Actor lifecycle tracking');
console.log('✓ SLO frame counting');
