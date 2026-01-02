#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);
const serverDir = join(projectRoot, 'server');

let serverProcess = null;
let debugLogs = [];
const API_BASE = 'http://localhost:3008';
const PORT = process.env.PORT || 3008;

async function startServer() {
  if (serverProcess) {
    return { content: [{ type: 'text', text: 'Server already running' }] };
  }

  console.error(`[MCP] Starting game server on port ${PORT}...`);
  serverProcess = spawn('node', [join(serverDir, 'index.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PORT }
  });

  serverProcess.stdout?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      debugLogs.push(`[SERVER] ${line}`);
      console.error(`[GAME] ${line}`);
    }
  });

  serverProcess.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      debugLogs.push(`[SERVER] ${line}`);
      console.error(`[GAME] ${line}`);
    }
  });

  serverProcess.on('exit', () => {
    serverProcess = null;
  });

  await new Promise(resolve => setTimeout(resolve, 1500));
  return { content: [{ type: 'text', text: `Game server started on port ${PORT}` }] };
}

async function stopServer() {
  if (!serverProcess) {
    return { content: [{ type: 'text', text: 'No server running' }] };
  }

  serverProcess.kill();
  serverProcess = null;
  return { content: [{ type: 'text', text: 'Game server stopped' }] };
}

async function queryAPI(endpoint, method = 'GET', body = null) {
  try {
    const opts = { method };
    if (body) opts.body = JSON.stringify(body);
    if (body) opts.headers = { 'Content-Type': 'application/json' };

    const res = await fetch(`${API_BASE}/api${endpoint}`, opts);
    const data = await res.json();

    if (!res.ok) {
      return { content: [{ type: 'text', text: `Error: ${data.error}` }], isError: true };
    }

    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Cannot reach server: ${e.message}` }], isError: true };
  }
}

async function getStatus() {
  return queryAPI('/status');
}

async function listActors() {
  return queryAPI('/actors');
}

async function getActor(name) {
  return queryAPI(`/actor/${name}`);
}

async function getStage(num) {
  return queryAPI(`/level/${num}`);
}

async function listStages() {
  return queryAPI('/levels');
}

async function loadStage(num) {
  return queryAPI(`/stage/${num}`, 'POST');
}

async function spawnEntity(type, x, y) {
  return queryAPI(`/spawn/${type}`, 'POST', { x, y });
}

async function editLevel(num) {
  const levelPath = join(projectRoot, 'game', `levels/stage${num}.json`);
  if (!existsSync(levelPath)) {
    return { content: [{ type: 'text', text: `Level ${num} not found` }], isError: true };
  }

  const data = readFileSync(levelPath, 'utf8');
  console.error(`[MCP] Open level ${num} in editor: ${levelPath}`);

  return {
    content: [{
      type: 'text',
      text: `Stage ${num} JSON:\n\n${data}`
    }]
  };
}

async function saveLevelEdit(num, jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    const levelPath = join(projectRoot, 'game', `levels/stage${num}.json`);
    writeFileSync(levelPath, JSON.stringify(parsed, null, 2), 'utf8');
    return { content: [{ type: 'text', text: `Stage ${num} saved successfully` }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Invalid JSON: ${e.message}` }], isError: true };
  }
}

const server = new Server(
  { name: 'goto-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'start_server',
      description: 'Start the game server (Node.js + WebSocket)',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'stop_server',
      description: 'Stop the running game server',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'status',
      description: 'Get current game status (frame, stage, players, actors)',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'list_actors',
      description: 'List all actors with positions and velocities',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'get_actor',
      description: 'Get detailed state of a specific actor',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Actor name (e.g., player_1, enemy_5)' }
        },
        required: ['name']
      }
    },
    {
      name: 'load_stage',
      description: 'Load a specific stage (1-4)',
      inputSchema: {
        type: 'object',
        properties: {
          stage: { type: 'number', description: 'Stage number (1-4)' }
        },
        required: ['stage']
      }
    },
    {
      name: 'list_stages',
      description: 'List all available stages with metadata',
      inputSchema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'get_stage',
      description: 'Get full JSON definition of a stage',
      inputSchema: {
        type: 'object',
        properties: {
          num: { type: 'number', description: 'Stage number (1-4)' }
        },
        required: ['num']
      }
    },
    {
      name: 'spawn_entity',
      description: 'Spawn an entity at position (for testing)',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Entity type (player, enemy, platform, breakable_platform)' },
          x: { type: 'number', description: 'X position', default: 640 },
          y: { type: 'number', description: 'Y position', default: 360 }
        },
        required: ['type']
      }
    },
    {
      name: 'edit_level',
      description: 'Get level JSON for editing',
      inputSchema: {
        type: 'object',
        properties: {
          num: { type: 'number', description: 'Stage number (1-4)' }
        },
        required: ['num']
      }
    },
    {
      name: 'save_level_edit',
      description: 'Save edited level JSON',
      inputSchema: {
        type: 'object',
        properties: {
          num: { type: 'number', description: 'Stage number (1-4)' },
          json: { type: 'string', description: 'Updated JSON content' }
        },
        required: ['num', 'json']
      }
    },
    {
      name: 'debug_logs',
      description: 'Get server debug output',
      inputSchema: { type: 'object', properties: {}, required: [] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'start_server':
      return startServer();
    case 'stop_server':
      return stopServer();
    case 'status':
      return getStatus();
    case 'list_actors':
      return listActors();
    case 'get_actor':
      return getActor(args?.name);
    case 'load_stage':
      return loadStage(args?.stage);
    case 'list_stages':
      return listStages();
    case 'get_stage':
      return getStage(args?.num);
    case 'spawn_entity':
      return spawnEntity(args?.type, args?.x || 640, args?.y || 360);
    case 'edit_level':
      return editLevel(args?.num);
    case 'save_level_edit':
      return saveLevelEdit(args?.num, args?.json);
    case 'debug_logs':
      return { content: [{ type: 'text', text: debugLogs.join('\n') || 'No logs' }] };
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[MCP] GOTO game server ready');
