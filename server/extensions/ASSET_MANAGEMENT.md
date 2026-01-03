# BUG #1891: Asset Management Framework

## Overview
Framework for managing game assets (sprites, sounds, models) with versioning, caching, and CDN distribution for scale.

## User Stories
- Game assets stored centrally and versioned
- Assets cached locally to reduce bandwidth
- CDN distributes assets globally for fast loading
- Asset pipeline processes raw files to optimized formats
- Fallback system handles missing assets gracefully
- Asset memory usage tracked and optimized

## Technical Requirements
- **Version control**: Track asset changes over time
- **Format optimization**: Compress images, sounds for target platforms
- **Caching**: Client-side caching with cache busting
- **CDN distribution**: Serve from closest edge location
- **Memory management**: Track asset usage, unload unused
- **Fallback assets**: Default assets if custom missing
- **Batch loading**: Load asset groups for stages

## Data Schema
```sql
CREATE TABLE assets (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  type VARCHAR(32) NOT NULL,
  path VARCHAR(512) NOT NULL,
  file_size INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK(type IN ('sprite', 'sound', 'music', 'model', 'texture', 'font'))
);

CREATE TABLE asset_versions (
  id UUID PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_size INT NOT NULL,
  compression_ratio FLOAT,
  created_at BIGINT NOT NULL,
  UNIQUE(asset_id, version),
  FOREIGN KEY(asset_id) REFERENCES assets(id)
);

CREATE TABLE asset_bundles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  stage INT,
  assets JSON NOT NULL,
  bundle_size INT NOT NULL,
  compression_ratio FLOAT,
  created_at BIGINT NOT NULL
);

CREATE TABLE asset_cache_stats (
  id UUID PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  cache_hits INT DEFAULT 0,
  cache_misses INT DEFAULT 0,
  bandwidth_saved INT DEFAULT 0,
  last_updated BIGINT NOT NULL
);
```

## Asset Types and Formats
```javascript
const ASSET_FORMATS = {
  sprite: {
    format: 'webp|png',
    max_size: '4096x4096',
    compression: 'lossy (webp) or lossless (png)'
  },
  sound: {
    format: 'opus|mp3',
    max_size: '5MB',
    bitrate: '128kbps'
  },
  music: {
    format: 'opus|mp3',
    max_size: '20MB',
    bitrate: '96kbps'
  },
  model: {
    format: 'gltf|glb',
    max_size: '50MB',
    compression: 'draco'
  }
}
```

## API Surface
```javascript
class AssetManagementService {
  // Asset discovery
  getAsset(assetId) -> { metadata, url, cachedLocally }
  getAssetsByType(type) -> [assets]
  searchAssets(query) -> [assets]

  // Versioning
  getAssetHistory(assetId) -> [{ version, size, date }]
  rollbackAsset(assetId, version) -> void

  // Loading
  loadAsset(assetId) -> { data, format }
  loadAssetBundle(bundleId) -> { assets: [data] }
  preloadAssets(assetIds) -> Promise

  // Caching
  getCacheStatus() -> { totalSize, cachedAssets, hitRate }
  clearCache(assetId = null) -> void
  setCachePolicy(assetId, policy) -> void

  // CDN
  getCDNUrl(assetId, preferredFormat = null) -> url
  getAssetDimensions(assetId) -> { width, height }

  // Memory
  getAssetMemory(assetId) -> { memoryBytes }
  getTotalMemoryUsage() -> { usedBytes, maxBytes, percentage }
  unloadAsset(assetId) -> void

  // Optimization
  analyzeAsset(assetId) -> { compression, size, suggestions }
  optimizeAsset(assetId, format) -> void
  generateThumbnail(assetId, size) -> { url }

  // Bundles
  createAssetBundle(name, assetIds) -> { bundleId }
  getBundleSize(bundleId) -> { size, assets }
}
```

## Asset Bundle Strategy
```
Stage 1 bundle:
  - stage1_sprites (800KB)
  - stage1_music (3MB)
  - common_ui (200KB)
  Total: 4MB

Stage 2 bundle:
  - stage2_sprites (900KB)
  - stage2_music (3.2MB)
  - common_ui (200KB)
  Total: 4.3MB
```

## CDN Distribution
- **Origin**: Central asset server
- **Edge locations**: Global CDN with 50+ points of presence
- **Cache headers**: 30-day TTL for versioned assets
- **Compression**: Gzip for text, Brotli for static
- **Fallback**: Origin server if edge fails

## Memory Management
```javascript
const MEMORY_POLICY = {
  sprite: {
    max_resolution: '2048x2048',
    compression: 'webp',
    unload_if_unused: '5 minutes'
  },
  sound: {
    bitrate: '128kbps',
    format: 'opus',
    unload_if_unused: '10 minutes'
  },
  music: {
    bitrate: '96kbps',
    format: 'opus',
    preload: 'true',
    unload_on_stage_change: 'true'
  }
}
```

## Cache Busting
- **Version hash**: Include asset version in URL
- **Query parameters**: ?v=abc123def456
- **Filename hashing**: file.abc123.webp
- **Service worker**: Control cache at application level

## Asset Pipeline
```
Raw asset → Validate → Compress → Generate variants → Upload → CDN → Cache invalidation
```

## Integration Points
- **GameEngine**: Load assets on demand
- **CDN**: Distribute globally
- **CacheService**: Local storage for offline
- **AnalyticsService**: Track asset usage patterns
- **MonitoringService**: Alert on CDN failures

## Implementation Roadmap (Future)
1. Design asset database schema
2. Implement asset upload pipeline
3. Build compression/optimization
4. Create bundling system
5. Implement CDN integration
6. Add memory management
7. Build admin asset UI

## Dependencies
- CDN service (Cloudflare, Fastly, AWS CloudFront)
- Asset optimization tools (ImageMagick, ffmpeg)
- Storage service (S3 or similar)
- Version control for assets

## Risk Assessment
- **Bandwidth explosion**: Too many unoptimized assets
- **CDN cost**: High traffic drives up CDN bills
- **Cache staleness**: Outdated assets served from edge
- **Memory leaks**: Assets not unloaded, consume RAM
- **Dependency issues**: Missing assets break game

## Alternatives Considered
- **In-memory only**: No caching, loads from network every time (slow)
- **Local downloads**: Users download massive asset packs (onboarding friction)
- **Streaming assets**: Load as needed during play (stuttering)
