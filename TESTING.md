# Ice Climber .io - Execution-Based Testing Guide

Comprehensive testing procedures using game server REPL, HTTP API inspection, and observability metrics. All tests are execution-based (NO test files, NO mocks, NO test runners).

## Quick Start

```bash
# Terminal 1: Start server
NODE_ENV=development PORT=3008 node server/index.js

# Terminal 2: Run tests
curl http://localhost:3008/health
node scripts/test-e2e.js
```

## Testing Methodology

- **Execution-first**: All tests run actual game, observe real behavior
- **REPL queries**: Use HTTP API endpoints to inspect live game state
- **Observability logs**: Monitor frame logs and metrics
- **No mocks**: All verification through real server responses
- **Observable output**: Every test produces measurable results

## Test Procedures

### BUG #1781: End-to-End Test Procedure

**Objective**: Verify complete game flow from start to completion.

**Setup**:
```bash
# Terminal: Start server
NODE_ENV=development PORT=3008 node server/index.js

# Verify health check
curl http://localhost:3008/health
```

**Steps**:
1. Load stage 1: `curl http://localhost:3008/api/stage/1`
2. Spawn player: `curl -X POST http://localhost:3008/api/spawn/player -H "Content-Type: application/json" -d '{"x": 640, "y": 700}'`
3. Query player: `curl http://localhost:3008/api/actor/player_1`
4. Send 60 frames of RIGHT input: 60 frames at 60 FPS = 1 second
5. Check position moved: `curl http://localhost:3008/api/actor/player_1`
6. Move to goal: Continue input until x > 600, y < 100
7. Verify goal registered: Check `/api/actor/player_1` for score increment

**Expected Result**:
- Player spawns at x=640, y=700
- After 1 second RIGHT input, player x > 640 (moved right)
- Player reaches goal (x≈640, y≈40)
- Score increments to 1
- Stage remains 1 (can replay)

**Pass/Fail**:
- PASS: All steps complete without errors, score increments
- FAIL: Player doesn't move, goal doesn't register, or score stays 0

---

### BUG #1782: Input Validation Test Procedure

**Objective**: Verify all input boundaries enforced correctly.

**Test 1: Direction Range**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": -1}' # Valid: -1

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": 0}' # Valid: 0

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": 1}' # Valid: 1

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": 2}' # Invalid: > 1

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": -2}' # Invalid: < -1
```

**Test 2: Player ID Range**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 0, "direction": 1}' # Edge: minimum

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 999999, "direction": 1}' # Edge: very large

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": -1, "direction": 1}' # Invalid: negative
```

**Test 3: Action Whitelist**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "action": "jump"}' # Valid action

curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "action": "teleport"}' # Invalid action
```

**Expected Result**:
- Valid ranges: Accepted and processed
- Invalid ranges: Rejected with error code
- Actions outside whitelist: Rejected with error code

**Pass/Fail**:
- PASS: Valid inputs accepted, invalid inputs rejected with appropriate errors
- FAIL: Invalid inputs accepted or valid inputs rejected

---

### BUG #1783: State Consistency Verification

**Objective**: Verify game state doesn't corrupt over extended play.

**Steps**:
1. Spawn player: `curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 700}'`
2. Get initial state checksum: `curl http://localhost:3008/api/actor/player_1`
3. Play for 100 frames (1.67 seconds) with continuous RIGHT input
4. Query state: `curl http://localhost:3008/api/actor/player_1`
5. Verify: All fields are valid (no NaN, Infinity, out-of-bounds values)
6. Repeat for 1000 frames total

**State Validity Checks**:
- `x` in range [0, 1280]
- `y` in range [0, 1000]
- `vel_x` in range [-200, 200]
- `vel_y` in range [-450, 800]
- `lives` in range [0, 3]
- `score` in range [0, 999999]
- All boolean fields are true or false

**Expected Result**:
- State remains valid throughout 1000 frames
- No NaN, Infinity, or undefined values
- All numeric values in valid ranges
- Lives never go negative or exceed maximum

**Pass/Fail**:
- PASS: State valid at every 100-frame interval through 1000 frames
- FAIL: Any invalid value detected or state outside ranges

---

### BUG #1784: Collision Detection Verification

**Objective**: Verify collision detection works correctly in all scenarios.

**Test 1: Player-Platform Collision**
```bash
# Spawn player at (640, 690) - slightly above platform at y=680
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 690}'

# Wait 1 frame (16.67ms) for gravity to apply
sleep 0.1

# Query player - should be on ground
curl http://localhost:3008/api/actor/player_1
# Expected: on_ground=true
```

**Test 2: Player-Enemy Collision**
```bash
# Spawn player at (200, 568)
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 200, "y": 568}'

# Spawn enemy at same position
curl -X POST http://localhost:3008/api/spawn/enemy -d '{"x": 200, "y": 568}'

# Wait 1 frame
sleep 0.1

# Query player - should have taken damage (lives < 3)
curl http://localhost:3008/api/actor/player_1
# Expected: invulnerable=true (grace period), respawn pending
```

**Test 3: Goal Collision**
```bash
# Spawn player at (640, 100) - near goal at (640, 40)
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 100}'

# Move player down with gravity + jump up to goal
# Use multiple frames to approach goal

# Query player - should have score=1
curl http://localhost:3008/api/actor/player_1
# Expected: score=1
```

**Test 4: Breakable Platform Collision**
```bash
# Spawn player at (200, 460) - above breakable platform
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 200, "y": 460}'

# Jump on platform (land)
# Query platform_breakable_1

# Jump again (2nd hit)
# Jump again (3rd hit - should break)

# After 3 jumps, query player position
# Expected: player should fall through (y > 500)
```

**Pass/Fail**:
- PASS: All collision scenarios trigger correct behavior
- FAIL: Any collision not detected or wrong behavior triggered

---

### BUG #1785: Physics Simulation Verification

**Objective**: Verify gravity, velocity, and position calculations are correct.

**Test 1: Gravity Application**
```bash
# Spawn player in air at (640, 100)
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 100}'

# Get frame number: curl http://localhost:3008/api/status
# Record: y_start=100, frame_start=N

# Wait 60 frames (1 second)
sleep 1.1

# Query player: curl http://localhost:3008/api/actor/player_1
# Calculate: y_delta = y_current - y_start
# Physics: y_delta = 0.5 * gravity * time^2 = 0.5 * 1200 * 1^2 = 600
# Expected: y_current ≈ 100 + 600 = 700 (or platform collision)
```

**Test 2: Jump Impulse**
```bash
# Spawn player at (640, 680) - on ground
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 680}'

# Wait 1 frame to stabilize
sleep 0.1

# Apply jump: vel_y = -450 (upward)
# Query actor to verify on_ground=true, then trigger jump

# After 1 frame: y should be: 680 + (-450 * dt) = 680 - 450*0.0167 ≈ 680 - 7.5 = 672.5
# Expected: y < 680 (player rises)
```

**Test 3: Terminal Velocity**
```bash
# Spawn player at (640, 0) - very high
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 0}'

# Wait 10 seconds (600 frames)
sleep 10.1

# Query player: vel_y should not exceed MAX_FALL_SPEED (800)
# Expected: vel_y ≤ 800
```

**Test 4: Horizontal Movement**
```bash
# Spawn player at (640, 680)
curl -X POST http://localhost:3008/api/spawn/player -d '{"x": 640, "y": 680}'

# Send RIGHT input (direction=1) for 60 frames
# Expected: x increases by player_speed * time = 200 * 1 = 200
# So x should be ≈ 640 + 200 = 840
```

**Pass/Fail**:
- PASS: Physics calculations match expected values (within ±2 pixels)
- FAIL: Physics off by >2 pixels or terminal velocity exceeded

---

### BUG #1786: Networking Latency Simulation

**Objective**: Verify game handles high latency (500ms+) without issues.

**Steps**:
1. Spawn player: `curl -X POST http://localhost:3008/api/spawn/player`
2. Send input
3. Artificially delay responses by 500ms (use network proxy or client-side delay)
4. Verify player still moves smoothly despite latency
5. Check no buffered messages are lost

**Expected Result**:
- Player movement continues despite 500ms latency
- No "stuck" frames
- No message loss (all inputs processed)
- State converges to correct position after latency

**Pass/Fail**:
- PASS: Game plays smoothly with 500ms latency, no visual artifacts
- FAIL: Player movement jitters, stutters, or messages lost

---

### BUG #1787: Packet Loss Simulation

**Objective**: Verify packet loss recovery works correctly.

**Steps**:
1. Spawn player with movement input
2. Drop 10% of messages (use network proxy: `toxiproxy` or client-side random drop)
3. Continue playing for 60 frames
4. Verify final position is correct despite packet loss

**Expected Result**:
- Most inputs processed despite 10% loss
- Game state eventually consistent
- No crashes or hangs from dropped messages

**Pass/Fail**:
- PASS: Game handles 10% packet loss, final state correct
- FAIL: Crash, hang, or final state incorrect

---

### BUG #1788: Concurrent Player Load Test

**Objective**: Verify game works with 100 concurrent players.

**Steps**:
1. Spawn 100 players via sequential API calls:
```bash
for i in {1..100}; do
  curl -X POST http://localhost:3008/api/spawn/player \
    -H "Content-Type: application/json" \
    -d "{\"x\": $((640 + i*10)), \"y\": 700}" &
done
wait
```

2. Query all players: `curl http://localhost:3008/api/actors`
3. Send movement input to 50 random players
4. Play for 600 frames (10 seconds)
5. Verify no crashes, all players present

**Expected Result**:
- All 100 players spawn successfully
- No crashes or timeouts
- Game continues to tick at 60 FPS
- CPU/memory reasonable (see BUG #1790, #1789)

**Pass/Fail**:
- PASS: 100 players spawn and play without issues
- FAIL: Any crash, timeout, or players missing

---

### BUG #1789: Memory Leak Test

**Objective**: Verify memory usage remains stable over 8 hours.

**Steps**:
1. Start server with memory monitoring:
```bash
NODE_ENV=development PORT=3008 node --max-old-space-size=2048 server/index.js &
GAME_PID=$!
```

2. Monitor memory every minute:
```bash
for i in {1..480}; do
  ps -p $GAME_PID -o rss= | awk '{print $1/1024 " MB"}'
  sleep 60
done
```

3. Run continuous game activity:
   - Spawn 50 players
   - Send input every frame
   - Play stages 1-4 repeatedly
   - Disconnect/reconnect players

4. After 8 hours, check memory growth:
```bash
memory_growth_pct = (final_memory - initial_memory) / initial_memory * 100
# Expected: < 10%
```

**Expected Result**:
- Initial memory: ~100 MB
- After 8 hours: < 110 MB (10% growth)
- No memory spikes or leaks
- Garbage collection working

**Pass/Fail**:
- PASS: Memory growth < 10% over 8 hours
- FAIL: Memory growth > 10% or memory spikes detected

---

### BUG #1790: CPU Usage Profiling

**Objective**: Establish CPU usage baseline and detect performance cliffs.

**Steps**:
1. Start server with CPU profiling:
```bash
NODE_ENV=development PORT=3008 node --prof server/index.js
```

2. Run game with 0, 10, 50, 100 players:
```bash
# Baseline (0 players): 5% CPU
# 10 players: 8-10% CPU
# 50 players: 25-30% CPU
# 100 players: 40-45% CPU
```

3. After 5 minutes per load level, stop and analyze:
```bash
node --prof-process isolate-*.log > profile.txt
grep "Ticks\|Total" profile.txt
```

4. Check CPU usage via top/Activity Monitor/Task Manager

**Expected Result**:
- 0 players: 5% CPU
- 10 players: 10% CPU (scales linearly)
- 50 players: 30% CPU
- 100 players: < 50% CPU (no performance cliff at 100 players)

**Pass/Fail**:
- PASS: CPU usage scales linearly, no cliff at 100 players
- FAIL: CPU spikes to 100% at any load level

---

### BUG #1791: Network Traffic Measurement

**Objective**: Characterize network usage and compression effectiveness.

**Steps**:
1. Monitor network bytes/sec:
```bash
# Use: tcpdump, wireshark, or application metrics

curl http://localhost:3008/api/observability | jq '.network'
# Shows: bytes_sent, messages_sent, success_rate

# Expected: ~1000 bytes/sec for 100 players at 60 FPS
# = 100 players * 60 updates/sec * (10 bytes/update) = 60,000 bytes/sec
# With compression (50%): 30,000 bytes/sec
```

2. Test compression ratio:
```bash
# Without compression: 100 players update = 10KB per second
# With compression: should be 5KB per second (50% ratio)
```

**Expected Result**:
- Baseline: 30 bytes per message
- 100 players: 1800 bytes/sec uncompressed
- 100 players with compression: 900 bytes/sec (50% ratio)
- Compression ratio > 40% on typical messages

**Pass/Fail**:
- PASS: Network usage measured, compression > 40%
- FAIL: No compression or compression < 20%

---

### BUG #1792: Latency SLA Verification

**Objective**: Verify message round-trip time (RTT) meets SLA (p99 < 100ms).

**Steps**:
1. Send 1000 timestamped messages and measure response time:
```javascript
const times = [];
for (let i = 0; i < 1000; i++) {
  const t0 = Date.now();
  await sendInput(playerId, direction);
  const rtt = Date.now() - t0;
  times.push(rtt);
  await sleep(50); // Space out messages
}

times.sort((a, b) => a - b);
const p50 = times[500];
const p95 = times[950];
const p99 = times[990];
console.log(`[SLA] p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`);
```

**Expected Result**:
- p50 (median): < 20ms
- p95: < 50ms
- p99: < 100ms (SLA)
- No timeouts or lost messages

**Pass/Fail**:
- PASS: p99 < 100ms
- FAIL: p99 > 100ms or any timeouts

---

### BUG #1793: Frame Rate Stability Test

**Objective**: Verify game runs at stable 60 FPS, no dips.

**Steps**:
1. Monitor frame count over 60 seconds:
```bash
curl http://localhost:3008/api/status | jq '.frame' > frame0.txt
sleep 1
curl http://localhost:3008/api/status | jq '.frame' > frame1.txt

# Expected frame increase: 60 frames/second
# frame1 - frame0 should be 60 ±5
```

2. Repeat for 60 seconds, recording frame delta every second
3. Calculate frame deltas: [60, 61, 59, 60, ...]
4. Check variance

**Expected Result**:
- Frame delta per second: 60 ±5 (FPS variance < 10%)
- No frame drops below 55 FPS
- Consistent throughput over time

**Pass/Fail**:
- PASS: Frame rate stable at 60 ±5 FPS for full 60 seconds
- FAIL: Any FPS dip below 55 or variance > 15%

---

### BUG #1794: Timeout Behavior Test

**Objective**: Verify idle clients are cleaned up after 300s (5 minutes).

**Steps**:
1. Spawn player: `curl -X POST http://localhost:3008/api/spawn/player`
2. Get player_id from response
3. Don't send any input or heartbeat for 301 seconds
4. Check if client is still active: `curl http://localhost:3008/api/actor/player_1`

**Expected Result**:
- Player is active for first 300 seconds
- After 301 seconds, client is disconnected
- Player actor removed from game
- Memory freed

**Pass/Fail**:
- PASS: Client automatically disconnected after 300s inactivity
- FAIL: Client stays connected or takes > 310s to disconnect

---

### BUG #1795: Recovery Behavior Test

**Objective**: Verify server recovers correctly from errors.

**Steps**:
1. Spawn player and play normally
2. Send malformed message (invalid JSON): `curl -X POST ... -d '{invalid'`
3. Server should handle gracefully
4. Send valid message next: `curl -X POST http://localhost:3008/api/input ...`
5. Verify game continues and player responds

**Expected Result**:
- Malformed message is rejected with error
- Valid message after error is processed correctly
- No server crash or state corruption
- Other players unaffected

**Pass/Fail**:
- PASS: Server recovers from error, continues normally
- FAIL: Server crashes, state corrupted, or hangs

---

### BUG #1796: Data Persistence Verification

**Objective**: Verify player data is saved and restored across restarts.

**Steps**:
1. Spawn player and reach score=50: Play and score
2. Get player state: `curl http://localhost:3008/api/actor/player_1`
   - Record: player_id=1, score=50
3. Stop server: `pkill -f "node server/index.js"`
4. Wait 5 seconds
5. Restart server: `NODE_ENV=development PORT=3008 node server/index.js`
6. Query leaderboard: `curl http://localhost:3008/api/leaderboard`
7. Check if player_1 with score=50 is present

**Expected Result**:
- Before restart: score=50 recorded
- After restart: score=50 still present in leaderboard
- Player ranking persisted

**Pass/Fail**:
- PASS: Score persisted across restart
- FAIL: Score lost after restart or leaderboard empty

---

### BUG #1797: Leaderboard Correctness Test

**Objective**: Verify leaderboard order and completeness.

**Steps**:
1. Spawn 5 players:
```bash
player_1: score 100
player_2: score 50
player_3: score 200
player_4: score 75
player_5: score 150
```

2. Query leaderboard: `curl http://localhost:3008/api/leaderboard`
3. Verify order is descending by score
4. Verify all 5 players present

**Expected Result**:
```
[
  { player_id: 3, score: 200 },
  { player_id: 5, score: 150 },
  { player_id: 1, score: 100 },
  { player_id: 4, score: 75 },
  { player_id: 2, score: 50 }
]
```

**Pass/Fail**:
- PASS: Leaderboard sorted correctly, all players present
- FAIL: Wrong order, missing players, or duplicate players

---

### BUG #1798: Race Condition Detection

**Objective**: Verify no race conditions occur under concurrent access.

**Steps**:
1. Spawn player with lives=3
2. Send 100 concurrent damage events (via WebSocket or rapid API calls)
3. Each should decrement lives by 1 (with invulnerability grace period)
4. Repeat 100 times
5. Check final lives value is deterministic

**Expected Result**:
- All 100 runs produce same final lives value
- No nondeterministic jumps in score or lives
- State transitions are atomic

**Pass/Fail**:
- PASS: Deterministic result all 100 runs
- FAIL: Different final state in different runs (race condition)

---

### BUG #1799: Security Vulnerability Test

**Objective**: Verify input validation blocks injection attacks.

**Test 1: SQL Injection**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": "1; DROP TABLE players;", "direction": 1}'

# Expected: Error, not SQL execution
```

**Test 2: Buffer Overflow**
```bash
# Send very large direction value
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "direction": 99999999999999999999}'

# Expected: Validation error, not buffer overflow
```

**Test 3: Type Confusion**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": "not_a_number", "direction": true}'

# Expected: Type validation error
```

**Test 4: Prototype Pollution**
```bash
curl -X POST http://localhost:3008/api/input \
  -H "Content-Type: application/json" \
  -d '{"player_id": 1, "__proto__": {"admin": true}}'

# Expected: Property ignored, not polluted
```

**Expected Result**:
- All injection attempts blocked
- No arbitrary code execution
- No state corruption from malformed input

**Pass/Fail**:
- PASS: All attacks blocked successfully
- FAIL: Any attack succeeds or causes unexpected behavior

---

### BUG #1800: Player Disconnect Recovery

**Objective**: Verify disconnected players are cleaned up properly.

**Steps**:
1. Spawn player_1
2. Spawn player_2
3. Both play for 10 frames
4. Disconnect player_1 (kill WebSocket connection)
5. Continue for 10 more frames with player_2
6. Query players: `curl http://localhost:3008/api/actors`
7. Verify player_1 is removed, player_2 still active

**Expected Result**:
- player_1 removed from actors list
- player_1 data cleaned up (freed from memory)
- player_2 continues playing unaffected
- No error logs about player_1

**Pass/Fail**:
- PASS: Disconnected player cleaned up, other player unaffected
- FAIL: Player remains in actors, memory leaks, or other players affected

---

### BUG #1801: Stage Transition Verification

**Objective**: Verify stages load correctly and player advances on goal.

**Steps**:
1. Start on stage 1: `curl http://localhost:3008/api/stage/1`
2. Spawn player
3. Move player to goal (x=640, y=40)
4. Wait for goal registration
5. Check if stage advanced to 2

**Expected Result**:
- Stage changes from 1 → 2 when goal reached
- New level loads (new platforms, enemies, goal)
- Player position resets to start of stage 2
- Score increments by 1

**Pass/Fail**:
- PASS: Stage advances on goal, new level loads
- FAIL: Stage stuck at 1 or wrong level loads

---

### BUG #1802: Respawn Behavior Test

**Objective**: Verify player respawns at start position after falling off level.

**Steps**:
1. Spawn player at (640, 680)
2. Move player off bottom of level (y > 1000)
3. Wait 5 seconds for respawn to trigger
4. Query player: `curl http://localhost:3008/api/actor/player_1`

**Expected Result**:
- Player y position returns to 680 (or stage start position)
- Player x position returns to 640 (or stage start position)
- Lives decremented by 1
- Invulnerability timer activated (1.5 seconds grace period)

**Pass/Fail**:
- PASS: Player respawned at start, invulnerability active
- FAIL: Player stays off-level or respawn position wrong

---

### BUG #1803: Invulnerability Grace Period Test

**Objective**: Verify 1.5-second invulnerability after respawn.

**Steps**:
1. Spawn player_1 at (200, 568)
2. Spawn enemy at (200, 568) - would cause collision
3. Wait 0.5 seconds (player should still be invulnerable from spawn)
4. Verify player lives unchanged
5. Wait 1.5 more seconds (total 2 seconds, past grace period)
6. Touch enemy again
7. Verify lives decreased

**Expected Result**:
- 0-1.5 seconds after respawn: player invulnerable
- After 1.5 seconds: invulnerability expires
- Next enemy touch causes damage

**Pass/Fail**:
- PASS: Grace period exactly 1.5 seconds
- FAIL: Grace period wrong duration or doesn't work

---

### BUG #1804: Goal Collision Test

**Objective**: Verify goal detection works when player touches it.

**Steps**:
1. Spawn player at (630, 50) - 10 pixels left of goal at (640, 40)
2. Send RIGHT input for 5 frames
3. Query player: `curl http://localhost:3008/api/actor/player_1`
4. Verify score incremented

**Alternative**: Spawn at (640, 100) and move up to goal

**Expected Result**:
- Player x ≈ 640 (goal center)
- Player y ≈ 40 (goal y)
- Score increments by 1
- Goal event fires (visible in logs)

**Pass/Fail**:
- PASS: Goal detection triggers, score increments
- FAIL: Goal doesn't register or score stays same

---

### BUG #1805: Pause State Test

**Objective**: Verify pause actually stops physics and player movement.

**Steps**:
1. Spawn player at (640, 100) - airborne
2. Record position: y=100
3. Send PAUSE message
4. Wait 10 frames (physics should NOT apply)
5. Query player: `curl http://localhost:3008/api/actor/player_1`
6. Verify y ≈ 100 (no gravity applied)
7. Send RESUME message
8. Wait 1 frame
9. Query player: y should now decrease (gravity resumes)

**Expected Result**:
- Paused: player y stays at 100, vel_y stays same
- Resumed: gravity resumes, y decreases by ~200 pixels per second

**Pass/Fail**:
- PASS: Pause stops physics, resume restarts
- FAIL: Physics apply during pause or resume doesn't work

---

### BUG #1806: Coyote Time Test

**Objective**: Verify coyote time (late jump) works for 6 frames.

**Steps**:
1. Spawn player on platform at (640, 680)
2. Jump to reach peak, land back on platform
3. Wait exactly 6 frames after leaving platform
4. Try to jump on 6th frame - should succeed
5. Try to jump on 7th frame - should fail (no jump)

**Expected Result**:
- Frames 0-6 after leaving ground: jump succeeds
- Frame 7+: jump fails
- Coyote time = 6 frames exactly

**Pass/Fail**:
- PASS: Coyote time 6 frames, 7th frame jump fails
- FAIL: Coyote time wrong duration or doesn't work

---

### BUG #1807: Breakable Platform Test

**Objective**: Verify breakable platforms break after N hits.

**Steps**:
1. Load stage 1 (has breakable platforms at y=600)
2. Spawn player at (200, 550)
3. Let player fall onto breakable platform at (200, 600)
4. Jump on platform (1st hit)
5. Jump again (2nd hit)
6. Jump again (3rd hit) - platform should break
7. Player should fall through

**Expected Result**:
- After 1st jump: platform at y=600 (still solid)
- After 2nd jump: platform at y=600 (still solid)
- After 3rd jump: platform breaks (disappears from actors)
- Player falls through (y > 600)

**Pass/Fail**:
- PASS: Platform breaks after 3 hits
- FAIL: Platform doesn't break or breaks too early/late

---

### BUG #1808: Enemy Patrol Test

**Objective**: Verify enemies patrol correctly and reverse direction.

**Steps**:
1. Spawn enemy at (200, 568) with patrol_dir=-1 (left)
2. Record position every 10 frames for 200 frames
3. Verify enemy moves left until boundary, then right
4. Repeat pattern: left 10 frames, right 10 frames, etc.

**Expected Result**:
- Enemy moves at speed=120 pixels/second
- Every ~10.7 frames (120 pixels ÷ 120 pixels/sec = 1 second = 60 frames)
- Direction reverses at boundaries
- Patrol pattern repeats

**Pass/Fail**:
- PASS: Enemy patrols correctly, reverses at boundaries
- FAIL: Enemy doesn't patrol or gets stuck

---

### BUG #1809: Checkpoint Load Test (Future Feature)

**Objective**: Verify checkpoint system saves and restores state.

**Steps**:
1. Play stage 1, reach checkpoint at y=300
2. Record: score=25, player_x=640, player_y=300
3. Continue playing and fall off level (die)
4. Load checkpoint: Player should return to (640, 300)
5. Score should be 25 (checkpoint value, not final value)

**Expected Result**:
- Checkpoint saves position and score
- Loading checkpoint restores both
- Progress before checkpoint lost, progress after discarded

**Pass/Fail**:
- PASS: Checkpoint saves and restores correctly
- FAIL: Wrong state restored or checkpoint doesn't work

---

### BUG #1810: Score Calculation Test

**Objective**: Verify score increments correctly per goal.

**Steps**:
1. Spawn player with score=0
2. Reach goal (y=40) - score should become 1
3. Advance to stage 2
4. Reach goal again - score should become 2
5. Repeat for stages 3 and 4 - score becomes 3, then 4

**Expected Result**:
- Each goal reached increments score by exactly 1
- No duplicate scoring
- No score loss on respawn

**Pass/Fail**:
- PASS: Score increments by 1 per goal, 4 goals = score 4
- FAIL: Score wrong or doesn't increment

---

### BUG #1811: Lives Decrement Test

**Objective**: Verify lives decrease correctly on death.

**Steps**:
1. Spawn player with lives=3
2. Enemy touches player (invulnerability expires)
3. Query player: lives should be 2
4. Enemy touches again: lives should be 1
5. Enemy touches again: lives should be 0 (game over)

**Expected Result**:
- Lives: 3 → 2 → 1 → 0
- Each death decrements by 1
- At 0 lives, game over triggered

**Pass/Fail**:
- PASS: Lives decrement by 1 per death, game over at 0
- FAIL: Lives skip values or don't decrement

---

### BUG #1812: Game Over Detection Test

**Objective**: Verify game ends when lives reach 0.

**Steps**:
1. Spawn player with lives=1
2. Enemy touches player - lives become 0
3. Query player: `curl http://localhost:3008/api/actor/player_1`
4. Verify game_over flag or player removed from active list

**Expected Result**:
- When lives=0, game over event fires
- Player removed from active players
- Can't send input for dead player

**Pass/Fail**:
- PASS: Game over triggered at 0 lives
- FAIL: Game continues or player still active

---

### BUG #1813: API Endpoint Test

**Objective**: Verify all endpoints return correct format and data.

**Endpoints to test**:

1. `GET /health`
```bash
curl http://localhost:3008/health
# Expected: {"status":"healthy","frame":N,"stage":1,"clients":M}
```

2. `GET /api/status`
```bash
curl http://localhost:3008/api/status
# Expected: {"frame":N,"stage":1,"actors_count":M,"clients_count":K}
```

3. `GET /api/actors`
```bash
curl http://localhost:3008/api/actors
# Expected: [{"name":"player_1","x":640,"y":680,...},...]
```

4. `GET /api/actor/:name`
```bash
curl http://localhost:3008/api/actor/player_1
# Expected: {"player_id":1,"x":640,"y":680,"vel_x":0,...}
```

5. `GET /api/levels`
```bash
curl http://localhost:3008/api/levels
# Expected: [{"num":1,"name":"Icy Peak",...},...] (4 levels)
```

6. `GET /api/level/:num`
```bash
curl http://localhost:3008/api/level/1
# Expected: {"name":"Icy Peak","platforms":[...],"enemies":[...],"goal":{...}}
```

7. `GET /api/leaderboard`
```bash
curl http://localhost:3008/api/leaderboard
# Expected: [{"player_id":1,"score":50},...] (sorted by score)
```

8. `GET /metrics`
```bash
curl http://localhost:3008/metrics
# Expected: Prometheus format (text/plain)
```

**Expected Result**:
- All endpoints return valid JSON (or Prometheus text)
- All required fields present
- Data types correct (strings, numbers, arrays)
- No missing or extra fields

**Pass/Fail**:
- PASS: All 8 endpoints return correct format and data
- FAIL: Any endpoint returns wrong format, missing data, or error

---

### BUG #1814: WebSocket Protocol Upgrade Test

**Objective**: Verify client can request protocol upgrade and server accepts.

**Steps**:
1. Client connects with PROTOCOL_VERSION=1.0
2. Client sends PROTOCOL_UPGRADE message requesting v1.1
3. Server responds with HELLO_ACK including new version
4. Client sends v1.1 messages
5. Server processes correctly

**Expected Result**:
- Upgrade message accepted
- Server returns v1.1 in response
- New protocol features work (compression, batching, etc.)

**Pass/Fail**:
- PASS: Protocol upgrade succeeds, v1.1 features work
- FAIL: Upgrade rejected or v1.1 messages fail

---

### BUG #1815: Message Deduplication Test

**Objective**: Verify duplicate messages are only processed once.

**Steps**:
1. Spawn player with initial state
2. Send same INPUT message twice with same sequence number
3. Player should only move once (not twice)
4. Verify final position is same as single message

**Expected Result**:
- Message 1: Player position changes
- Message 2 (duplicate): Position doesn't change further
- Duplicate detection via sequence number

**Pass/Fail**:
- PASS: Duplicate messages deduplicated
- FAIL: Message processed twice, position changed twice

---

### BUG #1816: Rate Limit Test

**Objective**: Verify rate limiting enforces 60 messages/sec limit.

**Steps**:
1. Send messages as fast as possible (1000 messages in 1 second)
2. Monitor response codes
3. Count successful (200) vs rate-limited (429) responses
4. Verify rate limit enforcement

**Expected Result**:
- First 60 messages: accepted (200)
- Messages 61+: rate limited (429 error)
- Per-client rate limiting

**Pass/Fail**:
- PASS: Rate limiting enforced at 60 msg/sec
- FAIL: No rate limiting or limit wrong

---

### BUG #1817: Compression Ratio Test

**Objective**: Verify message compression works and achieves >40% ratio.

**Steps**:
1. Capture raw message: 100 bytes typical UPDATE
2. Compress with server's algorithm
3. Measure compressed size
4. Calculate ratio: compressed / original

**Expected Result**:
- Original: 100 bytes
- Compressed: < 60 bytes (60% of original)
- Compression ratio: > 40%

**Pass/Fail**:
- PASS: Compression ratio > 40%
- FAIL: No compression or ratio < 30%

---

### BUG #1818: Actor Spawning Stress Test

**Objective**: Verify MAX_ACTORS limit enforced.

**Steps**:
1. Spawn actors until server returns error
2. Count total actors spawned
3. Verify count = MAX_ACTORS
4. Try to spawn one more - should be rejected

**Expected Result**:
- Can spawn up to MAX_ACTORS (e.g., 1000)
- Spawn #1001: rejected with error
- Server doesn't crash

**Pass/Fail**:
- PASS: Spawn limit enforced correctly
- FAIL: Exceeds limit, crashes, or allows infinite spawns

---

### BUG #1819: Database Integrity Test (Future)

**Objective**: Verify data persisted to disk is valid and recoverable.

**Steps**:
1. Play game and accumulate data
2. Corrupt database file (truncate or corrupt bytes)
3. Restart server
4. Verify server detects corruption and recovers (or errors gracefully)

**Expected Result**:
- Corruption detected on startup
- Error logged with context
- Server shuts down or falls back to backup
- No partial state applied

**Pass/Fail**:
- PASS: Corruption detected, recovery attempted
- FAIL: Corrupted data loaded silently, causing bugs

---

### BUG #1820: Regression Test Checklist

**Objective**: Verify all previously fixed bugs remain fixed.

**Previous Bugs (Phases 1-6)**:

1. Position adjustment on landing
   - **Test**: Spawn player at y=690, verify lands at y=680 not y=650
   - **Pass**: y ≈ 680 after 1 frame

2. on_ground state persistence
   - **Test**: Player on platform, query on_ground=true
   - **Pass**: on_ground stays true while on platform

3. Player spawn auto-assign
   - **Test**: POST /api/spawn/player without player_id, verify auto-assigned
   - **Pass**: Response includes player_id field

4. Collision detection
   - **Test**: Player collides with platform, on_ground=true
   - **Pass**: Collision detected, on_ground=true

5. Physics accuracy
   - **Test**: Drop from y=100, measure landing time
   - **Pass**: y ≈ 100 + 0.5*1200*(1/60)^2 per frame

6. Input validation
   - **Test**: Send invalid direction (direction=5), verify rejected
   - **Pass**: Error response, not processed

7. State consistency
   - **Test**: Play 1000 frames, verify all state valid
   - **Pass**: No NaN, Infinity, out-of-bounds values

**Pass/Fail**:
- PASS: All 7 previous bugs still fixed
- FAIL: Any regression detected

---

## Testing Execution

### Quick Test (5 minutes)
```bash
# Run essential tests
curl http://localhost:3008/health              # BUG #1781
curl -X POST http://localhost:3008/api/spawn/player -d '{"x":640,"y":700}'  # BUG #1781
curl http://localhost:3008/api/actor/player_1 # BUG #1783
curl http://localhost:3008/api/actors          # BUG #1813
curl http://localhost:3008/api/leaderboard     # BUG #1797
```

### Full Test Suite (2 hours)
```bash
# Run all 40 test procedures in order
# Each procedure takes 1-5 minutes
# Total: ~2 hours for full coverage
```

### Continuous Monitoring
```bash
# Monitor metrics during gameplay
watch -n 1 'curl -s http://localhost:3008/api/observability | jq .'

# Watch logs for errors
tail -f server.log | grep ERROR
```

## Passing Criteria

**All tests PASS** = Production-ready game

**Any test FAILS** = Bug report + investigation + fix + retest

## Next Steps

1. Execute BUG #1781 (E2E test)
2. Execute BUG #1782 (Input validation)
3. ... continue through BUG #1820
4. Aggregate results
5. Fix any failures
6. Re-run all procedures
7. Deploy when 100% pass
