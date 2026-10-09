/**
 * Real-Electron check of the History tab against a THROWAWAY config.
 * Run: node tests/history-ui.e2e.js   (needs Electron + playwright; not part of test:unit)
 *
 * APPDATA points at a temp dir so userData (and every config/history file) is
 * isolated, PORTPILOT_MCP_PORT is a free port so the real app's 8788 is never
 * touched, and nothing here kills a process it did not start.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ui-'));
process.env.APPDATA = tmp; // HOME/USERPROFILE stay real: Chromium crashes at launch without a profile dir
const configDir = path.join(tmp, 'portpilot');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'portpilot-config.json');

const root = path.join(__dirname, '..');
const runHistory = require(path.join(root, 'src/core/runHistory.js'));
const { _electron: electron } = require('playwright');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const SERVER = "const a = process.argv.indexOf('--port');\n"
  + "const port = a > -1 ? Number(process.argv[a + 1]) : Number(process.env.PORT);\n"
  + "require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Shop demo</title><body style=\"background:#1d4ed8;color:#fff;font:48px sans-serif\"><h1>Shop demo</h1></body>'); }).listen(port, '127.0.0.1');\n";

async function until(fn, ms = 20000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const shop = path.join(tmp, 'shop');
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(shop); fs.mkdirSync(plain);
  fs.writeFileSync(path.join(shop, 'server.js'), SERVER);
  fs.writeFileSync(path.join(plain, 'server.js'), SERVER);
  git(shop, 'init', '-q');
  git(shop, 'config', 'user.email', 't@example.com');
  git(shop, 'config', 'user.name', 'T');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(shop, 'server.js'), `${SERVER}// dirty\n`);

  const shopPort = await freePort();
  const plainPort = await freePort();
  const apps = [
    { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort },
    { id: 'app_plain', name: 'plain', command: `node server.js --port ${plainPort}`, cwd: plain, preferredPort: plainPort },
  ];
  fs.writeFileSync(configPath, JSON.stringify({ apps, settings: {}, groups: [] }));

  // History before launch: stopped, crashed (pinned), and a run with no git state.
  const seed = async (appId, endedBy, exitCode) => {
    const r = runHistory.openRun(configPath, appId, { kind: 'human', surface: 'desktop' });
    await r.done;
    runHistory.closeRun(configPath, appId, { endedBy, exitCode });
    return r.id;
  };
  await seed('app_shop', 'user', null);
  const crashedId = await seed('app_shop', 'crash', 1);
  await seed('app_plain', 'user', null);
  assert.strictEqual(runHistory.pinRun(configPath, crashedId, true).ok, true);

  const mcpPort = await freePort();
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    // Electron resolves userData from the OS, not APPDATA, so point it at the throwaway dir explicitly.
    args: [root, `--user-data-dir=${configDir}`],
    cwd: root,
    // A shell started from VS Code carries ELECTRON_RUN_AS_NODE; an empty value does not clear it.
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/.test(k))),
      PORTPILOT_MCP_PORT: String(mcpPort),
    },
  });
  try {
    const win = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1440, height: 900 });

    // The app must be using the throwaway config, not the real one.
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    assert.strictEqual(path.resolve(userData), path.resolve(configDir), 'userData is the throwaway dir');

    await win.click('.view-tab[data-view="history"]');
    await win.waitForSelector('.hrow');
    const rows = await win.$$eval('.hrow', (els) => els.map((e) => ({
      app: e.querySelector('.happ').textContent,
      state: e.querySelector('.state-word').textContent,
      pinned: !!e.querySelector('.hpin'),
      openDisabled: e.querySelector('[data-hact="open"]').disabled,
      rerunDisabled: e.querySelector('[data-hact="rerun"]').disabled,
      shaDisabled: e.querySelector('[data-hact="sha"]').disabled,
    })));
    console.log('rows', JSON.stringify(rows));
    assert.strictEqual(rows.length, 3, 'three seeded rows');
    assert(rows.every((r) => r.openDisabled), 'Open URL is disabled when nothing is running');
    const plainRow = rows.find((r) => r.app === 'plain');
    assert(plainRow.rerunDisabled && plainRow.shaDisabled, 'no-git run cannot be re-run or copied');
    assert(rows.filter((r) => r.app === 'shop').every((r) => !r.rerunDisabled), 'git runs can be re-run');
    assert(rows.some((r) => /crash/i.test(r.state) && r.pinned), 'crashed run is pinned and labelled');

    console.log('step: filters');
    await win.fill('#history-search', 'plain');
    assert.strictEqual((await win.$$('.hrow')).length, 1, 'search narrows to one');
    await win.fill('#history-search', '');
    assert.strictEqual((await win.$$('.hrow')).length, 3, 'clearing search restores rows');
    await win.check('#history-dirty');
    const dirtyCount = (await win.$$('.hrow')).length;
    assert(dirtyCount >= 1 && dirtyCount < 3, `dirty-only filters (${dirtyCount})`);
    await win.uncheck('#history-dirty');

    console.log('step: pin');
    const firstPin = win.locator('.hrow [data-hact="pin"]').first();
    const before = await firstPin.textContent();
    await firstPin.click();
    await until(async () => (await win.locator('.hrow [data-hact="pin"]').first().textContent()) !== before, 8000, 'pin label flip');

    console.log('step: live');
    const started = await win.evaluate((a) => window.portpilot.process.start(a), apps[0]);
    console.log('started', JSON.stringify(started));
    assert.strictEqual(started.success, true, `start failed: ${JSON.stringify(started)}`);
    await until(async () => win.$eval('.hrow:first-child .state-word', (e) => /running/i.test(e.textContent)), 15000, 'live row says running');
    console.log('step: live row up');
    const liveOpen = await win.$eval('.hrow:first-child [data-hact="open"]', (e) => !e.disabled);
    assert.strictEqual(liveOpen, true, 'Open URL enabled for the live run');
    await until(async () => (await win.$$('.hrow:first-child .hthumb img')).length === 1, 40000, 'thumbnail in the live row');
    console.log('step: thumb seen');
    const run = runHistory.readRuns(configPath).filter((r) => r.port === shopPort).pop();
    assert(run.page && run.page.thumb && run.page.title === 'Shop demo', `page patched: ${JSON.stringify(run.page)}`);
    assert(fs.existsSync(path.join(runHistory.historyDirFor(configPath), run.page.thumb)), 'thumb file exists');
    assert.strictEqual(electronApp.windows().length, 1, 'no capture window left open');

    console.log('step: apps row preview');
    await win.click('.view-tab[data-view="apps"]');
    const shopThumb = '.app-card[data-id="app_shop"] .row-thumb img';
    await until(async () => (await win.$$(shopThumb)).length === 1, 15000, 'preview on the running shop row');
    const rowInfo = await win.evaluate(() => {
      // The row proper: a conflict strip hangs off the same card and is not part of the row's density.
      const h = (id) => { const c = document.querySelector(`.app-card[data-id="${id}"]`); const s = c.querySelector('.conflict-strip'); return Math.round(c.getBoundingClientRect().height - (s ? s.getBoundingClientRect().height : 0)); };
      const img = document.querySelector('.app-card[data-id="app_shop"] .row-thumb img');
      const cell = img.parentElement;
      const shop = h('app_shop');
      cell.style.display = 'none';
      const shopNoThumb = h('app_shop');
      cell.style.display = '';
      return { shopNoThumb, shop, plain: h('app_plain'), plainThumb: !!document.querySelector('.app-card[data-id="app_plain"] .row-thumb'), decoded: img.complete && img.naturalWidth > 0 };
    });
    console.log('row preview', JSON.stringify(rowInfo));
    assert.strictEqual(rowInfo.shop, rowInfo.shopNoThumb, 'the preview does not make its own row taller');
    assert.strictEqual(rowInfo.plainThumb, false, 'a stopped app shows no preview');
    assert.strictEqual(rowInfo.decoded, true, 'the preview is decoded at render');
    assert.strictEqual(electronApp.windows().length, 1, 'the row preview opened no extra window');
    await win.waitForTimeout(7000); // two auto-scan refreshes: the preview stays, nothing new opens
    assert.strictEqual((await win.$$(shopThumb)).length, 1, 'the preview survives the auto-scan refresh');
    assert.strictEqual(electronApp.windows().length, 1, 'a refresh opened no capture window');
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await win.setViewportSize({ width: w, height: h });
      await win.waitForTimeout(400);
      await win.screenshot({ path: path.join(os.tmpdir(), `pp-ui-apps-${w}.png`) });
    }
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.click('#btn-settings');
    await win.uncheck('#setting-row-previews');
    await until(async () => (await win.$$(shopThumb)).length === 0, 8000, 'preview gone when the setting is off');
    await win.check('#setting-row-previews');
    await until(async () => (await win.$$(shopThumb)).length === 1, 8000, 'preview back when the setting is on');
    await win.click('#settings-close');

    console.log('step: asserts ok');
    const shots = path.join(root, 'docs', 'demo', 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await win.setViewportSize({ width: w, height: h });
      await win.waitForTimeout(400);
      await win.screenshot({ path: path.join(os.tmpdir(), `pp-ui-history-${w}.png`) });
    }
    console.log('history ui e2e: ok');
    await win.evaluate((id) => window.portpilot.process.stop(id), 'app_shop');
  } finally {
    const win = electronApp.windows()[0];
    if (win) await win.evaluate((id) => window.portpilot.process.stop(id), 'app_shop').catch(() => {});
    await Promise.race([electronApp.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
