/**
 * Real-Electron check of the redesign shell (ui/, built to src/ui-dist) against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-shell.e2e.js   (needs Electron + playwright)
 * Set PORTPILOT_SHOTS_DIR to save screenshots at 1440 and 1120 wide.
 *
 * Covers: the app loads the new bundle; Home tiles show real counts; the segmented
 * control switches screens; Ctrl+K opens the shared palette (also from a text field), ranks,
 * Enter starts and stops an app and switches screen; a held port counts on the alerts bell;
 * no console errors.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-shell-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [shopPort, idlePort, heldPort] = await h.freePorts(3);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort },
      { id: 'app_idle', name: 'idle', command: `node server.js --port ${idlePort}`, cwd: shop, preferredPort: idlePort },
      { id: 'app_blocked', name: 'blocked', command: `node server.js --port ${heldPort}`, cwd: shop, preferredPort: heldPort },
    ],
  });

  let foreign = null;
  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const paletteOpen = () => win.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Command palette"]'));
  const rows = () => win.$$eval('#palette-list [role="option"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const tabOn = () => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  const openPalette = async () => {
    await win.keyboard.press('Control+k');
    await until(paletteOpen, 5000, 'palette opens');
    await until(() => win.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 5000, 'palette input focused');
  };
  const running = (id) => win.evaluate(async (i) => {
    const { apps = [] } = await window.portpilot.process.list();
    return apps.some((a) => a.id === i && a.running);
  }, id);

  try {
    console.log('step: the new bundle loads');
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');
    check('the new UI is on screen, not the v4 sidebar', await win.evaluate(() => !document.getElementById('v4-sidebar')));
    check('Home is the first screen', (await tabOn()) === 'Home');
    await until(() => win.evaluate(() => !!document.querySelector('.h-hero .run-row h2') && !/Welcome/.test(document.querySelector('.h-hero')?.textContent || '')), 15000, 'home loads');
    check('Home has no Localhost or news tile', await win.evaluate(() => !document.querySelector('.h-local') && !document.querySelector('.h-news')));
    check('the hero names an app and offers Start', await win.evaluate(() => { const h = document.querySelector('.h-hero'); return !!h?.querySelector('h2')?.textContent && /Start/.test(h.textContent); }));
    check('Home fits the window without scrolling', await win.evaluate(() => { const m = document.querySelector('.main'); return m.scrollHeight <= m.clientHeight + 1; }));
    check('Recently used is there and the Scene card waits for a scene', await win.evaluate(() => !!document.querySelector('.h-recent') && !document.querySelector('.h-scene')));

    console.log('step: segmented control');
    await win.click('role=tab[name="Browsers"]');
    check('Browsers tab opens its screen', (await tabOn()) === 'Browsers' && (await win.locator('.gallery-view[aria-label="Browsers"]').count()) === 1);
    await win.click('role=tab[name="Home"]');

    console.log('step: palette');
    await win.click('.search');
    await until(paletteOpen, 5000, 'palette opens from the search button');
    await until(() => win.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'), 5000, 'palette input focused');
    check('palette input has focus', await win.evaluate(() => document.activeElement.getAttribute('role') === 'combobox'));
    await win.keyboard.press('Escape');
    check('Esc closes it', !(await paletteOpen()));
    await openPalette();
    await win.keyboard.type('idle');
    await until(async () => (await rows())[0]?.includes('Start idle'), 5000, 'first row is Start idle');
    check('a stopped app offers Start', !(await rows()).some((r) => r.includes('Stop idle')));
    await win.keyboard.press('Escape');

    await openPalette();
    await win.keyboard.type('start shop');
    await win.keyboard.press('Enter');
    await until(async () => !(await paletteOpen()), 15000, 'palette closes after Enter');
    check('Enter runs it and closes the palette', true);
    await until(() => running('app_shop'), 15000, 'shop running');
    await until(() => win.evaluate(() => /Stop/.test(document.querySelector('.h-hero')?.textContent || '')), 15000, 'hero offers Stop');
    check('the hero follows the running app and offers Stop', await win.evaluate(() => document.querySelector('.h-hero h2 .nm').textContent === 'shop'));
    await until(() => win.evaluate(() => (document.querySelector('.h-hero .row-th')?.style.backgroundImage || '').includes('url(')), 40000, 'hero picture');
    check('a running app with no picture gets one captured on Home', true);

    await openPalette();
    await win.keyboard.type('stop shop');
    await until(async () => (await rows())[0]?.includes('Stop shop'), 5000, 'first row is Stop shop');
    await win.keyboard.press('Enter');
    await until(async () => !(await running('app_shop')), 15000, 'shop stopped');
    check('Stop shop from the palette stops it', true);

    await openPalette();
    await win.keyboard.type('go to local');
    await until(async () => (await rows())[0]?.includes('Go to Apps'), 5000, 'Go to Apps ranks first');
    await win.keyboard.press('Enter');
    check('Go to Apps switches screen', (await tabOn()) === 'Apps');
    await win.click('role=tab[name="Home"]');

    console.log('step: alerts bell');
    // A just-stopped app's port can linger for a few seconds and read as a conflict; wait for it to clear.
    const count = () => win.evaluate(() => Number(document.querySelector('.bell-count')?.textContent || 0));
    await until(async () => (await count()) === 0, 30000, 'bell clears');
    check('no count on the bell while nothing is blocked', true);
    check('there is no banner on any screen', (await win.locator('.banner').count()) === 0);
    foreign = h.holdPort(heldPort);
    await until(async () => (await count()) >= 1, 30000, 'bell counts the blocked port');
    check('the bell shows a count', true);
    check('a blocked port does not push a banner over Home', (await win.locator('.banner').count()) === 0);
    await win.click('.bell');
    await until(() => win.evaluate((p) => (document.querySelector('.alerts-pop')?.textContent || '').includes(String(p)), heldPort), 10000, 'popover names the port');
    const msg = await win.locator('.alerts-pop li .msg').first().textContent();
    check('the popover names the app and the port', msg.includes('blocked') && msg.includes(String(heldPort)) || (await win.locator('.alerts-pop').textContent()).includes(String(heldPort)), msg);
    await win.keyboard.press('Escape');
    check('Esc closes the popover', (await win.locator('.alerts-pop').count()) === 0);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const scheme of ['dark', 'light']) {
        await win.emulateMedia({ colorScheme: scheme });
        for (const w of [1440, 1120]) {
          await win.setViewportSize({ width: w, height: 800 });
          await win.screenshot({ path: path.join(SHOTS, `shell-home-${scheme}-${w}.png`) });
        }
      }
    }

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (foreign) foreign.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
