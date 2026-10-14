/**
 * Real-Electron check of the Ctrl+K command palette, driven with the keyboard only, against a
 * THROWAWAY config.
 * Run: node tests/desktop-palette.e2e.js   (needs Electron + playwright; not part of test:unit)
 * Set PORTPILOT_SHOTS_DIR to save palette screenshots (3 themes x 1440 and 390).
 *
 * Covers: Ctrl+K opens it (also from inside a text field) and Esc closes it with focus put
 * back; typing ranks commands; Up/Down move (and wrap) with a matching aria-activedescendant;
 * Enter starts and stops an app, opens its History filtered to it, switches tab; "Free port"
 * needs a second Enter and then really frees the port; a browser profile is searchable from
 * the Apps tab; a query with no match says so; no console errors.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-palette-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  const [shopPort, idlePort, heldPort, profPort] = await h.freePorts(4);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort },
      { id: 'app_idle', name: 'idle', command: `node server.js --port ${idlePort}`, cwd: shop, preferredPort: idlePort },
    ],
    browserProfiles: [{ name: 'pal-qa', port: profPort, browser: 'brave', mode: 'headless', url: 'about:blank', note: '' }],
  });

  let foreign = null;
  const { app, win } = await h.launch(world);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const open = () => win.evaluate(() => !document.getElementById('palette').classList.contains('hidden'));
  const options = () => win.$$eval('#palette-list [role="option"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const first = async () => (await options())[0] || '';
  const listening = async (port) => { try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { return false; } };
  const running = (id) => win.evaluate(async (i) => {
    const { apps = [] } = await window.portpilot.process.list();
    return apps.some((a) => a.id === i && a.running);
  }, id);
  // Open the palette, type a query, wait for the first row to settle on the expected text.
  const ask = async (q, expect) => {
    await win.keyboard.press('Control+k');
    await until(open, 5000, 'palette opens');
    await win.keyboard.type(q);
    if (expect) await until(async () => (await first()).includes(expect), 5000, `first row for "${q}" to include "${expect}"`);
  };

  try {
    await until(() => win.evaluate(() => (state.apps || []).length === 2), 30000, 'apps loaded');

    // ---- Open, focus, close ----------------------------------------------------
    console.log('step: open and close');
    await win.focus('#global-search');
    await win.keyboard.press('Control+k');
    await until(open, 5000, 'palette opens from inside the search box');
    check('Ctrl+K opens it even from inside a text field', true);
    check('the palette input has focus', await win.evaluate(() => document.activeElement.id === 'palette-input'));
    const aria = await win.evaluate(() => {
      const i = document.getElementById('palette-input');
      const opt = document.getElementById(i.getAttribute('aria-activedescendant'));
      return { role: i.getAttribute('role'), dialog: document.getElementById('palette').getAttribute('role'), sel: opt && opt.getAttribute('aria-selected'), list: document.getElementById('palette-list').getAttribute('role') };
    });
    check('it is a combobox over a listbox in a dialog, with the active row announced', aria.role === 'combobox' && aria.list === 'listbox' && aria.dialog === 'dialog' && aria.sel === 'true', JSON.stringify(aria));
    await win.keyboard.press('Escape');
    check('Esc closes it', !(await open()));
    check('focus goes back to the search box', await win.evaluate(() => document.activeElement.id === 'global-search'));
    await win.keyboard.press('Control+k');
    await until(open, 5000, 'reopen');
    await win.keyboard.press('Control+k');
    check('Ctrl+K again closes it', !(await open()));

    // ---- Ranking and the cursor ------------------------------------------------
    console.log('step: ranking and cursor');
    await ask('idle', 'Start idle');
    const idleRows = await options();
    check('a stopped app offers Start, not Stop', idleRows.some((r) => r.includes('Start idle')) && !idleRows.some((r) => r.includes('Stop idle')), idleRows.join(' | '));
    await win.keyboard.press('Escape');
    await ask('go to');
    const n = (await options()).length;
    await win.keyboard.press('ArrowDown');
    const idx = () => win.evaluate(() => Number(document.getElementById('palette-input').getAttribute('aria-activedescendant').split('-').pop()));
    check('Down moves to the second row', (await idx()) === 1);
    await win.keyboard.press('ArrowUp');
    await win.keyboard.press('ArrowUp');
    check('Up from the first row wraps to the last', (await idx()) === n - 1, `${await idx()} of ${n}`);
    await win.keyboard.press('Escape');
    await ask('zzqq');
    check('a query with no match says so', /Nothing matches "zzqq"/.test(await win.$eval('#palette-list', (e) => e.textContent)));
    await win.keyboard.press('Escape');

    // ---- Start, History, Stop --------------------------------------------------
    console.log('step: start, history, stop');
    await ask('start shop', 'Start shop');
    await win.keyboard.press('Enter');
    check('Enter runs it and closes the palette', !(await open()));
    await until(() => running('app_shop'), 60000, 'shop running');
    check('Start shop started the app', true);
    await until(async () => await listening(shopPort), 30000, 'shop serving');
    // The palette reads what the screen reads, so wait for the screen to know, and for the run to be recorded.
    await until(() => win.evaluate(() => state.runningApps.some((r) => r.id === 'app_shop' && r.running)), 30000, 'renderer sees shop running');
    await until(() => win.evaluate(async () => (await window.portpilot.history.list()).runs.some((r) => r.appId === 'app_shop')), 30000, 'shop run recorded');

    await ask('history shop', 'History for shop');
    await win.keyboard.press('Enter');
    await until(() => win.evaluate(() => document.querySelector('main.content').dataset.view === 'history'), 5000, 'history view');
    await until(() => win.evaluate(() => document.getElementById('history-app').value === 'app_shop'), 10000, 'history filtered to shop');
    check('History for shop opens History filtered to shop', true);
    check('and shows its run', (await win.$$('#history-list .hrow')).length >= 1);

    await ask('go to apps', 'Go to Apps');
    await win.keyboard.press('Enter');
    await until(() => win.evaluate(() => document.querySelector('main.content').dataset.view === 'apps'), 5000, 'apps view');
    check('Go to Apps switches tab', true);

    await ask('shop', 'Stop shop');
    const shopRows = await options();
    check('a running app offers Stop and Open, not Start', shopRows.some((r) => r.includes('Open shop in browser')) && !shopRows.some((r) => /^AppStart shop/.test(r)), shopRows.join(' | '));
    check('the running row shows its port', shopRows.some((r) => r.includes('Stop shop') && r.includes(`:${shopPort}`)), shopRows.join(' | '));
    await win.keyboard.type(' stop');
    await until(async () => (await first()).includes('Stop shop') && (await options()).length === 1, 5000, 'query narrows to Stop shop');
    await win.keyboard.press('Enter');
    await until(async () => !(await running('app_shop')), 30000, 'shop stopped');
    check('Stop shop stopped the app', true);

    // ---- Free a port: two Enters -----------------------------------------------
    console.log('step: free port');
    foreign = h.holdPort(heldPort);
    await win.evaluate(() => { window.__seen = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__seen.push(n.textContent); }).observe(document.getElementById('toast-container'), { childList: true }); });
    await until(() => listening(heldPort), 15000, 'foreign server up');
    await ask('scan ports', 'Scan ports');
    await win.keyboard.press('Enter');
    await until(() => win.evaluate((p) => (state.ports || []).some((x) => x.port === p), heldPort), 20000, 'scan sees the held port');
    await ask(String(heldPort), `Free port ${heldPort}`);
    await win.keyboard.press('Enter');
    check('the first Enter only arms it, the palette stays open', await open());
    check('and says what it will stop', new RegExp(`Press Enter again to stop .* on :${heldPort}`).test(await win.$eval('#palette-foot', (e) => e.textContent)));
    check('the port is still held', await listening(heldPort));
    await win.keyboard.press('ArrowDown');
    await win.keyboard.press('ArrowUp');
    check('moving off the row disarms it', !/Press Enter again/.test(await win.$eval('#palette-foot', (e) => e.textContent)));
    await win.keyboard.press('Enter');
    check('moving away and pressing Enter arms again, it does not run', await open() && await listening(heldPort));
    await win.keyboard.press('Enter');
    check('the second Enter closes it', !(await open()));
    // Finding the holder re-scans every listener and can take seconds. Known flake in the existing scanner
    // (checkPort misses a port the last scan listed: toast 'No process found on port N'); it is not the palette's,
    // so retry once through the palette and say so out loud.
    const outcome = () => win.evaluate(() => (window.__seen || []).some((t) => /Failed to kill/.test(t)));
    await until(async () => !(await listening(heldPort)) || (await outcome()), 60000, 'kill outcome');
    // A failed kill drops the port from the list, so each retry rescans first, then frees through the palette again.
    for (let attempt = 1; attempt <= 3 && (await listening(heldPort)); attempt++) {
      console.log(`NOTE: scanner missed the port (${await win.evaluate(() => window.__seen.filter((t) => /Failed to kill/.test(t)).join(' | '))}); retry ${attempt} through the palette`);
      await win.evaluate(() => { window.__seen = []; });
      await ask('scan ports', 'Scan ports');
      await win.keyboard.press('Enter');
      await until(() => win.evaluate((p) => (state.ports || []).some((x) => x.port === p), heldPort), 20000, 'rescan sees the held port');
      await ask(String(heldPort), `Free port ${heldPort}`);
      await win.keyboard.press('Enter');
      await win.keyboard.press('Enter');
      await until(async () => !(await listening(heldPort)) || (await outcome()), 60000, 'retry kill outcome');
    }
    await until(async () => !(await listening(heldPort)), 5000, 'port freed');
    check('and the port is really free', true);

    // ---- A browser profile from the Apps tab -----------------------------------
    console.log('step: browser profile');
    await win.keyboard.press('Control+k');
    await until(open, 5000, 'open for profile');
    await win.keyboard.type('pal-qa');
    await until(async () => (await options()).some((r) => r.includes('Start browser pal-qa')), 15000, 'profile command');
    check('a browser profile is searchable from the Apps tab', true);
    await win.keyboard.press('Escape');

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const theme of ['tokyonight', 'light', 'glass']) {
        for (const [w, hh] of [[1440, 900], [390, 844]]) {
          await win.setViewportSize({ width: w, height: hh });
          await win.evaluate((t) => window.setTheme(t, false), theme);
          await win.waitForTimeout(500);
          await win.keyboard.press('Control+k');
          await until(open, 5000, 'open for screenshot');
          await win.keyboard.type('s');
          await win.waitForTimeout(250);
          await win.screenshot({ path: path.join(SHOTS, `palette-${theme}-${w}.png`) });
          await win.keyboard.press('Escape');
        }
      }
    }

    check('no console errors or page errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (foreign) foreign.kill();
    const w = app.windows()[0];
    if (w) {
      const { apps = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of apps.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
