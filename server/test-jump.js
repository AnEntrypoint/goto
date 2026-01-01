const WebSocket = require('ws');

async function testJump() {
  const ws = new WebSocket('ws://127.0.0.1:3008');
  let updateCount = 0;
  const positions = [];

  ws.on('open', () => {
    console.log('[TEST] Connected');
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'init') {
        console.log('[INIT] Player spawned');

        // Wait a moment then jump
        setTimeout(() => {
          console.log('[ACTION] Sending jump');
          ws.send(JSON.stringify({ action: 'jump' }));
        }, 100);

      } else if (data.type === 'update') {
        updateCount++;
        const playerActor = Object.values(data.actors).find(a => a && a.state && a.state.player_id === 1);

        if (playerActor) {
          const pos_y = playerActor.pos[1];
          positions.push(pos_y);

          if (updateCount <= 5 || updateCount % 5 === 0) {
            console.log(`[UPDATE ${updateCount}] Y: ${pos_y.toFixed(1)}, on_ground: ${playerActor.state.on_ground}`);
          }

          if (updateCount === 60) {
            console.log('[JUMP TEST RESULTS]');
            console.log(`Initial Y: ${positions[0].toFixed(1)}`);
            console.log(`Min Y: ${Math.min(...positions).toFixed(1)} (jumped up)`);
            console.log(`Final Y: ${positions[59].toFixed(1)}`);

            const jumped = positions[0] - Math.min(...positions) > 10;
            console.log(jumped ? '[SUCCESS] Player jumped!' : '[FAIL] Player did not jump');
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

testJump().catch(console.error);
