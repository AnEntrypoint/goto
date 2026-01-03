# BUG #1872: Tournament System Framework

## Overview
Framework for organizing competitive tournaments with brackets, scheduling, prizes, and spectator viewing.

## User Stories
- Admins create tournaments with entry fees/free
- Players register and are assigned to bracket
- Bracket matches scheduled and auto-start at time
- Winners advance to next round automatically
- Spectators watch live tournament with commentary
- Prize pool distributed based on placement

## Technical Requirements
- **Bracket management**: Single/double elimination, round-robin
- **Scheduling**: Automatic match timing with buffer between rounds
- **Player validation**: Anti-smurfing, rating requirements
- **Results verification**: Dispute system for controversial outcomes
- **Spectator mode**: View any match as read-only observer
- **Prize distribution**: Automatic payout on tournament conclusion
- **Replay archive**: Store all tournament replays

## Data Schema
```sql
CREATE TABLE tournaments (
  id UUID PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  organizer_id VARCHAR(256) NOT NULL,
  status VARCHAR(16) NOT NULL,
  bracket_type VARCHAR(32) NOT NULL,
  max_players INT NOT NULL,
  entry_fee INT DEFAULT 0,
  prize_pool INT NOT NULL,
  start_time BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CHECK(bracket_type IN ('single_elim', 'double_elim', 'round_robin')),
  CHECK(status IN ('draft', 'registration', 'active', 'complete'))
);

CREATE TABLE tournament_registrations (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  seed INT,
  paid_at BIGINT,
  withdrew_at BIGINT,
  UNIQUE(tournament_id, player_id),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE tournament_matches (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  round INT NOT NULL,
  position INT NOT NULL,
  player1_id VARCHAR(256),
  player2_id VARCHAR(256),
  winner_id VARCHAR(256),
  game_id VARCHAR(64),
  scheduled_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT,
  UNIQUE(tournament_id, round, position),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE tournament_prizes (
  id UUID PRIMARY KEY,
  tournament_id UUID NOT PRIMARY KEY,
  placement INT NOT NULL,
  amount INT NOT NULL,
  recipient_id VARCHAR(256),
  awarded_at BIGINT,
  UNIQUE(tournament_id, placement),
  FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
);
```

## Bracket Types
- **Single Elimination**: Lose once, eliminated. Fast, clear champion
- **Double Elimination**: Lose twice to be eliminated. More matches, fairness
- **Round Robin**: Everyone plays everyone. Most fair, O(n²) matches
- **Swiss System**: Adaptive pairings. Balanced fairness and speed

## API Surface
```javascript
class TournamentService {
  // Tournament management
  createTournament(name, bracketType, maxPlayers, entryFee, prizePool) -> { tournamentId }
  getTournament(tournamentId) -> { name, status, players, schedule }
  updateTournamentStatus(tournamentId, status) -> void
  cancelTournament(tournamentId) -> void

  // Registration
  registerPlayer(tournamentId, playerId) -> { seed, cost }
  withdrawPlayer(tournamentId, playerId) -> { refund }
  getRegistrations(tournamentId) -> [{ playerId, seed }]

  // Bracket management
  generateBracket(tournamentId) -> [matches]
  getMatches(tournamentId, round = null) -> [matches]
  reportResult(tournamentId, matchId, winnerId) -> { nextMatch }
  protestResult(matchId, reason) -> void

  // Spectating
  spectateMatch(matchId) -> { gameId, players }
  getSpectators(matchId) -> [{ viewerId, username }]

  // Prizes
  getPrizeDistribution(tournamentId) -> [{ placement, amount }]
  claimPrize(tournamentId, playerId) -> { amount }
  getPlayerPrizes(playerId) -> [{ tournament, amount, claimed }]

  // Reporting
  getTournamentStats(tournamentId) -> { matches, avgGameTime, upsets }
}
```

## Seeding Strategy
- **Rating-based**: Top-rated players placed 1, 2, 5, 6, etc. (reduce early rematches)
- **Random**: No advantage to high-rated players
- **Geographic**: Match same region to reduce latency
- **Hybrid**: Combine rating and geography

## Match Timing
- **Best of**: Single game vs best-of-3
- **Scheduling**: 30 min buffer between rounds for breaks
- **Timeout**: Auto-advance if player doesn't show after 10 min
- **Concurrent**: Multiple matches in same round run simultaneously

## Dispute System
- **Challenge period**: 1 hour after match to protest
- **Admin review**: Admins can request replay analysis
- **Replay verification**: Check if reported result matches game replay
- **Reversal cost**: Players can submit protest (costs entry fee if denied)

## Integration Points
- **GameServer**: Create special tournament game instances
- **PaymentService**: Collect entry fees, distribute prizes
- **NotificationService**: Alert players of match scheduling
- **AnalyticsService**: Track tournament engagement
- **ReplayService**: Archive tournament matches

## Implementation Roadmap (Future)
1. Design bracket algorithms
2. Implement tournament database schema
3. Build registration system
4. Create bracket generator
5. Implement match scheduling
6. Build spectator mode
7. Create prize distribution

## Dependencies
- SQL database
- Bracket algorithm library
- Payment processing
- Replay storage

## Risk Assessment
- **Match fixing**: Collusion to rig results for prize money
- **Cheating detection**: Anti-cheat for tournament integrity
- **Refund disputes**: Chargebacks on entry fees
- **Schedule conflicts**: Players can't make match times
- **Rage quits**: Players abandon matches mid-tournament

## Alternatives Considered
- **Community-run**: Let streamers organize tournaments (moderation burden)
- **Decentralized**: Blockchain-based prizes (regulatory issues)
- **Continuous ladder**: No brackets, just rating system (less excitement)
