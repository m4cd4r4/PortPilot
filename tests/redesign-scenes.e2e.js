/**
 * Real-Electron check of Scenes (Wave 5) against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-scenes.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots at 1440 and 390 wide.
 *
 * Covers: Save what is running is disabled with nothing up; New scene creates one in config.scenes;
 * Start starts its apps and reports a port held by someone else as Blocked while the rest still start;
 * Stop stops only what the scene started (an app started by hand stays up); Edit renames; Delete removes.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-scenes-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  process.env.PORTPILOT_NEW_UI = '1';
  const [pa, pb, pc] = await h.freePorts(3);
  const dir = world.mkdir('srv');
  fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
  const mk = (id, name, port) => ({ id, name, command: `node server.js --port ${port}`, cwd: dir, preferredPort: port });
  world.writeConfig({ apps: [mk('app_a', 'alpha', pa), mk('app_b', 'beta', pb), mk('app_c', 'gamma', pc)] });
  const cfg = () => JSON.parse(fs.readFileSync(world.configPath, 'utf8'));
  const scenes = () => cfg().scenes || [];

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const running = () => win.evaluate(async () => (await window.portpilot.process.list()).apps.filter((a) => a.running).map((a) => a.id));
  const report = () => win.locator('.scene-report').first().innerText();
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const w of [1440, 390]) {
      await win.setViewportSize({ width: w, height: 800 });
      await win.screenshot({ path: path.join(SHOTS, `scenes-${name}-${w}.png`) });
    }
    await win.setViewportSize({ width: 1440, height: 900 });
  };
  let held = null;

  try {
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');

    console.log('step: empty state');
    await win.click('role=tab[name="Scenes"]');
    await until(() => win.evaluate(() => !!document.querySelector('.scenes-view')), 10000, 'scenes screen');
    check('Save what is running is disabled with nothing up', await win.locator('role=button[name="Save what is running"]').isDisabled());
    await until(async () => (await win.locator('.empty-note').count()) === 1, 10000, 'empty note');
    check('the empty note shows', true);

    console.log('step: create');
    await win.click('role=button[name="New scene"]');
    await win.fill('input[placeholder="Morning work"]', 'Work');
    await win.check('.drawer label.check:has-text("alpha") input');
    await win.check('.drawer label.check:has-text("beta") input');
    await win.click('role=button[name="Create"]');
    await until(() => scenes().some((s) => s.name === 'Work'), 10000, 'scene saved');
    const sc = scenes().find((s) => s.name === 'Work');
    check('the form saved the scene with its two apps', sc.apps.length === 2 && sc.apps.includes('app_a') && sc.apps.includes('app_b'), JSON.stringify(sc));
    await until(() => win.evaluate(() => !!document.querySelector('article.scene')), 10000, 'scene card');

    console.log('step: start with a blocked port');
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Manage"]');
    await win.click('tr[data-app="app_c"] >> role=button[name="Start"]');
    await until(async () => (await running()).includes('app_c'), 15000, 'gamma started by hand');
    held = h.holdPort(pb);
    await until(async () => fetch(`http://127.0.0.1:${pb}`).then((r) => r.ok, () => false), 10000, 'port held');
    await win.click('role=tab[name="Scenes"]');
    await until(() => win.locator('role=button[name="Save what is running"]').isEnabled(), 15000, 'capture enabled');
    check('Save what is running is enabled once something is up', true);
    await win.click(`article[data-scene="${sc.id}"] >> role=button[name="Start"]`);
    await until(async () => (await running()).includes('app_a'), 15000, 'alpha started by the scene');
    const text = await until(async () => { const t = await report(); return t.includes('Started') ? t : ''; }, 10000, 'start report');
    check('the report lists alpha as started', /Started: alpha/.test(text), text);
    check('the held port is reported as Blocked', /Blocked: beta/.test(text), text);
    check('the blocked app was not started', !(await running()).includes('app_b'));
    await shot('started');
    await win.click('.banner >> role=button[name="Fix"]');
    await until(() => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Ports'), 10000, 'Ports tab');
    check('Fix on the blocked banner opens Ports, not the palette', true);
    await win.click('role=tab[name="Scenes"]');

    console.log('step: stop only what the scene started');
    await win.click(`article[data-scene="${sc.id}"] >> role=button[name="Stop"]`);
    await until(async () => !(await running()).includes('app_a'), 15000, 'alpha stopped');
    const after = await running();
    check('Stop stopped alpha', !after.includes('app_a'));
    check('the app started by hand is still up', after.includes('app_c'));
    check('the report says what was stopped', /Stopped: alpha/.test(await report()));
    check('Stop is disabled once the run is spent', await win.locator(`article[data-scene="${sc.id}"] >> role=button[name="Stop"]`).isDisabled());

    console.log('step: edit and delete');
    await win.click(`article[data-scene="${sc.id}"] >> role=button[name="Edit"]`);
    await win.fill('input[placeholder="Morning work"]', 'Work renamed');
    await win.click('role=button[name="Save"]');
    await until(() => scenes().some((s) => s.id === sc.id && s.name === 'Work renamed'), 10000, 'renamed');
    check('Edit renames the scene and keeps its id', true);
    await win.click(`article[data-scene="${sc.id}"] >> role=button[name="Edit"]`);
    await win.click('role=button[name="Delete scene"]');
    await win.click('role=button[name="Yes, delete"]');
    await until(() => !scenes().some((s) => s.id === sc.id), 10000, 'deleted');
    check('Delete removes the scene after a confirm', true);
    check('the apps survive the delete', cfg().apps.length === 3);

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (held) held.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
