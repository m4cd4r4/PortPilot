/**
 * Real-Electron check of the redesign's Browsers screen and the classic/new switch (ui/, src/ui-dist),
 * with REAL headless Brave, against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-browsers.e2e.js   (skips without Brave)
 * Set PORTPILOT_SHOTS_DIR to save screenshots (each view mode at 1440 and 390 wide, dark and light).
 *
 * Covers: one card per profile with account chips, purpose and brand art (a seeded picture) or a
 * gradient and letter; Start from the card (real Brave) and its Signed out pill from real cookies;
 * a lease line with Release that keeps the browser running; a held port badges its card; the four
 * view modes and the filter; add, edit and remove through the drawer, accounts included; the
 * Settings menu switches to the classic UI and the classic header switches back.
 */
const h = require('./e2e-harness');
const configFile = require('../src/core/configFile');
const { claimsPathFor } = require('../src/core/browserApi');
const { fs, path, until } = h;

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP redesign-browsers: Brave is not installed'); process.exit(0); }

const { check, finish } = h.checker();
const world = h.makeWorld('pp-rbr-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
/** A solid-colour PNG of w x h: a stand-in for a site's touch icon (180 wide, so it is shown whole, not stretched). */
function solidPng(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_ICON = solidPng(180, 180, [244, 193, 93]);
const isUp = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [pShop, pBlog, pHeld, pNew] = await h.freePorts(4);
  process.env.PORTPILOT_NEW_UI = 'auto'; // neither 0 nor 1: the app picks, so this also proves new is the default
  world.writeConfig({
    browserProfiles: [
      { name: 'shop', port: pShop, browser: 'brave', mode: 'headless', url: 'about:blank', purpose: 'Shop admin', sites: ['shop.example.com'],
        accounts: [{ platform: 'Squarespace', username: 'owner@shop.example.com' }, { platform: 'Stripe', username: 'owner' }, { platform: 'Google', username: 'g' }, { platform: 'Meta', username: 'm' }] },
      { name: 'blog', port: pBlog, browser: 'brave', mode: 'headless', url: 'about:blank', purpose: 'Blog drafts', sites: ['example.com'] },
      { name: 'held', port: pHeld, browser: 'brave', mode: 'headless', url: 'about:blank' },
    ],
  });
  // A seeded picture for "shop": the screen must show it without any network.
  fs.mkdirSync(path.join(world.configDir, 'browser-art'), { recursive: true });
  fs.writeFileSync(path.join(world.configDir, 'browser-art', 'shop.png'), PNG_ICON);
  fs.writeFileSync(path.join(world.configDir, 'browser-art', 'shop.json'), JSON.stringify({ source: 'manual', ext: 'png', at: Date.now() }));

  let foreign = null;
  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const card = (name) => win.locator(`.bcard[data-profile="${name}"]`);
  const group = (name) => card(name).getAttribute('data-group');
  const modeClass = () => win.evaluate(() => document.querySelector('.cards')?.className || '');
  const tabOn = () => win.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);

  try {
    console.log('step: cards');
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');
    await win.click('role=tab[name="Browsers"]');
    await until(() => win.locator('.bcard').count().then((n) => n === 3), 15000, 'three cards');
    check('one card per profile', true);
    check('the gallery is the default mode', (await modeClass()).includes('gallery'));
    await until(() => card('shop').locator('.shot img').count().then((n) => n === 1), 15000, 'seeded picture on the shop card');
    const src = await card('shop').locator('.shot img').getAttribute('src');
    check('the seeded picture shows as a PNG data URL', /^data:image\/png;base64,/.test(src));
    check('a profile with no picture gets a letter tile', (await card('blog').locator('.letter').textContent()) === 'B');
    check('the purpose shows on the card', (await card('shop').locator('.purpose').textContent()) === 'Shop admin');
    const chips = await card('shop').locator('.chip').allTextContents();
    check('three account chips and a +1 for the rest', chips.length === 4 && chips[0] === 'Squarespace · owner@shop.example.com' && chips[3] === '+1', chips.join(' | '));
    check('stopped profiles sort under Stopped', (await group('shop')) === 'stopped');

    console.log('step: start real Brave from the card');
    await card('blog').hover();
    await card('blog').getByRole('button', { name: 'Start' }).click();
    await until(async () => (await group('blog')) === 'open', 60000, 'blog running');
    check('Start launches the browser and the card moves to Open', await isUp(pBlog));
    check('running profile sorts first', (await win.locator('.bcard').first().getAttribute('data-profile')) === 'blog');
    await until(() => card('blog').locator('.pill').count().then((n) => n === 1), 40000, 'sign-in pill');
    check('a running profile with no login cookie reads Signed out', (await card('blog').locator('.pill').textContent()) === 'Signed out');
    check('a stopped profile shows no sign-in pill', (await card('shop').locator('.pill').count()) === 0);

    console.log('step: set up sign-ins');
    const tabUrls = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).map((t) => t.url);
    check('a signed-out running profile offers sign-in setup', (await card('blog').locator('[data-signin-setup] button').count()) === 2);
    check('a stopped profile does not', (await card('shop').locator('[data-signin-setup]').count()) === 0);
    await card('blog').getByRole('button', { name: 'Brave Sync' }).click();
    // Brave reports its own pages on the chrome:// scheme.
    const isPage = (u, page) => u.startsWith(`brave://settings/${page}`) || u.startsWith(`chrome://settings/${page}`);
    await until(async () => (await tabUrls(pBlog)).some((u) => isPage(u, 'braveSync')), 15000, 'Sync page open in the profile');
    check('Brave Sync opens in that profile (read back from its own debug port)', true);
    await card('blog').getByRole('button', { name: 'Import passwords' }).click();
    await until(async () => (await tabUrls(pBlog)).some((u) => isPage(u, 'importData')), 15000, 'import page open in the profile');
    check('Import passwords opens Brave\'s own import page', true);

    console.log('step: lease and Release');
    const sid = 'abcd-1234-e2e';
    configFile.updateJson(claimsPathFor(world.configPath), (file) => {
      file.profiles.blog = { ...file.profiles.blog, by: 'claude abcd', surface: 'mcp', at: new Date(Date.now() - 180000).toISOString(), sessionId: sid };
    }, () => ({ profiles: {} }));
    const sessions = configFile.sessionsDirFor(world.configPath);
    fs.mkdirSync(sessions, { recursive: true });
    const beat = () => fs.writeFileSync(path.join(sessions, 'e2e.json'), JSON.stringify({ sessionId: sid, at: Date.now() }));
    beat();
    await until(async () => { beat(); return (await group('blog')) === 'inuse'; }, 30000, 'blog leased');
    const lease = await card('blog').locator('[data-lease]').textContent();
    check('the lease line names who holds it and for how long', /In use by claude abcd/.test(lease) && /3m/.test(lease), lease);
    await card('blog').getByRole('button', { name: 'Release' }).click();
    await until(async () => (await group('blog')) === 'open', 30000, 'blog released');
    check('Release ends the lease', (await card('blog').locator('[data-lease]').count()) === 0);
    check('and the browser keeps running', await isUp(pBlog));

    console.log('step: held port');
    foreign = h.holdPort(pHeld);
    await until(async () => (await group('held')) === 'blocked', 30000, 'held card blocked');
    check('a held port badges its card and disables Start', (await card('held').locator('.badge').textContent()) === 'Port held'
      && await card('held').getByRole('button', { name: 'Start' }).isDisabled());

    console.log('step: view modes and filter');
    for (const mode of ['compact', 'list', 'grouped', 'gallery']) {
      await win.click(`role=button[name="${mode[0].toUpperCase() + mode.slice(1)}"]`);
      await until(async () => (await modeClass()).includes(mode === 'grouped' ? 'gallery' : mode), 5000, `${mode} class`);
      check(`${mode} mode renders its cards`, (await win.locator('.bcard').count()) === 3);
      if (mode === 'grouped') {
        const heads = await win.locator('.group-h').allTextContents();
        check('grouped mode heads each state', heads.length === 3 && heads[0].startsWith('Open') && heads[1].startsWith('Port blocked') && heads[2].startsWith('Stopped'), heads.join(' | '));
      }
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const scheme of ['dark', 'light']) {
          await win.emulateMedia({ colorScheme: scheme });
          for (const w of [1440, 390]) {
            await win.setViewportSize({ width: w, height: 900 });
            await win.screenshot({ path: path.join(SHOTS, `browsers-${mode}-${scheme}-${w}.png`) });
          }
        }
        await win.emulateMedia({ colorScheme: 'dark' });
        await win.setViewportSize({ width: 1440, height: 900 });
      }
    }
    await win.fill('input[aria-label="Filter profiles"]', 'owner@shop');
    await until(() => win.locator('.bcard').count().then((n) => n === 1), 5000, 'filtered by account');
    check('the filter reads account usernames', (await card('shop').count()) === 1);
    await win.fill('input[aria-label="Filter profiles"]', 'zzqq');
    check('an unmatched filter says so', await until(() => win.locator('.empty-note').count().then((n) => n === 1), 5000, 'empty note'));
    await win.fill('input[aria-label="Filter profiles"]', '');
    await until(() => win.locator('.bcard').count().then((n) => n === 3), 5000, 'filter cleared');

    console.log('step: add, edit and remove through the drawer');
    await win.click('role=button[name="Add profile"]');
    await win.waitForSelector('.drawer');
    await win.fill('.drawer input[placeholder="upwork"]', 'newbie');
    await win.fill('.drawer input[inputmode="numeric"]', String(pNew));
    await win.fill('.drawer input[placeholder="Upwork job sweeps"]', 'Scratch work');
    await win.click('role=button[name="Add account"]');
    await win.fill('input[aria-label="Account 1 platform"]', 'Upwork');
    await win.fill('input[aria-label="Account 1 username"]', 'macdara');
    await win.click('.drawer button[type="submit"]');
    await until(() => card('newbie').count().then((n) => n === 1), 15000, 'new card');
    check('Add creates the profile with its account chip', (await card('newbie').locator('.chip').textContent()) === 'Upwork · macdara');
    const stored = JSON.parse(fs.readFileSync(world.configPath, 'utf8')).browserProfiles.find((p) => p.name === 'newbie');
    check('only labels are stored for an account', JSON.stringify(stored.accounts) === JSON.stringify([{ platform: 'Upwork', username: 'macdara' }]), JSON.stringify(stored.accounts));

    await card('newbie').getByRole('button', { name: 'Edit', exact: true }).click();
    await win.waitForSelector('.drawer');
    await win.fill('.drawer input[placeholder="Upwork job sweeps"]', 'Renamed purpose');
    await win.click('role=button[name="Remove account 1"]');
    await win.click('.drawer button[type="submit"]');
    await until(async () => (await card('newbie').locator('.purpose').textContent()) === 'Renamed purpose', 15000, 'edit saved');
    check('Edit saves and a removed account leaves no chip', (await card('newbie').locator('.chip').count()) === 0);

    await card('newbie').getByRole('button', { name: 'Edit', exact: true }).click();
    await win.waitForSelector('.drawer');
    await win.fill('.drawer input[inputmode="numeric"]', String(pBlog));
    await win.click('.drawer button[type="submit"]');
    await win.waitForSelector('.drawer .notice');
    check('a port another profile uses is refused with a reason', /already used/.test(await win.locator('.drawer .notice').textContent()));
    await win.keyboard.press('Escape');
    await until(() => win.locator('.drawer').count().then((n) => n === 0), 5000, 'Esc closes the drawer');

    await card('newbie').getByRole('button', { name: 'Edit', exact: true }).click();
    await win.waitForSelector('.drawer');
    await win.click('role=button[name="Remove profile"]');
    check('Remove asks first and says the folder stays', (await win.locator('.danger-row').textContent()).includes('stay on disk'));
    await win.click('role=button[name="Yes, remove"]');
    await until(() => card('newbie').count().then((n) => n === 0), 15000, 'removed');
    check('Remove takes the card away', (await win.locator('.bcard').count()) === 3);

    console.log('step: picture controls');
    await card('shop').getByRole('button', { name: 'Edit', exact: true }).click();
    await win.waitForSelector('.drawer');
    check('the drawer previews the current picture', (await win.locator('.art-prev img').count()) === 1);
    await win.click('role=button[name="Remove picture"]');
    await until(() => win.locator('.art-prev img').count().then((n) => n === 0), 10000, 'picture removed');
    check('Remove picture deletes the file', !fs.existsSync(path.join(world.configDir, 'browser-art', 'shop.png')));
    await win.keyboard.press('Escape');
    check('the card falls back to its letter tile', (await card('shop').locator('.letter').textContent()) === 'S');

    console.log('step: classic and new');
    await win.click('role=button[name="Settings"]');
    await win.click('role=menuitem[name="Switch to classic view"]');
    await until(() => win.evaluate(() => !!document.getElementById('btn-new-ui')), 20000, 'classic UI loads');
    check('Switch to classic view loads the v4 window', await win.evaluate(() => !document.querySelector('.topbar')));
    check('the choice is stored in settings', JSON.parse(fs.readFileSync(world.configPath, 'utf8')).settings.ui === 'classic');
    await win.click('#btn-new-ui');
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new UI loads again');
    check('Try new view in the classic header comes back to the new window', JSON.parse(fs.readFileSync(world.configPath, 'utf8')).settings.ui === 'new');

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    if (foreign) foreign.kill();
    const w = app.windows()[0];
    if (w) await w.evaluate(async () => { try { await window.portpilot.browsers.stop('blog'); } catch { /* not running */ } }).catch(() => {});
    await h.sleep(3000);
    await h.closeApp(app);
    for (const p of [pShop, pBlog, pHeld, pNew]) if (await isUp(p)) { console.log(`LEAK a browser is still up on :${p}`); await h.closeBrowserOn(p); }
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
