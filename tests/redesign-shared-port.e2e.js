/**
 * Real-Electron check of two apps that share a folder and a port (F138).
 * Run: npm run build:ui && node tests/redesign-shared-port.e2e.js
 *
 * The listener's command line names the folder, so it fits both apps. The one PortPilot started
 * must read running; the other, first in the config, must stay stopped.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-shared-');

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [port] = await h.freePorts(1);
  const dir = world.mkdir('site');
  const script = path.join(dir, 'server.js');
  fs.writeFileSync(script, h.SERVER);
  const mk = (id, name) => ({ id, name, command: `node "${script}" --portpilot-test --port ${port}`, cwd: dir, preferredPort: port });
  // "first" comes first in the config and is never started.
  world.writeConfig({ apps: [mk('app_first', 'first'), mk('app_second', 'second')] });

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const card = (id) => win.locator(`.card[data-app="${id}"]`);
  const stateOf = (id) => card(id).getAttribute('data-state');
  const settled = async (id, want) => until(async () => (await stateOf(id)) === want, 30000, `${id} ${want}`).then(() => true, () => false);
  try {
    await win.click('role=tab[name="Apps"]');
    await until(async () => (await win.locator('.card[data-app]').count()) === 2, 20000, 'two cards');
    await card('app_second').hover();
    await card('app_second').getByRole('button', { name: 'Start', exact: true }).click();
    check('the app that was started reads running', await settled('app_second', 'running'), await stateOf('app_second'));
    await h.sleep(6000); // a full poll, so both cards show what the scan says
    check('and still does a poll later', (await stateOf('app_second')) === 'running', await stateOf('app_second'));
    check('the app that shares its folder and port stays stopped', (await stateOf('app_first')) === 'stopped', await stateOf('app_first'));
    const scan = await win.evaluate(() => window.portpilot.ports.scanWithApps());
    check('the scan credits the port to the app that was started', scan.matches.app_second?.port === port && !scan.matches.app_first, JSON.stringify(Object.keys(scan.matches)));

    await win.click('role=tab[name="Home"]');
    await until(() => win.evaluate(() => document.querySelector('.home')?.getAttribute('aria-busy') === 'false'), 20000, 'home loaded');
    const names = await win.$$eval('.h-hero .run-row .nm', (els) => els.map((e) => e.textContent));
    check('Home lists the started app under Running, and only it', names.length === 1 && names[0] === 'second', names.join(' | '));

    await win.click('role=tab[name="Apps"]');
    await card('app_second').hover();
    await card('app_second').getByRole('button', { name: 'Stop', exact: true }).click();
    check('Stop on its card stops it', await settled('app_second', 'stopped'), await stateOf('app_second'));
    check('no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
