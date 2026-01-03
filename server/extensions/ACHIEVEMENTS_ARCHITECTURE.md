# BUG #1863: Achievement System Framework

## Overview
Framework for defining, tracking, and rewarding player accomplishments beyond basic score achievement.

## User Stories
- Players earn achievements for milestones (complete stage 4, beat game 100 times)
- Achievements have tiers (bronze/silver/gold) based on difficulty
- Players see achievement progress and unlock notifications
- Achievements grant cosmetic rewards and bragging rights
- Achievement stats visible on player profile

## Technical Requirements
- **Achievement definition**: Registry of all possible achievements with conditions
- **Progress tracking**: Store player progress toward each achievement
- **Unlock detection**: Trigger on specific game events (stage completion, score threshold)
- **Notification system**: Alert player when achievement unlocked
- **Statistics**: Track unlock rate, time to unlock per achievement
- **Rarity calculation**: Compute achievement rarity based on % of players who earned it

## Data Schema
```sql
CREATE TABLE achievements (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(32) NOT NULL,
  tier VARCHAR(16) NOT NULL,
  unlock_condition JSON NOT NULL,
  icon_id VARCHAR(64) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  UNIQUE(name)
);

CREATE TABLE player_achievements (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  achievement_id VARCHAR(64) NOT NULL,
  unlock_time BIGINT,
  is_unlocked BOOLEAN DEFAULT false,
  progress FLOAT DEFAULT 0,
  created_at BIGINT NOT NULL,
  UNIQUE(player_id, achievement_id),
  FOREIGN KEY(achievement_id) REFERENCES achievements(id)
);

CREATE TABLE achievement_statistics (
  id UUID PRIMARY KEY,
  achievement_id VARCHAR(64) NOT NULL,
  total_unlocks INT DEFAULT 0,
  unlock_rate FLOAT DEFAULT 0,
  avg_time_to_unlock_ms INT DEFAULT 0,
  last_updated BIGINT NOT NULL,
  FOREIGN KEY(achievement_id) REFERENCES achievements(id)
);
```

## Achievement Categories
- **Skill-based**: Complete stage X, beat game without dying
- **Grind-based**: Play 100 games, accumulate 1M points
- **Challenge-based**: Beat stage 4 in under 60 seconds
- **Exploration-based**: Find all secret areas
- **Social-based**: Play with 5 different players (future)
- **Event-based**: Participate in seasonal events (future)

## API Surface
```javascript
class AchievementService {
  // Get all possible achievements
  getAllAchievements() -> [{ id, name, description, tier }]

  // Get player's achievement progress
  getPlayerAchievements(playerId) -> { unlocked: [], locked: [], progress: {} }

  // Check if achievement should unlock
  checkAchievementConditions(playerId, event: { type, value }) -> [achievementIds]

  // Unlock achievement
  unlockAchievement(playerId, achievementId) -> { newPoints, notificationData }

  // Get achievement statistics
  getAchievementStats(achievementId) -> { unlockRate, rarity, avgTimeMs }

  // Get player's total achievement points
  getPlayerPoints(playerId) -> number

  // Get achievement progress
  getProgress(playerId, achievementId) -> { current, target, percentage }
}
```

## Unlock Conditions Schema
```javascript
{
  "type": "composite|single",
  "conditions": [
    { "type": "stage_complete", "stage": 1 },
    { "type": "score_threshold", "score": 100000 },
    { "type": "no_deaths", "stage": 3 },
    { "type": "time_limit", "stage": 2, "timeMs": 60000 },
    { "type": "game_count", "count": 100 },
    { "type": "total_score", "score": 5000000 }
  ]
}
```

## Integration Points
- **GameServer**: Report game events (stage complete, score earned, death)
- **PlayerProfile**: Display earned achievements
- **NotificationService**: Send unlock notifications
- **RewardService**: Grant cosmetics for rare achievements

## Implementation Roadmap (Future)
1. Design achievement registry
2. Implement progress tracking database
3. Build unlock detection logic
4. Add notification system
5. Implement rarity calculations
6. Create profile display UI
7. Add seasonal achievements

## Dependencies
- SQL database
- Player account system
- Game event tracking
- Notification service

## Risk Assessment
- **Grinding incentivizes cheating**: Easy-to-farm achievements enable script bots
- **Feedback loops**: Popular achievements inflate unlock rate, new players feel left behind
- **Balance**: Overly hard achievements have 0% unlock rate, waste of design
- **Leaderboard gaming**: Players optimize for achievement points over fun gameplay

## Alternatives Considered
- **Badge system**: Less granular, no progress tracking
- **Reputation points**: Generic, harder to explain individual rewards
- **Badges tied to cosmetics**: Combines cosmetics/achievements into one system
