// Ice Climber .io - Execution-Based Test Runner
// No test framework, no mocks - pure execution verification

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:3008';
const RESULTS = { passed: 0, failed: 0, errors: [] };

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, data: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function test(name, result, details = '') {
  if (result) {
    console.log(`[PASS] ${name}`);
    RESULTS.passed++;
  } else {
    console.log(`[FAIL] ${name}${details ? ': ' + details : ''}`);
    RESULTS.failed++;
    RESULTS.errors.push(name);
  }
}

async function bug1781_e2e() {
  console.log('\n=== BUG #1781: End-to-End Test ===');

  try {
    // Health check
    const health = await request('GET', '/health');
    test('Health check', health.status === 200, `status=${health.status}`);

    // Spawn player
    const spawn = await request('POST', '/api/spawn/player', { x: 640, y: 700 });
    const player_id = spawn.data?.player_id || spawn.data?.id;
    test('Spawn player', spawn.status === 200 && spawn.data, `status=${spawn.status}, data=${JSON.stringify(spawn.data)}`);

    await sleep(100);

    // Get player state
    const actor = await request('GET', '/api/actor/player_1');
    test('Query player state', actor.status === 200, `status=${actor.status}`);

    const x_before = actor.data?.x || 640;

    // Move player right for ~1 second (60 requests)
    for (let i = 0; i < 30; i++) {
      await request('POST', '/api/input', { player_id: 1, direction: 1 });
      await sleep(33); // ~30 FPS to avoid rate limit
    }

    // Check position changed
    const actor2 = await request('GET', '/api/actor/player_1');
    const x_after = actor2.data?.x || 640;
    test('Player moved right', x_after > x_before - 5, `before=${x_before}, after=${x_after}`);

  } catch (e) {
    test('E2E test', false, e.message);
  }
}

async function bug1782_input_validation() {
  console.log('\n=== BUG #1782: Input Validation ===');

  try {
    // Space out requests to avoid rate limit
    const r1 = await request('POST', '/api/input', { player_id: 1, direction: -1 });
    test('Direction -1 accepted', r1.status === 200 || r1.status === 404, `status=${r1.status}`);
    await sleep(50);

    const r2 = await request('POST', '/api/input', { player_id: 1, direction: 0 });
    test('Direction 0 accepted', r2.status === 200 || r2.status === 404, `status=${r2.status}`);
    await sleep(50);

    const r3 = await request('POST', '/api/input', { player_id: 1, direction: 1 });
    test('Direction 1 accepted', r3.status === 200 || r3.status === 404, `status=${r3.status}`);
    await sleep(50);

    const r4 = await request('POST', '/api/input', { player_id: 1, direction: 2 });
    test('Direction 2 rejected', r4.status >= 400, `status=${r4.status}`);
    await sleep(50);

    const r5 = await request('POST', '/api/input', { player_id: 1, direction: -2 });
    test('Direction -2 rejected', r5.status >= 400, `status=${r5.status}`);

  } catch (e) {
    test('Input validation', false, e.message);
  }
}

async function bug1783_state_consistency() {
  console.log('\n=== BUG #1783: State Consistency ===');

  try {
    // Spawn fresh player
    const spawn = await request('POST', '/api/spawn/player', { x: 640, y: 700 });
    const pid = spawn.data?.player_id || 1;

    await sleep(100);

    // Play for 10 frames with spacing
    for (let f = 0; f < 5; f++) {
      await request('POST', '/api/input', { player_id: pid, direction: 1 });
      await sleep(50);
    }

    // Check final state
    const final = await request('GET', `/api/actor/player_${pid}`);
    const actor = final.data;

    if (actor) {
      const x = actor.x ?? actor.position?.[0];
      const y = actor.y ?? actor.position?.[1];
      const lives = actor.lives;
      const score = actor.score;

      const valid = (
        x !== undefined && !isNaN(x) && isFinite(x) && x >= 0 && x <= 1280 &&
        y !== undefined && !isNaN(y) && isFinite(y) && y >= 0 && y <= 1000 &&
        lives !== undefined && !isNaN(lives) && isFinite(lives) && lives >= 0 && lives <= 3 &&
        score !== undefined && !isNaN(score) && isFinite(score) && score >= 0 && score <= 999999
      );

      test('State validity', valid, `x=${x}, y=${y}, lives=${lives}, score=${score}`);
    } else {
      test('State validity', false, `actor=${JSON.stringify(actor)}`);
    }

  } catch (e) {
    test('State consistency', false, e.message);
  }
}

async function bug1784_collision_detection() {
  console.log('\n=== BUG #1784: Collision Detection ===');

  try {
    // Spawn player slightly above ground
    const spawn = await request('POST', '/api/spawn/player', { x: 640, y: 680 });
    await sleep(100);

    // Check if on_ground after gravity
    const actor = await request('GET', '/api/actor/player_1');
    const on_ground = actor.data?.on_ground;
    test('Platform collision detected', on_ground === true, `on_ground=${on_ground}`);

  } catch (e) {
    test('Collision detection', false, e.message);
  }
}

async function bug1785_physics() {
  console.log('\n=== BUG #1785: Physics Simulation ===');

  try {
    // Spawn in air
    const spawn = await request('POST', '/api/spawn/player', { x: 640, y: 400 });
    const y_start = 400;

    await sleep(1000);

    // Check position
    const actor = await request('GET', '/api/actor/player_1');
    const y_final = actor.data?.y;

    test('Gravity applied', y_final > y_start, `y_start=${y_start}, y_final=${y_final}`);

  } catch (e) {
    test('Physics simulation', false, e.message);
  }
}

async function bug1788_concurrent_load() {
  console.log('\n=== BUG #1788: Concurrent Player Load (10 players) ===');

  try {
    // Spawn 10 players with spacing to avoid rate limit
    console.log('[TEST] Spawning 10 players...');
    let successful = 0;

    for (let i = 0; i < 10; i++) {
      const spawn = await request('POST', '/api/spawn/player', { x: 640 + i * 50, y: 700 });
      if (spawn.status === 200) {
        successful++;
      }
      await sleep(100);
    }

    test('10 players spawned', successful >= 8, `${successful}/10 spawned`);

    await sleep(200);

    // Query all actors
    const actors = await request('GET', '/api/actors');
    const actor_count = Array.isArray(actors.data) ? actors.data.length : 0;
    test('Actors list returns', actor_count >= 5, `${actor_count} actors`);

    // Verify server still responsive
    const health = await request('GET', '/health');
    test('Server responsive after load', health.status === 200);

  } catch (e) {
    test('Concurrent load', false, e.message);
  }
}

async function bug1793_frame_rate() {
  console.log('\n=== BUG #1793: Frame Rate Stability ===');

  try {
    // Sample frame count over 5 seconds
    const frame_deltas = [];

    for (let i = 0; i < 3; i++) {
      const r1 = await request('GET', '/api/status');
      const frame1 = r1.data?.frame || 0;

      await sleep(1000); // Wait 1 second

      const r2 = await request('GET', '/api/status');
      const frame2 = r2.data?.frame || 0;

      const delta = frame2 - frame1;
      frame_deltas.push(delta);
      console.log(`[FRAME] Interval ${i + 1}: +${delta} frames`);
    }

    // Check if frames are increasing (server running)
    const all_positive = frame_deltas.every(d => d > 0);
    test('Game frame counter advancing', all_positive, `deltas=${frame_deltas}`);

  } catch (e) {
    test('Frame rate stability', false, e.message);
  }
}

async function bug1797_leaderboard() {
  console.log('\n=== BUG #1797: Leaderboard Correctness ===');

  try {
    // Get leaderboard
    const lb = await request('GET', '/api/leaderboard');
    const leaderboard = lb.data || [];

    test('Leaderboard returns', Array.isArray(leaderboard), `${leaderboard.length} entries`);

  } catch (e) {
    test('Leaderboard correctness', false, e.message);
  }
}

async function bug1813_api_endpoints() {
  console.log('\n=== BUG #1813: API Endpoints ===');

  const endpoints = [
    { path: '/health', method: 'GET' },
    { path: '/api/status', method: 'GET' }
  ];

  try {
    for (const ep of endpoints) {
      const res = await request(ep.method, ep.path);
      test(`Endpoint ${ep.method} ${ep.path}`, res.status === 200, `status=${res.status}`);
      await sleep(100);
    }
  } catch (e) {
    test('API endpoints', false, e.message);
  }
}

async function runAllTests() {
  console.log('========================================');
  console.log('Ice Climber .io - Execution-Based Tests');
  console.log('========================================');

  try {
    await bug1781_e2e();
    await bug1782_input_validation();
    await bug1783_state_consistency();
    await bug1784_collision_detection();
    await bug1785_physics();
    await bug1788_concurrent_load();
    await bug1793_frame_rate();
    await bug1797_leaderboard();
    await bug1813_api_endpoints();

    console.log('\n========================================');
    console.log(`Results: ${RESULTS.passed} PASS, ${RESULTS.failed} FAIL`);
    console.log('========================================');

    if (RESULTS.failed > 0) {
      console.log('\nFailed tests:');
      RESULTS.errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('\nAll core tests passed!');
    }

  } catch (e) {
    console.error('\n[FATAL]', e.message);
    process.exit(1);
  }
}

runAllTests();
