# BUG #1873: Replay System Framework

## Overview
Framework for recording, storing, and sharing game replays with playback controls, editing, and clip extraction.

## User Stories
- Game automatically records last 10 played games
- Players can watch replays at any point
- Players share replays with link
- Players extract clips from replays
- Community curates best replays
- Streamers use replays for VOD integration

## Technical Requirements
- **Recording**: Capture input sequence + server state deltas
- **Storage**: Compressed replay files, delta encoding
- **Playback**: Deterministic replay of recorded inputs
- **Editing**: Extract segments, add commentary
- **Sharing**: Generate shareable links
- **Validation**: Ensure replay integrity, prevent tampering
- **Cleanup**: Archive old replays, manage storage

## Data Schema
```sql
CREATE TABLE replays (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  stage INT NOT NULL,
  final_score INT NOT NULL,
  duration_ms INT NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  file_size_bytes INT NOT NULL,
  recorded_at BIGINT NOT NULL,
  is_public BOOLEAN DEFAULT false,
  view_count INT DEFAULT 0,
  download_count INT DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  UNIQUE(game_id)
);

CREATE TABLE replay_clips (
  id UUID PRIMARY KEY,
  replay_id UUID NOT NULL,
  title VARCHAR(256) NOT NULL,
  description TEXT,
  start_frame INT NOT NULL,
  end_frame INT NOT NULL,
  created_at BIGINT NOT NULL,
  creator_id VARCHAR(256) NOT NULL,
  view_count INT DEFAULT 0,
  FOREIGN KEY(replay_id) REFERENCES replays(id)
);

CREATE TABLE replay_comments (
  id UUID PRIMARY KEY,
  replay_id UUID NOT NULL,
  author_id VARCHAR(256) NOT NULL,
  frame INT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  FOREIGN KEY(replay_id) REFERENCES replays(id)
);
```

## Replay Format (Compressed)
```
ReplayFile {
  header: {
    version: 1,
    game_id: string,
    player_id: string,
    stage: int,
    final_score: int,
    duration_ms: int,
    recorded_at: timestamp,
    checksum: sha256
  },
  frames: [{
    frame_num: int,
    inputs: [{ action, value }],
    state_delta: { actor_id: { x, y, vel_x, vel_y } }
  }],
  events: [{ frame, type, data }]
}
```

## API Surface
```javascript
class ReplayService {
  // Recording
  startRecording(gameId, playerId, stage) -> { recordingId }
  recordFrame(recordingId, inputs, stateDelta) -> void
  recordEvent(recordingId, frame, eventType, data) -> void
  finishRecording(recordingId, finalScore) -> { replayId }

  // Playback
  getReplay(replayId) -> { metadata, frames, events }
  startPlayback(replayId) -> { playbackId, duration }
  getPlaybackFrame(playbackId, frameNum) -> { state, actors }
  seekPlayback(playbackId, frameNum) -> void
  stopPlayback(playbackId) -> void

  // Sharing
  setReplayPublic(replayId, isPublic) -> void
  generateShareLink(replayId) -> { link, expiresAt }
  getPublicReplays(limit = 50) -> [{ replayId, player, score, views }]

  // Clips
  createClip(replayId, title, startFrame, endFrame) -> { clipId }
  getClips(replayId) -> [{ clipId, title, duration }]
  exportClip(clipId, format = 'webm') -> { url }

  // Management
  getPlayerReplays(playerId, limit = 10) -> [replays]
  deleteReplay(replayId) -> void
  getReplaysNeedingCompression() -> [replayIds]
  compressReplay(replayId) -> { compressedSize }

  // Statistics
  getPopularReplays(timeRange = '7d', limit = 50) -> [replays]
  getTrendingClips(limit = 20) -> [clips]
}
```

## Compression Strategy
- **Input recording**: Store only player input changes (sparse encoding)
- **State deltas**: Only store actor positions that changed each frame
- **Frame skipping**: Server sends state every 2nd frame, interpolate others
- **Compression ratio**: Typical replay 50KB compressed (15 min gameplay)

## Playback Validation
- **Checksum verification**: Detect tampered replays
- **Determinism check**: Replay should produce identical output
- **Anti-aliasing**: Minor floating point differences allowed

## Integration Points
- **GameServer**: Call recording API during gameplay
- **StorageService**: Store compressed replay files
- **CDN**: Serve replays with caching
- **SocialService**: Link replays to profiles
- **AnalyticsService**: Track replay views

## Implementation Roadmap (Future)
1. Design replay recording format
2. Implement recording during gameplay
3. Build playback engine
4. Create replay player UI
5. Implement clip extraction
6. Build sharing system
7. Add social features (comments, ratings)

## Dependencies
- File storage (S3 or local)
- Compression library (zlib)
- Video codec for clip export (ffmpeg)
- CDN for serving replays

## Risk Assessment
- **Storage explosion**: Unlimited replay storage costs prohibitive
- **Abuse**: Users spam short clips, flooding CDN
- **Cheating detection**: Replays can expose cheating method
- **Privacy**: Players may not want replay sharing
- **Determinism**: Physics engine differences break replay

## Alternatives Considered
- **Server-side recording**: Record on server, uses more bandwidth
- **Video recording**: Record as video, much larger file size
- **Input-only**: No state validation, client can cheat replay
