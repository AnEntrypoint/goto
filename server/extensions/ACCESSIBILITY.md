# BUG #1893: Accessibility Framework

## Overview
Framework for ensuring game is accessible to players with disabilities including visual, auditory, motor, and cognitive disabilities.

## User Stories
- Colorblind players see distinct visual indicators
- Deaf players have captions and visual alerts
- Motor-impaired players use alternative controls
- Accessibility options documented and easy to find
- WCAG 2.1 AA compliance met
- Players with cognitive disabilities have clear instructions

## Technical Requirements
- **Color contrast**: Minimum WCAG AA contrast ratios
- **Colorblind modes**: Deuteranopia, Protanopia, Tritanopia
- **Screen reader support**: Text alternatives for non-text content
- **Captions**: Subtitles for all dialogue and sound effects
- **Keybindings**: Remappable, including accessibility keys
- **Text sizing**: Adjustable UI text size
- **Audio description**: Descriptive narration for key events
- **Simplified mode**: Reduced visual complexity option

## Data Schema
```sql
CREATE TABLE accessibility_settings (
  player_id VARCHAR(256) PRIMARY KEY,
  colorblind_mode VARCHAR(32),
  contrast_mode VARCHAR(32),
  text_size INT DEFAULT 100,
  caption_enabled BOOLEAN DEFAULT false,
  audio_description BOOLEAN DEFAULT false,
  controller_vibration BOOLEAN DEFAULT true,
  font_family VARCHAR(32) DEFAULT 'system',
  high_contrast BOOLEAN DEFAULT false,
  motion_reduce BOOLEAN DEFAULT false,
  large_cursor BOOLEAN DEFAULT false,
  sticky_keys BOOLEAN DEFAULT false,
  FOREIGN KEY(player_id) REFERENCES players(id),
  CHECK(text_size BETWEEN 50 AND 200),
  CHECK(colorblind_mode IN ('normal', 'deuteranopia', 'protanopia', 'tritanopia', 'monochromacy'))
);

CREATE TABLE captions (
  id UUID PRIMARY KEY,
  entity_id VARCHAR(64) NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  text TEXT NOT NULL,
  timestamp_ms INT,
  speaker VARCHAR(256),
  language VARCHAR(5) DEFAULT 'en'
);
```

## Accessibility Categories

### Visual
- **Color blindness**: Deuteranopia, Protanopia, Tritanopia modes
- **Low vision**: Text scaling (50-200%), high contrast mode
- **Blindness**: Screen reader support, audio description
- **Photosensitivity**: Reduce flashing effects, motion reduction

### Auditory
- **Deafness**: Captions for all audio, visual sound indicators
- **Hard of hearing**: Adjustable audio levels, visual feedback

### Motor
- **Limited hand dexterity**: Button remapping, hold-to-activate, simplified controls
- **Mobility impairment**: Reduced mouse travel, slow-motion mode
- **Tremor**: Increased button size, input smoothing

### Cognitive
- **ADHD**: Pause functionality, reduced visual noise
- **Dyslexia**: Readable font (sans-serif), increased letter spacing
- **Autism**: Reduced animations, simplified tutorials

## API Surface
```javascript
class AccessibilityService {
  // Settings management
  getAccessibilitySettings(playerId) -> settings
  updateAccessibilitySetting(playerId, key, value) -> void
  getAccessibilityProfile(name) -> predefinedSettings

  // Visual accessibility
  getColorblindPalette(mode) -> colorMap
  getContrastLevel(mode) -> contrastRatio
  getTextSizeMultiplier(size) -> multiplier

  // Auditory accessibility
  enableCaptions(playerId) -> void
  disableCaptions(playerId) -> void
  getCaption(eventId) -> caption
  getVisualSoundIndicator(soundType) -> indicator

  // Motor accessibility
  remapControl(playerId, action, key) -> void
  getRemappedControls(playerId) -> controlMap
  enableStickyKeys(playerId) -> void

  // Cognitive accessibility
  enableSimplifiedUI(playerId) -> void
  getPauseState() -> boolean
  enableTutorialMode(playerId) -> void

  // Features
  enableAudioDescription(playerId) -> void
  getAudioDescriptions(contentId) -> [descriptions]
  getReadabilityScore(text) -> score
}
```

## Colorblind Modes
- **Deuteranopia**: Red-blind (most common, ~1% males)
- **Protanopia**: Green-blind (~0.5% males)
- **Tritanopia**: Blue-yellow blind (rare, ~0.001%)
- **Monochromacy**: Complete color blindness (very rare)

```javascript
const COLORBLIND_PALETTE = {
  deuteranopia: {
    primary: '#1f77b4',     // blue
    secondary: '#ff7f0e',   // orange
    success: '#2ca02c',     // green
    danger: '#d62728',      // red
    warning: '#9467bd'      // purple
  },
  protanopia: {
    primary: '#0173b2',     // blue
    secondary: '#de8f05',   // orange
    success: '#029e73',     // green
    danger: '#cc78bc',      // magenta
    warning: '#ca9161'      // brown
  }
}
```

## Caption Examples
```javascript
const CAPTIONS = {
  'jump_sound': {
    text: '[Whoosh sound]',
    timestamp: 1000,
    type: 'sound_effect'
  },
  'enemy_alert': {
    text: '[Alert! Enemy approaching]',
    timestamp: 2500,
    type: 'visual_event'
  },
  'dialogue_npc': {
    text: 'NPC: Welcome to Ice Peak!',
    timestamp: 5000,
    speaker: 'NPC',
    type: 'dialogue'
  }
}
```

## Text Sizing Levels
- 50%: Very small (for testing)
- 75%: Small
- 100%: Default
- 125%: Large
- 150%: Very large
- 200%: Maximum

## Keyboard Alternatives
- Tab navigation: Keyboard-only navigation
- Enter/Space: Activate buttons
- Arrow keys: Menu navigation
- Escape: Close dialogs
- Alt+number: Preset actions

## WCAG 2.1 AA Compliance Checklist
- Contrast ratio >= 4.5:1 for normal text
- Contrast ratio >= 3:1 for large text
- No content solely reliant on color
- No flashing more than 3 times per second
- All functionality keyboard accessible
- Forms have proper labels
- Links have descriptive text
- Images have alt text

## Integration Points
- **UIFramework**: Apply accessibility styles
- **InputSystem**: Handle remapped controls
- **AudioService**: Generate captions for sounds
- **ProfileService**: Store accessibility preferences
- **AnalyticsService**: Track accessibility feature usage

## Implementation Roadmap (Future)
1. Design accessibility settings system
2. Implement colorblind modes
3. Add caption system
4. Create control remapping
5. Implement text sizing
6. Add screen reader support
7. Create accessibility testing framework

## Dependencies
- Accessibility testing tools (axe DevTools, WAVE)
- Caption creation system
- Screen reader libraries
- WCAG validation tools

## Risk Assessment
- **Incomplete implementation**: Accessibility features not working correctly
- **Accessibility theater**: Features exist but don't actually help
- **Performance impact**: Accessibility features slow down performance
- **User education**: Players don't know accessibility features exist
- **Compliance gaps**: Missing WCAG requirements expose to legal liability

## Alternatives Considered
- **No accessibility**: Simpler, excludes millions of players
- **Accessibility lite**: Basic options only (misses many disabilities)
- **Third-party solutions**: License accessibility platform (vendor lock-in)
