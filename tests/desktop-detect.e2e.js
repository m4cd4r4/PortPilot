/**
 * Real-Electron check: a localhost server nobody registered is picked up, recorded, thumbnailed
 * and can be started again from the History tab. Against a THROWAWAY config and OS-assigned ports.
 * Run: node tests/desktop-detect.e2e.js   (needs Electron + playwright; not part of test:unit)
 *
 * Two test-only seams keep it off the developer's real servers and quick: the watcher is limited
 * to this test's ports (PORTPILOT_DETECT_ONLY_PORTS) and scans every 3 s instead of 10
 * (PORTPILOT_DETECT_INTERVAL_MS). Set PORTPILOT_SHOTS_DIR to also save History screenshots at
 * 1440 and 390 px wide. Every process this test starts, it kills; nothing else is touched.
 */
const h = require('./e2e-harness');
const { fs, os, path, until, sleep } = h;
const { spawn } = require('child_process');
const { INTERVAL_MS } = require('../src/main/localhostWatcher');
const runHistory = require('../src/core/runHistory');

const { check, finish } = h.checker();
const world = h.makeWorld('pp-detect-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/').toLowerCase();
const kids = [];

function spawnServer(exe, args, cwd) {
  const child = spawn(exe, args, { cwd, stdio: 'ignore', windowsHide: true });
  kids.push(child);
  return child;
}
const inline = (port) => ['-e', `require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>inline</title><h1>inline</h1>')}).listen(${port},'127.0.0.1')`];
const answers = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { return false; } };
const runsOn = (port) => runHistory.readRuns(world.configPath).filter((r) => r.port === port);

async function main() {
  check('the default scan interval is 10 s', INTERVAL_MS === 10000, String(INTERVAL_MS));
  const [pShop, pBrave, pControl, pOff] = await h.freePorts(4);
  process.env.PORTPILOT_DETECT_ONLY_PORTS = [pShop, pBrave, pControl, pOff].join(',');
  process.env.PORTPILOT_DETECT_INTERVAL_MS = '3000';

  // The project: a package.json with a dev script, started by absolute path the way an agent or terminal would.
  const proj = world.mkdir('shop-web');
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'shop-web', scripts: { dev: 'node server.js' } }));
  fs.writeFileSync(path.join(proj, 'server.js'), h.SERVER);
  world.writeConfig({});

  const { app, win } = await h.launch(world);
  let shop = null;
  try {
    check('Settings has the "track every localhost server" toggle, on by default', await win.$eval('#setting-auto-track', (e) => e.checked));

    // 1. A server the user did not register, started from a terminal.
    shop = spawnServer(process.execPath, [path.join(proj, 'server.js'), '--port', String(pShop)], world.tmp);
    await until(() => answers(pShop), 15000, 'shop answering');
    const run = await until(() => runsOn(pShop).find((r) => r.detected), 40000, 'a detected run for the shop server');
    check('a detected run is recorded', true, run.id);
    check('the run is named after the project folder', run.appName === 'shop-web', run.appName);
    check('the run has the project folder', norm(run.cwd) === norm(proj), run.cwd);
    check('the run has the project start command', run.startCommand === 'npm run dev', String(run.startCommand));
    check('the run says it was detected, on the right port', run.startedBy.kind === 'detected' && run.url === `http://localhost:${pShop}/`);

    // 2. Its preview.
    const withThumb = await until(() => runsOn(pShop).find((r) => r.page && r.page.thumb), 40000, 'a thumbnail');
    check('a thumbnail file was written', fs.existsSync(path.join(runHistory.historyDirFor(world.configPath), withThumb.page.thumb)));
    check('the page title was captured', withThumb.page.title === 'Shop demo', withThumb.page.title);

    // 3. The History tab.
    await win.click('.view-tab[data-view="history"]');
    const row = `.hrow[data-run="${run.id}"]`;
    await win.waitForSelector(row);
    check('History shows the detected tag', !!(await win.$(`${row} .hdetected`)));
    await until(async () => !(await win.$eval(`${row} [data-hact="open"]`, (e) => e.disabled)), 15000, 'Open URL enabled');
    check('Open URL is enabled while the server is up', true);
    await until(() => win.$(`${row} .hthumb img`), 15000, 'thumbnail in the row');
    check('the row shows its thumbnail', true);
    check('no Start again while it is running', !(await win.$(`${row} [data-hact="startagain"]`)));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const w of [1440, 390]) {
        await win.setViewportSize({ width: w, height: w === 390 ? 800 : 900 });
        await sleep(600);
        await win.screenshot({ path: path.join(SHOTS, `history-detected-${w}.png`) });
      }
      await win.setViewportSize({ width: 1440, height: 900 });
    }

    // 4. The server dies: the run closes and can be started again.
    shop.kill();
    await until(async () => !(await answers(pShop)), 10000, 'shop stopped');
    const closed = await until(() => runsOn(pShop).find((r) => r.stoppedAt), 40000, 'the run closing');
    check('the run closes when the server is gone', closed.endedBy === 'stop', String(closed.endedBy));
    await until(async () => !(await win.$eval(`${row} [data-hact="startagain"]`, (e) => e.disabled).catch(() => true)), 15000, 'Start again enabled');
    check('Start again is enabled on the closed run', true);

    await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
    await win.click(`${row} [data-hact="startagain"]`);
    await until(() => answers(pShop), 40000, 'the server listening again');
    check('Start again brings the server back on its port', true);
    const opened = await until(() => app.evaluate(() => globalThis.__opened).then((l) => l.length && l), 15000, 'the URL opened');
    check('it opens the page once the port answers', opened[0] === `http://localhost:${pShop}/`, opened.join(','));
    const cfg = JSON.parse(fs.readFileSync(world.configPath, 'utf8'));
    const reg = cfg.apps.filter((a) => norm(a.cwd) === norm(proj));
    check('exactly one app was registered for the folder, with the start command and port',
      reg.length === 1 && reg[0].command === 'npm run dev' && reg[0].preferredPort === pShop, JSON.stringify(reg.map((a) => [a.command, a.preferredPort])));
    const after = await win.evaluate((id) => window.portpilot.process.list().then((l) => (l.apps || []).filter((a) => a.id === id && a.running).length), reg[0] && reg[0].id);
    check('the restarted app runs under PortPilot', after === 1);
    await win.evaluate((id) => window.portpilot.process.stop(id), reg[0].id);
    await until(async () => !(await answers(pShop)), 15000, 'restarted server stopped');

    // 5. A browser-like process holding a port is not recorded (a normal server beside it is, so the check can see a pass).
    const fakeBrave = path.join(world.tmp, process.platform === 'win32' ? 'brave.exe' : 'brave');
    fs.copyFileSync(process.execPath, fakeBrave);
    spawnServer(fakeBrave, inline(pBrave), world.tmp);
    spawnServer(process.execPath, inline(pControl), world.tmp);
    await until(async () => (await answers(pBrave)) && (await answers(pControl)), 15000, 'both servers answering');
    await until(() => runsOn(pControl).find((r) => r.detected), 40000, 'the control server recorded');
    check('a normal server beside it is recorded (control)', true);
    await sleep(9000);
    check('a server held by a browser-named process is NOT recorded', runsOn(pBrave).length === 0, String(runsOn(pBrave).length));

    // 6. The setting off stops recording; on again resumes.
    await win.evaluate(() => window.portpilot.config.updateSettings({ autoTrackLocalhost: false }));
    await until(() => runsOn(pControl).find((r) => r.stoppedAt), 20000, 'open runs closing when tracking is turned off');
    check('turning the setting off closes the open runs', true);
    spawnServer(process.execPath, inline(pOff), world.tmp);
    await until(() => answers(pOff), 15000, 'off-server answering');
    await sleep(12000);
    check('with the setting off a new server is NOT recorded', runsOn(pOff).length === 0, String(runsOn(pOff).length));
    await win.evaluate(() => window.portpilot.config.updateSettings({ autoTrackLocalhost: true }));
    await until(() => runsOn(pOff).find((r) => r.detected), 40000, 'recording after turning it back on');
    check('with the setting back on the same server is recorded (control)', true);
  } finally {
    const w = app.windows()[0];
    if (w) {
      const { apps: list = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of list.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
    for (const k of kids) { try { k.kill(); } catch { /* already gone */ } }
    await sleep(500);
    try { fs.rmSync(path.join(world.tmp, 'brave.exe'), { force: true }); } catch { /* still exiting */ }
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
