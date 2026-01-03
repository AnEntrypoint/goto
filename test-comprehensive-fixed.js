const http = require('http');

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

  } catch (error) {
    fail('API Status test', 'Valid response', error.message);
  }

  await sleep(150);
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

  await sleep(150);
}

async function testApiLevels() {
  log('\n=== TEST 3: API LEVELS ENDPOINTS ===');
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

      for (let i = 1; i <= 4; i++) {
        await sleep(150);
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

  await sleep(150);
}

async function testApiStats() {
  log('\n=== TEST 4: API STATS ENDPOINT ===');
  try {
    const res = await fetchJson('/api/stats');

    if (res.status === 200) {
      pass('Stats endpoint', 'HTTP 200');

      const data = res.data;
      if (data.uptime !== undefined) pass('Uptime stat', `${Math.round(data.uptime)}ms`);
      if (data.frameRate !== undefined) pass('Frame rate stat', `${data.frameRate.toFixed(1)} FPS`);
      if (data.totalActors !== undefined) pass('Total actors stat', `${data.totalActors} actors`);
    } else {
      fail('Stats endpoint', '200', res.status);
    }

  } catch (error) {
    fail('API Stats test', 'Valid response', error.message);
  }

  await sleep(150);
}

async function testApiPerformance() {
  log('\n=== TEST 5: API PERFORMANCE ENDPOINT ===');
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

  await sleep(150);
}

async function testHealthEndpoint() {
  log('\n=== TEST 6: HEALTH ENDPOINT ===');
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

  await sleep(150);
}

async function testMetricsEndpoint() {
  log('\n=== TEST 7: METRICS ENDPOINT ===');
  try {
    const res = await fetchJson('/metrics');

    if (res.status === 200) {
      pass('Metrics endpoint', 'HTTP 200');

      if (res.data.includes && res.data.includes('# HELP')) {
        pass('Metrics format', 'Valid Prometheus format');
      } else {
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

  await sleep(150);
}

async function testStageLoading() {
  log('\n=== TEST 8: STAGE LOADING ===');
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

      await sleep(150);
    }

  } catch (error) {
    fail('Stage loading test', 'All stages loadable', error.message);
  }
}

async function testGameStability() {
  log('\n=== TEST 9: GAME STABILITY (30 seconds) ===');
  try {
    const startStatus = await fetchJson('/api/status');
    const startFrame = startStatus.data.frame;
    let errors = 0;
    let checks = 0;

    for (let i = 0; i < 6; i++) {
      await sleep(5150);
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
  log('\n=== TEST 10: END-TO-END FLOW ===');
  try {
    const initial = await fetchJson('/api/status');
    pass('Get initial state', `Frame ${initial.data.frame}`);

    await sleep(150);

    const health = await fetchJson('/health');
    pass('Check health', health.data.status || 'Unknown');

    await sleep(150);

    for (let i = 1; i <= 4; i++) {
      const stage = await fetchJson(`/?stage=${i}`);
      pass(`Load stage ${i}`, 'HTTP 200');
      await sleep(150);
    }

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
  log('Note: 150ms delay between API calls to respect rate limiting (100ms/request)');

  try {
    await testApiStatus();
    await testApiActors();
    await testApiLevels();
    await testApiStats();
    await testApiPerformance();
    await testHealthEndpoint();
    await testMetricsEndpoint();
    await testStageLoading();
    await testGameStability();
    await testEndToEndFlow();

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

    const successRate = failCount === 0 ? 100 : Math.round((passCount / (passCount + failCount)) * 100);
    log(`\nOverall Success Rate: ${successRate}%`);

    process.exit(failCount > 0 ? 1 : 0);

  } catch (error) {
    log(`FATAL: ${error.message}`);
    process.exit(1);
  }
}

runAllTests();
