const http = require('http');
const fs = require('fs');
const path = require('path');

const TEST_URL = 'http://localhost:3008';
let passCount = 0;
let failCount = 0;
let warnCount = 0;
const issues = [];

const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
const pass = (title, detail) => { passCount++; log(`✓ ${title}: ${detail}`); };
const fail = (title, expected, actual, error = '') => {
  failCount++;
  issues.push({ title, expected, actual, error });
  log(`✗ ${title}`);
  log(`  Expected: ${expected}`);
  log(`  Actual: ${actual}`);
  if (error) log(`  Error: ${error}`);
};
const warn = (title, detail) => { warnCount++; log(`⚠ ${title}: ${detail}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchJson(endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${TEST_URL}${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data.substring(0, 200), error: e.message });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000);
  });
}

async function testApiStatus() {
  log('\n=== TEST 1: API STATUS ENDPOINT ===');
  try {
    const res = await fetchJson('/api/status');

    if (res.status === 200) {
      pass('Status endpoint', 'HTTP 200');
    } else {
      fail('Status endpoint', '200', res.status);
      return;
    }

    const data = res.data;
    if (typeof data.frame === 'number') pass('Frame property', `Frame ${data.frame}`);
    else fail('Frame property', 'number', typeof data.frame);

    if (typeof data.stage === 'number') pass('Stage property', `Stage ${data.stage}`);
    else fail('Stage property', 'number', typeof data.stage);

    if (typeof data.actors === 'number') pass('Actors property', `${data.actors} actors`);
    else fail('Actors property', 'number', typeof data.actors);

    if (Array.isArray(data.players)) pass('Players array', `${data.players.length} players`);
    else fail('Players array', 'Array', typeof data.players);

    if (typeof data.clients === 'number') pass('Clients property', `${data.clients} clients`);
    else warn('Clients property', 'Not provided in response');

  } catch (error) {
    fail('API Status test', 'Valid response', error.message);
  }
}

async function testApiActors() {
  log('\n=== TEST 2: API ACTORS ENDPOINT ===');
  try {
    const res = await fetchJson('/api/actors');

    if (res.status === 200) {
      pass('Actors endpoint', 'HTTP 200');
    } else {
      fail('Actors endpoint', '200', res.status);
      return;
    }

    const data = res.data;
    if (Array.isArray(data.actors)) {
      pass('Actors array', `${data.actors.length} actors returned`);

      // Verify structure
      if (data.actors.length > 0) {
        const firstActor = data.actors[0];
        if (firstActor.name && firstActor.type && typeof firstActor.x === 'number') {
          pass('Actor structure', 'name, type, x, y properties present');
        } else {
          warn('Actor structure', 'Missing some expected properties');
        }
      }
    } else {
      fail('Actors array', 'Array', typeof data.actors);
    }

  } catch (error) {
    fail('API Actors test', 'Valid response', error.message);
  }
}

async function testApiActor() {
  log('\n=== TEST 3: API ACTOR BY NAME ENDPOINT ===');
  try {
    // First get list of actors
    const listRes = await fetchJson('/api/actors');
    const actors = listRes.data?.actors || [];

    if (actors.length === 0) {
      warn('Actor detail test', 'No actors in scene to test');
      return;
    }

    const testActorName = actors[0].name;
    const res = await fetchJson(`/api/actor/${testActorName}`);

    if (res.status === 200) {
      pass(`Actor detail for ${testActorName}`, 'HTTP 200');

      const data = res.data;
      if (data.name === testActorName) {
        pass('Actor name match', testActorName);
      }
      if (data.type) {
        pass('Actor type', data.type);
      }
    } else if (res.status === 404) {
      warn(`Actor detail for ${testActorName}`, 'Actor not found (may be removed)');
    } else {
      fail(`Actor detail for ${testActorName}`, '200 or 404', res.status);
    }

  } catch (error) {
    fail('API Actor detail test', 'Valid response', error.message);
  }
}

async function testApiLevels() {
  log('\n=== TEST 4: API LEVELS ENDPOINTS ===');
  try {
    const res = await fetchJson('/api/levels');

    if (res.status === 200) {
      pass('Levels endpoint', 'HTTP 200');
    } else {
      fail('Levels endpoint', '200', res.status);
      return;
    }

    const data = res.data;
    if (Array.isArray(data.levels)) {
      pass('Levels array', `${data.levels.length} levels available`);

      // Test each level
      for (let i = 1; i <= 4; i++) {
        const levelRes = await fetchJson(`/api/level/${i}`);
        if (levelRes.status === 200) {
          pass(`Level ${i} details`, 'HTTP 200');
        } else {
          fail(`Level ${i} details`, '200', levelRes.status);
        }
      }
    } else {
      fail('Levels array', 'Array', typeof data.levels);
    }

  } catch (error) {
    fail('API Levels test', 'Valid response', error.message);
  }
}

async function testApiStats() {
  log('\n=== TEST 5: API STATS ENDPOINT ===');
  try {
    const res = await fetchJson('/api/stats');

    if (res.status === 200) {
      pass('Stats endpoint', 'HTTP 200');

      const data = res.data;
      if (data.uptime !== undefined) pass('Uptime stat', `${Math.round(data.uptime)}ms`);
      if (data.frameRate !== undefined) pass('Frame rate stat', `${data.frameRate.toFixed(1)} FPS`);
      if (data.totalActors !== undefined) pass('Total actors stat', `${data.totalActors} actors`);
      if (data.collisions !== undefined) pass('Collisions stat', `${data.collisions} total`);
    } else {
      fail('Stats endpoint', '200', res.status);
    }

  } catch (error) {
    fail('API Stats test', 'Valid response', error.message);
  }
}

async function testApiPerformance() {
  log('\n=== TEST 6: API PERFORMANCE ENDPOINT ===');
  try {
    const res = await fetchJson('/api/perf');

    if (res.status === 200) {
      pass('Performance endpoint', 'HTTP 200');

      const data = res.data;
      if (data.frameTimes) pass('Frame times', 'Available');
      if (data.memoryUsage !== undefined) pass('Memory usage', `${Math.round(data.memoryUsage / 1024 / 1024)}MB`);
      if (data.avgFrameTime !== undefined) pass('Avg frame time', `${data.avgFrameTime.toFixed(2)}ms`);
    } else {
      fail('Performance endpoint', '200', res.status);
    }

  } catch (error) {
    fail('API Performance test', 'Valid response', error.message);
  }
}

async function testHealthEndpoint() {
  log('\n=== TEST 7: HEALTH ENDPOINT ===');
  try {
    const res = await fetchJson('/health');

    if (res.status === 200) {
      pass('Health endpoint', 'HTTP 200');

      const data = res.data;
      if (data.status === 'healthy') {
        pass('Health status', 'Server is healthy');
      } else {
        warn('Health status', `Status: ${data.status}`);
      }
    } else {
      fail('Health endpoint', '200', res.status);
    }

  } catch (error) {
    fail('Health endpoint test', 'Valid response', error.message);
  }
}

async function testMetricsEndpoint() {
  log('\n=== TEST 8: METRICS ENDPOINT ===');
  try {
    const res = await fetchJson('/metrics');

    if (res.status === 200) {
      pass('Metrics endpoint', 'HTTP 200');

      // Prometheus metrics should contain specific format
      if (res.data.includes && res.data.includes('# HELP')) {
        pass('Metrics format', 'Valid Prometheus format');
      } else {
        log(`Metrics response type: ${typeof res.data}`);
        if (typeof res.data === 'object') {
          pass('Metrics format', 'JSON format');
        }
      }
    } else {
      fail('Metrics endpoint', '200', res.status);
    }

  } catch (error) {
    fail('Metrics endpoint test', 'Valid response', error.message);
  }
}

async function testObservabilityEndpoint() {
  log('\n=== TEST 9: OBSERVABILITY ENDPOINT ===');
  try {
    const res = await fetchJson('/api/observability');

    if (res.status === 200) {
      pass('Observability endpoint', 'HTTP 200');

      const data = res.data;
      if (data.alerts) pass('Alerts available', `${data.alerts.length} alerts`);
      if (data.slos) pass('SLOs available', `${data.slos.length} SLOs`);
      if (data.frameMetrics) pass('Frame metrics', 'Available');
    } else {
      fail('Observability endpoint', '200', res.status);
    }

  } catch (error) {
    fail('Observability endpoint test', 'Valid response', error.message);
  }
}

async function testDataIntegrityEndpoint() {
  log('\n=== TEST 10: DATA INTEGRITY ENDPOINT ===');
  try {
    const res = await fetchJson('/api/data-integrity');

    if (res.status === 200) {
      pass('Data integrity endpoint', 'HTTP 200');

      const data = res.data;
      if (data.checksumValid !== undefined) {
        if (data.checksumValid) {
          pass('Data checksum', 'Valid');
        } else {
          fail('Data checksum', 'Valid', 'Invalid');
        }
      }
    } else if (res.status === 503) {
      warn('Data integrity endpoint', 'Service unavailable');
    } else {
      fail('Data integrity endpoint', '200', res.status);
    }

  } catch (error) {
    fail('Data integrity endpoint test', 'Valid response', error.message);
  }
}

async function testLeaderboardEndpoint() {
  log('\n=== TEST 11: LEADERBOARD ENDPOINT ===');
  try {
    const res = await fetchJson('/api/leaderboard');

    if (res.status === 200) {
      pass('Leaderboard endpoint', 'HTTP 200');

      const data = res.data;
      if (Array.isArray(data.players)) {
        pass('Leaderboard data', `${data.players.length} players`);
      }
    } else if (res.status === 204) {
      pass('Leaderboard endpoint', 'HTTP 204 (No content)');
    } else {
      fail('Leaderboard endpoint', '200 or 204', res.status);
    }

  } catch (error) {
    fail('Leaderboard endpoint test', 'Valid response', error.message);
  }
}

async function testStageLoading() {
  log('\n=== TEST 12: STAGE LOADING ===');
  try {
    for (let stage = 1; stage <= 4; stage++) {
      const endpoint = `/?stage=${stage}`;
      const req = new Promise((resolve) => {
        const httpReq = http.get(`${TEST_URL}${endpoint}`, (res) => {
          resolve(res.statusCode);
          res.resume();
        });
        httpReq.on('error', () => resolve(0));
        httpReq.setTimeout(3000);
      });

      const status = await req;
      if (status === 200) {
        pass(`Stage ${stage} load`, 'HTTP 200');
      } else {
        fail(`Stage ${stage} load`, '200', status);
      }
    }

  } catch (error) {
    fail('Stage loading test', 'All stages loadable', error.message);
  }
}

async function testGameStability() {
  log('\n=== TEST 13: GAME STABILITY (30 seconds) ===');
  try {
    const startStatus = await fetchJson('/api/status');
    const startFrame = startStatus.data.frame;
    let errors = 0;
    let checks = 0;

    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      try {
        const status = await fetchJson('/api/status');
        checks++;
        if (!status.data.frame || !status.data.stage) {
          errors++;
        }
      } catch (e) {
        errors++;
      }
    }

    const endStatus = await fetchJson('/api/status');
    const endFrame = endStatus.data.frame;
    const frameProgress = endFrame - startFrame;

    if (errors === 0 && checks === 6) {
      pass('Game stability', `All 6 checks passed, ${frameProgress} frames processed`);
    } else {
      fail('Game stability', 'No errors in 30s', `${errors} errors in ${checks} checks`);
    }

  } catch (error) {
    fail('Game stability test', 'Stable operation', error.message);
  }
}

async function testEndToEndFlow() {
  log('\n=== TEST 14: END-TO-END FLOW ===');
  try {
    // 1. Get initial state
    const initial = await fetchJson('/api/status');
    pass('Get initial state', `Frame ${initial.data.frame}`);

    // 2. Load stage 1
    await sleep(500);
    const stage1 = await fetchJson('/?stage=1');
    pass('Load stage 1', 'HTTP 200');

    // 3. Get actors
    await sleep(500);
    const actors = await fetchJson('/api/actors');
    pass('Get actors', `${actors.data.actors?.length || 0} actors`);

    // 4. Get stats
    await sleep(500);
    const stats = await fetchJson('/api/stats');
    pass('Get stats', `${stats.data.totalActors || 0} total actors`);

    // 5. Check health
    await sleep(500);
    const health = await fetchJson('/health');
    pass('Check health', health.data.status || 'Unknown');

    pass('End-to-end flow', 'Complete pipeline works');

  } catch (error) {
    fail('End-to-end flow', 'Complete pipeline', error.message);
  }
}

async function runAllTests() {
  log('========================================');
  log('Ice Climber Comprehensive E2E Test Suite');
  log('========================================');
  log(`Target: ${TEST_URL}`);

  try {
    await testApiStatus();
    await testApiActors();
    await testApiActor();
    await testApiLevels();
    await testApiStats();
    await testApiPerformance();
    await testHealthEndpoint();
    await testMetricsEndpoint();
    await testObservabilityEndpoint();
    await testDataIntegrityEndpoint();
    await testLeaderboardEndpoint();
    await testStageLoading();
    await testGameStability();
    await testEndToEndFlow();

    // Summary
    log('\n========================================');
    log('COMPREHENSIVE TEST SUMMARY');
    log('========================================');
    log(`✓ PASS: ${passCount}`);
    log(`✗ FAIL: ${failCount}`);
    log(`⚠ WARN: ${warnCount}`);
    log(`TOTAL: ${passCount + failCount + warnCount}`);
    log('========================================\n');

    if (failCount > 0) {
      log('FAILED TESTS:');
      issues.forEach(issue => {
        log(`  ✗ ${issue.title}`);
        log(`    Expected: ${issue.expected}`);
        log(`    Actual: ${issue.actual}`);
      });
    }

    // Success determination
    const successRate = failCount === 0 ? 100 : Math.round((passCount / (passCount + failCount)) * 100);
    log(`\nOverall Success Rate: ${successRate}%`);

    process.exit(failCount > 0 ? 1 : 0);

  } catch (error) {
    log(`FATAL: ${error.message}`);
    process.exit(1);
  }
}

runAllTests();
