const ProtocolIntegration = require('./protocol-integration');

function patchServerWithProtocol(app, wss, game) {
  const protocolIntegration = new ProtocolIntegration(game);

  const originalWssOnConnection = wss.emit;

  const heartbeatInterval = setInterval(() => {
    for (const [playerId, client] of game.clients) {
      if (client && client.ws) {
        protocolIntegration.sendHeartbeat(playerId);
        protocolIntegration.protocol.recordHeartbeat(protocolIntegration.clientSessions.get(playerId));
      }
    }
  }, 30000);

  const idleCheckInterval = setInterval(() => {
    const toDisconnect = [];
    for (const [playerId, client] of game.clients) {
      if (protocolIntegration.checkIdleTimeout(playerId)) {
        toDisconnect.push(playerId);
      }
    }
    for (const playerId of toDisconnect) {
      const client = game.clients.get(playerId);
      if (client && client.ws) {
        console.error(`[PROTOCOL] Disconnecting idle player ${playerId}`);
        client.ws.close(1000, 'Idle timeout');
      }
    }
  }, 60000);

  const cleanupInterval = setInterval(() => {
    protocolIntegration.cleanup();
  }, 300000);

  game.protocolIntegration = protocolIntegration;
  game.cleanup = game.cleanup || (() => {});
  const originalCleanup = game.cleanup;
  game.cleanup = function() {
    clearInterval(heartbeatInterval);
    clearInterval(idleCheckInterval);
    clearInterval(cleanupInterval);
    originalCleanup.call(this);
  };

  return {
    protocolIntegration,
    heartbeatInterval,
    idleCheckInterval,
    cleanupInterval
  };
}

function patchWebSocketMessageHandler(ws, playerId, game, protocolIntegration) {
  const originalMessageHandler = ws.onmessage;

  return async function(msg) {
    try {
      const result = await protocolIntegration.handleClientMessage(playerId, msg);

      if (result && result.send && result.payload) {
        try {
          ws.send(JSON.stringify(result.payload));
        } catch (sendErr) {
          console.error(`[PROTOCOL] Failed to send response: ${sendErr.message}`);
        }
      }
    } catch (error) {
      console.error(`[PROTOCOL] Message handler error: ${error.message}`);
      try {
        const errorMsg = protocolIntegration.protocol.buildError(
          'INTERNAL_ERROR',
          error.message,
          { stack: error.stack.split('\n').slice(0, 3).join('; ') }
        );
        ws.send(JSON.stringify(errorMsg));
      } catch (e) {
        console.error(`[PROTOCOL] Failed to send error: ${e.message}`);
      }
    }
  };
}

module.exports = {
  patchServerWithProtocol,
  patchWebSocketMessageHandler,
  ProtocolIntegration
};
