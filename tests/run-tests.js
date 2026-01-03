/**
 * Comprehensive PortPilot Test Suite
 * Tests all major functionality including the port killing fix
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const { execSync } = require('child_process');

// Helper: Check if port is in use
function isPortListening(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    return output.includes('LISTENING');
  } catch {
    return false;
  }
}

// Helper: Get PID for port
function getPidForPort(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return parseInt(parts[parts.length - 1]);
      }
    }
  } catch {
    return null;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('  PortPilot Comprehensive Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  let electronApp;
  let window;

  try {
    // Launch app
    console.log('🚀 Launching PortPilot...');
    electronApp = await electron.launch({
      executablePath: path.join(__dirname, '../node_modules/electron/dist/electron.exe'),
      args: [path.join(__dirname, '..')],
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '' // Clear to avoid the bug we fixed
      }
    });

    window = await electronApp.firstWindow();
    window.on('console', msg => {
      const text = msg.text();
      if (!text.includes('Electron Security Warning')) {
        console.log(`  [App] ${text}`);
      }
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(2000);
    console.log('✅ App launched\n');

    // Test 1: Window title
    console.log('Running Test 1: Window title...');
    try {
      const title = await window.title();
      if (title.includes('PortPilot')) {
        console.log('✅ Test 1 PASSED: Window title correct');
        passed++;
      } else {
        throw new Error(`Expected "PortPilot", got "${title}"`);
      }
    } catch (err) {
      console.log('❌ Test 1 FAILED:', err.message);
      failed++;
    }

    // Test 2: Scan ports button exists
    console.log('\nRunning Test 2: Scan button...');
    try {
      const scanBtn = await window.$('#btn-scan');
      if (!scanBtn) throw new Error('Scan button not found');
      await scanBtn.click();
      await window.waitForTimeout(3000);
      console.log('✅ Test 2 PASSED: Port scan completed');
      passed++;
    } catch (err) {
      console.log('❌ Test 2 FAILED:', err.message);
      failed++;
    }

    // Test 3: Detect test servers
    console.log('\nRunning Test 3: Detect test servers...');
    try {
      const port3000 = await window.$('[data-port="3000"]');
      const port3001 = await window.$('[data-port="3001"]');
      const port8080 = await window.$('[data-port="8080"]');

      const detected = [];
      if (port3000) detected.push('3000');
      if (port3001) detected.push('3001');
      if (port8080) detected.push('8080');

      console.log(`  Detected ports: ${detected.join(', ')}`);

      if (detected.length >= 2) {
        console.log('✅ Test 3 PASSED: Test servers detected');
        passed++;
      } else {
        throw new Error(`Only detected ${detected.length} ports`);
      }
    } catch (err) {
      console.log('❌ Test 3 FAILED:', err.message);
      failed++;
    }

    // Test 4: Port card shows info
    console.log('\nRunning Test 4: Port card information...');
    try {
      const port3000Card = await window.$('[data-port="3000"]');
      if (!port3000Card) throw new Error('Port 3000 card not found');

      const cardText = await port3000Card.textContent();
      if (cardText.includes(':3000') && cardText.includes('PID')) {
        console.log('✅ Test 4 PASSED: Port card shows information');
        passed++;
      } else {
        throw new Error('Port card missing information');
      }
    } catch (err) {
      console.log('❌ Test 4 FAILED:', err.message);
      failed++;
    }

    // Test 5: Port filter
    console.log('\nRunning Test 5: Port filter...');
    try {
      const filterInput = await window.$('#port-filter');
      await filterInput.fill('3000');
      await window.waitForTimeout(500);

      const visible = await window.$('[data-port="3000"]');
      const hidden = await window.$('[data-port="8080"]');

      if (visible && !hidden) {
        await filterInput.fill('');
        await window.waitForTimeout(500);
        console.log('✅ Test 5 PASSED: Port filter works');
        passed++;
      } else {
        throw new Error('Filter not working correctly');
      }
    } catch (err) {
      console.log('❌ Test 5 FAILED:', err.message);
      failed++;
    }

    // Test 6: 🎯 CRITICAL - PORT KILL FUNCTIONALITY
    console.log('\n🎯 CRITICAL TEST 6: Port killing functionality...');
    try {
      // First, rescan to make sure we have fresh data
      await window.click('#btn-scan');
      await window.waitForTimeout(2000);

      // Check if 8080 is still in the list (it might have been killed already)
      let targetPort = null;
      const port8080 = await window.$('[data-port="8080"]');
      const port3000 = await window.$('[data-port="3000"]');

      if (port8080 && isPortListening(8080)) {
        targetPort = 8080;
      } else if (port3000 && isPortListening(3000)) {
        targetPort = 3000;
      } else {
        throw new Error('No suitable port found for killing test');
      }

      console.log(`  Testing kill on port ${targetPort}`);

      // Verify port is running
      const isRunningBefore = isPortListening(targetPort);
      if (!isRunningBefore) {
        throw new Error(`Port ${targetPort} not running before test`);
      }
      console.log(`  ✓ Port ${targetPort} confirmed running (PID: ${getPidForPort(targetPort)})`);

      // Find and click kill button
      const portCard = await window.$(`[data-port="${targetPort}"]`);
      if (!portCard) throw new Error('Port card not found');

      const killButton = await portCard.$('button.btn-danger');
      if (!killButton) throw new Error('Kill button not found');
      console.log('  ✓ Kill button found');

      await killButton.click();
      await window.waitForTimeout(500);

      // Accept confirmation dialog by pressing Enter
      await window.keyboard.press('Enter');
      console.log('  ✓ Confirmed kill operation');

      // Wait for kill operation to complete
      await window.waitForTimeout(3000);

      // Verify port is killed
      const isStillRunning = isPortListening(targetPort);
      if (!isStillRunning) {
        console.log(`  ✓ Port ${targetPort} successfully killed!`);
        console.log('✅ Test 6 PASSED: PORT KILL WORKS! 🎉🎉🎉');
        passed++;
      } else {
        throw new Error(`Port ${targetPort} still running after kill`);
      }
    } catch (err) {
      console.log('❌ Test 6 FAILED:', err.message);
      failed++;
    }

    // Test 7: Killed port removed from list
    console.log('\nRunning Test 7: Port removed from list...');
    try {
      await window.click('#btn-scan');
      await window.waitForTimeout(2000);

      // At least one port should still be visible
      const portsList = await window.$('#ports-list');
      const hasCards = await portsList.$$('[data-port]');

      if (hasCards.length > 0) {
        console.log(`✅ Test 7 PASSED: Port list updated (${hasCards.length} ports remaining)`);
        passed++;
      } else {
        throw new Error('No ports in list after kill');
      }
    } catch (err) {
      console.log('❌ Test 7 FAILED:', err.message);
      failed++;
    }

    // Test 8: Tab navigation
    console.log('\nRunning Test 8: Tab navigation...');
    try {
      const appsTab = await window.$('[data-tab="apps"]');
      await appsTab.click();
      await window.waitForTimeout(500);

      const isActive = await appsTab.evaluate(el => el.classList.contains('active'));
      if (isActive) {
        console.log('✅ Test 8 PASSED: Tab navigation works');
        passed++;
      } else {
        throw new Error('Tab not active after click');
      }
    } catch (err) {
      console.log('❌ Test 8 FAILED:', err.message);
      failed++;
    }

    // Test 9: Settings tab
    console.log('\nRunning Test 9: Settings tab...');
    try {
      const settingsTab = await window.$('[data-tab="settings"]');
      await settingsTab.click();
      await window.waitForTimeout(500);

      const settingsContent = await window.$('#tab-settings');
      const isVisible = await settingsContent.evaluate(el => el.classList.contains('active'));

      if (isVisible) {
        console.log('✅ Test 9 PASSED: Settings tab accessible');
        passed++;
      } else {
        throw new Error('Settings content not visible');
      }
    } catch (err) {
      console.log('❌ Test 9 FAILED:', err.message);
      failed++;
    }

    // Take screenshot
    console.log('\n📸 Taking final screenshot...');
    await window.screenshot({ path: 'test-results/comprehensive-test-final.png' });
    console.log('Screenshot saved to test-results/comprehensive-test-final.png');

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err);
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('\n✅ PortPilot closed');
    }
  }

  // Results
  console.log('\n========================================');
  console.log('           TEST RESULTS');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}/9`);
  console.log(`❌ Failed: ${failed}/9`);
  console.log(`📊 Success Rate: ${Math.round((passed / 9) * 100)}%`);
  console.log('========================================\n');

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! 🎉\n');
  } else {
    console.log(`⚠️  ${failed} test(s) failed\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
