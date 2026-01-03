// Complete observability integration - careful approach
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let lines = fs.readFileSync(serverPath, 'utf-8').split('\n');

console.log(`Total lines: ${lines.length}`);

// 1. Add observability import after line 6
const obsImport = "const { StructuredLogger, FrameProfiler, MemoryMetrics, ActorLifecycleTracker, CollisionStats, NetworkMetrics, PlayerDisconnectTracker, AlertingRules, SLODefinitions, PrometheusMetrics } = require('./observability');";
lines.splice(7, 0, obsImport);
console.log('✓ Added observability import');

// 2. Find constructor (class PhysicsGame) and add initialization
let constructorLine = -1;
let loadStageLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('class PhysicsGame')) {
    constructorLine = i;
  }
  if (constructorLine > 0 && lines[i].includes('this.loadStage(1);')) {
    loadStageLine = i;
    break;
  }
}

if (loadStageLine > 0) {
  const obsInit = [
    '    this.logger = new StructuredLogger();',
    '    this.logger.start();',
    '    this.frameProfiler = new FrameProfiler();',
    '    this.memoryMetrics = new MemoryMetrics();',
    '    this.collisionStats = new CollisionStats();',
    '    this.networkMetrics = new NetworkMetrics();',
    '    this.actorLifecycle = new ActorLifecycleTracker();',
    '    this.playerDisconnects = new PlayerDisconnectTracker();',
    '    this.alerting = new AlertingRules();',
    '    this.slos = new SLODefinitions();',
    '    this.prometheus = new PrometheusMetrics();'
  ];
  lines.splice(loadStageLine, 0, ...obsInit);
  console.log('✓ Added observability initialization');
} else {
  console.error('Could not find loadStage line');
}

// 3. Find tick() and add profiling
let tickLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('tick() {')) {
    tickLine = i;
    break;
  }
}

if (tickLine > 0) {
  // Find the line with "const wasPaused = this.paused;"
  let wasPausedLine = -1;
  for (let i = tickLine; i < Math.min(tickLine + 20, lines.length); i++) {
    if (lines[i].includes('const wasPaused = this.paused;')) {
      wasPausedLine = i;
      break;
    }
  }

  if (wasPausedLine > 0) {
    const tickInit = [
      '    const tickStart = Date.now();',
      '    const frameProfiler = this.frameProfiler;'
    ];
    lines.splice(wasPausedLine + 1, 0, ...tickInit);
    console.log('✓ Added tick profiling initialization');
  }
}

// 4. Find tick profiling points
// Find processPendingInput call
for (let i = tickLine; i < lines.length && i < tickLine + 100; i++) {
  if (lines[i].includes('this.processPendingInput();')) {
    lines.splice(i, 0, '      frameProfiler.startPhase(\'input_processing\');');
    lines.splice(i + 2, 0, '      frameProfiler.endPhase(\'input_processing\');');
    lines.splice(i + 3, 0, '      frameProfiler.startPhase(\'respawn_update\');');
    console.log('✓ Added input processing profiling');
    break;
  }
}

// Find updateRespawns call
for (let i = tickLine; i < lines.length && i < tickLine + 100; i++) {
  if (lines[i].includes('this.updateRespawns();')) {
    lines.splice(i + 1, 0, '      frameProfiler.endPhase(\'respawn_update\');');
    lines.splice(i + 2, 0, '      frameProfiler.startPhase(\'actor_update\');');
    console.log('✓ Added respawn update profiling');
    break;
  }
}

// Find updateActors call
for (let i = tickLine; i < lines.length && i < tickLine + 150; i++) {
  if (lines[i].includes('this.updateActors();')) {
    lines.splice(i + 1, 0, '      frameProfiler.endPhase(\'actor_update\');');
    lines.splice(i + 2, 0, '      frameProfiler.startPhase(\'collision_detection\');');
    console.log('✓ Added actor update profiling');
    break;
  }
}

// Find checkCollisions call
for (let i = tickLine; i < lines.length && i < tickLine + 200; i++) {
  if (lines[i].includes('this.checkCollisions(actorSnapshot);')) {
    lines.splice(i + 1, 0, '      frameProfiler.endPhase(\'collision_detection\');');
    lines.splice(i + 2, 0, '      frameProfiler.startPhase(\'goal_check\');');
    console.log('✓ Added collision detection profiling');
    break;
  }
}

// Find checkGoal call
for (let i = tickLine; i < lines.length && i < tickLine + 250; i++) {
  if (lines[i].includes('this.checkGoal(frameSnapshot);')) {
    lines.splice(i + 1, 0, '        frameProfiler.endPhase(\'goal_check\');');
    console.log('✓ Added goal check profiling');
    break;
  }
}

// Find removeDeadActors call and add removal profiling + end-of-tick stats
for (let i = tickLine; i < lines.length && i < tickLine + 300; i++) {
  if (lines[i].includes('this.removeDeadActors();')) {
    lines.splice(i, 0, '      frameProfiler.startPhase(\'removal\');');
    lines.splice(i + 2, 0, '      frameProfiler.endPhase(\'removal\');');

    // Add end-of-tick profiling
    const tickStats = [
      '',
      '      const tickMs = Date.now() - tickStart;',
      '      frameProfiler.metrics.total_tick_ms.push(tickMs);',
      '      if (frameProfiler.metrics.total_tick_ms.length > 60) {',
      '        frameProfiler.metrics.total_tick_ms.shift();',
      '      }',
      '      const profileResult = frameProfiler.recordTick();',
      '      if (profileResult) {',
      '        this.networkMetrics.recordFrame();',
      '        const memResult = this.memoryMetrics.recordFrame();',
      '        const collResult = this.collisionStats.recordFrame();',
      '        this.slos.recordFrame();',
      '        if (memResult && memResult.alert) {',
      '          this.alerting.checkHeapUsage(memResult.sample.heap_used_mb);',
      '        }',
      '        if (profileResult.total_tick && profileResult.total_tick.p99) {',
      '          this.alerting.checkFrameTimeP99(profileResult.total_tick.p99);',
      '        }',
      '      }'
    ];
    lines.splice(i + 3, 0, ...tickStats);
    console.log('✓ Added removal and end-of-tick profiling');
    break;
  }
}

// 5. Add /metrics and /api/observability endpoints before server.listen
let listenLine = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes("server.listen(PORT, () => {")) {
    listenLine = i;
    break;
  }
}

if (listenLine > 0) {
  const metricsEndpoints = [
    '',
    "app.get('/metrics', (req, res) => {",
    "  const ip = req.ip || req.connection.remoteAddress;",
    "  if (!checkIPRateLimit(ip)) {",
    "    return res.status(429).text('Rate limit exceeded');",
    "  }",
    "  res.setHeader('Content-Type', 'text/plain; version=0.0.4');",
    '',
    "  const profiling = game.frameProfiler.getMetrics();",
    "  const memory = game.memoryMetrics.getMetrics();",
    "  const collisions = game.collisionStats.getMetrics();",
    "  const network = game.networkMetrics.getMetrics();",
    "  const alerts = game.alerting.getMetrics();",
    "  const sli = game.slos.getSLI();",
    '',
    "  game.prometheus.recordGauge('game_frame_number', game.frame);",
    "  game.prometheus.recordGauge('game_stage', game.stage);",
    "  game.prometheus.recordGauge('game_actors_count', game.actors.size);",
    "  game.prometheus.recordGauge('game_clients_count', game.clients.size);",
    "  game.prometheus.recordHistogram('tick_duration_ms', profiling.total_tick.avg);",
    "  game.prometheus.recordHistogram('input_processing_ms', profiling.input_processing.avg);",
    "  game.prometheus.recordHistogram('actor_update_ms', profiling.actor_update.avg);",
    "  game.prometheus.recordHistogram('collision_detection_ms', profiling.collision_detection.avg);",
    "  game.prometheus.recordHistogram('goal_check_ms', profiling.goal_check.avg);",
    "  game.prometheus.recordGauge('memory_heap_used_mb', memory?.latest?.heap_used_mb || 0);",
    "  game.prometheus.recordGauge('network_broadcast_success_rate', network.avg_success_rate);",
    "  game.prometheus.recordCounter('network_broadcast_failures', network.total_failures);",
    "  game.prometheus.recordGauge('collisions_player_platform_avg', collisions.avg_player_platform);",
    "  game.prometheus.recordGauge('collisions_player_enemy_avg', collisions.avg_player_enemy);",
    "  game.prometheus.recordGauge('slo_uptime', sli.sli_uptime);",
    "  game.prometheus.recordGauge('alerts_total', alerts.total_alerts);",
    '',
    "  res.send(game.prometheus.export());",
    "});",
    '',
    "app.get('/api/observability', (req, res) => {",
    "  const ip = req.ip || req.connection.remoteAddress;",
    "  if (!checkIPRateLimit(ip)) {",
    "    return res.status(429).json({ error: 'Rate limit exceeded' });",
    "  }",
    '',
    "  const profiling = game.frameProfiler.getMetrics();",
    "  const memory = game.memoryMetrics.getMetrics();",
    "  const collisions = game.collisionStats.getMetrics();",
    "  const network = game.networkMetrics.getMetrics();",
    "  const disconnects = game.playerDisconnects.getMetrics();",
    "  const alerts = game.alerting.getMetrics();",
    "  const sli = game.slos.getSLI();",
    "  const lifecycle = game.actorLifecycle.getMetrics();",
    '',
    "  res.json({",
    "    frame: game.frame,",
    "    stage: game.stage,",
    "    profiling,",
    "    memory,",
    "    collisions,",
    "    network,",
    "    player_disconnects: disconnects,",
    "    actor_lifecycle: lifecycle,",
    "    alerts,",
    "    slos: sli",
    "  });",
    "});",
    ''
  ];
  lines.splice(listenLine, 0, ...metricsEndpoints);
  console.log('✓ Added /metrics and /api/observability endpoints');
}

// Write updated content
const content = lines.join('\n');
fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Integration complete');
