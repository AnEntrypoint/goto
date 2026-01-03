# BUG #1875: Cosmetics System Framework

## Overview
Framework for cosmetic items (skins, emotes, trails, particles) that don't affect gameplay but express player identity.

## User Stories
- Players purchase skins to customize character appearance
- Skins have rarity tiers (common to mythic)
- Players equip active skin from inventory
- Emotes appear above character when used
- Trail effects follow player movement
- Cosmetics are visible to other players

## Technical Requirements
- **Item catalog**: Define all cosmetics with metadata
- **Rarity system**: Tiers affect availability and cost
- **Equipped state**: Track which cosmetic is active per player
- **Visibility**: Send equipped cosmetics in game state
- **Preview system**: Show how cosmetic looks before purchase
- **Favoriting**: Players mark cosmetics as favorite for quick access
- **Collection tracking**: Statistics on owned cosmetics

## Data Schema
```sql
CREATE TABLE cosmetics (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  category VARCHAR(32) NOT NULL,
  rarity VARCHAR(16) NOT NULL,
  base_price INT NOT NULL,
  icon_id VARCHAR(64),
  model_id VARCHAR(64),
  particle_id VARCHAR(64),
  created_at BIGINT NOT NULL,
  CHECK(category IN ('skin', 'emote', 'trail', 'weapon_skin', 'effect')),
  CHECK(rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'))
);

CREATE TABLE player_cosmetics (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  cosmetic_id VARCHAR(64) NOT NULL,
  equipped BOOLEAN DEFAULT false,
  is_favorite BOOLEAN DEFAULT false,
  acquired_at BIGINT NOT NULL,
  UNIQUE(player_id, cosmetic_id),
  FOREIGN KEY(cosmetic_id) REFERENCES cosmetics(id)
);

CREATE TABLE cosmetic_rarities (
  rarity VARCHAR(16) PRIMARY KEY,
  drop_rate FLOAT NOT NULL,
  drop_color VARCHAR(16) NOT NULL,
  price_multiplier FLOAT NOT NULL
);
```

## Cosmetic Categories
- **Skins**: Character appearance (hat, outfit, color)
- **Emotes**: Animated expressions (laugh, wave, dance)
- **Trails**: Movement effects (flame, sparkle, smoke)
- **Weapon skins**: Alt appearance for weapons (future)
- **Effects**: Particle effects on actions (jump, land, die)

## Rarity Distribution
```
Common:     40% drop rate, cost 100 gems
Uncommon:   30% drop rate, cost 300 gems
Rare:       20% drop rate, cost 750 gems
Epic:       7% drop rate, cost 2000 gems
Legendary:  2.5% drop rate, cost 5000 gems
Mythic:     0.5% drop rate, cost 10000 gems
```

## API Surface
```javascript
class CosmeticsService {
  // Catalog
  getAllCosmetics(category = null) -> [cosmetics]
  getCosmetic(cosmeticId) -> { name, rarity, price, preview }

  // Inventory
  getPlayerCosmetics(playerId, category = null) -> [equipped, owned, locked]
  getEquippedCosmetics(playerId) -> { skin, emote, trail, effect }
  equipCosmetic(playerId, cosmeticId) -> void

  // Acquisition
  awardCosmetic(playerId, cosmeticId, source) -> void
  purchaseCosmetic(playerId, cosmeticId) -> { success, balance }

  // Favorites
  toggleFavorite(playerId, cosmeticId) -> void
  getFavorites(playerId) -> [cosmeticIds]

  // Preview
  getPreview(cosmeticId) -> { imageUrl, videoUrl }
  previewOnCharacter(cosmeticId) -> { previewUrl }

  // Statistics
  getOwnedCount(playerId) -> { total, byRarity }
  getUnlockedRate() -> { percent, available }
  getPopularCosmetics(limit = 20) -> [cosmetics]

  // Analytics
  getCosmericPurchaseRate(cosmeticId) -> { rate, trendingUp }
}
```

## Cosmetic Effects (Visual)
```javascript
const COSMETIC_EFFECTS = {
  'skin_pirate': {
    model: 'pirate_hat',
    color_override: { r: 139, g: 69, b: 19 },
    scale: 1.1
  },
  'trail_fire': {
    particle_emitter: 'fire_trail',
    lifetime_ms: 500,
    color: { r: 255, g: 165, b: 0 }
  },
  'emote_dance': {
    animation: 'dance_01',
    duration_ms: 3000,
    sound: 'dance_sfx'
  }
}
```

## Purchase Flow
1. Player browses cosmetics
2. Player previews cosmetic on character
3. Player purchases with gems
4. Cosmetic added to inventory
5. Player equips from inventory
6. Equipped cosmetic visible to all players in game

## Seasonal Cosmetics
- **Limited time**: Only available during season
- **Exclusive**: Not available through other means
- **Legacy**: Previously limited cosmetics available later
- **Prestige**: Shows player was active during that season

## Integration Points
- **MonetizationService**: Track purchases
- **GameServer**: Send equipped cosmetics to clients
- **InventoryService**: Store owned cosmetics
- **ReplayService**: Include cosmetics in replay playback
- **Social**: Show equipped cosmetics on profile

## Implementation Roadmap (Future)
1. Design cosmetic catalog system
2. Create cosmetic models and assets
3. Implement inventory system
4. Build cosmetic equipment logic
5. Create preview system
6. Add cosmetic effects rendering
7. Implement purchase flow

## Dependencies
- Asset management system
- Game rendering engine
- Inventory service
- Monetization service

## Risk Assessment
- **Pay-to-win perception**: Skins perceived as giving advantage
- **Over-saturation**: Too many cosmetics makes choices overwhelming
- **Unsold inventory**: Cosmetics no one wants don't generate revenue
- **Technical issues**: Cosmetics fail to render, breaking visual experience

## Alternatives Considered
- **Stat cosmetics**: Cosmetics grant small gameplay bonus (pay-to-win)
- **Craftable cosmetics**: Players combine items to create (complexity)
- **Randomized cosmetics**: Always get random, can't control appearance
