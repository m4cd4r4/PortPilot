// Landing-page crops of the v5 UI over the fictional demo apps: the Rows view with a crashed app, and the Alerts bell open on it.
// Run: npm run build:ui && node docs/demo/fictional/landing-shots.js [outDir]   (writes rows.png and alerts.png)
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const h = require(path.join(root, 'tests', 'e2e-harness'));
const { fs, until } = h;

const OUT = path.resolve(process.argv[2] || path.join(root, 'docs', 'screenshots', 'ui'));
const SITES = [
  { site: 'shop', name: 'Fernlane Goods', group: 'work' },
  { site: 'dashboard', name: 'Tidewatch', group: 'work' },
  { site: 'docs', name: 'Lumen Docs', group: 'work' },
  // Serves for a few seconds, then exits 1: the crash on the row and the bell.
  { site: 'blog', name: 'Quill & Ink', group: 'personal', crash: true },
  { site: 'portfolio', name: 'Marlowe Studio', group: 'personal' },
];
const world = h.makeWorld('pp-landing-');

async function main() {
  const ports = await h.freePorts(SITES.length);
  const apps = SITES.map((s, i) => ({
    id: `app_${s.site}`, name: s.name, group: s.group,
    command: `node ../../serve.js --site ${s.site} --port ${ports[i]}${s.crash ? ' --exit-after 6000' : ''}`,
    cwd: path.join(__dirname, 'sites', s.site), preferredPort: ports[i],
  }));
  world.writeConfig({ apps, groups: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }] });
  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  try {
    fs.mkdirSync(OUT, { recursive: true });
    await until(() => win.evaluate(() => !!document.querySelector('.home')), 20000, 'home');
    // An unfocused window can hang screenshots.
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
    await win.emulateMedia({ colorScheme: 'dark' });
    for (const a of apps.slice(0, 4)) await win.evaluate((x) => window.portpilot.process.start(x), a);
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Rows"]');
    await until(() => win.evaluate(() => document.querySelectorAll('.bell-count').length >= 1), 60000, 'crash counted');
    await until(() => win.evaluate(() => (document.querySelector('.main').innerText.match(/running/g) || []).length >= 3), 60000, 'three running');
    // Let the crash toast clear before the crops.
    await h.sleep(8000);
    const box = await win.evaluate(() => {
      const r = document.querySelector('.main').getBoundingClientRect();
      const last = [...document.querySelectorAll('.main *')].filter((e) => e.getBoundingClientRect().height > 0).reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      return { x: r.x, w: r.width, last };
    });
    await win.screenshot({ path: path.join(OUT, 'rows.png'), clip: { x: box.x, y: 100, width: box.w, height: box.last + 12 - 100 } });
    await win.locator('.alerts-side .bell').click();
    await h.sleep(400);
    await win.screenshot({ path: path.join(OUT, 'alerts.png'), clip: { x: 0, y: 700, width: 600, height: 200 } });
  } finally { await h.closeApp(app); }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
