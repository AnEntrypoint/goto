# BUG #1868: Mobile Support Framework

## Overview
Framework for supporting iOS and Android platforms with native mobile apps alongside web version.

## User Stories
- Players download game from App Store / Play Store
- Touch controls adapted for mobile form factor
- Game saves sync across web and mobile
- Push notifications alert players to events
- Mobile performance optimized for lower-end devices
- Portrait and landscape orientations supported

## Technical Requirements
- **React Native/Flutter app**: Shared codebase with web (WebGL rendering)
- **Touch input mapping**: Multi-touch gestures (swipe, tap, pinch)
- **Display scaling**: Responsive layouts for various screen sizes
- **Performance**: Target 60 FPS on mid-range Android devices
- **Offline sync**: Queue actions when offline, resync on reconnect
- **Platform APIs**: Camera, location, contacts (future features)
- **App store compliance**: Follow iOS/Android guidelines

## Platform-Specific Requirements

### iOS
- Minimum iOS 14
- Universal links for deep linking
- App store review guidelines (no crypto, no gambling)
- HomeKit compatibility (future smart home features)

### Android
- Minimum Android 10
- APK + AAB distribution
- Google Play compliance
- Huawei App Gallery for China market

## Data Schema
```sql
CREATE TABLE app_sessions (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  device_id VARCHAR(256) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  app_version VARCHAR(32) NOT NULL,
  os_version VARCHAR(32) NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  duration_ms INT,
  CHECK(platform IN ('ios', 'android', 'web'))
);

CREATE TABLE offline_actions (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  device_id VARCHAR(256) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  created_at BIGINT NOT NULL,
  synced_at BIGINT,
  sequence_num INT NOT NULL
);

CREATE TABLE push_tokens (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  device_id VARCHAR(256) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  token VARCHAR(512) NOT NULL,
  created_at BIGINT NOT NULL,
  last_used BIGINT,
  is_valid BOOLEAN DEFAULT true,
  UNIQUE(player_id, device_id, platform)
);
```

## Touch Controls
```javascript
// Simplified Ice Climber touch controls
const TOUCH_CONTROLS = {
  'move_left': { type: 'swipe', direction: 'left' },
  'move_right': { type: 'swipe', direction: 'right' },
  'jump': { type: 'tap', location: 'anywhere' },
  'pause': { type: 'tap', location: 'top-left' }
}
```

## API Surface
```javascript
class MobileService {
  // Device management
  registerDevice(playerId, deviceId, platform, osVersion) -> { deviceToken }
  getDeviceList(playerId) -> [{ deviceId, platform, lastActive }]
  removeDevice(playerId, deviceId) -> void

  // Offline support
  queueAction(playerId, deviceId, actionType, payload) -> { sequenceNum }
  syncOfflineActions(playerId, deviceId) -> { synced, failed }
  clearSyncQueue(playerId, deviceId) -> void

  // Push notifications
  registerPushToken(playerId, deviceId, platform, token) -> void
  sendPushNotification(playerId, title, message, data) -> { sent }
  getPushSettings(playerId) -> { enabled, types }

  // Platform-specific features
  getMobileVersion() -> { versionCode, versionName, minOsVersion }
  checkUpdate(currentVersion) -> { updateAvailable, newVersion, forceUpdate }

  // Analytics
  getMobileMetrics(timeRange) -> { installations, activeDevices, uninstallRate }
}
```

## App Distribution Channels
- **iOS**: App Store, TestFlight for beta
- **Android**: Google Play, Galaxy Store, Huawei App Gallery
- **Web**: Browser (existing)
- **Desktop**: Electron wrapper around web app (future)

## Performance Optimization
- **Asset compression**: WebP for images, reduce to 480p on mobile
- **Network optimization**: Cache assets locally, delta sync
- **Rendering**: Use Canvas instead of DOM on mobile
- **Memory management**: Limit to 256MB heap on low-end Android
- **Battery**: Reduce frame rate when low power detected

## Integration Points
- **AuthService**: Single sign-on across web and mobile
- **GameServer**: WebSocket transport works on mobile
- **SaveService**: Cloud save sync between devices
- **PushService**: Send platform-native notifications
- **AnalyticsService**: Track mobile usage separately

## Implementation Roadmap (Future)
1. Choose framework (React Native or Flutter)
2. Port game rendering to mobile
3. Implement touch controls
4. Build offline sync system
5. Create app store listings
6. Implement push notifications
7. Optimize performance for low-end devices

## Dependencies
- React Native or Flutter framework
- Firebase Cloud Messaging (FCM) for Android
- Apple Push Notification (APNs) for iOS
- App signing certificates

## Risk Assessment
- **App store rejection**: Non-compliance with store guidelines
- **Performance issues**: Poor user experience on low-end devices
- **Data sync conflicts**: Offline actions conflict with server state
- **Platform fragmentation**: iOS and Android behavior differs

## Alternatives Considered
- **Web-only**: No mobile support, lose 40% of gaming market
- **Native apps**: 3x development cost, difficult code sharing
- **Progressive web app**: Fewer OS capabilities, limited offline
