const { _electron: electron } = require('playwright');
const path = require('path');

async function takeScreenshots() {
  console.log('Launching PortPilot for screenshots...');

  // Launch Electron app with explicit executable path (same as working test script)
  const electronApp = await electron.launch({
    executablePath: path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: __dirname
  });

  const window = await electronApp.firstWindow();
  console.log('Window title:', await window.title());

  // Set a compact size for screenshots
  await window.setViewportSize({ width: 1000, height: 700 });

  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  // Screenshot 1: My Apps tab
  console.log('Taking My Apps screenshot...');
  await window.click('.tab[data-tab="apps"]');
  await window.waitForTimeout(1500);
  await window.screenshot({ path: 'docs/screenshots/my-apps.png', fullPage: false });
  console.log('Saved: docs/screenshots/my-apps.png');

  // Screenshot 2: Active Ports tab
  console.log('Taking Active Ports screenshot...');
  await window.click('.tab[data-tab="ports"]');
  await window.waitForTimeout(500);
  await window.click('#btn-scan');
  await window.waitForTimeout(2500);
  await window.screenshot({ path: 'docs/screenshots/active-ports.png', fullPage: false });
  console.log('Saved: docs/screenshots/active-ports.png');

  // Screenshot 3: Knowledge tab
  console.log('Taking Knowledge screenshot...');
  await window.click('.tab[data-tab="knowledge"]');
  await window.waitForTimeout(1000);
  await window.screenshot({ path: 'docs/screenshots/knowledge.png', fullPage: false });
  console.log('Saved: docs/screenshots/knowledge.png');

  // Screenshot 4: Settings tab
  console.log('Taking Settings screenshot...');
  await window.click('.tab[data-tab="settings"]');
  await window.waitForTimeout(500);
  await window.screenshot({ path: 'docs/screenshots/settings.png', fullPage: false });
  console.log('Saved: docs/screenshots/settings.png');

  await electronApp.close();
  console.log('Done! Screenshots saved to docs/screenshots/');
}

takeScreenshots().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
