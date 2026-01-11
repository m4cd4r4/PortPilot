/**
 * Screenshot Generator for PortPilot
 * Takes screenshots for README, releases, and landing pages
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function takeScreenshots() {
  console.log('🎬 Starting screenshot generator...\n');

  // Ensure screenshots directory exists
  const screenshotsDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  let electronApp;

  try {
    // Launch PortPilot
    console.log('🚀 Launching PortPilot...');
    const electronPath = require('electron');
    const appPath = path.join(__dirname, '..');

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [appPath]
    });

    const window = await electronApp.firstWindow();
    
    // Wait for app to be ready
    await window.waitForSelector('[data-tab="ports"]', { timeout: 15000 });
    await window.waitForTimeout(2000);
    console.log('✅ PortPilot ready\n');

    // 1. Apps Tab Screenshot
    console.log('📸 Screenshot 1: Apps Tab...');
    const appsTab = await window.$('[data-tab="apps"]');
    await appsTab.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ 
      path: path.join(screenshotsDir, '01-apps-tab.png'),
      fullPage: false
    });
    console.log('   ✓ Saved: screenshots/01-apps-tab.png\n');

    // 2. Ports Tab Screenshot (with scan)
    console.log('📸 Screenshot 2: Ports Tab...');
    const portsTab = await window.$('[data-tab="ports"]');
    await portsTab.click();
    await window.waitForTimeout(500);
    
    // Trigger scan
    const scanBtn = await window.$('#btn-scan');
    await scanBtn.click();
    await window.waitForTimeout(6000);
    
    await window.screenshot({ 
      path: path.join(screenshotsDir, '02-ports-tab.png'),
      fullPage: false
    });
    console.log('   ✓ Saved: screenshots/02-ports-tab.png\n');

    // 3. Knowledge Tab Screenshot
    console.log('📸 Screenshot 3: Knowledge Tab...');
    const knowledgeTab = await window.$('[data-tab="knowledge"]');
    await knowledgeTab.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ 
      path: path.join(screenshotsDir, '03-knowledge-tab.png'),
      fullPage: false
    });
    console.log('   ✓ Saved: screenshots/03-knowledge-tab.png\n');

    // 4. Settings Tab Screenshot
    console.log('📸 Screenshot 4: Settings Tab...');
    const settingsTab = await window.$('[data-tab="settings"]');
    await settingsTab.click();
    await window.waitForTimeout(1000);
    await window.screenshot({ 
      path: path.join(screenshotsDir, '04-settings-tab.png'),
      fullPage: false
    });
    console.log('   ✓ Saved: screenshots/04-settings-tab.png\n');

    // 5. Port Card Closeup (for highlighting compact design)
    console.log('📸 Screenshot 5: Port Cards Closeup...');
    await portsTab.click();
    await window.waitForTimeout(500);
    const portsGrid = await window.$('#ports-list');
    await portsGrid.screenshot({
      path: path.join(screenshotsDir, '05-port-cards-closeup.png')
    });
    console.log('   ✓ Saved: screenshots/05-port-cards-closeup.png\n');

    console.log('✨ All screenshots captured successfully!\n');
    console.log('Screenshots saved to: ' + screenshotsDir);

  } catch (error) {
    console.error('❌ Error taking screenshots:', error);
    throw error;
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('\n✅ PortPilot closed');
    }
  }
}

takeScreenshots().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
