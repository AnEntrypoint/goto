const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WATCH_FILES = ['index.js'];
const WATCH_DIR = __dirname;
let serverProcess = null;
let isRestarting = false;

function startServer() {
  if (isRestarting) return;

  console.log('[DEV] Starting server...');
  serverProcess = spawn('node', ['index.js'], {
    cwd: WATCH_DIR,
    stdio: 'inherit'
  });

  serverProcess.on('exit', (code) => {
    if (!isRestarting) {
      console.log(`[DEV] Server exited with code ${code}`);
    }
  });
}

function restartServer() {
  if (isRestarting) return;
  isRestarting = true;

  console.log('[DEV] File changed, restarting server...');

  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      isRestarting = false;
      startServer();
    }, 1000);
  }
}

WATCH_FILES.forEach(file => {
  const filePath = path.join(WATCH_DIR, file);
  fs.watchFile(filePath, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      restartServer();
    }
  });
});

startServer();

process.on('SIGINT', () => {
  console.log('[DEV] Shutting down...');
  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit(0);
});
