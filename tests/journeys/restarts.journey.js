/**
 * Journey A, days 2-3: PortPilot is quit and opened again with servers and browsers up.
 * Run: npm run build:ui && node tests/journeys/restarts.journey.js   (skips without Brave)
 *
 * Day 2: yesterday's world opens -> start an app, a terminal server and two browsers -> one browser
 * is closed from outside while PortPilot watches -> clean quit for the night -> another browser is
 * closed while PortPilot is down. Day 3: open again: the terminal server and the surviving browser
 * are adopted (same records, no duplicates), the closed browser's record is closed -> untick "Stop
 * PortPilot-started apps on quit" and pick the Cards view -> quit with the app up: it is left running
 * and adopted on relaunch -> PortPilot is killed (hard) with everything up -> relaunch: every open
 * record matches something that still answers, preferences kept.
 *
 * Browsers are real headless Brave with throwaway profiles in the journey's own world, on ports
 * from the OS (never 9222-9241). Each is closed from outside through its own debug port
 * (Browser.close over CDP). Checks read config, runtime, runs.json, browser-runs.json, netstat,
 * HTTP answers and Brave's /json, as well as the screen.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { journey, REAL_RUNS } = require('./kit');
const h = require('../e2e-harness');

const BRAVE = ['C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe']
  .find((p) => fs.existsSync(p));
if (!BRAVE) { console.log('SKIP restarts journey: Brave is not installed'); process.exit(0); }

// The desktop samples each open browser every 30 s; a journey cannot wait that long per sample.
process.env.PORTPILOT_BROWSER_SAMPLE_MS = '1000';

const REAL_BROWSER_RUNS = REAL_RUNS ? path.join(path.dirname(REAL_RUNS), 'browser-runs.json') : '';
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const realBrowserRuns = () => (readJson(REAL_BROWSER_RUNS, {}).runs || []);

/** Brave's own word on its debug port: { browser, pages } or null when nothing answers. */
async function cdp(port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
    const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) })).json();
    return { browser: v.Browser, pages: list.filter((t) => t.type === 'page').length };
  } catch { return null; }
}

(async () => {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const j = await journey('restarts', { ports: 2 });
  const [shopPort, notesPort] = j.ports;
  // Browser ports are the journey's too, but kept out of the watcher's list: they are not dev servers.
  let alphaPort; let betaPort;
  do { [alphaPort, betaPort] = await h.freePorts(2); } while ([alphaPort, betaPort].some((p) => j.ports.includes(p) || (p >= 9222 && p <= 9241)));
  const t0 = new Date().toISOString();
  const shopDir = j.project('shop');
  const ids = { shop: 'shop' };
  const was = {}; // records and PIDs seen before a quit, to compare after the relaunch
  let notes = null;

  const brPath = path.join(j.configDir, 'history', 'browser-runs.json');
  const bruns = (profile) => (readJson(brPath, {}).runs || []).filter((r) => r.profile === profile);
  const openB = (profile) => bruns(profile).filter((r) => !r.stoppedAt);
  const openRuns = (pred) => j.runs().filter((r) => !r.stoppedAt && pred(r));
  const bcard = (name) => j.win.locator(`.bcard[data-profile="${name}"]`);
  const bgroup = (name) => bcard(name).getAttribute('data-group').catch(() => null);

  /** PIDs of every Brave process (helpers included) running on a profile's folder in this world. */
  /** Every Brave process (helpers included) on a profile's folder in this world, as "pid:type" ("main" for the browser itself). */
  function profileProcs(name) {
    const dir = path.join(j.configDir, 'browser-profiles', name).toLowerCase().replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "Name='brave.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${dir}') } | ForEach-Object { $t = 'main'; if ($_.CommandLine -match '--type=(\\S+)') { $t = $Matches[1] }; "$($_.ProcessId):$t" }`;
    try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter(Boolean); } catch { return []; }
  }
  /**
   * Start from the card, at once. A Brave closed outside can still be on its folder (F45, was N5):
   * Start itself waits for it or ends our own leftover, so one press is enough.
   */
  async function startBrowser(name, port) {
    await j.tab('Browsers');
    const lingering = profileProcs(name);
    j.note(`${name}: Brave processes on its folder when Start is pressed: ${lingering.join(' ') || 'none'}`);
    await bcard(name).hover();
    await bcard(name).getByRole('button', { name: 'Start', exact: true }).click();
    const up = await j.waitFor(() => cdp(port), 60000);
    let said = [];
    if (!up) {
      await j.shot(`fail-start-${name}`);
      said = await j.win.locator('[role="alert"], .notice, .tile-notice').allTextContents().catch(() => []);
    }
    j.check(`${name} starts on the first press${lingering.length ? ', with Brave still on its folder' : ''}`, up,
      up ? '' : `Brave processes on its folder: ${profileProcs(name).join(' ') || 'none now'}; screen says ${JSON.stringify(said)}`);
    j.check(`${name} answers on its own debug port`, up);
    j.check(`the ${name} card moves to Open`, await j.waitFor(async () => (await bgroup(name)) === 'open', 30000), await bgroup(name));
  }
  async function startShop() {
    await j.tab('Apps');
    await j.card(ids.shop).hover();
    await j.card(ids.shop).getByRole('button', { name: 'Start', exact: true }).click();
    const page = await j.waitFor(async () => { const a = await j.answers(shopPort); return a && a.title === 'Shop' && a; }, 30000);
    j.check('shop answers on its port with its own page', page, JSON.stringify(page));
    j.check('the shop card says running', await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'running', 15000), await j.stateOf(ids.shop));
  }
  /** Open the Settings screen (in the sidebar, or under More). */
  async function settings() {
    await j.tab('Settings');
    await j.win.locator('section.settings-view .set-group').first().waitFor({ timeout: 10000 });
  }
  /**
   * A check that fails on a defect already reported and still open: logged as KNOWN OPEN instead of
   * failing the run, so the journey guards everything else. Once the defect is fixed it is a plain
   * passing check; drop it from KNOWN when the fix lands.
   */
  const KNOWN = {
    N2: 'Stop on an app PortPilot started before a quit (left running, adopted on relaunch) says "App not found or not running" and leaves it running',
    N3: 'after PortPilot is killed, the dead app\'s run stays open in runs.json and its runtime entry keeps startedBy',
    N4: 'after PortPilot is killed, display preferences kept in localStorage (Apps view) are sometimes lost: the key reads null',
  };
  function known(id, what, ok, detail = '') {
    if (ok) return j.check(what, true, detail);
    j.note(`KNOWN OPEN ${id} (${KNOWN[id]}): ${what} - ${detail}`);
    return false;
  }
  const stopOnQuitBox = () => j.win.locator('label.set-row', { hasText: 'Stop PortPilot-started apps on quit' }).locator('input[type=checkbox]');

  await j.run([
    ['day 2 morning: yesterday\'s world opens', async () => {
      // Day one left one app and two browser profiles behind (journey day-one covers making them).
      fs.writeFileSync(path.join(j.configDir, 'portpilot-config.json'), JSON.stringify({
        groups: [], settings: {},
        apps: [{ id: ids.shop, name: 'shop', cwd: shopDir, command: j.command(shopPort, { title: 'Shop' }), preferredPort: shopPort }],
        browserProfiles: [
          { name: 'alpha', port: alphaPort, browser: 'brave', mode: 'headless', url: 'about:blank', purpose: 'Journey browser A' },
          { name: 'beta', port: betaPort, browser: 'brave', mode: 'headless', url: 'about:blank', purpose: 'Journey browser B' },
        ],
      }, null, 2));
      j.check('no browser answers on the journey\'s browser ports yet', !(await cdp(alphaPort)) && !(await cdp(betaPort)));
      await j.launch();
      await j.tab('Apps');
      j.check('shop\'s card is there and stopped', await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'stopped', 15000), await j.stateOf(ids.shop));
      await j.tab('Browsers');
      j.check('both browser cards are there, stopped', await j.waitFor(async () => (await bgroup('alpha')) === 'stopped' && (await bgroup('beta')) === 'stopped', 20000));
      await j.shot('01-day2-morning');
    }],

    ['start shop, a terminal server and two browsers', async () => {
      await startShop();
      notes = j.startServer('notes', notesPort, { title: 'Notes' });
      const nrun = await j.waitFor(() => openRuns((r) => Number(r.port) === notesPort)[0], 30000);
      j.check('the terminal server gets a detected run', nrun && nrun.detected === true, JSON.stringify(nrun && { appId: nrun.appId, detected: nrun.detected }));
      await startBrowser('alpha', alphaPort);
      await startBrowser('beta', betaPort);
      // The card can read Open (a status poll) a moment before the start call has written its record.
      j.check('browser-runs.json has one open record per browser, started by a person',
        await j.waitFor(() => openB('alpha').length === 1 && openB('beta').length === 1 && openB('alpha')[0].startedBy?.kind === 'human' && openB('beta')[0].startedBy?.kind === 'human', 10000),
        JSON.stringify([...bruns('alpha'), ...bruns('beta')].map((r) => [r.profile, r.stoppedAt, r.startedBy && r.startedBy.kind])));
      await j.shot('02-day2-all-up');
    }],

    ['beta is closed from outside while PortPilot watches', async () => {
      j.check('Brave accepts Browser.close on beta\'s debug port', await h.closeBrowserOn(betaPort));
      j.check('beta\'s port goes quiet', await j.portFree(betaPort, 15000));
      const closed = await j.waitFor(() => { const r = bruns('beta')[0]; return r && r.stoppedAt && r; }, 20000);
      j.check('its record is closed as closed from outside', closed && closed.endedBy?.kind === 'external' && closed.endedBy?.reason === 'closed', JSON.stringify(closed && closed.endedBy));
      j.check('the beta card goes back to Stopped', await j.waitFor(async () => (await bgroup('beta')) === 'stopped', 20000), await bgroup('beta'));
      j.check('alpha is untouched: it answers and its record is still open', (await cdp(alphaPort)) && openB('alpha').length === 1);
      await j.shot('03-beta-closed-outside');
    }],

    ['beta again, then a clean quit for the night', async () => {
      await startBrowser('beta', betaPort);
      // As on day 2: the card can read Open before the start call has written its record.
      j.check('beta now has two records, one open', await j.waitFor(() => bruns('beta').length === 2 && openB('beta').length === 1, 10000), `${bruns('beta').length} records`);
      was.notesRun = openRuns((r) => Number(r.port) === notesPort)[0]?.id;
      was.alphaRec = openB('alpha')[0]?.id;
      was.betaRec = openB('beta')[0]?.id;
      was.alphaPid = j.listeners(alphaPort)[0];
      const pid = j.app.process().pid;
      await j.quit();
      j.check('PortPilot has exited', !h.alive(pid));
      j.check('the clean quit stopped shop (Stop PortPilot-started apps on quit is on by default)', await j.portFree(shopPort, 10000));
      const srun = j.runs().filter((r) => r.appId === ids.shop).pop();
      j.check('and closed its run as stopped', srun && srun.stoppedAt && srun.endedBy === 'stop', JSON.stringify(srun && { stoppedAt: srun.stoppedAt, endedBy: srun.endedBy }));
      j.check('and dropped its runtime entry', !j.runtime()[ids.shop], JSON.stringify(j.runtime()[ids.shop]));
      j.check('the terminal server was not touched', (await j.answers(notesPort))?.title === 'Notes');
      j.check('both browsers outlive the quit', (await cdp(alphaPort)) && (await cdp(betaPort)));
    }],

    ['while PortPilot is down, beta is closed from outside', async () => {
      j.check('Brave accepts Browser.close on beta\'s debug port', await h.closeBrowserOn(betaPort));
      j.check('beta\'s port goes quiet', await j.portFree(betaPort, 15000));
      j.check('nobody is watching, so its record is still open', openB('beta').length === 1 && openB('beta')[0].id === was.betaRec);
    }],

    ['day 3 morning: open PortPilot again', async () => {
      await j.launch();
      await j.tab('Apps');
      j.check('shop reads stopped', await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'stopped', 15000), await j.stateOf(ids.shop));
      j.check('and has no open run', openRuns((r) => r.appId === ids.shop).length === 0);
      // The watcher adopts on its first scan; give it a few.
      await h.sleep(4000);
      const nopen = openRuns((r) => Number(r.port) === notesPort);
      j.check('the terminal server is adopted: one open run, the same one as last night', nopen.length === 1 && nopen[0].id === was.notesRun, JSON.stringify(nopen.map((r) => r.id)));
      j.check('and no second run was made for it', j.runs().filter((r) => Number(r.port) === notesPort).length === 1, `${j.runs().filter((r) => Number(r.port) === notesPort).length} runs`);
      const bclosed = await j.waitFor(() => { const r = bruns('beta').find((x) => x.id === was.betaRec); return r && r.stoppedAt && r; }, 20000);
      j.check('beta, closed while PortPilot was down, has its record closed', bclosed && bclosed.endedBy?.reason === 'closed', JSON.stringify(bclosed && bclosed.endedBy));
      j.check('beta still has two records (none made on relaunch)', bruns('beta').length === 2, `${bruns('beta').length}`);
      j.check('alpha still answers, the same Brave process', (await cdp(alphaPort)) && j.listeners(alphaPort)[0] === was.alphaPid, `${j.listeners(alphaPort)} vs ${was.alphaPid}`);
      j.check('alpha keeps its one open record from yesterday', openB('alpha').length === 1 && openB('alpha')[0].id === was.alphaRec && bruns('alpha').length === 1, JSON.stringify(bruns('alpha').map((r) => [r.id, r.stoppedAt])));
      await j.tab('Browsers');
      j.check('the alpha card reads Open, beta Stopped', await j.waitFor(async () => (await bgroup('alpha')) === 'open' && (await bgroup('beta')) === 'stopped', 20000), `${await bgroup('alpha')} / ${await bgroup('beta')}`);
      await j.tab('History');
      const row = await j.waitFor(async () => (await j.win.locator('.run').allTextContents()).filter((t) => /notes/i.test(t)), 15000);
      j.check('History lists notes once', row && row.length === 1, JSON.stringify(row));
      await j.shot('04-day3-morning');
    }],

    ['Open on the adopted alpha adds no tab, process or record', async () => {
      await j.tab('Browsers');
      const before = await cdp(alphaPort);
      await bcard('alpha').hover();
      await bcard('alpha').getByRole('button', { name: 'Open', exact: true }).click();
      await h.sleep(1500);
      const after = await cdp(alphaPort);
      j.check('the page count is unchanged', before && after && after.pages === before.pages, `${before && before.pages} -> ${after && after.pages}`);
      j.check('one Brave still holds the port, the same one', j.listeners(alphaPort).length === 1 && j.listeners(alphaPort)[0] === was.alphaPid);
      j.check('and alpha still has a single record', bruns('alpha').length === 1);
    }],

    ['change preferences: keep apps running on quit, Cards view', async () => {
      await settings();
      j.check('Stop PortPilot-started apps on quit starts ticked', await stopOnQuitBox().isChecked());
      await stopOnQuitBox().click();
      j.check('unticking it is saved to the config file', await j.waitFor(() => j.config()?.settings?.stopAppsOnQuit === false, 5000), JSON.stringify(j.config()?.settings));
      await j.win.locator('[role=group][aria-label="Apps view"]').getByRole('button', { name: 'Cards' }).click();
      j.check('the Cards view is picked', (await j.win.locator('[role=group][aria-label="Apps view"]').getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')) === 'true');
      await j.shot('05-settings-changed');
    }],

    ['start shop, quit: shop is left running this time', async () => {
      await startShop();
      was.shopRun = openRuns((r) => r.appId === ids.shop)[0]?.id;
      was.shopPid = j.listeners(shopPort)[0];
      await j.quit();
      j.check('shop still answers after the quit', (await j.answers(shopPort))?.title === 'Shop');
      j.check('its run is still open', openRuns((r) => r.appId === ids.shop).length === 1);
    }],

    ['relaunch: shop is adopted and the preferences are kept', async () => {
      await j.launch();
      j.check('the config still says keep apps running on quit', j.config()?.settings?.stopAppsOnQuit === false);
      await j.tab('Apps');
      j.check('Apps opens in the Cards view', await j.waitFor(() => j.win.locator('.tiles .card[data-app]').count(), 10000));
      j.check('shop reads running', await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'running', 20000), await j.stateOf(ids.shop));
      await h.sleep(3000);
      const sopen = openRuns((r) => r.appId === ids.shop);
      j.check('shop has one open run, the one from before the quit', sopen.length === 1 && sopen[0].id === was.shopRun, JSON.stringify(sopen.map((r) => r.id)));
      j.check('the same server process holds the port', j.listeners(shopPort).length === 1 && j.listeners(shopPort)[0] === was.shopPid);
      await j.shot('06-shop-adopted');
      await settings();
      j.check('Settings shows the box unticked', !(await stopOnQuitBox().isChecked()));
    }],

    ['stop the adopted shop from its card', async () => {
      await j.tab('Apps');
      await j.card(ids.shop).hover();
      await j.card(ids.shop).getByRole('button', { name: 'Stop', exact: true }).click();
      const freed = await j.portFree(shopPort, 15000);
      const said = await j.win.locator('[role="alert"], .notice, .tile-notice').allTextContents().catch(() => []);
      await j.shot('06b-stop-adopted');
      known('N2', 'shop\'s port goes quiet', freed, `${j.listeners(shopPort)}; screen says ${JSON.stringify(said)}`);
      const run = await j.waitFor(() => j.runs().find((r) => r.id === was.shopRun && r.stoppedAt), freed ? 10000 : 1000);
      known('N2', 'its run closes as stopped', run && run.endedBy === 'stop', run && run.endedBy);
      known('N2', 'the card reads stopped', await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'stopped', freed ? 15000 : 1000), await j.stateOf(ids.shop));
      if (!freed) {
        // What a person does next: kill what holds the port from the Ports screen.
        await j.tab('Ports');
        const row = j.win.locator(`tr[data-port="${shopPort}"]`);
        await row.getByRole('button', { name: 'Kill' }).click();
        await row.getByRole('button', { name: 'Confirm kill' }).click();
        j.note(`Stop did not stop the adopted shop; Ports > Kill freed it: ${await j.portFree(shopPort, 15000)}`);
        await j.waitFor(async () => { await j.tab('Apps'); return (await j.stateOf(ids.shop)) === 'stopped'; }, 20000);
      }
    }],

    ['start shop and beta, then PortPilot is killed', async () => {
      await startShop();
      await startBrowser('beta', betaPort);
      await j.quit({ hard: true });
      was.after = { shop: !!(await j.answers(shopPort)), alpha: !!(await cdp(alphaPort)), beta: !!(await cdp(betaPort)), notes: !!(await j.answers(notesPort)) };
      j.note(`after the kill, still answering: ${JSON.stringify(was.after)}`);
      j.check('the terminal server survives the kill', was.after.notes);
      j.check('alpha (started two launches ago) survives the kill', was.after.alpha);
    }],

    ['relaunch after the kill: open records match what answers', async () => {
      await j.launch();
      await j.tab('Apps');
      await h.sleep(5000); // watcher scans and browser samples
      const shopUp = !!(await j.answers(shopPort));
      const sopen = await j.waitFor(() => { const n = openRuns((r) => r.appId === ids.shop).length; return n === (shopUp ? 1 : 0) ? `${n}` : null; }, 15000);
      (shopUp ? j.check : (w, ok, d) => known('N3', w, ok, d))(`shop ${shopUp ? 'answers and has one open run' : 'is gone and has no open run'}`, sopen, `${openRuns((r) => r.appId === ids.shop).length} open; runtime ${JSON.stringify(j.runtime()[ids.shop])}`);
      j.check(`the shop card reads ${shopUp ? 'running' : 'stopped'}`, await j.waitFor(async () => (await j.stateOf(ids.shop)) === (shopUp ? 'running' : 'stopped'), 15000), await j.stateOf(ids.shop));
      for (const [name, port] of [['alpha', alphaPort], ['beta', betaPort]]) {
        const up = !!(await cdp(port));
        j.check(`${name} ${up ? 'answers and has one open record' : 'is gone and its record is closed'}`, await j.waitFor(() => openB(name).length === (up ? 1 : 0), 20000), `${openB(name).length} open`);
      }
      const nopen = openRuns((r) => Number(r.port) === notesPort);
      j.check('the terminal server keeps its one run', nopen.length === 1 && nopen[0].id === was.notesRun, JSON.stringify(nopen.map((r) => r.id)));
      j.check('the config survived the kill: keep apps running on quit', j.config()?.settings?.stopAppsOnQuit === false);
      known('N4', 'the Cards view survived the kill', await j.waitFor(() => j.win.locator('.tiles .card[data-app]').count(), 10000),
        `saved prefs: ${await j.win.evaluate(() => localStorage.getItem('portpilot-ui-prefs'))}; localStorage keys: ${await j.win.evaluate(() => Object.keys(localStorage).join(','))}`);
      await j.shot('07a-apps-after-the-kill');
      await j.tab('History');
      const shopRows = await j.waitFor(async () => (await j.win.locator('.run').allTextContents()).filter((t) => /shop/i.test(t)), 10000);
      j.check(`History shows no shop run as running ${shopUp ? 'but the live one' : ''}`, shopRows && shopRows.filter((t) => /running/i.test(t)).length === (shopUp ? 1 : 0), JSON.stringify(shopRows));
      await j.shot('07b-history-after-the-kill');
      await j.tab('Browsers');
      for (const [name, port] of [['alpha', alphaPort], ['beta', betaPort]]) {
        const want = (await cdp(port)) ? 'open' : 'stopped';
        j.check(`the ${name} card reads ${want}`, await j.waitFor(async () => (await bgroup(name)) === want, 20000), await bgroup(name));
      }
      await j.shot('07-after-the-kill');
    }],

    ['end of day 3: stop everything', async () => {
      if (await j.answers(shopPort)) {
        await j.tab('Apps');
        await j.card(ids.shop).hover();
        await j.card(ids.shop).getByRole('button', { name: 'Stop', exact: true }).click();
        j.check('shop stops', await j.portFree(shopPort, 15000));
      }
      await j.tab('Browsers');
      for (const [name, port] of [['alpha', alphaPort], ['beta', betaPort]]) {
        if (!(await cdp(port))) continue;
        await bcard(name).hover();
        await bcard(name).getByRole('button', { name: 'Stop', exact: true }).click();
        j.check(`${name} stops from its card`, await j.portFree(port, 20000));
        j.check(`and its record closes`, await j.waitFor(() => openB(name).length === 0, 10000));
      }
      await notes.stop();
      j.check('nothing answers on any of the journey\'s ports', await j.waitFor(async () => [shopPort, notesPort, alphaPort, betaPort].every((p) => j.listeners(p).length === 0), 15000),
        [shopPort, notesPort, alphaPort, betaPort].map((p) => `${p}:${j.listeners(p).join('/')}`).join(' '));
      await j.shot('08-end-of-day3');
      // Brave's helpers can linger after its browser process: the kit's teardown would call them strays.
      // Measured: a lone headless Brave is gone 2 s after Browser.close; with other journeys running, over 20 s.
      const t1 = Date.now();
      const left = await j.waitFor(() => (profileProcs('alpha').length + profileProcs('beta').length === 0 ? 'none' : null), 60000);
      j.note(`Brave's processes took ${((Date.now() - t1) / 1000).toFixed(1)} s to go after its port went quiet`);
      j.check('no Brave process is left on either profile folder', left, `alpha ${profileProcs('alpha')} beta ${profileProcs('beta')}`);
      const w = j.tmp.toLowerCase().replace(/'/g, "''");
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${w}') -and -not $_.CommandLine.Contains('Get-CimInstance') } | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine.Substring(0, [Math]::Min(140, $_.CommandLine.Length)))" }`;
      try { j.note(`world processes before teardown: ${execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim() || 'none'}`); } catch { /* diagnostics only */ }
      const ours = realBrowserRuns().filter((r) => r && r.startedAt >= t0 && [alphaPort, betaPort].includes(Number(r.port)));
      j.check('the real PortPilot browser history gained no records from this journey', ours.length === 0, `${ours.length} of ours`);
    }],
  ]);
})().catch((e) => { console.error(e); process.exit(1); });
