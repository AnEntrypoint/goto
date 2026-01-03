const PROTOCOL_VERSION = 1.1;
const SESSION_STORAGE_KEY = 'ice_climber_session';
const MAX_BUFFERED_MESSAGES = 1000;
const RECONNECT_DELAY = 1000;
const RECONNECT_MAX_ATTEMPTS = 10;

class ProtocolClient {
  constructor(serverUrl, onMessage, onError) {
    this.serverUrl = serverUrl;
    this.onMessage = onMessage;
    this.onError = onError;
    this.ws = null;
    this.sessionId = null;
    this.seq = 0;
    this.messageBuffer = [];
    this.awaitingAck = new Map();
    this.lastReceivedSeq = -1;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.lastHeartbeatTime = Date.now();
    this.isConnected = false;
    this.vipToken = null;
  }

  connect(vipToken = null) {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.serverUrl.replace(/^http/, 'ws');
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[PROTOCOL] WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.sendHello(vipToken).then(resolve).catch(reject);
        };

        this.ws.onmessage = (event) => this.handleMessage(event.data);
        this.ws.onerror = (err) => {
          console.error('[PROTOCOL] WebSocket error:', err);
          this.handleError('connection_error');
          reject(new Error('WebSocket error'));
        };

        this.ws.onclose = () => {
          console.log('[PROTOCOL] WebSocket closed');
          this.isConnected = false;
          clearTimeout(this.heartbeatTimer);
          this.reconnect();
        };

        this.startHeartbeatMonitor();
      } catch (e) {
        reject(e);
      }
    });
  }

  reconnect() {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[PROTOCOL] Max reconnection attempts reached');
      this.handleError('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[PROTOCOL] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect(this.vipToken).catch(() => {
        this.reconnect();
      });
    }, delay);
  }

  async sendHello(vipToken = null) {
    this.vipToken = vipToken;
    const msg = {
      version: PROTOCOL_VERSION,
      type: 'HELLO',
      seq: this.seq++,
      ts: Date.now(),
      data: {
        clientVersion: PROTOCOL_VERSION,
        preferredVersions: [1.1, 1.0],
        clientId: this.getClientId(),
        supportedFeatures: ['compression', 'delta']
      }
    };

    if (vipToken) {
      msg.vipToken = vipToken;
    }

    return new Promise((resolve, reject) => {
      this.sendRaw(msg);

      const helloTimer = setTimeout(() => {
        reject(new Error('HELLO_ACK timeout'));
      }, 5000);

      const originalOnMessage = this.onMessage;
      const tempHandler = (msg) => {
        if (msg.type === 'HELLO_ACK') {
          clearTimeout(helloTimer);
          this.sessionId = msg.data.sessionId;
          localStorage.setItem(SESSION_STORAGE_KEY, this.sessionId);
          console.log('[PROTOCOL] Session established:', this.sessionId);
          resolve();
          return;
        }
        if (originalOnMessage) originalOnMessage(msg);
      };

      this.onMessage = tempHandler;
      setTimeout(() => {
        this.onMessage = originalOnMessage;
      }, 5100);
    });
  }

  sendInput(action, direction = 0) {
    if (!this.isConnected) {
      console.warn('[PROTOCOL] Not connected, buffering input');
      this.messageBuffer.push({ action, direction });
      if (this.messageBuffer.length > MAX_BUFFERED_MESSAGES) {
        this.messageBuffer.shift();
      }
      return;
    }

    const msg = {
      version: PROTOCOL_VERSION,
      type: 'INPUT',
      seq: this.seq++,
      ts: Date.now(),
      sessionId: this.sessionId,
      data: {
        action,
        direction,
        timestamp: Date.now()
      }
    };

    if (this.vipToken) {
      msg.vipToken = this.vipToken;
    }

    this.send(msg);
  }

  sendBatch(inputs) {
    if (!this.isConnected) return;

    const messages = inputs.map(({ action, direction }) => ({
      type: 'INPUT',
      data: { action, direction, timestamp: Date.now() }
    }));

    const msg = {
      version: PROTOCOL_VERSION,
      type: 'BATCH',
      seq: this.seq++,
      ts: Date.now(),
      sessionId: this.sessionId,
      data: { messages }
    };

    if (this.vipToken) {
      msg.vipToken = this.vipToken;
    }

    this.send(msg);
  }

  sendAck(seq, latency) {
    if (!this.isConnected) return;

    const msg = {
      version: PROTOCOL_VERSION,
      type: 'ACK',
      seq: this.seq++,
      ts: Date.now(),
      sessionId: this.sessionId,
      data: {
        seq,
        latency,
        timestamp: Date.now()
      }
    };

    if (this.vipToken) {
      msg.vipToken = this.vipToken;
    }

    this.send(msg);
  }

  sendHeartbeatResponse() {
    if (!this.isConnected) return;

    const msg = {
      version: PROTOCOL_VERSION,
      type: 'HEARTBEAT_RESPONSE',
      seq: this.seq++,
      ts: Date.now(),
      sessionId: this.sessionId,
      data: { timestamp: Date.now() }
    };

    if (this.vipToken) {
      msg.vipToken = this.vipToken;
    }

    this.send(msg);
  }

  async send(msg) {
    msg.checksum = this.computeChecksum(msg.data);
    this.sendRaw(msg);
  }

  sendRaw(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        console.error('[PROTOCOL] Send error:', e.message);
        this.isConnected = false;
      }
    }
  }

  computeChecksum(data) {
    const str = JSON.stringify(data);
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData);

      if (!msg || !msg.type) {
        console.warn('[PROTOCOL] Invalid message format');
        return;
      }

      if (msg.type === 'HEARTBEAT') {
        this.sendHeartbeatResponse();
        this.lastHeartbeatTime = Date.now();
        return;
      }

      if (msg.type === 'ERROR') {
        console.error('[PROTOCOL] Server error:', msg.data.code, msg.data.message);
        this.handleError(msg.data.code);
        return;
      }

      if (msg.type === 'SESSION_EXPIRED') {
        console.error('[PROTOCOL] Session expired, reconnecting...');
        localStorage.removeItem(SESSION_STORAGE_KEY);
        this.sessionId = null;
        this.ws.close();
        return;
      }

      if (msg.type === 'RATE_LIMIT_WARNING') {
        console.warn('[PROTOCOL] Rate limit approaching:', msg.data.messagesRemaining, 'remaining');
        return;
      }

      if (this.onMessage && msg.type !== 'HEARTBEAT') {
        this.onMessage(msg);

        if (msg.seq) {
          this.lastReceivedSeq = msg.seq;
          if (msg.type === 'UPDATE') {
            this.sendAck(msg.seq, Date.now() - msg.ts);
          }
        }
      }
    } catch (e) {
      console.error('[PROTOCOL] Message parse error:', e.message);
    }
  }

  handleError(code) {
    if (this.onError) {
      this.onError(code);
    }
  }

  startHeartbeatMonitor() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      if (Date.now() - this.lastHeartbeatTime > 35000) {
        console.error('[PROTOCOL] Heartbeat timeout');
        this.ws.close();
      }
    }, 35000);
  }

  getClientId() {
    let clientId = localStorage.getItem('ice_climber_client_id');
    if (!clientId) {
      clientId = `client_${Math.random().toString(36).substring(7)}`;
      localStorage.setItem('ice_climber_client_id', clientId);
    }
    return clientId;
  }

  disconnect() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    clearTimeout(this.heartbeatTimer);
    if (this.ws) {
      this.ws.close();
    }
  }

  getState() {
    return {
      isConnected: this.isConnected,
      sessionId: this.sessionId,
      seq: this.seq,
      lastReceivedSeq: this.lastReceivedSeq,
      bufferedMessages: this.messageBuffer.length,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = ProtocolClient;
