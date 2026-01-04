const { chromium } = require('playwright');
const path = require('path');

async function captureScreenshots() {
  console.log('🚀 Starting screenshot capture for User Guide...\n');

  const browser = await chromium.launch({ headless: false }); // Non-headless to see what's happening
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();

  // Navigate to localhost (PortPilot should be running)
  console.log('📍 Navigating to http://localhost:3000...');
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 10000 });
  } catch (e) {
    console.error('❌ Could not connect to localhost:3000');
    console.log('   Make sure PortPilot is running with: npm start');
    await browser.close();
    return;
  }

  // Wait for app to load
  await page.waitForTimeout(2000);

  const screenshotPath = 'docs/screenshots/guide';
  const fs = require('fs');
  if (!fs.existsSync(screenshotPath)) {
    fs.mkdirSync(screenshotPath, { recursive: true });
  }

  // Screenshot 1: My Apps Dashboard
  console.log('📸 Capturing: My Apps Dashboard...');
  await page.click('button:has-text("My Apps"), [data-tab="apps"]').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '01-my-apps.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 01-my-apps.png');

  // Screenshot 2: Active Ports Scanner
  console.log('📸 Capturing: Active Ports...');
  await page.click('button:has-text("Active Ports"), [data-tab="ports"]').catch(() => {});
  await page.waitForTimeout(500);

  // Click scan button
  await page.click('button:has-text("Scan Ports"), button:has-text("Scan")').catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: path.join(screenshotPath, '02-active-ports.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 02-active-ports.png');

  // Screenshot 3: Port filtering
  console.log('📸 Capturing: Port Filtering...');
  await page.fill('input[placeholder*="filter"], input[type="search"]', '3000').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(screenshotPath, '03-port-filter.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 03-port-filter.png');

  // Clear filter
  await page.fill('input[placeholder*="filter"], input[type="search"]', '').catch(() => {});

  // Screenshot 4: Add App Modal
  console.log('📸 Capturing: Add App Modal...');
  await page.click('button:has-text("My Apps"), [data-tab="apps"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('button:has-text("Add App"), button:has-text("New App")').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '04-add-app-modal.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 04-add-app-modal.png');

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Screenshot 5: Knowledge Base
  console.log('📸 Capturing: Knowledge Base...');
  await page.click('button:has-text("Knowledge"), [data-tab="knowledge"]').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '05-knowledge.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 05-knowledge.png');

  // Screenshot 6: Settings & Themes
  console.log('📸 Capturing: Settings...');
  await page.click('button:has-text("Settings"), [data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '06-settings.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 06-settings.png');

  // Screenshot 7: Brutalist theme
  console.log('📸 Capturing: Brutalist Theme...');
  await page.click('button:has-text("Brutalist Dark"), .theme-option:has-text("Brutalist")').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '07-theme-brutalist.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 07-theme-brutalist.png');

  // Screenshot 8: Nord theme
  console.log('📸 Capturing: Nord Theme...');
  await page.click('button:has-text("Nord"), .theme-option:has-text("Nord")').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '08-theme-nord.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 08-theme-nord.png');

  // Reset to default theme
  await page.click('button:has-text("TokyoNight"), .theme-option:has-text("Tokyo")').catch(() => {});

  // Screenshot 9: App running with badges
  console.log('📸 Capturing: Running App with Badges...');
  await page.click('button:has-text("My Apps"), [data-tab="apps"]').catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: path.join(screenshotPath, '09-app-badges.png'),
    fullPage: false
  });
  console.log('   ✅ Saved: 09-app-badges.png');

  console.log('\n✨ All screenshots captured successfully!');
  console.log(`📁 Location: ${path.resolve(screenshotPath)}\n`);

  await browser.close();
}

captureScreenshots().catch(console.error);
