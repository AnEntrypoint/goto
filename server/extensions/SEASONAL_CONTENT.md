# BUG #1876: Seasonal Content Framework

## Overview
Framework for time-limited seasonal content (cosmetics, challenges, events) that drives recurring engagement and creates FOMO.

## User Stories
- New season launches every 3 months with theme and cosmetics
- Players complete seasonal challenges to progress battle pass
- Special events activate during season with unique rewards
- Seasonal cosmetics only available during season
- Players earn seasonal achievement and exclusive cosmetics
- Old seasonal content rotates back yearly for returning players

## Technical Requirements
- **Season lifecycle**: Definition, scheduling, reward distribution
- **Limited cosmetics**: Availability tied to season dates
- **Challenge rotation**: New challenges each season
- **Event coordination**: Schedule events within season window
- **Legacy cosmetics**: Re-release old seasonal content with variant
- **Battle pass timing**: Seasonal reset mechanics
- **Announcement system**: Notify players of season start

## Data Schema
```sql
CREATE TABLE seasons (
  id INT PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  theme VARCHAR(64) NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  cosmetic_ids JSON NOT NULL,
  reward_pool INT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE seasonal_events (
  id UUID PRIMARY KEY,
  season_id INT NOT NULL,
  name VARCHAR(256) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  rewards JSON NOT NULL,
  FOREIGN KEY(season_id) REFERENCES seasons(id)
);

CREATE TABLE seasonal_cosmetics (
  cosmetic_id VARCHAR(64) PRIMARY KEY,
  season_id INT NOT NULL,
  is_exclusive BOOLEAN DEFAULT true,
  reissue_season_id INT,
  FOREIGN KEY(season_id) REFERENCES seasons(id)
);
```

## Season Themes
- **Spring**: Nature, flowers, wildlife
- **Summer**: Beach, tropical, adventures
- **Fall**: Harvest, spooky, introspection
- **Winter**: Snow, holidays, celebration

## Event Types
- **Limited mode**: Temporary game mode (hard mode, speed run)
- **Flash sale**: Cosmetics at discount for 48 hours
- **Community challenge**: Collective goal (beat X games as community)
- **Featured tournament**: Special bracket tournament
- **Story event**: Narrative content tied to season

## API Surface
```javascript
class SeasonalService {
  // Season management
  getCurrentSeason() -> { id, name, theme, daysRemaining, cosmetics }
  getUpcomingSeason() -> { name, teaser, releaseDate }
  getSeason(seasonId) -> { details, cosmetics, events }

  // Cosmetics
  getSeasonalCosmetics(seasonId) -> [cosmetics]
  isCosmticAvailable(cosmeticId) -> { available, endsAt, seasonId }
  getExclusiveCosmetics(seasonId) -> [cosmetics]

  // Events
  getActiveEvents(seasonId) -> [events]
  getEventProgress(playerId, eventId) -> { completed, reward }
  claimEventReward(playerId, eventId) -> { reward }

  // Notifications
  getSeasonNotifications(playerId) -> [{ title, message, expiresAt }]
  announceSeasonStart() -> void

  // Statistics
  getSeasonEngagement(seasonId) -> { players, avgPlaytime, completion }
  getCosmicticSales(seasonId) -> { totalSales, topCosmetics }
}
```

## Season Calendar (Example)
```
Year 2026:
  Season 1 (Jan-Mar): Winter/New Year theme
  Season 2 (Apr-Jun): Spring theme
  Season 3 (Jul-Sep): Summer theme
  Season 4 (Oct-Dec): Fall/Holiday theme
```

## FOMO Mechanics
- **Limited availability**: Cosmetics unavailable after season ends
- **Countdown timer**: Remind players of time remaining
- **Legacy cosmetics**: Past cosmetics available only during anniversary
- **Achievement cosmetics**: Seasonal achievements grant exclusive items
- **Early access**: Players who reach pass tier 100 get cosmetic early

## Integration Points
- **CosmeticsService**: Tie cosmetics to season
- **ChallengesService**: Season-specific challenges
- **BattlepassService**: Seasonal reset
- **EventService**: Schedule seasonal events
- **NotificationService**: Announce season starts

## Implementation Roadmap (Future)
1. Design season calendar system
2. Implement season lifecycle
3. Create seasonal cosmetics
4. Build event scheduling
5. Implement time-based availability
6. Create season announcements
7. Add legacy cosmetic rotation

## Dependencies
- Database for season schedule
- Cosmetics system
- Event system
- Notification service

## Risk Assessment
- **Over-FOMO**: Excessive time-pressure causes player burnout
- **Catchup difficulty**: New players can't obtain old seasonal cosmetics
- **Content drought**: Season too long, players bored mid-way
- **Engagement cliff**: Season end causes engagement drop

## Alternatives Considered
- **Evergreen cosmetics**: All cosmetics always available (no FOMO)
- **Monthly seasons**: Too frequent, burnout quickly
- **Cosmetic rotation**: Same cosmetics rotate monthly (boring)
