# BUG #1877: Challenges System Framework

## Overview
Framework for daily, weekly, and seasonal challenges that drive engagement with specific rewards.

## User Stories
- Players see new daily challenge each morning
- Weekly challenges offer higher rewards
- Challenges track progress with visual bars
- Completing challenges grants XP, currency, cosmetics
- Players can claim rewards without opening game (challenge passes)
- Challenge boards show community progress

## Technical Requirements
- **Challenge definitions**: Specifications with conditions and rewards
- **Progress tracking**: Track player advancement toward completion
- **Reward system**: Multiple reward tiers for partial completion
- **Scheduling**: Automatic daily/weekly resets
- **Claiming**: Asynchronous reward claiming (no login needed)
- **Statistics**: Track challenge completion rates
- **Difficulty balancing**: Ensure 70% completion rate

## Data Schema
```sql
CREATE TABLE challenges (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  challenge_type VARCHAR(16) NOT NULL,
  difficulty VARCHAR(16) NOT NULL,
  condition JSON NOT NULL,
  target_value INT NOT NULL,
  rewards JSON NOT NULL,
  duration VARCHAR(16) NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK(challenge_type IN ('daily', 'weekly', 'seasonal', 'event')),
  CHECK(difficulty IN ('easy', 'medium', 'hard'))
);

CREATE TABLE player_challenges (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  challenge_id VARCHAR(64) NOT NULL,
  period INT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  claimed BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  claimed_at BIGINT,
  UNIQUE(player_id, challenge_id, period),
  FOREIGN KEY(challenge_id) REFERENCES challenges(id)
);
```

## Challenge Types

### Daily (Reset 00:00 UTC)
- **Completion target**: 5-10 minutes of gameplay
- **Reward**: 100-500 currency
- **Count**: 3 concurrent daily challenges
- **Streak bonus**: +50 currency per consecutive day

### Weekly (Reset Monday 00:00)
- **Completion target**: 20-30 minutes gameplay
- **Reward**: 1000-2000 currency
- **Count**: 3 concurrent weekly challenges
- **Difficulty scaling**: Easy/medium/hard

### Seasonal (Entire season)
- **Completion target**: 5-10 hours total
- **Reward**: Exclusive cosmetic
- **Count**: 5 seasonal challenges
- **Milestone cosmetics**: Cosmetic at 1, 3, 5 completions

## API Surface
```javascript
class ChallengesService {
  // Current challenges
  getActiveChallenges(playerId, type = null) -> [challenges]
  getChallengeProgress(playerId, challengeId) -> { completed, progress, target }

  // Progress tracking
  updateProgress(playerId, challengeId, increment) -> void
  completeChallenge(playerId, challengeId) -> { reward }

  // Claiming
  getClaimableRewards(playerId) -> [{ challengeId, reward }]
  claimReward(playerId, challengeId) -> { reward }

  // Statistics
  getCompletionRate(challengeId) -> percentage
  getPlayerStats(playerId) -> { totalCompleted, currentStreak, thisWeek }
  getChallengeBoard() -> [{ rank, player, completions, streak }]

  // Management
  createChallenge(definition) -> { challengeId }
  rotateDaily() -> [newChallenges]
  rotateWeekly() -> [newChallenges]
}
```

## Challenge Examples
```javascript
{
  id: 'daily_1',
  name: 'Stage Ascent',
  description: 'Complete stage 2 three times',
  condition: { type: 'stage_complete', stage: 2, count: 3 },
  target_value: 3,
  rewards: [
    { type: 'currency', amount: 200 },
    { type: 'xp', amount: 500 }
  ],
  difficulty: 'easy'
}

{
  id: 'weekly_3',
  name: 'Speedrunner',
  description: 'Complete any stage in under 60 seconds',
  condition: { type: 'stage_complete', max_time: 60000 },
  target_value: 1,
  rewards: [
    { type: 'currency', amount: 1500 },
    { type: 'cosmetic', id: 'speedrunner_badge' }
  ],
  difficulty: 'hard'
}
```

## Reward Tiers
```
0% complete:   No reward
25% complete:  50% of reward
50% complete:  75% of reward
75% complete:  90% of reward
100% complete: Full reward + 20% bonus
```

## Integration Points
- **GameServer**: Report events for condition checking
- **RewardService**: Grant currencies and cosmetics
- **NotificationService**: Alert on completion and claiming
- **AnalyticsService**: Track challenge engagement
- **SeasonalService**: Link to seasonal challenges

## Implementation Roadmap (Future)
1. Design challenge system architecture
2. Implement challenge conditions
3. Create progress tracking
4. Build reward claiming
5. Implement scheduling (daily/weekly)
6. Create challenge board UI
7. Add challenge statistics

## Dependencies
- Database for challenge definitions
- Scheduling system (cron)
- Event tracking
- Reward service

## Risk Assessment
- **Over-farming**: Players complete all challenges in 1 hour, no daily engagement
- **Inaccessible**: Challenges too hard, 0% completion rate
- **Grinding monotony**: Repetitive challenge types become boring
- **FOMO pressure**: Daily challenges create stress if missed

## Alternatives Considered
- **No challenges**: Simpler but lower engagement
- **Random challenges**: Less predictable, harder to plan
- **Permanent challenges**: No reset, players complete once and ignore
