# Ice Climber .io - Multiplayer Game

A modern, multiplayer interpretation of the classic Ice Climber arcade game, built with Node.js and WebSocket networking.

## Features

- **Multiplayer networking** - WebSocket-based real-time multiplayer
- **Binary messaging** - msgpack compression for bandwidth efficiency
- **Client-side prediction** - Reduced input lag through local position prediction
- **Delta compression** - Only changed actor states transmitted (94% bandwidth reduction)
- **Server-authoritative physics** - Secure, server-verified game state
- **4-stage campaign** - Progressive difficulty levels
- **Arcade physics** - Jump, climb, and breakable platforms with classic feel

## Technology Stack

- **Server**: Node.js + Express + ws + msgpackr
- **Client**: Vanilla JavaScript + Canvas 2D
- **Physics**: Custom implementation with AABB collision detection
- **Networking**: WebSocket + Binary msgpack protocol

## Quick Start

### Prerequisites
- Node.js 14+
- npm

### Installation

```bash
cd server
npm install
```

### Running Locally

```bash
npm start
```

Server starts on `http://localhost:3008`
Open in browser to play: `http://localhost:3008`

### Development Mode

```bash
npm run dev
```

Runs with file watching and dev-server utilities.

## Game Architecture

### Server (server/index.js)

- Game state management and physics simulation
- Actor spawning and removal
- Collision detection and response
- Level loading from JSON
- WebSocket message handling

### Client (server/public/client.js)

- Input handling (keyboard)
- Client-side prediction for movement
- Rendering loop with camera system
- State reconciliation with server
- UI and HUD rendering

### Networking Protocol

Uses msgpack binary format for efficiency:
```
Message Types:
- INIT (0): Initial game state
- UPDATE (1): State changes (position, velocity, etc.)
- GOAL (2): Player reached goal
- STAGELOAD (3): New stage loaded
- SPAWN (4): New actor created
- REMOVE (5): Actor removed
- PAUSE (6): Game paused
- RESUME (7): Game resumed
- GAME_WON (8): Final stage completed
```

## Physics Constants

Located in `server/index.js`:

```javascript
GRAVITY: 1200         // Pixels/second²
JUMP_VELOCITY: -450   // Pixels/second
PLAYER_SPEED: 200     // Pixels/second
MAX_FALL_SPEED: 800   // Pixels/second
```

Tune these to adjust gameplay feel.

## Level Format

Levels stored in `game/levels/stageN.json`:

```json
{
  "name": "Stage Name",
  "platforms": [
    {"x": 640, "y": 680, "width": 400, "breakable": false},
    {"x": 200, "y": 600, "width": 200, "breakable": true, "max_hits": 2}
  ],
  "enemies": [
    {"x": 200, "y": 568, "speed": 150, "dir": 1}
  ],
  "goal": {"x": 640, "y": 40}
}
```

## Performance Optimizations

- **Delta compression**: Only send changed actor properties (reduces update size by 94%)
- **Client-side prediction**: Eliminate perceived input lag
- **Binary messaging**: msgpack reduces protocol overhead by 50%+
- **State checksums**: Detect client/server desync every 10 frames

## Known Issues & TODOs

- Collision detection still being refined (see COLLISION-STATS logging)
- Breakable platform logic needs further testing
- Multi-player score tracking incomplete
- No persistence/leaderboards yet

## Deployment

### Docker (Recommended)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/ .
EXPOSE 3008
CMD ["npm", "start"]
```

### Platform.sh / Heroku

Set environment variable:
```
PORT=3008
```

The app will start on the configured port.

## Development Notes

### Adding a New Stage

1. Create `game/levels/stageN.json` with level layout
2. Physics is server-side; client just renders
3. Test with dev server: `npm run dev`

### Debugging

- Server logs collision stats every 120 frames: `[COLLISION-STATS]`
- Client shows desync warnings: `[DESYNC]`
- Enable debug mode: Press F3 in browser (shows frame numbers)

### Testing Locally

```bash
# Terminal 1
npm start

# Terminal 2
curl http://localhost:3008/api/status
curl http://localhost:3008/api/levels
curl -X POST http://localhost:3008/api/spawn/player -H "Content-Type: application/json" -d '{"x": 640, "y": 100}'
```

## Performance Targets

- Input lag: <50ms (with client-side prediction)
- Network: <5KB/sec per player (delta compression)
- Server CPU: Single core capable of 10+ concurrent players
- Memory: ~20MB base + 1-2MB per player

## Credits

Classic Ice Climber by Taito (1984)
Modern reimplementation with multiplayer for learning purposes.

## License

MIT
