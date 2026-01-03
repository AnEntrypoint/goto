const { config } = require('./config');

let shutdownInProgress = false;
let pendingWrites = 0;
const SHUTDOWN_TIMEOUT = 30000;

async function initializeSubsystems() {
  console.log('[DEPLOYMENT] Initializing subsystems');

  if (config.isProduction) {
    process.env.NODE_ENV = 'production';
  }

  console.log(`[DEPLOYMENT] Environment: ${config.nodeEnv}`);
  console.log(`[DEPLOYMENT] Log level: ${config.logLevel}`);
  console.log(`[DEPLOYMENT] Port: ${config.port}`);

  if (config.isProduction) {
    console.log('[DEPLOYMENT] Production mode enabled');
  } else {
    console.log('[DEPLOYMENT] Development mode enabled');
  }

  return true;
}

async function gracefulShutdown(signal) {
  if (shutdownInProgress) {
    console.warn('[DEPLOYMENT] Shutdown already in progress');
    return;
  }

  shutdownInProgress = true;
  console.log(`[DEPLOYMENT] Received ${signal}, starting graceful shutdown`);

  const shutdownTimer = setTimeout(() => {
    console.error('[DEPLOYMENT] Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    await waitForPendingWrites();
    clearTimeout(shutdownTimer);
    console.log('[DEPLOYMENT] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[DEPLOYMENT] Error during shutdown:', err);
    clearTimeout(shutdownTimer);
    process.exit(1);
  }
}

async function waitForPendingWrites() {
  return new Promise((resolve) => {
    if (pendingWrites === 0) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (pendingWrites === 0) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > SHUTDOWN_TIMEOUT) {
        clearInterval(checkInterval);
        console.warn(`[DEPLOYMENT] Shutdown timeout with ${pendingWrites} pending writes`);
        resolve();
      }
    }, 100);
  });
}

function registerShutdownHooks(server, wss) {
  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
  });

  process.on('SIGHUP', () => {
    gracefulShutdown('SIGHUP');
  });

  server.on('error', (err) => {
    console.error('[DEPLOYMENT] Server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`[DEPLOYMENT] Port ${config.port} is already in use`);
      process.exit(1);
    }
  });
}

function trackPendingWrite() {
  pendingWrites++;
}

function completePendingWrite() {
  pendingWrites--;
  if (pendingWrites < 0) {
    pendingWrites = 0;
  }
}

function addReadyEndpoint(app) {
  let isReady = false;

  const markReady = () => {
    isReady = true;
  };

  app.get('/ready', (req, res) => {
    if (isReady) {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  });

  return { markReady };
}

function addHealthEndpoint(app) {
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  });
}

module.exports = {
  initializeSubsystems,
  gracefulShutdown,
  registerShutdownHooks,
  trackPendingWrite,
  completePendingWrite,
  addReadyEndpoint,
  addHealthEndpoint,
  config
};
