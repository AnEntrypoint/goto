# BUG #1864: Social Features Framework

## Overview
Framework for friend lists, player comparisons, and social discovery within the game.

## User Stories
- Players can add/remove friends by username or ID
- Players see friend status (online/offline/in-game)
- Players view friends' profiles and recent scores
- Players can compare stats with specific friends
- Friend activity feed shows recent games and achievements
- Block feature prevents communication with specific players

## Technical Requirements
- **Friend relationship storage**: Directional links (A follows B, B follows A = friend)
- **Presence tracking**: Know when friends are online/playing
- **Activity feed**: Timeline of friend actions
- **Statistics comparison**: Side-by-side friend stats
- **Request system**: Optional friend approval workflow
- **Blocking**: Prevent communication/visibility
- **Notifications**: Notify when friend comes online

## Data Schema
```sql
CREATE TABLE friendships (
  id UUID PRIMARY KEY,
  initiator_id VARCHAR(256) NOT NULL,
  friend_id VARCHAR(256) NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(initiator_id, friend_id),
  CHECK(status IN ('pending', 'accepted', 'declined', 'blocked'))
);

CREATE TABLE friend_activity (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  metadata JSON NOT NULL,
  timestamp BIGINT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE player_blocks (
  id UUID PRIMARY KEY,
  blocker_id VARCHAR(256) NOT NULL,
  blocked_id VARCHAR(256) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE player_presence (
  player_id VARCHAR(256) PRIMARY KEY,
  status VARCHAR(16) NOT NULL,
  game_id VARCHAR(64),
  stage INT,
  last_seen BIGINT NOT NULL,
  CHECK(status IN ('online', 'offline', 'in_game', 'away'))
);
```

## Friendship Status Flow
- **Pending**: Initiator sent request, awaiting approval
- **Accepted**: Mutual friendship established
- **Declined**: Recipient rejected request
- **Blocked**: Either player blocked, prevents interaction

## Activity Feed Events
- **game_completed**: { stage, score, time_ms }
- **achievement_unlocked**: { achievement_id, rarity }
- **score_posted**: { stage, score, rank }
- **came_online**: { timestamp }
- **joined_game**: { game_type, player_count }

## API Surface
```javascript
class SocialService {
  // Friend management
  sendFriendRequest(userId, targetId) -> { status: 'pending' }
  acceptFriendRequest(userId, friendId) -> { status: 'accepted' }
  declineFriendRequest(userId, friendId) -> void
  removeFriend(userId, friendId) -> void

  // Friend querying
  getFriendsList(userId) -> [{ id, username, status, lastSeen }]
  getPendingRequests(userId) -> [{ id, username, sentAt }]
  getFriendStatus(userId, friendId) -> 'online' | 'offline' | 'in_game'

  // Activity feed
  getFriendActivity(userId, limit = 50) -> [{ friendId, action, metadata, timestamp }]
  reportActivity(userId, action, metadata) -> void

  // Statistics
  comparePlayers(userId1, userId2) -> { scores, achievements, stats }
  getMutualFriends(userId1, userId2) -> [{ id, username }]

  // Blocking
  blockPlayer(userId, blockId) -> void
  unblockPlayer(userId, blockId) -> void
  isBlocked(userId, blockId) -> boolean

  // Presence
  updatePresence(userId, status, metadata) -> void
  getPresence(userId) -> { status, inGame, lastSeen }
}
```

## Integration Points
- **GameServer**: Report game events to activity feed
- **AuthService**: User identification and authentication
- **NotificationService**: Notify on friend actions
- **ProfileService**: Display social stats on profiles
- **RealTimeService**: Push updates for presence changes

## Implementation Roadmap (Future)
1. Design social database schema
2. Implement friendship management API
3. Build presence tracking system
4. Create activity feed processor
5. Add notification triggers
6. Build social discovery UI
7. Implement blocking and reporting

## Dependencies
- SQL database
- Real-time messaging (WebSocket)
- User authentication
- Notification service

## Risk Assessment
- **Spam/harassment**: Unfriending and re-adding enables message spam loops
- **Privacy**: Activity feed reveals when player is online
- **Stalking**: Friends list enables player tracking without consent
- **Bot farms**: Mass friend-adding for social engineering

## Alternatives Considered
- **Follow-only model**: One-directional follows (Twitter style)
- **Guild-only**: Restrict social features to organized groups
- **Nickname-based**: Anonymize friendships, use unique IDs only
