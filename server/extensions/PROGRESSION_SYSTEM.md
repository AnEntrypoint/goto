# BUG #1878: Progression System Framework

## Overview
Framework for long-term player progression through levels, with XP gains and milestone rewards independent of rank/leaderboard.

## User Stories
- Players gain XP from any game, progression independent of wins
- Levels 1-100 with increasing XP requirements
- Level up grants cosmetics, currency, and rewards
- Prestige system allows resetting level for enhanced rewards
- Players see progress bars toward next level
- Seasonal level reset optional for hardcore players

## Technical Requirements
- **XP system**: Accumulate XP independent of ranking
- **Level scaling**: Increasing XP requirements per level (exponential)
- **Milestone rewards**: Cosmetics, currency at level milestones
- **Prestige mechanics**: Reset level for multiplier bonuses
- **Soft cap**: XP gain diminishes after 5 hours played daily
- **Catchup mechanics**: New players gain XP faster initially
- **Status display**: Show level, XP bar, time to next level

## Data Schema
```sql
CREATE TABLE player_progression (
  player_id VARCHAR(256) PRIMARY KEY,
  level INT NOT NULL DEFAULT 1,
  experience INT NOT NULL DEFAULT 0,
  prestige INT NOT NULL DEFAULT 0,
  lifetime_exp INT NOT NULL DEFAULT 0,
  total_playtime_ms INT NOT NULL DEFAULT 0,
  last_leveled BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE xp_milestones (
  level INT PRIMARY KEY,
  required_xp INT NOT NULL,
  reward_xp_for_leveling INT,
  milestone_reward JSON,
  UNIQUE(level)
);

CREATE TABLE prestige_ranks (
  prestige INT PRIMARY KEY,
  xp_multiplier FLOAT NOT NULL,
  cosmetic_id VARCHAR(64),
  currency_bonus INT DEFAULT 0
);
```

## XP Formula
```
Base XP per game:
  - Win: 100 XP
  - Loss: 70 XP
  - Forfeit: 10 XP

Multipliers:
  - First 10 levels: 1.5x XP (catchup)
  - Prestige 1: 1.1x XP
  - Prestige 2+: 1.2x XP
  - Daily soft cap: After 5 hours, 0.5x XP
  - Long session: Hours 6+, 0.25x XP (prevent farming)

Diminishing returns:
  - If +300 XP in 30 min, apply soft cap
  - Reset every 24 hours
```

## Level Scaling (Exponential)
```
Level 1:   0 XP required (start)
Level 10:  5,000 XP required
Level 20:  25,000 XP required
Level 50:  250,000 XP required
Level 100: 1,000,000 XP required
```

## Milestone Rewards
```
Level 10:  Common cosmetic + 500 currency
Level 25:  Uncommon cosmetic + 1000 currency
Level 50:  Rare cosmetic + 2500 currency
Level 75:  Epic cosmetic + 5000 currency
Level 100: Legendary cosmetic + 10000 currency
```

## API Surface
```javascript
class ProgressionService {
  // XP and levels
  awardXP(playerId, baseXp, multipliers) -> { xpGained, leveledUp, newLevel }
  getPlayerLevel(playerId) -> { level, xp, xpToNextLevel, prestige }
  getLevelInfo(level) -> { requiredXp, rewards }

  // Progression display
  getProgressionStats(playerId) -> { level, xp, xpBar, hoursPlayed, prestige }
  getExperienceBreakdown(playerId) -> { totalXp, byMode, byDay }

  // Prestige
  canPrestige(playerId) -> boolean
  resetPrestige(playerId) -> { bonusMultiplier, cosmetic }
  getPrestigeInfo(prestigeLevel) -> { multiplier, cosmetic, requirements }

  // Milestones
  getMilestonesReached(playerId) -> [{ level, reward }]
  claimMilestoneReward(playerId, level) -> { reward }

  // Statistics
  getPlayerRank(level) -> { percentile, comparable }
  getLevelDistribution() -> { level: percentage }
  getAverageSessionXp() -> number
}
```

## Prestige Mechanics
- **Reset requirement**: Level 100
- **Reset result**: Back to level 1, +10% XP multiplier permanently
- **Prestige cosmetic**: Exclusive cosmetic badge per prestige
- **Max prestiges**: 10 prestiges available (10x multiplier cap)
- **Cosmetic stacking**: Previous prestige cosmetics remain equipped

## Soft Cap System
- **Threshold**: 5 hours of consecutive play
- **After 5h**: XP gains reduced to 50%
- **After 6h**: XP gains reduced to 25%
- **After 8h**: No XP earned (hard stop)
- **Reset**: Midnight UTC, full XP earning resumes

## Integration Points
- **GameServer**: Award XP on match completion
- **RewardService**: Grant cosmetics at milestones
- **MonetizationService**: Track progression as engagement metric
- **AnalyticsService**: Monitor player progression funnels
- **ProfileService**: Display level on profile

## Implementation Roadmap (Future)
1. Design XP and level system
2. Implement experience accumulation
3. Create level scaling tables
4. Build prestige mechanics
5. Implement milestone rewards
6. Add progression display UI
7. Create progression analytics

## Dependencies
- Database for progression state
- Reward service
- Profile service
- Analytics tracking

## Risk Assessment
- **Prestige farming**: Players create new accounts to farm easier XP
- **Grind fatigue**: 1,000,000 XP to level 100 feels endless
- **Soft cap abuse**: Players circumvent soft cap with timing exploits
- **Horizontal progression**: Levels feel meaningless if no gameplay advantage

## Alternatives Considered
- **No levels**: Just ranking, simpler (less engagement)
- **Level-based matchmaking**: Levels lock new players to queues (discrimination)
- **Account-wide levels**: All modes share XP (dilutes focus)
