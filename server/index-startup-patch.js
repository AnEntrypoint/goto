const { config, loadConfig } = require('./config');
const {
  initializeSubsystems,
  registerShutdownHooks,
  addHealthEndpoint,
  addReadyEndpoint
} = require('./startup');

async function applyStartupPatch(app, server, wss) {
  await initializeSubsystems();

  addHealthEndpoint(app);
  const { markReady } = addReadyEndpoint(app);

  registerShutdownHooks(server, wss);

  markReady();

  return { config };
}

module.exports = { applyStartupPatch, config, loadConfig };
