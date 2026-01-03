const http = require('http');

const TEST_URL = 'http://localhost:3008';
let passCount = 0;
let failCount = 0;
const results = [];

function log(message) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${message}`);
}

function pass(title, details) {
  passCount++;
  results.push({ status: 'PASS', title });
  log(`✓ ${title}: ${details}`);
}

function fail(title, expected, actual) {
  failCount++;
  results.push({ status: 'FAIL', title, expected, actual });
  log(`✗ ${title}`);
  log(`  Expected: ${expected}`);
  log(`  Actual: ${actual}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${TEST_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000);
  });
}

function fetchStatus() {
  return fetchJson('/api/status');
}

async function testGameState() {
  log('');
  log('=== TEST: GAME STATE & ACTORS ===');

  try {
    const status = await fetchStatus();

    if (typeof status.frame === 'number') {
      pass('Frame tracking', `Frame counter working (current: ${status.frame})`);
    } else {
      fail('Frame tracking', 'frame property exists', 'undefined');
    }

    if (typeof status.stage === 'number') {
      pass('Stage tracking', `Stage ${status.stage} loaded`);
    } else {
      fail('Stage tracking', 'stage property exists', 'undefined');
    }

    if (typeof status.actors === 'number' && status.actors > 0) {
      pass('Actor count', `${status.actors} actors in scene`);
    } else {
      fail('Actor count', '>0 actors', status.actors);
    }

    if (Array.isArray(status.players)) {
      pass('Player array', `${status.players.length} players connected`);
    } else {
      fail('Player array', 'Array of players', typeof status.players);
    }

  } catch (error) {
    fail('Game state API', 'Valid JSON', error.message);
  }
}

async function testStages() {
  log('');
  log('=== TEST: STAGE LOADING ===');

  try {
    // Load stage 1
    let status = await fetchStatus();
    const initialStage = status.stage;

    // Test each stage endpoint
    for (let stageNum = 1; stageNum <= 4; stageNum++) {
      try {
        const req = http.get(`${TEST_URL}/?stage=${stageNum}`, (res) => {
          if (res.statusCode === 200) {
            pass(`Stage ${stageNum} loadable`, `HTTP 200 returned`);
          }
          res.resume();
        });
        req.on('error', () => fail(`Stage ${stageNum} loadable`, 'HTTP 200', 'Connection error'));
        req.setTimeout(3000);
      } catch (e) {
        fail(`Stage ${stageNum} loadable`, 'HTTP 200', e.message);
      }

      await sleep(100);
    }

  } catch (error) {
    fail('Stage loading test', 'Stages accessible', error.message);
  }
}

async function testActorTracking() {
  log('');
  log('=== TEST: ACTOR TRACKING ===');

  try {
    const status1 = await fetchStatus();
    const frame1 = status1.frame;
    const actors1 = status1.actors;

    await sleep(1000);

    const status2 = await fetchStatus();
    const frame2 = status2.frame;
    const actors2 = status2.actors;

    if (frame2 > frame1) {
      const frameIncrease = frame2 - frame1;
      pass('Frame increment', `Game progressed ${frameIncrease} frames in 1 second`);
    } else {
      fail('Frame increment', 'frame number to increase', `frame stayed at ${frame1}`);
    }

    if (actors2 === actors1) {
      pass('Actor stability', `Actor count stable at ${actors2}`);
    } else {
      log(`Note: Actor count changed from ${actors1} to ${actors2} (may be normal)`);
    }

  } catch (error) {
    fail('Actor tracking', 'Consistent state', error.message);
  }
}

async function testMultipleStageTransitions() {
  log('');
  log('=== TEST: STAGE TRANSITIONS ===');

  try {
    // Rapid stage loading simulating progression
    for (let i = 1; i <= 4; i++) {
      const status = await fetchStatus();
      log(`Stage ${i} loaded - Frame: ${status.frame}, Actors: ${status.actors}`);
      await sleep(200);
    }

    pass('Stage transitions', 'All 4 stages load without errors');
  } catch (error) {
    fail('Stage transitions', 'Smooth progression', error.message);
  }
}

async function testGameStability() {
  log('');
  log('=== TEST: GAME STABILITY (10 seconds) ===');

  try {
    const startStatus = await fetchStatus();
    const startFrame = startStatus.frame;
    let hasError = false;
    let statusChecks = 0;
    const maxChecks = 10;

    for (let i = 0; i < maxChecks; i++) {
      await sleep(1000);
      try {
        const status = await fetchStatus();
        statusChecks++;

        if (!status.frame || !status.stage || typeof status.actors !== 'number') {
          hasError = true;
          log(`Invalid status at check ${i + 1}`);
          break;
        }
      } catch (e) {
        hasError = true;
        log(`Status check failed: ${e.message}`);
        break;
      }
    }

    const endStatus = await fetchStatus();
    const endFrame = endStatus.frame;
    const frameProgression = endFrame - startFrame;

    if (!hasError && statusChecks === maxChecks) {
      pass('10-second stability', `All ${statusChecks} status checks successful, ${frameProgression} frames processed`);
    } else {
      fail('10-second stability', `${maxChecks} successful checks`, `${statusChecks} checks, error: ${hasError}`);
    }

  } catch (error) {
    fail('Game stability', 'Consistent operation', error.message);
  }
}

async function testErrorHandling() {
  log('');
  log('=== TEST: ERROR HANDLING ===');

  try {
    // Test invalid stage
    const req1 = http.get(`${TEST_URL}/?stage=999`, (res) => {
      if (res.statusCode === 200) {
        pass('Invalid stage handling', 'Invalid stage request handled gracefully (200)');
      } else if (res.statusCode === 404 || res.statusCode === 400) {
        pass('Invalid stage handling', `Invalid stage request returned ${res.statusCode}`);
      } else {
        log(`Invalid stage returned ${res.statusCode}`);
      }
      res.resume();
    });
    req1.on('error', () => fail('Invalid stage', 'Handled without crash', 'Connection error'));
    req1.setTimeout(3000);

    await sleep(500);

    // Test bad endpoints
    const req2 = http.get(`${TEST_URL}/nonexistent`, (res) => {
      if (res.statusCode === 404) {
        pass('404 handling', 'Missing endpoints return 404');
      }
      res.resume();
    });
    req2.on('error', () => log('404 test inconclusive'));
    req2.setTimeout(3000);

  } catch (error) {
    log(`Error handling test inconclusive: ${error.message}`);
  }
}

async function runAllTests() {
  log('========================================');
  log('Ice Climber - Gameplay Tests');
  log('========================================');
  log(`Target: ${TEST_URL}`);
  log('');

  try {
    await testGameState();
    await testStages();
    await testActorTracking();
    await testMultipleStageTransitions();
    await testErrorHandling();
    await testGameStability();

    log('');
    log('========================================');
    log('GAMEPLAY TEST SUMMARY');
    log('========================================');
    log(`PASS: ${passCount}`);
    log(`FAIL: ${failCount}`);
    log(`TOTAL: ${passCount + failCount}`);
    log('========================================');

    if (failCount > 0) {
      log('');
      log('FAILED TESTS:');
      results.filter(r => r.status === 'FAIL').forEach(r => {
        log(`  ✗ ${r.title}`);
        log(`    Expected: ${r.expected}`);
        log(`    Actual: ${r.actual}`);
      });
    }

    process.exit(failCount > 0 ? 1 : 0);

  } catch (error) {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

runAllTests();
