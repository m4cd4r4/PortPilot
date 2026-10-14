/**
 * Real-Electron check of browser profile purpose, sites and window, with REAL Brave, against a
 * THROWAWAY config.
 * Run: node tests/browsers-purpose.e2e.js   (needs Electron, playwright and Brave; skips without Brave)
 *      PORTPILOT_E2E_NO_HEADED=1 skips the one headed start (no window appears on the desktop)
 *
 * Covers: a profile created through the UI with purpose, sites and a window; the persisted fields;
 * start_browser `for` through the web agent's POST /api/browser/start_browser (match, NO_MATCH);
 * the saved window applied to a real headed Brave and read back from the browser itself (not from the
 * start result); keep-in-front checked against the window's real always-on-top style on Windows;
 * "Capture current position" filling the form from the real window after it was moved; and
 * screenshots of the edit form and the row at 1440 and 390 px into report-shots/ (never committed).
 * Browser ports are free OS ports, never 9222-9240.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;
const { execFileSync } = require('child_process');

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP browsers-purpose: Brave is not installed'); process.exit(0); }
const HEADED = process.env.PORTPILOT_E2E_NO_HEADED !== '1';

const { check, finish } = h.checker();
const world = h.makeWorld('pp-bp-');
const shots = path.join(h.root, 'report-shots');
const cdpUp = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);

/** One CDP call on the browser endpoint, from the test (an independent reader, not PortPilot's code). */
async function cdpCall(port, method, params = {}, withWindow = false) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (m, p) => new Promise((resolve, reject) => {
    const mine = ++id;
    const onMsg = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === mine) { ws.removeEventListener('message', onMsg); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mine, method: m, params: p }));
  });
  try {
    if (!withWindow) return await send(method, params);
    const page = tabs.find((t) => t.type === 'page');
    const { windowId } = await send('Browser.getWindowForTarget', { targetId: page.id });
    return await send(method, { windowId, ...params });
  } finally { ws.close(); }
}
const realBounds = async (port) => (await cdpCall(port, 'Browser.getWindowBounds', {}, true)).bounds;

/** Windows: is the browser's main window always-on-top (WS_EX_TOPMOST), asked of the OS itself. */
function isTopmost(pid) {
  const script = `Add-Type -Namespace PP -Name Q -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);'; `
    + `$h = (Get-Process -Id ${Number(pid)}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { 'nohandle' } else { (([PP.Q]::GetWindowLong($h, -20) -band 8) -ne 0) }`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
}

async function post(agentPort, token, tool, body) {
  const r = await fetch(`http://127.0.0.1:${agentPort}/api/browser/${tool}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-portpilot-token': token }, body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  fs.mkdirSync(shots, { recursive: true });
  const [pGsc, pFb, pAgent] = await h.freePorts(3);
  const pHeadless = pFb;
  world.writeConfig({
    browserProfiles: [
      { name: 'facebook', port: pHeadless, browser: 'brave', mode: 'headless', url: 'about:blank', note: '', purpose: 'Facebook pages', sites: ['facebook.com'] },
    ],
  });

  const { app, win } = await h.launch(world);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const row = (name) => `.brow[data-name="${name}"]`;
  const toggle = (name) => `${row(name)} [data-bact="toggle"]`;
  const readConfig = () => JSON.parse(fs.readFileSync(world.configPath, 'utf8')).browserProfiles;
  const WIN = { left: 220, top: 140, width: 1000, height: 700 };

  // The agent the web portal runs, in this process, on the same throwaway config.
  const { createAgent } = require('../src/agent/server');
  const token = 'e'.repeat(64);
  const agent = createAgent({ configStore: { configPath: world.configPath }, port: pAgent, token });
  await agent.start();

  try {
    await win.waitForSelector('.view-tab[data-view="browsers"]');
    await win.click('.view-tab[data-view="browsers"]');
    await until(async () => (await win.$$('.brow')).length === 1, 15000, 'one row');
    check('a profile with purpose and sites shows For: with both', (await win.textContent(`${row('facebook')} .bpurpose`)).replace(/\s+/g, ' ').includes('Facebook pages · facebook.com'));

    // ---- Create a profile through the UI: purpose, sites, window ----
    await win.click('#browsers-add');
    await win.fill('#bf-name', 'gsc');
    await win.fill('#bf-port', String(pGsc));
    await win.selectOption('#bf-browser', 'brave');
    await win.selectOption('#bf-mode', 'headed');
    await win.fill('#bf-url', 'about:blank');
    await win.fill('#bf-purpose', 'Google Search Console, Analytics');
    await win.fill('#bf-sites', 'Search.Google.com, analytics.google.com');
    check('the Window section is collapsed on a new profile', !(await win.$eval('#bf-window', (d) => d.open)));
    await win.click('#bf-window summary');
    await win.fill('#bf-left', String(WIN.left));
    await win.fill('#bf-top', String(WIN.top));
    await win.fill('#bf-width', String(WIN.width));
    await win.fill('#bf-height', String(WIN.height));
    await win.check('#bf-front');
    check('Capture current position is disabled until the profile runs', await win.$eval('#bf-capture', (b) => b.disabled));
    await win.screenshot({ path: path.join(shots, 'add-form-1440.png') });
    await win.click('#browser-modal-ok');
    await until(() => win.$eval('#modal-browser', (m) => m.classList.contains('hidden')), 8000, 'add saved');
    await win.waitForSelector(row('gsc'));

    const saved = readConfig().find((p) => p.name === 'gsc');
    check('purpose is persisted', saved.purpose === 'Google Search Console, Analytics', JSON.stringify(saved));
    check('sites are persisted lowercased, as a list', JSON.stringify(saved.sites) === JSON.stringify(['search.google.com', 'analytics.google.com']));
    check('window is persisted as whole numbers with front', JSON.stringify(saved.window) === JSON.stringify({ ...WIN, front: true }), JSON.stringify(saved.window));
    check('the row says what it is for and where its window sits', /For\s+Google Search Console, Analytics · search\.google\.com/.test(await win.textContent(`${row('gsc')} .bpurpose`))
      && /Window\s+1000x700 at 220,140 · stays in front/.test((await win.textContent(`${row('gsc')} .bplace`)).replace(/\s+/g, ' ')));

    // A bad site is a plain error and the dialog stays open
    await win.click(`${row('gsc')} [data-bact="edit"]`);
    await win.fill('#bf-sites', 'https://search.google.com/search-console');
    await win.click('#browser-modal-ok');
    await until(async () => (await win.textContent('#browser-modal-error')).length > 0, 8000, 'bad site error');
    check('a pasted URL in Sites is refused in plain words', /not a hostname/.test(await win.textContent('#browser-modal-error')));
    await win.click('#browser-modal-close');
    check('the refused edit changed nothing', JSON.stringify(readConfig().find((p) => p.name === 'gsc').sites) === JSON.stringify(['search.google.com', 'analytics.google.com']));

    // ---- for, through the web agent's route ----
    const miss = await post(pAgent, token, 'start_browser', { for: 'linkedin' });
    check('for with no matching profile is NO_MATCH naming the profiles, and nothing started', miss.success === false && miss.code === 'NO_MATCH'
      && /facebook/.test(miss.error) && /gsc/.test(miss.error) && !(await cdpUp(pGsc)), JSON.stringify(miss).slice(0, 200));
    const both = await post(pAgent, token, 'start_browser', { for: 'x', name: 'gsc' });
    check('name and for together is BAD_ARGS', both.code === 'BAD_ARGS');

    const fb = await post(pAgent, token, 'start_browser', { for: 'https://www.facebook.com/pages/create' });
    check('for a Facebook URL starts the facebook profile on its own port', fb.success === true && fb.name === 'facebook' && fb.port === pHeadless && fb.cdpUrl === `http://127.0.0.1:${pHeadless}`, JSON.stringify(fb).slice(0, 200));
    check('the start says why it matched', fb.matchedBy && /site facebook\.com/.test(fb.matchedBy.reason), fb.matchedBy && fb.matchedBy.reason);
    check('a real browser answers on the headless port', await cdpUp(pHeadless));
    const stopFb = await post(pAgent, token, 'stop_browser', { name: 'facebook' });
    check('the headless profile stops', stopFb.success === true && !(await cdpUp(pHeadless)));

    if (HEADED) {
      const gsc = await post(pAgent, token, 'start_browser', { for: 'access Google Search Console' });
      check('for free text starts the headed profile by its purpose', gsc.success === true && gsc.name === 'gsc' && gsc.port === pGsc, JSON.stringify(gsc).slice(0, 300));
      check('the result reports the requested window', gsc.window && JSON.stringify(gsc.window.requested) === JSON.stringify(WIN));
      const real = await realBounds(pGsc);
      check('the real browser window is where the profile says (read from the browser, not the result)',
        Math.abs(real.left - WIN.left) <= 20 && Math.abs(real.top - WIN.top) <= 20 && Math.abs(real.width - WIN.width) <= 20 && Math.abs(real.height - WIN.height) <= 20, JSON.stringify(real));
      check('the result agrees with the browser about where it landed', gsc.window && gsc.window.applied === true && gsc.window.actual.left === real.left, JSON.stringify(gsc.window && gsc.window.actual));
      if (process.platform === 'win32') {
        const holder = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `(Get-NetTCPConnection -LocalPort ${pGsc} -State Listen | Select-Object -First 1).OwningProcess`], { encoding: 'utf8', windowsHide: true }).trim();
        const top = isTopmost(holder);
        check('Keep in front made the real window always-on-top (asked of Windows, not of PortPilot)', top === 'True' && gsc.window.front && gsc.window.front.topmost === true, `${top} ${JSON.stringify(gsc.window && gsc.window.front)}`);
      }

      // The user moves the window by hand; reusing the browser puts it back (keep in front)
      await cdpCall(pGsc, 'Browser.setWindowBounds', { bounds: { left: 40, top: 60, width: 900, height: 600, windowState: 'normal' } }, true);
      const again = await post(pAgent, token, 'start_browser', { for: 'search.google.com' });
      const back = await realBounds(pGsc);
      check('reusing the running browser is already:true and puts the window back', again.already === true && Math.abs(back.left - WIN.left) <= 20 && Math.abs(back.width - WIN.width) <= 20, JSON.stringify(back));

      // ---- Capture current position ----
      await cdpCall(pGsc, 'Browser.setWindowBounds', { bounds: { left: 160, top: 90, width: 1100, height: 750, windowState: 'normal' } }, true);
      // Let the window settle (the OS applies bounds a moment after the browser reports them).
      let moved = await realBounds(pGsc);
      await until(async () => { const b = await realBounds(pGsc); const same = b.left === moved.left && b.top === moved.top; moved = b; return same; }, 8000, 'the moved window to settle');
      await until(async () => (await win.textContent(toggle('gsc'))) === 'Stop', 30000, 'the UI sees gsc running');
      await win.click(`${row('gsc')} [data-bact="edit"]`);
      check('the Window section opens by itself when a window is saved', await win.$eval('#bf-window', (d) => d.open));
      check('Capture current position is enabled for a running profile', !(await win.$eval('#bf-capture', (b) => b.disabled)));
      await win.fill('#bf-left', '');
      await win.fill('#bf-top', '');
      await win.click('#bf-capture');
      await until(async () => (await win.inputValue('#bf-left')) !== '', 15000, 'capture filled the fields');
      const got = { left: Number(await win.inputValue('#bf-left')), top: Number(await win.inputValue('#bf-top')), width: Number(await win.inputValue('#bf-width')), height: Number(await win.inputValue('#bf-height')) };
      const nowReal = await realBounds(pGsc); // the window is the truth; compare with it as it is after the click
      check('Capture fills left, top, width and height from the real window', got.left === nowReal.left && got.top === nowReal.top && got.width === nowReal.width && got.height === nowReal.height, `${JSON.stringify(got)} vs ${JSON.stringify(nowReal)}`);
      check('Capture says to save', /Save to keep/.test(await win.textContent('#bf-capture-note')));
      await win.screenshot({ path: path.join(shots, 'edit-form-capture-1440.png') });
      await win.click('#browser-modal-ok');
      await until(() => win.$eval('#modal-browser', (m) => m.classList.contains('hidden')), 8000, 'edit saved');
      const after = readConfig().find((p) => p.name === 'gsc');
      check('Save keeps the captured numbers and keep-in-front', after.window.left === got.left && after.window.width === got.width && after.window.front === true, JSON.stringify(after.window));
    } else {
      console.log('NOTE headed checks skipped (PORTPILOT_E2E_NO_HEADED=1)');
    }

    // ---- Screenshots of the row and the form, at both widths ----
    await win.waitForSelector(row('gsc'));
    for (const [w, hgt] of [[1440, 900], [390, 844]]) {
      await win.setViewportSize({ width: w, height: hgt });
      await h.sleep(400);
      await win.screenshot({ path: path.join(shots, `rows-${w}.png`) });
      await win.click(`${row('gsc')} [data-bact="edit"]`);
      await win.waitForSelector('#modal-browser:not(.hidden)');
      if (!(await win.$eval('#bf-window', (d) => d.open))) await win.click('#bf-window summary');
      await win.screenshot({ path: path.join(shots, `edit-form-${w}.png`) });
      const fit = await win.evaluate(() => {
        const c = document.querySelector('#modal-browser .modal-content');
        return { horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth, modalRight: Math.round(c.getBoundingClientRect().right), vw: window.innerWidth };
      });
      check(`no horizontal page scroll at ${w}px`, !fit.horizontalOverflow, JSON.stringify(fit));
      await win.click('#browser-modal-cancel');
    }
    await win.setViewportSize({ width: 1440, height: 900 });

    // ---- Stop through the UI; the port must close ----
    if (HEADED) {
      await win.click(toggle('gsc'));
      await until(async () => (await win.textContent(toggle('gsc'))) === 'Start', 30000, 'gsc stopped');
      check('stopping closes the headed browser', !(await cdpUp(pGsc)));
    }
    check('no renderer console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await agent.stop().catch(() => {});
    await h.sleep(500);
    await h.closeApp(app);
    for (const p of [pGsc, pFb]) if (await cdpUp(p)) { console.log(`LEAK a browser is still up on :${p}`); await h.closeBrowserOn(p); }
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
