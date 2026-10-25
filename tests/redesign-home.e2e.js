/**
 * Real-Electron check of the Home actions against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-home.e2e.js
 *
 * Covers: a stopped app on Recently used offers Start and starts it; the Scene card has a picker when
 * there are two scenes, remembers the choice, Start runs that scene and the same button then reads Stop,
 * and Stop stops what the scene started.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-home-');

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  process.env.PORTPILOT_NEW_UI = '1';
  const [pa, pb, pc] = await h.freePorts(3);
  const dir = world.mkdir('srv');
  fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
  const mk = (id, name, port) => ({ id, name, command: `node server.js --port ${port}`, cwd: dir, preferredPort: port });
  const apps = [mk('app_a', 'alpha', pa), mk('app_b', 'beta', pb), mk('app_c', 'gamma', pc)];
  world.writeConfig({
    apps,
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
    await until(() => win.evaluate(() => document.querySelector('.h-hero h2')?.textContent === 'alpha'), 20000, 'hero is alpha');
    await until(() => win.evaluate(() => !!document.querySelector('.h-recent .th-start')), 20000, 'a Start button on a stopped card');
    check('the stopped app on Recently used offers Start', await win.evaluate(() => document.querySelector('.h-recent .th-start').getAttribute('aria-label') === 'Start beta'));
    await win.locator('.h-recent .th-card:has-text("beta")').hover();
    await win.click('role=button[name="Start beta"]');
    await until(async () => (await running()).includes('app_b'), 20000, 'beta running');
    check('Start on the card starts the app', true);
    await until(() => win.evaluate(() => !document.querySelector('.h-recent .th-start')), 20000, 'Start button gone once it runs');
    check('a running app has no Start button', true);

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
    await win.click('.h-recent .th-card:has-text("gamma") .th-wrap');
    await until(async () => (await running()).includes('app_c'), 20000, 'gamma started by the click');
    await until(() => app.evaluate(() => global.__opened.length > 0), 20000, 'a page was opened');
    check('clicking a stopped app starts it and opens its page', (await app.evaluate(() => global.__opened[0])) === `http://localhost:${pc}`);
    // beta has been up since the Start step and stays on the strip (gamma, just started, is now the hero).
    await win.click('.h-recent .th-card:has-text("beta") .th-wrap');
    await until(() => app.evaluate(() => global.__opened.length > 1), 20000, 'second open');
    check('clicking a running app just opens its page', (await app.evaluate(() => global.__opened[1])) === `http://localhost:${pb}`);

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
