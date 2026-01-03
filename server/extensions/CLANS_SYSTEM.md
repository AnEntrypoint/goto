# BUG #1879: Clans System Framework

## Overview
Framework for player organizations (guilds/clans) with membership, leveling, territories, and cooperative events.

## User Stories
- Players create clans with unique names and tags
- Members join clans and contribute to clan level
- Clan quests grant rewards to entire clan
- Clans compete for territories with rewards
- Clan storage holds shared cosmetics
- Clans earn collective bonuses (XP boost, etc)

## Technical Requirements
- **Clan management**: Create, join, leave, disband
- **Membership tiers**: Owner, officer, member roles with permissions
- **Clan leveling**: Accumulate points from member activities
- **Clan perks**: Passive bonuses unlocked at clan levels
- **Treasury**: Shared currency pool
- **Communication**: Clan-only chat channel
- **Territory system**: Clans claim map regions
- **Clan wars**: Scheduled competitive battles

## Data Schema
```sql
CREATE TABLE clans (
  id UUID PRIMARY KEY,
  name VARCHAR(256) NOT NULL UNIQUE,
  tag VARCHAR(4) NOT NULL UNIQUE,
  owner_id VARCHAR(256) NOT NULL,
  description TEXT,
  level INT DEFAULT 1,
  experience INT DEFAULT 0,
  treasury INT DEFAULT 0,
  max_members INT DEFAULT 50,
  created_at BIGINT NOT NULL,
  disbanded_at BIGINT,
  is_open BOOLEAN DEFAULT true
);

CREATE TABLE clan_members (
  id UUID PRIMARY KEY,
  clan_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  role VARCHAR(16) NOT NULL,
  joined_at BIGINT NOT NULL,
  contribution_points INT DEFAULT 0,
  UNIQUE(clan_id, player_id),
  FOREIGN KEY(clan_id) REFERENCES clans(id),
  CHECK(role IN ('owner', 'officer', 'member'))
);

CREATE TABLE clan_perks (
  clan_id UUID PRIMARY KEY,
  level_unlocked INT NOT NULL,
  xp_bonus_percent INT DEFAULT 0,
  currency_bonus_percent INT DEFAULT 0,
  inventory_slots_bonus INT DEFAULT 0,
  FOREIGN KEY(clan_id) REFERENCES clans(id)
);

CREATE TABLE clan_territories (
  id UUID PRIMARY KEY,
  clan_id UUID NOT NULL,
  territory_id VARCHAR(64) NOT NULL,
  claimed_at BIGINT NOT NULL,
  weekly_reward INT NOT NULL,
  UNIQUE(territory_id),
  FOREIGN KEY(clan_id) REFERENCES clans(id)
);
```

## Clan Roles
- **Owner**: Full permissions, can disband, appoint officers
- **Officer**: Invite/remove members, manage treasury, post announcements
- **Member**: Contribute to clan level, participate in events, access chat

## Clan Leveling
```
Member activities grant clan experience:
  - Win game: +10 clan XP
  - Complete challenge: +20 clan XP
  - Unlock achievement: +50 clan XP
  - Join clan event: +5 clan XP

Level requirements (exponential):
  Level 1:  0 XP (start)
  Level 10: 10,000 XP
  Level 50: 500,000 XP
  Level 100: 5,000,000 XP
```

## Clan Perks
```
Level 5:  +5% XP for all members
Level 10: +10% currency gain for all members
Level 20: +5 inventory slots per member
Level 50: Daily login bonus +100 currency (clan-wide)
Level 100: Weekly cosmetic reward for top contributor
```

## API Surface
```javascript
class ClansService {
  // Clan management
  createClan(name, tag, owner) -> { clanId }
  joinClan(playerId, clanId) -> void
  leaveClan(playerId, clanId) -> void
  disbandClan(clanId) -> void

  // Membership
  getMemberRole(playerId, clanId) -> role
  setMemberRole(playerId, clanId, newRole) -> void
  getMembers(clanId) -> [{ playerId, role, contribution }]

  // Clan info
  getClan(clanId) -> { name, tag, level, members, perks }
  getClanStats(clanId) -> { totalXp, avgLevel, treasury, territories }

  // Clan activities
  awardClanXP(clanId, amount) -> { newLevel }
  depositTreaury(playerId, clanId, amount) -> void
  withdrawTreasury(playerId, clanId, amount) -> boolean

  // Territories
  claimTerritory(clanId, territoryId) -> void
  getTerritory(territoryId) -> { owner, reward, competes }
  getClanTerritories(clanId) -> [territories]

  // Clan wars
  getUpcomingClanWars(clanId) -> [wars]
  participateInWar(clanId, playerId) -> void

  // Statistics
  getClanLeaderboard(limit = 100) -> [{ rank, clanId, level, members }]
  getClanHistory(clanId, days = 30) -> [{ date, xpGained, members }]
}
```

## Territory System
- **16 territories**: Map divided into strategic regions
- **Control rewards**: 500 currency per week per controlled territory
- **War timing**: Territory wars every Sunday
- **Point system**: Territory control determines war outcome
- **Dominance bonus**: Clan controlling 8+ territories gets 50% bonus

## Clan Wars
- **Frequency**: Every Sunday 19:00 UTC
- **Duration**: 2 hours of gameplay
- **Format**: Points awarded per clan member win
- **Winning clan**: Controls disputed territory for next week
- **Rewards**: Winning clan gets 5000 treasury, loser gets 1000

## Clan Chat
- **Clan-only channel**: Members can communicate freely
- **Message history**: 100 messages stored
- **Moderation**: Officers can mute/ban members from chat
- **Mentions**: @player notifications in chat

## Integration Points
- **GameServer**: Award clan XP on events
- **CurrencyService**: Manage clan treasury
- **TerritoryService**: Manage territory control
- **ClanWarService**: Coordinate scheduled wars
- **ChatService**: Clan-only channels

## Implementation Roadmap (Future)
1. Design clan database schema
2. Implement clan CRUD operations
3. Build membership system
4. Create clan leveling
5. Implement territory control
6. Build clan war scheduling
7. Create clan UI and chat

## Dependencies
- SQL database
- Chat service
- Currency service
- War scheduling system

## Risk Assessment
- **Clan exclusivity**: Top clans create barriers to entry
- **Abandonment**: Clan leaders quit, clan becomes inactive
- **Pay-to-win perks**: Clans with money dominate
- **Territory farming**: Cooperation between clans to farm easy victories
- **Griefing**: Officers kick members, disrupt clans

## Alternatives Considered
- **Guilds without territories**: Simpler but less engagement
- **Player-vs-clan**: Only clan members vs independent (segregation)
- **No clan storage**: Purely social, no material benefit
