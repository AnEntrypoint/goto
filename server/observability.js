// Observability Foundation: Structured logging, metrics, profiling, alerting

const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;

class StructuredLogger {
  constructor() {
    this.buffer = [];
    this.flushInterval = null;
  }

  log(level, code, context = {}, frame = null, actor_name = null) {
    const entry = {
      timestamp: Date.now(),
      level,
      code,
      frame: frame ?? null,
      actor_name: actor_name ?? null,
      context
    };
    this.buffer.push(entry);
    if (level === 'error') {
      console.log(JSON.stringify(entry));
    }
  }

  info(code, context = {}, frame = null, actor_name = null) {
    this.log('info', code, context, frame, actor_name);
  }

  warn(code, context = {}, frame = null, actor_name = null) {
    this.log('warn', code, context, frame, actor_name);
  }

  error(code, context = {}, frame = null, actor_name = null) {
    this.log('error', code, context, frame, actor_name);
  }

  debug(code, context = {}, frame = null, actor_name = null) {
    this.log('debug', code, context, frame, actor_name);
  }

  flush() {
    if (this.buffer.length > 0) {
      this.buffer.forEach(entry => {
        if (entry.level === 'error' || entry.level === 'warn') {
          console.log(JSON.stringify(entry));
        }
      });
      this.buffer = [];
    }
  }

  start() {
    this.flushInterval = setInterval(() => this.flush(), 1000);
  }

  stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

class FrameProfiler {
  constructor() {
    this.metrics = {
      input_processing_ms: [],
      respawn_update_ms: [],
      actor_update_ms: [],
      collision_detection_ms: [],
      goal_check_ms: [],
      broadcast_ms: [],
      removal_ms: [],
      total_tick_ms: []
    };
    this.currentFrame = {};
    this.sampleInterval = 60;
    this.frameCount = 0;
  }

  startPhase(phase) {
    this.currentFrame[phase] = { start: Date.now() };
  }

  endPhase(phase) {
    if (this.currentFrame[phase]) {
      const duration = Date.now() - this.currentFrame[phase].start;
      const metricKey = phase + '_ms';
      if (this.metrics[metricKey]) {
        this.metrics[metricKey].push(duration);
        if (this.metrics[metricKey].length > 60) {
          this.metrics[metricKey].shift();
        }
      }
    }
  }

  recordTick() {
    this.frameCount++;
    if (this.frameCount % this.sampleInterval === 0) {
      return this.getMetrics();
    }
    return null;
  }

  getMetrics() {
    const compute = (arr) => {
      if (arr.length === 0) return { avg: 0, max: 0, min: 0, p99: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const max = sorted[sorted.length - 1];
      const min = sorted[0];
      const p99Index = Math.floor(sorted.length * 0.99);
      const p99 = sorted[Math.max(0, p99Index)];
      return { avg: Math.round(avg * 100) / 100, max, min, p99 };
    };

    return {
      frame: this.frameCount,
      input_processing: compute(this.metrics.input_processing_ms),
      respawn_update: compute(this.metrics.respawn_update_ms),
      actor_update: compute(this.metrics.actor_update_ms),
      collision_detection: compute(this.metrics.collision_detection_ms),
      goal_check: compute(this.metrics.goal_check_ms),
      broadcast: compute(this.metrics.broadcast_ms),
      removal: compute(this.metrics.removal_ms),
      total_tick: compute(this.metrics.total_tick_ms)
    };
  }
}

class MemoryMetrics {
  constructor() {
    this.samples = [];
    this.sampleInterval = 60;
    this.frameCount = 0;
    this.heapAlertThreshold = 300; // MB
  }

  recordFrame() {
    this.frameCount++;
    if (this.frameCount % this.sampleInterval === 0) {
      const mem = process.memoryUsage();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100;
      this.samples.push({
        timestamp: Date.now(),
        heap_used_mb: heapUsedMB,
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        external_mb: Math.round(mem.external / 1024 / 1024)
      });
      if (this.samples.length > 60) {
        this.samples.shift();
      }
      return { sample: this.samples[this.samples.length - 1], alert: heapUsedMB > this.heapAlertThreshold };
    }
    return null;
  }

  getMetrics() {
    if (this.samples.length === 0) return null;
    const latest = this.samples[this.samples.length - 1];
    const heaps = this.samples.map(s => s.heap_used_mb);
    return {
      latest,
      max_heap_mb: Math.max(...heaps),
      avg_heap_mb: Math.round(heaps.reduce((a, b) => a + b, 0) / heaps.length * 100) / 100,
      sample_count: this.samples.length
    };
  }
}

class ActorLifecycleTracker {
  constructor() {
    this.spawns = [];
    this.removals = [];
    this.currentCount = 0;
    this.totalSpawned = 0;
    this.totalRemoved = 0;
  }

  recordSpawn(type, name, frame) {
    this.spawns.push({ type, name, frame, timestamp: Date.now() });
    this.currentCount++;
    this.totalSpawned++;
    if (this.spawns.length > 100) {
      this.spawns.shift();
    }
  }

  recordRemoval(name, reason, frame) {
    this.removals.push({ name, reason, frame, timestamp: Date.now() });
    this.currentCount = Math.max(0, this.currentCount - 1);
    this.totalRemoved++;
    if (this.removals.length > 100) {
      this.removals.shift();
    }
  }

  getMetrics() {
    return {
      current_count: this.currentCount,
      total_spawned: this.totalSpawned,
      total_removed: this.totalRemoved,
      recent_spawns: this.spawns.slice(-10),
      recent_removals: this.removals.slice(-10)
    };
  }
}

class CollisionStats {
  constructor() {
    this.playerPlatformCollisions = 0;
    this.enemyPlatformCollisions = 0;
    this.playerEnemyCollisions = 0;
    this.breakablePlatformHits = 0;
    this.frameCount = 0;
    this.sampleInterval = 60;
    this.history = [];
  }

  recordPlayerPlatform() {
    this.playerPlatformCollisions++;
  }

  recordEnemyPlatform() {
    this.enemyPlatformCollisions++;
  }

  recordPlayerEnemy() {
    this.playerEnemyCollisions++;
  }

  recordBreakableHit() {
    this.breakablePlatformHits++;
  }

  recordFrame() {
    this.frameCount++;
    if (this.frameCount % this.sampleInterval === 0) {
      const sample = {
        frame: this.frameCount,
        player_platform: this.playerPlatformCollisions,
        enemy_platform: this.enemyPlatformCollisions,
        player_enemy: this.playerEnemyCollisions,
        breakable_hits: this.breakablePlatformHits
      };
      this.history.push(sample);
      if (this.history.length > 60) {
        this.history.shift();
      }
      this.playerPlatformCollisions = 0;
      this.enemyPlatformCollisions = 0;
      this.playerEnemyCollisions = 0;
      this.breakablePlatformHits = 0;
      return sample;
    }
    return null;
  }

  getMetrics() {
    if (this.history.length === 0) {
      return { avg_player_platform: 0, avg_enemy_platform: 0, avg_player_enemy: 0, avg_breakable_hits: 0 };
    }
    const ppAvg = Math.round(this.history.reduce((a, s) => a + s.player_platform, 0) / this.history.length * 100) / 100;
    const epAvg = Math.round(this.history.reduce((a, s) => a + s.enemy_platform, 0) / this.history.length * 100) / 100;
    const peAvg = Math.round(this.history.reduce((a, s) => a + s.player_enemy, 0) / this.history.length * 100) / 100;
    const bhAvg = Math.round(this.history.reduce((a, s) => a + s.breakable_hits, 0) / this.history.length * 100) / 100;
    return { avg_player_platform: ppAvg, avg_enemy_platform: epAvg, avg_player_enemy: peAvg, avg_breakable_hits: bhAvg };
  }
}

class NetworkMetrics {
  constructor() {
    this.broadcastAttempts = 0;
    this.broadcastSuccesses = 0;
    this.broadcastFailures = 0;
    this.messageTypeCount = {};
    this.frameCount = 0;
    this.sampleInterval = 60;
    this.history = [];
  }

  recordBroadcastAttempt() {
    this.broadcastAttempts++;
  }

  recordBroadcastSuccess() {
    this.broadcastSuccesses++;
  }

  recordBroadcastFailure() {
    this.broadcastFailures++;
  }

  recordMessageType(type) {
    this.messageTypeCount[type] = (this.messageTypeCount[type] || 0) + 1;
  }

  recordFrame() {
    this.frameCount++;
    if (this.frameCount % this.sampleInterval === 0) {
      const successRate = this.broadcastAttempts > 0 ? Math.round(this.broadcastSuccesses / this.broadcastAttempts * 10000) / 100 : 0;
      const sample = {
        frame: this.frameCount,
        attempts: this.broadcastAttempts,
        successes: this.broadcastSuccesses,
        failures: this.broadcastFailures,
        success_rate_percent: successRate,
        message_types: { ...this.messageTypeCount }
      };
      this.history.push(sample);
      if (this.history.length > 60) {
        this.history.shift();
      }
      this.broadcastAttempts = 0;
      this.broadcastSuccesses = 0;
      this.broadcastFailures = 0;
      this.messageTypeCount = {};
      return sample;
    }
    return null;
  }

  getMetrics() {
    if (this.history.length === 0) {
      return { avg_success_rate: 0, total_attempts: 0, total_failures: 0 };
    }
    const latest = this.history[this.history.length - 1];
    const avgRate = Math.round(this.history.reduce((a, s) => a + s.success_rate_percent, 0) / this.history.length * 100) / 100;
    const totalFailures = this.history.reduce((a, s) => a + s.failures, 0);
    return { avg_success_rate: avgRate, latest_rate: latest.success_rate_percent, total_failures: totalFailures };
  }
}

class PlayerDisconnectTracker {
  constructor() {
    this.disconnects = [];
  }

  recordDisconnect(playerId, reason, durationSeconds, finalScore) {
    this.disconnects.push({
      player_id: playerId,
      reason,
      duration_connected_seconds: durationSeconds,
      final_score: finalScore,
      timestamp: Date.now()
    });
    if (this.disconnects.length > 100) {
      this.disconnects.shift();
    }
  }

  getMetrics() {
    if (this.disconnects.length === 0) {
      return { total_disconnects: 0, recent: [] };
    }
    const reasons = {};
    this.disconnects.forEach(d => {
      reasons[d.reason] = (reasons[d.reason] || 0) + 1;
    });
    return {
      total_disconnects: this.disconnects.length,
      disconnect_reasons: reasons,
      recent: this.disconnects.slice(-10)
    };
  }
}

class AlertingRules {
  constructor() {
    this.alerts = [];
    this.rules = {
      frame_time_p99_ms: { threshold: 20, triggered: false },
      heap_usage_mb: { threshold: 300, triggered: false },
      errors_per_minute: { threshold: 10, triggered: false },
      broadcast_failure_rate: { threshold: 5, triggered: false }
    };
    this.frameCount = 0;
    this.errorCount = 0;
    this.lastErrorCountReset = Date.now();
  }

  checkFrameTimeP99(p99Value) {
    const triggered = p99Value > this.rules.frame_time_p99_ms.threshold;
    if (triggered && !this.rules.frame_time_p99_ms.triggered) {
      this.recordAlert('frame_time_p99_exceeded', { p99_ms: p99Value, threshold_ms: this.rules.frame_time_p99_ms.threshold });
      this.rules.frame_time_p99_ms.triggered = true;
    } else if (!triggered && this.rules.frame_time_p99_ms.triggered) {
      this.rules.frame_time_p99_ms.triggered = false;
    }
  }

  checkHeapUsage(heapMB) {
    const triggered = heapMB > this.rules.heap_usage_mb.threshold;
    if (triggered && !this.rules.heap_usage_mb.triggered) {
      this.recordAlert('heap_usage_exceeded', { heap_mb: heapMB, threshold_mb: this.rules.heap_usage_mb.threshold });
      this.rules.heap_usage_mb.triggered = true;
    } else if (!triggered && this.rules.heap_usage_mb.triggered) {
      this.rules.heap_usage_mb.triggered = false;
    }
  }

  recordError() {
    this.errorCount++;
    const now = Date.now();
    if (now - this.lastErrorCountReset > 60000) {
      this.errorCount = 1;
      this.lastErrorCountReset = now;
    }
    if (this.errorCount > this.rules.errors_per_minute.threshold && !this.rules.errors_per_minute.triggered) {
      this.recordAlert('error_rate_exceeded', { errors_per_minute: this.errorCount, threshold: this.rules.errors_per_minute.threshold });
      this.rules.errors_per_minute.triggered = true;
    }
  }

  checkBroadcastFailureRate(failureRate) {
    const triggered = failureRate > this.rules.broadcast_failure_rate.threshold;
    if (triggered && !this.rules.broadcast_failure_rate.triggered) {
      this.recordAlert('broadcast_failure_rate_exceeded', { failure_rate: failureRate, threshold: this.rules.broadcast_failure_rate.threshold });
      this.rules.broadcast_failure_rate.triggered = true;
    } else if (!triggered && this.rules.broadcast_failure_rate.triggered) {
      this.rules.broadcast_failure_rate.triggered = false;
    }
  }

  recordAlert(alertType, context) {
    const alert = {
      type: alertType,
      timestamp: Date.now(),
      context
    };
    this.alerts.push(alert);
    console.error(JSON.stringify({ level: 'error', code: 'ALERT', alert }));
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
  }

  getMetrics() {
    return {
      total_alerts: this.alerts.length,
      recent_alerts: this.alerts.slice(-20),
      rules_status: {
        frame_time_p99: this.rules.frame_time_p99_ms.triggered,
        heap_usage: this.rules.heap_usage_mb.triggered,
        error_rate: this.rules.errors_per_minute.triggered,
        broadcast_failure_rate: this.rules.broadcast_failure_rate.triggered
      }
    };
  }
}

class SLODefinitions {
  constructor() {
    this.definitions = {
      uptime: { slo: 0.995, description: 'SLO: 99.5% uptime' },
      frame_time_p99: { slo: 20, unit: 'ms', description: 'SLO: frame_time_p99 < 20ms' },
      error_rate: { slo: 0.001, description: 'SLO: error_rate < 0.1%' }
    };
    this.startTime = Date.now();
    this.totalFrames = 0;
    this.downtime = 0;
  }

  recordFrame() {
    this.totalFrames++;
  }

  recordDowntime(durationMs) {
    this.downtime += durationMs;
  }

  getSLI() {
    const uptimeSeconds = (Date.now() - this.startTime - this.downtime) / 1000;
    const totalSeconds = (Date.now() - this.startTime) / 1000;
    const uptimeRatio = totalSeconds > 0 ? uptimeSeconds / totalSeconds : 1;
    return {
      slo_uptime: this.definitions.uptime.slo,
      sli_uptime: Math.round(uptimeRatio * 10000) / 10000,
      slo_frame_time_p99_ms: this.definitions.frame_time_p99.slo,
      slo_error_rate: this.definitions.error_rate.slo,
      uptime_seconds: Math.round(uptimeSeconds),
      total_frames: this.totalFrames
    };
  }
}

class PrometheusMetrics {
  constructor() {
    this.metrics = new Map();
  }

  recordGauge(name, value, labels = {}) {
    const key = `${name}${JSON.stringify(labels)}`;
    this.metrics.set(key, { type: 'gauge', name, value, labels });
  }

  recordCounter(name, value, labels = {}) {
    const key = `${name}${JSON.stringify(labels)}`;
    this.metrics.set(key, { type: 'counter', name, value, labels });
  }

  recordHistogram(name, value, labels = {}) {
    const key = `${name}${JSON.stringify(labels)}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, { type: 'histogram', name, values: [], labels });
    }
    const entry = this.metrics.get(key);
    entry.values.push(value);
    if (entry.values.length > 60) {
      entry.values.shift();
    }
  }

  export() {
    const lines = [];
    const gauges = new Map();
    const counters = new Map();
    const histograms = new Map();

    this.metrics.forEach(metric => {
      if (metric.type === 'gauge') {
        gauges.set(metric.name, metric);
      } else if (metric.type === 'counter') {
        counters.set(metric.name, metric);
      } else if (metric.type === 'histogram') {
        histograms.set(metric.name, metric);
      }
    });

    gauges.forEach((metric, name) => {
      const labelStr = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',');
      lines.push(`# HELP ${name} Game gauge metric`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${metric.value}`);
    });

    counters.forEach((metric, name) => {
      const labelStr = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',');
      lines.push(`# HELP ${name} Game counter metric`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${metric.value}`);
    });

    histograms.forEach((metric, name) => {
      const values = metric.values.sort((a, b) => a - b);
      const labelStr = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',');
      lines.push(`# HELP ${name} Game histogram metric`);
      lines.push(`# TYPE ${name} histogram`);
      if (values.length > 0) {
        [50, 95, 99].forEach(p => {
          const idx = Math.floor(values.length * p / 100);
          const val = values[Math.max(0, idx)];
          lines.push(`${name}_p${p}${labelStr ? `{${labelStr}}` : ''} ${val}`);
        });
      }
    });

    return lines.join('\n');
  }
}

module.exports = {
  StructuredLogger,
  FrameProfiler,
  MemoryMetrics,
  ActorLifecycleTracker,
  CollisionStats,
  NetworkMetrics,
  PlayerDisconnectTracker,
  AlertingRules,
  SLODefinitions,
  PrometheusMetrics
};
