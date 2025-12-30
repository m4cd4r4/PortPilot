/**
 * Screenshot script for PortPilot using Playwright + Electron
 */
const { _electron: electron } = require('playwright');
const path = require('path');

async function takeScreenshot() {
  console.log('Launching PortPilot...');

  // Get the electron executable path from node_modules
  const electronPath = require('electron');

  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '.')],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined // Clear this to prevent issues
    }
  });

  // Wait for window to be ready
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Give it time to render fully
  await window.waitForTimeout(2000);

  // Take screenshot
  await window.screenshot({
    path: path.join(__dirname, 'docs', 'screenshot-main.png'),
    fullPage: false
  });
  console.log('Screenshot saved to docs/screenshot-main.png');

  // Switch to Knowledge tab and take another screenshot
  await window.click('[data-tab="knowledge"]');
  await window.waitForTimeout(500);
  await window.screenshot({
    path: path.join(__dirname, 'docs', 'screenshot-knowledge.png'),
    fullPage: false
  });
  console.log('Screenshot saved to docs/screenshot-knowledge.png');

  // Switch to Settings for theme showcase
  await window.click('[data-tab="settings"]');
  await window.waitForTimeout(500);
  await window.screenshot({
    path: path.join(__dirname, 'docs', 'screenshot-settings.png'),
    fullPage: false
  });
  console.log('Screenshot saved to docs/screenshot-settings.png');

  await electronApp.close();
  console.log('Done!');
}

takeScreenshot().catch(console.error);
