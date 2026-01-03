# BUG #1869: Native Client Architecture

## Overview
Framework for building native desktop clients (Windows/Mac/Linux) with electron-like technology, optimizing for performance and offline capability.

## User Stories
- Players download native desktop app for better performance
- Desktop client supports offline practice mode
- Game saves sync between web, mobile, and desktop
- Desktop version has optional controller support
- Push notifications integrated with OS notifications
- App auto-updates without browser involvement

## Technical Requirements
- **Electron/Tauri wrapper**: Package web game as native app
- **Offline capability**: Run game logic locally without server
- **Controller input**: Xbox/PlayStation controller support
- **Hardware acceleration**: GPU rendering for smooth 144+ FPS
- **Auto-update**: Automatic background updates
- **Desktop notifications**: System-level notification integration
- **File management**: Local replay/config file storage

## Architecture Tiers
- **Tier 1 - Web**: Browser-based, requires internet
- **Tier 2 - Desktop**: Electron/Tauri wrapper, hybrid online/offline
- **Tier 3 - Mobile**: React Native/Flutter, touch-optimized
- **Tier 4 - Console**: Nintendo Switch/PlayStation SDK (future)

## Data Schema
```sql
CREATE TABLE client_installations (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256),
  client_version VARCHAR(32) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  installed_at BIGINT NOT NULL,
  last_launched BIGINT,
  total_playtime_ms BIGINT DEFAULT 0,
  CHECK(platform IN ('windows', 'macos', 'linux'))
);

CREATE TABLE local_replays (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  game_id VARCHAR(64),
  stage INT NOT NULL,
  recording_path VARCHAR(512) NOT NULL,
  duration_ms INT NOT NULL,
  created_at BIGINT NOT NULL,
  file_size_bytes INT NOT NULL
);
```

## Desktop Controllers
```javascript
const CONTROLLER_MAPPING = {
  'dpad-left': 'move-left',
  'dpad-right': 'move-right',
  'button-a': 'jump',
  'button-b': 'dash',
  'button-start': 'pause',
  'stick-left': 'move-analog',
  'trigger-left': 'alt-action'
}
```

## API Surface
```javascript
class NativeClientService {
  // Client management
  registerInstallation(clientVersion, platform) -> { clientId }
  getClientVersion() -> { current, latest, updateAvailable, downloadUrl }
  checkForUpdates() -> { available, version, changelog }

  // Offline gameplay
  initOfflineMode() -> void
  saveOfflineGame(gameData) -> { replayId }
  syncOfflineGames() -> { synced, conflicts }
  playOfflineReplay(replayId) -> void

  // Controller support
  getControllerStatus() -> [{ id, name, isConnected }]
  remapController(controllerId, mapping) -> void
  getControllerMapping(controllerId) -> mapping

  // Local storage
  saveLocalConfig(configKey, value) -> void
  getLocalConfig(configKey) -> value
  clearLocalStorage() -> void

  // System integration
  requestNotificationPermission() -> boolean
  showNotification(title, message, icon) -> void
  registerHotkey(key, callback) -> void
}
```

## Update Distribution
- **Staged rollout**: Deploy to 10% of users first
- **Rollback mechanism**: Quick rollback if critical issue detected
- **Differential updates**: Only download changed files (delta encoding)
- **Background updates**: Update while playing, apply on next restart
- **Version tracking**: Store update history, allow rollback to previous versions

## Offline Practice Mode
- **Infinite lives**: Practice without death penalty
- **Difficulty modifiers**: Slow motion, remove gravity, etc.
- **Replay save**: Record local plays, export for sharing
- **No sync with server**: Offline scores don't affect rating
- **Custom physics**: Let players adjust gravity, speed

## Integration Points
- **AuthService**: Login with same credentials as web version
- **SaveService**: Sync local saves to cloud
- **UpdateService**: Manage client updates
- **ReplayService**: Store and share replays
- **AnalyticsService**: Track desktop usage separately

## Implementation Roadmap (Future)
1. Choose framework (Electron vs Tauri)
2. Package web game as desktop app
3. Implement offline mode
4. Add controller support
5. Build auto-update system
6. Create install/uninstall experience
7. Integrate system notifications

## Dependencies
- Electron or Tauri framework
- Native binary signing certificates
- Code signing infrastructure
- S3 or CDN for update distribution

## Risk Assessment
- **Security vulnerabilities**: Electron framework has known CVEs
- **Distribution complexity**: Different install paths for Windows/Mac/Linux
- **Piracy**: Offline mode enables save hacking
- **Antivirus false positives**: Unsigned binaries flagged as malware
- **Update failures**: Broken updates make game unplayable until manual fix

## Alternatives Considered
- **Web-only**: Simpler but worse performance, no offline
- **Completely native**: 3x development cost, hard to maintain
- **Managed platform like Steam**: Requires Steam ecosystem integration
