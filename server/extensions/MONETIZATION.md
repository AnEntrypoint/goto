# BUG #1867: Monetization Framework

## Overview
Framework for generating revenue through cosmetic purchases, battle passes, and optional premium features without pay-to-win mechanics.

## User Stories
- Players purchase cosmetics (skins, particle effects) with real money
- Players buy seasonal battle passes with progression and rewards
- Premium players get cosmetic perks but same gameplay
- Free players can earn premium currency through gameplay
- Purchase history visible in player profile

## Technical Requirements
- **Payment processing**: Integrate Stripe/PayPal for transactions
- **Currency system**: In-game premium currency (gems) and free currency (coins)
- **Inventory management**: Track player's cosmetics and battlepass status
- **Transaction logging**: Store all purchases for accounting
- **Fraud prevention**: Detect suspicious transactions
- **Chargebacks**: Handle payment reversals
- **Regional pricing**: Adjust prices for different regions

## Data Schema
```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  payment_method VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  transaction_id VARCHAR(256) UNIQUE,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  FOREIGN KEY(player_id) REFERENCES players(id),
  CHECK(status IN ('pending', 'completed', 'failed', 'refunded'))
);

CREATE TABLE player_inventory (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  item_type VARCHAR(32) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  acquired_at BIGINT NOT NULL,
  expires_at BIGINT,
  UNIQUE(player_id, item_id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE currency_balances (
  player_id VARCHAR(256) PRIMARY KEY,
  gems INT NOT NULL DEFAULT 0,
  coins INT NOT NULL DEFAULT 0,
  last_updated BIGINT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE battlepass_progress (
  player_id VARCHAR(256) PRIMARY KEY,
  season INT NOT NULL,
  tier INT NOT NULL DEFAULT 0,
  experience INT NOT NULL DEFAULT 0,
  is_premium BOOLEAN DEFAULT false,
  purchase_date BIGINT,
  UNIQUE(player_id, season)
);

CREATE TABLE products (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  category VARCHAR(32) NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  type VARCHAR(32) NOT NULL,
  rarity VARCHAR(16),
  created_at BIGINT NOT NULL,
  CHECK(category IN ('cosmetic', 'battlepass', 'currency_pack', 'battle_bundle'))
);
```

## Product Categories
- **Cosmetics**: Skins, emotes, weapon skins (one-time purchase)
- **Battle pass**: Seasonal progression with 100 tiers of rewards
- **Currency packs**: Buy 100/500/2000 gems bundles
- **Battle bundles**: Collection of cosmetics at discount

## Battle Pass Mechanics
- **100 tiers**: Each tier grants cosmetic rewards
- **Weekly missions**: 1 mission per week, grants tier progress
- **Free path**: 50 tiers available to all players
- **Premium path**: Additional 50 tiers for pass holders
- **Tier skips**: Skip tier with gem payment
- **Seasonal reset**: Battlepass resets every 90 days
- **Cosmetic exclusivity**: Battlepass cosmetics not available elsewhere

## API Surface
```javascript
class MonetizationService {
  // Purchasing
  createPurchaseIntent(playerId, productId, quantity = 1) -> { clientSecret, amount }
  completePurchase(playerId, transactionId) -> { success, itemsGranted }
  refundPurchase(playerId, transactionId) -> void

  // Inventory
  getInventory(playerId) -> [{ itemId, type, quantity, acquiredAt }]
  getCosmetics(playerId) -> [{ skinId, emoteId, weaponSkinId }]
  equipCosmetic(playerId, itemId) -> void

  // Currency
  getBalance(playerId) -> { gems, coins }
  addCurrency(playerId, gems = 0, coins = 0) -> void
  spendCurrency(playerId, gems = 0, coins = 0) -> boolean

  // Battle pass
  getBattlepassStatus(playerId, season) -> { tier, experience, isPremium }
  claimBattlepassReward(playerId, tier) -> void
  purchaseBattlepass(playerId) -> void

  // Revenue
  getPlayerLTV(playerId) -> { totalSpent, purchaseCount, lastPurchase }
  getRevenueMetrics(timeRange) -> { mrr, playerCount, arpu }
}
```

## Regional Pricing
```javascript
const REGIONAL_PRICES = {
  'US': { multiplier: 1.0, currency: 'USD' },
  'EU': { multiplier: 0.92, currency: 'EUR' },
  'JP': { multiplier: 1.15, currency: 'JPY' },
  'APAC': { multiplier: 1.1, currency: 'SGD' },
  'BR': { multiplier: 1.2, currency: 'BRL' }
}
```

## Fraud Prevention
- **Velocity checks**: Reject >5 purchases in 1 hour
- **Amount checks**: Flag purchases >$500
- **Country checks**: Reject if payment country != player location
- **Chargeback history**: Reject players with >2 chargebacks in 6 months
- **Suspicious patterns**: Flag buying multiple passes in same session

## Integration Points
- **PaymentProcessor**: Stripe/PayPal API for transactions
- **InventoryService**: Store cosmetics in player inventory
- **CurrencyService**: Track gem/coin balances
- **BattlepassService**: Handle tier progression
- **AnalyticsService**: Track revenue metrics

## Implementation Roadmap (Future)
1. Design product catalog
2. Integrate payment processor
3. Build purchase flow
4. Implement inventory system
5. Create cosmetics system
6. Build battlepass progression
7. Implement fraud detection

## Dependencies
- Payment processor (Stripe/PayPal)
- SQL database
- Inventory service
- Currency service

## Risk Assessment
- **Payment fraud**: Stolen cards, chargebacks cost merchants 2.5-3x transaction value
- **Account compromise**: Stolen accounts used to drain currency
- **Pay-to-win perception**: Cosmetics must never affect gameplay
- **Regional pricing abuse**: Players in expensive regions VPN to cheaper regions
- **Inventory exploits**: Duplication bugs grant free cosmetics

## Alternatives Considered
- **Ads-supported model**: Show ads instead of purchases (bad UX)
- **Subscription only**: Monthly fee guarantees revenue but limits players
- **Loot boxes**: Probability-based purchases, heavy regulation incoming
- **Premium battle pass only**: Free currency never available limits free players
