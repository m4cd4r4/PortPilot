/**
 * PortPilot Groups Feature Test Suite
 * Tests create, rename, delete, assign app to group, move selected to group
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

async function runTests() {
  console.log('\n========================================');
  console.log('  PortPilot Groups Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  let electronApp;
  let window;
  // Use a temp user data dir so tests don't pollute the real config
  const testUserDataDir = path.join(os.tmpdir(), `portpilot-test-${Date.now()}`);

  function pass(label) {
    console.log(`✅ PASSED - ${label}`);
    passed++;
  }

  function fail(label, err) {
    console.log(`❌ FAILED - ${label}: ${err.message || err}`);
    failed++;
  }

  // Close any open modals to prevent them blocking clicks
  async function closeAnyModal() {
    // Close app modal if open
    const appModalOpen = await window.$eval('#modal-app', el => !el.classList.contains('hidden')).catch(() => false);
    if (appModalOpen) {
      await window.click('#btn-cancel').catch(() => {});
      await window.waitForTimeout(300);
    }
    // Close group modal if open
    const groupModalOpen = await window.$eval('#modal-group', el => !el.classList.contains('hidden')).catch(() => false);
    if (groupModalOpen) {
      await window.keyboard.press('Escape').catch(() => {});
      await window.waitForTimeout(300);
    }
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

    // Navigate to the Apps tab
    await window.click('[data-tab="apps"]');
    await window.waitForTimeout(500);
    console.log('✅ App launched and on Apps tab\n');

    // ------------------------------------------------------------------
    // Test 1: New Group button is visible
    // ------------------------------------------------------------------
    console.log('Test 1: New Group button visible...');
    try {
      const newGroupBtn = await window.$('button[onclick="openNewGroupModal()"]');
      if (!newGroupBtn) throw new Error('New Group button not found');
      const visible = await newGroupBtn.isVisible();
      if (!visible) throw new Error('New Group button not visible');
      pass('New Group button is visible');
    } catch (err) { fail('New Group button visible', err); }

    // ------------------------------------------------------------------
    // Test 2: Create a new group
    // ------------------------------------------------------------------
    console.log('\nTest 2: Create a new group...');
    let groupId;
    try {
      await window.click('button[onclick="openNewGroupModal()"]');
      await window.waitForSelector('#modal-group:not(.hidden)', { timeout: 3000 });

      await window.fill('#group-name-input', 'Test Group Alpha');
      await window.click('button[onclick="saveGroupModal()"]');
      await window.waitForTimeout(800);

      // Group modal should be closed
      const modalHidden = await window.$eval('#modal-group', el => el.classList.contains('hidden'));
      if (!modalHidden) throw new Error('Modal did not close after save');

      // Group section should appear in the DOM
      const groupSection = await window.$('[data-group-id]');
      if (!groupSection) throw new Error('No group section rendered');

      groupId = await groupSection.getAttribute('data-group-id');
      const sectionText = await groupSection.textContent();
      if (!sectionText.includes('Test Group Alpha')) throw new Error('Group name not shown in section');

      pass('Group "Test Group Alpha" created');
    } catch (err) { fail('Create new group', err); }

    // ------------------------------------------------------------------
    // Test 3: Group section is collapsible (re-query after re-render)
    // ------------------------------------------------------------------
    console.log('\nTest 3: Group section collapse/expand...');
    try {
      if (!groupId) throw new Error('No groupId from previous test');

      // Collapse: click the toggle - section is re-rendered after each toggle
      await window.click(`[data-group-id="${groupId}"] .section-toggle`);
      await window.waitForTimeout(600);

      // Re-query after re-render
      const toggleAfterCollapse = await window.$(`[data-group-id="${groupId}"] .section-toggle`);
      if (!toggleAfterCollapse) throw new Error('Toggle not found after collapse re-render');
      const collapsedText = await toggleAfterCollapse.textContent();
      if (!collapsedText.includes('▶')) throw new Error(`Expected ▶ after collapse, got "${collapsedText}"`);

      // Expand: click again
      await window.click(`[data-group-id="${groupId}"] .section-toggle`);
      await window.waitForTimeout(600);

      // Re-query after re-render
      const toggleAfterExpand = await window.$(`[data-group-id="${groupId}"] .section-toggle`);
      if (!toggleAfterExpand) throw new Error('Toggle not found after expand re-render');
      const expandedText = await toggleAfterExpand.textContent();
      if (!expandedText.includes('▼')) throw new Error(`Expected ▼ after expand, got "${expandedText}"`);

      pass('Group collapses and expands');
    } catch (err) { fail('Group collapse/expand', err); }

    // ------------------------------------------------------------------
    // Test 4: Add an app and assign it to the group
    // ------------------------------------------------------------------
    console.log('\nTest 4: Add app assigned to group...');
    await closeAnyModal();
    try {
      if (!groupId) throw new Error('No groupId from previous test');

      const addBtn = await window.$('#btn-add-app');
      if (!addBtn) throw new Error('#btn-add-app not found');
      await addBtn.click();
      await window.waitForSelector('#modal-app:not(.hidden)', { timeout: 3000 });

      await window.fill('#app-name', 'Grouped App One');
      await window.fill('#app-command', 'echo hello');

      // Select the group in the dropdown
      const groupSelect = await window.$('#app-group');
      if (!groupSelect) throw new Error('#app-group select not found');
      await groupSelect.selectOption(groupId);

      // Submit the form via the submit button
      await window.click('#app-form button[type="submit"]');
      await window.waitForTimeout(800);

      // Verify modal closed
      const modalHidden = await window.$eval('#modal-app', el => el.classList.contains('hidden'));
      if (!modalHidden) throw new Error('App modal did not close');

      // Verify app appears inside the group section
      const groupSection = await window.$(`[data-group-id="${groupId}"]`);
      if (!groupSection) throw new Error('Group section not found after app add');
      const groupText = await groupSection.textContent();
      if (!groupText.includes('Grouped App One')) throw new Error('App not shown in group section');

      pass('App "Grouped App One" added to group');
    } catch (err) {
      await closeAnyModal();
      fail('Add app to group', err);
    }

    // ------------------------------------------------------------------
    // Test 5: Group shows correct app count in header
    // ------------------------------------------------------------------
    console.log('\nTest 5: Group header shows app count...');
    try {
      if (!groupId) throw new Error('No groupId');
      const countBadge = await window.$(`[data-group-id="${groupId}"] .section-count`);
      if (!countBadge) throw new Error('.section-count not found in group header');
      const countText = await countBadge.textContent();
      if (!countText.includes('1')) throw new Error(`Expected count "1", got "${countText.trim()}"`);
      pass(`Group shows count: "${countText.trim()}"`);
    } catch (err) { fail('Group shows app count', err); }

    // ------------------------------------------------------------------
    // Test 6: Rename group
    // ------------------------------------------------------------------
    console.log('\nTest 6: Rename group...');
    await closeAnyModal();
    try {
      if (!groupId) throw new Error('No groupId');

      await window.click(`[data-group-id="${groupId}"] button[onclick*="openRenameGroupModal"]`);
      await window.waitForSelector('#modal-group:not(.hidden)', { timeout: 3000 });

      const titleText = await window.$eval('#group-modal-title', el => el.textContent);
      if (!titleText.includes('Rename')) throw new Error(`Modal title is "${titleText}", expected rename mode`);

      await window.fill('#group-name-input', 'Renamed Group Beta');
      await window.click('button[onclick="saveGroupModal()"]');
      await window.waitForTimeout(800);

      // Re-query the section since name changed (DOM re-rendered)
      const groupSection = await window.$(`[data-group-id="${groupId}"]`);
      if (!groupSection) throw new Error('Group section not found after rename');
      const sectionText = await groupSection.textContent();
      if (!sectionText.includes('Renamed Group Beta')) throw new Error('Renamed title not shown in section');

      pass('Group renamed to "Renamed Group Beta"');
    } catch (err) {
      await closeAnyModal();
      fail('Rename group', err);
    }

    // ------------------------------------------------------------------
    // Test 7: Add second app (ungrouped), then move to group via selection toolbar
    // ------------------------------------------------------------------
    console.log('\nTest 7: Move app to group via selection toolbar...');
    await closeAnyModal();
    try {
      if (!groupId) throw new Error('No groupId');

      // Add a second ungrouped app
      const addBtn = await window.$('#btn-add-app');
      await addBtn.click();
      await window.waitForSelector('#modal-app:not(.hidden)', { timeout: 3000 });
      await window.fill('#app-name', 'Ungrouped App Two');
      await window.fill('#app-command', 'echo world');
      // Leave group as "Other Projects" (default)
      await window.click('#app-form button[type="submit"]');
      await window.waitForTimeout(800);

      // Find the ungrouped app's card in "Other Projects" section
      const ungroupedSection = await window.$('.app-section:not([data-group-id])');
      if (!ungroupedSection) throw new Error('Other Projects section not found');

      // Find a card with "Ungrouped App Two" in it
      const appCards = await ungroupedSection.$$('[data-id]');
      let targetCard = null;
      for (const card of appCards) {
        const text = await card.textContent();
        if (text.includes('Ungrouped App Two')) { targetCard = card; break; }
      }
      if (!targetCard) throw new Error('"Ungrouped App Two" card not found in Other Projects');

      // Check the checkbox on the card
      const checkbox = await targetCard.$('.app-checkbox');
      if (!checkbox) throw new Error('.app-checkbox not found on card');
      await checkbox.click();
      await window.waitForTimeout(400);

      // Selection toolbar should appear
      const toolbarVisible = await window.$eval('#selection-toolbar', el => !el.classList.contains('hidden'));
      if (!toolbarVisible) throw new Error('Selection toolbar not visible after selecting app');

      // Use "Move to Group" dropdown
      await window.selectOption('#selection-group-select', groupId);
      await window.waitForTimeout(800);

      // App should now be in the group section
      const groupSection = await window.$(`[data-group-id="${groupId}"]`);
      if (!groupSection) throw new Error('Group section not found');
      const groupText = await groupSection.textContent();
      if (!groupText.includes('Ungrouped App Two')) throw new Error('App not moved to group section');

      pass('"Ungrouped App Two" moved to group via toolbar');
    } catch (err) {
      await closeAnyModal();
      fail('Move app to group via toolbar', err);
    }

    // ------------------------------------------------------------------
    // Test 8: Delete group - apps move to Other Projects
    // ------------------------------------------------------------------
    console.log('\nTest 8: Delete group (apps ungrouped)...');
    await closeAnyModal();
    try {
      if (!groupId) throw new Error('No groupId');

      // Set up confirm dialog handler
      window.once('dialog', async dialog => {
        await dialog.accept();
      });

      await window.click(`[data-group-id="${groupId}"] button[onclick*="confirmDeleteGroup"]`);
      await window.waitForTimeout(1000);

      // Group section should be gone
      const groupSection = await window.$(`[data-group-id="${groupId}"]`);
      if (groupSection) throw new Error('Group section still present after delete');

      // Both apps should have moved to Other Projects
      const ungroupedSection = await window.$('.app-section:not([data-group-id])');
      if (!ungroupedSection) throw new Error('Other Projects section not found after group delete');
      const ungroupedText = await ungroupedSection.textContent();
      if (!ungroupedText.includes('Grouped App One')) throw new Error('"Grouped App One" not in Other Projects');
      if (!ungroupedText.includes('Ungrouped App Two')) throw new Error('"Ungrouped App Two" not in Other Projects');

      pass('Group deleted, both apps moved to Other Projects');
    } catch (err) { fail('Delete group', err); }

    // Screenshot at the end
    console.log('\n📸 Taking screenshot...');
    await window.screenshot({ path: 'test-results/groups-final.png' });
    console.log('Screenshot saved to test-results/groups-final.png');

  } catch (err) {
    console.error('\n❌ FATAL ERROR:', err.message);
    console.error(err.stack);
  } finally {
    if (electronApp) {
      await electronApp.close();
      console.log('\n✅ PortPilot closed');
    }
    // Clean up temp user data dir
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch (_) {}
  }

  const total = 8;
  const successRate = Math.round((passed / total) * 100);

  console.log('\n========================================');
  console.log('         GROUPS TEST RESULTS');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  console.log(`📊 Success Rate: ${successRate}%`);
  console.log('========================================\n');

  if (failed === 0) {
    console.log('🎉 ALL GROUP TESTS PASSED!\n');
  } else {
    console.log(`⚠️  ${failed} test(s) need attention\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
