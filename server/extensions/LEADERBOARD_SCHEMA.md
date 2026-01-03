# BUG #1862: Leaderboard Persistence Framework

## Overview
Framework for storing, retrieving, and ranking player scores across time periods (all-time, monthly, weekly).

## User Stories
- Players can view global top 100 scores
- Players see their rank and percentile within top 1000
- Leaderboard updates within 1 minute of game end
- Different leaderboards per stage and game mode

## Technical Requirements
- **Data persistence**: Store player scores with timestamp and metadata
- **Ranking calculation**: Efficient rank queries without full table scan
- **Time-windowed rankings**: All-time, monthly, weekly leaderboards
- **Player identification**: Link scores to player account/ID
- **Metadata tracking**: Time played, difficulty, game mode
- **Privacy controls**: Optionally hide player from global rankings

## Database Schema

### Leaderboard Entry
```sql
CREATE TABLE leaderboard_entries (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  game_mode VARCHAR(32) NOT NULL,
  score INT NOT NULL,
  time_ms INT NOT NULL,
  difficulty VARCHAR(16) NOT NULL,
  timestamp BIGINT NOT NULL,
  season INT NOT NULL,
  week INT NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  verification_hash VARCHAR(256),
  UNIQUE(player_id, stage, game_mode, timestamp)
);

CREATE INDEX idx_score_desc ON leaderboard_entries(stage, game_mode, score DESC);
CREATE INDEX idx_timestamp ON leaderboard_entries(timestamp);
CREATE INDEX idx_player ON leaderboard_entries(player_id);
```

### Player Ranking Cache
```sql
CREATE TABLE leaderboard_rankings (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  game_mode VARCHAR(32) NOT NULL,
  rank INT NOT NULL,
  percentile FLOAT NOT NULL,
  time_period VARCHAR(16) NOT NULL,
  cached_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE(player_id, stage, game_mode, time_period)
);

CREATE INDEX idx_rank ON leaderboard_rankings(rank);
CREATE INDEX idx_expires ON leaderboard_rankings(expires_at);
```

## API Surface
```javascript
class LeaderboardService {
  // Submit score from completed game
  submitScore(playerId, stage, gameMode, score, timeMs, difficulty) -> { rank, percentile }

  // Get top N scores for stage/mode
  getTopScores(stage, gameMode, limit = 100, timePeriod = 'all-time') -> [{ rank, player_id, score, timestamp }]

  // Get player's rank
  getPlayerRank(playerId, stage, gameMode, timePeriod = 'all-time') -> { rank, percentile, score }

  // Get scores around player
  getScoresAround(playerId, stage, gameMode, range = 10, timePeriod = 'all-time') -> [scores]

  // Get all-time rank across all stages
  getOverallRank(playerId) -> { overall_rank, total_score }

  // Get seasonal leaderboard
  getSeasonalLeaderboard(season, stage, gameMode, limit = 100) -> [scores]

  // Get weekly reset info
  getWeeklyResetTime() -> timestamp

  // Verify score legitimacy
  verifyScore(playerId, stage, gameMode, score) -> boolean

  // Hide/unhide from rankings
  setPrivacy(playerId, isHidden) {}

  // Get leaderboard statistics
  getLeaderboardStats(stage, gameMode) -> { count, avgScore, medianScore, maxScore }
}
```

## Time Windows
- **All-time**: Infinite lookback
- **Seasonal**: Reset at start of calendar quarter (Jan 1, Apr 1, Jul 1, Oct 1)
- **Monthly**: Reset 1st of each month
- **Weekly**: Reset every Monday at 00:00 UTC

## Score Verification
- **Replay hash**: Store hash of input sequence, recreate game and verify output
- **Metadata validation**: Ensure stage/mode/difficulty match recorded values
- **Timestamp validation**: Reject scores from impossible game durations (< 30s or > 30 min)
- **Abuse detection**: Flag scores from repeated rapid submissions

## Integration Points
- **GameServer**: Call submitScore() on game end
- **ClientUI**: Display rank on score screen
- **AuthService**: Link scores to verified player accounts
- **NotificationService**: Notify on rank milestone (top 10, top 100)

## Implementation Roadmap (Future)
1. Design and implement database schema
2. Build LeaderboardService class
3. Add score submission endpoint
4. Implement caching layer for read queries
5. Add verification pipeline
6. Build UI components for leaderboards
7. Add seasonal mechanics

## Dependencies
- SQL database (PostgreSQL preferred)
- Player authentication system
- Game completion tracking

## Risk Assessment
- **Cheating**: False high scores without verification devalue leaderboard
- **Gaming the system**: Players repeatedly submitting until high score inflates ranking
- **Database load**: Top leaderboards queried frequently, needs aggressive caching
- **Privacy concerns**: Public rankings reveal player activity patterns

## Alternatives Considered
- **In-memory leaderboards**: Fast but lost on server restart, no persistence
- **Eventual consistency**: Eventual updates OK but requires async processing
- **Blockchain**: Immutable scores but adds latency and complexity
