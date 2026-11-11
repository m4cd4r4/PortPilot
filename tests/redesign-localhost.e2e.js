/**
 * Real-Electron check of the redesign's Localhost gallery and History screens (ui/, src/ui-dist)
 * against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-localhost.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots (each view mode at 1440 and 1120 wide, dark).
 *
 * Covers: one card per app; Start from the card; hover takes a live screenshot; a stopped app
 * keeps its last screenshot dimmed; the four view modes and their persistence; the filter;
 * a held port leaves a stopped card alone and is reported at Start; History lists the run with its page title and day heading.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-localhost-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [shopPort, idlePort, heldPort] = await h.freePorts(3);
  process.env.PORTPILOT_DETECT_ONLY_PORTS = [shopPort, idlePort, heldPort].join(',');
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    groups: [{ id: 'g_web', name: 'Web' }],
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --portpilot-test --port ${shopPort}`, cwd: shop, preferredPort: shopPort, groupId: 'g_web' },
      { id: 'app_idle', name: 'idle', command: `node server.js --portpilot-test --port ${idlePort}`, cwd: shop, preferredPort: idlePort },
      { id: 'app_blocked', name: 'blocked', command: `node server.js --portpilot-test --port ${heldPort}`, cwd: shop, preferredPort: heldPort },
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
    await win.click('role=tab[name="Apps"]');
    await until(() => win.locator('.card').count().then((n) => n === 3), 15000, 'three cards');
    check('one card per registered app', true);
    check('rows is the default view, with no inline screenshot', (await modeClass()).includes('rows') && (await win.locator('.shot').count()) === 0);
    await win.click('role=button[name="Cards"]');
    await until(async () => (await modeClass()).includes('tiles'), 5000, 'cards view');
    check('a stopped app with no screenshot drops the empty letter tile', (await card('app_idle').locator('.shot').count()) === 0);

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
    for (const mode of ['cards', 'rows']) {
      await win.click(`role=button[name="${mode[0].toUpperCase() + mode.slice(1)}"]`);
      await until(async () => (await modeClass()).includes(mode === 'cards' ? 'tiles' : mode), 5000, `${mode} class`);
      check(`${mode} mode renders its cards`, (await win.locator('.card').count()) === 3);
      if (mode === 'rows') {
        const heads = await win.locator('.group-h').allTextContents();
        check('grouped is on by default: a heading per group', heads.length === 2 && heads[0].startsWith('Web') && heads[1].startsWith('Other'), heads.join(' | '));
        await win.click('role=button[name="Grouped"]');
        await until(() => win.locator('.group-h').count().then((n) => n === 0 || n === 1), 5000, 'flat');
        await win.click('role=button[name="Grouped"]');
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
    await win.click('role=button[name="Cards"]');
    await win.reload();
    await until(() => win.locator('.topbar').count().then((n) => n === 1), 20000, 'reloaded');
    await win.click('role=tab[name="Apps"]');
    await until(() => win.locator('.card').count().then((n) => n === 3), 15000, 'cards after reload');
    check('the chosen mode survives a reload', (await modeClass()).includes('cards'));
    await win.click('role=button[name="Cards"]');

    console.log('step: filter');
    await win.fill('input[aria-label="Filter apps"]', 'idl');
    await until(() => win.locator('.card').count().then((n) => n === 1), 5000, 'filtered to one');
    check('the filter narrows the cards', (await card('app_idle').count()) === 1);
    await win.fill('input[aria-label="Filter apps"]', 'zzqq');
    check('an unmatched filter says so', await until(() => win.locator('.empty-note').count().then((n) => n === 1), 5000, 'empty note'));
    await win.fill('input[aria-label="Filter apps"]', '');

    console.log('step: blocked port');
    // A stopped app whose port someone else holds stays "stopped": no badge, no note, no jump up
    // the list. First prove the scan sees the holder, then give the 5 s refresh time to show it.
    foreign = h.holdPort(heldPort);
    await until(() => win.evaluate(async (p) => ((await window.portpilot.ports.scanWithApps()).unknownConflicts || []).some((c) => c.port === p), heldPort), 30000, 'the scan sees the held port');
    await h.sleep(6500);
    check('a held port leaves a stopped card stopped', (await stateOf('app_blocked')) === 'stopped', await stateOf('app_blocked'));
    const heldText = await card('app_blocked').textContent();
    check('with no badge or note about the port', (await card('app_blocked').locator('.badge').count()) === 0 && !/held/i.test(heldText), heldText);

    console.log('step: Start reports the taken port');
    await card('app_blocked').hover();
    await card('app_blocked').getByRole('button', { name: 'Start' }).click();
    const why = await win.locator('.tile-notice').textContent().catch(() => '');
    check('Start says why instead of starting', why.includes('blocked cannot start') && why.includes(`:${heldPort} is held by`), why);
    check('and the app was not started', (await stateOf('app_blocked')) === 'stopped');
    if (SHOTS) {
      for (const w of [1440, 390]) {
        await win.setViewportSize({ width: w, height: 800 });
        await win.screenshot({ path: path.join(SHOTS, `localhost-blocked-notice-${w}.png`) });
      }
      await win.setViewportSize({ width: 1440, height: 900 });
    }
    await win.click('.tile-notice >> role=button[name="Go to Ports"]');
    await until(() => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Ports'), 5000, 'Ports tab');
    check('Go to Ports opens the Ports screen', true);
    check('filtered to the taken port', (await win.inputValue('input[aria-label="Filter ports"]')) === String(heldPort)
      && (await win.locator('table.ports tbody tr').count()) === 1 && (await win.locator(`table.ports tr[data-port="${heldPort}"]`).count()) === 1);
    await win.click('role=tab[name="Apps"]');
    await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
    await card('app_shop').locator('.shot').click();
    await until(() => app.evaluate(() => global.__opened.length > 0), 30000, 'shop page opened');
    const opened = await app.evaluate(() => global.__opened[0]);
    check('a stopped picture starts the app and opens its page', opened === `http://localhost:${shopPort}`, opened);
    // The card catches up on the next poll.
    await until(async () => (await stateOf('app_shop')) === 'running', 30000, 'shop card running');
    await card('app_shop').hover();
    await card('app_shop').getByRole('button', { name: 'Stop' }).click();
    await until(async () => (await stateOf('app_shop')) === 'stopped', 30000, 'shop stopped again');

    console.log('step: history');
    await win.click('role=tab[name="History"]');
    await until(() => win.locator('.run').count().then((n) => n >= 1), 30000, 'a run in the timeline');
    check('History lists the shop run', (await win.locator('.run .name').allTextContents()).some((t) => /shop/i.test(t)));
    check('runs sit under a day heading', (await win.locator('.history-view .group-h').count()) >= 1);
    check('the run shows the page title', (await win.locator('.run').first().textContent()).includes('Shop demo'));
    // At a mid width the run's time used to run under the Open / Start again buttons. A live run is
    // needed so a button shows at all (an ended run with nothing to do has no buttons to collide with).
    await win.evaluate((a) => window.portpilot.process.start(a), { id: 'app_idle', name: 'idle', command: `node server.js --portpilot-test --port ${idlePort}`, cwd: shop, preferredPort: idlePort });
    await until(() => win.locator('.run .acts button').count().then((n) => n >= 1), 30000, 'a run with a button');
    const overlaps = () => win.evaluate(() => [...document.querySelectorAll('.run')].filter((r) => {
      const acts = r.querySelector('.acts')?.getBoundingClientRect();
      if (!acts || !acts.width) return false;
      // Only the visible part counts: text clipped by its own line (.sub overflow) is not under the buttons.
      return [...r.querySelectorAll('.meta *')].some((e) => {
        const b = e.getBoundingClientRect();
        const line = e.closest('.sub, .title')?.getBoundingClientRect() || b;
        const right = Math.min(b.right, line.right);
        return b.width && right > acts.left + 1 && b.left < acts.right;
      });
    }).length);
    for (const w of [1440, 1100, 900]) {
      await win.setViewportSize({ width: w, height: 800 });
      await win.waitForTimeout(250);
      check(`at ${w} wide no run text sits under its buttons`, (await overlaps()) === 0);
      if (process.env.PORTPILOT_SHOTS_DIR) await win.screenshot({ path: path.join(process.env.PORTPILOT_SHOTS_DIR, `history-${w}.png`) });
    }
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.click('role=tab[name="Home"]');
    check('the Home tab leaves History', await win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Home'));

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (foreign) foreign.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
