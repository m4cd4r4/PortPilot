/**
 * Real-Electron check of browser history and "Open again", with REAL headless Brave, against a
 * THROWAWAY config. Run: node tests/browsers-history.e2e.js   (needs Electron, playwright and Brave;
 * skips without Brave). Set PORTPILOT_SHOTS_DIR to save the History expander at 1440 and 390 px.
 *
 * Starts a profile through the Browsers tab, opens a page on a local test server (the page address
 * carries a fake token), stops, then asserts the history entry, its redacted tab URL, the History
 * expander with its Open again button, that Open again really reopens the page in a fresh browser,
 * and that the dev-server run the page belongs to reads "tested in <profile>" in the History tab.
 * Browser and page ports are free OS ports, never 9222-9240; nothing here touches the real config.
 */
const { spawn } = require('child_process');
const h = require('./e2e-harness');
const { fs, path, until } = h;

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP browsers-history: Brave is not installed'); process.exit(0); }

const { check, finish } = h.checker();
const world = h.makeWorld('pp-bh-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const json = (port, route, opts) => fetch(`http://127.0.0.1:${port}${route}`, opts).then((r) => r.json());
const isUp = (port) => json(port, '/json/version').then(() => true, () => false);
const tabsOn = async (port) => (await json(port, '/json')).filter((t) => t.type === 'page');

async function main() {
  const [browserPort, pagePort] = await h.freePorts(2);
  // Faster sampling than the 30 s a person gets, so the test can see a sample land.
  process.env.PORTPILOT_BROWSER_SAMPLE_MS = '1000';

  world.writeConfig({ browserProfiles: [{ name: 'hist-qa', port: browserPort, browser: 'brave', mode: 'headless', url: 'about:blank', note: 'history check' }] });

  // The page the "user" works on: a dev server that is also an open run in the run history.
  const serverFile = path.join(world.mkdir('page'), 'server.js');
  fs.writeFileSync(serverFile, h.SERVER);
  const pageServer = spawn(process.execPath, [serverFile, '--port', String(pagePort)], { stdio: 'ignore', windowsHide: true });
  await until(() => fetch(`http://127.0.0.1:${pagePort}/`).then((r) => r.ok, () => false), 15000, 'page server');
  const now = new Date().toISOString();
  const historyDir = path.join(world.configDir, 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  fs.writeFileSync(path.join(historyDir, 'runs.json'), JSON.stringify({ v: 1, runs: [{
    id: 'r_20261013T000000_aaaaaaaa', appId: 'app_demo', appName: 'Shop demo app', cwd: null, repoRoot: null, relCwd: null,
    command: 'node server.js', port: pagePort, url: `http://localhost:${pagePort}/`, startedBy: { kind: 'human', surface: 'desktop', at: now },
    startedAt: now, stoppedAt: null, endedBy: null, exitCode: null,
    git: { branch: null, sha: null, subject: null, dirty: false, files: [], snapshot: null, skipped: 'not-a-repo' }, page: null, pinned: false,
  }] }));

  const { app, win } = await h.launch(world);
  if (process.env.E2E_DEBUG) { app.process().stdout.on('data', (d) => process.stdout.write('[app] ' + d)); app.process().stderr.on('data', (d) => process.stdout.write('[app!] ' + d)); }
  const row = '.brow[data-name="hist-qa"]';
  const toggle = `${row} [data-bact="toggle"]`;
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const pageUrl = `http://127.0.0.1:${pagePort}/?token=SECRET123&view=1`;
  const historyFile = path.join(historyDir, 'browser-runs.json');
  try {
    await win.waitForSelector('.view-tab[data-view="browsers"]');
    await win.click('.view-tab[data-view="browsers"]');
    await win.waitForSelector(row);

    // Start through the UI; a new session is recorded.
    await win.click(toggle);
    await until(async () => (await win.textContent(toggle)) === 'Stop', 60000, 'hist-qa running');
    await until(() => fs.existsSync(historyFile) && JSON.parse(fs.readFileSync(historyFile, 'utf8')).runs.length === 1, 10000, 'a history entry on start');
    let entry = JSON.parse(fs.readFileSync(historyFile, 'utf8')).runs[0];
    check('a start records one open session for the profile, started by the desktop', entry.profile === 'hist-qa' && entry.port === browserPort
      && entry.stoppedAt === null && entry.startedBy.kind === 'human' && entry.startedBy.surface === 'desktop', JSON.stringify(entry.startedBy));

    // The user opens a page in that browser (a tab the profile did not start with).
    await json(browserPort, `/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
    await until(async () => (await tabsOn(browserPort)).some((t) => t.url.includes(`:${pagePort}/`) && t.title === 'Shop demo'), 15000, 'the page loaded in the browser');

    // The sampler reads the tab without anyone stopping the browser, and links the dev-server run.
    await until(() => JSON.parse(fs.readFileSync(historyFile, 'utf8')).runs[0].tabs.some((t) => t.url.includes(`:${pagePort}/`)), 15000, 'a sample with the page');
    const runs = () => JSON.parse(fs.readFileSync(path.join(historyDir, 'runs.json'), 'utf8')).runs;
    await until(() => (runs()[0].testedIn || []).length > 0, 15000, 'testedIn on the run');
    check('the sampler links the dev-server run to the profile it was tested in', runs()[0].testedIn[0].profile === 'hist-qa', JSON.stringify(runs()[0].testedIn));

    // Stop through the UI: the closing entry has the tab, redacted.
    await win.click(toggle);
    await until(async () => (await win.textContent(toggle)) === 'Start', 30000, 'hist-qa stopped');
    check('stopping closes the browser port', !(await isUp(browserPort)));
    const raw = fs.readFileSync(historyFile, 'utf8');
    entry = JSON.parse(raw).runs[0];
    const tab = entry.tabs.find((t) => t.url.includes(`:${pagePort}/`));
    check('stop closes the same session: stoppedAt set, ended by the desktop', !!entry.stoppedAt && entry.endedBy && entry.endedBy.kind === 'human' && JSON.parse(raw).runs.length === 1);
    check('the tab URL and title are stored, with the token hidden', tab && tab.url === `http://127.0.0.1:${pagePort}/?token=***&view=1` && tab.title === 'Shop demo', JSON.stringify(tab));
    check('the secret is nowhere in the history file', !raw.includes('SECRET123'));

    // The expander
    await win.click(`${row} [data-bact="history"]`);
    await win.waitForSelector(`${row} .bhist-item`);
    const text = (await win.textContent(`${row} .bhist`)).replace(/\s+/g, ' ');
    check('History expander lists the session with who, tab count and how it ended', /started by you/.test(text) && /\d tabs?/.test(text) && /stopped by you/.test(text), text);
    check('it lists the tab title and its redacted URL', text.includes('Shop demo') && text.includes('token=***') && !text.includes('SECRET123'), text);
    check('it offers Open again', (await win.$$(`${row} .bhist-item [data-bact="reopen"]`)).length === 1);

    // Open again: a fresh browser starts and the page comes back
    await win.click(`${row} [data-bact="reopen"]`);
    await until(async () => (await win.textContent(toggle)) === 'Stop', 60000, 'hist-qa running again');
    await until(async () => (await tabsOn(browserPort)).some((t) => t.url.includes(`:${pagePort}/`) && t.url.includes('view=1')), 20000, 'the page reopened');
    const reopened = (await tabsOn(browserPort)).filter((t) => t.url.includes(`:${pagePort}/`));
    check('Open again starts the profile and reopens the page in a new tab', reopened.length === 1 && reopened[0].title === 'Shop demo', JSON.stringify(reopened.map((t) => t.url)));
    check('the reopened address keeps the harmless parameter and loses the hidden one', reopened[0].url.includes('view=1') && !reopened[0].url.includes('SECRET123'), reopened[0].url);
    const after = JSON.parse(fs.readFileSync(historyFile, 'utf8')).runs;
    check('Open again recorded a second session', after.length === 2 && after[1].stoppedAt === null);

    // Look at it: two sessions (the new one running, the earlier one closed) at desktop and phone width.
    await win.waitForSelector(`${row} .bhist-item`);
    await until(async () => (await win.$$(`${row} .bhist-item`)).length === 2, 10000, 'two sessions in the expander');
    await win.screenshot({ path: path.join(SHOTS || h.os.tmpdir(), 'browsers-history-1440.png') });
    await win.setViewportSize({ width: 390, height: 844 });
    await win.waitForTimeout(400);
    const overflow = await win.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal scroll at 390 px', overflow <= 0, String(overflow));
    await win.screenshot({ path: path.join(SHOTS || h.os.tmpdir(), 'browsers-history-390.png') });
    await win.setViewportSize({ width: 1440, height: 900 });

    // The History tab shows where the dev server was tested
    await win.click('.view-tab[data-view="history"]');
    await until(async () => (await win.$$('.hrow')).length > 0, 15000, 'history rows');
    check('the History tab reads "tested in hist-qa" on the dev-server run', (await win.textContent('.hrow')).includes('tested in hist-qa'), (await win.textContent('.hrow')).replace(/\s+/g, ' ').slice(0, 200));
    check('no renderer console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    const w = app.windows()[0];
    if (w) {
      await w.click('.view-tab[data-view="browsers"]').catch(() => {});
      if (await w.$eval(toggle, (b) => b.textContent === 'Stop').catch(() => false)) await w.click(toggle).catch(() => {});
    }
    await h.sleep(3000);
    await h.closeApp(app);
    if (await isUp(browserPort)) { console.log(`LEAK a browser is still up on :${browserPort}`); await h.closeBrowserOn(browserPort); }
    if (h.alive(pageServer.pid)) pageServer.kill();
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
