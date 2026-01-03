const crypto = require('crypto');

const VIP_SECRET = process.env.VIP_SECRET || 'dev-vip-secret-key';
const VIP_VALIDITY = 30 * 24 * 60 * 60 * 1000;

class VIPTokenManager {
  constructor() {
    this.tokens = new Map();
  }

  generate(clientId, expiryDays = 30) {
    const timestamp = Date.now();
    const expiryTime = timestamp + (expiryDays * 24 * 60 * 60 * 1000);
    const data = `${clientId}:${timestamp}:${expiryTime}`;
    const hmac = crypto.createHmac('sha256', VIP_SECRET).update(data).digest('hex');
    const token = `vip_${Buffer.from(data).toString('base64')}_${hmac.substring(0, 16)}`;

    this.tokens.set(token, {
      clientId,
      createdAt: timestamp,
      expiryTime,
      used: false
    });

    return token;
  }

  validate(token) {
    if (!token || typeof token !== 'string' || !token.startsWith('vip_')) {
      return { valid: false, reason: 'invalid_format' };
    }

    const parts = token.substring(4).split('_');
    if (parts.length !== 2) {
      return { valid: false, reason: 'malformed_token' };
    }

    const [dataB64, signature] = parts;

    try {
      const data = Buffer.from(dataB64, 'base64').toString();
      const [clientId, timestamp, expiryTime] = data.split(':');

      const expectedHmac = crypto.createHmac('sha256', VIP_SECRET).update(data).digest('hex');
      if (expectedHmac.substring(0, 16) !== signature) {
        return { valid: false, reason: 'invalid_signature' };
      }

      const expiryNum = parseInt(expiryTime);
      if (isNaN(expiryNum) || expiryNum < Date.now()) {
        return { valid: false, reason: 'expired' };
      }

      const storedToken = this.tokens.get(token);
      if (!storedToken) {
        return { valid: false, reason: 'not_found' };
      }

      return {
        valid: true,
        clientId,
        expiryTime: expiryNum,
        daysRemaining: Math.ceil((expiryNum - Date.now()) / (24 * 60 * 60 * 1000))
      };
    } catch (e) {
      return { valid: false, reason: 'parse_error' };
    }
  }

  revoke(token) {
    const stored = this.tokens.get(token);
    if (stored) {
      stored.revoked = true;
      this.tokens.set(token, stored);
      return true;
    }
    return false;
  }

  cleanup() {
    const now = Date.now();
    const toDelete = [];
    for (const [token, data] of this.tokens) {
      if (data.expiryTime < now || (data.revoked && now - data.expiryTime > 7 * 24 * 60 * 60 * 1000)) {
        toDelete.push(token);
      }
    }
    for (const token of toDelete) {
      this.tokens.delete(token);
    }
  }

  list() {
    const list = [];
    for (const [token, data] of this.tokens) {
      list.push({
        token,
        clientId: data.clientId,
        createdAt: data.createdAt,
        expiryTime: data.expiryTime,
        revoked: data.revoked || false
      });
    }
    return list;
  }
}

module.exports = VIPTokenManager;
