/**
 * Screenshot Capture Script for PortPilot
 * Captures all tabs and saves to screenshots/
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

async function takeScreenshots() {
  console.log('📸 Starting PortPilot screenshot capture...\n');

  // Create screenshots directory
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Launch PortPilot (same as test suite)
  const electronPath = require('electron');
  const appPath = path.join(__dirname);

  const app = await electron.launch({
    executablePath: electronPath,
    args: [appPath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined // Clear the problematic env var
    }
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  try {
    // 1. Ports Tab (default view)
    console.log('📸 Capturing: Ports tab...');
    await window.screenshot({
      path: path.join(screenshotsDir, '01-ports-tab.png'),
      fullPage: false
    });

    // 2. Ports Tab - with filter
    console.log('📸 Capturing: Ports tab with filter...');
    await window.fill('#port-filter', '3000');
    await window.waitForTimeout(500);
    await window.screenshot({
      path: path.join(screenshotsDir, '02-ports-tab-filtered.png'),
      fullPage: false
    });
    await window.fill('#port-filter', ''); // Clear filter

    // 3. My Apps Tab
    console.log('📸 Capturing: My Apps tab...');
    await window.click('[data-tab="apps"]');
    await window.waitForTimeout(1000);
    await window.screenshot({
      path: path.join(screenshotsDir, '03-apps-tab.png'),
      fullPage: false
    });

    // 4. Add App Modal
    console.log('📸 Capturing: Add App modal...');
    await window.click('#btn-add-app');
    await window.waitForTimeout(500);
    await window.screenshot({
      path: path.join(screenshotsDir, '04-add-app-modal.png'),
      fullPage: false
    });
    await window.press('body', 'Escape'); // Close modal
    await window.waitForTimeout(500);

    // 5. Knowledge Tab
    console.log('📸 Capturing: Knowledge tab...');
    await window.click('[data-tab="knowledge"]');
    await window.waitForTimeout(1000);
    await window.screenshot({
      path: path.join(screenshotsDir, '05-knowledge-tab.png'),
      fullPage: false
    });

    // 6. Settings Tab
    console.log('📸 Capturing: Settings tab...');
    await window.click('[data-tab="settings"]');
    await window.waitForTimeout(1000);
    await window.screenshot({
      path: path.join(screenshotsDir, '06-settings-tab.png'),
      fullPage: false
    });

    // 7. Brutalist Dark theme
    try {
      console.log('📸 Capturing: Brutalist Dark theme...');
      await window.click('button[data-theme="brutalist-dark"]');
      await window.waitForTimeout(500);
      await window.screenshot({
        path: path.join(screenshotsDir, '07-brutalist-dark-theme.png'),
        fullPage: false
      });

      // Switch back to TokyoNight
      await window.click('button[data-theme="tokyonight"]');
      await window.waitForTimeout(500);
    } catch (err) {
      console.log('  ⚠️ Skipped dark theme screenshot');
    }

    // 8. Full window overview (Ports tab)
    console.log('📸 Capturing: Full window overview...');
    await window.click('[data-tab="ports"]');
    await window.waitForTimeout(1000);
    await window.screenshot({
      path: path.join(screenshotsDir, '08-full-window.png'),
      fullPage: false
    });

    console.log('\n✅ Screenshots saved to:', screenshotsDir);
    console.log('\nScreenshots captured:');
    console.log('  • 01-ports-tab.png - Ports tab (default view)');
    console.log('  • 02-ports-tab-filtered.png - Ports with filter');
    console.log('  • 03-apps-tab.png - My Apps tab');
    console.log('  • 04-add-app-modal.png - Add App modal');
    console.log('  • 05-knowledge-tab.png - Knowledge tab');
    console.log('  • 06-settings-tab.png - Settings tab');
    console.log('  • 07-dark-theme.png - Dark theme (if captured)');
    console.log('  • 08-full-window.png - Full window overview');

  } catch (err) {
    console.error('❌ Error taking screenshots:', err.message);
  } finally {
    await app.close();
  }
}

takeScreenshots().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
