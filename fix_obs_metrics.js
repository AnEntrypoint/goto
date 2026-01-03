const fs = require('fs');

const path = '/c/dev/goto/server/observability.js';
let content = fs.readFileSync(path, 'utf-8');

// Fix endPhase to add _ms suffix to metric keys
content = content.replace(
  `  endPhase(phase) {
    if (this.currentFrame[phase]) {
      const duration = Date.now() - this.currentFrame[phase].start;
      this.metrics[phase].push(duration);
      if (this.metrics[phase].length > 60) {
        this.metrics[phase].shift();
      }
    }
  }`,
  `  endPhase(phase) {
    if (this.currentFrame[phase]) {
      const duration = Date.now() - this.currentFrame[phase].start;
      const metricKey = phase + '_ms';
      if (this.metrics[metricKey]) {
        this.metrics[metricKey].push(duration);
        if (this.metrics[metricKey].length > 60) {
          this.metrics[metricKey].shift();
        }
      }
    }
  }`
);

fs.writeFileSync(path, content, 'utf-8');
console.log('✓ Fixed metric key suffix issue');
