# BUG #1896: Observability Improvements Framework

## Overview
Framework for advancing observability with distributed tracing, better metrics, and dynamic alerting that goes beyond basic logging.

## User Stories
- Engineers trace request from client through 10 services to database
- Anomalies automatically detected without manual thresholds
- Service dependency map visualized
- Slow queries identified and optimized
- Error analysis shows root cause of failures
- Metrics correlated with code changes

## Technical Requirements
- **Distributed tracing**: Track requests across services
- **Correlation IDs**: Link logs from same request
- **Metrics cardinality**: Handle high-dimensional metrics
- **Anomaly detection**: Automatically detect deviations
- **Dependency mapping**: Show service interactions
- **Profiling**: CPU, memory, allocation profiling
- **Dynamic alerting**: Auto-threshold based on baselines

## Data Schema
```sql
CREATE TABLE traces (
  trace_id VARCHAR(32) PRIMARY KEY,
  span_id VARCHAR(32),
  parent_span_id VARCHAR(32),
  service_name VARCHAR(64),
  operation_name VARCHAR(256),
  start_time BIGINT NOT NULL,
  duration_ms INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  metadata JSON
);

CREATE TABLE metrics (
  id UUID PRIMARY KEY,
  metric_name VARCHAR(256) NOT NULL,
  metric_type VARCHAR(16) NOT NULL,
  value FLOAT NOT NULL,
  timestamp BIGINT NOT NULL,
  tags JSON NOT NULL,
  INDEX idx_metric_timestamp (metric_name, timestamp)
);

CREATE TABLE service_dependencies (
  source_service VARCHAR(64),
  target_service VARCHAR(64),
  call_count INT DEFAULT 0,
  error_count INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,
  PRIMARY KEY(source_service, target_service)
);

CREATE TABLE anomalies (
  id UUID PRIMARY KEY,
  metric_name VARCHAR(256) NOT NULL,
  detected_at BIGINT NOT NULL,
  value FLOAT NOT NULL,
  baseline FLOAT NOT NULL,
  deviation_percent FLOAT NOT NULL,
  UNIQUE(metric_name, detected_at)
);
```

## API Surface
```javascript
class ObservabilityService {
  // Tracing
  startTrace(traceId, serviceName, operationName) -> spanId
  endTrace(spanId, status, metadata) -> void
  getTrace(traceId) -> { spans, timeline, serviceFlow }

  // Metrics
  recordMetric(metricName, value, tags) -> void
  queryMetrics(metricName, timeRange, aggregation) -> [{ timestamp, value }]
  getMetricStats(metricName, timeRange) -> { min, max, avg, p50, p95, p99 }

  // Anomaly detection
  getAnomalies(timeRange = '1h') -> [anomalies]
  getAnomalyDetails(anomalyId) -> { metric, baseline, value, likely_cause }
  acknowledgeAnomaly(anomalyId, note) -> void

  // Profiling
  startProfiler(serviceName, duration = 60) -> { profileId }
  getProfile(profileId) -> { cpuFlame, memoryProfile, allocations }

  // Service dependencies
  getServiceDependencies() -> graph
  getServiceHealth(serviceName) -> { status, latency, errorRate }
  getLatencySla(serviceName) -> { target, actual, compliance }

  // Correlation
  getCorrelatedEvents(traceId) -> [{ service, logs, errors }]
  correlateProblem(metricName, problemType) -> { likelyService }

  // Alerting
  createDynamicAlert(metricName, condition) -> { alertId }
  getAlertHistory(alertId) -> [{ triggered, value, timestamp }]
}
```

## Tracing Example
```
User request arrives:
  trace_id: 123abc, span_id: span1
  service: api-gateway, operation: /games/join

  → calls game-service (span2)
    service: game-service, operation: createGame

    → calls matchmaking (span3)
      service: matchmaking, operation: findOpponent

      → calls rating-service (span4)
        service: rating-service, operation: getPlayerRating

      → calls database (span5)
        service: postgres, operation: SELECT FROM players
        duration: 20ms

    → returns opponent_id

  → calls notification (span6)
    service: notification, operation: sendAlert

  Response: 350ms total
  service-breakdown: api(50ms), game(200ms), match(80ms), notify(20ms)
```

## Anomaly Detection Algorithms
```javascript
const ANOMALY_DETECTION = {
  statistical_baseline: {
    method: '3-sigma rule',
    baseline: mean,
    threshold: mean + 3 * stdev,
    min_samples: 100
  },
  seasonal_decomposition: {
    method: 'STL decomposition',
    season_length: 1440,  // 24 hours in minutes
    threshold: baseline + seasonal_component + 2*stdev(residuals)
  },
  change_point_detection: {
    method: 'PELT algorithm',
    min_segment: 10,
    penalty: 'aic'
  }
}
```

## Key Metrics to Track
- Request latency (p50, p95, p99)
- Error rate by service and code path
- Database query latency
- Cache hit rate
- Network latency (inbound, outbound)
- Memory usage and GC pause time
- CPU utilization and thread count
- Active connections and connection pool usage

## Dynamic Alerting
```javascript
const DYNAMIC_ALERTS = {
  'api_latency_surge': {
    metric: 'api.request.duration_ms',
    condition: 'value > baseline * 1.5',
    duration: '5 minutes',
    severity: 'warning'
  },
  'error_spike': {
    metric: 'errors.count',
    condition: 'value > moving_average(24h) * 2',
    duration: '2 minutes',
    severity: 'critical'
  },
  'database_slow': {
    metric: 'db.query.duration_ms',
    condition: 'p99 > 1000',
    duration: '10 minutes',
    severity: 'warning'
  }
}
```

## Service Dependency Map
```
┌─────────────┐
│  Client     │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│ API Gateway ├────►│ Game Service │
└─────┬───────┘     └──────┬───────┘
      │                    │
      │            ┌───────┴───────┐
      │            ▼               ▼
      │     ┌─────────────┐ ┌────────────────┐
      │     │ Matchmaking │ │ Rating Service │
      │     └─────────────┘ └────────────────┘
      │            │               │
      │            └───────┬───────┘
      │                    ▼
      │            ┌──────────────┐
      └───────────►│  PostgreSQL  │
                   └──────────────┘
```

## Integration Points
- **APM Tool**: OpenTelemetry, Datadog, New Relic
- **MetricsBackend**: Prometheus, InfluxDB, Elasticsearch
- **LogStorage**: ELK stack, Loki, CloudWatch
- **AlertingService**: PagerDuty, Opsgenie integration
- **Dashboard**: Grafana for visualization

## Implementation Roadmap (Future)
1. Implement distributed tracing
2. Set up metrics collection
3. Build anomaly detection
4. Create service dependency mapping
5. Implement profiling integration
6. Add dynamic alerting
7. Build observability dashboard

## Dependencies
- OpenTelemetry or similar instrumentation library
- Metrics backend (Prometheus)
- Tracing backend (Jaeger, Zipkin)
- Anomaly detection library (prophet, statsmodels)

## Risk Assessment
- **Alert fatigue**: Too many false alarms lower response rate
- **Blind spots**: Metrics don't correlate with actual problems
- **Performance overhead**: Tracing every request slows system
- **Data explosion**: Unbounded cardinality metrics consume storage
- **Alert thundering**: Multiple services alert simultaneously

## Alternatives Considered
- **Manual monitoring**: Cheaper but slower detection
- **Sampling traces**: Reduces cost but misses rare issues
- **Static alerts**: Simpler but inflexible
