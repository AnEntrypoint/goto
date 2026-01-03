// Fix profiling scope issues
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// The issue: we declare "const frameProfiler = this.frameProfiler;" inside tick()
// But we're calling frameProfiler.startPhase() in nested scopes
// We need to use this.frameProfiler consistently OR ensure the const is accessible

// Replace all "frameProfiler." calls with "this.frameProfiler."
content = content.replace(/frameProfiler\.startPhase/g, 'this.frameProfiler.startPhase');
content = content.replace(/frameProfiler\.endPhase/g, 'this.frameProfiler.endPhase');
content = content.replace(/frameProfiler\.metrics/g, 'this.frameProfiler.metrics');
content = content.replace(/frameProfiler\.recordTick/g, 'this.frameProfiler.recordTick');

// Remove the "const frameProfiler = this.frameProfiler;" line
content = content.replace(/const frameProfiler = this\.frameProfiler;/g, '');

// Remove the duplicate variable declaration in the tick init
content = content.replace(
  /const tickStart = Date\.now\(\);\s*this\.frameProfiler\.startPhase\('total_tick'\);\s*const frameProfiler = this\.frameProfiler;/g,
  'const tickStart = Date.now();\n    this.frameProfiler.startPhase(\'total_tick\');'
);

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Fixed frameProfiler scope issues');
console.log('✓ Changed all frameProfiler references to this.frameProfiler');
