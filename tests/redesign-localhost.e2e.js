/**
 * Real-Electron check of the redesign's Localhost gallery and History screens (ui/, src/ui-dist)
 * against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-localhost.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots (each view mode at 1440 and 1120 wide, dark).
 *
 * Covers: one card per app; Start from the card; hover takes a live screenshot; a stopped app
 * keeps its last screenshot dimmed; the four view modes and their persistence; the filter;
 * a blocked port badges its card; History lists the run with its page title and day heading.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-localhost-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [shopPort, idlePort, heldPort] = await h.freePorts(3);
  process.env.PORTPILOT_NEW_UI = '1';
  process.env.PORTPILOT_DETECT_ONLY_PORTS = [shopPort, idlePort, heldPort].join(',');
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    groups: [{ id: 'g_web', name: 'Web' }],
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort, groupId: 'g_web' },
      { id: 'app_idle', name: 'idle', command: `node server.js --port ${idlePort}`, cwd: shop, preferredPort: idlePort },
      { id: 'app_blocked', name: 'blocked', command: `node server.js --port ${heldPort}`, cwd: shop, preferredPort: heldPort },
    ],
  });

  let foreign = null;
  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const card = (id) => win.locator(`.card[data-app="${id}"]`);
  const stateOf = (id) => card(id).getAttribute('data-state');
  const modeClass = () => win.evaluate(() => document.querySelector('.cards')?.className || '');

  try {
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');
    await win.click('role=tab[name="Localhost"]');
    await until(() => win.locator('.card').count().then((n) => n === 3), 15000, 'three cards');
    check('one card per registered app', true);
    check('the gallery is the default mode', (await modeClass()).includes('gallery'));
    check('a stopped app with no history shows a letter tile', (await card('app_idle').locator('.letter').count()) === 1);

    console.log('step: start from the card and capture on hover');
    await card('app_shop').hover();
    await card('app_shop').getByRole('button', { name: 'Start' }).click();
    await until(async () => (await stateOf('app_shop')) === 'running', 30000, 'shop card running');
    check('Start on the card starts the app', true);
    await card('app_shop').hover();
    await win.mouse.move(5, 5);
    await card('app_shop').hover();
    await until(() => card('app_shop').locator('.shot img').count().then((n) => n === 1), 30000, 'live screenshot on the card');
    check('hovering a running card takes a live screenshot', true);
    const src = await card('app_shop').locator('.shot img').getAttribute('src');
    check('the screenshot is a JPEG data URL', /^data:image\/jpeg;base64,/.test(src));

    console.log('step: stopped keeps the last screenshot, dimmed');
    await card('app_shop').hover();
    await card('app_shop').getByRole('button', { name: 'Stop' }).click();
    await until(async () => (await stateOf('app_shop')) === 'stopped', 30000, 'shop card stopped');
    check('a stopped app keeps its last screenshot', (await card('app_shop').locator('.shot img').count()) === 1);
    const opacity = await card('app_shop').locator('.shot img').evaluate((el) => getComputedStyle(el).opacity);
    check('and it is dimmed', Number(opacity) < 1, `opacity ${opacity}`);

    console.log('step: view modes');
    for (const mode of ['compact', 'list', 'grouped', 'gallery']) {
      await win.click(`role=button[name="${mode[0].toUpperCase() + mode.slice(1)}"]`);
      await until(async () => (await modeClass()).includes(mode === 'grouped' ? 'gallery' : mode), 5000, `${mode} class`);
      check(`${mode} mode renders its cards`, (await win.locator('.card').count()) === 3);
      if (mode === 'grouped') {
        const heads = await win.locator('.group-h').allTextContents();
        check('grouped mode has a heading per group', heads.length === 2 && heads[0].startsWith('Web') && heads[1].startsWith('Other'), heads.join(' | '));
      }
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await win.emulateMedia({ colorScheme: 'dark' });
        for (const w of [1440, 1120]) {
          await win.setViewportSize({ width: w, height: 800 });
          await win.screenshot({ path: path.join(SHOTS, `localhost-${mode}-${w}.png`) });
        }
        await win.setViewportSize({ width: 1440, height: 900 });
      }
    }
    await win.click('role=button[name="List"]');
    await win.reload();
    await until(() => win.locator('.topbar').count().then((n) => n === 1), 20000, 'reloaded');
    await win.click('role=tab[name="Localhost"]');
    await until(() => win.locator('.card').count().then((n) => n === 3), 15000, 'cards after reload');
    check('the chosen mode survives a reload', (await modeClass()).includes('list'));
    await win.click('role=button[name="Gallery"]');

    console.log('step: filter');
    await win.fill('input[aria-label="Filter apps"]', 'idl');
    await until(() => win.locator('.card').count().then((n) => n === 1), 5000, 'filtered to one');
    check('the filter narrows the cards', (await card('app_idle').count()) === 1);
    await win.fill('input[aria-label="Filter apps"]', 'zzqq');
    check('an unmatched filter says so', await until(() => win.locator('.empty-note').count().then((n) => n === 1), 5000, 'empty note'));
    await win.fill('input[aria-label="Filter apps"]', '');

    console.log('step: blocked port');
    foreign = h.holdPort(heldPort);
    await until(async () => (await stateOf('app_blocked')) === 'conflict', 30000, 'blocked card shows the conflict');
    check('a held port badges its card', (await card('app_blocked').locator('.badge').textContent()) === 'Port held');

    console.log('step: history');
    await win.click('role=button[name="History"]');
    await until(() => win.locator('.run').count().then((n) => n >= 1), 30000, 'a run in the timeline');
    check('History lists the shop run', (await win.locator('.run .name').allTextContents()).some((t) => /shop/i.test(t)));
    check('runs sit under a day heading', (await win.locator('.history-view .group-h').count()) >= 1);
    check('the run shows the page title', (await win.locator('.run').first().textContent()).includes('Shop demo'));
    await win.click('role=button[name="History"]');
    check('the History button toggles back to Home', await win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Home'));

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (foreign) foreign.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
