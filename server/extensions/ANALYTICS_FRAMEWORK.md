# BUG #1866: Analytics Framework

## Overview
Framework for tracking user behavior, game metrics, and business analytics without compromising privacy.

## User Stories
- Product team understands which features are used
- Engineers debug issues using user session data
- Monetization team tracks conversion funnels
- Designers measure feature adoption rates
- Operations team alerts on anomalies

## Technical Requirements
- **Event logging**: Record discrete player actions with timestamps
- **Session tracking**: Group events into logical sessions
- **Privacy by design**: No PII stored, all data anonymized
- **Real-time streaming**: Events available within 10 seconds
- **Aggregation**: Roll up events into metrics
- **Retention**: Store raw events 30 days, aggregates 1 year
- **Compliance**: GDPR/CCPA compliant data handling

## Data Schema
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  properties JSON NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_type ON events(event_type, timestamp);
CREATE INDEX idx_session ON events(session_id);
CREATE INDEX idx_timestamp ON events(timestamp);

CREATE TABLE sessions (
  id VARCHAR(64) PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  duration_ms INT,
  event_count INT DEFAULT 0,
  device VARCHAR(64),
  region VARCHAR(64)
);

CREATE TABLE aggregated_metrics (
  id UUID PRIMARY KEY,
  metric_name VARCHAR(256) NOT NULL,
  dimension_1 VARCHAR(128),
  dimension_2 VARCHAR(128),
  value FLOAT NOT NULL,
  timestamp BIGINT NOT NULL,
  UNIQUE(metric_name, dimension_1, dimension_2, timestamp)
);
```

## Event Types
- **session_start**: Player launches game
- **session_end**: Player closes game
- **stage_start**: Player begins stage
- **stage_complete**: Player finishes stage
- **stage_fail**: Player dies on stage
- **score_posted**: Player posts score to leaderboard
- **achievement_unlock**: Player unlocks achievement
- **feature_view**: Player views UI feature
- **purchase_attempt**: Player initiates purchase
- **purchase_complete**: Player completes purchase
- **error_occurred**: Game error caught

## Event Properties
```javascript
{
  "event_type": "stage_complete",
  "properties": {
    "stage": 1,
    "score": 50000,
    "time_ms": 120000,
    "difficulty": "normal",
    "device_type": "desktop",
    "region": "US",
    "platform": "web",
    "version": "1.2.3"
  }
}
```

## Key Metrics
- **DAU**: Daily active users (unique session_starts)
- **Session duration**: Average time in game
- **Stage completion rate**: % of players reaching stage end
- **Score distribution**: Percentiles of score ranges
- **Feature adoption**: % of users who interact with feature
- **Conversion funnel**: % of users at each monetization step
- **Retention**: % of players active on day N after install

## API Surface
```javascript
class AnalyticsService {
  // Event recording
  recordEvent(sessionId, playerId, eventType, properties) -> void
  startSession(playerId, deviceType) -> { sessionId }
  endSession(sessionId) -> { duration, eventCount }

  // Query interface
  getEventsByType(eventType, timeRange) -> [events]
  getSessionMetrics(timeRange) -> { dau, sessionDuration, devices }
  getFeatureMetrics(featureName, timeRange) -> { adoption, engagement, retention }
  getConversionFunnel(timeRange) -> [{ step, count, conversionRate }]

  // Aggregation
  aggregateMetrics(metricName, dimensions, timeRange) -> [{ dimensions, value }]
  getDailyMetrics(metricName, days = 30) -> [{ date, value }]

  // Retention
  getRetention(cohort, days) -> [{ day, activePercent }]

  // Privacy
  deletePlayerData(playerId) -> void
  anonymizeOldEvents(olderThanDays) -> void
}
```

## Privacy Compliance
- **PII exclusion**: No names, emails, IPs in events
- **Anonymization**: Hash player IDs, store separately
- **Retention limits**: Delete raw events after 30 days
- **User right to deletion**: GDPR data export and deletion
- **Minimal tracking**: Only necessary business metrics
- **Consent**: Track with explicit user permission

## Integration Points
- **GameServer**: Call recordEvent() for all player actions
- **SessionManager**: Start/end sessions on login/logout
- **ErrorHandler**: Log all exceptions to analytics
- **NotificationService**: Track notification engagement
- **PurchaseService**: Track monetization funnel

## Implementation Roadmap (Future)
1. Design analytics data warehouse
2. Build event recording pipeline
3. Implement session management
4. Create metric aggregation jobs
5. Build analytics dashboard
6. Add GDPR compliance features
7. Implement retention cohorts

## Dependencies
- Analytics database (BigQuery or similar)
- Real-time event streaming
- Data warehousing solution
- Privacy compliance tools

## Risk Assessment
- **Privacy breaches**: Unintended PII leakage in events
- **Spam events**: Buggy code floods analytics with noise
- **Cost explosion**: Uncapped event volume increases infrastructure cost
- **Stalking**: Activity patterns enable player tracking

## Alternatives Considered
- **Third-party analytics**: Outsource to Amplitude/Mixpanel (privacy concerns)
- **Sampling**: Only log 10% of events (loses accuracy)
- **Batch aggregation**: Only log aggregated daily metrics (no drill-down)
