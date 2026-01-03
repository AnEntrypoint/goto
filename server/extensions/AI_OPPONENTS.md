# BUG #1886: AI Opponents Framework

## Overview
Framework for NPC opponents with scalable difficulty levels, behavior trees, and learning from player patterns.

## User Stories
- Players face NPC opponents at various difficulties
- AI adapts to player skill level (rubber-banding)
- AI has distinct personalities (aggressive, defensive, erratic)
- Players can practice against AI without ranking impact
- AI opponents teach game strategies
- Tournaments can use AI for bracket fillers

## Technical Requirements
- **Behavior trees**: Decision-making system for AI
- **Difficulty scaling**: Adjust decision quality, reaction time
- **Personality types**: Different playstyles (aggressive, cautious)
- **Learning**: Observe player patterns and adapt
- **Predictor**: Anticipate player moves 1-2 frames ahead
- **Rubber-banding**: Stay competitive with player skill
- **Reproducibility**: Deterministic AI for testing

## Data Schema
```sql
CREATE TABLE ai_opponents (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  difficulty INT NOT NULL,
  personality VARCHAR(32) NOT NULL,
  win_rate_target FLOAT DEFAULT 0.4,
  behavior_config JSON NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE ai_matches (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  ai_id VARCHAR(64) NOT NULL,
  difficulty INT NOT NULL,
  player_score INT NOT NULL,
  ai_score INT NOT NULL,
  winner_id VARCHAR(256) NOT NULL,
  match_data JSON NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE ai_performance (
  id UUID PRIMARY KEY,
  ai_id VARCHAR(64) NOT NULL,
  difficulty INT NOT NULL,
  avg_win_rate FLOAT NOT NULL,
  avg_score INT NOT NULL,
  win_consistency FLOAT NOT NULL,
  last_updated BIGINT NOT NULL
);
```

## Difficulty Levels
- **Novice** (0): 30% win rate, obvious moves, slow reaction
- **Intermediate** (1): 40% win rate, basic strategy, normal reaction
- **Advanced** (2): 50% win rate, adaptive strategy, fast reaction
- **Expert** (3): 60% win rate, perfect reads, prediction
- **Grandmaster** (4): 70% win rate, learning from player, optimized

## Personality Types
- **Aggressive**: Takes risks, attacks early, high damage output
- **Defensive**: Plays safe, avoids risks, focuses on survival
- **Balanced**: Even playstyle, adapts to opponent
- **Erratic**: Unpredictable, occasional crazy decisions
- **Evasive**: Prioritizes running away, avoids conflict

## Behavior Tree Structure
```javascript
const BEHAVIOR_TREE = {
  root: {
    type: 'selector',
    children: [
      { type: 'condition', check: 'is_hurt', action: 'flee' },
      { type: 'condition', check: 'can_attack', action: 'attack' },
      { type: 'condition', check: 'is_blocked', action: 'jump' },
      { type: 'action', action: 'move_toward_goal' }
    ]
  }
}
```

## API Surface
```javascript
class AIOpponentService {
  // Opponent selection
  getAvailableAI(playerLevel) -> [{ id, name, difficulty, personality }]
  getAI(aiId) -> { name, difficulty, personality, stats }

  // Match creation
  createAIMatch(playerId, aiId, difficulty) -> { matchId }
  getAIMatchResult(matchId) -> { winner, playerScore, aiScore, analysis }

  // Difficulty matching
  getRecommendedDifficulty(playerId) -> { difficulty, expectedWinRate }
  adjustDifficulty(playerId, feedback) -> newDifficulty

  // AI configuration
  createCustomAI(config) -> { aiId }
  setPersonality(aiId, personality) -> void
  setBehavior(aiId, behaviorTree) -> void

  // Performance tracking
  getAIStats(aiId, difficulty) -> { winRate, avgScore, consistency }
  getPlayerVsAIStats(playerId) -> { wins, losses, avgScore }

  // Learning
  trainAI(aiId, matchData) -> void
  updateAIBehavior(aiId, observations) -> void
}
```

## Decision Making Process
```
Every 4 frames (on fixed_update):
1. Observe game state (player pos, health, enemies)
2. Run behavior tree
3. Select action with confidence score
4. Execute action (move, jump, defend)
5. Learn from outcome if training
```

## Learning Algorithm
```javascript
const LEARNING_PROCESS = {
  observe: (playerPosition, velocity, health) => ({
    context: { pos: playerPosition, vel: velocity, health }
  }),

  predict: (playerContext) => {
    // Based on previous patterns, estimate next move
    return { predictedPos, confidence };
  },

  decide: (observation, prediction, difficulty) => {
    // Select action based on behavior tree and difficulty
    return { action, confidence };
  },

  learn: (outcome, expectedOutcome) => {
    // Adjust decision probabilities
    updateBehaviorWeights(outcome, expectedOutcome);
  }
}
```

## Rubber-Banding System
```javascript
const RUBBER_BAND_SCALING = {
  // If AI winning by too much, reduce difficulty
  player_behind_50_percent: { reduce_difficulty: 0.1 },
  // If player winning, increase AI difficulty
  ai_behind_75_percent: { increase_difficulty: 0.2 },
  // Smoothly converge toward target win rate
  converge_to_target: (currentWinRate, targetWinRate) => {
    return (targetWinRate - currentWinRate) * 0.1;
  }
}
```

## AI Personalities
```javascript
const PERSONALITIES = {
  aggressive: {
    risk_tolerance: 0.9,
    attack_priority: 0.9,
    defense_priority: 0.3,
    movement_speed: 1.2
  },
  defensive: {
    risk_tolerance: 0.2,
    attack_priority: 0.3,
    defense_priority: 0.9,
    movement_speed: 1.0
  },
  balanced: {
    risk_tolerance: 0.5,
    attack_priority: 0.5,
    defense_priority: 0.5,
    movement_speed: 1.0
  }
}
```

## Integration Points
- **GameServer**: Special game mode for AI matches
- **MatchHistoryService**: Track AI matches separately
- **AnalyticsService**: Monitor AI performance and winrates
- **TrainingService**: Use AI for training players
- **BehaviorTreeLibrary**: Manage behavior trees

## Implementation Roadmap (Future)
1. Design behavior tree system
2. Implement basic decision-making
3. Create personality types
4. Add difficulty scaling
5. Implement rubber-banding
6. Create learning system
7. Balance AI for target win rates

## Dependencies
- Behavior tree library
- Decision-making framework
- Machine learning library (optional)
- Physics simulation

## Risk Assessment
- **Unfair advantages**: AI reads input faster than human can react
- **Predictability**: Players learn AI patterns, always beat them
- **Frustration**: Rubber-banding feels cheap when detected
- **Compute cost**: Running multiple AI simultaneously expensive
- **Balancing nightmare**: Each difficulty level needs tuning

## Alternatives Considered
- **No AI**: Only PvP, simpler (no single-player option)
- **Scripted AI**: Fixed patterns, no adaptation (boring)
- **Neural network**: Complex, hard to debug and balance
- **Random AI**: No intelligent decisions (trivial to beat)
