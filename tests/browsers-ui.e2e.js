/**
 * Real-Electron check of the Browsers tab, with REAL headless Brave, against a THROWAWAY config.
 * Run: node tests/browsers-ui.e2e.js   (needs Electron, playwright and Brave; skips without Brave)
 *
 * Covers: add / start (offscreen, headless) / mode / stop / edit / Duplicate (settings and
 * extensions only, never cookies) / Remove / Extensions dialog, and editing the port while a
 * foreign process holds it. Browser ports are free OS ports, never 9222-9240.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP browsers-ui: Brave is not installed'); process.exit(0); }

const { check, finish } = h.checker();
const world = h.makeWorld('pp-br-');
const cdp = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
const isUp = (port) => cdp(port).then(() => true, () => false);

async function main() {
  const [pA, pB, pC, pNew, pBusy] = await h.freePorts(5);
  const profilesDir = path.join(world.configDir, 'browser-profiles');
  const extId = 'a'.repeat(32);
  const shopDir = path.join(profilesDir, 'shop-tests');
  fs.mkdirSync(path.join(shopDir, 'Default', 'Extensions', extId, '1.2.0_0'), { recursive: true });
  fs.writeFileSync(path.join(shopDir, 'Default', 'Extensions', extId, '1.2.0_0', 'manifest.json'), JSON.stringify({ name: 'Vault Pass', version: '1.2.0' }));
  fs.writeFileSync(path.join(shopDir, 'Default', 'Preferences'), '{}');
  fs.writeFileSync(path.join(shopDir, 'Default', 'Cookies'), 'SECRET');
  world.writeConfig({
    browserProfiles: [
      { name: 'shop-tests', port: pA, browser: 'brave', mode: 'offscreen', url: 'https://example.com/', note: 'signed in to the shop admin' },
      { name: 'blog-qa', port: pB, browser: 'brave', mode: 'headless', url: 'about:blank', note: '' },
      { name: 'claude-pool-3', port: pC, browser: 'brave', mode: 'headed', url: '', note: 'spare' },
    ],
  });

  const { app, win } = await h.launch(world);
  let foreign = null;
  const row = (name) => `.brow[data-name="${name}"]`;
  const toggle = (name) => `${row(name)} [data-bact="toggle"]`;
  const visible = (id) => win.evaluate((i) => getComputedStyle(document.getElementById(i)).display !== 'none', id);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await win.waitForSelector('.view-tab[data-view="browsers"]');
    check('Browsers tab sits next to Apps and History', (await win.$$eval('.view-tab', (t) => t.map((x) => x.textContent.trim()).join(','))) === 'Apps,History,Browsers');
    await win.click('.view-tab[data-view="browsers"]');
    await until(async () => (await win.$$('.brow')).length === 3, 15000, 'three rows');
    check('three profiles listed, Apps and History hidden', (await visible('browsers-section')) && !(await visible('apps-section')) && !(await visible('history-section')));
    check('summary says 0 running · 3 stopped', (await win.textContent('#browsers-summary')) === '0 running · 3 stopped');

    // Real start of a headless Brave on a throwaway port, through the UI.
    await win.click(toggle('blog-qa'));
    await until(async () => (await win.textContent(toggle('blog-qa'))) === 'Stop', 60000, 'blog-qa running');
    const ver = await cdp(pB);
    check('real Brave answers CDP on the profile port', /Chrome|Brave/i.test(ver.Browser || ''), ver.Browser);
    const rowText = await win.textContent(row('blog-qa'));
    check('row shows Running and the desktop claim', rowText.includes('Running') && rowText.includes('In use by PortPilot desktop'));
    check('running profile sorts first', (await win.textContent('.brow .happ')) === 'blog-qa');
    check('Duplicate and Remove are disabled while running', await win.$eval(row('blog-qa'), (r) => r.querySelector('[data-bact="duplicate"]').disabled && r.querySelector('[data-bact="remove"]').disabled));

    // Extensions dialog
    await win.click(`${row('shop-tests')} [data-bact="extensions"]`);
    await win.waitForSelector('#bf-ext .bext-list');
    check('Extensions dialog lists Vault Pass 1.2.0', (await win.textContent('#bf-ext')).includes('Vault Pass'));
    await win.click('#browser-modal-cancel');

    // Duplicate: settings and extensions only
    await win.click(`${row('shop-tests')} [data-bact="duplicate"]`);
    await win.fill('#bf-name', 'shop-copy');
    await win.fill('#bf-port', String(pNew));
    await win.click('#browser-modal-ok');
    await win.waitForSelector(row('shop-copy'));
    const copyDir = path.join(profilesDir, 'shop-copy');
    check('duplicate carried the extension', fs.existsSync(path.join(copyDir, 'Default', 'Extensions', extId, '1.2.0_0', 'manifest.json')));
    check('duplicate did NOT carry Cookies', !fs.existsSync(path.join(copyDir, 'Default', 'Cookies')));
    check('source still has its Cookies', fs.existsSync(path.join(shopDir, 'Default', 'Cookies')));

    // Add dialog error path: a duplicate name in any case
    await win.click('#browsers-add');
    await win.fill('#bf-name', 'Shop-Tests');
    await win.click('#browser-modal-ok');
    await until(async () => (await win.textContent('#browser-modal-error')).length > 0, 8000, 'error text');
    check('duplicate name shows a plain error and keeps the dialog open', (await win.textContent('#browser-modal-error')).includes('already exists')
      && !(await win.$eval('#modal-browser', (m) => m.classList.contains('hidden'))));
    await win.click('#browser-modal-close');

    // Edit the port while a foreign process holds the new one
    foreign = h.holdPort(pBusy);
    await until(() => fetch(`http://127.0.0.1:${pBusy}/`).then((r) => r.ok, () => false), 10000, 'foreign server up');
    await win.click(`${row('claude-pool-3')} [data-bact="edit"]`);
    await win.fill('#bf-port', String(pBusy));
    await win.click('#browser-modal-ok');
    await until(() => win.$eval('#modal-browser', (m) => m.classList.contains('hidden')), 8000, 'edit saved');
    const blockedNow = () => win.textContent(row('claude-pool-3')).then((t) => t.replace(/\s+/g, ' '));
    await until(async () => /port held/i.test(await blockedNow()), 15000, 'row says Port held').catch(() => {});
    const blocked = await blockedNow();
    check('a profile whose port a foreign process holds says Port held and who holds it', /port held/i.test(blocked) && blocked.includes(`:${pBusy} is held by`), blocked);
    check('the foreign process is untouched', h.alive(foreign.pid));

    // Stop through the UI; the port must close
    await win.click(toggle('blog-qa'));
    await until(async () => (await win.textContent(toggle('blog-qa'))) === 'Start', 30000, 'blog-qa stopped');
    check('stopping closes the browser port', !(await isUp(pB)));

    // Remove a stopped profile
    await win.click(`${row('shop-copy')} [data-bact="remove"]`);
    await win.waitForSelector('#browser-modal-ok');
    check('Remove asks first, naming the profile', (await win.textContent('#modal-browser')).includes('Remove "shop-copy" from PortPilot?'));
    await win.click('#browser-modal-ok');
    await until(async () => (await win.$$(row('shop-copy'))).length === 0, 10000, 'shop-copy removed').catch(() => {});
    check('Remove takes the profile out of the list', (await win.$$(row('shop-copy'))).length === 0);
    check('Remove leaves the folder on disk', fs.existsSync(path.join(profilesDir, 'shop-copy')));

    // Tab switching still works both ways
    await win.click('.view-tab[data-view="history"]');
    check('History tab still works', (await visible('history-section')) && !(await visible('browsers-section')));
    await win.click('.view-tab[data-view="apps"]');
    check('Apps tab still works', (await visible('apps-section')) && !(await visible('browsers-section')));
    check('no renderer console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    if (foreign && h.alive(foreign.pid)) foreign.kill();
    const w = app.windows()[0];
    if (w) {
      // Stop through the app so it closes the browsers it started.
      for (const name of ['shop-tests', 'blog-qa', 'claude-pool-3']) {
        if (await w.$eval(toggle(name), (b) => b.textContent === 'Stop').catch(() => false)) await w.click(toggle(name)).catch(() => {});
      }
    }
    await h.sleep(3000); // a Stop click is async; let the browsers it closes go before looking
    await h.closeApp(app);
    // The app should have stopped everything it started; anything left is a leak, so say so and clean up.
    for (const p of [pA, pB, pC, pNew]) if (await isUp(p)) { console.log(`LEAK a browser is still up on :${p}`); await h.closeBrowserOn(p); }
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
