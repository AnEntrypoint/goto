const { ProtocolHandler, ProtocolError, sanitizeString, validateAction, validateDirection } = require('./protocol');

class ProtocolIntegration {
  constructor(game) {
    this.game = game;
    this.protocol = new ProtocolHandler();
    this.clientSessions = new Map();
    this.clientSeq = new Map();
  }

  async handleClientMessage(playerId, rawData) {
    try {
      const msg = await this.protocol.parseMessage(rawData);
      const sessionId = this.clientSessions.get(playerId);

      if (msg.type === 'HELLO') {
        return this.handleHello(playerId);
      }

      await this.protocol.validateClientMessage(msg, sessionId);

      if (msg.type === 'INPUT') {
        return this.handleInput(playerId, msg.data);
      } else if (msg.type === 'ACK') {
        return this.handleAck(playerId, msg.data);
      } else if (msg.type === 'HEARTBEAT_RESPONSE') {
        return this.handleHeartbeatResponse(playerId);
      } else if (msg.type === 'BATCH') {
        return this.handleBatch(playerId, msg.data);
      }

      throw new ProtocolError('INVALID_MESSAGE_TYPE', `Unexpected message type: ${msg.type}`);
    } catch (error) {
      if (error instanceof ProtocolError) {
        return this.sendError(playerId, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  handleHello(playerId) {
    const sessionId = this.protocol.sessions.create(`client_${playerId}`);
    this.clientSessions.set(playerId, sessionId);
    this.clientSeq.set(playerId, 0);

    const response = this.protocol.buildMessage('HELLO_ACK', {
      serverVersion: 1.1,
      sessionId,
      sessionExpiry: Date.now() + 1800000,
      supportedFeatures: ['compression', 'delta'],
      negotiatedVersion: 1.1
    });

    return { send: true, payload: response };
  }

  handleInput(playerId, data) {
    if (!data || typeof data !== 'object') {
      throw new ProtocolError('INVALID_INPUT', 'Input data must be object');
    }

    const { action, direction } = data;
    validateAction(action);

    if (action === 'move') {
      validateDirection(direction);
    }

    const client = this.game.clients.get(playerId);
    if (!client) {
      throw new ProtocolError('INVALID_ACTOR_STATE', 'Player not found', { playerId });
    }

    client.lastActivity = Date.now();

    if (action === 'move') {
      if (this.game.playerActors.has(playerId) && this.game.clients.has(playerId)) {
        this.game.pendingInput.set(playerId, { action: 'move', direction });
      }
    } else if (action === 'jump') {
      if (this.game.playerActors.has(playerId) && this.game.clients.has(playerId)) {
        this.game.pendingInput.set(playerId, { action: 'jump' });
      }
    } else if (action === 'nextstage') {
      const actor = this.game.playerActors.get(playerId);
      if (actor && !actor.state.removed && actor.state._goal_reached && !this.game.stage_transitioning) {
        this.game.nextStage();
      }
    } else if (action === 'pause') {
      if (this.game.clients.has(playerId)) {
        this.game.pausedPlayers.add(playerId);
        const pausedSnapshot = Array.from(this.game.pausedPlayers);
        const connectedCount = pausedSnapshot.filter(pid => this.game.clients.has(pid)).length;
        const allConnectedPaused = connectedCount > 0 && connectedCount === this.game.clients.size;
        if (allConnectedPaused && !this.game.paused) {
          this.game.paused = true;
          const pauseMsg = this.protocol.buildMessage('PAUSE', { frame: this.game.frame });
          this.broadcastToAll(pauseMsg);
        }
      }
    } else if (action === 'resume') {
      if (this.game.clients.has(playerId)) {
        this.game.pausedPlayers.delete(playerId);
        const pausedSnapshot = Array.from(this.game.pausedPlayers);
        const connectedCount = pausedSnapshot.filter(pid => this.game.clients.has(pid)).length;
        const anyConnectedPaused = connectedCount > 0;
        if (!anyConnectedPaused && this.game.clients.size > 0 && this.game.paused) {
          this.game.paused = false;
          const resumeMsg = this.protocol.buildMessage('RESUME', { frame: this.game.frame });
          this.broadcastToAll(resumeMsg);
        }
      }
    }

    return { send: false };
  }

  handleAck(playerId, data) {
    if (typeof data.seq === 'number') {
      const latency = Date.now() - (data.timestamp || Date.now());
      const client = this.game.clients.get(playerId);
      if (client) {
        client.lastAckLatency = latency;
      }
    }
    return { send: false };
  }

  handleHeartbeatResponse(playerId) {
    const sessionId = this.clientSessions.get(playerId);
    if (sessionId) {
      this.protocol.recordHeartbeat(sessionId);
    }
    const client = this.game.clients.get(playerId);
    if (client) {
      client.lastActivity = Date.now();
    }
    return { send: false };
  }

  handleBatch(playerId, data) {
    if (!Array.isArray(data.messages)) {
      throw new ProtocolError('INVALID_INPUT', 'Batch messages must be array');
    }

    if (data.messages.length > 10) {
      throw new ProtocolError('MESSAGE_TOO_LARGE', 'Batch limited to 10 messages');
    }

    for (const batchMsg of data.messages) {
      if (!batchMsg.type) continue;
      if (batchMsg.type === 'INPUT' && batchMsg.data) {
        this.handleInput(playerId, batchMsg.data);
      } else if (batchMsg.type === 'ACK' && batchMsg.data) {
        this.handleAck(playerId, batchMsg.data);
      }
    }

    return { send: false };
  }

  sendError(playerId, code, message, details = {}) {
    const error = this.protocol.buildError(code, message, details, playerId);
    return { send: true, payload: error, isError: true };
  }

  broadcastToAll(message) {
    for (const [_, client] of this.game.clients) {
      if (client && client.ws && client.ws.readyState === 1) {
        try {
          client.ws.send(JSON.stringify(message));
        } catch (e) {
          console.error(`[PROTOCOL] Failed to send to ${client.playerId}: ${e.message}`);
        }
      }
    }
  }

  sendHeartbeat(playerId) {
    const client = this.game.clients.get(playerId);
    if (client && client.ws && client.ws.readyState === 1) {
      const msg = this.protocol.buildMessage('HEARTBEAT', { frame: this.game.frame });
      try {
        client.ws.send(JSON.stringify(msg));
      } catch (e) {
        console.error(`[PROTOCOL] Heartbeat send failed: ${e.message}`);
      }
    }
  }

  checkHeartbeatTimeout(playerId) {
    const sessionId = this.clientSessions.get(playerId);
    if (sessionId && this.protocol.checkHeartbeatTimeout(sessionId)) {
      return true;
    }
    return false;
  }

  checkIdleTimeout(playerId) {
    const client = this.game.clients.get(playerId);
    if (client && Date.now() - client.lastActivity > 300000) {
      return true;
    }
    return false;
  }

  cleanup() {
    this.protocol.cleanup();
  }
}

module.exports = ProtocolIntegration;
