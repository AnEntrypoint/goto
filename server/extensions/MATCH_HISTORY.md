# BUG #1882: Match History Framework

## Overview
Framework for storing, retrieving, and analyzing complete match records with detailed statistics and performance metrics.

## User Stories
- Players see history of recent games with results and stats
- Players can view detailed stats: damage, accuracy, survival time
- Match history searchable by date, opponent, stage
- Graphs show performance trends over time
- Match data exportable for analysis
- Coaches review match history for player improvement

## Technical Requirements
- **Match recording**: Capture all match metadata and events
- **Statistics calculation**: Compute derived metrics from raw events
- **Indexing**: Efficient queries by player, date, opponent
- **Retention**: Keep last 100 matches per player, archive older
- **Analytics**: Aggregated statistics across all players
- **Export**: CSV/JSON export for external tools
- **Privacy**: Players control visibility of match history

## Data Schema
```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) UNIQUE NOT NULL,
  stage INT NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  duration_ms INT NOT NULL,
  winner_id VARCHAR(256),
  created_at BIGINT NOT NULL
);

CREATE TABLE match_players (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  final_score INT NOT NULL,
  rank INT,
  kills INT DEFAULT 0,
  deaths INT DEFAULT 0,
  accuracy INT DEFAULT 0,
  survived_time_ms INT NOT NULL,
  gold_earned INT DEFAULT 0,
  UNIQUE(match_id, player_id),
  FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE TABLE match_statistics (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  stat_type VARCHAR(64) NOT NULL,
  value FLOAT NOT NULL,
  FOREIGN KEY(match_id) REFERENCES matches(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE match_events (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  frame INT NOT NULL,
  data JSON NOT NULL,
  FOREIGN KEY(match_id) REFERENCES matches(id)
);
```

## Recorded Statistics
- **Score**: Final score earned
- **Survival time**: Duration until death or completion
- **Accuracy**: % of jumps that succeeded
- **Efficiency**: Score per minute
- **Stage completion**: How far player progressed
- **Deaths**: Total deaths in match
- **Combos**: Longest combo of successful jumps
- **Time on platform**: Seconds spent on each platform

## API Surface
```javascript
class MatchHistoryService {
  // Retrieval
  getPlayerMatches(playerId, limit = 50, offset = 0) -> [matches]
  getMatch(matchId) -> { players, stages, duration, events }
  getHeadToHeadHistory(player1, player2) -> [matches]

  // Statistics
  getPlayerStats(playerId, timeRange = '30d') -> { wins, losses, avgScore, winRate }
  getTrendingStats(playerId, days = 30) -> [{ date, score, survival }]
  getEnemyStats(playerId, opponentId) -> { record, avgScore, winRate }

  // Searching
  searchMatches(playerId, criteria) -> [matches]
  getMatchesByStage(playerId, stage) -> [matches]
  getMatchesByDateRange(playerId, start, end) -> [matches]

  // Exporting
  exportMatches(playerId, format = 'csv') -> { downloadUrl }
  exportStatistics(playerId) -> { downloadUrl }

  // Analysis
  getWinConditions(playerId) -> { commonWinPatterns }
  getLossAnalysis(playerId) -> { commonDeathCauses }
  getPerformanceTrends(playerId) -> [{ week, avgScore, winRate }]

  // Privacy
  setHistoryPublic(playerId, isPublic) -> void
  blockHistoryView(playerId, blockedId) -> void
}
```

## Event Recording
```javascript
const MATCH_EVENTS = {
  'stage_load': { frame, stage, difficulty },
  'player_spawn': { frame, x, y },
  'platform_land': { frame, platformId },
  'take_damage': { frame, damage },
  'death': { frame, cause, x, y },
  'stage_complete': { frame, score, survival_time },
  'item_pickup': { frame, itemId },
  'combo_start': { frame },
  'combo_break': { frame, comboLength }
}
```

## Statistics Calculation
```javascript
const STATS_CALCULATION = {
  win_rate: (wins, losses) => wins / (wins + losses),
  avg_score: (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
  avg_survival: (durations) => durations.reduce((a, b) => a + b, 0) / durations.length,
  k_d_ratio: (kills, deaths) => deaths === 0 ? kills : kills / deaths,
  accuracy: (successfulJumps, totalJumps) => successfulJumps / totalJumps,
  efficiency: (score, survivalTime) => score / (survivalTime / 60000)
}
```

## Retention Policy
- **Live**: Current season matches always available
- **Archive**: Last 100 matches per player
- **Deletion**: Matches older than 1 year removed
- **Purge**: On-demand deletion of specific matches

## Integration Points
- **GameServer**: Report match completion
- **AnalyticsService**: Aggregate statistics
- **ProfileService**: Display recent matches on profile
- **CoachingService**: Review matches for improvement
- **ReplayService**: Link replays to matches

## Implementation Roadmap (Future)
1. Design match schema
2. Implement match recording
3. Build statistics calculation
4. Create retrieval queries
5. Implement search and filtering
6. Build export functionality
7. Create analytics dashboard

## Dependencies
- SQL database with efficient indexing
- Event processing pipeline
- Export library (CSV/JSON)
- Time-series analytics

## Risk Assessment
- **Storage explosion**: 100 matches × 50MB = 5GB per player
- **Privacy exposure**: Detailed stats reveal playing patterns
- **Cheating detection**: History shows suspicious patterns that enable cheating
- **Performance regression**: Too many matches slow queries

## Alternatives Considered
- **Summary only**: Store aggregate stats, discard raw data (less detail)
- **Event streaming**: Real-time event processing instead of batch (more infra)
- **Third-party analytics**: Outsource to external service (vendor lock-in)
