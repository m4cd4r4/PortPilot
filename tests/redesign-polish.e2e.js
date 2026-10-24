/**
 * Real-Electron check of the big-library polish: Localhost caps stopped apps and offers "Show all";
 * Home remembers its last counts so a slow first read never shows dashes.
 * Run: npm run build:ui && node tests/redesign-polish.e2e.js
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-polish-');

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  process.env.PORTPILOT_NEW_UI = '1';
  const dir = world.mkdir('app');
  fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
  const apps = Array.from({ length: 15 }, (_, i) => ({ id: `app_${i}`, name: `app-${String(i).padStart(2, '0')}`, command: 'node server.js --port 1', cwd: dir }));
  world.writeConfig({ apps });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cards = () => win.locator('.cards .card').count();
  try {
    await until(() => win.evaluate(() => !!document.querySelector('.home .tile-sub')), 20000, 'home');
    await until(() => win.evaluate(() => document.querySelector('.home .tile-sub').textContent.startsWith('15')), 15000, 'counts load');
    check('Home counts the 15 apps', true);
    check('the last counts are remembered', (await win.evaluate(() => JSON.parse(localStorage.getItem('portpilot-home-tally') || '{}').apps)) === 15);
    await win.reload();
    await win.waitForSelector('.home');
    const first = await win.evaluate(() => ({ cls: document.querySelector('.home').className, sub: document.querySelector('.home .tile-sub').textContent }));
    check('after a reload the tile shows no dashes while it reads', !first.sub.includes('-'), JSON.stringify(first));

    await win.click('role=tab[name="Localhost"]');
    await until(async () => (await cards()) > 0, 10000, 'cards');
    check('only 12 of 15 stopped apps show at first', (await cards()) === 12, String(await cards()));
    check('a Show all button names the total', (await win.locator('role=button[name="Show all 15 stopped apps"]').count()) === 1);
    await win.click('role=button[name="Show all 15 stopped apps"]');
    check('Show all reveals every stopped app', (await cards()) === 15);

    await win.reload();
    await win.click('role=tab[name="Localhost"]');
    await until(async () => (await cards()) > 0, 10000, 'cards again');
    await win.fill('input[aria-label="Filter apps"]', 'app-1');
    await until(async () => (await cards()) === 5, 5000, 'filter result');
    check('a filter always shows every match', (await win.locator('role=button[name^="Show all"]').count()) === 0);

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
