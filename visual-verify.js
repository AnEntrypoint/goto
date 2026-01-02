const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('http://localhost:3009');
  await page.waitForTimeout(3000);

  console.log('\nBrowser is open at http://localhost:3009');
  console.log('Visual inspection points:');
  console.log('  • Sky blue background visible');
  console.log('  • Platforms visible as gray/brown rectangles');
  console.log('  • Player visible as white/colored square');
  console.log('  • Score/Lives/Stage text in top-left');
  console.log('  • Frame counter visible');
  console.log('\nClose the browser window to exit.\n');

  // Keep page open
  await new Promise(() => {});
})();
