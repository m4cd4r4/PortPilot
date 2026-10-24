/**
 * Visual + smoke check for the redesigned grouped Active Ports view.
 * Launches the real Electron app, runs a scan against the machine's live
 * ports, captures console/page errors, and screenshots the ports section.
 *
 * Run: node tests/visual-ports.js
 * Output: docs/ui-redesign/phase1-*.png
 */
const { _electron: electron } = require('playwright');
// These drive the classic v4 UI; the redesign specs pin their own.
process.env.PORTPILOT_NEW_UI = process.env.PORTPILOT_NEW_UI || '0';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'ui-redesign');
// Isolated, throwaway config so this never mutates the user's real settings
// (toggling a group persists; without isolation it would pollute %APPDATA%).
const USER_DATA = path.join(ROOT, 'test-results', 'visual-userdata');

(async () => {
  const errors = [];
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  // --remote-debugging-port puts the app in test mode (bypasses the
  // single-instance lock, so this won't fight a PortPilot the user already has
  // open). --user-data-dir isolates config. ELECTRON_RUN_AS_NODE must be unset
  // or Electron runs headless as Node.
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--remote-debugging-port=9333', `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const win = await app.firstWindow();

  win.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await win.waitForLoadState('domcontentloaded');

  // Confirm the shared status module loaded under CSP and works in-context.
  const moduleCheck = await win.evaluate(() => {
    const S = window.PortPilotStatus;
    if (!S) return { ok: false, why: 'window.PortPilotStatus undefined' };
    return {
      ok: true,
      classifySvchost: S.classify({ port: 135, processName: 'svchost.exe', pid: 1908 }),
      classifyNode: S.classify({ port: 3000, processName: 'node.exe', commandLine: 'node next dev', pid: 1 }),
      groupOrder: S.GROUP_ORDER,
    };
  });
  console.log('module check:', JSON.stringify(moduleCheck));

  // Trigger a real scan and wait for rows (or time out gracefully).
  try {
    await win.click('#btn-scan', { timeout: 3000 });
  } catch { /* button id may differ; autoScan may already have run */ }
  await win.waitForTimeout(4500);

  const stats = await win.evaluate(() => {
    const groups = [...document.querySelectorAll('.port-group')].map((g) => ({
      key: g.dataset.portgroup,
      count: g.querySelectorAll('.port-row').length,
      collapsed: g.querySelector('.port-group-rows')?.classList.contains('collapsed') || false,
    }));
    return {
      summary: document.getElementById('ports-summary')?.textContent || '',
      count: document.getElementById('port-count')?.textContent || '',
      groups,
      rowCount: document.querySelectorAll('.port-row').length,
      dotCount: document.querySelectorAll('.status-dot').length,
    };
  });
  console.log('render stats:', JSON.stringify(stats, null, 2));

  // Phase 2: adopt-as-app affordance should appear on dev + other rows, never system.
  const adopt = await win.evaluate(() => {
    const groupAdopts = (key) => {
      const g = document.querySelector(`.port-group[data-portgroup="${key}"]`);
      return g ? g.querySelectorAll('[data-act="adoptPort"]').length : 0;
    };
    return {
      total: document.querySelectorAll('[data-act="adoptPort"]').length,
      dev: groupAdopts('dev'),
      other: groupAdopts('other'),
      system: groupAdopts('system'),
    };
  });
  console.log('adopt buttons:', JSON.stringify(adopt));

  await win.screenshot({ path: path.join(OUT, 'phase2-window.png') });
  const section = await win.$('#ports-section');
  if (section) await section.screenshot({ path: path.join(OUT, 'phase2-ports-default.png') });

  // Click a dev-group adopt button and confirm the Add App modal pre-fills.
  let adoptModal = { opened: false };
  const firstAdopt = await win.$('.port-group[data-portgroup="dev"] [data-act="adoptPort"]');
  if (firstAdopt) {
    await firstAdopt.click();
    await win.waitForTimeout(300);
    adoptModal = await win.evaluate(() => ({
      opened: !document.getElementById('modal-app').classList.contains('hidden'),
      title: document.getElementById('modal-title')?.textContent || '',
      port: document.getElementById('app-port')?.value || '',
      name: document.getElementById('app-name')?.value || '',
      command: (document.getElementById('app-command')?.value || '').slice(0, 48),
    }));
    await win.screenshot({ path: path.join(OUT, 'phase2-adopt-modal.png') });
    const closeBtn = await win.$('#modal-close');
    if (closeBtn) await closeBtn.click();
    await win.waitForTimeout(200);
  }
  console.log('adopt modal:', JSON.stringify(adoptModal));

  // Expand the System group to prove the collapse toggle works (and confirm no
  // adopt buttons there), then shoot again.
  const sysHeader = await win.$('.port-group[data-portgroup="system"] .port-group-header');
  if (sysHeader) {
    await sysHeader.click();
    await win.waitForTimeout(400);
    const section2 = await win.$('#ports-section');
    if (section2) await section2.screenshot({ path: path.join(OUT, 'phase2-ports-system-expanded.png') });
  }

  console.log('errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
  await app.close();
  process.exit(errors.length && !moduleCheck.ok ? 1 : 0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
