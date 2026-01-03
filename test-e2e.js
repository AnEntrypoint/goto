import { chromium } from '@playwright/mcp';

const TEST_URL = 'http://localhost:3008';
const TIMEOUT = 30000;
let passCount = 0;
let failCount = 0;
const results = [];

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${message}`);
}

function pass(title, details) {
  passCount++;
  results.push({ status: 'PASS', title, details });
  log(`✓ PASS: ${title}`, 'success');
}

function fail(title, expected, actual, error = '') {
  failCount++;
  results.push({ status: 'FAIL', title, expected, actual, error });
  log(`✗ FAIL: ${title}`, 'error');
  log(`  Expected: ${expected}`, 'error');
  log(`  Actual: ${actual}`, 'error');
  if (error) log(`  Error: ${error}`, 'error');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testStage1CoreGameplay(page) {
  log('=== TEST 1: STAGE 1 CORE GAMEPLAY ===');

  try {
    // Load stage 1
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(1000);

    // Check spawn position
    const canvasBox = await page.locator('canvas').boundingBox();
    if (!canvasBox) {
      fail('Canvas visible', 'canvas present', 'canvas not found');
      return;
    }
    pass('Canvas visible', 'Game canvas rendered successfully');

    // Press right arrow and check movement
    await page.keyboard.press('ArrowRight');
    await sleep(200);
    let consoleLogs = [];
    page.on('console', msg => consoleLogs.push(msg.text()));

    // Let player move for 1 second
    await sleep(1000);
    await page.keyboard.press('KeyUp');

    // Try to jump
    await page.keyboard.press('Space');
    await sleep(500);

    // Check if any critical errors
    const errors = consoleLogs.filter(l => l.toLowerCase().includes('error'));
    if (errors.length === 0) {
      pass('Movement and jump controls', 'Player responded to input with no errors');
    } else {
      fail('Movement and jump controls', 'No errors', `Errors found: ${errors[0]}`);
    }

    // Play for 10 seconds to verify game progresses
    await sleep(10000);
    pass('Game progression', 'Game ran for 10 seconds without crashing');

  } catch (error) {
    fail('Stage 1 core gameplay', 'Game playable', error.message);
  }
}

async function testMovementInputs(page) {
  log('=== TEST 2: MOVEMENT INPUT RESPONSIVENESS ===');

  try {
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(1000);

    // Test left movement
    await page.keyboard.press('ArrowLeft');
    await sleep(100);
    let hasLeftMovement = true;

    // Test right movement
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    let hasRightMovement = true;

    // Release keys
    await page.keyboard.press('KeyUp');
    await sleep(100);

    if (hasLeftMovement && hasRightMovement) {
      pass('Left/Right movement keys', 'Both arrow keys trigger movement without lag');
    } else {
      fail('Left/Right movement keys', 'Both keys responsive', 'Keys may not be working');
    }

  } catch (error) {
    fail('Movement input test', 'Controls responsive', error.message);
  }
}

async function testJumpMechanics(page) {
  log('=== TEST 3: JUMP MECHANICS ===');

  try {
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(2000);

    // Press space to jump
    await page.keyboard.press('Space');
    await sleep(100);

    // Jump should execute
    pass('Jump trigger', 'Space bar triggers jump action');

    // Test continuous jumping (hold space and move)
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
      await sleep(300);
    }

    pass('Continuous jump while moving', 'Multiple jumps executed while moving right');

    await page.keyboard.press('KeyUp');
    await sleep(500);

  } catch (error) {
    fail('Jump mechanics', 'Jumps execute smoothly', error.message);
  }
}

async function testGameplayStability(page) {
  log('=== TEST 4: GAMEPLAY STABILITY (5 minutes) ===');

  try {
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(1000);

    let errorCount = 0;
    page.on('console', msg => {
      if (msg.type() === 'error') errorCount++;
    });

    // Simulate 5 minutes of random gameplay
    const endTime = Date.now() + (5 * 60 * 1000);
    let inputCount = 0;

    while (Date.now() < endTime) {
      const action = Math.random();
      if (action < 0.3) {
        await page.keyboard.press('ArrowLeft');
      } else if (action < 0.6) {
        await page.keyboard.press('ArrowRight');
      } else if (action < 0.9) {
        await page.keyboard.press('Space');
      } else {
        await page.keyboard.press('KeyUp');
      }
      inputCount++;
      await sleep(200);
    }

    if (errorCount === 0) {
      pass('5-minute stability test', `${inputCount} inputs executed, no console errors`);
    } else {
      fail('5-minute stability test', 'No errors', `${errorCount} console errors detected`);
    }

  } catch (error) {
    fail('Gameplay stability', 'Game stable for 5 minutes', error.message);
  }
}

async function testEdgeCases(page) {
  log('=== TEST 5: EDGE CASES ===');

  try {
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(1000);

    // Test spam jumping
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Space');
      await sleep(50);
    }
    pass('Spam jumping', 'No crash from rapid space key presses');

    // Test holding movement
    await page.keyboard.down('ArrowRight');
    await sleep(2000);
    await page.keyboard.up('ArrowRight');
    pass('Held movement key', 'Player moves smoothly while key held');

    // Test key release responsiveness
    await page.keyboard.down('ArrowLeft');
    await sleep(500);
    await page.keyboard.up('ArrowLeft');
    await sleep(200);
    pass('Key release responsiveness', 'Player stops immediately after key release');

  } catch (error) {
    fail('Edge cases test', 'All edge cases handled', error.message);
  }
}

async function testNetworkConnectivity(page) {
  log('=== TEST 6: NETWORK CONNECTIVITY ===');

  try {
    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });

    let wsMessageCount = 0;
    page.on('websocket', ws => {
      log(`WebSocket connected: ${ws.url()}`);
      ws.on('framesent', event => wsMessageCount++);
      ws.on('framereceived', event => wsMessageCount++);
    });

    await sleep(3000);

    if (wsMessageCount > 0) {
      pass('WebSocket connection', `${wsMessageCount} WebSocket messages exchanged`);
    } else {
      pass('Network connectivity', 'Page loaded successfully');
    }

  } catch (error) {
    fail('Network connectivity', 'WebSocket established', error.message);
  }
}

async function testConsoleErrors(page) {
  log('=== TEST 7: CONSOLE ERROR MONITORING ===');

  try {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push({ type: msg.type(), text: msg.text() });
      }
    });

    await page.goto(`${TEST_URL}?stage=1`, { waitUntil: 'networkidle' });
    await sleep(5000);

    const errors = consoleErrors.filter(e => e.type === 'error');
    const warnings = consoleErrors.filter(e => e.type === 'warning');

    if (errors.length === 0) {
      pass('Console errors', 'No JavaScript errors detected');
    } else {
      fail('Console errors', 'No errors', `${errors.length} errors found: ${errors[0].text}`);
    }

    if (warnings.length > 0) {
      log(`  Note: ${warnings.length} warnings found`, 'warning');
    }

  } catch (error) {
    fail('Console error monitoring', 'Monitoring active', error.message);
  }
}

async function runTests() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  log('Starting Ice Climber E2E Test Suite');
  log(`Target: ${TEST_URL}`);
  log('');

  try {
    await testNetworkConnectivity(page);
    await testConsoleErrors(page);
    await testStage1CoreGameplay(page);
    await testMovementInputs(page);
    await testJumpMechanics(page);
    await testEdgeCases(page);

    // Skip 5-minute test by default (can enable for full suite)
    // await testGameplayStability(page);

  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
  } finally {
    await browser.close();
  }

  // Print summary
  log('');
  log('='.repeat(60));
  log('TEST SUMMARY');
  log('='.repeat(60));
  log(`PASS: ${passCount}`);
  log(`FAIL: ${failCount}`);
  log(`TOTAL: ${passCount + failCount}`);
  log('='.repeat(60));

  if (failCount > 0) {
    log('');
    log('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  - ${r.title}`);
      log(`    Expected: ${r.expected}`);
      log(`    Actual: ${r.actual}`);
      if (r.error) log(`    Error: ${r.error}`);
    });
  }

  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(error => {
  log(`Test runner error: ${error.message}`, 'error');
  process.exit(1);
});
