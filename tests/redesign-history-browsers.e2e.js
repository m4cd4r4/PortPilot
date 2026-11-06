/**
 * Real-Electron check of the History screen's Browsers view (ui/, src/ui-dist),
 * with REAL headless Brave for Open again, against a THROWAWAY config.
 * Run: npm run build:ui && node tests/redesign-history-browsers.e2e.js   (skips without Brave)
 * Set PORTPILOT_SHOTS_DIR to save screenshots at 1440 and 390 wide.
 *
 * Covers: the Apps | Browsers switch and that it is remembered; sessions from every profile,
 * newest first, grouped by day; who started it, tab count, how it ended, tab titles;
 * the filter (profile, tab title, address); Open again starts the profile and opens the saved
 * tabs (read back from Brave's own debug port) and says so; a session with no tabs cannot be reopened.
 */
const http = require('http');
const h = require('./e2e-harness');
const { historyPathFor } = require('../src/core/browserHistory');
const { fs, path, until } = h;

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP redesign-history-browsers: Brave is not installed'); process.exit(0); }

const { check, finish } = h.checker();
const world = h.makeWorld('pp-rhb-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
const isUp = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [pShop, pBlog, pSite] = await h.freePorts(3);
  // A tiny site for the saved tabs, so Open again has real pages to load.
  const site = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>Page ${req.url}</title><h1>${req.url}</h1>`); });
  await new Promise((r) => site.listen(pSite, '127.0.0.1', r));
  const base = `http://127.0.0.1:${pSite}`;

  world.writeConfig({
    browserProfiles: [
      { name: 'shop', port: pShop, browser: 'brave', mode: 'headless', url: 'about:blank' },
      { name: 'blog', port: pBlog, browser: 'brave', mode: 'headless', url: 'about:blank' },
    ],
  });
  const day = 24 * 3600 * 1000;
  const iso = (ms) => new Date(ms).toISOString();
  const now = Date.now();
  const runs = [
    { id: 'b_old_shop', profile: 'shop', port: pShop, browser: 'brave', mode: 'headless', startedBy: { kind: 'human', surface: 'desktop' },
      startedAt: iso(now - 2 * day), stoppedAt: iso(now - 2 * day + 3600000), endedBy: { kind: 'external', reason: 'closed' },
      tabs: [{ url: `${base}/orders`, title: 'Shop orders' }] },
    { id: 'b_new_blog', profile: 'blog', port: pBlog, browser: 'brave', mode: 'headless', startedBy: { kind: 'agent', surface: 'mcp', sessionId: 'abcd-1234' },
      startedAt: iso(now - 7200000), stoppedAt: iso(now - 3600000), endedBy: { kind: 'human', surface: 'desktop' },
      tabs: [{ url: `${base}/drafts`, title: 'Blog drafts' }, { url: `${base}/stats`, title: '' }] },
    { id: 'b_empty_shop', profile: 'shop', port: pShop, browser: 'brave', mode: 'headless', startedBy: { kind: 'human' },
      startedAt: iso(now - 5400000), stoppedAt: iso(now - 5000000), endedBy: { kind: 'external', reason: 'unknown' }, tabs: [] },
  ];
  const hp = historyPathFor(world.configPath);
  fs.mkdirSync(path.dirname(hp), { recursive: true });
  fs.writeFileSync(hp, JSON.stringify({ runs }));

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const row = (id) => win.locator(`li[data-session="${id}"]`);
  const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');

  try {
    console.log('step: switch to Browsers');
    await until(() => win.evaluate(() => !!document.querySelector('.topbar')), 20000, 'new top bar');
    await win.click('role=tab[name="History"]');
    await win.waitForSelector('.history-view');
    check('Apps is the default', (await win.getByRole('button', { name: 'Apps', exact: true }).getAttribute('aria-pressed')) === 'true');
    await win.getByRole('button', { name: 'Browsers', exact: true }).click();
    await until(() => win.locator('li[data-session]').count().then((n) => n === 3), 15000, 'three sessions');
    check('every profile\'s sessions are listed', true);
    const order = await win.locator('li[data-session]').evaluateAll((els) => els.map((e) => e.getAttribute('data-session')));
    check('newest first', order.join(',') === 'b_empty_shop,b_new_blog,b_old_shop', order.join(','));
    const heads = await win.locator('.group-h').allTextContents();
    check('grouped by day', heads.length === 2, heads.join(' | '));

    console.log('step: what each row says');
    const blogSub = await row('b_new_blog').locator('.sub').first().textContent();
    check('started by an agent reads its session tag', blogSub.includes('started by claude abcd'), blogSub);
    check('tab count and how it ended', blogSub.includes('2 tabs') && blogSub.includes('stopped by you'), blogSub);
    const tabs = await row('b_new_blog').locator('.tabs-line').textContent();
    check('tab titles, address when untitled', tabs.includes('Blog drafts') && tabs.includes(`127.0.0.1:${pSite}/stats`), tabs);
    check('the tab line lists the addresses on hover', (await row('b_new_blog').locator('.tabs-line').getAttribute('title')).includes(`${base}/drafts`));
    check('closed outside PortPilot', (await row('b_old_shop').locator('.sub').first().textContent()).includes('closed outside PortPilot'));
    check('a session with no tabs cannot be reopened', await row('b_empty_shop').getByRole('button', { name: 'Open again' }).isDisabled());
    check('the profile letter tile', (await row('b_new_blog').locator('.letter').textContent()) === 'B');

    console.log('step: filter');
    const filter = 'input[aria-label="Filter browser sessions"]';
    await win.fill(filter, 'orders');
    await until(() => win.locator('li[data-session]').count().then((n) => n === 1), 5000, 'filtered by address');
    check('the filter reads tab addresses', (await row('b_old_shop').count()) === 1);
    await win.fill(filter, 'blog drafts');
    await until(() => win.locator('li[data-session]').count().then((n) => n === 1), 5000, 'filtered by title');
    check('the filter reads tab titles', (await row('b_new_blog').count()) === 1);
    await win.fill(filter, 'shop');
    await until(() => win.locator('li[data-session]').count().then((n) => n === 2), 5000, 'filtered by profile');
    check('the filter reads profile names', true);
    await win.fill(filter, 'zzqq');
    check('an unmatched filter says so', await until(() => win.locator('.empty-note').count().then((n) => n === 1), 5000, 'empty note'));
    await win.fill(filter, '');
    await until(() => win.locator('li[data-session]').count().then((n) => n === 3), 5000, 'filter cleared');
    await win.locator(filter).blur(); // a stray key from the desktop must not land in the filter

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const w of [1440, 390]) {
        await win.setViewportSize({ width: w, height: 900 });
        await h.sleep(400);
        await win.screenshot({ path: path.join(SHOTS, `history-browsers-${w}.png`) });
      }
      await win.setViewportSize({ width: 1440, height: 900 });
    }

    console.log('step: Open again with real Brave');
    await row('b_new_blog').getByRole('button', { name: 'Open again' }).click();
    await until(() => win.locator('.tile-notice.info').count().then((n) => n === 1), 60000, 'reopen notice');
    const said = await win.locator('.tile-notice.info span').textContent();
    check('Open again says what it did', said.startsWith('Opened 2 tabs in blog'), said);
    check('the profile is running', await isUp(pBlog));
    const urls = (await pages(pBlog)).map((t) => t.url);
    check('the saved tabs are open in that profile', urls.includes(`${base}/drafts`) && urls.includes(`${base}/stats`), urls.join(' '));
    await until(() => win.locator('li[data-session] .stat.running').count().then((n) => n === 1), 20000, 'new open session row');
    check('the new session shows as open', true);
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'history-browsers-reopened-1440.png') });

    console.log('step: the choice is remembered');
    await win.click('role=tab[name="Ports"]');
    await win.click('role=tab[name="History"]');
    await win.waitForSelector('.history-view');
    check('Browsers stays picked', (await win.getByRole('button', { name: 'Browsers', exact: true }).getAttribute('aria-pressed')) === 'true');
    await win.getByRole('button', { name: 'Apps', exact: true }).click();
    check('Apps switches back', await until(() => win.locator('input[aria-label="Filter runs"]').count().then((n) => n === 1), 5000, 'apps filter'));

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    const w = app.windows()[0];
    if (w) await w.evaluate(async () => { try { await window.portpilot.browsers.stop('blog'); } catch { /* not running */ } }).catch(() => {});
    await h.sleep(3000);
    await h.closeApp(app);
    site.close();
    for (const p of [pShop, pBlog]) if (await isUp(p)) { console.log(`LEAK a browser is still up on :${p}`); await h.closeBrowserOn(p); }
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
