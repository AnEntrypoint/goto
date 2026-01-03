# BUG #1880: Voice Chat Framework

## Overview
Framework for in-game voice communication with spatial audio, team/clan channels, and moderation.

## User Stories
- Players join voice channel automatically when in multiplayer game
- Proximity chat: Players hear louder when close, quieter when far
- Team voice: Separate channel for team communication only
- Push-to-talk: Hold button to transmit voice
- Spatial audio: Voice appears to come from player's on-screen position
- Voice modulation: Privacy filters, pitch shifts, disguises

## Technical Requirements
- **WebRTC**: Peer-to-peer voice using WebRTC data channels
- **TURN servers**: Relay for NAT-traversal
- **Audio codec**: Opus codec for low bandwidth (24kbps)
- **Echo cancellation**: Remove player's own voice feedback
- **Noise suppression**: Filter background noise
- **VAD (Voice Activity Detection)**: Auto-mute silence
- **Compression**: Reduce latency to <100ms

## Data Schema
```sql
CREATE TABLE voice_sessions (
  id UUID PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  channel_type VARCHAR(16) NOT NULL,
  connected_at BIGINT NOT NULL,
  disconnected_at BIGINT,
  duration_ms INT,
  CHECK(channel_type IN ('proximity', 'team', 'clan', 'global'))
);

CREATE TABLE voice_settings (
  player_id VARCHAR(256) PRIMARY KEY,
  input_device VARCHAR(256),
  output_device VARCHAR(256),
  microphone_volume INT DEFAULT 100,
  speaker_volume INT DEFAULT 100,
  voice_filter VARCHAR(32) DEFAULT 'none',
  ptt_enabled BOOLEAN DEFAULT true,
  auto_mute_enabled BOOLEAN DEFAULT true,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE muted_players (
  id UUID PRIMARY KEY,
  muter_id VARCHAR(256) NOT NULL,
  muted_id VARCHAR(256) NOT NULL,
  muted_until BIGINT,
  UNIQUE(muter_id, muted_id)
);
```

## Voice Channels
- **Proximity**: Hear nearby players only (distance-based)
- **Team**: All teammates regardless of proximity
- **Clan**: All clan members online
- **Global**: Broadcast to all players (tournament only)

## Audio Processing Pipeline
```
Input → Noise Gate → Echo Cancellation → Noise Suppression → VAD → Compression → Opus Encoder → Network

Reverse:
Network → Opus Decoder → Spatial Positioning → Volume Adjustment → Output
```

## API Surface
```javascript
class VoiceChatService {
  // Connection
  joinVoiceChannel(playerId, channelType) -> { channelId, turnServers }
  leaveVoiceChannel(playerId, channelId) -> void
  switchChannel(playerId, oldChannel, newChannel) -> void

  // Settings
  getVoiceSettings(playerId) -> { inputDevice, outputDevice, volume, filter }
  setVoiceSettings(playerId, settings) -> void
  getAvailableDevices() -> { microphones: [], speakers: [] }
  testMicrophone(playerId) -> { recordedAudio }

  // Channels
  getChannelMembers(channelId) -> [{ playerId, speaking, position }]
  getSpatialAudio(playerId) -> { memberPositions }

  // Moderation
  mutePlayer(muterId, mutedId, durationMs = null) -> void
  unmutePlayer(muterId, mutedId) -> void
  isMuted(muterId, mutedId) -> boolean
  reportVoiceHarassment(reporterId, offenderId) -> void

  // Statistics
  getVoiceQuality(channelId) -> { packetLoss, latency, bitrate }
  getVoiceActivityLog(playerId) -> [{ channelId, duration, timestamp }]
}
```

## Voice Filters
- **None**: Normal voice
- **Robot**: Pitch-shifted mechanical
- **Helium**: High-pitched squeaky voice
- **Deep**: Low-pitched bass voice
- **Echo**: Echoing reverb effect
- **Radio**: Filtered like old radio transmission

## Proximity Calculation
```javascript
const HEARING_DISTANCE = {
  normal_speech: 30,      // meters (on-screen distance)
  loud_shout: 60,
  whisper: 10,
  proximity_chat: (speakerPos, listenerPos) => {
    const dist = Math.hypot(
      speakerPos.x - listenerPos.x,
      speakerPos.y - listenerPos.y
    );
    const volume = Math.max(0, 1 - (dist / 30)); // 0 to 1
    return volume * 100; // 0-100% volume
  }
};
```

## Echo Cancellation Algorithm
- **Reference audio**: Capture speaker output
- **Adaptive filter**: Subtract reference from microphone input
- **Tail length**: 500ms echo history
- **Convergence**: Learns echo pattern over time

## Latency Budget
```
Capture:        10ms
Processing:     20ms
Encoding:       10ms
Network:        50ms (target)
Decoding:       10ms
Playback:       10ms
------------------
Total:          110ms (acceptable for real-time)
```

## Integration Points
- **GameServer**: Send player positions for spatial audio
- **ChatService**: Link voice and text chat
- **ModerationService**: Report and mute functionality
- **AnalyticsService**: Track voice usage patterns
- **ProfileService**: Display voice settings on profile

## Implementation Roadmap (Future)
1. Set up WebRTC infrastructure
2. Deploy TURN servers
3. Implement Opus codec integration
4. Build echo cancellation
5. Create proximity audio
6. Implement voice settings UI
7. Add moderation tools

## Dependencies
- WebRTC library (Twilio/Agora)
- TURN server infrastructure
- Opus audio codec
- DSP library for audio processing

## Risk Assessment
- **Harassment**: Voice channels enable harassment without text logs
- **DMCA content**: Copyrighted music played in voice channel
- **Bandwidth**: Voice codec still uses 24kbps per player
- **Latency spikes**: Network congestion causes delayed voice
- **Privacy**: Players may not consent to voice recording

## Alternatives Considered
- **Text only**: Simpler, no audio infrastructure (worse UX)
- **Discord integration**: Use Discord voice (requires Discord account)
- **Pre-recorded commands**: Voice buttons instead of live audio
