/**
 * Comprehensive PortPilot Test Suite
 * Tests all major functionality including the port killing fix
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const { execSync } = require('child_process');

describe('PortPilot Comprehensive Tests', () => {
  let electronApp;
  let window;

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

  beforeAll(async () => {
    console.log('🚀 Launching PortPilot...');

    electronApp = await electron.launch({
      executablePath: path.join(__dirname, '../node_modules/electron/dist/electron.exe'),
      args: [path.join(__dirname, '..')],
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '' // Clear this to avoid the bug we fixed
      }
    });

    window = await electronApp.firstWindow();

    // Enable console logging
    window.on('console', msg => {
      console.log(`[PortPilot] ${msg.type()}: ${msg.text()}`);
    });

    await window.waitForLoadState('domcontentloaded');
    console.log('✅ PortPilot launched');
  }, 30000);

  afterAll(async () => {
    await electronApp.close();
    console.log('✅ PortPilot closed');
  });

  test('1. Window loads with correct title', async () => {
    const title = await window.title();
    expect(title).toContain('PortPilot');
    console.log(`✅ Test 1: Window title = "${title}"`);
  });

  test('2. Ports tab is visible and active by default', async () => {
    const portsTab = await window.$('[data-tab="ports"]');
    expect(portsTab).toBeTruthy();

    const isActive = await portsTab.evaluate(el => el.classList.contains('active'));
    expect(isActive).toBe(true);
    console.log('✅ Test 2: Ports tab active');
  });

  test('3. Scan Ports button exists and is clickable', async () => {
    const scanButton = await window.$('#btn-scan');
    expect(scanButton).toBeTruthy();

    await scanButton.click();
    await window.waitForTimeout(2000); // Wait for scan
    console.log('✅ Test 3: Scan button clicked');
  });

  test('4. Port scanning detects test servers', async () => {
    // Click scan to ensure fresh data
    await window.click('#btn-scan');
    await window.waitForTimeout(2000);

    // Check if our test ports are detected
    const port3000 = await window.$('[data-port="3000"]');
    const port3001 = await window.$('[data-port="3001"]');
    const port8080 = await window.$('[data-port="8080"]');

    expect(port3000).toBeTruthy();
    expect(port3001).toBeTruthy();
    expect(port8080).toBeTruthy();

    console.log('✅ Test 4: All test servers detected (3000, 3001, 8080)');
  });

  test('5. Port cards show process information', async () => {
    const port3000Card = await window.$('[data-port="3000"]');
    const cardText = await port3000Card.textContent();

    expect(cardText).toContain(':3000');
    expect(cardText).toContain('Process:');
    expect(cardText).toContain('PID:');

    console.log('✅ Test 5: Port card shows process info');
  });

  test('6. Filter ports functionality', async () => {
    const filterInput = await window.$('#port-filter');

    // Type filter
    await filterInput.fill('3000');
    await window.waitForTimeout(500);

    // Check that only port 3000 is visible
    const port3000 = await window.$('[data-port="3000"]');
    const port3001 = await window.$('[data-port="3001"]');
    const port8080 = await window.$('[data-port="8080"]');

    expect(port3000).toBeTruthy();
    expect(port3001).toBeFalsy(); // Should be filtered out
    expect(port8080).toBeFalsy(); // Should be filtered out

    // Clear filter
    await filterInput.fill('');
    await window.waitForTimeout(500);

    console.log('✅ Test 6: Filter works correctly');
  });

  test('7. Copy port button exists', async () => {
    const port3000Card = await window.$('[data-port="3000"]');
    const copyButton = await port3000Card.$('button:has-text("📋")');

    expect(copyButton).toBeTruthy();
    console.log('✅ Test 7: Copy button found');
  });

  test('8. 🎯 CRITICAL: Kill port functionality (THE FIX WE MADE)', async () => {
    console.log('\n🎯 Testing port kill functionality...');

    // Verify port 8080 is running
    const isRunningBefore = isPortListening(8080);
    expect(isRunningBefore).toBe(true);
    console.log('  ✓ Port 8080 confirmed running');

    const pidBefore = getPidForPort(8080);
    console.log(`  ✓ Port 8080 PID: ${pidBefore}`);

    // Find the kill button for port 8080
    const port8080Card = await window.$('[data-port="8080"]');
    expect(port8080Card).toBeTruthy();

    const killButton = await port8080Card.$('button.btn-danger');
    expect(killButton).toBeTruthy();
    console.log('  ✓ Kill button found');

    // Click kill button
    await killButton.click();

    // Handle confirmation dialog
    await window.waitForTimeout(500);
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // Alternative: Use keyboard to accept dialog
    await window.keyboard.press('Enter');

    // Wait for kill operation
    await window.waitForTimeout(3000);

    // Verify port is killed
    const isRunningAfter = isPortListening(8080);
    expect(isRunningAfter).toBe(false);

    console.log('  ✓ Port 8080 successfully killed!');
    console.log('✅ Test 8: PORT KILL WORKS! 🎉');
  }, 15000);

  test('9. Port disappears from list after killing', async () => {
    // Rescan ports
    await window.click('#btn-scan');
    await window.waitForTimeout(2000);

    // Port 8080 should not be in the list
    const port8080 = await window.$('[data-port="8080"]');
    expect(port8080).toBeFalsy();

    // But 3000 and 3001 should still be there
    const port3000 = await window.$('[data-port="3000"]');
    const port3001 = await window.$('[data-port="3001"]');
    expect(port3000).toBeTruthy();
    expect(port3001).toBeTruthy();

    console.log('✅ Test 9: Killed port removed from list');
  });

  test('10. Navigate to My Apps tab', async () => {
    const appsTab = await window.$('[data-tab="apps"]');
    await appsTab.click();
    await window.waitForTimeout(1000);

    const isActive = await appsTab.evaluate(el => el.classList.contains('active'));
    expect(isActive).toBe(true);

    console.log('✅ Test 10: My Apps tab navigation works');
  });

  test('11. Settings tab exists and is accessible', async () => {
    const settingsTab = await window.$('[data-tab="settings"]');
    await settingsTab.click();
    await window.waitForTimeout(500);

    const settingsContent = await window.$('#tab-settings');
    const isVisible = await settingsContent.evaluate(el => el.classList.contains('active'));
    expect(isVisible).toBe(true);

    console.log('✅ Test 11: Settings tab accessible');
  });

  test('12. Take final screenshot', async () => {
    await window.screenshot({ path: 'test-results/comprehensive-test-final.png' });
    console.log('✅ Test 12: Screenshot saved');
  });
});

// Simple test runner
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
        ELECTRON_RUN_AS_NODE: ''
      }
    });

    window = await electronApp.firstWindow();
    window.on('console', msg => console.log(`[App] ${msg.text()}`));
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(2000);
    console.log('✅ App launched\n');

    // Test 1: Window title
    try {
      const title = await window.title();
      if (title.includes('PortPilot')) {
        console.log('✅ Test 1: Window title correct');
        passed++;
      } else {
        throw new Error(`Expected "PortPilot", got "${title}"`);
      }
    } catch (err) {
      console.log('❌ Test 1 FAILED:', err.message);
      failed++;
    }

    // Test 2: Scan ports
    try {
      await window.click('#btn-scan');
      await window.waitForTimeout(3000);
      console.log('✅ Test 2: Port scan completed');
      passed++;
    } catch (err) {
      console.log('❌ Test 2 FAILED:', err.message);
      failed++;
    }

    // Test 3: Detect test servers
    try {
      const port3000 = await window.$('[data-port="3000"]');
      const port3001 = await window.$('[data-port="3001"]');
      const port8080 = await window.$('[data-port="8080"]');

      if (port3000 && port3001 && port8080) {
        console.log('✅ Test 3: All test servers detected');
        passed++;
      } else {
        throw new Error('Not all ports detected');
      }
    } catch (err) {
      console.log('❌ Test 3 FAILED:', err.message);
      failed++;
    }

    // Test 4: Port filter
    try {
      await window.fill('#port-filter', '3000');
      await window.waitForTimeout(500);
      const visible = await window.$('[data-port="3000"]');
      const hidden = await window.$('[data-port="8080"]');

      if (visible && !hidden) {
        await window.fill('#port-filter', '');
        console.log('✅ Test 4: Port filter works');
        passed++;
      } else {
        throw new Error('Filter not working correctly');
      }
    } catch (err) {
      console.log('❌ Test 4 FAILED:', err.message);
      failed++;
    }

    // Test 5: 🎯 KILL PORT (THE CRITICAL TEST)
    try {
      console.log('\n🎯 CRITICAL TEST: Port killing functionality...');

      // Check port is running
      const isRunning = isPortListening(8080);
      if (!isRunning) {
        throw new Error('Port 8080 not running before test');
      }
      console.log('  ✓ Port 8080 confirmed running');

      // Find and click kill button
      const port8080Card = await window.$('[data-port="8080"]');
      const killButton = await port8080Card.$('button.btn-danger');
      await killButton.click();
      await window.waitForTimeout(500);

      // Accept confirmation dialog
      await window.keyboard.press('Enter');
      await window.waitForTimeout(3000);

      // Verify killed
      const isStillRunning = isPortListening(8080);
      if (!isStillRunning) {
        console.log('  ✓ Port 8080 successfully killed!');
        console.log('✅ Test 5: PORT KILL WORKS! 🎉🎉🎉');
        passed++;
      } else {
        throw new Error('Port still running after kill');
      }
    } catch (err) {
      console.log('❌ Test 5 FAILED:', err.message);
      failed++;
    }

    // Test 6: Tab navigation
    try {
      await window.click('[data-tab="apps"]');
      await window.waitForTimeout(500);
      const isActive = await window.$eval('[data-tab="apps"]', el => el.classList.contains('active'));

      if (isActive) {
        console.log('✅ Test 6: Tab navigation works');
        passed++;
      } else {
        throw new Error('Tab not active');
      }
    } catch (err) {
      console.log('❌ Test 6 FAILED:', err.message);
      failed++;
    }

    // Screenshot
    await window.screenshot({ path: 'test-results/comprehensive-test-final.png' });
    console.log('📸 Screenshot saved\n');

  } catch (err) {
    console.error('❌ FATAL ERROR:', err);
  } finally {
    if (electronApp) {
      await electronApp.close();
    }
  }

  // Results
  console.log('\n========================================');
  console.log('           TEST RESULTS');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Helper functions
function isPortListening(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
    return output.includes('LISTENING');
  } catch {
    return false;
  }
}

// Run if executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
