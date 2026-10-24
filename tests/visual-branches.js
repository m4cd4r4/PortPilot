/**
 * Visual + smoke check for Wave 3 Slice 8: branch / worktree awareness.
 * Seeds an isolated config with one parent project plus two branch children,
 * launches the real Electron app, and verifies the children render nested under
 * the parent with branch chips and a "+ branch" affordance - no console errors.
 *
 * Run: node tests/visual-branches.js
 * Output: docs/ui-redesign/slice8-branches.png
 */
const { _electron: electron } = require('playwright');
// These drive the classic v4 UI; the redesign specs pin their own.
process.env.PORTPILOT_NEW_UI = process.env.PORTPILOT_NEW_UI || '0';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'ui-redesign');
const USER_DATA = path.join(ROOT, 'test-results', 'visual-branches-userdata');

const SEED = {
  apps: [
    { id: 'app_parent', name: 'PortPilot', command: 'npm start', cwd: 'I:\\Scratch\\PortPilot-2026', preferredPort: 3000, color: '#7aa2f7' },
    { id: 'app_branch_a', name: 'PortPilot', branch: 'feat/wave3', parentId: 'app_parent', command: 'npm start', cwd: 'I:\\Scratch\\portpilot-wave3', preferredPort: 3001, color: '#bb9af7' },
    { id: 'app_branch_b', name: 'PortPilot', branch: 'fix/login', parentId: 'app_parent', command: 'npm start', cwd: 'I:\\Scratch\\portpilot-fix-login', preferredPort: 3002, color: '#9ece6a' },
  ],
  groups: [],
  settings: { autoScan: false },
};

(async () => {
  const errors = [];
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(USER_DATA, 'portpilot-config.json'), JSON.stringify(SEED, null, 2));

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--remote-debugging-port=9334', `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const win = await app.firstWindow();
  win.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  const stats = await win.evaluate(() => {
    const trees = [...document.querySelectorAll('.app-tree')];
    const tree = trees[0];
    return {
      appCards: document.querySelectorAll('.app-card').length,
      trees: trees.length,
      branchCards: document.querySelectorAll('.app-card.is-branch').length,
      // branch children must live inside an .app-branches container
      nestedBranchCards: document.querySelectorAll('.app-branches .app-card.is-branch').length,
      branchChips: document.querySelectorAll('.branch-chip').length,
      branchCountHints: document.querySelectorAll('.branch-count').length,
      addBranchBtns: document.querySelectorAll('[data-act="addBranch"]').length,
      chipText: [...document.querySelectorAll('.branch-chip')].map(c => c.textContent.trim()),
      // parent should NOT itself be a top-level row outside a tree duplicated as a child
      parentIsBranch: tree ? tree.querySelector('.app-card')?.classList.contains('is-branch') : null,
    };
  });
  console.log('branch render stats:', JSON.stringify(stats, null, 2));

  await win.screenshot({ path: path.join(OUT, 'slice8-branches.png') });

  // Exercise the "+ branch" flow: opens the Add App modal in branch mode.
  let branchModal = { opened: false };
  const addBtn = await win.$('[data-act="addBranch"]');
  if (addBtn) {
    await addBtn.click();
    await win.waitForTimeout(300);
    branchModal = await win.evaluate(() => ({
      opened: !document.getElementById('modal-app').classList.contains('hidden'),
      title: document.getElementById('modal-title')?.textContent || '',
      branchFieldVisible: !document.getElementById('app-branch-group').classList.contains('hidden'),
      parentId: document.getElementById('app-parent-id')?.value || '',
      command: document.getElementById('app-command')?.value || '',
    }));
    await win.screenshot({ path: path.join(OUT, 'slice8-add-branch-modal.png') });
  }
  console.log('add-branch modal:', JSON.stringify(branchModal));

  console.log('errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');

  const pass =
    errors.length === 0 &&
    stats.trees === 1 &&
    stats.appCards === 3 &&
    stats.branchCards === 2 &&
    stats.nestedBranchCards === 2 &&
    stats.branchChips === 2 &&
    stats.branchCountHints === 1 &&
    stats.addBranchBtns === 1 &&
    branchModal.opened === true &&
    branchModal.branchFieldVisible === true &&
    branchModal.parentId === 'app_parent';

  console.log(pass ? '\nSLICE 8 PASS' : '\nSLICE 8 FAIL');
  await app.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
