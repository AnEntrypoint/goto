# BUG #1887: Physics Customization Framework

## Overview
Framework for letting players and content creators customize physics parameters (gravity, speed, jump height) to create unique gameplay variants.

## User Stories
- Players create custom game modes with modified physics
- Share custom physics configurations with friends
- Physics configurations are game-balancing (not pay-to-win)
- Ranked mode uses standard physics only
- Custom physics available in casual/practice modes
- Community votes on best custom physics

## Technical Requirements
- **Parameter bounds**: Prevent physics breaking (gravity > 0, speeds < max)
- **Presets**: Pre-built configurations for quick selection
- **Sharing**: Store and share custom physics with ID
- **Validation**: Ensure custom physics don't break gameplay
- **Analytics**: Track which physics most popular
- **Fallback**: If invalid, default to standard physics
- **Version tracking**: Physics parameters change between patches

## Data Schema
```sql
CREATE TABLE physics_presets (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  creator_id VARCHAR(256),
  physics_params JSON NOT NULL,
  mode VARCHAR(32) NOT NULL,
  is_ranked BOOLEAN DEFAULT false,
  downloads INT DEFAULT 0,
  rating FLOAT DEFAULT 0,
  created_at BIGINT NOT NULL,
  CHECK(mode IN ('casual', 'practice', 'custom_tournament'))
);

CREATE TABLE physics_history (
  id UUID PRIMARY KEY,
  patch_version VARCHAR(32) NOT NULL,
  physics_params JSON NOT NULL,
  changelog TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE custom_physics_usage (
  preset_id VARCHAR(64) NOT NULL,
  usage_count INT DEFAULT 0,
  last_used BIGINT,
  avg_game_duration INT,
  FOREIGN KEY(preset_id) REFERENCES physics_presets(id)
);
```

## Adjustable Parameters
```javascript
const PHYSICS_BOUNDS = {
  gravity: { min: 300, max: 2400, default: 1200, step: 100 },
  player_speed: { min: 50, max: 400, default: 200, step: 25 },
  enemy_speed: { min: 30, max: 240, default: 120, step: 15 },
  jump_velocity: { min: -900, max: -200, default: -450, step: 50 },
  max_fall_speed: { min: 400, max: 1600, default: 800, step: 100 },
  coyote_frames: { min: 0, max: 20, default: 6, step: 1 },
  dash_speed: { min: 0, max: 600, default: 0, step: 50 },
  air_control_multiplier: { min: 0.1, max: 2.0, default: 1.0, step: 0.1 }
}
```

## Physics Presets
```javascript
const PRESETS = {
  'standard': {
    name: 'Standard',
    gravity: 1200,
    player_speed: 200,
    jump_velocity: -450,
    max_fall_speed: 800
  },
  'highflyer': {
    name: 'Highflyer',
    gravity: 600,
    jump_velocity: -450,
    max_fall_speed: 500
  },
  'speedrunner': {
    name: 'Speedrunner',
    gravity: 1500,
    player_speed: 400,
    jump_velocity: -600,
    coyote_frames: 10
  },
  'slime': {
    name: 'Slime',
    gravity: 300,
    jump_velocity: -200,
    air_control_multiplier: 2.0
  },
  'ninja': {
    name: 'Ninja',
    gravity: 1400,
    player_speed: 350,
    dash_speed: 400,
    coyote_frames: 2
  }
}
```

## API Surface
```javascript
class PhysicsCustomizationService {
  // Preset management
  getPhysicsPresets() -> [presets]
  getPreset(presetId) -> { name, params, downloads, rating }
  createPreset(name, params, description) -> { presetId }
  deletePreset(presetId) -> void

  // Validation
  validatePhysicsParams(params) -> { valid, errors }
  testPhysics(params, frames = 1000) -> { simulationResult, issues }

  // Sharing
  publishPreset(presetId, isPublic) -> void
  sharePreset(presetId, playerId) -> { shareToken }
  importPreset(shareToken) -> { presetId }

  // Community
  getRating(presetId) -> { avgRating, ratingCount }
  ratePreset(presetId, rating) -> void
  getPopularPresets(limit = 20) -> [presets]
  getTrendingPresets(days = 7) -> [presets]

  // Analytics
  getUsageStats(presetId) -> { usageCount, avgGameDuration, playerRetention }
  getPhysicsPopularity() -> [{ preset, usagePercent }]

  // Versions
  getPhysicsHistory(presetId) -> [versions]
  revertPreset(presetId, versionId) -> void
}
```

## Validation Rules
```javascript
const VALIDATION = {
  gravity_reasonable: (g) => g > 300 && g < 2400,
  jump_high_enough: (jumpVel, gravity) => -jumpVel / gravity > 0.3,
  speeds_sensible: (playerSpeed, enemySpeed) => playerSpeed > enemySpeed,
  fallspeed_reasonable: (maxFall, gravity) => maxFall > gravity,
  coyote_not_too_long: (coyoteFrames) => coyoteFrames < 20
}
```

## Physics Balancing Guidelines
- **Difficulty scaling**: Lower gravity = easier, higher gravity = harder
- **Movement speed**: Faster movement requires faster reaction
- **Jump height**: Too high = broken platforming, too low = frustrating
- **Coyote time**: Longer = more forgiving, shorter = skill-based
- **Fall speed cap**: Prevents infinite fall, needs tuning per gravity

## Integration Points
- **GameServer**: Apply physics parameters at match start
- **ValidatorService**: Check custom physics before accepting
- **AnalyticsService**: Track usage of custom physics
- **CommunityService**: Share and rate presets
- **VersionService**: Track physics changes across patches

## Implementation Roadmap (Future)
1. Design physics parameter system
2. Implement validation
3. Create preset storage
4. Build sharing mechanism
5. Add analytics tracking
6. Implement rating system
7. Create physics editor UI

## Dependencies
- Physics validation library
- Physics simulation for testing
- Community rating system
- Version control for physics

## Risk Assessment
- **Game breaking physics**: Invalid parameters cause softlock or crashes
- **Unfair advantages**: Gravity customization enables pay-to-win
- **Balance destruction**: Bad physics configs make game unplayable
- **Exploit discovery**: Players find parameters that break game logic
- **Server load**: Testing all custom physics configs expensive

## Alternatives Considered
- **No customization**: Simpler, no validation needed (less player agency)
- **Ranked + casual split**: Standard physics for ranked (already doing this)
- **Preset only**: No custom params, only pre-balanced configs (limited)
