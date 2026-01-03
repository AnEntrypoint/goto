// Inject event tracking for lifecycle and collisions
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// Track actor spawning - find spawnActor method
const spawnActorIdx = content.indexOf('spawnActor(type, name, x, y, extra = {}) {');
const spawnBodyIdx = content.indexOf('let body = null;', spawnActorIdx);
const afterSpawnBody = content.indexOf('\n', spawnBodyIdx) + 1;

const trackSpawn = `    this.actorLifecycle.recordSpawn(type, name, this.frame);\n`;
content = content.slice(0, afterSpawnBody) + trackSpawn + content.slice(afterSpawnBody);

// Track actor removal - find removeDeadActors method
const removeDeadIdx = content.indexOf('removeDeadActors() {');
const forLoopIdx = content.indexOf('for (const [name, actor] of this.actors)', removeDeadIdx);
const beforeRemovalCheck = content.indexOf('if (actor.state.removed)', forLoopIdx);
const removeActorIdx = content.indexOf('this.actors.delete(name);', beforeRemovalCheck);
const beforeDelete = content.lastIndexOf('\n', removeActorIdx);

const trackRemoval = `\n        this.actorLifecycle.recordRemoval(name, actor.state._removal_reason || 'unknown', this.frame);\n        `;
content = content.slice(0, beforeDelete) + trackRemoval + content.slice(beforeDelete);

// Track player collision - find checkCollisions and add player-enemy tracking
const checkCollisionsIdx = content.indexOf('checkCollisions(actorSnapshot) {');
const forPlayerIdx = content.indexOf('for (const [playerId, playerActor] of this.playerActors)', checkCollisionsIdx);
const forEnemyIdx = content.indexOf('for (const [enemyName, enemy] of this.actors)', forPlayerIdx);
const playerEnemyCheck = content.indexOf('if (pEnemyDist < 60)', forEnemyIdx);
const playerEnemyInside = content.indexOf('{', playerEnemyCheck) + 1;
const afterEnemyCheck = content.indexOf('\n', playerEnemyInside);

const trackCollision = `
          this.collisionStats.recordPlayerEnemy();`;
content = content.slice(0, afterEnemyCheck) + trackCollision + content.slice(afterEnemyCheck);

// Track platform collisions
const platformCheckIdx = content.indexOf('if (pDistPlatform < 80)', forEnemyIdx);
const platformCheckInside = content.indexOf('{', platformCheckIdx) + 1;
const afterPlatformCheck = content.indexOf('\n', platformCheckInside);

const trackPlatformCollision = `
            this.collisionStats.recordPlayerPlatform();`;
content = content.slice(0, afterPlatformCheck) + trackPlatformCollision + content.slice(afterPlatformCheck);

// Track player disconnects - find the ws.on('close') handler
const closeHandlerIdx = content.indexOf("ws.on('close', () => {");
const closeBodyStart = content.indexOf('{', closeHandlerIdx) + 1;
const playerId = "client.playerId";
const closeHandler = `
      const durationSeconds = Math.floor((Date.now() - client.connectedAt) / 1000);
      const finalScore = client.actor ? (client.actor.state.score || 0) : 0;
      game.playerDisconnects.recordDisconnect(${playerId}, 'close', durationSeconds, finalScore);`;

const beforeCloseBody = content.indexOf('\n', closeBodyStart) + 1;
content = content.slice(0, beforeCloseBody) + closeHandler + '\n' + content.slice(beforeCloseBody);

// Track network broadcast success/failure - find broadcastStateUpdate
const broadcastStateIdx = content.indexOf('broadcastStateUpdate(version) {');
const broadcastStartIdx = content.indexOf('for (const [playerId, client] of this.clients)', broadcastStateIdx);
const wsSendIdx = content.indexOf('ws.send(', broadcastStartIdx);
const beforeWsSend = content.lastIndexOf('\n', wsSendIdx);

const trackBroadcastAttempt = `
        this.networkMetrics.recordBroadcastAttempt();
        `;
content = content.slice(0, beforeWsSend) + trackBroadcastAttempt + '\n' + content.slice(beforeWsSend);

// Add try-catch around ws.send to track failures
const wsSendEnd = content.indexOf(';', wsSendIdx) + 1;
const wsSendLine = content.slice(content.lastIndexOf('\n', wsSendIdx) + 1, wsSendEnd);

const wrappedSend = `try {
          ${wsSendLine}
          this.networkMetrics.recordBroadcastSuccess();
        } catch (e) {
          this.networkMetrics.recordBroadcastFailure();
        }`;

content = content.slice(0, content.lastIndexOf('\n', wsSendIdx) + 1) + wrappedSend + content.slice(wsSendEnd);

// Track message types sent - find where messages are built
const broadcastGoalIdx = content.indexOf('broadcastGoalReached(playerId, frameSnapshot) {');
const goalMsgIdx = content.indexOf('[MSG_TYPES.GOAL,', broadcastGoalIdx);
if (goalMsgIdx > broadcastGoalIdx) {
  const goalSend = content.indexOf('ws.send(', goalMsgIdx);
  const beforeGoalSend = content.lastIndexOf('\n', goalSend);
  const trackGoal = `
        this.networkMetrics.recordMessageType('GOAL');`;
  content = content.slice(0, beforeGoalSend) + trackGoal + '\n' + content.slice(beforeGoalSend);
}

// Add structured logging for key events - find broadcastToClients
const broadcastToClientsIdx = content.indexOf('broadcastToClients(message) {');
const broadcastToClientsBody = content.indexOf('{', broadcastToClientsIdx) + 1;
const logBroadcast = `
    this.networkMetrics.recordMessageType(message[0]);`;
const afterBroadcastStart = content.indexOf('\n', broadcastToClientsBody) + 1;
content = content.slice(0, afterBroadcastStart) + logBroadcast + '\n' + content.slice(afterBroadcastStart);

// Track errors for alerting
const tickErrorIdx = content.indexOf("[TICK_CRASH]");
if (tickErrorIdx > 0) {
  const beforeTick = content.lastIndexOf('catch (e)', tickErrorIdx - 100);
  const afterCatch = content.indexOf('\n', beforeTick) + 1;
  const trackError = `        this.alerting.recordError();\n        `;
  content = content.slice(0, afterCatch) + trackError + content.slice(afterCatch);
}

// Update logger calls to use structured logger
content = content.replace(
  /console\.error\(\`\[([A-Z_]+)\]\s*([^`]+)\`\);/g,
  "this.logger.error('$1', { message: '$2' }, this.frame);"
);

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Event tracking injected');
console.log('✓ Actor lifecycle tracking (spawn/removal)');
console.log('✓ Collision statistics');
console.log('✓ Player disconnect tracking');
console.log('✓ Network broadcast monitoring');
console.log('✓ Error rate tracking for alerting');
