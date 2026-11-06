/**
 * Real-Electron check of the Rows name fix, the Tiles view and the logo-only sidebar, against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-tiles.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots (Rows, Tiles and Cards on Browsers and Apps, 1440 and 390 wide).
 *
 * Covers: no profile name is cut off in Browsers Rows (stopped and signed-in alike); Tiles shows more per
 * row than Cards and is smaller; the choice is remembered and shared by Apps; the sidebar shows the logo
 * with no wordmark but keeps its accessible name.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-tiles-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const ports = await h.freePorts(9);
  const names = ['reddit', 'squarespace-a', 'squarespace-solaisoft', 'whatsapp-web', 'youtube', 'microsoft', 'throwaway', 'github', 'squarespace-solaisoft-client-admin'];
  world.writeConfig({
    browserProfiles: names.map((name, i) => ({ name, port: ports[i], browser: 'brave', mode: 'headless', url: 'about:blank', purpose: `Purpose of ${name}` })),
    apps: Array.from({ length: 9 }, (_, i) => ({ id: `app-${i}`, name: `Demo app ${i}`, path: world.configDir, command: 'node -e 0', port: 4100 + i })),
  });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
  const gridClass = () => win.evaluate(() => document.querySelector('.cards')?.className || '');
  const perRow = (sel) => win.evaluate((s) => {
    const tops = [...document.querySelectorAll(s)].map((e) => Math.round(e.getBoundingClientRect().top));
    return tops.filter((t) => t === tops[0]).length;
  }, sel);
  // A name is cut when it is clipped (ellipsis) or spills past its own column into the facts beside it.
  const cut = () => win.evaluate(() => [...document.querySelectorAll('.bcard .name, .card[data-app] .name')].filter((e) => {
    const t = e.closest('.title');
    return e.scrollWidth > e.clientWidth + 1 || (t && e.getBoundingClientRect().right > t.getBoundingClientRect().right + 1);
  }).map((e) => e.textContent));
  const tab = (name) => win.click(`role=tab[name="${name}"]`).catch(() => win.click(`role=button[name="${name}"]`));

  try {
    await until(() => win.evaluate(() => !!document.querySelector('.topbar, .sidebar')), 20000, 'shell');
    const brand = await win.evaluate(() => {
      const b = document.querySelector('.sidebar .brand');
      return b ? { text: b.textContent.trim(), label: b.getAttribute('aria-label'), svg: !!b.querySelector('svg') } : null;
    });
    if (brand) check('the sidebar shows the logo with no wordmark and keeps its name for screen readers', brand.svg && brand.text === '' && brand.label === 'PortPilot', JSON.stringify(brand));

    await win.click('role=tab[name="Browsers"]').catch(() => win.click('role=button[name="Browsers"]'));
    await until(() => win.locator('.bcard').count().then((n) => n === names.length), 15000, 'every profile row');
    check('rows are the default view', (await gridClass()).includes('rows'));
    check('no profile name is cut off in Rows, the long one included', (await cut()).length === 0, (await cut()).join(', '));
    await shot('browsers-rows-1440');
    await tab('Apps');
    await until(() => win.locator('.card[data-app]').count().then((n) => n >= 1), 15000, 'app rows');
    check('no app name is cut off in Rows', (await cut()).length === 0, (await cut()).join(', '));
    await tab('Browsers');
    await until(() => win.locator('.bcard').count().then((n) => n === names.length), 15000, 'back on Browsers');

    await win.click('role=button[name="Tiles"]');
    await until(async () => (await gridClass()).includes('minis'), 10000, 'tiles grid');
    const tiles = await perRow('.bcard');
    check('Tiles fit five or more across at 1440', tiles >= 5, `per row ${tiles}`);
    const tileH = await win.evaluate(() => document.querySelector('.bcard').getBoundingClientRect().height);
    check('a tile is compact', tileH < 190, `height ${tileH}`);
    check('no profile name is cut off in Tiles', (await cut()).length === 0, (await cut()).join(', '));
    check('tiles hide the purpose line', (await win.locator('.bcard .purpose:visible').count()) === 0);
    await shot('browsers-tiles-1440');

    await win.click('role=button[name="Cards"]');
    await until(async () => (await gridClass()).includes('tiles'), 10000, 'cards grid');
    check('Cards stay larger, three or four across', (await perRow('.bcard')) <= 4);
    await shot('browsers-cards-1440');

    await win.click('role=button[name="Tiles"]');
    await win.click('role=tab[name="Apps"]').catch(() => win.click('role=button[name="Apps"]'));
    await until(() => win.locator('.card[data-app]').count().then((n) => n >= 9), 15000, 'app cards');
    check('Apps uses the same Tiles choice', (await gridClass()).includes('minis'));
    check('Apps tiles fit five or more across', (await perRow('.card[data-app]')) >= 5);
    await shot('apps-tiles-1440');

    await win.setViewportSize({ width: 390, height: 800 });
    await win.waitForTimeout(400);
    check('Tiles are two across at 390', (await perRow('.card[data-app]')) === 2);
    check('Tiles never overflow the window at 390', await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const top = await win.evaluate(() => { const b = document.querySelector('.topbar .brand'); return b ? { text: b.textContent.trim(), svg: !!b.querySelector('svg'), label: b.getAttribute('aria-label') } : null; });
    check('the narrow top bar shows the logo with no wordmark too', !!top && top.svg && top.text === '' && top.label === 'PortPilot', JSON.stringify(top));
    await shot('apps-tiles-390');

    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
    world.cleanup && world.cleanup();
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
