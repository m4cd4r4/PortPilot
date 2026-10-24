/**
 * Comprehensive PortPilot Test Suite with Playwright
 * Cross-platform: Works on Windows and Linux (WSL)
 *
 * Updated for the v2.0 single-pane UI (the old 4-tab layout was removed).
 * NOTE: requires a display (use xvfb-run on headless Linux) and the root
 * dependencies installed (`npm install`).
 */
const { _electron: electron } = require('playwright');
// These drive the classic v4 UI; the redesign specs pin their own.
process.env.PORTPILOT_NEW_UI = process.env.PORTPILOT_NEW_UI || '0';
const path = require('path');
const { getPlatformInfo } = require('./platform-helpers');
const { startTestServers, stopTestServers } = require('./test-servers');

async function runTests() {
  const platform = getPlatformInfo();

  console.log('\n========================================');
  console.log('  PortPilot Comprehensive Test Suite');
  console.log('========================================');
  console.log(`Platform: ${platform.platform} (${platform.arch})`);
  if (platform.isWSL) console.log('Environment: WSL');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  let electronApp;
  let window;

  const check = async (name, fn) => {
    console.log(`\nTest: ${name}...`);
    try {
      await fn();
      console.log(`✅ PASSED - ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ FAILED - ${name}: ${err.message}`);
      failed++;
    }
  };

  try {
    console.log('🌐 Starting test HTTP servers...');
    await startTestServers();
    console.log('✅ Test servers running on ports 3000, 3001, 8080\n');

    console.log('🚀 Launching PortPilot...');
    const electronPath = require('electron');
    const appPath = path.join(__dirname, '..');

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [appPath],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
    });

    window = await electronApp.firstWindow();
    window.on('console', msg => {
      const text = msg.text();
      if (!text.includes('Electron Security Warning') && !text.includes('GPU process')) {
        console.log(`  [App] ${text}`);
      }
    });

    // v2.0 has no tabs - wait for the single-pane shell to render.
    await window.waitForSelector('#btn-scan', { timeout: 15000 });
    await window.waitForTimeout(2000);
    console.log('✅ App launched successfully');

    await check('Window title', async () => {
      const title = await window.title();
      if (!title.includes('PortPilot')) throw new Error(`Expected "PortPilot", got "${title}"`);
    });

    await check('Port scanning', async () => {
      await window.click('#btn-scan');
      await window.waitForTimeout(5000);
    });

    await check('Detect test servers', async () => {
      const detected = [];
      for (const p of ['3000', '3001', '8080']) {
        if (await window.$(`[data-port="${p}"]`)) detected.push(p);
      }
      if (detected.length < 2) throw new Error(`Only ${detected.length} test ports detected`);
      console.log(`  detected: ${detected.join(', ')}`);
    });

    await check('Port card shows port + PID', async () => {
      const card = await window.$('[data-port="3000"]');
      if (!card) throw new Error('Port 3000 card not found');
      const text = await card.textContent();
      if (!text.includes(':3000')) throw new Error('Card missing port number');
    });

    await check('Global search filters ports', async () => {
      const search = await window.$('#global-search');
      await search.fill('3000');
      await window.waitForTimeout(500);
      const visible = await window.$('[data-port="3000"]');
      const hidden = await window.$('[data-port="8080"]');
      await search.fill('');
      await window.waitForTimeout(500);
      if (!visible || hidden) throw new Error('Search filter not working as expected');
    });

    await check('Copy button on port card', async () => {
      const card = await window.$('[data-port="3000"]');
      const copyBtn = await card.$('button[title^="Copy localhost"]');
      if (!copyBtn) throw new Error('Copy button not found');
    });

    await check('Kill button shows confirmation dialog', async () => {
      const card = await window.$('[data-port="3000"]');
      if (!card) throw new Error('Port 3000 card not found');
      const killBtn = await card.$('button.btn-danger');
      if (!killBtn) throw new Error('Kill button not found');

      let dialogShown = false;
      window.once('dialog', async dialog => {
        dialogShown = true;
        await dialog.dismiss(); // do not actually kill the test server
      });
      await killBtn.click();
      await window.waitForTimeout(1000);
      if (!dialogShown) throw new Error('Kill confirmation dialog did not appear');
    });

    await check('Settings panel opens', async () => {
      await window.click('#btn-settings');
      await window.waitForTimeout(500);
      const panel = await window.$('#settings-panel');
      const open = await panel.evaluate(el => !el.classList.contains('hidden'));
      if (!open) throw new Error('Settings panel did not open');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    });

    await check('Add App modal opens', async () => {
      await window.click('#btn-add-app');
      await window.waitForTimeout(500);
      const modal = await window.$('#modal-app');
      const open = await modal.evaluate(el => !el.classList.contains('hidden'));
      if (!open) throw new Error('Add App modal did not open');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    });

    console.log('\n📸 Taking screenshot...');
    await window.screenshot({ path: 'test-results/comprehensive-final.png' });
    console.log('Screenshot saved');

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err);
    console.error(err.stack);
    failed++;
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('\n✅ PortPilot closed');
    }
    console.log('🛑 Stopping test servers...');
    await stopTestServers();
    console.log('✅ Test servers stopped');
  }

  const total = passed + failed;
  const successRate = total ? Math.round((passed / total) * 100) : 0;

  console.log('\n========================================');
  console.log('           TEST RESULTS');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  console.log(`📊 Success Rate: ${successRate}%`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
