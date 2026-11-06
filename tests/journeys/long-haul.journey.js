/**
 * Journey C, the long haul: two weeks of use, compressed by moving timestamps between launches.
 * Run: npm run build:ui && node tests/journeys/long-haul.journey.js
 *
 * Day 1: shop starts and stops (on a git branch), blog crashes -> 6 days pass: the crash still shows
 * -> 8 more days pass and two weeks of history pile up (1,200 runs, 520 browser sessions): the crash
 * is history, History stays usable, its filter reaches back two weeks -> Start again a terminal
 * server from History: the first write prunes runs.json to its cap (pinned runs kept) -> Open again
 * a browser session in a throwaway Brave: browser-runs.json trims to its cap -> a scene is made,
 * started and stopped -> quit and relaunch: the scene is still there and still works.
 * Each screen is also checked at 390 px for sideways overflow.
 *
 * Outside checks only: runs.json, browser-runs.json, the config and runtime files, netstat, HTTP
 * answers, Brave's own /json, the rendered DOM. Caps are read from src/core, never hard-coded.
 */
const { journey, worldProcesses } = require('./kit');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const h = require('../e2e-harness');
const { DEFAULT_MAX_RUNS } = require('../../src/core/runHistory');
const { DEFAULT_MAX_ENTRIES } = require('../../src/core/browserHistory');
const { seedRuns, seedBrowserRuns, expectPrune, DAY } = require('./long-haul-seed');

const BRAVE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

(async () => {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  if (!fs.existsSync(BRAVE)) throw new Error(`Brave is not installed at ${BRAVE}`);
  const j = await journey('long-haul', { ports: 4 });
  const [shopPort, blogPort, apiPort, docsPort] = j.ports;
  // Outside the watcher's ports: the throwaway Brave's debug port and the site its tabs show.
  const [bravePort, sitePort] = await h.freePorts(2);
  const site = `http://127.0.0.1:${sitePort}`;
  const siteServer = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<title>Site ${q.url}</title><h1>${q.url}</h1>`); });
  await new Promise((r) => siteServer.listen(sitePort, '127.0.0.1', r));

  const dirs = { shop: j.project('shop'), blog: j.project('blog'), api: j.project('api'), docs: j.project('docs') };
  // shop is a git repo on a feature branch, so a real run records a branch.
  const git = (...a) => execFileSync('git', ['-c', 'user.name=journey', '-c', 'user.email=journey@localhost', ...a], { cwd: dirs.shop, stdio: 'ignore', windowsHide: true });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'first'); git('checkout', '-q', '-b', 'feature/cart');
  const apps = {
    shop: { id: 'app_shop', port: shopPort, cwd: dirs.shop, command: j.command(shopPort, { title: 'Shop' }) },
    blog: { id: 'app_blog', port: blogPort, cwd: dirs.blog, command: j.command(blogPort, { title: 'Blog', crashAfterMs: 2000, exitCode: 4 }) },
    api: { id: 'app_api', port: apiPort, cwd: dirs.api, command: j.command(apiPort, { title: 'Api' }) },
  };
  const docs = { cwd: dirs.docs, port: docsPort, startCommand: 'node server.js --portpilot-test --title Docs' };
  fs.writeFileSync(path.join(j.configDir, 'portpilot-config.json'), JSON.stringify({
    groups: [], settings: {},
    apps: Object.entries(apps).map(([name, a]) => ({ id: a.id, name, cwd: a.cwd, command: a.command, preferredPort: a.port })),
    browserProfiles: [{ name: 'preview', port: bravePort, browser: 'brave', mode: 'headless', url: 'about:blank' }],
  }, null, 2));

  const runsPath = path.join(j.configDir, 'history', 'runs.json');
  const browserPath = path.join(j.configDir, 'history', 'browser-runs.json');
  const browserRuns = () => { try { return JSON.parse(fs.readFileSync(browserPath, 'utf8')).runs || []; } catch { return []; } };
  const w = () => j.win;
  const rowNames = () => w().locator('li[data-run] .name').allTextContents();
  const runFilter = () => w().locator('input[aria-label="Filter runs"]');
  const lastTabs = [{ url: `${site}/orders`, title: 'Orders' }, { url: `${site}/stats`, title: 'Stats' }];
  const opened = [];
  let pinned = [];
  let scene = null;

  async function startCard(id, label = 'Start') {
    await j.card(id).hover();
    await j.card(id).getByRole('button', { name: label }).click();
  }
  /**
   * Checkpoint screenshots. A window covered by another (parallel journeys open theirs in the same
   * place) may stop painting, and the screenshot then times out (F18): raise it without focus first,
   * and retry once.
   */
  async function shot(name) {
    const raise = () => j.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((b) => b.isVisible() && b.moveTop())).catch(() => {});
    await raise();
    try { await j.shot(name); } catch (e) {
      j.note(`screenshot ${name} failed once (${e.message.split('\n')[0]}); raised the window and retried`);
      await raise();
      await j.shot(name);
    }
  }
  /** Settles a filter: the field holds the words and the list has re-rendered. */
  async function filterRuns(words) {
    await runFilter().fill(words);
    await j.blur();
    await h.sleep(400);
  }
  /** At 390 px nothing on the screen reaches past the right edge (F4 was this, on History). */
  async function narrow(what) {
    await w().setViewportSize({ width: 390, height: 844 });
    await h.sleep(400);
    const o = await w().evaluate(() => {
      const vw = window.innerWidth;
      const wide = [...document.querySelectorAll('main *, section *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; });
      return { scroll: document.documentElement.scrollWidth - vw, wide: wide.length, first: wide.slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${e.className}`).join(' ') };
    });
    j.check(`${what}: nothing runs off the side at 390 px`, o.scroll <= 0 && o.wide === 0, JSON.stringify(o));
    await w().setViewportSize({ width: 1440, height: 900 });
  }
  /** Start again opens the page in the default browser; in a journey that would be the developer's own. */
  async function captureOpenExternal() {
    await j.app.evaluate(({ ipcMain }) => {
      global.__opened = [];
      ipcMain.removeHandler('shell:openExternal');
      ipcMain.handle('shell:openExternal', (_, url) => { global.__opened.push(url); return { success: true }; });
    });
  }

  await j.run([
    ['day 1: shop runs on its branch, blog crashes', async () => {
      await j.launch();
      await j.tab('Apps');
      j.check('three apps on the screen', await j.waitFor(() => w().locator('.card[data-app]').count().then((n) => n === 3), 15000));
      await startCard(apps.shop.id);
      j.check('shop answers', (await j.waitFor(() => j.answers(shopPort), 30000))?.title === 'Shop');
      const run = await j.waitFor(() => j.runs().find((r) => r.appId === apps.shop.id && r.git), 15000);
      j.check('its run records the branch it ran on', run && run.git.branch === 'feature/cart', JSON.stringify(run && run.git));
      await startCard(apps.shop.id, 'Stop');
      j.check('shop stops: its port goes quiet', await j.portFree(shopPort, 15000));
      await startCard(apps.blog.id);
      j.check('blog answers, then its port goes quiet', (await j.waitFor(() => j.answers(blogPort), 15000)) && await j.portFree(blogPort, 15000));
      const crash = await j.waitFor(() => j.runs().find((r) => r.appId === apps.blog.id && r.endedBy === 'crash'), 15000);
      j.check('runs.json closes blog\'s run as a crash, exit 4', crash && crash.exitCode === 4, JSON.stringify(crash && { endedBy: crash.endedBy, exitCode: crash.exitCode }));
      j.check('the runtime file stamps the crash', j.runtime()[apps.blog.id]?.crashed?.exitCode === 4);
      j.check('the card says crashed', await j.waitFor(async () => (await j.stateOf(apps.blog.id)) === 'crashed', 15000));
      await shot('01-day-one');
      await j.quit();
      j.check('nothing listens after the quit', j.ports.every((p) => j.listeners(p).length === 0));
    }],

    ['6 days later: the crash still shows', async () => {
      const moved = j.ageHistory(6);
      j.check('the runs and the crash stamp moved 6 days back', moved >= 3, `${moved} records`);
      await j.launch();
      await j.tab('Apps');
      j.check('blog still reads crashed (a 6-day-old stamp)', await j.waitFor(async () => (await j.stateOf(apps.blog.id)) === 'crashed', 15000), await j.stateOf(apps.blog.id));
      j.check('and the bell counts it', await j.waitFor(async () => (await j.bellCount()) === '1', 10000), await j.bellCount());
      await j.tab('History');
      const head = await j.waitFor(() => w().locator('.group-h').first().textContent(), 15000);
      const day1 = new Date(Date.now() - 6 * DAY);
      const day1Label = `${day1.getDate()} ${day1.toLocaleString('en-GB', { month: 'long' })}`; // the header reads "Sunday 1 November" then the row count
      j.check('History files day 1 under the day 6 days ago', !!head && new RegExp(`\\b${day1Label}(?![a-z])`).test(head), `${head} (want ${day1Label})`);
      await shot('02-six-days-later');
      await j.quit();
    }],

    ['14 days in: two weeks of history pile up', async () => {
      j.ageHistory(8);
      const real = j.runs();
      // The person pinned day 1's shop run; two of the oldest seeded runs are pinned too.
      const seeded = seedRuns({ n: 1200, days: 14, apps, docs });
      seeded[0].pinned = true; seeded[5].pinned = true;
      real.find((r) => r.appId === apps.shop.id).pinned = true;
      const all = [...real, ...seeded];
      fs.writeFileSync(runsPath, JSON.stringify({ v: 1, runs: all }));
      pinned = all.filter((r) => r.pinned).map((r) => r.id);
      fs.writeFileSync(browserPath, JSON.stringify({ v: 1, runs: seedBrowserRuns({ n: DEFAULT_MAX_ENTRIES + 20, days: 14, profile: 'preview', port: bravePort, site, lastTabs }) }));
      j.check(`runs.json holds more than its cap (${DEFAULT_MAX_RUNS})`, j.runs().length > DEFAULT_MAX_RUNS, `${j.runs().length}`);
      j.check(`browser-runs.json holds more than its cap (${DEFAULT_MAX_ENTRIES})`, browserRuns().length > DEFAULT_MAX_ENTRIES, `${browserRuns().length}`);
      const oldest = Math.min(...j.runs().map((r) => Date.parse(r.startedAt)));
      j.check('the oldest run is two weeks old', Date.now() - oldest > 13.9 * DAY, new Date(oldest).toISOString());
    }],

    ['the next launch: the old crash is history, History copes with 1,200 runs', async () => {
      const before = j.runs().length;
      await j.launch();
      await j.tab('Apps');
      j.check('blog reads stopped: a 14-day-old crash stamp is not an alert', await j.waitFor(async () => (await j.stateOf(apps.blog.id)) === 'stopped', 15000), await j.stateOf(apps.blog.id));
      j.check('the bell is empty', await j.waitFor(async () => (await j.bellCount()) === '', 10000), await j.bellCount());
      const t0 = Date.now();
      await j.tab('History');
      const shown = await j.waitFor(() => w().locator('li[data-run]').count().then((n) => n > 0 && n), 20000);
      const ms = Date.now() - t0;
      j.check('History lists runs within 5 s', shown && ms < 5000, `${shown} rows in ${ms} ms`);
      const ids = await w().locator('li[data-run]').evaluateAll((els) => els.map((e) => e.getAttribute('data-run')));
      j.check('newest first: the top row is the latest run on disk', ids[0] === 'r_seed_1199', ids[0]);
      const more = await w().locator('.history-view').getByText(/older|more runs|showing|of \d/i).count();
      j.note(`History shows ${shown} of ${before} runs; text saying more exist: ${more ? 'yes' : 'none'}`);
      const heads = await w().locator('.group-h').count();
      j.check('rows are grouped by day', heads >= 2, `${heads} day headings`);
      await h.sleep(6000);
      j.check('reading the history does not prune it (only a write does)', j.runs().length === before, `${before} -> ${j.runs().length}`);
      await shot('03-history-two-weeks');
      await narrow('History');
    }],

    ['filter two weeks of runs', async () => {
      const onDisk = j.runs().filter((r) => r.git?.branch === 'fix/checkout').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      await filterRuns('fix/checkout');
      const ids = await j.waitFor(async () => {
        const got = await w().locator('li[data-run]').evaluateAll((els) => els.map((e) => e.getAttribute('data-run')));
        return got.length === onDisk.length && got;
      }, 10000);
      j.check('by branch: every fix/checkout run on disk is listed', ids, `${ids ? ids.length : 'not'} of ${onDisk.length}`);
      j.check('back to the oldest one, two weeks ago', ids && ids[ids.length - 1] === onDisk[onDisk.length - 1].id, ids && ids[ids.length - 1]);
      const branches = await w().locator('li[data-run] .branch').allTextContents();
      j.check('and each row shows its branch', branches.length === onDisk.length && branches.every((b) => b === 'fix/checkout'), `${branches.length}`);
      await shot('04-filter-branch');
      await filterRuns('api');
      const names = await rowNames();
      j.check('by app: only api runs', names.length > 0 && names.every((n) => n === 'api'), `${names.length} rows, ${[...new Set(names)].join(',')}`);
      // Not in the placeholder, but a registered app's command holds its port.
      await filterRuns(String(apiPort));
      const byPort = await rowNames();
      j.check('by port: the port number finds api\'s runs', byPort.length > 0 && byPort.every((n) => n === 'api'), `${byPort.length} rows, ${[...new Set(byPort)].join(',')}`);
      const sha = j.runs().find((r) => r.id === 'r_seed_0600').git.sha.slice(0, 8);
      await filterRuns(sha);
      const one = await w().locator('li[data-run]').evaluateAll((els) => els.map((e) => e.getAttribute('data-run')));
      j.check('by commit: a short sha finds its run', one.join() === 'r_seed_0600', one.join());
      await filterRuns('zzqq');
      j.check('an unmatched filter says so', /No run matches/.test(await w().locator('.empty-note').textContent().catch(() => '')));
      await filterRuns('');
    }],

    ['Start again a terminal server from History: the first write prunes to the cap', async () => {
      await captureOpenExternal();
      const before = j.runs();
      await filterRuns('docs');
      const row = w().locator('li[data-run]').first();
      const runId = await row.getAttribute('data-run');
      await row.getByRole('button', { name: 'Start again' }).click();
      const page = await j.waitFor(() => j.answers(docsPort), 40000);
      j.check('docs answers on its old port with its own page', page && page.title === 'Docs', JSON.stringify(page));
      const app = await j.waitFor(() => (j.config()?.apps || []).find((a) => a.name === 'docs'), 10000);
      j.check('the docs folder is now a registered app', app && path.resolve(app.cwd) === path.resolve(dirs.docs) && app.preferredPort === docsPort, JSON.stringify(app && { cwd: app.cwd, port: app.preferredPort }));
      const open = await j.waitFor(() => j.runs().find((r) => r.appId === app.id && !r.stoppedAt), 10000);
      j.check('runs.json has an open run for it', open && Number(open.port) === docsPort);
      opened.push(...await j.waitFor(() => j.app.evaluate(() => global.__opened.length && global.__opened), 10000) || []);
      j.check('and PortPilot asked to open its page', opened.includes(`http://localhost:${docsPort}/`), opened.join(' '));
      const after = j.runs();
      j.check(`runs.json is back at its cap of ${DEFAULT_MAX_RUNS}`, after.length === DEFAULT_MAX_RUNS, `${before.length} -> ${after.length} (Start again on ${runId})`);
      const want = expectPrune(before, open, DEFAULT_MAX_RUNS).map((r) => r.id);
      const got = after.map((r) => r.id);
      j.check('the oldest unpinned runs went, everything newer stayed, in order', JSON.stringify(got) === JSON.stringify(want), `dropped ${before.length + 1 - after.length}; first kept unpinned ${got.find((id) => !pinned.includes(id))}`);
      j.check('every pinned run survived, day 1\'s included', pinned.every((id) => got.includes(id)), pinned.join(','));
      j.check('day 1\'s unpinned blog crash is gone from disk', !after.some((r) => r.appId === apps.blog.id && r.exitCode === 4));
      await shot('05-start-again');
      await j.tab('Apps');
      await startCard(app.id, 'Stop');
      j.check('docs stops from its card', await j.portFree(docsPort, 15000));
    }],

    ['browser history: 520 sessions, Open again in a throwaway Brave', async () => {
      const before = browserRuns();
      await j.tab('History');
      await w().getByRole('button', { name: 'Browsers', exact: true }).click();
      const n = await j.waitFor(() => w().locator('li[data-session]').count().then((c) => c > 0 && c), 15000);
      j.note(`Browsers history shows ${n} of ${before.length} sessions on disk`);
      const first = await w().locator('li[data-session]').first().getAttribute('data-session');
      j.check('newest first', first === before[before.length - 1].id, first);
      const filter = w().locator('input[aria-label="Filter browser sessions"]');
      await filter.fill('page-100');
      await j.blur();
      await h.sleep(400);
      const found = await w().locator('li[data-session]').count();
      j.note(`filter "page-100" (a session from about 11 days ago, on disk): ${found} rows`);
      await filter.fill('');
      await j.blur();
      await narrow('Browser history');
      await shot('06-browser-history');
      await w().locator(`li[data-session="${first}"]`).getByRole('button', { name: 'Open again' }).click();
      const said = await j.waitFor(() => w().locator('.tile-notice.info span').textContent(), 60000);
      j.check('Open again says what it did', said && said.startsWith('Opened 2 tabs in preview'), said);
      const urls = await j.waitFor(async () => {
        const list = (await (await fetch(`http://127.0.0.1:${bravePort}/json`)).json()).filter((t) => t.type === 'page').map((t) => t.url);
        return list.includes(`${site}/orders`) && list.includes(`${site}/stats`) && list;
      }, 20000);
      j.check('Brave\'s own debug port lists both saved tabs', urls, urls && urls.join(' '));
      const after = browserRuns();
      const added = after.filter((r) => !before.some((b) => b.id === r.id));
      j.check(`browser-runs.json is trimmed to its cap of ${DEFAULT_MAX_ENTRIES}`, after.length === DEFAULT_MAX_ENTRIES, `${before.length} -> ${after.length}`);
      j.check('one new open session for preview', added.length === 1 && added[0].profile === 'preview' && !added[0].stoppedAt, JSON.stringify(added.map((a) => a.id)));
      const want = [...before.slice(before.length + 1 - DEFAULT_MAX_ENTRIES).map((r) => r.id), added[0] && added[0].id];
      j.check('the oldest sessions went, the newest stayed, in order', JSON.stringify(after.map((r) => r.id)) === JSON.stringify(want));
      await shot('07-browser-reopened');
      const shownTabs = await w().locator(`li[data-session="${added[0]?.id}"] .sub`).first().textContent().catch(() => '');
      j.note(`right after Open again the new session row reads: ${shownTabs}`);
      // The sampler reads a running profile's tabs about every 30 s.
      const sampled = await j.waitFor(() => (browserRuns().find((r) => r.id === added[0]?.id)?.tabs || []).length === 2, 45000);
      j.check('within one sample the open session on disk holds both tabs', sampled, JSON.stringify(browserRuns().find((r) => r.id === added[0]?.id)?.tabs));
      await w().evaluate(() => window.portpilot.browsers.stop('preview'));
      const down = await j.waitFor(() => fetch(`http://127.0.0.1:${bravePort}/json/version`).then(() => false, () => true), 20000);
      j.check('Brave is gone from its debug port after Stop', down);
      if (!down) await h.closeBrowserOn(bravePort);
      const profileDir = path.join(j.configDir, 'browser-profiles');
      // Brave's helpers can linger after Browser.close even with no PortPilot involved (seen with a bare
      // headless Brave too), so a leftover is recorded, then ended: they run under this world's profile.
      await j.waitFor(() => worldProcesses(profileDir).length === 0, 20000);
      const left = worldProcesses(profileDir);
      if (left.length) {
        j.note(`20 s after Stop, ${left.length} Brave process(es) of the profile were still running (${left.join(', ')}); ended by the journey`);
        left.forEach((pid) => { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } });
      }
      j.check('its session closes on disk', await j.waitFor(() => browserRuns().find((r) => r.id === added[0]?.id)?.stoppedAt, 15000));
      await w().getByRole('button', { name: 'Apps', exact: true }).click();
    }],

    ['a scene: create, start, stop, quit', async () => {
      await j.tab('Scenes');
      await w().click('role=button[name="New scene"]');
      const d = w().locator('role=dialog[name="New scene"]');
      await d.getByPlaceholder('Morning work').fill('Morning');
      await d.locator('label.check', { hasText: 'shop' }).locator('input').check();
      await d.locator('label.check', { hasText: 'api' }).locator('input').check();
      await j.blur();
      await d.getByRole('button', { name: 'Create' }).click();
      scene = await j.waitFor(() => (j.config()?.scenes || []).find((s) => s.name === 'Morning'), 10000);
      j.check('the config holds the scene with shop and api', scene && scene.apps.length === 2 && scene.apps.includes(apps.shop.id) && scene.apps.includes(apps.api.id), JSON.stringify(scene));
      const card = w().locator(`article[data-scene="${scene.id}"]`);
      await card.getByRole('button', { name: 'Start' }).click();
      const up = await j.waitFor(async () => (await j.answers(shopPort))?.title === 'Shop' && (await j.answers(apiPort))?.title === 'Api', 30000);
      j.check('Start: shop and api both answer', up);
      j.check('blog, not in the scene, stays down', j.listeners(blogPort).length === 0);
      const report = await j.waitFor(() => card.locator('.scene-report').textContent(), 10000);
      j.check('the scene says what it started', /Started: shop, api/.test(report || ''), report);
      const count = await j.waitFor(async () => /2 apps, 2 up/.test(await card.textContent()), 12000);
      j.check('within one refresh the card counts both up', count, await card.locator('.muted').textContent());
      await shot('08-scene-started');
      await narrow('Scenes');
      await card.getByRole('button', { name: 'Stop' }).click();
      j.check('Stop: both ports go quiet', await j.portFree(shopPort, 15000) && await j.portFree(apiPort, 15000));
      // Quit with nothing running. A quit with the scene's servers up left them running in 2 of 6 runs
      // (before-quit is async and Electron does not wait for it): reported, owned by journey-restarts.
      const pid = j.app.process().pid;
      await j.quit();
      j.check('PortPilot has exited', !h.alive(pid));
      j.check('nothing listens on the journey\'s ports', j.ports.every((p) => j.listeners(p).length === 0), j.ports.map((p) => `${p}:${j.listeners(p).join('/')}`).join(' '));
    }],

    ['relaunch: the scene is still there and still works', async () => {
      await j.launch();
      await j.tab('Scenes');
      const card = w().locator(`article[data-scene="${scene.id}"]`);
      j.check('the scene is listed', await j.waitFor(() => card.isVisible(), 15000));
      const kept = (j.config()?.scenes || []).find((s) => s.id === scene.id);
      j.check('the config scene is unchanged', JSON.stringify(kept) === JSON.stringify(scene), JSON.stringify(kept));
      j.check('it says nothing is up', /2 apps, 0 up/.test(await card.textContent()), await card.locator('.muted').textContent());
      const stop = card.getByRole('button', { name: 'Stop' });
      if (await stop.isEnabled()) {
        await stop.click();
        const said = await j.waitFor(() => card.locator('.scene-report').textContent(), 5000);
        j.note(`after the relaunch Stop is enabled with nothing up; pressing it says: ${said}`);
      } else j.note('after the relaunch Stop is disabled');
      await card.getByRole('button', { name: 'Start' }).click();
      j.check('Start after a relaunch: both answer', await j.waitFor(async () => (await j.answers(shopPort))?.title === 'Shop' && (await j.answers(apiPort))?.title === 'Api', 30000));
      await shot('09-scene-after-relaunch');
      await card.getByRole('button', { name: 'Stop' }).click();
      j.check('Stop: both ports go quiet', await j.portFree(shopPort, 15000) && await j.portFree(apiPort, 15000));
      const open = j.runs().filter((r) => !r.stoppedAt);
      j.check('runs.json has no run left open', open.length === 0, open.map((r) => r.appName).join(','));
      j.check(`and stays at its cap of ${DEFAULT_MAX_RUNS}`, j.runs().length === DEFAULT_MAX_RUNS, `${j.runs().length}`);
      siteServer.close();
    }],
  ]);
})().catch((e) => { console.error(e); process.exit(1); });
