import playwright from 'playwright';

const BASE_URL = 'http://localhost:3008';
const STAGE_GOALS = {
  1: { x: 640, y: 50 },
  2: { x: 640, y: 50 },
  3: { x: 640, y: 40 },
  4: { x: 640, y: 20 }
};

const STAGE_NAMES = {
  1: 'Icy Peak',
  2: 'Glacier Pass',
  3: 'Frostfall Cavern',
  4: "Summit's Throne"
};

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGameState(page) {
  try {
    if (!page || page.isClosed?.()) {
      return null;
    }
    return page.evaluate(() => {
      try {
        if (window.client && window.client.actors) {
          const player = Array.from(window.client.actors.values()).find(a =>
            a && a.type === 'player'
          );
          if (player && player.pos && Array.isArray(player.pos)) {
            return {
              x: player.pos[0],
              y: player.pos[1],
              stage: window.client.stage,
              onGround: player.state?.on_ground || false,
              vel_y: Array.isArray(player.vel) ? player.vel[1] : 0
            };
          }
        }
      } catch (e) {
        console.error('Error getting game state:', e);
      }
      return null;
    });
  } catch (e) {
    console.error('Playwright error getting state:', e.message);
    return null;
  }
}

async function moveToGoal(page, goalX, timeout = 180000) {
  const startTime = Date.now();
  let lastX = 0;
  let stuckCount = 0;

  while (Date.now() - startTime < timeout) {
    const state = await getGameState(page);
    if (!state) {
      await delay(100);
      continue;
    }

    const distToGoal = Math.abs(state.x - goalX);

    if (distToGoal < 50) {
      console.log(`  Goal reached at X=${state.x.toFixed(0)}, Y=${state.y.toFixed(0)}`);
      return true;
    }

    if (state.x === lastX) {
      stuckCount++;
      if (stuckCount > 30) {
        console.log(`  Warning: Player stuck at X=${state.x.toFixed(0)}, Y=${state.y.toFixed(0)}`);
        await page.keyboard.press('ArrowLeft');
        await delay(500);
        await page.keyboard.press('ArrowRight');
        await delay(500);
        stuckCount = 0;
      }
    } else {
      stuckCount = 0;
    }

    lastX = state.x;

    if (state.x < goalX - 50) {
      await page.keyboard.press('ArrowRight');
    } else if (state.x > goalX + 50) {
      await page.keyboard.press('ArrowLeft');
    } else {
      await page.keyboard.press(state.x < goalX ? 'ArrowRight' : 'ArrowLeft');
    }

    await delay(100);
  }

  return false;
}

async function testStage(page, stageNum) {
  console.log(`\n=== STAGE ${stageNum}: ${STAGE_NAMES[stageNum]} ===`);

  let state = await getGameState(page);
  if (!state) {
    console.log('FAIL: Could not read game state');
    return false;
  }

  console.log(`Spawned at X=${state.x.toFixed(0)}, Y=${state.y.toFixed(0)}`);

  const goal = STAGE_GOALS[stageNum];
  console.log(`Goal: X=${goal.x}, Y=${goal.y}`);

  let lastStage = stageNum;
  const testTimeout = 300000;
  const startTime = Date.now();
  let lastLogTime = Date.now();
  let moveCount = 0;
  let noProgressCount = 0;
  let lastY = state.y;

  while (Date.now() - startTime < testTimeout) {
    state = await getGameState(page);
    if (!state) {
      await delay(100);
      continue;
    }

    if (state.stage > stageNum) {
      console.log(`Stage advanced to ${state.stage}, previous stage cleared`);
      return true;
    }

    const distToGoal = Math.abs(state.x - goal.x) + Math.abs(state.y - goal.y);

    // Log progress every 3 seconds
    if (Date.now() - lastLogTime > 3000) {
      console.log(`  Progress: X=${state.x.toFixed(0)}, Y=${state.y.toFixed(0)}, dist=${distToGoal.toFixed(0)}, onGround=${state.onGround}`);
      lastLogTime = Date.now();
    }

    if (distToGoal < 80) {
      console.log(`Goal area reached at X=${state.x.toFixed(0)}, Y=${state.y.toFixed(0)}`);
      console.log(`Waiting for stage transition (client sends nextstage after 3 seconds)...`);
      await delay(5000);
      continue;
    }

    // Check if player fell off the map
    if (state.y > 800) {
      console.log(`FATAL: Player fell off map at Y=${state.y.toFixed(0)}`);
      break;
    }

    // Simple navigation: move right to reach the goal, jump when on ground
    if (state.x < goal.x - 50) {
      await page.keyboard.press('ArrowRight');
    } else if (state.x > goal.x + 50) {
      await page.keyboard.press('ArrowLeft');
    } else if (state.onGround) {
      // Jump to climb higher
      await page.keyboard.press('Space');
    } else {
      // Move toward goal while in air
      if (state.x < goal.x) {
        await page.keyboard.press('ArrowRight');
      } else {
        await page.keyboard.press('ArrowLeft');
      }
    }

    moveCount++;
    await delay(100);
  }

  console.log(`TIMEOUT: Did not complete stage ${stageNum} in ${testTimeout}ms (moves: ${moveCount})`);
  return false;
}

async function main() {
  const browser = await playwright.chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('Connecting to game server...');
    await page.goto(BASE_URL);
    await page.waitForTimeout(5000);

    // Debug: Check what's available
    const debugInfo = await page.evaluate(() => {
      if (!window.client) return { error: 'No client' };
      const actors = Array.from(window.client.actors.values());
      const playerActors = actors.filter(a => a && a.type === 'player');
      const player = playerActors[0];
      return {
        hasClient: true,
        actorCount: window.client.actors.size,
        allActors: actors.slice(0, 3).map(a => ({ type: a?.type, keys: a ? Object.keys(a) : [] })),
        playerCount: playerActors.length,
        playerInfo: player ? {
          type: player.type,
          hasPos: !!player.pos,
          pos: player.pos,
          hasVel: !!player.vel,
          vel: player.vel,
          state: player.state
        } : null
      };
    });
    console.log('Debug info:', JSON.stringify(debugInfo, null, 2));

    console.log('\n=== STAGE 1: Icy Peak ===');
    const goal1 = STAGE_GOALS[1];
    console.log(`Goal: X=${goal1.x}, Y=${goal1.y}`);

    const stage1Complete = await testStage(page, 1);
    if (!stage1Complete) {
      console.log('\nSTAGE 1 INCOMPLETE: Could not progress to Stage 2');
      process.exit(1);
    }

    console.log('\nWaiting for Stage 2 load...');
    await delay(3000);

    const stage2Complete = await testStage(page, 2);
    console.log(`\nSTAGE 2: ${stage2Complete ? 'PASS' : 'FAIL'}`);

    if (stage2Complete) {
      console.log('\nWaiting for Stage 3 load...');
      await delay(3000);

      const stage3Complete = await testStage(page, 3);
      console.log(`\nSTAGE 3: ${stage3Complete ? 'PASS' : 'FAIL'}`);

      if (stage3Complete) {
        console.log('\nWaiting for Stage 4 load...');
        await delay(3000);

        const stage4Complete = await testStage(page, 4);
        console.log(`\nSTAGE 4: ${stage4Complete ? 'PASS' : 'FAIL'}`);

        if (stage4Complete) {
          console.log('\n=== ALL STAGES PASSED ===');
        }
      }
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
