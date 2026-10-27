// README screenshots of the v5 UI over the fictional demo apps (docs/demo/fictional/sites).
// Run: npm run build:ui && node docs/demo/fictional/shots.js [outDir]
// Throwaway config and real Electron; every thumbnail is a real capture of a demo page.
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const h = require(path.join(root, 'tests', 'e2e-harness'));
const { fs, until } = h;

const OUT = path.resolve(process.argv[2] || path.join(root, 'docs', 'screenshots', 'ui'));
const SITES = [
  { site: 'shop', name: 'Fernlane Goods', group: 'work' },
  { site: 'blog', name: 'Quill & Ink', group: 'personal' },
  { site: 'dashboard', name: 'Tidewatch', group: 'work' },
  { site: 'docs', name: 'Lumen Docs', group: 'work' },
  { site: 'chat', name: 'Chatterbox', group: 'personal' },
  { site: 'portfolio', name: 'Marlowe Studio', group: 'personal' },
];
const PROFILES = [
  { name: 'Work', purpose: 'Client dashboards and admin', sites: ['tidewatch.example'], accounts: [{ platform: 'Google', username: 'work' }, { platform: 'Stripe', username: 'owner' }] },
  { name: 'Research', purpose: 'Docs, papers and reading lists', sites: ['lumen.example'], accounts: [{ platform: 'GitHub', username: 'reader' }] },
  { name: 'Social', purpose: 'Community and chat', sites: ['chatterbox.example'], accounts: [{ platform: 'Chatterbox', username: 'me' }] },
];
const ART = { Work: 'dashboard', Research: 'docs', Social: 'chat' };

const { check, finish } = h.checker();
const world = h.makeWorld('pp-fiction-');

async function main() {
  if (!fs.existsSync(path.join(root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  process.env.PORTPILOT_NEW_UI = '1';
  const ports = await h.freePorts(SITES.length + PROFILES.length);
  const serve = path.join(__dirname, 'serve.js');
  const apps = SITES.map((s, i) => ({
    id: `app_${s.site}`, name: s.name, group: s.group, command: `node "${serve}" --site ${s.site} --port ${ports[i]}`,
    // Own folder per app: PortPilot attributes a listener to an app by its folder, so a shared one mixes them up.
    cwd: path.join(__dirname, 'sites', s.site), preferredPort: ports[i],
  }));
  world.writeConfig({
    apps,
    groups: [{ id: 'work', name: 'Work' }, { id: 'personal', name: 'Personal' }],
    browserProfiles: PROFILES.map((p, i) => ({ ...p, port: ports[SITES.length + i], browser: 'brave', mode: 'headless', url: 'about:blank' })),
  });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const shot = async (name, scheme = 'dark') => {
    await win.emulateMedia({ colorScheme: scheme });
    await h.sleep(500);
    await win.screenshot({ path: path.join(OUT, `${name}${scheme === 'dark' ? '' : '-light'}.png`) });
  };
  try {
    fs.mkdirSync(OUT, { recursive: true });
    await until(() => win.evaluate(() => !!document.querySelector('.home')), 20000, 'home');

    // Each favicon becomes that profile's picture (the renderer can rasterise SVG; the art store wants PNG).
    for (const [profile, site] of Object.entries(ART)) {
      const svg = fs.readFileSync(path.join(__dirname, 'sites', site, 'icon.svg'), 'utf8');
      const b64 = await win.evaluate((s) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, 0, 0, 256, 256); resolve(c.toDataURL('image/png').split(',')[1]); };
        img.onerror = () => reject(new Error('svg did not load'));
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
      }), svg);
      const dir = path.join(world.configDir, 'browser-art');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${profile}.png`), Buffer.from(b64, 'base64'));
      fs.writeFileSync(path.join(dir, `${profile}.json`), JSON.stringify({ source: 'manual', ext: 'png', at: Date.now() }));
    }

    // History needs one finished run; the rest stay up for live thumbnails.
    const byId = (id) => apps.find((a) => a.id === id);
    await win.evaluate((x) => window.portpilot.process.start(x), byId('app_portfolio'));
    await h.sleep(2500);
    await win.evaluate((id) => window.portpilot.process.stop(id), 'app_portfolio');
    for (const a of apps.filter((x) => x.id !== 'app_portfolio')) await win.evaluate((x) => window.portpilot.process.start(x), a);

    const runningIds = () => win.evaluate(async () => (await window.portpilot.process.list()).apps.filter((a) => a.running).map((a) => a.id));
    check('the finished run stays stopped', !(await runningIds()).includes('app_portfolio'), (await runningIds()).join(','));
    await win.click('role=tab[name="Apps"]');
    await until(() => win.evaluate((n) => document.querySelectorAll('.card.running .shot img').length >= n, SITES.length - 1), 120000, 'live thumbnails');
    check('every running app shows a real capture', true);
    await h.sleep(1500);
    await shot('apps');
    await shot('apps', 'light');

    await win.click('role=tab[name="Home"]');
    await until(() => win.evaluate(() => document.querySelectorAll('.h-recent .th').length >= 3), 30000, 'home thumbnails');
    await h.sleep(1000);
    await shot('home');
    await shot('home', 'light');

    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Manage"]');
    await h.sleep(600);
    await shot('manage');

    await win.click('role=tab[name="Browsers"]');
    await until(() => win.locator('.bcard .shot img').count().then((n) => n === PROFILES.length), 20000, 'profile art');
    check('each profile card shows its picture', true);
    await shot('browsers');

    await win.click('role=button[name="More ▾"]');
    await win.click('role=menuitem[name="History"]');
    await h.sleep(1500);
    await shot('history');
    // No Ports shot: that screen lists every listener on the machine running this script (process names, PIDs).
  } finally {
    await h.closeApp(app);
  }
  finish();
}

// Electron can keep the process alive after close; the shots are on disk by now.
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
