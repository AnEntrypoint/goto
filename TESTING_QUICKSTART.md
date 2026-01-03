# Ice Climber .io - Testing Quick Start Guide

Fast path to executing game tests without test frameworks or mocks.

## 1-Minute Health Check

```bash
# Terminal 1: Start server
NODE_ENV=development PORT=3008 node server/index.js

# Terminal 2: Run health check
curl http://localhost:3008/health

# Expected output:
# {"status":"healthy","frame":N,"stage":1,"clients":0}
```

**Result**: Server is running and responsive. ✓

## 5-Minute Core Tests

```bash
# Run automated test suite
node test-runner.js

# Expected output:
# ========================================
# Results: X PASS, Y FAIL
# ========================================
```

**Tests Covered**:
- BUG #1781: E2E game flow
- BUG #1782: Input validation
- BUG #1783: State consistency
- BUG #1784: Collision detection
- BUG #1785: Physics simulation
- BUG #1788: Concurrent load
- BUG #1793: Frame rate stability
- BUG #1797: Leaderboard
- BUG #1813: API endpoints

## Full Test Suite (2 hours)

Follow procedures in TESTING.md sequentially:

```bash
# Each procedure is self-contained
# Example: BUG #1781 - E2E Test

# Step 1: Health check
curl http://localhost:3008/health

# Step 2: Spawn player
curl -X POST http://localhost:3008/api/spawn/player \
  -H "Content-Type: application/json" \
  -d '{"x": 640, "y": 700}'

# Step 3: Query player (wait 100ms between requests)
sleep 0.1
curl http://localhost:3008/api/actor/player_1

# Step 4: Send input (30 times with 33ms spacing to avoid rate limit)
for i in {1..30}; do
  curl -X POST http://localhost:3008/api/input \
    -H "Content-Type: application/json" \
    -d '{"player_id": 1, "direction": 1}'
  sleep 0.033
done

# Step 5: Verify movement
curl http://localhost:3008/api/actor/player_1
# Check: x value should be different (moved right)
```

## Test Categories by Time

### Quick (1 minute each)
- BUG #1781: E2E flow
- BUG #1813: API endpoints
- BUG #1797: Leaderboard

### Standard (5 minutes each)
- BUG #1782: Input validation
- BUG #1783: State consistency
- BUG #1784: Collision detection
- BUG #1785: Physics

### Extended (30+ minutes)
- BUG #1788: 100-player load (space spawns 100ms apart)
- BUG #1789: 8-hour memory test
- BUG #1790: CPU profiling
- BUG #1793: Frame rate (1+ minute to sample)

## Common Issues & Solutions

### "Spawn rate limit exceeded" (429 error)

**Cause**: Rate limit set to prevent DDoS
**Fix**: Space spawn requests at least 100ms apart

```bash
# WRONG: Too fast
for i in {1..100}; do curl -X POST http://localhost:3008/api/spawn/player; done

# CORRECT: With spacing
for i in {1..100}; do
  curl -X POST http://localhost:3008/api/spawn/player
  sleep 0.1
done
```

### "Too Many Requests" (429 on other endpoints)

**Cause**: General rate limit at 60 requests/sec per IP
**Fix**: Space requests at least 17ms apart

```bash
# Space requests evenly
for i in {1..60}; do
  curl http://localhost:3008/api/status
  sleep 0.017  # ~60 req/sec
done
```

### "Actor not found" (404 on /api/actor/:name)

**Cause**: Player not spawned yet or wrong name
**Fix**: Verify player ID before querying

```bash
# Get list of actors first
curl http://localhost:3008/api/actors
# Look for {"name":"player_1","x":...}

# Then query specific actor
curl http://localhost:3008/api/actor/player_1
```

## Test Results Interpretation

### PASS Indicators

```
[PASS] Health check                    -> Server running
[PASS] Game frame counter advancing    -> Physics loop active
[PASS] API endpoints                   -> REST interface working
[PASS] Input validation                -> Security checks active
```

### FAIL Indicators (Normal)

```
[FAIL] Spawn player (rate limit)       -> Rate limit active (expected)
[FAIL] Direction validation (rate limit) -> Rate limit active (expected)
```

These failures are due to security rate limiting, not code bugs.

### FAIL Indicators (Bugs)

If you see these, investigate the code:
```
[FAIL] Platform collision detected     -> Collision system broken
[FAIL] Physics simulation              -> Gravity not applying
[FAIL] State consistency               -> NaN/Infinity in state
[FAIL] Leaderboard returns             -> API broken
```

## Monitoring in Real-Time

### Watch Game State
```bash
# Check frame count every second
watch -n 1 'curl -s http://localhost:3008/api/status | jq .frame'

# Check player position
watch -n 1 'curl -s http://localhost:3008/api/actor/player_1 | jq "{x:.x,y:.y,vel_x:.vel_x,vel_y:.vel_y}"'

# Check metrics
watch -n 1 'curl -s http://localhost:3008/metrics | head -20'
```

### Watch Logs
```bash
# Show only errors
tail -f server.log | grep ERROR

# Show all state changes
tail -f server.log | grep -E "player|collision|goal"
```

## Automation Script

Run core tests repeatedly:

```bash
#!/bin/bash

echo "Starting Ice Climber Test Suite..."
start_time=$(date +%s)

# Run automated tests
node test-runner.js
exit_code=$?

end_time=$(date +%s)
duration=$((end_time - start_time))

echo "Test run completed in ${duration}s"
exit $exit_code
```

Save as `run-tests.sh` and execute:
```bash
chmod +x run-tests.sh
./run-tests.sh
```

## Integration with CI/CD

Add to GitHub Actions / GitLab CI:

```yaml
- name: Run Game Tests
  run: |
    NODE_ENV=development PORT=3008 node server/index.js &
    sleep 2
    node test-runner.js
    kill %1
```

## Expected Test Times

| Test | Time | Command |
|------|------|---------|
| Health check | <1s | `curl http://localhost:3008/health` |
| E2E flow | 2-3s | See BUG #1781 procedure |
| Input validation | 1-2s | See BUG #1782 procedure |
| State consistency | 3-5s | See BUG #1783 procedure |
| Collision detection | 1-2s | See BUG #1784 procedure |
| Physics simulation | 2-3s | See BUG #1785 procedure |
| Frame rate | 5s | See BUG #1793 procedure |
| Leaderboard | <1s | `curl http://localhost:3008/api/leaderboard` |
| All automated | 5 min | `node test-runner.js` |
| All manual | 2 hours | Full TESTING.md suite |

## Debugging Failed Tests

### Test: "Player moved right" fails

```bash
# Check if player spawned
curl http://localhost:3008/api/actors | jq '.[] | select(.name | contains("player"))'

# Check player position before
curl http://localhost:3008/api/actor/player_1 | jq '{x, y, vel_x}'

# Send input
curl -X POST http://localhost:3008/api/input -d '{"player_id":1,"direction":1}'

# Wait and check position after
sleep 0.1
curl http://localhost:3008/api/actor/player_1 | jq '{x, y, vel_x}'

# If x didn't change: movement system broken
# If x changed: test needs longer wait time
```

### Test: "Gravity applied" fails

```bash
# Spawn player in air
curl -X POST http://localhost:3008/api/spawn/player -d '{"x":640,"y":400}'

# Check position
curl http://localhost:3008/api/actor/player_1 | jq '{y, vel_y}'

# Wait 1 second
sleep 1

# Check again
curl http://localhost:3008/api/actor/player_1 | jq '{y, vel_y}'

# If y didn't increase: gravity broken
# If y increased: physics working
```

## Next Steps

1. **Quick validation**: Run 5-minute core tests
2. **Full coverage**: Execute all 40 procedures from TESTING.md
3. **Continuous**: Set up monitoring to watch metrics
4. **CI/CD**: Integrate automated tests into build pipeline
5. **Documentation**: Share TESTING.md with QA team

## Questions?

See TESTING.md for detailed procedures on each of 40 bugs.
See PHASE7_TESTING_SUMMARY.md for implementation details.
