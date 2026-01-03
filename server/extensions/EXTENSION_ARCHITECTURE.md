# BUG #1870: Extension Architecture

## Overview
Framework for browser extensions (Chrome, Firefox, Safari) that enhance the web version with overlay features, streaming integration, and third-party tools.

## User Stories
- Players install browser extension for overlay UI
- Extension shows live stats, predictions, chat while playing
- Content creators integrate extension with streaming tools
- Developers build third-party tools on top of extension API
- Extension respects privacy, stores data locally only

## Technical Requirements
- **Manifest V3 compliance**: Modern extension architecture (Chrome MV3)
- **WebSocket communication**: Real-time data from game server
- **Content scripts**: Inject overlay into game page
- **Storage API**: Local extension storage for settings
- **Permissions**: Minimal required permissions
- **Cross-origin**: Handle CORS for external APIs
- **Update mechanism**: Automatic updates via Web Store

## Supported Platforms
- **Chrome/Chromium**: Primary (98% extension market)
- **Firefox**: WebExtensions API (near-complete parity)
- **Safari**: Coming in 2024 with Manifest V2 support
- **Edge**: Uses Chromium, full Chrome compatibility

## Data Schema
```sql
CREATE TABLE extension_installations (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  browser VARCHAR(32) NOT NULL,
  extension_version VARCHAR(32) NOT NULL,
  installed_at BIGINT NOT NULL,
  last_active BIGINT,
  is_enabled BOOLEAN DEFAULT true
);

CREATE TABLE extension_events (
  id UUID PRIMARY KEY,
  installation_id UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  data JSON NOT NULL,
  timestamp BIGINT NOT NULL,
  FOREIGN KEY(installation_id) REFERENCES extension_installations(id)
);
```

## Extension API
```javascript
class ExtensionAPI {
  // Authentication
  async login(email, password) -> { token, playerId }
  async logout() -> void

  // Game data
  async getGameState() -> { frame, actors, stage, paused }
  async subscribeGameState(callback) -> unsubscribe

  // Real-time updates
  async subscribePlayerStats(callback) -> unsubscribe
  async subscribeChatMessages(callback) -> unsubscribe

  // Overlay control
  async toggleOverlay() -> void
  async setOverlayPosition(x, y) -> void
  async setOverlaySize(width, height) -> void

  // Settings
  async saveSetting(key, value) -> void
  async loadSetting(key) -> value

  // Third-party API
  async publishEvent(eventName, data) -> void
  async onEvent(eventName, callback) -> unsubscribe
}
```

## Overlay Features
- **Live stats**: Frame count, FPS, latency, player position
- **Leaderboard widget**: Show top 10 scores with live updates
- **Chat overlay**: In-game chat without switching windows
- **Stream alerts**: Notification overlay for events (level up, achievement)
- **Control panel**: Pause, restart, difficulty selection
- **Performance monitor**: CPU/GPU/memory usage display

## Security Model
- **Sandboxed scripts**: Content scripts isolated from page
- **Permission prompts**: Only request necessary permissions
- **Data isolation**: Extension data separate from web storage
- **Token expiration**: Sessions expire after 24 hours
- **Content Security Policy**: Strict CSP prevents injection attacks

## Integration Points
- **GameServer**: WebSocket API for real-time data
- **AuthService**: Extension login with player account
- **CDN**: Serve extension from official CDN
- **Analytics**: Track extension usage and crashes

## Implementation Roadmap (Future)
1. Design extension architecture
2. Build extension base structure
3. Implement WebSocket client
4. Create overlay UI
5. Build settings page
6. Integrate with streaming platforms
7. Publish to Chrome Web Store and Firefox Add-ons

## Dependencies
- Chrome/Firefox WebExtensions API
- Build tools (webpack, Manifest V3 bundler)
- Icon/screenshot assets

## Risk Assessment
- **Malicious extensions**: Similar name/icon to official extension
- **Permission abuse**: Overly broad permissions enable tracking
- **Performance impact**: Extension slows down browser tab
- **Compatibility issues**: Different browser APIs require detection
- **Store removal**: Violation of store policies causes removal

## Alternatives Considered
- **Web component**: Embedded directly in page (no extension install needed)
- **Bookmarklet**: JavaScript executed from bookmark (limited capabilities)
- **Userscript**: Greasemonkey script (fragile, no auto-update)
