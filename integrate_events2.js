// Enhanced event tracking
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// 1. Add connectedAt to client object
content = content.replace(
  /const client = \{\s*ws:,/,
  'const client = { connectedAt: Date.now(), ws,'
);

// 2. Track spawn in spawnActor
content = content.replace(
  /spawnActor\(type, name, x, y, extra = \{\}\) \{/,
  'spawnActor(type, name, x, y, extra = {}) {\n    this.actorLifecycle.recordSpawn(type, name, this.frame);'
);

// 3. Track removal in removeDeadActors
content = content.replace(
  /if \(actor\.state\.removed\) \{\s*this\.actors\.delete\(name\);/,
  'if (actor.state.removed) {\n        this.actorLifecycle.recordRemoval(name, \'lifecycle\', this.frame);\n        this.actors.delete(name);'
);

// 4. Add collision tracking - look for pDistPlatform check
const platformCollisionPattern = /if \(pDistPlatform < 80\) \{/g;
content = content.replace(
  platformCollisionPattern,
  'if (pDistPlatform < 80) { this.collisionStats.recordPlayerPlatform();'
);

// 5. Add enemy collision tracking - look for pEnemyDist check
const enemyCollisionPattern = /if \(pEnemyDist < 60\) \{/g;
content = content.replace(
  enemyCollisionPattern,
  'if (pEnemyDist < 60) { this.collisionStats.recordPlayerEnemy();'
);

// 6. Add broadcast attempt/success tracking
const broadcastPattern = /this\.networkMetrics\.recordBroadcastAttempt\(\);/;
if (!broadcastPattern.test(content)) {
  // Find ws.send in broadcastStateUpdate
  const broadcastStateStart = content.indexOf('broadcastStateUpdate(version) {');
  if (broadcastStateStart > 0) {
    const broadcastEnd = content.indexOf('\n  }', broadcastStateStart);
    const wsSendIdx = content.indexOf('ws.send(', broadcastStateStart);

    if (wsSendIdx > 0 && wsSendIdx < broadcastEnd) {
      const beforeWsSend = content.lastIndexOf('\n', wsSendIdx) + 1;
      const trackBroadcast = '        this.networkMetrics.recordBroadcastAttempt();\n        this.networkMetrics.recordMessageType(\'UPDATE\');\n        ';
      content = content.slice(0, beforeWsSend) + trackBroadcast + content.slice(beforeWsSend);
    }
  }
}

// 7. Track goal broadcast
const goalBroadcastStart = content.indexOf('broadcastGoalReached(playerId, frameSnapshot) {');
if (goalBroadcastStart > 0) {
  const goalEnd = content.indexOf('\n  }', goalBroadcastStart);
  const msgGoalIdx = content.indexOf('MSG_TYPES.GOAL,', goalBroadcastStart);

  if (msgGoalIdx > 0 && msgGoalIdx < goalEnd) {
    const beforeMsg = content.lastIndexOf('\n', msgGoalIdx) + 1;
    const trackGoal = '    this.networkMetrics.recordMessageType(\'GOAL\');\n    const msg = ';
    const msgEnd = content.indexOf('];', msgGoalIdx) + 2;
    const msgLine = content.slice(content.lastIndexOf('\n', msgGoalIdx) + 1, msgEnd);
    const newMsgLine = msgLine.replace('const msg = [', 'const msg = [');

    // Simpler approach: just add tracking before broadcastToClients
    const bcToClientsIdx = content.indexOf('this.broadcastToClients(msg);', msgGoalIdx);
    if (bcToClientsIdx > 0) {
      const beforeBc = content.lastIndexOf('\n', bcToClientsIdx) + 1;
      const trackMsg = '    this.networkMetrics.recordMessageType(\'GOAL\');\n    ';
      content = content.slice(0, beforeBc) + trackMsg + content.slice(beforeBc);
    }
  }
}

// 8. Add breakable platform hit tracking
content = content.replace(
  /if \(bPlatform\.state\.hit_count >= bPlatform\.state\.max_hits\) \{/g,
  'if (bPlatform.state.hit_count >= bPlatform.state.max_hits) { this.collisionStats.recordBreakableHit();'
);

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Spawn tracking added');
console.log('✓ Removal tracking added');
console.log('✓ Player-platform collision tracking added');
console.log('✓ Player-enemy collision tracking added');
console.log('✓ Broadcast tracking added');
console.log('✓ Goal message tracking added');
console.log('✓ Breakable platform hit tracking added');
