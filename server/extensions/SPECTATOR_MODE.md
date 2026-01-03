# BUG #1883: Spectator Mode Framework

## Overview
Framework for allowing players to watch live games without affecting gameplay, with multiple camera angles and analysis tools.

## User Stories
- Players watch friends' live games
- Tournament observers watch matches
- Streamers enable spectating for viewers
- Spectators see minimap and player stats overlay
- Spectators can rewind/pause recorded games (delayed)
- Spectators unable to interact with game

## Technical Requirements
- **Read-only connection**: Spectators receive game state but can't send input
- **Camera control**: Switch between player perspectives
- **Replay integration**: Recorded games watchable on-demand
- **Analysis mode**: Slow-motion, annotations for coaching
- **Latency handling**: Spectators accept 30-60s delay
- **Bandwidth optimization**: Spectators receive compressed updates
- **Limit per game**: Max 100 spectators per game

## Data Schema
```sql
CREATE TABLE spectator_sessions (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  spectator_id VARCHAR(256) NOT NULL,
  join_time BIGINT NOT NULL,
  leave_time BIGINT,
  duration_ms INT,
  watched_players INT NOT NULL
);

CREATE TABLE spectator_settings (
  player_id VARCHAR(256) PRIMARY KEY,
  allow_spectators BOOLEAN DEFAULT true,
  friends_only BOOLEAN DEFAULT false,
  streamer_mode BOOLEAN DEFAULT false
);

CREATE TABLE spectator_annotations (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  creator_id VARCHAR(256) NOT NULL,
  frame INT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  annotation TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
```

## API Surface
```javascript
class SpectatorService {
  // Session management
  joinSpectate(spectatorId, gameId) -> { spectateId, gameState }
  leaveSpectate(spectateId) -> void
  subscribeGameUpdates(spectateId) -> AsyncIterable

  // Camera control
  switchCamera(spectateId, playerId) -> void
  setCameraMode(spectateId, mode: 'player_view' | 'overhead' | 'minimap') -> void
  getActivePlayers(gameId) -> [{ playerId, position, status }]

  // Analysis tools
  rewindGame(spectateId, frameNum) -> void
  pauseGame(spectateId) -> void
  resumeGame(spectateId) -> void
  setPlaybackSpeed(spectateId, speed = 1.0) -> void

  // Overlay
  getGameState(spectateId) -> { players, scores, stage, time }
  getPlayerStats(gameId, playerId) -> { score, survivalTime, deaths }

  // Annotations
  addAnnotation(gameId, frame, x, y, text) -> void
  getAnnotations(gameId) -> [{ frame, text, position }]

  // Settings
  getSpectatorSettings(playerId) -> { allowSpectators, friendsOnly }
  setSpectatorSettings(playerId, settings) -> void
}
```

## Camera Modes
- **Player view**: Follow specific player's perspective
- **Overhead**: Isometric view of entire stage
- **Minimap**: Top-down view with player positions
- **Focus camera**: Auto-track leading player
- **Replay camera**: Pre-recorded cinematic views

## Spectator Overlay
```
┌─────────────────────────────────────┐
│ Player 1 Score: 50000  │  Player 2 Score: 48000  │
│ Health: ▓▓▓▓░  │  Health: ▓▓▓░░                 │
│                                                   │
│              [Game View]                          │
│                                                   │
│                Minimap │ Stats │ Chat             │
│ Time: 5:23  FPS: 60    │Frame: 320                │
└─────────────────────────────────────┘
```

## Replay Preservation
- **Live spectate**: Real-time with 30s delay (Twitch delay)
- **Recorded spectate**: Full replay available after game (on-demand)
- **Delay purpose**: Prevents stream sniping in competitive
- **Playback controls**: Skip, pause, rewind, speed (recorded only)

## Analysis Features
- **Instant replay**: Jump to specific frame
- **Slow-motion**: 0.5x-2.0x playback speed
- **Path drawing**: Draw player movement paths on screen
- **Collision visualization**: Show collision rectangles
- **Event markers**: Jump to key events (deaths, combo, etc)

## Spectator Count Tracking
- **Per game limit**: Max 100 spectators per live game
- **Queue system**: Spectators wait if over capacity
- **Load distribution**: Route spectators to least-loaded servers

## Integration Points
- **GameServer**: Send spectator-specific state snapshots
- **ReplayService**: Archive games for on-demand spectating
- **StreamingService**: Integrate with Twitch/YouTube spectator features
- **AnalyticsService**: Track spectator engagement
- **ChatService**: Spectator-only chat channel

## Implementation Roadmap (Future)
1. Design spectator protocol
2. Implement read-only game connections
3. Build camera system
4. Create overlay UI
5. Implement replay integration
6. Add analysis tools
7. Build annotation system

## Dependencies
- Game server changes for spectator support
- Replay system
- Real-time state streaming
- UI overlay framework

## Risk Assessment
- **Stream sniping**: Spectators relay game info to streamer's team
- **Bandwidth drain**: 100 spectators × game updates floods server
- **Cheating assistance**: Spectators coach player with real-time info
- **Spectator lag**: Delays between spectator view and actual game confuse viewers

## Alternatives Considered
- **Delayed stream only**: Simpler but viewers can't spectate live
- **No spectating**: Simpler but hurts streamer/coach experiences
- **Recorded only**: Can't watch friends live
