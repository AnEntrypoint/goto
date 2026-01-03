# BUG #1888: Level Editor Framework

## Overview
Framework for in-game level editor allowing players to create and share custom stages with proper validation and testing.

## User Stories
- Players design custom stages using visual editor
- Place platforms, enemies, spawn points in grid
- Test levels before publishing
- Share level codes with friends
- Community features: ratings, featured levels
- Level contests with prizes
- Difficulty ratings help players find appropriate challenges

## Technical Requirements
- **Visual placement**: Drag-drop platforms and entities
- **Grid snapping**: Align to pixel grid for consistency
- **Asset selection**: Choose from available sprites/models
- **Collision testing**: Ensure platforms are reachable
- **Playability validation**: Level must be completable
- **Performance**: Check level doesn't exceed entity limits
- **Sharing**: Encode level in compressed format
- **Version control**: Track level edits and revisions

## Data Schema
```sql
CREATE TABLE custom_levels (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  creator_id VARCHAR(256) NOT NULL,
  description TEXT,
  level_data JSON NOT NULL,
  difficulty INT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  published_at BIGINT,
  is_published BOOLEAN DEFAULT false,
  plays INT DEFAULT 0,
  rating FLOAT DEFAULT 0,
  CHECK(difficulty BETWEEN 1 AND 10)
);

CREATE TABLE level_ratings (
  id UUID PRIMARY KEY,
  level_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  rating INT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(level_id, player_id),
  FOREIGN KEY(level_id) REFERENCES custom_levels(id),
  CHECK(rating BETWEEN 1 AND 5)
);

CREATE TABLE level_comments (
  id UUID PRIMARY KEY,
  level_id VARCHAR(64) NOT NULL,
  author_id VARCHAR(256) NOT NULL,
  comment TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY(level_id) REFERENCES custom_levels(id)
);
```

## Level Data Format (Compressed)
```json
{
  "version": 1,
  "name": "My Level",
  "difficulty": 5,
  "width": 1280,
  "height": 1000,
  "entities": [
    { "type": "platform", "x": 100, "y": 500, "width": 100, "height": 32 },
    { "type": "enemy", "x": 300, "y": 400, "patrol_left": 100, "patrol_right": 500 },
    { "type": "spawn", "x": 50, "y": 900 },
    { "type": "goal", "x": 1200, "y": 100 }
  ]
}
```

## API Surface
```javascript
class LevelEditorService {
  // Level management
  createLevel(name, difficulty) -> { levelId }
  getLevel(levelId) -> { levelData, metadata }
  updateLevel(levelId, updates) -> void
  deleteLevel(levelId) -> void
  publishLevel(levelId) -> { shareCode }

  // Editing
  addEntity(levelId, entity) -> void
  moveEntity(levelId, entityId, x, y) -> void
  deleteEntity(levelId, entityId) -> void
  modifyEntity(levelId, entityId, changes) -> void

  // Validation
  validateLevel(levelData) -> { valid, errors }
  testPlayLevel(levelData) -> { playTestId, recording }
  checkPlayability(levelData) -> { reachable, completable }

  // Publishing
  publishToGallery(levelId) -> void
  unpublishLevel(levelId) -> void
  getPublishedLevels(filter = {}) -> [levels]

  // Community
  rateLevel(levelId, rating) -> void
  commentLevel(levelId, comment) -> void
  getComments(levelId) -> [comments]
  reportLevel(levelId, reason) -> void

  // Sharing
  generateShareCode(levelId) -> { code }
  importLevel(shareCode) -> { levelId }
  getFeaturedLevels() -> [levels]

  // Statistics
  getLevelStats(levelId) -> { plays, avgRating, difficulty }
  getCreatorStats(creatorId) -> { levels, totalPlays, avgRating }
}
```

## Entity Types
- **Platform**: Solid ground (configurable width/height)
- **Enemy**: Patrolling obstacle (health, patrol distance)
- **Spike**: Instant death hazard
- **Spring**: Boost player velocity
- **Conveyor**: Moving platform
- **Spawn**: Player start position
- **Goal**: Level end position
- **Collectible**: Optional bonus item

## Validation Rules
```javascript
const VALIDATION = {
  max_platforms: (levelData) => levelData.entities.filter(e => e.type === 'platform').length < 100,
  max_enemies: (levelData) => levelData.entities.filter(e => e.type === 'enemy').length < 20,
  has_spawn: (levelData) => levelData.entities.some(e => e.type === 'spawn'),
  has_goal: (levelData) => levelData.entities.some(e => e.type === 'goal'),
  spawn_not_in_wall: (levelData) => checkSpawnReachability(levelData),
  goal_reachable: (levelData) => checkPathToGoal(levelData),
  no_overlaps: (levelData) => checkEntityOverlaps(levelData),
  within_bounds: (levelData) => levelData.width <= 2560 && levelData.height <= 2000
}
```

## Difficulty Rating
- **Auto-calculate**: Based on enemy count, platform density, distance
- **Manual override**: Creator can adjust from 1-10
- **Community feedback**: Player ratings help calibrate

## Level Contests
- **Monthly themes**: Create levels around theme
- **Voting period**: Community votes on best levels
- **Prizes**: Cosmetics, gems for winners
- **Featured levels**: Top 10 promoted in gallery

## Integration Points
- **GameServer**: Load and play custom levels
- **AnalyticsService**: Track which levels are popular
- **CommunityService**: Rating and commenting
- **ValidationService**: Check level legality
- **ReplayService**: Store custom level replays

## Implementation Roadmap (Future)
1. Design level data format
2. Build visual editor UI
3. Implement entity placement
4. Create validation system
5. Build playability tester
6. Implement sharing/importing
7. Create community gallery

## Dependencies
- Level editor framework (OpenGL/Canvas)
- Collision detection system
- JSON serialization
- Community features (ratings, comments)

## Risk Assessment
- **Malicious levels**: Levels designed to crash game or exploit cheats
- **Spam levels**: Thousands of garbage levels flood gallery
- **Copyright**: Players copy and modify official levels
- **Performance**: Overly complex levels tank frame rate
- **Exploit discovery**: Players find unintended level mechanics

## Alternatives Considered
- **No level editor**: No user-generated content (simpler)
- **Restricted editors**: Only pick from presets (less creative)
- **Server-side creation**: Edit on website instead of in-game
