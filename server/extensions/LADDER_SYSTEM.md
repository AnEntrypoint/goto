# BUG #1874: Ladder System Framework

## Overview
Framework for persistent ranking ladders where players climb divisions through wins, with seasonal resets and promotion/demotion.

## User Stories
- Players start at Bronze V, climb to Grandmaster
- Winning games earns LP (ladder points)
- 100 LP promotes to next division
- Losing at 0 LP demotes to previous division
- Season resets every 3 months, LP resets but rank preserved
- Players see division distribution (10% in each division)

## Technical Requirements
- **Division system**: Discrete ranks with clear progression
- **LP system**: Points within division for granular ranking
- **Promotion series**: Best-of-3 to advance to next division
- **Decay prevention**: Inactivity LP degrades slowly (1%/month)
- **Rank symmetry**: Equal-skill games worth equal LP
- **Seasonal mechanics**: Reset that preserves ladder prestige
- **Placement matches**: New players placed based on 10 matches

## Data Schema
```sql
CREATE TABLE ladder_ranks (
  player_id VARCHAR(256) PRIMARY KEY,
  season INT NOT NULL,
  division INT NOT NULL,
  tier VARCHAR(16) NOT NULL,
  lp INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  promotion_progress INT NOT NULL DEFAULT 0,
  last_played BIGINT NOT NULL,
  is_in_promo BOOLEAN DEFAULT false,
  UNIQUE(player_id, season),
  CHECK(division >= 1 AND division <= 4),
  CHECK(tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'))
);

CREATE TABLE ladder_season (
  season INT PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  reset_at BIGINT NOT NULL,
  reward_pool INT NOT NULL
);

CREATE TABLE promotion_series (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  season INT NOT NULL,
  from_division INT NOT NULL,
  to_division INT NOT NULL,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  UNIQUE(player_id, season, from_division)
);
```

## Tier and Division Structure
```
Grandmaster  (0.1% of players)
Master       (1% of players)
  Diamond    (3%)
  Platinum   (8%)
  Gold       (24%)
  Silver     (32%)
  Bronze     (32%)
```

## LP Gain/Loss Formula
```
Base LP: 17 (adjust so 100 LP needed to advance)
Bonus: +3 per skill advantage (if opponent is higher rated)
Penalty: -3 per skill disadvantage (if opponent is lower rated)
Streaks: +1 per win streak, -1 per loss streak

Example: Win vs equal opponent = 17 LP
Example: Win vs lower opponent = 14 LP
Example: Lose vs higher opponent = 17 LP (reduced loss)
```

## Seasonal Rewards
- **Climbing reward**: Season cosmetic based on peak rank
- **End-of-season**: Cosmetic for final rank
- **Prestige**: Star border increases with seasons spent at rank
- **Honor progression**: Bonuses for low-toxicity games

## API Surface
```javascript
class LadderService {
  // Rank queries
  getPlayerRank(playerId, season = null) -> { tier, division, lp, wins, losses }
  getLeaderboard(season = null, limit = 100) -> [{ rank, playerId, tier, division, lp }]
  getRankDistribution(season = null) -> { bronze: 32%, silver: 32%, ... }

  // Season management
  getCurrentSeason() -> { season, name, daysRemaining }
  getSeasonRanks(playerId) -> [{ season, tier, division, peakRank }]

  // Promotion series
  checkPromotion(playerId) -> { inPromo, wins, losses, target }
  completePromoSeries(playerId) -> { success, newRank }

  // LP transactions
  awardLP(playerId, lp, reason) -> void
  deductLP(playerId, lp, reason) -> void
  getRecentGames(playerId, limit = 20) -> [{ opponent, result, lpGain }]

  // Season reset
  startNewSeason(name) -> void
  resetAllPlayers() -> void
  claimSeasonRewards(playerId) -> [{ cosmetic, tier }]

  // Statistics
  getWinRate(playerId, season = null, division = null) -> percentage
  getAverageLP(division) -> number
  getMobilityStats(season) -> { promotions, demotions, avgLP }
}
```

## Promotion Series Details
- **Threshold**: When LP ≥ 100, best-of-3 series triggered
- **Match weight**: Each series game worth double LP
- **Demotion shield**: Can't demote while in promotion series
- **Loss cascades**: 2 losses ends series, resets LP to 0

## LP Decay
- **Decay rate**: 1% per month of inactivity
- **Threshold**: Only triggers for players in Platinum+
- **Decay cap**: Never decays below 75 LP
- **Reset on play**: One game resets decay timer

## Placement Matches
- **New player**: 10 placement matches to determine starting rank
- **Placement logic**: Win prediction based on server-side rating
- **Result**: Placed in division based on 10-game performance
- **New account protection**: 30 games before ranked eligibility

## Integration Points
- **GameServer**: Report match results for LP updates
- **RatingService**: Underlying skill rating feeds LP system
- **RewardService**: Grant seasonal cosmetics
- **NotificationService**: Alert on promotion/demotion
- **AnalyticsService**: Track ladder engagement

## Implementation Roadmap (Future)
1. Design ladder database schema
2. Implement tier progression
3. Build LP calculation
4. Create promotion series
5. Implement seasonal reset
6. Add leaderboard UI
7. Build rank distribution display

## Dependencies
- SQL database
- Rating system (matchmaking)
- Reward service
- Notification system

## Risk Assessment
- **LP inflation**: Players farm low-ranked opponents, devalue high ranks
- **Win trading**: Coordination between players to game ranking
- **Smurf smashing**: High-rated players create new accounts to stomp
- **Rank decay**: Inactive players' ranks become stale, reduce leaderboard quality
- **Boosting**: High-rated players pay to play on low-rated accounts

## Alternatives Considered
- **Rating-only**: No visual tiers, just Elo rating (less engaging)
- **Points instead of divisions**: Single metric (less prestige)
- **Seasons too short**: 1-month seasons cause constant resets (burnout)
