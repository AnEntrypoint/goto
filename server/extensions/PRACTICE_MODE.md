# BUG #1885: Practice Mode Framework

## Overview
Framework for offline/single-player practice with customizable difficulty, unlimited lives, and training tools for skill improvement.

## User Stories
- Players practice without penalty
- Difficulty adjustable (gravity, enemy speed, platform size)
- Unlimited lives for learning
- Instant restart on death
- Training tools (slow-motion, hitbox display, waypoints)
- Practice replays for self-improvement
- No ranking impact

## Technical Requirements
- **Offline gameplay**: Run without server connection
- **Difficulty sliders**: Adjust gravity, speeds, physics
- **Training tools**: Hitboxes, prediction lines, grid overlay
- **Instant respawn**: Immediate restart on death
- **Save checkpoints**: Resume from specific stage position
- **Replay capture**: Local replay recording
- **Statistics**: Track personal bests, failure points

## Data Schema
```sql
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  difficulty JSON NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  duration_ms INT,
  checkpoint_frame INT DEFAULT 0
);

CREATE TABLE practice_statistics (
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  best_score INT NOT NULL,
  best_time_ms INT NOT NULL,
  avg_attempts INT NOT NULL,
  failure_points JSON NOT NULL,
  PRIMARY KEY(player_id, stage)
);

CREATE TABLE training_presets (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  difficulty JSON NOT NULL,
  tools JSON NOT NULL
);
```

## Difficulty Customization
```javascript
const DIFFICULTY_PARAMS = {
  gravity_multiplier: { min: 0.5, max: 2.0, default: 1.0 },
  enemy_speed_multiplier: { min: 0.25, max: 2.0, default: 1.0 },
  player_speed_multiplier: { min: 0.5, max: 2.0, default: 1.0 },
  platform_size_multiplier: { min: 0.5, max: 1.5, default: 1.0 },
  player_health: { min: 1, max: 10, default: 3 },
  invulnerability_duration: { min: 0, max: 5, default: 1.5 },
  jump_height_multiplier: { min: 0.5, max: 2.0, default: 1.0 }
}
```

## Training Tools
- **Hitbox display**: Show collision rectangles
- **Prediction line**: Path player will take with current momentum
- **Grid overlay**: Pixel-perfect positioning reference
- **Waypoint markers**: Place targets to practice routes
- **Slow-motion**: 0.5x-1.0x playback speed
- **Frame advance**: Step through one frame at a time
- **Input replay**: Overlay recorded input sequence

## API Surface
```javascript
class PracticeService {
  // Session management
  startPractice(playerId, stage, difficulty = {}) -> { sessionId }
  endPractice(sessionId) -> { stats }
  savePracticeSession(sessionId, checkpoint = null) -> void

  // Difficulty
  getDifficultyParams(stage) -> object
  setDifficultyParam(sessionId, param, value) -> void
  getPresets() -> [{ name, difficulty, tools }]
  applyPreset(sessionId, presetId) -> void

  // Training tools
  enableTool(sessionId, toolName) -> void
  disableTool(sessionId, toolName) -> void
  setToolConfig(sessionId, toolName, config) -> void
  getToolStatus(sessionId) -> { enabled: [tools] }

  // Progress
  getPersonalBest(playerId, stage) -> { score, time }
  getFailureAnalysis(playerId, stage) -> [{ frame, cause, frequency }]
  getProgressChart(playerId, stage, days = 30) -> [{ date, bestScore }]

  // Replay
  startPracticeRecording(sessionId) -> void
  stopPracticeRecording(sessionId) -> { replayId }
  getPracticeReplays(playerId, stage) -> [replays]
}
```

## Training Presets
```javascript
const PRESETS = {
  'beginner': {
    gravity: 0.75,
    enemy_speed: 0.5,
    player_health: 10,
    invuln: 3.0,
    tools: ['hitbox', 'grid', 'prediction']
  },
  'speedrun': {
    gravity: 1.0,
    enemy_speed: 1.0,
    player_health: 3,
    invuln: 1.5,
    tools: ['timer', 'waypoints']
  },
  'precision': {
    gravity: 1.0,
    enemy_speed: 1.0,
    player_health: 1,
    invuln: 0.0,
    tools: ['hitbox', 'frame_advance', 'grid']
  },
  'survival': {
    gravity: 1.5,
    enemy_speed: 1.5,
    player_health: 5,
    invuln: 1.0,
    tools: ['threat_indicator']
  }
}
```

## Failure Point Analysis
```javascript
const FAILURE_ANALYSIS = {
  'platform_id_5': { count: 15, percentage: 35 },
  'enemy_collision': { count: 8, percentage: 18 },
  'jump_timing': { count: 12, percentage: 27 },
  'landing_failure': { count: 10, percentage: 20 }
}
```

## Checkpoint System
- **Save point**: Resume from middle of stage
- **Progress preservation**: Keep items/powerups collected
- **Time bonus**: Time only counts from checkpoint, not start
- **Limited checkpoints**: Max 3 per stage to prevent trivializing

## Integration Points
- **GameEngine**: Run offline without server
- **ReplayService**: Save practice replays locally
- **AnalyticsService**: Track practice engagement (optional, local)
- **ProfileService**: Display practice statistics on profile

## Implementation Roadmap (Future)
1. Build offline game engine
2. Implement difficulty parameters
3. Create training tools UI
4. Build statistics tracking
5. Implement checkpoint system
6. Create training presets
7. Add failure analysis

## Dependencies
- Offline game engine
- Physics simulation
- Local storage for replays
- UI framework for overlays

## Risk Assessment
- **Offline cheating**: Players modify game files for easy practice
- **Replay abuse**: Players export practice replays claiming they're real
- **Tool confusion**: Too many training options overwhelms players
- **Skill transfer**: Skills learned in practice might not apply to real games

## Alternatives Considered
- **No practice mode**: Jump straight into competitive (no learning curve)
- **AI opponents instead**: Play against bots (different strategy)
- **Coaching system**: Human coaches provide feedback (expensive)
