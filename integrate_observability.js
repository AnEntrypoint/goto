// Integration script to add observability to server
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// Add observability import
const importLine = "const { StructuredLogger, FrameProfiler, MemoryMetrics, ActorLifecycleTracker, CollisionStats, NetworkMetrics, PlayerDisconnectTracker, AlertingRules, SLODefinitions, PrometheusMetrics } = require('./observability');";
const engineImportIdx = content.indexOf("const { Engine, World, Body, Events, Composite } = require('matter-js');");
const insertIdx = content.indexOf('\n', engineImportIdx) + 1;
content = content.slice(0, insertIdx) + importLine + '\n' + content.slice(insertIdx);

// Find constructor and add observability initialization
const constructorIdx = content.indexOf('this.loadStage(1);');
const beforeConstructor = content.lastIndexOf('\n', constructorIdx);
const obsInit = `
    this.logger = new StructuredLogger();
    this.logger.start();
    this.frameProfiler = new FrameProfiler();
    this.memoryMetrics = new MemoryMetrics();
    this.collisionStats = new CollisionStats();
    this.networkMetrics = new NetworkMetrics();
    this.actorLifecycle = new ActorLifecycleTracker();
    this.playerDisconnects = new PlayerDisconnectTracker();
    this.alerting = new AlertingRules();
    this.slos = new SLODefinitions();
    this.prometheus = new PrometheusMetrics();`;
content = content.slice(0, beforeConstructor) + obsInit + '\n' + content.slice(beforeConstructor);

// Add tick profiling - find the tick() function
const tickIdx = content.indexOf('tick() {');
const tickBodyStart = content.indexOf('const wasPaused = this.paused;', tickIdx);
const afterWasPaused = content.indexOf('\n', tickBodyStart) + 1;

const tickProfileStart = `
    const tickStart = Date.now();
    const frameProfiler = this.frameProfiler;`;
content = content.slice(0, afterWasPaused) + tickProfileStart + '\n' + content.slice(afterWasPaused);

// Find processPendingInput call and add profiling
const processPendingIdx = content.indexOf('this.processPendingInput();');
const beforeProcessing = content.lastIndexOf('\n', processPendingIdx);
content = content.slice(0, beforeProcessing) + `
      frameProfiler.startPhase('input_processing');` + content.slice(beforeProcessing);

const afterProcessing = content.indexOf('\n', processPendingIdx + 100);
content = content.slice(0, afterProcessing) + `
      frameProfiler.endPhase('input_processing');
      frameProfiler.startPhase('respawn_update');` + content.slice(afterProcessing);

// Add profiling for respawn updates
const updateRespawnsIdx = content.indexOf('this.updateRespawns();');
const beforeRespawn = content.lastIndexOf('frameProfiler.startPhase', updateRespawnsIdx);
const afterRespawn = content.indexOf('\n', updateRespawnsIdx + 100);
content = content.slice(0, afterRespawn) + `
      frameProfiler.endPhase('respawn_update');
      frameProfiler.startPhase('actor_update');` + content.slice(afterRespawn);

// Add profiling for actor updates
const updateActorsIdx = content.indexOf('this.updateActors();');
const afterActors = content.indexOf('\n', updateActorsIdx + 100);
content = content.slice(0, afterActors) + `
      frameProfiler.endPhase('actor_update');
      frameProfiler.startPhase('collision_detection');` + content.slice(afterActors);

// Add profiling for collision detection
const checkCollisionsIdx = content.indexOf('this.checkCollisions(actorSnapshot);');
const afterCollisions = content.indexOf('\n', checkCollisionsIdx + 100);
content = content.slice(0, afterCollisions) + `
      frameProfiler.endPhase('collision_detection');
      frameProfiler.startPhase('goal_check');` + content.slice(afterCollisions);

// Add profiling for goal check
const checkGoalIdx = content.indexOf('this.checkGoal(frameSnapshot);');
const afterGoal = content.indexOf('\n', checkGoalIdx + 100);
content = content.slice(0, afterGoal) + `
        frameProfiler.endPhase('goal_check');` + content.slice(afterGoal);

// Add end-of-tick profiling and sample collection
const removeDeadIdx = content.indexOf('this.removeDeadActors();');
const beforeRemove = content.lastIndexOf('try {', removeDeadIdx);
const insertRemoveProfile = `
      frameProfiler.startPhase('removal');
      ` + content.slice(beforeRemove, removeDeadIdx + 25) + `
      frameProfiler.endPhase('removal');

      const tickMs = Date.now() - tickStart;
      frameProfiler.metrics.total_tick_ms.push(tickMs);
      if (frameProfiler.metrics.total_tick_ms.length > 60) {
        frameProfiler.metrics.total_tick_ms.shift();
      }
      const profileResult = frameProfiler.recordTick();
      if (profileResult) {
        this.networkMetrics.recordFrame();
        const memResult = this.memoryMetrics.recordFrame();
        const collResult = this.collisionStats.recordFrame();
        if (memResult && memResult.alert) {
          this.alerting.checkHeapUsage(memResult.sample.heap_used_mb);
        }
        if (profileResult.total_tick.p99) {
          this.alerting.checkFrameTimeP99(profileResult.total_tick.p99);
        }
      }
`;
content = content.slice(0, beforeRemove) + insertRemoveProfile + content.slice(removeDeadIdx + 25);

// Add /metrics endpoint before server.listen
const serverListenIdx = content.indexOf("server.listen(PORT, () => {");
const beforeListen = content.lastIndexOf('\n', serverListenIdx);
const metricsEndpoint = `
app.get('/metrics', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).text('Rate limit exceeded');
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');

  const profiling = game.frameProfiler.getMetrics();
  const memory = game.memoryMetrics.getMetrics();
  const collisions = game.collisionStats.getMetrics();
  const network = game.networkMetrics.getMetrics();
  const disconnects = game.playerDisconnects.getMetrics();
  const alerts = game.alerting.getMetrics();
  const sli = game.slos.getSLI();
  const lifecycle = game.actorLifecycle.getMetrics();

  game.prometheus.recordGauge('game_frame_number', game.frame);
  game.prometheus.recordGauge('game_stage', game.stage);
  game.prometheus.recordGauge('game_actors_count', game.actors.size);
  game.prometheus.recordGauge('game_clients_count', game.clients.size);
  game.prometheus.recordHistogram('tick_duration_ms', profiling.total_tick.avg);
  game.prometheus.recordHistogram('input_processing_ms', profiling.input_processing.avg);
  game.prometheus.recordHistogram('actor_update_ms', profiling.actor_update.avg);
  game.prometheus.recordHistogram('collision_detection_ms', profiling.collision_detection.avg);
  game.prometheus.recordHistogram('goal_check_ms', profiling.goal_check.avg);
  game.prometheus.recordHistogram('broadcast_ms', profiling.broadcast.avg);
  game.prometheus.recordGauge('memory_heap_used_mb', memory?.latest?.heap_used_mb || 0);
  game.prometheus.recordGauge('network_broadcast_success_rate', network.avg_success_rate);
  game.prometheus.recordCounter('network_broadcast_failures', network.total_failures);
  game.prometheus.recordGauge('collisions_player_platform_avg', collisions.avg_player_platform);
  game.prometheus.recordGauge('collisions_player_enemy_avg', collisions.avg_player_enemy);
  game.prometheus.recordGauge('slo_uptime', sli.sli_uptime);
  game.prometheus.recordGauge('alerts_total', alerts.total_alerts);

  res.send(game.prometheus.export());
});

app.get('/api/observability', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkIPRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const profiling = game.frameProfiler.getMetrics();
  const memory = game.memoryMetrics.getMetrics();
  const collisions = game.collisionStats.getMetrics();
  const network = game.networkMetrics.getMetrics();
  const disconnects = game.playerDisconnects.getMetrics();
  const alerts = game.alerting.getMetrics();
  const sli = game.slos.getSLI();
  const lifecycle = game.actorLifecycle.getMetrics();

  res.json({
    frame: game.frame,
    stage: game.stage,
    profiling,
    memory,
    collisions,
    network,
    player_disconnects: disconnects,
    actor_lifecycle: lifecycle,
    alerts,
    slos: sli
  });
});

`;
content = content.slice(0, beforeListen) + metricsEndpoint + '\n' + content.slice(beforeListen);

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Observability integration complete');
console.log('✓ Added StructuredLogger with JSON output');
console.log('✓ Added FrameProfiler for tick phase measurements');
console.log('✓ Added MemoryMetrics tracking');
console.log('✓ Added ActorLifecycleTracker');
console.log('✓ Added CollisionStats');
console.log('✓ Added NetworkMetrics with broadcast tracking');
console.log('✓ Added PlayerDisconnectTracker');
console.log('✓ Added AlertingRules with thresholds');
console.log('✓ Added SLODefinitions and SLI tracking');
console.log('✓ Added PrometheusMetrics export');
console.log('✓ Added /metrics endpoint (Prometheus format)');
console.log('✓ Added /api/observability endpoint (JSON)');
