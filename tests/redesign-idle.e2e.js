/**
 * Real-Electron measurement of what the window asks the main process for while nobody can see it.
 * Run: npm run build:ui && node tests/redesign-idle.e2e.js
 *
 * Counts every renderer-to-main call over a fixed span: with the window visible, minimised, and
 * restored. A minimised window must make none; restoring it must read again at once.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-idle-');
const SPAN = 12000;

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [pa, pb, work] = await h.freePorts(3);
  const dir = world.mkdir('srv');
  fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
  const mk = (id, name, port) => ({ id, name, command: `node server.js --portpilot-test --port ${port}`, cwd: dir, preferredPort: port });
  world.writeConfig({ apps: [mk('app_a', 'alpha', pa), mk('app_b', 'beta', pb)], browserProfiles: [{ name: 'Work', port: work, browser: 'brave', mode: 'headless', url: 'about:blank' }] });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  try {
    await until(() => win.evaluate(() => document.querySelector('.home')?.getAttribute('aria-busy') === 'false'), 20000, 'home loaded');
    // Count every invoke the page makes, by wrapping the handlers already registered.
    const wrapped = await app.evaluate(({ ipcMain }) => {
      const m = ipcMain._invokeHandlers;
      if (!m || !m.size) return 0;
      global.__calls = {};
      for (const [ch, fn] of [...m]) m.set(ch, (...a) => { global.__calls[ch] = (global.__calls[ch] || 0) + 1; return fn(...a); });
      return m.size;
    });
    check('the call counter is in place', wrapped > 0, String(wrapped));
    const total = () => app.evaluate(() => Object.values(global.__calls).reduce((a, b) => a + b, 0));
    const over = async (ms) => { const a = await total(); await h.sleep(ms); return (await total()) - a; };
    const frame = (fn) => app.evaluate(({ BrowserWindow }, name) => { const w = BrowserWindow.getAllWindows().find((x) => x.isVisible() || x.isMinimized()); w[name](); }, fn);

    const visible = await over(SPAN);
    console.log(`calls in ${SPAN / 1000} s, visible: ${visible}`);
    check('a visible window keeps reading', visible >= 2, String(visible));

    await frame('minimize');
    // Under Playwright a minimised window still reports visibilityState "visible"; the page learns
    // it is hidden from the main process. Give that message, and a read already on its way, time.
    await h.sleep(1500);
    const hidden = await over(SPAN);
    console.log(`calls in ${SPAN / 1000} s, minimised: ${hidden} ${JSON.stringify(await app.evaluate(() => global.__calls))}`);
    check('a minimised window asks for nothing', hidden === 0, String(hidden));

    await frame('restore');
    const back = await over(2000);
    check('restoring the window reads again at once', back >= 1, String(back));
    const again = await over(SPAN);
    check('and it keeps reading afterwards', again >= 2, String(again));

    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
