const { _electron: electron } = require('playwright');
const path = require('path');

async function testBrowserButton() {
  console.log('Launching PortPilot...');

  // Launch Electron app with explicit executable path
  const electronApp = await electron.launch({
    executablePath: path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: __dirname
  });

  // Get the first window
  const window = await electronApp.firstWindow();
  console.log('Window title:', await window.title());

  // Enable console logging immediately
  window.on('console', msg => {
    console.log(`[Console] ${msg.type()}: ${msg.text()}`);
  });

  // Wait for app to load
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  // Take screenshot of initial state
  await window.screenshot({ path: 'test-screenshot-1.png' });
  console.log('Screenshot 1 saved');

  // Click on "My Apps" tab
  console.log('Clicking My Apps tab...');
  await window.click('text=My Apps');
  await window.waitForTimeout(1000);
  await window.screenshot({ path: 'test-screenshot-2.png' });
  console.log('Screenshot 2 saved');

  // Check if there are any running apps with globe button
  const globeButtons = await window.$$('button:has-text("🌐")');
  console.log(`Found ${globeButtons.length} globe buttons`);

  if (globeButtons.length > 0) {
    // Click the first globe button
    console.log('Clicking first globe button...');
    await globeButtons[0].click();
    await window.waitForTimeout(2000);

    await window.screenshot({ path: 'test-screenshot-3.png' });
    console.log('Screenshot 3 saved (after click)');
  } else {
    console.log('No globe buttons found - checking apps list...');

    // Get the HTML of the apps list
    const appsHtml = await window.$eval('#apps-list', el => el.innerHTML).catch(() => 'Not found');
    console.log('Apps list HTML (first 1000 chars):', appsHtml.substring(0, 1000));
  }

  // Close
  await electronApp.close();
  console.log('Test complete!');
}

testBrowserButton().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
