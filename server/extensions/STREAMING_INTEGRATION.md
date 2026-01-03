# BUG #1871: Streaming Integration Framework

## Overview
Framework for integrating with Twitch/YouTube streaming platforms to enable direct game control from chat, viewer engagement, and streamer monetization.

## User Stories
- Streamers connect Twitch account to enable chat commands
- Viewers vote to control game difficulty with bits/channel points
- Streamer overlay shows live chat and engagement metrics
- Game automatically records clips of highlight moments
- Streamers earn revenue share from viewer engagement
- Achievements/cosmetics unlocked during stream are shared with chat

## Technical Requirements
- **OAuth2 integration**: Connect Twitch/YouTube accounts securely
- **Chat WebSocket**: Real-time chat message parsing and response
- **Channel points**: Track viewer engagement currency
- **Bits integration**: Monetization tracking and rewards
- **Event webhooks**: Receive notifications for follow/subscribe/raid
- **Extension support**: Send data to Twitch overlay/extension
- **Stream health**: Monitor stream quality and viewer count

## Data Schema
```sql
CREATE TABLE streamer_accounts (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  account_id VARCHAR(256) NOT NULL,
  display_name VARCHAR(256) NOT NULL,
  access_token VARCHAR(512) NOT NULL,
  refresh_token VARCHAR(512) NOT NULL,
  expires_at BIGINT NOT NULL,
  is_connected BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL,
  UNIQUE(player_id, platform),
  CHECK(platform IN ('twitch', 'youtube'))
);

CREATE TABLE stream_events (
  id UUID PRIMARY KEY,
  streamer_id UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  viewer_id VARCHAR(256),
  metadata JSON NOT NULL,
  timestamp BIGINT NOT NULL,
  FOREIGN KEY(streamer_id) REFERENCES streamer_accounts(id)
);

CREATE TABLE channel_point_transactions (
  id UUID PRIMARY KEY,
  streamer_id UUID NOT NULL,
  viewer_id VARCHAR(256) NOT NULL,
  action VARCHAR(64) NOT NULL,
  points INT NOT NULL,
  timestamp BIGINT NOT NULL,
  FOREIGN KEY(streamer_id) REFERENCES streamer_accounts(id)
);
```

## Chat Command Schema
```javascript
const COMMANDS = {
  'difficulty': {
    description: 'Vote to change difficulty',
    requiredCost: 1000,
    cooldown: 30,
    effect: { difficulty: 'hard|normal|easy' }
  },
  'skip_stage': {
    description: 'Vote to skip current stage',
    requiredCost: 5000,
    cooldown: 60,
    effect: { action: 'skip_stage' }
  },
  'gravity': {
    description: 'Vote to adjust gravity (1.0-2.0x)',
    requiredCost: 500,
    cooldown: 10,
    effect: { gravity_multiplier: number }
  },
  'cosmetic_unlock': {
    description: 'Viewers gift cosmetic to streamer',
    requiredCost: 2000,
    cooldown: 0,
    effect: { cosmetic_id: string }
  }
}
```

## API Surface
```javascript
class StreamingService {
  // Account management
  async connectTwitch(code) -> { accountId, displayName }
  async disconnectTwitch(playerId) -> void
  async getTwitchStatus(playerId) -> { connected, displayName, isLive }

  // Chat integration
  async joinChat(streamerId) -> void
  async leaveChat(streamerId) -> void
  async parseCommand(message) -> { command, viewer, cost, effect }
  async executeCommand(command, data) -> { success, message }

  // Engagement
  async getChannelPoints(streamerId) -> { totalPoints, topViewers }
  async awardChannelPoints(streamerId, viewerId, points) -> void
  async trackCheer(streamerId, viewerId, bits) -> { reward }

  // Stream info
  async getStreamStatus(streamerId) -> { isLive, viewers, title, game }
  async getStreamHealth(streamerId) -> { bitrate, fps, frameDrops }

  // Monetization
  async getStreamerRevenue(streamerId, period) -> { totalRevenue, breakdown }
  async getViewerContribution(streamerId, viewerId) -> { totalSpent, actions }

  // Clips
  async createClip(streamerId, timestamp, duration) -> { clipId, url }
  async getClips(streamerId, limit = 10) -> [{ clipId, views, url }]
}
```

## Supported Interactions
- **Chat commands**: !difficulty hard, !cosmetic pirate
- **Channel points**: Vote with points for in-game effects
- **Bits donations**: Direct money conversion to cosmetics
- **Raid rewards**: Raid viewers unlock exclusive cosmetics
- **Subscribe perks**: Subscribers get cosmetic discount
- **VIP/Mod badges**: Streamer's mods get special cosmetic

## Stream Quality Metrics
```javascript
const HEALTH_CHECK = {
  bitrate_min: 1000,      // kbps
  bitrate_ideal: 6000,    // 1080p60 on Twitch
  fps_target: 60,
  frame_drop_max: 5,      // percent
  latency_max: 500        // ms
}
```

## Integration Points
- **Twitch API**: OAuth, Chat, Bits, Events
- **YouTube API**: Live chat, Super Chat monetization
- **AnalyticsService**: Track viewer engagement
- **Cosmetics**: Unlock items during stream
- **NotificationService**: Alert streamer on events

## Implementation Roadmap (Future)
1. Design streaming integration
2. Implement Twitch OAuth flow
3. Build chat command parser
4. Integrate channel points
5. Implement bits donations
6. Create streamer dashboard
7. Add Twitch extension

## Dependencies
- Twitch API SDK
- YouTube API SDK
- OAuth providers
- Real-time chat WebSocket

## Risk Assessment
- **Chat toxicity**: Malicious commands abuse streamer/viewers
- **Spam protection**: Rate limiting required to prevent attack
- **Exploit farming**: Viewers farm cosmetics with multiple accounts
- **Viewer privacy**: Chat commands reveal viewer decisions
- **Platform policy**: Violating ToS leads to account suspension

## Alternatives Considered
- **Manual integration**: Streamer manually runs commands (no automation)
- **Patron model**: Only highly-tipped viewers can control game
- **Voting system**: Democratic voting instead of per-viewer influence
