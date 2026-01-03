# BUG #1884: Observer Mode Framework

## Overview
Framework for special observer roles (referees, casters, admins) with full control and annotation capabilities for tournaments and events.

## User Stories
- Tournament referees monitor matches for rule violations
- Esports casters have tools for broadcast commentary
- Admins can pause/restart games for technical issues
- Observers create highlight reels during streaming
- Observers insert graphics and overlays for broadcast
- Observers have full replay editing capabilities

## Technical Requirements
- **Elevated permissions**: Pause, restart, edit game state
- **Admin tools**: View player inputs, detect cheating
- **Broadcast tools**: Insert graphics, manage audio feeds
- **Recording control**: Start/stop recording, edit highlights
- **Statistics injection**: Insert real-time stats into broadcast
- **Moderation**: Power to ban/kick players mid-game
- **Access control**: Role-based permission system

## Data Schema
```sql
CREATE TABLE observer_roles (
  role_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  permissions JSON NOT NULL,
  max_concurrent INT DEFAULT 1
);

CREATE TABLE observer_sessions (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  observer_id VARCHAR(256) NOT NULL,
  role_id VARCHAR(32) NOT NULL,
  join_time BIGINT NOT NULL,
  leave_time BIGINT,
  actions_log JSON DEFAULT '[]',
  FOREIGN KEY(role_id) REFERENCES observer_roles(role_id)
);

CREATE TABLE observer_permissions (
  id UUID PRIMARY KEY,
  role_id VARCHAR(32) NOT NULL,
  permission VARCHAR(64) NOT NULL,
  UNIQUE(role_id, permission),
  FOREIGN KEY(role_id) REFERENCES observer_roles(role_id)
);
```

## Observer Roles
- **Referee**: Enforce rules, can pause/restart, view inputs
- **Caster**: Commentary tools, graphics, no game control
- **Producer**: Full control, edit stream graphics, manage broadcast
- **Admin**: Can ban players, modify game state, emergency reset
- **Coach**: Analyze player, annotate for improvement (local only)

## Permissions Model
```javascript
const PERMISSIONS = {
  referee: [
    'view_player_inputs',
    'pause_game',
    'restart_game',
    'view_game_code',
    'ban_player'
  ],
  caster: [
    'add_graphics',
    'manage_audio',
    'record_highlights',
    'add_overlays',
    'control_camera'
  ],
  producer: [
    ...all_caster_permissions,
    ...all_referee_permissions,
    'edit_broadcast',
    'manage_stream_settings'
  ],
  admin: [
    ...all_permissions,
    'modify_player_state',
    'reset_server',
    'ban_permanently'
  ]
}
```

## API Surface
```javascript
class ObserverService {
  // Session management
  requestObserverAccess(userId, gameId, role) -> { granted, sessionId }
  endObserverSession(sessionId) -> void
  getObserverStatus(gameId) -> [{ observer, role, permissions }]

  // Game control
  pauseGame(sessionId, reason) -> void
  resumeGame(sessionId) -> void
  restartGame(sessionId) -> void
  setGameSpeed(sessionId, multiplier) -> void

  // Broadcast tools
  addGraphic(sessionId, graphic) -> void
  removeGraphic(sessionId, graphicId) -> void
  setOverlay(sessionId, overlay) -> void

  // Player viewing
  getPlayerInputs(sessionId, playerId) -> [inputs]
  viewPlayerState(sessionId, playerId) -> { completeState }
  getCheatDetectionFlags(sessionId) -> [suspiciousActivities]

  // Recording
  startHighlightRecording(sessionId, reason) -> { recordingId }
  endHighlightRecording(sessionId, recordingId) -> { clipId }
  editHighlight(sessionId, recordingId, edits) -> void

  // Moderation
  mutePlayer(sessionId, playerId) -> void
  banPlayer(sessionId, playerId, duration, reason) -> void
  ejectPlayer(sessionId, playerId) -> void
}
```

## Broadcast Graphics System
```javascript
const GRAPHICS = {
  'player_stats': { x, y, width, height, playerData },
  'scoreboard': { x, y, stage, scores, time },
  'timer': { duration, elapsedTime },
  'alert': { message, duration, color },
  'watermark': { text, opacity, position },
  'custom_overlay': { imageUrl, blendMode, opacity }
}
```

## Cheat Detection Flags
- **Input pattern**: Impossible inputs (frame-perfect every time)
- **Position clipping**: Player inside collider
- **Gravity manipulation**: Falling slower than expected
- **Resource hacking**: Unlimited resources/lives
- **State jumping**: Teleportation between positions
- **Speed hacking**: Movement faster than max speed

## Input Viewer
```javascript
const INPUT_LOG = [
  { frame: 0, input: 'move_left', player: 'player_1' },
  { frame: 1, input: 'jump', player: 'player_1' },
  { frame: 2, input: 'move_right', player: 'player_2' },
  ...
]
```

## Integration Points
- **GameServer**: Observer commands modify game state
- **StreamingService**: Broadcast control and graphics
- **AnalyticsService**: Log observer actions
- **ReplayService**: Highlight extraction and editing
- **ModerationService**: Ban enforcement
- **AuthService**: Role-based access control

## Implementation Roadmap (Future)
1. Design observer role system
2. Implement permission checking
3. Build game control APIs
4. Create graphics system
5. Implement input viewing
6. Add cheat detection
7. Build broadcast UI

## Dependencies
- Role-based access control (RBAC)
- Game state manipulation API
- Broadcast graphics engine
- Video editing library
- Streaming infrastructure

## Risk Assessment
- **Privilege escalation**: Non-admin user gains admin access
- **Abuse of power**: Observer uses control to sabotage players
- **Information leaks**: Observer reveals hidden game information
- **Game manipulation**: Observer changes game state unfairly
- **Broadcast incidents**: Observer accidentally reveals sensitive info

## Alternatives Considered
- **Automated refereeing**: No observers needed (hard to detect cheating)
- **Player trust system**: Only trusted players get tournaments (limits growth)
- **Replay-only judging**: Judge replays after game (delays decisions)
