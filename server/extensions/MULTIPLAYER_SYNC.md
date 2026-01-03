# BUG #1861: Multiplayer Synchronization Framework

## Overview
Framework for real-time synchronization of game state across multiple players with conflict resolution and ordering guarantees.

## User Stories
- Players in same lobby see synchronized game state (positions, collisions, scores)
- Network latency causes predictable smoothing, not rollback/desync
- Dropped frames handled gracefully without breaking game flow
- Authoritative server prevents cheating via client-side state manipulation

## Technical Requirements
- **State replication**: Tick-based state snapshots from server to all clients
- **Ordering guarantees**: Frame numbers ensure causal ordering of events
- **Conflict resolution**: Last-write-wins for concurrent position updates
- **Bandwidth optimization**: Only transmit state deltas (changed actors)
- **Latency compensation**: Interpolation of positions between server ticks
- **Desynchronization detection**: Track frame drift, auto-resync when threshold exceeded
- **Ordering**: Player inputs → server processes → broadcast result

## Architecture Design

### Message Protocol Extensions
```
SYNC_REQUEST: { player_id, last_acked_frame, pending_inputs: [seq, action, frame] }
SYNC_RESPONSE: { frame, actors_delta: [{ id, x, y, vel_x, vel_y, ... }], events: [collision, death, ...] }
```

### State Synchronization Model
1. Client sends input → Server receives at frame N
2. Server processes input → Updates actor state at frame N
3. Server broadcasts delta at frame N → All clients receive
4. Clients interpolate → Display frame N+1

### Conflict Resolution Rules
- **Position conflicts**: Accept server value as source of truth
- **Score conflicts**: Accumulate both values (assume concurrent earn)
- **State conflicts** (on_ground, invulnerable): Accept server value
- **Event ordering**: Use frame number as tiebreaker

### Network Optimization
- Send full state every 60 frames (1 second)
- Send deltas every other frame (minimize overhead)
- Filter invisible actors (off-screen)
- Compress position updates (delta encoding)

## API Surface
```javascript
class MultiplayerSync {
  // Initialize sync context
  initSync(localPlayerId, otherPlayerIds) {}

  // Send local input to server
  sendInput(action, frame) {}

  // Process incoming state
  receiveSyncResponse(response) {}

  // Interpolate between frames
  getInterpolatedPosition(actorId, clientFrame) {}

  // Detect desync
  detectDesync(threshold = 2) -> boolean

  // Resynchronize
  requestFullResync() {}

  // Get sync statistics
  getSyncStats() -> { roundTripTime, frameSkew, resyncCount }
}
```

## Data Schema
```javascript
SyncMessage = {
  messageType: 'SYNC_RESPONSE',
  frame: number,
  timestamp: number,
  actors: [{
    id: string,
    x: number,
    y: number,
    vel_x: number,
    vel_y: number,
    frame_created: number,
    frame_updated: number
  }],
  events: [{
    type: 'collision' | 'death' | 'goal',
    actor_id: string,
    frame: number
  }]
}
```

## Integration Points
- **GameServer**: Broadcast sync responses to all connected clients
- **ClientState**: Apply incoming state updates, detect conflicts
- **Physics**: Use server-authoritative positions for collision detection
- **Networking**: Transport layer abstracts WebSocket details

## Implementation Roadmap (Future)
1. Implement client-side sync state machine
2. Add server-side sync message generation
3. Implement interpolation for smooth movement
4. Add desync detection and recovery
5. Optimize bandwidth with delta encoding
6. Add telemetry for sync quality

## Dependencies
- WebSocket transport (existing)
- Frame-based game loop (existing)
- Actor state schema (existing)

## Risk Assessment
- **Latency spikes**: Interpolation masks up to 100ms, beyond shows jank
- **Bandwidth**: Uncompressed state can reach 50KB/s for 4 players
- **Desync cascades**: Without detection, minor sync errors compound
- **Cheating**: If conflict resolution favors client, enables position spoofing

## Alternatives Considered
- **Rollback netcode**: Requires rewinding sim, incompatible with deterministic physics
- **Peer-to-peer**: Removes authoritative server, enables cheating
- **Client-side prediction**: Harder to debug, server authority still needed for validation
