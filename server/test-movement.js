const WebSocket = require('ws');

async function testMovement() {
  const ws = new WebSocket('ws://127.0.0.1:3008');
  let initialPlayerX = null;
  let updateCount = 0;
  const positions = [];

  ws.on('open', () => {
    console.log('[TEST] Connected');
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'init') {
        const playerActor = data.actors.find(a => a.type === 'player');
        if (playerActor) {
          initialPlayerX = playerActor.pos[0];
          console.log('[INIT] Player spawned at X:', initialPlayerX.toFixed(1));
        }

        setTimeout(() => {
          console.log('[INPUT] Sending move right (direction: 1.0)');
          ws.send(JSON.stringify({ action: 'move', direction: 1.0 }));
        }, 100);

      } else if (data.type === 'update') {
        updateCount++;
        const playerActor = Object.values(data.actors).find(a => a && a.state && a.state.player_id === 1);

        if (playerActor) {
          const currentX = playerActor.pos[0];
          positions.push(currentX);

          if (updateCount <= 5 || updateCount % 10 === 0) {
            const moved = currentX - initialPlayerX;
            console.log(`[UPDATE ${updateCount}] X: ${currentX.toFixed(1)}, moved: ${moved.toFixed(1)}`);
          }

          if (updateCount === 60) {
            const avgVelocity = (positions[59] - positions[0]) / 59;
            console.log(`\n[RESULTS]`);
            console.log(`Initial X: ${initialPlayerX.toFixed(1)}`);
            console.log(`Final X: ${positions[59].toFixed(1)}`);
            console.log(`Total movement: ${(positions[59] - initialPlayerX).toFixed(1)} units`);
            console.log(`Avg velocity: ${avgVelocity.toFixed(2)} units/frame`);
            console.log(`Expected speed: 200 units/sec = 3.33 units/frame`);

            if (avgVelocity > 2.0) {
              console.log('[SUCCESS] Movement working!');
            } else {
              console.log('[FAIL] Movement not working');
            }
            ws.close();
          }
        }
      }
    } catch (e) {
      console.error('[ERROR]', e.message);
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.error('[ERROR] Connection error:', err.message);
    process.exit(1);
  });

  ws.on('close', () => {
    console.log('[TEST] Connection closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[TIMEOUT]');
    ws.close();
    process.exit(1);
  }, 15000);
}

testMovement().catch(console.error);
