/**
 * Real-Electron check of the Apps tab and History re-run, against a THROWAWAY config.
 * Run: node tests/desktop-apps.e2e.js   (needs Electron + playwright; not part of test:unit)
 *
 * Covers: row state cell (Running, claude provenance), conflict strip (busy port, Stop & start),
 * crash toast (Restart, Logs, Ask Claude), Apps row page preview, History "Re-run this version".
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-apps-');
const configFile = require(path.join(h.root, 'src/core/configFile.js'));
const status = require(path.join(h.root, 'src/core/status.js'));

const card = (id) => `.app-card[data-id="${id}"]`;
const text = (win, sel) => win.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());

async function main() {
  const [shopPort, plainPort, crashPort] = await h.freePorts(3);
  const shop = world.mkdir('shop');
  const plain = world.mkdir('plain');
  const boom = world.mkdir('boom');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  fs.writeFileSync(path.join(plain, 'server.js'), h.SERVER);
  fs.writeFileSync(path.join(boom, 'boom.js'), "console.log('booting'); console.error('Error: database is down'); setTimeout(() => process.exit(3), 600);\n");
  h.git(shop, 'init', '-q');
  h.git(shop, 'config', 'user.email', 't@example.com');
  h.git(shop, 'config', 'user.name', 'T');
  h.git(shop, 'add', '-A');
  h.git(shop, 'commit', '-q', '-m', 'init');

  world.writeConfig({
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort },
      { id: 'app_plain', name: 'plain', command: `node server.js --port ${plainPort}`, cwd: plain, preferredPort: plainPort },
      { id: 'app_boom', name: 'boom', command: 'node boom.js', cwd: boom, preferredPort: crashPort },
    ],
  });
  // A live Claude session, so the crash toast offers Ask Claude.
  const sessionsDir = configFile.sessionsDirFor(world.configPath);
  fs.mkdirSync(sessionsDir, { recursive: true });
  const beat = () => fs.writeFileSync(path.join(sessionsDir, 'sess-a3f2.json'), JSON.stringify({ sessionId: 'a3f2-session', cwd: boom, at: Date.now() }));
  beat();
  const beatTimer = setInterval(beat, 10000);

  const { app, win } = await h.launch(world);
  let foreign = null;
  try {
    await win.waitForSelector(card('app_shop'));

    // ---- Running + provenance ------------------------------------------------
    console.log('step: running state');
    check('stopped app says Stopped', /stopped/i.test(await text(win, `${card('app_shop')} .state-word`)));
    await win.click(`${card('app_shop')} [data-act="startApp"]`);
    await until(async () => /running/i.test(await text(win, `${card('app_shop')} .state-word`)), 30000, 'shop Running');
    check('started app says Running', true);
    check('Running row carries "you" as the starter', /you/.test(await text(win, `${card('app_shop')} .state-meta`)), await text(win, `${card('app_shop')} .state-meta`));
    // Claude starts an app through MCP, which stamps the runtime sidecar; do what MCP does.
    const pid = await win.evaluate(() => state.runningApps.find((r) => r.id === 'app_shop').pid);
    configFile.recordStart(world.configPath, 'app_shop', status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: 'a3f2-session' }), { pid, port: shopPort });
    await win.evaluate(() => window.loadApps());
    await until(async () => /claude a3f2/.test(await text(win, `${card('app_shop')} .state-meta`)), 15000, 'claude provenance');
    check('row shows "claude a3f2" for a Claude-started run', true);
    check('state cell is not colour alone: glyph and word both present', await win.$eval(`${card('app_shop')} .state-cell`, (e) => !!e.querySelector('.state-glyph').textContent.trim() && !!e.querySelector('.state-word').textContent.trim()));

    // ---- Page preview on the row ---------------------------------------------
    console.log('step: row page preview');
    await until(async () => (await win.$$(`${card('app_shop')} .row-thumb img`)).length === 1, 45000, 'row thumbnail');
    check('running row shows a page preview', true);
    check('stopped row shows none', (await win.$$(`${card('app_plain')} .row-thumb`)).length === 0);

    // ---- Conflict strip: a stranger holds the port -----------------------------
    console.log('step: conflict strip');
    foreign = h.holdPort(plainPort);
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${plainPort}/`)).ok; } catch { return false; } }, 10000, 'foreign server up');
    await until(async () => { await win.evaluate(() => window.loadApps()); return win.$(`${card('app_plain')} .conflict-strip`); }, 30000, 'conflict strip');
    const sentence = await text(win, `${card('app_plain')} .conflict-sentence`);
    check('conflict strip names the port and the holder', sentence.includes(`:${plainPort}`) && /PID/.test(sentence), sentence);
    check('row says Port blocked', /port blocked/i.test(await text(win, `${card('app_plain')} .state-word`)));
    const labels = await win.$$eval(`${card('app_plain')} .conflict-actions button`, (bs) => bs.map((b) => b.textContent.trim()));
    check('strip offers free port first, then kill, then show process', labels.length === 3 && /^Use (:\d+ instead|next free port)$/.test(labels[0]) && /Kill & start/.test(labels[1]) && /Show process/.test(labels[2]), labels.join(' | '));
    const kill = win.locator(`${card('app_plain')} [data-act="killAndStart"]`);
    await kill.click();
    check('first click only arms the kill', /confirm/i.test(await kill.textContent()) && h.alive(foreign.pid));
    await kill.click();
    await until(async () => !h.alive(foreign.pid), 15000, 'foreign process gone');
    await until(async () => /running/i.test(await text(win, `${card('app_plain')} .state-word`)), 30000, 'plain Running on its own port');
    check('Kill & start ended the holder and started the app on its port', true);

    // ---- Crash toast -----------------------------------------------------------
    console.log('step: crash toast');
    await win.click(`${card('app_boom')} [data-act="startApp"]`);
    await win.waitForSelector('.crash-toast', { timeout: 30000 });
    check('crash toast names the app and exit code', /boom crashed/.test(await text(win, '.crash-toast-title')) && /exit 3/.test(await text(win, '.crash-toast-meta')), await text(win, '.crash-toast-meta'));
    check('crash toast shows the app\'s last output', (await text(win, '.crash-toast-lines')).includes('database is down'));
    const buttons = await win.$$eval('.crash-toast-btn', (bs) => bs.map((b) => b.textContent.trim()));
    check('toast offers Restart, Logs, Ask Claude, Dismiss', buttons[0] === 'Restart' && buttons[1] === 'Logs' && /^Ask Claude \(a3f2\)$/.test(buttons[2]) && buttons[3] === 'Dismiss', buttons.join(' | '));
    const t0 = Date.now();
    const crashedRow = await until(async () => { await win.evaluate(() => window.loadApps()); return /crashed.*exit 3/i.test(await text(win, `${card('app_boom')} .state-cell`)); }, 60000, 'crashed row').then(() => true, () => false);
    check('row says Crashed with the exit code', crashedRow, `${await text(win, `${card('app_boom')} .state-cell`)} after +${Math.round((Date.now() - t0) / 1000)}s`);
    await win.click('.crash-toast-btn:has-text("Ask Claude")');
    await until(async () => /^Sent to/.test(await text(win, '.crash-toast-btn.primary')), 10000, 'Ask Claude sent');
    const inbox = JSON.parse(fs.readFileSync(configFile.inboxPathFor(world.configPath, 'a3f2-session'), 'utf8'));
    check('Ask Claude wrote a request for the app to that session\'s inbox', inbox.requests.some((r) => r.appId === 'app_boom'));
    await win.click('.crash-toast-btn:has-text("Logs")');
    await win.waitForSelector('#modal-logs:not(.hidden)', { timeout: 8000 });
    check('Logs opens the log view for the crashed app', (await text(win, '#logs-app-name')) === 'boom');
    await win.keyboard.press('Escape');
    await win.evaluate(() => document.getElementById('modal-logs').classList.add('hidden'));
    await win.click('.crash-toast-btn:has-text("Restart")');
    await win.waitForSelector('.crash-toast', { state: 'detached', timeout: 8000 });
    check('Restart dismisses the toast and starts the app again', true);

    // ---- History: Re-run this version ----------------------------------------
    console.log('step: history re-run');
    await win.click('.view-tab[data-view="history"]');
    await win.waitForSelector('.hrow');
    const reRuns = () => win.$$('.hrow:has(.happ:text-is("shop")):has(.hby:text-is("re-run"))').then((r) => r.length);
    const before = await reRuns();
    await win.locator('.hrow:has(.happ:text-is("shop")) [data-hact="rerun"]:not([disabled])').first().click({ timeout: 5000 });
    const added = await until(async () => (await reRuns()) > before, 60000, 'a re-run row for shop').then(() => true, () => false);
    const diag = added ? '' : `rows=${await win.$$eval('.hrow', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')).join(' || '))} toasts=${await win.$$eval('.toast', (els) => els.map((e) => e.innerText).join(' | '))}`;
    check('Re-run this version adds a shop run marked re-run', added, diag);
    await win.click('.view-tab[data-view="apps"]');
  } finally {
    clearInterval(beatTimer);
    if (foreign && h.alive(foreign.pid)) foreign.kill();
    const w = app.windows()[0];
    // Everything this app started, including the re-run's own registered app.
    if (w) {
      const { apps = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of apps.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
