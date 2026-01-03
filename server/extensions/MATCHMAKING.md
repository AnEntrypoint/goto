# BUG #1865: Matchmaking Framework

## Overview
Framework for pairing players of similar skill for competitive multiplayer games with ranking-based matching.

## User Stories
- Players join ranked queue and are matched with equal-skill opponents
- Matchmaking completes within 30 seconds for most players
- New players (no rank) matched against other new players
- Skill degradation over time without active play
- Rating adjustments based on match outcome and opponent strength

## Technical Requirements
- **Player rating system**: Elo-style rating for skill measurement (starts at 1200)
- **Queue management**: Track waiting players, match when criteria met
- **Skill bands**: Discrete rating buckets to simplify matching
- **Uncertainty decay**: Higher uncertainty for inactive players
- **Match fairness**: Avoid matching 1200 rating player vs 2000 rating player
- **Rematch prevention**: Don't rematch same players within 24 hours
- **Queue timeout**: Clear queue after 5 minutes of waiting

## Data Schema
```sql
CREATE TABLE player_ratings (
  player_id VARCHAR(256) PRIMARY KEY,
  rating INT NOT NULL DEFAULT 1200,
  uncertainty INT NOT NULL DEFAULT 350,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE matchmaking_queue (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  rating INT NOT NULL,
  uncertainty INT NOT NULL,
  queued_at BIGINT NOT NULL,
  timeout_at BIGINT NOT NULL,
  UNIQUE(player_id)
);

CREATE TABLE match_history (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  player1_id VARCHAR(256) NOT NULL,
  player2_id VARCHAR(256) NOT NULL,
  player1_rating_before INT NOT NULL,
  player2_rating_before INT NOT NULL,
  player1_rating_after INT NOT NULL,
  player2_rating_after INT NOT NULL,
  winner_id VARCHAR(256) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(player1_id, player2_id, created_at)
);

CREATE TABLE rematch_cooldown (
  id UUID PRIMARY KEY,
  player1_id VARCHAR(256) NOT NULL,
  player2_id VARCHAR(256) NOT NULL,
  cooldown_until BIGINT NOT NULL,
  UNIQUE(player1_id, player2_id),
  CHECK(player1_id < player2_id)
);
```

## Matchmaking Algorithm
1. Player joins queue → sorted into rating band (±200 points)
2. Every 2 seconds, attempt to match pairs from same band
3. If no match in 10 seconds, expand search band (±300)
4. If no match in 20 seconds, expand to ±400
5. Match when both players found → remove from queue
6. Timeout after 30 seconds → suggest queue again later
7. On match end → recalculate ratings using Elo formula

## Elo Rating Formula
```
K = 32 (base)
expectedScore = 1 / (1 + 10^((opponentRating - playerRating) / 400))
ratingChange = K * (actualScore - expectedScore)
newRating = max(0, oldRating + ratingChange)
```

## Skill Bands
- **Bronze**: 0-1400 rating
- **Silver**: 1400-1600 rating
- **Gold**: 1600-1800 rating
- **Platinum**: 1800-2000 rating
- **Diamond**: 2000+ rating

## API Surface
```javascript
class MatchmakingService {
  // Queue management
  joinQueue(playerId) -> { position, estimatedWaitMs }
  leaveQueue(playerId) -> void
  getQueueStatus(playerId) -> { inQueue, position, waitTime }

  // Rating system
  getPlayerRating(playerId) -> { rating, uncertainty, wins, losses, skillBand }
  getRatingHistory(playerId, days = 30) -> [{ rating, timestamp }]

  // Match operations
  completeMatch(gameId, winnerId, loserId) -> { ratingChanges }
  getMatchHistory(playerId, limit = 20) -> [{ opponent, result, ratingChange, timestamp }]

  // Statistics
  getLeaderboard(skillBand = null, limit = 100) -> [{ rank, playerId, rating }]
  getMatchmakingStats() -> { avgWaitTime, matchRate, playerCount }

  // Admin operations
  recalculateRating(playerId, matches) -> void
  resetRating(playerId) -> void
}
```

## Match Fairness Metrics
- **Expected skill delta**: |rating1 - rating2| ≤ 300 (within 1.5 skill bands)
- **Win probability**: ~50% for evenly matched opponents
- **Rematch prevention**: Cooldown 24h after match with same player

## Integration Points
- **GameServer**: Notify on game completion
- **RatingService**: Store rating changes
- **QueueService**: Real-time queue management
- **NotificationService**: Notify of match found

## Implementation Roadmap (Future)
1. Design rating system database
2. Implement queue management
3. Build matchmaking algorithm
4. Create Elo calculator
5. Add skill band classification
6. Implement rating decay for inactivity
7. Build ranking UI

## Dependencies
- SQL database
- Real-time queue management
- Game completion tracking
- Player rating persistence

## Risk Assessment
- **Smurf accounts**: High-skill players create new accounts to stomp new players
- **Rating inflation**: Win farming against lower-rated opponents
- **Queue starvation**: Niche skill bands have 0 players waiting
- **Boosting**: High-rated players play on low-rated accounts for money

## Alternatives Considered
- **TrueSkill algorithm**: More sophisticated, harder to implement
- **Glicko-2**: Accounts for rating volatility, more complex
- **Simple hand-waving**: Match random players, breaks matchmaking promise
