# BUG #1889: User-Generated Content Framework

## Overview
Framework for managing all user-generated content (levels, cosmetics, replays) with quality gates, moderation, and creator monetization.

## User Stories
- Content creators earn revenue from creations
- High-quality content is promoted and rewarded
- Content is moderated before publication
- Creators track engagement and earnings
- Content can be monetized with cosmetics and passes
- Creators have analytics on their content

## Technical Requirements
- **Publication workflow**: Submit → Review → Approve/Reject
- **Quality gates**: Minimum standards before publishing
- **Monetization**: Creator splits revenue from cosmetics
- **Analytics**: Track views, downloads, engagement
- **Creator tools**: Analytics dashboard, content management
- **Revenue sharing**: 30% creator, 70% platform split
- **Dispute resolution**: Process for content conflicts

## Data Schema
```sql
CREATE TABLE ugc_content (
  id VARCHAR(64) PRIMARY KEY,
  creator_id VARCHAR(256) NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  title VARCHAR(256) NOT NULL,
  description TEXT,
  thumbnail_id VARCHAR(64),
  published_at BIGINT,
  status VARCHAR(16) NOT NULL,
  review_notes TEXT,
  revenue INT DEFAULT 0,
  creator_earnings INT DEFAULT 0,
  CHECK(content_type IN ('level', 'cosmetic', 'replay')),
  CHECK(status IN ('draft', 'submitted', 'approved', 'rejected', 'removed'))
);

CREATE TABLE ugc_monetization (
  id UUID PRIMARY KEY,
  content_id VARCHAR(64) NOT NULL,
  monetization_type VARCHAR(32) NOT NULL,
  price INT NOT NULL,
  purchase_count INT DEFAULT 0,
  total_revenue INT DEFAULT 0,
  FOREIGN KEY(content_id) REFERENCES ugc_content(id),
  CHECK(monetization_type IN ('cosmetic', 'season_pass', 'cosmetic_pack'))
);

CREATE TABLE ugc_analytics (
  id UUID PRIMARY KEY,
  content_id VARCHAR(64) NOT NULL,
  day BIGINT NOT NULL,
  views INT DEFAULT 0,
  downloads INT DEFAULT 0,
  purchases INT DEFAULT 0,
  revenue INT DEFAULT 0,
  UNIQUE(content_id, day),
  FOREIGN KEY(content_id) REFERENCES ugc_content(id)
);

CREATE TABLE creator_programs (
  creator_id VARCHAR(256) PRIMARY KEY,
  tier VARCHAR(16) NOT NULL,
  revenue_share FLOAT NOT NULL,
  monthly_revenue INT DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  CHECK(tier IN ('basic', 'verified', 'partner'))
);
```

## Content Types
- **Level**: Custom stages created with level editor
- **Cosmetic**: Custom skin or effect (pixel art)
- **Replay**: Notable gameplay moment (montages)
- **Map pack**: Bundle of related levels
- **Cosmetic set**: Themed collection of cosmetics

## Creator Tiers
- **Basic**: All creators, 30% split, approval required
- **Verified**: 10k+ followers, 40% split, faster approval
- **Partner**: 100k+ followers, 50% split, no approval needed

## Quality Gates
```javascript
const QUALITY_CHECKS = {
  level: {
    max_entities: 200,
    playability_test: true,
    exploit_check: true,
    difficulty_rating: true
  },
  cosmetic: {
    min_resolution: '256x256',
    format_validation: 'png|webp',
    not_offensive: true,
    uniqueness_check: true
  },
  replay: {
    min_duration: 30,
    max_duration: 600,
    quality_check: '720p minimum'
  }
}
```

## API Surface
```javascript
class UGCService {
  // Content management
  createUGC(creatorId, contentType, metadata) -> { contentId }
  getUGC(contentId) -> { content, analytics, earnings }
  updateUGC(contentId, updates) -> void
  publishUGC(contentId) -> void
  removeUGC(contentId, reason) -> void

  // Moderation
  submitForReview(contentId) -> void
  reviewContent(contentId, decision, notes) -> void
  getContentQueue(status = 'submitted') -> [contents]

  // Monetization
  setMonetization(contentId, type, price) -> void
  getEarnings(creatorId, period = 'month') -> { totalEarnings, breakdown }
  payoutCreator(creatorId) -> { amount, success }

  // Analytics
  getContentAnalytics(contentId, days = 30) -> { views, downloads, revenue }
  getCreatorStats(creatorId) -> { totalEarnings, topContent, followers }
  getTrendingContent(contentType, days = 7) -> [contents]

  // Creator tools
  getCreatorDashboard(creatorId) -> { content, earnings, analytics }
  promoteContent(contentId, featuredDays) -> void
  reportContent(contentId, reason) -> void

  // Discovery
  browseContent(contentType, filter = {}) -> [contents]
  searchContent(query) -> [contents]
  getRecommendedContent(playerId) -> [contents]
}
```

## Revenue Sharing Example
```
Content sale: Cosmetic for 500 gems ($5)
Platform earns: $5 × 0.70 = $3.50
Creator earns: $5 × 0.30 = $1.50

Month: 1000 cosmetic sales = $1500 creator earnings
Platform takes: 30% cut = automatic processing
Creator receives: $1500 monthly
```

## Quality Review Process
1. Creator submits content
2. Automated checks (format, size, exploits)
3. Manual review by moderator (1-3 days)
4. Approval or rejection with feedback
5. Published to gallery or sent back for revision

## Creator Dashboard
- Total earnings (lifetime, monthly, daily)
- Content performance (views, engagement, sales)
- Trending content (what's getting popular)
- Pending reviews (what's waiting approval)
- Monetization settings (prices, cosmetics)

## Dispute Resolution
- **Plagiarism claims**: Report copied content, manual review
- **IP infringement**: DMCA takedowns honored
- **Quality disputes**: Creators can appeal rejections
- **Revenue disputes**: Audit trail of all transactions
- **Appeals process**: 14-day appeal window for rejections

## Integration Points
- **ModernationService**: Content review and approval
- **MonetizationService**: Handle purchases and revenue
- **AnalyticsService**: Track content performance
- **PayoutService**: Creator monthly payments
- **ContentGallery**: Browse and discover UGC
- **ReportingService**: Handle disputes and appeals

## Implementation Roadmap (Future)
1. Design content submission system
2. Build quality checking
3. Implement review workflow
4. Create creator dashboard
5. Build monetization
6. Implement analytics
7. Create payout system

## Dependencies
- Content storage (S3)
- Moderation tools
- Payment processing
- Analytics system
- Creator identity verification

## Risk Assessment
- **Copyright infringement**: Creators upload copyrighted content
- **Spam farming**: Bots flood gallery with garbage content
- **Revenue fraud**: Creators artificially inflate sales
- **Harassment**: Creators upload offensive content
- **Exploitation**: Predatory creators target vulnerable players

## Alternatives Considered
- **No UGC**: Platform creates all content (simpler)
- **Community voting only**: No formal review (chaotic)
- **Free UGC only**: No monetization (less incentive to create)
