/**
 * PortPilot v1.7.0 UX Features Test Suite
 * Tests: search/filter, sort, group colours, Quick Add, keyboard shortcuts, header summary
 * (Tray menu is OS-level and not testable via Playwright)
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function runTests() {
  console.log('\n========================================');
  console.log('  PortPilot v1.7.0 UX Features Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  let electronApp;
  let window;
  const testUserDataDir = path.join(os.tmpdir(), `portpilot-v17-${Date.now()}`);

  function pass(label) { console.log(`✅ PASSED - ${label}`); passed++; }
  function fail(label, err) { console.log(`❌ FAILED - ${label}: ${err.message || err}`); failed++; }

  async function closeAnyModal() {
    for (const id of ['#modal-app', '#modal-group', '#modal-quick-add', '#modal-discoveries', '#modal-delete-confirm']) {
      const open = await window.$eval(id, el => !el.classList.contains('hidden')).catch(() => false);
      if (open) {
        await window.keyboard.press('Escape').catch(() => {});
        await window.waitForTimeout(300);
      }
    }
    // Final safety: force-hide by pressing Escape twice
    await window.keyboard.press('Escape').catch(() => {});
    await window.waitForTimeout(200);
  }

  // Add an app via modal - returns when modal is closed
  async function addApp(name, command, port) {
    await window.click('#btn-add-app');
    await window.waitForTimeout(400);
    await window.fill('#app-name', name);
    await window.fill('#app-command', command);
    if (port) await window.fill('#app-port', String(port));
    await window.click('button[type="submit"]');
    await window.waitForTimeout(600);
  }

  try {
    const electronPath = require('electron');
    const appPath = path.join(__dirname, '..');

    console.log('🚀 Launching PortPilot...');
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [appPath, `--user-data-dir=${testUserDataDir}`],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
    });

    window = await electronApp.firstWindow();
    await window.waitForSelector('[data-tab="apps"]', { timeout: 15000 });
    await window.waitForTimeout(2000);

    // Go to Apps tab
    await window.click('[data-tab="apps"]');
    await window.waitForTimeout(500);
    console.log('✅ App launched and on Apps tab\n');

    // ----------------------------------------------------------------
    // Setup: add 3 test apps to work with
    // ----------------------------------------------------------------
    await addApp('Alpha Frontend', 'npm run dev', 3000);
    await addApp('Beta API', 'python app.py', 5000);
    await addApp('Zeta Worker', 'node worker.js', 4000);
    await window.waitForTimeout(500);

    // ----------------------------------------------------------------
    // Test 1: Search input is visible in apps toolbar
    // ----------------------------------------------------------------
    console.log('Test 1: Search input visible...');
    try {
      const searchInput = await window.$('#app-search');
      if (!searchInput) throw new Error('Search input #app-search not found');
      const visible = await searchInput.isVisible();
      if (!visible) throw new Error('Search input not visible');
      pass('Search input is visible in toolbar');
    } catch (err) { fail('Search input visible', err); }

    // ----------------------------------------------------------------
    // Test 2: Search filters apps by name
    // ----------------------------------------------------------------
    console.log('Test 2: Search filters by name...');
    try {
      await window.fill('#app-search', 'Alpha');
      await window.waitForTimeout(300);
      const list = await window.$('#apps-list');
      const text = await list.textContent();
      if (!text.includes('Alpha Frontend')) throw new Error('Alpha Frontend not visible after search');
      if (text.includes('Beta API')) throw new Error('Beta API should be hidden by search filter');
      if (text.includes('Zeta Worker')) throw new Error('Zeta Worker should be hidden by search filter');
      pass('Search filters by name correctly');
    } catch (err) { fail('Search filters by name', err); }

    // ----------------------------------------------------------------
    // Test 3: Clear search restores all apps
    // ----------------------------------------------------------------
    console.log('Test 3: Clear search restores all apps...');
    try {
      await window.fill('#app-search', '');
      await window.waitForTimeout(300);
      const list = await window.$('#apps-list');
      const text = await list.textContent();
      if (!text.includes('Alpha Frontend')) throw new Error('Alpha Frontend missing after clear');
      if (!text.includes('Beta API')) throw new Error('Beta API missing after clear');
      if (!text.includes('Zeta Worker')) throw new Error('Zeta Worker missing after clear');
      pass('Clear search restores all apps');
    } catch (err) { fail('Clear search restores apps', err); }

    // ----------------------------------------------------------------
    // Test 4: Search by command text
    // ----------------------------------------------------------------
    console.log('Test 4: Search filters by command...');
    try {
      await window.fill('#app-search', 'python');
      await window.waitForTimeout(300);
      const list = await window.$('#apps-list');
      const text = await list.textContent();
      if (!text.includes('Beta API')) throw new Error('Beta API (python command) not shown');
      if (text.includes('Alpha Frontend')) throw new Error('Alpha Frontend should be hidden');
      // Clear
      await window.fill('#app-search', '');
      await window.waitForTimeout(300);
      pass('Search filters by command text');
    } catch (err) {
      await window.fill('#app-search', '').catch(() => {});
      fail('Search filters by command', err);
    }

    // ----------------------------------------------------------------
    // Test 5: No-results state when search has no matches
    // ----------------------------------------------------------------
    console.log('Test 5: No-results state for unmatched search...');
    try {
      await window.fill('#app-search', 'ZZZNOMATCH999');
      await window.waitForTimeout(300);
      const list = await window.$('#apps-list');
      const text = await list.textContent();
      if (!text.toLowerCase().includes('no apps match')) throw new Error(`Expected "no apps match" message, got: "${text.slice(0, 100)}"`);
      await window.fill('#app-search', '');
      await window.waitForTimeout(300);
      pass('No-results state shown for unmatched search');
    } catch (err) {
      await window.fill('#app-search', '').catch(() => {});
      fail('No-results state', err);
    }

    // ----------------------------------------------------------------
    // Test 6: Sort dropdown is present
    // ----------------------------------------------------------------
    console.log('Test 6: Sort dropdown visible...');
    try {
      const sortSelect = await window.$('#app-sort');
      if (!sortSelect) throw new Error('#app-sort not found');
      const visible = await sortSelect.isVisible();
      if (!visible) throw new Error('Sort dropdown not visible');
      // Check options
      const options = await sortSelect.$$('option');
      if (options.length < 4) throw new Error(`Expected at least 4 sort options, got ${options.length}`);
      pass('Sort dropdown visible with multiple options');
    } catch (err) { fail('Sort dropdown visible', err); }

    // ----------------------------------------------------------------
    // Test 7: Sort by Name A-Z puts Alpha before Zeta
    // ----------------------------------------------------------------
    console.log('Test 7: Sort Name A-Z ordering...');
    try {
      await window.selectOption('#app-sort', 'name-asc');
      await window.waitForTimeout(300);
      const cards = await window.$$('.app-card');
      if (cards.length < 3) throw new Error(`Expected 3 cards, got ${cards.length}`);
      // First card should be "Alpha Frontend" alphabetically
      const firstText = await cards[0].textContent();
      if (!firstText.includes('Alpha')) throw new Error(`Expected Alpha first, got: "${firstText.slice(0, 50)}"`);
      // Last card should be "Zeta Worker"
      const lastText = await cards[cards.length - 1].textContent();
      if (!lastText.includes('Zeta')) throw new Error(`Expected Zeta last, got: "${lastText.slice(0, 50)}"`);
      pass('Sort Name A-Z: Alpha first, Zeta last');
    } catch (err) { fail('Sort Name A-Z', err); }

    // ----------------------------------------------------------------
    // Test 8: Sort by Name Z-A reverses order
    // ----------------------------------------------------------------
    console.log('Test 8: Sort Name Z-A ordering...');
    try {
      await window.selectOption('#app-sort', 'name-desc');
      await window.waitForTimeout(300);
      const cards = await window.$$('.app-card');
      const firstText = await cards[0].textContent();
      if (!firstText.includes('Zeta')) throw new Error(`Expected Zeta first, got: "${firstText.slice(0, 50)}"`);
      const lastText = await cards[cards.length - 1].textContent();
      if (!lastText.includes('Alpha')) throw new Error(`Expected Alpha last, got: "${lastText.slice(0, 50)}"`);
      // Reset sort
      await window.selectOption('#app-sort', 'default');
      await window.waitForTimeout(200);
      pass('Sort Name Z-A: Zeta first, Alpha last');
    } catch (err) {
      await window.selectOption('#app-sort', 'default').catch(() => {});
      fail('Sort Name Z-A', err);
    }

    // ----------------------------------------------------------------
    // Test 9: Quick Add button opens modal
    // ----------------------------------------------------------------
    console.log('Test 9: Quick Add button opens modal...');
    try {
      await window.click('#btn-quick-add');
      await window.waitForTimeout(400);
      const modal = await window.$('#modal-quick-add');
      const hidden = await modal.getAttribute('class');
      if (hidden.includes('hidden')) throw new Error('Quick Add modal did not open');
      const grid = await window.$('#quick-add-grid');
      const tiles = await grid.$$('.quick-add-tile');
      if (tiles.length < 6) throw new Error(`Expected at least 6 tiles, got ${tiles.length}`);
      pass(`Quick Add modal opens with ${tiles.length} templates`);
    } catch (err) { fail('Quick Add opens modal', err); }

    // ----------------------------------------------------------------
    // Test 10: Quick Add template pre-fills the app form
    // ----------------------------------------------------------------
    console.log('Test 10: Quick Add template pre-fills form...');
    try {
      // Click Flask template
      const flaskTile = await window.$('.quick-add-tile:has(.quick-add-label)');
      // Find the tile with "Flask" text
      const tiles = await window.$$('.quick-add-tile');
      let flaskFound = false;
      for (const tile of tiles) {
        const text = await tile.textContent();
        if (text.includes('Flask')) {
          await tile.click();
          flaskFound = true;
          break;
        }
      }
      if (!flaskFound) throw new Error('Flask tile not found in Quick Add grid');
      await window.waitForTimeout(500);

      // App modal should now be open with Flask command pre-filled
      const appModal = await window.$('#modal-app');
      const modalHidden = await appModal.getAttribute('class');
      if (modalHidden.includes('hidden')) throw new Error('App modal did not open after template selection');

      const command = await window.inputValue('#app-command');
      if (!command.includes('python') && !command.includes('flask') && !command.includes('app.py')) {
        throw new Error(`Expected Flask command, got: "${command}"`);
      }
      const port = await window.inputValue('#app-port');
      if (port !== '5000') throw new Error(`Expected port 5000, got: "${port}"`);

      await closeAnyModal();
      pass('Flask Quick Add template pre-fills command and port');
    } catch (err) {
      await closeAnyModal().catch(() => {});
      fail('Quick Add template pre-fills form', err);
    }

    // ----------------------------------------------------------------
    // Test 11: Ctrl+Q opens Quick Add
    // ----------------------------------------------------------------
    console.log('Test 11: Ctrl+Q opens Quick Add...');
    try {
      await window.keyboard.press('Control+q');
      await window.waitForTimeout(400);
      const modal = await window.$('#modal-quick-add');
      const hidden = await modal.getAttribute('class');
      if (hidden.includes('hidden')) throw new Error('Quick Add modal did not open on Ctrl+Q');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
      pass('Ctrl+Q opens Quick Add modal');
    } catch (err) {
      await window.keyboard.press('Escape').catch(() => {});
      fail('Ctrl+Q opens Quick Add', err);
    }

    // ----------------------------------------------------------------
    // Test 12: Ctrl+G opens New Group modal
    // ----------------------------------------------------------------
    console.log('Test 12: Ctrl+G opens New Group modal...');
    try {
      await window.keyboard.press('Control+g');
      await window.waitForTimeout(400);
      const modal = await window.$('#modal-group');
      const hidden = await modal.getAttribute('class');
      if (hidden.includes('hidden')) throw new Error('Group modal did not open on Ctrl+G');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
      pass('Ctrl+G opens New Group modal');
    } catch (err) {
      await window.keyboard.press('Escape').catch(() => {});
      fail('Ctrl+G opens New Group', err);
    }

    // ----------------------------------------------------------------
    // Test 13: Ctrl+F focuses the search input on Apps tab
    // ----------------------------------------------------------------
    console.log('Test 13: Ctrl+F focuses search input...');
    try {
      await closeAnyModal();
      // Make sure Apps tab is active and no input focused
      await window.click('[data-tab="apps"]');
      await window.waitForTimeout(300);
      await window.keyboard.press('Control+f');
      await window.waitForTimeout(300);
      const focused = await window.evaluate(() => document.activeElement?.id);
      if (focused !== 'app-search') throw new Error(`Expected #app-search focused, got: "${focused}"`);
      pass('Ctrl+F focuses search input');
    } catch (err) { fail('Ctrl+F focuses search', err); }

    // ----------------------------------------------------------------
    // Test 14: Group modal has colour swatches
    // ----------------------------------------------------------------
    console.log('Test 14: Group modal shows colour swatches...');
    try {
      await closeAnyModal();
      await window.click('button[onclick="openNewGroupModal()"]');
      await window.waitForTimeout(400);
      const swatches = await window.$$('.color-swatch');
      if (swatches.length < 8) throw new Error(`Expected at least 8 colour swatches, got ${swatches.length}`);
      pass(`Group colour picker shows ${swatches.length} swatches`);
    } catch (err) { fail('Group colour swatches', err); }

    // ----------------------------------------------------------------
    // Test 15: Selecting a colour swatch marks it selected
    // ----------------------------------------------------------------
    console.log('Test 15: Clicking swatch marks it selected...');
    try {
      const swatches = await window.$$('.color-swatch');
      // Click the 3rd swatch
      await swatches[2].click();
      await window.waitForTimeout(200);
      const isSelected = await swatches[2].getAttribute('class');
      if (!isSelected.includes('selected')) throw new Error('Clicked swatch not marked selected');
      // Hidden input should be set
      const colorValue = await window.inputValue('#group-color-input');
      if (!colorValue || !colorValue.startsWith('#')) throw new Error(`Color input value unexpected: "${colorValue}"`);
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
      pass(`Swatch click marks selected and sets value: ${colorValue}`);
    } catch (err) {
      await window.keyboard.press('Escape').catch(() => {});
      fail('Swatch selection', err);
    }

    // ----------------------------------------------------------------
    // Test 16: Creating a group with colour stores the colour
    // ----------------------------------------------------------------
    console.log('Test 16: Group created with colour has coloured border...');
    try {
      await window.click('button[onclick="openNewGroupModal()"]');
      await window.waitForTimeout(400);
      await window.fill('#group-name-input', 'Coloured Group');
      // Click 5th swatch (index 4)
      const swatches = await window.$$('.color-swatch');
      await swatches[4].click();
      await window.waitForTimeout(200);
      const chosenColor = await window.inputValue('#group-color-input');
      await window.click('button[onclick="saveGroupModal()"]');
      await window.waitForTimeout(500);

      // The new group section should have a border-left with that colour
      const groupSection = await window.$('.app-section[data-group-id]');
      if (!groupSection) throw new Error('Group section not found after creation');
      const style = await groupSection.getAttribute('style');
      if (!style || !style.includes('border-left')) throw new Error(`Group section missing border-left style: "${style}"`);
      pass(`Group created with colour border (${chosenColor})`);
    } catch (err) { fail('Group colour border', err); }

    // ----------------------------------------------------------------
    // Test 17: Header running summary element exists
    // ----------------------------------------------------------------
    console.log('Test 17: Header running summary element exists...');
    try {
      const summary = await window.$('#header-running-summary');
      if (!summary) throw new Error('#header-running-summary not found in DOM');
      // With no running apps it should have "all stopped" or be empty
      const text = await summary.textContent();
      const className = await summary.getAttribute('class');
      // Just verify it's present and either has content or is intentionally empty
      pass(`Header running summary present (class: "${className}", text: "${text.trim()}")`);
    } catch (err) { fail('Header running summary exists', err); }

    // ----------------------------------------------------------------
    // Screenshot
    // ----------------------------------------------------------------
    console.log('\n📸 Taking screenshot...');
    fs.mkdirSync('test-results', { recursive: true });
    await window.screenshot({ path: 'test-results/v1.7-features.png' });
    console.log('Screenshot saved to test-results/v1.7-features.png');

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
    console.error(err.stack);
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('\n✅ PortPilot closed');
    }
    try { fs.rmSync(testUserDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  const total = 17;
  const successRate = Math.round((passed / total) * 100);

  console.log('\n========================================');
  console.log('       v1.7.0 FEATURE TEST RESULTS');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  console.log(`📊 Success Rate: ${successRate}%`);
  console.log('========================================\n');

  if (failed === 0) {
    console.log('🎉 ALL v1.7.0 FEATURE TESTS PASSED!\n');
  } else {
    console.log(`⚠️  ${failed} test(s) need attention\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
