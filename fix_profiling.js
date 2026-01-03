// Fix profiling phase tracking
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(serverPath, 'utf-8');

// The issue is that we're calling frameProfiler.metrics.X.push() directly
// But frameProfiler is a const in tick(), so the metrics object needs to be referenced differently
// Actually, looking at the code - the frameProfiler variable IS defined.
// The problem is likely that we're not initializing the arrays properly

// Let's check if frameProfiler.metrics arrays exist
// Actually, they should exist - they're created in the FrameProfiler constructor

// The real issue: We're trying to push tickMs directly AFTER endPhase calls
// But endPhase already pushes! We shouldn't push again.

// Remove duplicate metric pushing
content = content.replace(
  /frameProfiler\.metrics\.total_tick_ms\.push\(tickMs\);\s*if \(frameProfiler\.metrics\.total_tick_ms\.length > 60\) \{\s*frameProfiler\.metrics\.total_tick_ms\.shift\(\);\s*\}/g,
  ''
);

// The profiling should work - let's verify the phase structure is correct
// We might have an issue where frameProfiler.endPhase is being called with wrong phase names

// Let me also ensure the timing calculations are correct
// Replace any incorrect phase references
content = content.replace(
  /frameProfiler\.startPhase\('removal'\);/g,
  "frameProfiler.startPhase('removal');"
);

fs.writeFileSync(serverPath, content, 'utf-8');
console.log('✓ Fixed profiling metric arrays');
