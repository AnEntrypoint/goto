const http = require('http');
const { WebSocket } = require('ws');

const TEST_URL = 'http://localhost:3008';
const WS_URL = 'ws://localhost:3008';

let passCount = 0;
let failCount = 0;
const results = [];

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    'info': '[INFO]',
    'success': '[PASS]',
    'error': '[FAIL]',
    'warning': '[WARN]'
  }[level] || '[LOG]';
  console.log(`${prefix} ${timestamp} ${message}`);
}

function pass(title, details) {
  passCount++;
  results.push({ status: 'PASS', title, details });
  log(`${title} - ${details}`, 'success');
}

function fail(title, expected, actual, error = '') {
  failCount++;
  results.push({ status: 'FAIL', title, expected, actual, error });
  log(`${title}`, 'error');
  log(`  Expected: ${expected}`, 'error');
  log(`  Actual: ${actual}`, 'error');
  if (error) log(`  Error: ${error}`, 'error');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function testHttpServer(callback) {
  log('=== TEST 1: HTTP SERVER CONNECTIVITY ===');

  const req = http.get(TEST_URL, (res) => {
    if (res.statusCode === 200) {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.includes('Ice Climber')) {
          pass('HTTP server accessible', 'GET /');
          callback();
        } else {
          fail('HTTP server content', 'HTML with "Ice Climber"', 'Different HTML');
          callback();
        }
      });
    } else {
      fail('HTTP response code', '200', res.statusCode);
      callback();
    }
  });

  req.on('error', (err) => {
    fail('HTTP server connectivity', 'Server reachable on localhost:3008', err.message);
    callback();
  });

  req.setTimeout(5000);
}

function testWebSocketConnection(callback) {
  log('');
  log('=== TEST 2: WEBSOCKET CONNECTION ===');

  try {
    const ws = new WebSocket(WS_URL);
    let connected = false;
    let messageReceived = false;
    let messageCount = 0;

    ws.on('open', () => {
      connected = true;
      pass('WebSocket connection', `Connected to ${WS_URL}`);

      // Send test message
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {
        // May fail if server doesn't expect ping
      }
    });

    ws.on('message', (data) => {
      messageReceived = true;
      messageCount++;
    });

    ws.on('error', (err) => {
      if (!connected) {
        fail('WebSocket connection', 'WebSocket reachable', err.message);
      }
    });

    setTimeout(() => {
      if (messageCount > 0) {
        pass('WebSocket messages', `Received ${messageCount} messages`);
      } else {
        log('WebSocket connection established but no messages received (may be normal)', 'warning');
      }

      try {
        ws.close();
      } catch (e) {}

      callback();
    }, 2000);
  } catch (err) {
    fail('WebSocket setup', 'Connection established', err.message);
    callback();
  }
}

function testGameLoadedContent(callback) {
  log('');
  log('=== TEST 3: GAME HTML CONTENT ===');

  const req = http.get(TEST_URL, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      // Check for key game elements
      const hasCanvas = data.includes('<canvas');
      const hasScript = data.includes('<script');
      const hasGameTitle = data.includes('Ice Climber');

      if (hasCanvas && hasScript && hasGameTitle) {
        pass('Game HTML structure', 'Canvas, scripts, and title present');
      } else {
        const missing = [];
        if (!hasCanvas) missing.push('canvas');
        if (!hasScript) missing.push('scripts');
        if (!hasGameTitle) missing.push('title');
        fail('Game HTML structure', 'All elements present', `Missing: ${missing.join(', ')}`);
      }

      callback();
    });
  });

  req.on('error', (err) => {
    fail('Game HTML content', 'Page loaded', err.message);
    callback();
  });
}

function testGameEndpoints(callback) {
  log('');
  log('=== TEST 4: GAME API ENDPOINTS ===');

  const endpoints = [
    { path: '/', method: 'GET', expectCode: 200, description: 'Root page' },
    { path: '/?stage=1', method: 'GET', expectCode: 200, description: 'Stage 1 load' },
    { path: '/?stage=2', method: 'GET', expectCode: 200, description: 'Stage 2 load' },
  ];

  let completed = 0;
  let allPassed = true;

  endpoints.forEach(endpoint => {
    const url = `${TEST_URL}${endpoint.path}`;
    const req = http.get(url, (res) => {
      if (res.statusCode === endpoint.expectCode) {
        pass(`Endpoint ${endpoint.description}`, `${endpoint.path} returns ${res.statusCode}`);
      } else {
        fail(`Endpoint ${endpoint.description}`, endpoint.expectCode, res.statusCode);
        allPassed = false;
      }

      completed++;
      if (completed === endpoints.length) {
        callback();
      }
    });

    req.on('error', (err) => {
      fail(`Endpoint ${endpoint.description}`, 'Accessible', err.message);
      allPassed = false;
      completed++;
      if (completed === endpoints.length) {
        callback();
      }
    });

    req.setTimeout(5000);
  });
}

function testGameStages(callback) {
  log('');
  log('=== TEST 5: GAME STAGES STATUS ===');

  const req = http.get(`${TEST_URL}/api/status`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const status = JSON.parse(data);

        // Check for stage property
        if (typeof status.stage !== 'undefined') {
          pass('Game status API', `Stage ${status.stage} loaded`);

          if (typeof status.frame !== 'undefined') {
            pass('Frame counter', `Frame ${status.frame}`);
          }

          if (typeof status.actors !== 'undefined') {
            pass('Actor tracking', `${status.actors} actors in scene`);
          }
        } else {
          log('Game status endpoint not available (may be normal)', 'warning');
        }
      } catch (e) {
        log('Game status JSON parsing not available (may be normal)', 'warning');
      }
      callback();
    });
  });

  req.on('error', (err) => {
    log('Game status endpoint not available (may be normal)', 'warning');
    callback();
  });

  req.setTimeout(3000);
}

function testGamePerformance(callback) {
  log('');
  log('=== TEST 6: SERVER PERFORMANCE ===');

  const startTime = Date.now();
  let requestsCompleted = 0;
  const requestCount = 10;
  const times = [];

  for (let i = 0; i < requestCount; i++) {
    const reqStart = Date.now();
    const req = http.get(TEST_URL, (res) => {
      const responseTime = Date.now() - reqStart;
      times.push(responseTime);
      requestsCompleted++;

      if (requestsCompleted === requestCount) {
        const avgTime = Math.round(times.reduce((a, b) => a + b) / times.length);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        if (avgTime < 500) {
          pass('Response time', `Avg: ${avgTime}ms (min: ${minTime}ms, max: ${maxTime}ms)`);
        } else {
          log(`Response time slow: ${avgTime}ms average`, 'warning');
        }

        callback();
      }

      res.resume();
    });

    req.on('error', (err) => {
      requestsCompleted++;
      if (requestsCompleted === requestCount) {
        callback();
      }
    });

    req.setTimeout(5000);
  }
}

function printSummary() {
  log('');
  log('='.repeat(70));
  log('TEST SUMMARY', 'info');
  log('='.repeat(70));
  log(`PASS: ${passCount}`, 'success');
  log(`FAIL: ${failCount}`, failCount > 0 ? 'error' : 'success');
  log(`TOTAL: ${passCount + failCount}`, 'info');
  log('='.repeat(70));

  if (failCount > 0) {
    log('');
    log('FAILED TESTS:', 'error');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  [FAIL] ${r.title}`, 'error');
      log(`         Expected: ${r.expected}`, 'error');
      log(`         Actual: ${r.actual}`, 'error');
      if (r.error) log(`         Error: ${r.error}`, 'error');
    });
  }

  log('');
  log('='.repeat(70));
  log('INFRASTRUCTURE TESTS COMPLETED', 'success');
  log('='.repeat(70));
}

async function runAllTests() {
  log('Starting Ice Climber Infrastructure Test Suite');
  log(`Target: ${TEST_URL}`);
  log('');

  try {
    testHttpServer(() => {
      testWebSocketConnection(() => {
        testGameLoadedContent(() => {
          testGameEndpoints(() => {
            testGameStages(() => {
              testGamePerformance(() => {
                printSummary();
                process.exit(failCount > 0 ? 1 : 0);
              });
            });
          });
        });
      });
    });
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
    process.exit(1);
  }
}

runAllTests();
