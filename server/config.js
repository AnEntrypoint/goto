const fs = require('fs');
const path = require('path');

function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const configFile = path.join(__dirname, '..', `config.${nodeEnv}.json`);

  let config = {};
  if (fs.existsSync(configFile)) {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  }

  const port = parseInt(process.env.PORT || config.port || 3008, 10);
  if (!Number.isInteger(port) || port < 1000 || port > 65535) {
    throw new Error(`Invalid PORT: ${port}. Must be integer between 1000-65535`);
  }

  const logLevel = process.env.LOG_LEVEL || config.logLevel || 'info';
  const validLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: ${validLevels.join(', ')}`);
  }

  const requiredSecrets = ['API_KEY', 'DATABASE_URL'];
  for (const secret of requiredSecrets) {
    if (!process.env[secret]) {
      console.warn(`Warning: ${secret} not set in environment`);
    }
  }

  return {
    port,
    nodeEnv,
    logLevel,
    debug: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    corsOrigin: process.env.CORS_ORIGIN || config.corsOrigin || '*',
    timeouts: config.timeouts || { api: 30000, internal: 5000 },
    rateLimit: config.rateLimit || { windowMs: 60000, maxRequests: 1000 }
  };
}

const config = loadConfig();
module.exports = { config, loadConfig };
