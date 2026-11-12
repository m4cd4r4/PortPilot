/**
 * Real-Electron check of the Home actions against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-home.e2e.js
 *
 * Covers: a stopped app on Recently used offers Start and starts it; an app is under Running or Recently used, never both; the Scene card has a picker when
 * there are two scenes, remembers the choice, Start runs that scene and the same button then reads Stop,
 * and Stop stops what the scene started.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-home-');

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [pa, pb, pc, workPort] = await h.freePorts(4);
  let held = null;
  const dir = world.mkdir('srv');
  fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
  const mk = (id, name, port) => ({ id, name, command: `node server.js --portpilot-test --port ${port}`, cwd: dir, preferredPort: port });
  const apps = [mk('app_a', 'alpha', pa), mk('app_b', 'beta', pb), mk('app_c', 'gamma', pc)];
  world.writeConfig({
    apps,
    browserProfiles: [{ name: 'Work', port: workPort, browser: 'brave', mode: 'headless', url: 'about:blank' }],
    scenes: [{ id: 'sc_one', name: 'First', apps: ['app_a'], browsers: [] }, { id: 'sc_two', name: 'Second', apps: ['app_c'], browsers: [] }],
  });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const running = () => win.evaluate(async () => (await window.portpilot.process.list()).apps.filter((a) => a.running).map((a) => a.id));
  const startStop = async (a, ms) => {
    await win.evaluate((x) => window.portpilot.process.start(x), a);
    await h.sleep(ms);
    await win.evaluate((id) => window.portpilot.process.stop(id), a.id);
  };

  try {
    await until(() => win.evaluate(() => !!document.querySelector('.home')), 20000, 'home');

    console.log('step: Start again');
    await startStop(apps[1], 1500); // beta ran once and is now stopped, so it lands in history
    await win.evaluate((x) => window.portpilot.process.start(x), apps[0]); // alpha is running and takes the hero
    await until(() => win.evaluate(() => document.querySelector('.h-hero h2 .nm')?.textContent === 'alpha'), 20000, 'hero is alpha');
    await until(() => win.evaluate(() => !!document.querySelector('.h-recent .h2-act')), 20000, 'a Start button on a stopped row');
    check('the stopped app on Recently used offers Start', await win.evaluate(() => document.querySelector('.h-recent .h2-act').getAttribute('aria-label') === 'Start beta'));
    check('a running app is not repeated under Recently used', await win.evaluate(() => ![...document.querySelectorAll('.h-recent .nm')].some((e) => e.textContent === 'alpha')));
    check('the Running count is out of every app', (await win.locator('.h-hero .h2-head .tile-sub').textContent()) === '1 of 3 apps');
    await win.click('role=button[name="Start beta"]');
    await until(async () => (await running()).includes('app_b'), 20000, 'beta running');
    check('Start on the row starts the app', true);
    await until(() => win.evaluate(() => ![...document.querySelectorAll('.h-recent .nm')].some((e) => e.textContent === 'beta') && [...document.querySelectorAll('.run-row .nm')].some((e) => e.textContent === 'beta')), 20000, 'beta moved to Running');
    check('once it runs the app moves from Recently used to Running', true);

    console.log('step: scene picker');
    check('two scenes give a picker', (await win.locator('.h-scene select[aria-label="Scene"]').count()) === 1);
    await win.selectOption('.h-scene select[aria-label="Scene"]', 'sc_two');
    check('the picker remembers the choice', await win.evaluate(() => localStorage.getItem('portpilot-home-scene') === 'sc_two'));
    check('the card shows the chosen scene', (await win.locator('.h-scene').innerText()).includes('1 app'));
    await win.click('.h-scene button.primary');
    await until(async () => (await running()).includes('app_c'), 20000, 'gamma running');
    check('Start runs the chosen scene', true);
    await until(() => win.evaluate(() => document.querySelector('.h-scene button.primary')?.textContent === 'Stop'), 20000, 'button reads Stop');
    check('the same button now reads Stop', true);
    await win.click('.h-scene button.primary');
    await until(async () => !(await running()).includes('app_c'), 20000, 'gamma stopped');
    check('Stop stops what the scene started', true);
    check('and leaves the rest alone', (await running()).includes('app_a'));

    console.log('step: click a card opens its page');
    await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
    await win.click('.h-recent .h2-row:has-text("gamma") .h2-main');
    await until(async () => (await running()).includes('app_c'), 20000, 'gamma started by the click');
    await until(() => app.evaluate(() => global.__opened.length > 0), 20000, 'a page was opened');
    check('clicking a stopped app starts it and opens its page', (await app.evaluate(() => global.__opened[0])) === `http://localhost:${pc}`);
    // beta has been up since the Start step, so it is a Running tile.
    await win.click('.run-row:has-text("beta") .row-wrap');
    await until(() => app.evaluate(() => global.__opened.length > 1), 20000, 'second open');
    check('clicking a running app just opens its page', (await app.evaluate(() => global.__opened[1])) === `http://localhost:${pb}`);

    // Details on a Home tile opens that app's details, not just the Apps tab.
    await win.click('role=tab[name="Home"]');
    await win.locator('.run-row', { hasText: 'beta' }).locator('.chip-tr').click();
    await win.waitForSelector('[role=dialog][aria-label="beta details"]', { timeout: 5000 });
    check('Details on a Home tile opens that app\'s details', true);
    check('Details keeps the normal Apps view with its view switch', (await win.locator('[aria-label="View mode"]').count()) === 1);
    await win.click('[role=dialog] >> role=button[name="Close"]');
    // A browser row is a shortcut (running: show it, stopped: start it); a blocked one says why and links to Ports.
    await win.click('role=tab[name="Home"]');
    const tile = win.locator('.h-browsers .h2-main', { hasText: 'Work' });
    check('a stopped browser row offers Start', (await tile.getAttribute('title')) === 'Start Work');
    held = h.holdPort(workPort);
    await until(async () => (await tile.getAttribute('title')) === 'Why Work cannot start', 30000, 'Work tile blocked');
    await tile.click();
    await win.waitForSelector('.h-hero .tile-notice', { timeout: 5000 });
    const why = await win.locator('.h-hero .tile-notice').textContent();
    check('a blocked Home browser row says why', why.includes('Work cannot start'), why);
    check('and opens no form', (await win.locator('[role=dialog]').count()) === 0);
    await win.click('.tile-notice >> role=button[name="Go to Ports"]');
    await until(() => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Ports'), 5000, 'Ports tab');
    check('its Go to Ports link opens the Ports screen', true);
    held.kill(); held = null;
    // Status style reaches the Home tiles.
    await win.click('role=tab[name="Home"]');
    const word = () => win.locator('.run-row .stat-word').count();
    await win.evaluate(() => localStorage.setItem('portpilot-ui-prefs', JSON.stringify({ status: 'dot' })));
    await win.reload(); await win.waitForSelector('.run-row .row-th'); await win.waitForTimeout(300);
    check('Dot status shows no status word', (await word()) === 0);
    await win.evaluate(() => localStorage.setItem('portpilot-ui-prefs', JSON.stringify({ status: 'glyph' })));
    await win.reload(); await win.waitForSelector('.run-row .row-th'); await win.waitForTimeout(300);
    check('Glyph status shows the status word', (await word()) > 0);

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (held) held.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
