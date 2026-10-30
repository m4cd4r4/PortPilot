// Landing-page crops of the v5 UI over the fictional demo apps: the Rows view with a blocked port, and the Alerts bell open.
// Run: npm run build:ui && node docs/demo/fictional/landing-shots.js [outDir]   (writes rows.png and alerts.png)
const path = require('path');
const net = require('net');
const root = path.resolve(__dirname, '..', '..', '..');
const h = require(path.join(root, 'tests', 'e2e-harness'));
const { fs, until } = h;

const OUT = path.resolve(process.argv[2] || path.join(root, 'docs', 'screenshots', 'ui'));
const SITES = [
  { site: 'shop', name: 'Fernlane Goods', group: 'work' },
  { site: 'dashboard', name: 'Tidewatch', group: 'work' },
  { site: 'docs', name: 'Lumen Docs', group: 'work' },
  { site: 'blog', name: 'Quill & Ink', group: 'personal' },
  { site: 'portfolio', name: 'Marlowe Studio', group: 'personal' },
];
const world = h.makeWorld('pp-landing-');

async function main() {
  const ports = await h.freePorts(SITES.length);
  const apps = SITES.map((s, i) => ({
    id: `app_${s.site}`, name: s.name, group: s.group, command: `node ../../serve.js --site ${s.site} --port ${ports[i]}`,
    cwd: path.join(__dirname, 'sites', s.site), preferredPort: ports[i],
  }));
  world.writeConfig({ apps, groups: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }] });
  // Quill & Ink's port is taken by something else.
  const blocker = net.createServer().listen(ports[3], '127.0.0.1');
  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  try {
    fs.mkdirSync(OUT, { recursive: true });
    await until(() => win.evaluate(() => !!document.querySelector('.home')), 20000, 'home');
    // An unfocused window can hang screenshots.
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
    await win.emulateMedia({ colorScheme: 'dark' });
    for (const a of apps.slice(0, 3)) await win.evaluate((x) => window.portpilot.process.start(x), a);
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Rows"]');
    await until(() => win.evaluate(() => document.querySelectorAll('.bell-count').length >= 1), 30000, 'blocked port counted');
    await until(() => win.evaluate(() => (document.querySelector('.main').innerText.match(/running/g) || []).length >= 3), 60000, 'three running');
    await h.sleep(1500);
    const box = await win.evaluate(() => {
      const rows = [...document.querySelectorAll('.main section, .main .group, .main ul')];
      const r = document.querySelector('.main').getBoundingClientRect();
      const last = [...document.querySelectorAll('.main *')].filter((e) => e.getBoundingClientRect().height > 0).reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      return { x: r.x, w: r.width, last, n: rows.length };
    });
    await win.screenshot({ path: path.join(OUT, 'rows.png'), clip: { x: box.x, y: 100, width: box.w, height: box.last + 12 - 100 } });
    await win.locator('.alerts-side .bell').click();
    await h.sleep(400);
    await win.screenshot({ path: path.join(OUT, 'alerts.png'), clip: { x: 0, y: 700, width: 600, height: 200 } });
  } finally { blocker.close(); await h.closeApp(app); }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
