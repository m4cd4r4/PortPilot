/**
 * Real-Electron check of the redesign's Wave 4 core (Library, Ports, Settings, app drawer, inspector)
 * against a THROWAWAY config. Run: npm run build:ui && node tests/redesign-wave4.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots at 1440 and 390 wide.
 *
 * Covers: Add app form saves cwd/command/port; edit renames; star; groups CRUD and Grouped mode;
 * Start/Stop from the Library; Details shows the app's output and a share URL; Ports lists a live
 * listener and Kill needs a second click; Settings writes the config, the theme persists, and the
 * classic switch is still there; no console errors.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-wave4-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

const LOUD = h.SERVER + "console.log('hello-from-shop');\n";

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  process.env.PORTPILOT_NEW_UI = '1';
  const [shopPort, newPort] = await h.freePorts(2);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), LOUD);
  world.writeConfig({
    apps: [{ id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort }],
  });
  const cfg = () => JSON.parse(fs.readFileSync(world.configPath, 'utf8'));

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const tabOn = () => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
  const rowNames = () => win.$$eval('table.library tbody .name', (els) => els.map((e) => e.textContent));
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const w of [1440, 390]) {
      await win.setViewportSize({ width: w, height: 800 });
      await win.screenshot({ path: path.join(SHOTS, `wave4-${name}-${w}.png`) });
    }
    await win.setViewportSize({ width: 1440, height: 900 });
  };

  try {
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');

    console.log('step: library lists and adds');
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Manage"]');
    await win.waitForSelector('table.library');
    check('Manage opens from Apps', await win.evaluate(() => !!document.querySelector('[aria-label="Manage apps"]')));
    await until(async () => (await rowNames()).includes('shop'), 10000, 'shop listed');
    await win.click('role=button[name="Add app"]');
    await win.fill('input[placeholder="My app"]', 'second');
    await win.fill('input[placeholder="npm run dev"]', `node server.js --port ${newPort}`);
    await win.fill('input[placeholder="I:/Scratch/my-app"]', shop);
    await win.fill('input[placeholder="3000"]', String(newPort));
    await win.click('role=button[name="Add"]');
    await until(async () => (await rowNames()).includes('second'), 10000, 'second listed');
    const saved = cfg().apps.find((a) => a.name === 'second');
    check('the form saved command, folder and port', !!saved && saved.cwd === shop && saved.preferredPort === newPort && saved.command.includes(String(newPort)), JSON.stringify(saved));

    console.log('step: edit, star, group');
    await win.click('tr[data-app="' + saved.id + '"] >> role=button[name="Edit"]');
    await win.fill('input[placeholder="My app"]', 'second-renamed');
    await win.click('role=button[name="Save"]');
    await until(async () => (await rowNames()).includes('second-renamed'), 10000, 'renamed');
    check('Edit renames the app and keeps its id', cfg().apps.some((a) => a.id === saved.id && a.name === 'second-renamed'));
    await win.click('tr[data-app="' + saved.id + '"] >> role=button[name="Star"]');
    await until(() => cfg().apps.find((a) => a.id === saved.id).isFavorite === true, 10000, 'starred');
    check('Star writes isFavorite', true);

    await win.click('role=button[name="Groups"]');
    await win.fill('input[aria-label="New group name"]', 'Work');
    await win.click('role=button[name="Add group"]');
    await until(() => (cfg().groups || []).some((g) => g.name === 'Work'), 10000, 'group saved');
    check('a group can be created', true);
    const gid = cfg().groups.find((g) => g.name === 'Work').id;
    await win.click('tr[data-app="' + saved.id + '"] >> role=button[name="Edit"]');
    await win.selectOption('.drawer select', gid);
    await win.click('role=button[name="Save"]');
    await until(() => cfg().apps.find((a) => a.id === saved.id).group === gid, 10000, 'group assigned');
    check('the form assigns an app to the group', true);
    await shot('library');

    console.log('step: grouped Localhost uses the stored group field');
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Grouped"]');
    await until(() => win.evaluate(() => [...document.querySelectorAll('.group-h')].some((e) => e.textContent.startsWith('Work'))), 10000, 'Work heading');
    check('Grouped mode shows the Work group', true);
    await win.click('role=button[name="Gallery"]');

    console.log('step: start, details, ports');
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Manage"]');
    await win.click('tr[data-app="app_shop"] >> role=button[name="Start"]');
    await until(() => win.evaluate(async () => (await window.portpilot.process.list()).apps.some((a) => a.id === 'app_shop' && a.running)), 15000, 'shop running');
    await win.click('tr[data-app="app_shop"] >> role=button[name="Details"]');
    await until(() => win.evaluate(() => (document.querySelector('pre.log')?.textContent || '').includes('hello-from-shop')), 15000, 'log shows the app output');
    check('Details shows the output of a running app', true);
    await win.click('role=tab[name="Share"]');
    await until(() => win.evaluate(() => !!document.querySelector('.share-url code')), 10000, 'share url');
    check('Share shows the local URL', (await win.locator('.share-url code').first().textContent()) === `http://localhost:${shopPort}`);
    await win.keyboard.press('Escape');
    await until(async () => (await win.locator('.drawer').count()) === 0, 5000, 'drawer closes');

    await win.click('role=tab[name="Ports"]');
    await until(() => win.evaluate((p) => !!document.querySelector(`table.ports tr[data-port="${p}"]`), shopPort), 15000, 'port row');
    check('Ports lists the live listener with its PortPilot app', (await win.locator(`tr[data-port="${shopPort}"]`).textContent()).includes('shop'));
    await shot('ports');
    await win.click(`tr[data-port="${shopPort}"] >> role=button[name="Kill"]`);
    check('Kill asks for a second click', await win.locator(`tr[data-port="${shopPort}"] >> role=button[name="Confirm kill"]`).count() === 1);
    check('nothing was killed by the first click', (await fetch(`http://127.0.0.1:${shopPort}`).then((r) => r.ok, () => false)));
    await win.click(`tr[data-port="${shopPort}"] >> role=button[name="Confirm kill"]`);
    await until(async () => (await win.locator(`tr[data-port="${shopPort}"]`).count()) === 0, 20000, 'port row gone');
    check('the second click frees the port', true);

    console.log('step: delete');
    await win.click('role=tab[name="Apps"]');
    await win.click('role=button[name="Manage"]');
    await win.click('tr[data-app="' + saved.id + '"] >> role=button[name="Edit"]');
    await win.click('role=button[name="Delete app"]');
    await win.click('role=button[name="Yes, delete"]');
    await until(() => !cfg().apps.some((a) => a.id === saved.id), 10000, 'deleted');
    check('Delete removes the app after a confirm', true);

    console.log('step: settings');
    await win.click('role=tab[name="Settings"]');
    await until(() => win.evaluate(() => !!document.querySelector('.settings-view .set-group')), 10000, 'settings screen');
    check('the Settings menu opens the Settings screen', true);
    await win.uncheck('label:has-text("Tell me when an app exits") input');
    await until(() => cfg().settings.notifyOnCrash === false, 10000, 'notifyOnCrash saved');
    check('a toggle writes the config', true);
    await win.fill('input[aria-label="Scan every (seconds)"]', '9');
    await win.keyboard.press('Enter');
    await until(() => cfg().settings.scanInterval === 9000, 10000, 'scanInterval saved');
    check('the scan interval is stored in milliseconds', true);
    await win.fill('input[aria-label="Scan every (seconds)"]', '9999');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(500);
    check('an out-of-range number is refused and reverts', cfg().settings.scanInterval === 9000 && (await win.inputValue('input[aria-label="Scan every (seconds)"]')) === '9');
    await win.click('role=button[name="Light"]');
    check('the theme applies at once', (await win.evaluate(() => document.documentElement.dataset.theme)) === 'light');
    check('and is remembered', (await win.evaluate(() => localStorage.getItem('portpilot-ui-theme'))) === 'light');
    await win.click('role=button[name="Top bar"]');
    check('Top bar moves the tabs to the top', (await win.evaluate(() => document.querySelector('.shell').dataset.nav)) === 'top');
    await win.click('role=button[name="Coral"]');
    check('an accent sets the hue and is remembered', (await win.evaluate(() => document.documentElement.style.getPropertyValue('--ah'))) === '18'
      && (await win.evaluate(() => JSON.parse(localStorage.getItem('portpilot-ui-prefs')).accent)) === 'coral');
    await win.click('role=button[name="Sidebar"]');
    check('the classic switch is still on this screen', (await win.locator('#main >> role=button[name="Switch to classic view"]').count()) === 1);
    await shot('settings');

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
