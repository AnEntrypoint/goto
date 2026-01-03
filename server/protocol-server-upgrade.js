const ProtocolIntegration = require('./protocol-integration');

function upgradeServerWithProtocol(game, wss) {
  console.error('[PROTOCOL] Initializing protocol integration layer');

  const protocolIntegration = new ProtocolIntegration(game);
  game.protocolIntegration = protocolIntegration;

  const heartbeatInterval = setInterval(() => {
    try {
      for (const [playerId, client] of game.clients) {
        if (!client || !client.ws) continue;
        if (client.ws.readyState !== 1) continue;

        const msg = protocolIntegration.protocol.buildMessage('HEARTBEAT', { frame: game.frame });
        try {
          client.ws.send(JSON.stringify(msg));
          const sessionId = protocolIntegration.clientSessions.get(playerId);
          if (sessionId) {
            protocolIntegration.protocol.recordHeartbeat(sessionId);
          }
        } catch (e) {
          console.error(`[PROTOCOL] Heartbeat send failed for ${playerId}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`[PROTOCOL] Heartbeat error: ${e.message}`);
    }
  }, 30000);

  const idleCheckInterval = setInterval(() => {
    try {
      const toDisconnect = [];
      const now = Date.now();

      for (const [playerId, client] of game.clients) {
        if (!client) continue;

        const inactiveTime = now - (client.lastActivity || client.connectedAt || now);
        if (inactiveTime > 300000) {
          toDisconnect.push({ playerId, client });
        }

        const sessionId = protocolIntegration.clientSessions.get(playerId);
        if (sessionId && protocolIntegration.protocol.checkHeartbeatTimeout(sessionId)) {
          toDisconnect.push({ playerId, client });
        }
      }

      for (const { playerId, client } of toDisconnect) {
        if (client && client.ws) {
          console.error(`[PROTOCOL] Disconnecting player ${playerId} (idle/heartbeat timeout)`);
          try {
            const sessionId = protocolIntegration.clientSessions.get(playerId);
            if (sessionId) {
              const sessionExpiredMsg = protocolIntegration.protocol.buildMessage('SESSION_EXPIRED', {
                reason: inactiveTime > 300000 ? 'inactivity' : 'heartbeat_timeout',
                reconnectDeadline: Date.now() + 5000
              });
              client.ws.send(JSON.stringify(sessionExpiredMsg));
            }
          } catch (e) {}
          client.ws.close(1000, 'Idle timeout');
        }
      }
    } catch (e) {
      console.error(`[PROTOCOL] Idle check error: ${e.message}`);
    }
  }, 60000);

  const cleanupInterval = setInterval(() => {
    try {
      protocolIntegration.cleanup();
    } catch (e) {
      console.error(`[PROTOCOL] Cleanup error: ${e.message}`);
    }
  }, 300000);

  const originalStop = game.stop.bind(game);
  game.stop = function() {
    clearInterval(heartbeatInterval);
    clearInterval(idleCheckInterval);
    clearInterval(cleanupInterval);
    return originalStop();
  };

  console.error('[PROTOCOL] Integration complete: heartbeat, idle timeout, cleanup initialized');

  return {
    protocolIntegration,
    heartbeatInterval,
    idleCheckInterval,
    cleanupInterval
  };
}

function wrapMessageHandler(protocolIntegration, playerId, game, originalHandler) {
  return async function(msg) {
    try {
      const result = await protocolIntegration.handleClientMessage(playerId, msg);

      if (result && result.send && result.payload) {
        try {
          const client = game.clients.get(playerId);
          if (client && client.ws && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(result.payload));
          }
        } catch (sendErr) {
          console.error(`[PROTOCOL] Send error: ${sendErr.message}`);
        }
      }
    } catch (error) {
      console.error(`[PROTOCOL] Message error: ${error.message}`);
      try {
        const client = game.clients.get(playerId);
        if (client && client.ws && client.ws.readyState === 1) {
          const errorMsg = protocolIntegration.protocol.buildError(
            'INTERNAL_ERROR',
            error.message || 'Unknown error',
            {}
          );
          client.ws.send(JSON.stringify(errorMsg));
        }
      } catch (e) {
      }
    }
  };
}

module.exports = {
  upgradeServerWithProtocol,
  wrapMessageHandler
};
