# BUG #1881: Chat System Framework

## Overview
Framework for text-based communication channels (global, team, clan, whisper) with moderation and content filtering.

## User Stories
- Players send messages in global/team/clan channels
- Private whispers between players
- Chat history searchable and archivable
- Automated content moderation filters spam and toxicity
- Emojis and formatted text supported
- Chat integrates with streaming overlays

## Technical Requirements
- **Channel types**: Global, team, clan, whisper, tournament
- **Message routing**: Efficient delivery to relevant players
- **Chat history**: Archive and searchable
- **Moderation**: Keyword filtering, profanity detection
- **Rate limiting**: Prevent spam/flooding
- **Rich text**: Markdown support, emojis
- **Message reactions**: Users react to messages

## Data Schema
```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY,
  sender_id VARCHAR(256) NOT NULL,
  channel_type VARCHAR(32) NOT NULL,
  channel_id VARCHAR(64),
  recipient_id VARCHAR(256),
  message TEXT NOT NULL,
  is_censored BOOLEAN DEFAULT false,
  censored_reason VARCHAR(256),
  created_at BIGINT NOT NULL,
  deleted_at BIGINT,
  INDEX idx_channel_created (channel_type, channel_id, created_at),
  CHECK(channel_type IN ('global', 'team', 'clan', 'whisper', 'tournament'))
);

CREATE TABLE chat_history (
  player_id VARCHAR(256) NOT NULL,
  message_id UUID NOT NULL,
  read_at BIGINT,
  PRIMARY KEY(player_id, message_id),
  FOREIGN KEY(message_id) REFERENCES chat_messages(id)
);

CREATE TABLE message_reactions (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(message_id, player_id, emoji),
  FOREIGN KEY(message_id) REFERENCES chat_messages(id)
);
```

## API Surface
```javascript
class ChatService {
  // Messaging
  sendMessage(senderId, channelType, channelId, message) -> { messageId, deliveredTo }
  editMessage(messageId, newText) -> void
  deleteMessage(messageId) -> void
  getMessage(messageId) -> { sender, channel, message, timestamp }

  // Channels
  getChannelMessages(channelType, channelId, limit = 50, before = null) -> [messages]
  subscribeChannel(playerId, channelType, channelId) -> unsubscribe

  // Whispers
  sendWhisper(senderId, recipientId, message) -> { messageId }
  getWhisperHistory(playerId, otherId, limit = 50) -> [messages]

  // Moderation
  censormessage(messageId, reason) -> void
  uncensorMessage(messageId) -> void
  mutePlayer(playerId, durationMs) -> void
  banPlayer(playerId, durationMs, reason) -> void

  // Reactions
  addReaction(messageId, playerId, emoji) -> void
  removeReaction(messageId, playerId, emoji) -> void
  getReactions(messageId) -> [{ emoji, count }]

  // Searching
  searchMessages(query, channelType = null) -> [messages]
  getMessageStats(playerId) -> { messagesCount, warnings, mutes }
}
```

## Message Content Filtering
```javascript
const FILTER_RULES = {
  profanity: {
    keywords: ['bad_word1', 'bad_word2'],
    action: 'censor',
    replacement: '****'
  },
  spam: {
    limit: 5,
    timeWindow: 10000,  // 10 seconds
    action: 'mute',
    duration: 60000
  },
  excessive_caps: {
    threshold: 0.8,  // 80% caps
    action: 'warn'
  },
  urls: {
    allowed_domains: ['twitch.tv', 'youtube.com'],
    action: 'warn'
  }
}
```

## Channel Rules
- **Global**: All players, slowmode 2 seconds
- **Team**: Team members only, no rate limit
- **Clan**: Clan members only, no rate limit
- **Whisper**: 1-to-1 private messages
- **Tournament**: Tournament broadcast channel (organized only)

## Message Format Support
```
**bold**
*italic*
~~strikethrough~~
`code`
# Heading
- Bullet point
> Quote

Emojis: :100: :fire: :smile:
```

## Moderation Actions
- **Warning**: Player notified of rule violation
- **Censored**: Message hidden, replaced with [CENSORED]
- **Mute**: Player can't send messages for duration
- **Ban**: Permanent mute, appealable
- **Shadow ban**: Messages sent but not visible to others

## Integration Points
- **GameServer**: Route messages between players
- **ModerationService**: Content filtering and enforcement
- **AnalyticsService**: Track messaging patterns
- **StreamingService**: Chat overlay for streamers
- **NotificationService**: Alert on direct messages

## Implementation Roadmap (Future)
1. Design chat database schema
2. Implement message routing
3. Build content filtering
4. Create rate limiting
5. Implement message reactions
6. Build search functionality
7. Add moderation admin tools

## Dependencies
- SQL database
- Message queue (Redis) for real-time
- Content moderation API (IBM Watson, AWS Comprehend)
- Full-text search (Elasticsearch)

## Risk Assessment
- **Harassment**: Toxic messages in chat cause player harm
- **NSFW content**: Explicit content violates policies
- **Phishing**: Messages trick players into clicking malicious links
- **Spam farming**: Bots flood chat with advertisements
- **Privacy leaks**: Players share sensitive info in chat

## Alternatives Considered
- **No chat**: Simpler but reduces social engagement
- **Voice only**: Accessible but more resource intensive
- **Discord integration**: Outsource to Discord (requires account)
