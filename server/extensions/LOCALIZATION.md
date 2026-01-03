# BUG #1892: Localization Framework

## Overview
Framework for supporting multiple languages and regional variants with proper translation management, date/number formatting, and cultural awareness.

## User Stories
- Game available in 10+ languages
- Players set preferred language in settings
- All UI text properly translated
- Dates and numbers formatted per region
- RTL (Arabic, Hebrew) layouts supported
- Text expansion handled (German = 30% longer)
- Community translations crowdsourced

## Technical Requirements
- **Translation system**: Store strings in key-based system
- **Language detection**: Detect system language, allow override
- **Format support**: Handle date, time, currency, numbers
- **Text layout**: Support RTL, character wrapping
- **Community translations**: Accept crowdsourced translations
- **Version control**: Track translation changes
- **Fallback language**: Default to English if missing

## Data Schema
```sql
CREATE TABLE languages (
  code VARCHAR(5) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  native_name VARCHAR(256),
  direction VARCHAR(3) DEFAULT 'ltr',
  active BOOLEAN DEFAULT true,
  CHECK(direction IN ('ltr', 'rtl'))
);

CREATE TABLE translation_keys (
  id VARCHAR(256) PRIMARY KEY,
  context VARCHAR(64),
  description TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE translations (
  id UUID PRIMARY KEY,
  key_id VARCHAR(256) NOT NULL,
  language_code VARCHAR(5) NOT NULL,
  value TEXT NOT NULL,
  translator_id VARCHAR(256),
  approved BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL,
  UNIQUE(key_id, language_code),
  FOREIGN KEY(key_id) REFERENCES translation_keys(id),
  FOREIGN KEY(language_code) REFERENCES languages(code)
);

CREATE TABLE translation_votes (
  id UUID PRIMARY KEY,
  translation_id UUID NOT NULL,
  voter_id VARCHAR(256) NOT NULL,
  vote INT NOT NULL,
  UNIQUE(translation_id, voter_id),
  FOREIGN KEY(translation_id) REFERENCES translations(id),
  CHECK(vote IN (-1, 1))
);
```

## Supported Languages
- English (en)
- Spanish (es, es-MX)
- French (fr, fr-CA)
- German (de)
- Italian (it)
- Portuguese (pt-BR, pt-PT)
- Russian (ru)
- Japanese (ja)
- Korean (ko)
- Chinese (zh-CN, zh-TW)
- Arabic (ar)
- Turkish (tr)

## API Surface
```javascript
class LocalizationService {
  // Language management
  getAvailableLanguages() -> [{ code, name, active }]
  setPlayerLanguage(playerId, languageCode) -> void
  getPlayerLanguage(playerId) -> languageCode

  // Translation retrieval
  getString(key, languageCode = 'en') -> translatedString
  getStrings(keys, languageCode = 'en') -> [translatedStrings]
  formatNumber(value, languageCode) -> formatted
  formatDate(date, languageCode, format = 'short') -> formatted
  formatCurrency(amount, languageCode, currency = 'USD') -> formatted

  // Translation management
  getTranslationKey(key) -> { context, description, translations }
  updateTranslation(key, languageCode, value) -> void
  proposeTranslation(key, languageCode, value) -> void
  approveTranslation(translationId) -> void

  // Community translations
  getTranslationStats(languageCode) -> { complete, inProgress, contributors }
  getContributorStats(contributorId) -> { translations, approved, votes }
  getUntranslatedKeys(languageCode) -> [keys]

  // Content formatting
  getDateFormat(languageCode) -> formatString
  getNumberFormat(languageCode) -> { decimal, thousands }
  getTextDirection(languageCode) -> 'ltr' | 'rtl'
  adjustLayoutFor(languageCode) -> { margin, padding, width }
}
```

## Translation Key Examples
```javascript
const TRANSLATION_KEYS = {
  'menu.play': 'Play',
  'menu.settings': 'Settings',
  'stage.name.1': 'Ice Peak',
  'stage.description.1': 'Climb to the summit',
  'achievement.title.1': 'First Steps',
  'achievement.desc.1': 'Complete stage 1',
  'error.network': 'Network connection lost',
  'chat.player_joined': '{player} joined the game'
}
```

## Formatting Rules
```javascript
const FORMAT_RULES = {
  en: {
    date: 'MM/DD/YYYY',
    time: 'hh:mm AM/PM',
    currency: '$1,234.56',
    decimal: '.',
    thousands: ',',
    text_direction: 'ltr'
  },
  de: {
    date: 'DD.MM.YYYY',
    time: 'HH:mm',
    currency: '1.234,56 EUR',
    decimal: ',',
    thousands: '.',
    text_direction: 'ltr',
    text_expansion: 1.3  // German is 30% longer
  },
  ar: {
    date: 'DD/MM/YYYY',
    time: 'HH:mm',
    currency: 'ر.س 1,234.56',
    decimal: '٫',
    thousands: '٬',
    text_direction: 'rtl'
  }
}
```

## Community Translation Workflow
1. Translation key added to system
2. Volunteers propose translations
3. Community votes on best translation
4. Translation approved by moderator
5. Translation deployed in next release

## Text Expansion Handling
- English → German: +30% characters
- English → French: +20% characters
- English → Japanese: -20% characters (more compact)
- UI layouts must account for expansion

## RTL (Right-to-Left) Support
- Arabic, Hebrew, Farsi, Urdu
- Flip all layouts horizontally
- Reverse list ordering
- Adjust text alignment
- Handle bidirectional text correctly

## Integration Points
- **GameEngine**: Load strings on initialization
- **UIFramework**: Pass language code for rendering
- **CommunityService**: Community translation voting
- **CDN**: Cache translated strings per language
- **AnalyticsService**: Track language usage

## Implementation Roadmap (Future)
1. Design translation key system
2. Implement string retrieval
3. Build community translation interface
4. Add format rules (dates, numbers)
5. Implement RTL support
6. Create translation voting
7. Build community leaderboards

## Dependencies
- Translation management system (Crowdin, Lokalise)
- i18n library (i18next, react-i18next)
- ICU format library for date/number formatting

## Risk Assessment
- **Machine translation quality**: Google Translate worse than human
- **Context loss**: Translated text loses cultural meaning
- **Update lag**: New UI strings take weeks to translate
- **RTL bugs**: Subtle bidirectional text rendering issues
- **Overcrowding**: 30+ language variants not maintainable

## Alternatives Considered
- **English only**: Simpler, no translation work (limited to English speakers)
- **Machine translation**: Automatic via Google Translate (quality issues)
- **Partner publishers**: Outsource translations to regional partners (high cost)
