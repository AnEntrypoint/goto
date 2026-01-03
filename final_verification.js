const http = require('http');
const { spawn } = require('child_process');

console.log('='.repeat(70));
console.log('OBSERVABILITY SYSTEM - FINAL VERIFICATION');
console.log('='.repeat(70));

const server = spawn('node', ['server/index.js'], { cwd: __dirname });
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return new Promise((resolve) => {
    fn()
      .then(() => {
        console.log(`✓ ${name}`);
        testsPassed++;
        resolve();
      })
      .catch(err => {
        console.error(`✗ ${name}: ${err.message}`);
        testsFailed++;
        resolve();
      });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3008${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  await delay(2000);

  // Test 1: Server is running
  await test('Server running on port 3008', () =>
    httpGet('/health').then(data => {
      if (!data.includes('healthy')) throw new Error('Not healthy');
    })
  );

  // Test 2: Metrics endpoint exists
  await test('/metrics endpoint exists', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('HELP')) throw new Error('Not Prometheus format');
      if (data.length < 100) throw new Error('Too short');
    })
  );

  // Test 3: Prometheus format
  await test('Prometheus format valid', () =>
    httpGet('/metrics').then(data => {
      const lines = data.split('\n');
      let hasGauge = false, hasHistogram = false, hasHelp = false;
      for (const line of lines) {
        if (line.includes('TYPE')) hasHistogram = line.includes('histogram');
        if (line.includes('HELP')) hasHelp = true;
        if (line.match(/^[\w_]+ \d+/)) hasGauge = true;
      }
      if (!hasHelp || !hasGauge) throw new Error('Missing Prometheus elements');
    })
  );

  // Test 4: Frame metrics
  await test('Frame number tracked in metrics', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('game_frame_number')) throw new Error('No frame metric');
    })
  );

  // Test 5: Actor count
  await test('Actor count tracked', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('game_actors_count')) throw new Error('No actor metric');
    })
  );

  // Test 6: Tick duration histogram
  await test('Tick duration histogram present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('tick_duration_ms')) throw new Error('No tick duration');
    })
  );

  // Test 7: Memory metrics
  await test('Memory heap metric present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('memory_heap_used_mb')) throw new Error('No memory metric');
    })
  );

  // Test 8: Collision metrics
  await test('Collision statistics present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('collisions_player_platform_avg')) 
        throw new Error('No collision metric');
    })
  );

  // Test 9: Network metrics
  await test('Network broadcast metrics present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('network_broadcast_success_rate')) 
        throw new Error('No network metric');
    })
  );

  // Test 10: SLO metrics
  await test('SLO uptime metric present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('slo_uptime')) throw new Error('No SLO metric');
    })
  );

  // Test 11: Alert count
  await test('Alert counter present', () =>
    httpGet('/metrics').then(data => {
      if (!data.includes('alerts_total')) throw new Error('No alert metric');
    })
  );

  // Test 12: JSON API endpoint
  await test('/api/observability returns JSON', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.frame) throw new Error('No frame in JSON');
      if (!json.stage) throw new Error('No stage in JSON');
    })
  );

  // Test 13: Profiling data in JSON
  await test('Profiling data in JSON response', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.profiling) throw new Error('No profiling');
      if (!json.profiling.total_tick) throw new Error('No total_tick metric');
    })
  );

  // Test 14: Collision stats in JSON
  await test('Collision stats in JSON response', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.collisions) throw new Error('No collisions');
    })
  );

  // Test 15: Network stats in JSON
  await test('Network stats in JSON response', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.network) throw new Error('No network');
    })
  );

  // Test 16: SLO data in JSON
  await test('SLO data in JSON response', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.slos) throw new Error('No slos');
      if (!json.slos.sli_uptime) throw new Error('No uptime SLI');
    })
  );

  // Test 17: Alerts in JSON
  await test('Alerts in JSON response', () =>
    httpGet('/api/observability').then(data => {
      const json = JSON.parse(data);
      if (!json.alerts) throw new Error('No alerts');
      if (typeof json.alerts.total_alerts !== 'number') 
        throw new Error('No alert count');
    })
  );

  console.log('\n' + '='.repeat(70));
  console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(70));

  if (testsFailed === 0) {
    console.log('\n✓ ALL TESTS PASSED - OBSERVABILITY SYSTEM VERIFIED');
  } else {
    console.log(`\n✗ ${testsFailed} tests failed`);
  }

  server.kill();
  process.exit(testsFailed > 0 ? 1 : 0);
}

setTimeout(() => {
  server.kill();
  console.error('Timeout');
  process.exit(1);
}, 15000);

run().catch(err => {
  console.error('Test error:', err);
  server.kill();
  process.exit(1);
});
