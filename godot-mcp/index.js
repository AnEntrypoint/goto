#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { createConnection } from 'net';
import { join, dirname, normalize } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, readdirSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const projectPath = join(projectRoot, 'game');

let godotPath = null;
let editorProcess = null;
let gameProcess = null;
let gameProcesses = [];
let gameRunning = false;
let socket = null;
let connected = false;
let debugLogs = [];

async function detectGodotPath() {
  if (godotPath) return godotPath;

  const candidates = [
    process.env.GODOT_PATH,
    'godot',
    '/usr/bin/godot',
    '/usr/local/bin/godot',
    'C:\\Program Files\\Godot\\godot.exe',
    normalize(join(projectRoot, 'godot.exe')),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --version`, { stdio: 'ignore' });
      godotPath = candidate;
      console.error(`[SERVER] Found Godot at: ${godotPath}`);
      return godotPath;
    } catch (e) {}
  }

  return null;
}

async function launchEditor(projectPath) {
  if (editorProcess) {
    return { content: [{ type: 'text', text: 'Editor already running' }], isError: true };
  }

  if (!godotPath) {
    await detectGodotPath();
    if (!godotPath) {
      return { content: [{ type: 'text', text: 'Could not find Godot executable' }], isError: true };
    }
  }

  if (!existsSync(join(projectPath, 'project.godot'))) {
    return { content: [{ type: 'text', text: `Not a valid Godot project: ${projectPath}` }], isError: true };
  }

  console.error(`[SERVER] Launching Godot editor for: ${projectPath}`);
  editorProcess = spawn(godotPath, ['-e', '--path', projectPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  editorProcess.on('exit', () => {
    editorProcess = null;
    gameRunning = false;
    connected = false;
    socket?.destroy();
  });

  return { content: [{ type: 'text', text: 'Godot editor launched' }] };
}

async function runProject(p_projectPath, clients = 1) {
  if (gameRunning && gameProcess && clients === 1) {
    return { content: [{ type: 'text', text: 'Game already running' }], isError: true };
  }

  if (gameProcesses.length > 0 && clients > 1) {
    return { content: [{ type: 'text', text: 'Multiple clients already running' }], isError: true };
  }

  if (!godotPath) {
    await detectGodotPath();
    if (!godotPath) {
      return { content: [{ type: 'text', text: 'Could not find Godot executable' }], isError: true };
    }
  }

  if (!existsSync(join(p_projectPath, 'project.godot'))) {
    return { content: [{ type: 'text', text: `Not a valid Godot project: ${p_projectPath}` }], isError: true };
  }

  debugLogs = [];
  gameRunning = true;

  if (clients === 1) {
    console.error(`[SERVER] Running Godot project: ${p_projectPath}`);
    gameProcess = spawn(godotPath, ['--path', p_projectPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    attachGameProcessListeners(gameProcess, 'Game1');
    gameProcess.on('exit', () => {
      gameRunning = false;
      connected = false;
      socket?.destroy();
      gameProcess = null;
    });
  } else {
    console.error(`[SERVER] Running ${clients} Godot clients: ${p_projectPath}`);
    for (let i = 0; i < clients; i++) {
      const proc = spawn(godotPath, ['--path', p_projectPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      attachGameProcessListeners(proc, `Client${i + 1}`);
      gameProcesses.push(proc);
      proc.on('exit', () => {
        gameProcesses = gameProcesses.filter(p => p !== proc);
        if (gameProcesses.length === 0) {
          gameRunning = false;
          connected = false;
          socket?.destroy();
        }
      });
    }
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  return { content: [{ type: 'text', text: `Game started (${clients} client${clients > 1 ? 's' : ''})` }] };
}

function attachGameProcessListeners(proc, label) {
  proc.stdout?.on('data', (data) => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      debugLogs.push(`[${label}] ${line}`);
      console.error(`[GAME/${label}] ${line}`);
    });
  });

  proc.stderr?.on('data', (data) => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      debugLogs.push(`[${label}] ${line}`);
      console.error(`[GAME/${label}] ${line}`);
    });
  });
}

async function evalCode(code) {
  if (!code) {
    return { content: [{ type: 'text', text: 'Code parameter is required' }], isError: true };
  }

  return new Promise((resolve) => {
    const request = JSON.stringify({ code }) + '\n';
    const sock = createConnection(9999, '127.0.0.1');
    let buffer = '';
    let done = false;

    const finish = (result) => {
      if (!done) {
        done = true;
        sock.destroy();
        resolve(result);
      }
    };

    sock.write(request);

    sock.on('data', (chunk) => {
      buffer += chunk.toString();
      const jsonStart = buffer.indexOf('{');
      if (jsonStart > 0) {
        buffer = buffer.substring(jsonStart);
      }
      const lines = buffer.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line) {
          try {
            const res = JSON.parse(line);
            if (res.success) {
              finish({ content: [{ type: 'text', text: `Result: ${res.result}` }] });
            } else {
              finish({ content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true });
            }
            return;
          } catch (e) {}
        }
      }
      buffer = lines[lines.length - 1];
    });

    sock.on('error', () => {
      finish({ content: [{ type: 'text', text: 'Cannot connect to REPL' }], isError: true });
    });

    setTimeout(() => {
      finish({ content: [{ type: 'text', text: 'REPL timeout' }], isError: true });
    }, 3000);
  });
}

async function stopEditor() {
  if (!editorProcess) {
    return { content: [{ type: 'text', text: 'No editor running' }] };
  }

  editorProcess.kill();
  editorProcess = null;
  if (gameProcess) {
    gameProcess.kill();
    gameProcess = null;
  }
  gameProcesses.forEach(proc => proc.kill());
  gameProcesses = [];
  gameRunning = false;
  connected = false;
  socket?.destroy();

  return { content: [{ type: 'text', text: 'Godot editor stopped' }] };
}

const server = new Server(
  { name: 'godot-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'launch_editor',
      description: 'Launch Godot editor for the project',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to Godot project directory',
            default: projectPath,
          },
        },
        required: [],
      },
    },
    {
      name: 'run_project',
      description: 'Run the Godot project (start the game in editor)',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to Godot project directory',
            default: projectPath,
          },
          clients: {
            type: 'number',
            description: 'Number of game clients to launch (1 for single, >1 for multiplayer testing)',
            default: 1,
          },
        },
        required: [],
      },
    },
    {
      name: 'stop_editor',
      description: 'Stop the Godot editor',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'eval_code',
      description: 'Evaluate GDScript code in the running game',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'GDScript code to evaluate',
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'debug_logs',
      description: 'Get debug output from the running game',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'launch_editor':
      return launchEditor(args?.projectPath || projectPath);
    case 'run_project':
      return runProject(args?.projectPath || projectPath, args?.clients || 1);
    case 'stop_editor':
      return stopEditor();
    case 'eval_code':
      return evalCode(args?.code);
    case 'debug_logs':
      return { content: [{ type: 'text', text: debugLogs.join('\n') || 'No logs' }] };
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[SERVER] Godot MCP ready');
