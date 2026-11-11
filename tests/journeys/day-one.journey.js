/**
 * Journey A, day one: a person installs PortPilot and uses it for their first day.
 * Run: npm run build:ui && node tests/journeys/day-one.journey.js
 *
 * Fresh install (no config at all) -> add two apps through the drawer -> start one -> the other
 * crashes on start (toast, bell, Logs) -> a server started from a terminal is noticed -> a stranger
 * takes a port -> the stranger leaves -> stop everything -> quit for the night -> open it again: the
 * apps are kept and the crash is still shown -> Restart from the bell, it crashes again, Dismiss clears it.
 *
 * Every step is read from outside the app as well as on screen: the config file, runs.json,
 * netstat, an HTTP answer. Screenshots at each checkpoint (1440 and 390) go to the run's record
 * folder and are read by a person before the run is called passing.
 */
const { journey } = require('./kit');
const fs = require('fs');
const path = require('path');
const h = require('../e2e-harness');

(async () => {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const j = await journey('day-one', { ports: 3 });
  const [shopPort, blogPort, notesPort] = j.ports;
  const shopDir = j.project('shop');
  const blogDir = j.project('blog');
  const ids = {};
  let notes = null;
  let stranger = null;

  const appByName = (name) => (j.config()?.apps || []).find((a) => a.name === name);

  /** Fill and submit the Add app drawer, as a person would. */
  async function addApp({ name, cwd, command, port }) {
    const w = j.win;
    await w.click('role=button[name="Add app"]');
    const d = w.locator('role=dialog[name="Add app"]');
    await d.waitFor({ timeout: 5000 });
    // By placeholder: each label also holds its button's text (Browse, Free), so label names overlap.
    await d.getByPlaceholder('I:/Scratch/my-app').fill(cwd);
    await d.getByPlaceholder('My app').fill(name);
    await d.getByPlaceholder('npm run dev').fill(command);
    await d.getByPlaceholder('3000').fill(String(port));
    await j.blur();
    await d.getByRole('button', { name: 'Add', exact: true }).click();
    await d.waitFor({ state: 'detached', timeout: 10000 });
  }

  await j.run([
    ['fresh install: first launch with no config', async () => {
      j.check('the world starts with no config file', !fs.existsSync(path.join(j.configDir, 'portpilot-config.json')));
      await j.launch();
      await j.tab('Apps');
      const empty = await j.waitFor(() => j.win.locator('.empty-note').textContent(), 10000);
      j.check('Apps says there are no apps yet and how to add one', /No apps yet/.test(empty || ''), empty);
      j.check('the app wrote a config of its own', await j.waitFor(() => j.config(), 10000));
      await j.shot('01-first-launch');
    }],

    ['add two apps through the drawer', async () => {
      await j.win.click('role=button[name="Manage"]');
      // A person clicks into a field and reads for a moment; the app refreshes every 5 s meanwhile.
      await j.win.click('role=button[name="Add app"]');
      await j.win.locator('role=dialog[name="Add app"]').getByPlaceholder('3000').click();
      await h.sleep(6500);
      const focused = await j.win.evaluate(() => document.activeElement && document.activeElement.getAttribute('placeholder'));
      j.check('focus stays in the field the person clicked while PortPilot refreshes', focused === '3000', `focus is on "${focused}"`);
      await j.win.keyboard.press('Escape');
      await j.win.locator('role=dialog[name="Add app"]').waitFor({ state: 'detached', timeout: 5000 });
      await addApp({ name: 'shop', cwd: shopDir, command: j.command(shopPort, { title: 'Shop' }), port: shopPort });
      await addApp({ name: 'blog', cwd: blogDir, command: j.command(blogPort, { title: 'Blog', crashAfterMs: 3000, exitCode: 3 }), port: blogPort });
      const shop = appByName('shop');
      const blog = appByName('blog');
      j.check('the config file holds both apps', shop && blog, JSON.stringify((j.config()?.apps || []).map((a) => a.name)));
      j.check('shop is saved with its folder, command and port', shop && path.resolve(shop.cwd) === path.resolve(shopDir) && shop.preferredPort === shopPort && /--port/.test(shop.command), JSON.stringify(shop));
      ids.shop = shop && shop.id;
      ids.blog = blog && blog.id;
      j.check('neither app is running (nothing listens on their ports)', j.listeners(shopPort).length === 0 && j.listeners(blogPort).length === 0);
      await j.win.click('role=button[name="Done"]');
      const n = await j.waitFor(() => j.win.locator('.card[data-app]').count().then((c) => c === 2 && c), 10000);
      j.check('Apps shows a card for each', n === 2, `cards ${n}`);
      await j.shot('02-two-apps');
    }],

    ['start shop from its card', async () => {
      await j.card(ids.shop).hover();
      await j.card(ids.shop).getByRole('button', { name: 'Start' }).click();
      const page = await j.waitFor(() => j.answers(shopPort), 30000);
      j.check('shop answers on its port with its own page', page && page.status === 200 && page.title === 'Shop', JSON.stringify(page));
      j.check('the card says running', (await j.waitFor(async () => (await j.stateOf(ids.shop)) === 'running', 15000)));
      const run = await j.waitFor(() => j.runs().find((r) => r.appId === ids.shop && !r.stoppedAt), 10000);
      j.check('runs.json has an open run for shop on its port', run && Number(run.port) === shopPort, JSON.stringify(run));
    }],

    ['blog crashes on start', async () => {
      await j.card(ids.blog).hover();
      await j.card(ids.blog).getByRole('button', { name: 'Start' }).click();
      const up = await j.waitFor(() => j.answers(blogPort), 15000);
      j.check('blog answered before it crashed', up && up.title === 'Blog', JSON.stringify(up));
      j.check('then its port went quiet', await j.portFree(blogPort, 15000));
      const run = await j.waitFor(() => j.runs().find((r) => r.appId === ids.blog && r.stoppedAt), 15000);
      j.check('runs.json closed the run as a crash with exit code 3', run && run.endedBy === 'crash' && run.exitCode === 3, JSON.stringify(run && { endedBy: run.endedBy, exitCode: run.exitCode }));
      j.check('the card says crashed', await j.waitFor(async () => (await j.stateOf(ids.blog)) === 'crashed', 15000));
      const note = await j.card(ids.blog).textContent();
      j.check('and gives the exit code', /code 3/.test(note), note);
      const toast = j.win.locator(`.toast.crash[data-app="${ids.blog}"]`);
      j.check('a crash toast names the app', await j.waitFor(() => toast.isVisible(), 10000) && /blog crashed/.test(await toast.textContent()), await toast.textContent().catch(() => 'no toast'));
      const meta = await toast.locator('.toast-meta').textContent().catch(() => '');
      j.check('with its port and exit code', meta === `:${blogPort} · exit 3`, meta);
      const lines = await toast.locator('.toast-lines').textContent().catch(() => '');
      j.check('and the last output lines', /crashed on purpose/.test(lines), lines);
      j.check('offering Restart, Logs and Dismiss, no Ask Claude',
        (await toast.getByRole('button').allTextContents()).join('|') === 'Restart|Logs|Dismiss', (await toast.getByRole('button').allTextContents()).join('|'));
      j.check('the alerts bell counts the crash', await j.waitFor(async () => (await j.bellCount()) === '1', 10000), await j.bellCount());
      j.check('the runtime file stamps the crash with exit code 3', j.runtime()[ids.blog]?.crashed?.exitCode === 3, JSON.stringify(j.runtime()[ids.blog]));
      j.check('shop is unaffected', (await j.answers(shopPort))?.title === 'Shop');
      await j.shot('03-crashed');
      await toast.getByRole('button', { name: 'Logs' }).click();
      const logs = j.win.locator('role=dialog[name="blog details"]');
      j.check('Logs opens the crashed app\'s output', await j.waitFor(() => logs.isVisible(), 5000));
      await j.shot('03b-crash-logs');
      await j.win.keyboard.press('Escape');
      await logs.waitFor({ state: 'detached', timeout: 5000 });
      await toast.getByRole('button', { name: 'Dismiss' }).click();
      j.check('Dismiss closes the toast', await j.waitFor(async () => (await toast.count()) === 0, 5000));
      await h.sleep(5500); // one refresh, so a cleared state would show
      j.check('but the card and the bell keep the crash', (await j.stateOf(ids.blog)) === 'crashed' && (await j.bellCount()) === '1', `${await j.stateOf(ids.blog)} / bell ${await j.bellCount()}`);
    }],

    ['a server started from a terminal is noticed', async () => {
      notes = j.startServer('notes', notesPort, { title: 'Notes' });
      j.check('the terminal server answers', await j.waitFor(() => j.answers(notesPort), 10000));
      const run = await j.waitFor(() => j.runs().find((r) => Number(r.port) === notesPort && !r.stoppedAt), 30000);
      j.check('runs.json records it as detected', run && run.detected === true, JSON.stringify(run && { appId: run.appId, detected: run.detected, startedBy: run.startedBy }));
      j.check('under the folder it was started in', run && path.resolve(run.cwd || '') === path.resolve(notes.dir), run && run.cwd);
      j.check('named after that folder, with the folder\'s own start command', run && run.appName === 'notes' && /run dev/.test(run.startCommand || ''), run && JSON.stringify({ appName: run.appName, startCommand: run.startCommand }));
      j.check('it is not added to the app list', !appByName('notes') && (j.config()?.apps || []).length === 2);
      await j.tab('History');
      const row = await j.waitFor(async () => {
        const rows = await j.win.locator('.run').allTextContents();
        return rows.find((t) => /notes/i.test(t) && /Running/i.test(t));
      }, 15000);
      j.check('History lists notes as running', row, row);
      await j.shot('04-detected-in-history');
      await j.tab('Apps');
    }],

    ['a stranger takes blog\'s port', async () => {
      stranger = j.holdPort(blogPort);
      j.check('the stranger is listening', await j.waitFor(() => j.listeners(blogPort).length > 0, 5000));
      // A taken port is reported at Start only. Prove the scan sees the stranger, give the 5 s
      // refresh time to show it, then check nothing on screen changed: blog still reads crashed
      // (its last real state) and the bell still counts that one crash.
      j.check('PortPilot\'s scan sees the stranger', await j.waitFor(() => j.win.evaluate(async (p) => ((await window.portpilot.ports.scanWithApps()).unknownConflicts || []).some((c) => c.port === p), blogPort), 30000));
      await h.sleep(6500);
      j.check('the blog card still reads crashed, not blocked', (await j.stateOf(ids.blog)) === 'crashed', await j.stateOf(ids.blog));
      const row = await j.card(ids.blog).textContent();
      j.check('and says nothing about the port being held', !/held/i.test(row), row);
      j.check('the alerts bell still counts the crash alone', (await j.bellCount()) === '1', await j.bellCount());
      await j.shot('05-port-held');
      console.log('  a person presses Start on the app');
      await j.card(ids.blog).hover();
      await j.card(ids.blog).getByRole('button', { name: 'Start' }).click();
      const said = await j.waitFor(() => j.win.locator('.tile-notice, [role="alert"]').first().textContent(), 5000);
      j.check('PortPilot says why it cannot start', said && /held/i.test(said), said);
      await j.shot('05b-start-blocked');
      await h.sleep(1500);
      j.check('PortPilot did not kill the stranger', h.alive(stranger.child.pid) && j.listeners(blogPort).includes(stranger.child.pid));
      j.check('and did not start blog over it', !j.runs().some((r) => r.appId === ids.blog && !r.stoppedAt));
    }],

    ['the stranger leaves', async () => {
      await stranger.stop();
      j.check('blog\'s port is free again', await j.portFree(blogPort));
      // A named state: a missing card reads as null and must not pass.
      j.check('the card still reads crashed (its last real state)', await j.waitFor(async () => (await j.stateOf(ids.blog)) === 'crashed', 30000), await j.stateOf(ids.blog));
      j.check('the bell holds the crash alone', await j.waitFor(async () => {
        if ((await j.bellCount()) !== '1') return false;
        await j.win.locator('.bell:visible').first().click();
        const kinds = await j.win.locator('.alerts-pop li').evaluateAll((els) => els.map((e) => e.getAttribute('data-alert')));
        await j.win.keyboard.press('Escape');
        return kinds.join() === 'crash';
      }, 15000), await j.bellCount());
    }],

    ['stop shop and the terminal server', async () => {
      await j.card(ids.shop).hover();
      await j.card(ids.shop).getByRole('button', { name: 'Stop' }).click();
      j.check('shop\'s port goes quiet', await j.portFree(shopPort, 15000));
      const run = await j.waitFor(() => j.runs().find((r) => r.appId === ids.shop && r.stoppedAt), 10000);
      j.check('runs.json closes shop\'s run as stopped', run && run.endedBy === 'stop', run && run.endedBy);
      await notes.stop();
      j.check('the terminal server is gone', await j.portFree(notesPort));
      const nrun = await j.waitFor(() => j.runs().find((r) => Number(r.port) === notesPort && r.stoppedAt), 30000);
      j.check('its detected run closes on its own', nrun, nrun && nrun.endedBy);
      await j.shot('06-end-of-day');
    }],

    ['quit for the night, open it again', async () => {
      const before = JSON.stringify((j.config()?.apps || []).map((a) => [a.id, a.name, a.command, a.preferredPort]));
      const pid = j.app.process().pid;
      await j.quit();
      // While PortPilot is down, leave an 8-day-old crash stamp for shop, as an older version would have.
      const rtPath = path.join(j.configDir, 'portpilot-runtime.json');
      const rt = JSON.parse(fs.readFileSync(rtPath, 'utf8'));
      rt.apps[ids.shop] = { crashed: { exitCode: 9, at: Date.now() - 8 * 24 * 3600 * 1000, port: shopPort, startedBy: null, errorTail: null } };
      fs.writeFileSync(rtPath, JSON.stringify(rt, null, 2));
      j.check('PortPilot has exited', !h.alive(pid));
      j.check('nothing is left listening on the journey\'s ports', j.ports.every((p) => j.listeners(p).length === 0), j.ports.map((p) => `${p}:${j.listeners(p).join('/')}`).join(' '));
      await j.launch();
      await j.tab('Apps');
      const n = await j.waitFor(() => j.win.locator('.card[data-app]').count().then((c) => c === 2 && c), 15000);
      j.check('both apps are still there', n === 2, `cards ${n}`);
      const after = JSON.stringify((j.config()?.apps || []).map((a) => [a.id, a.name, a.command, a.preferredPort]));
      j.check('their saved settings are unchanged', before === after);
      j.check('none of them is running', ['shop', 'blog'].every((k) => j.listeners(k === 'shop' ? shopPort : blogPort).length === 0));
      const open = j.runs().filter((r) => !r.stoppedAt);
      j.check('runs.json has no run left open', open.length === 0, open.map((r) => r.appName || r.appId).join(', '));
      j.check('blog still reads crashed after the relaunch', await j.waitFor(async () => (await j.stateOf(ids.blog)) === 'crashed', 15000), await j.stateOf(ids.blog));
      j.check('with its exit code', /code 3/.test(await j.card(ids.blog).textContent()));
      j.check('a crash stamp over a week old does not show: shop reads stopped', (await j.stateOf(ids.shop)) === 'stopped', await j.stateOf(ids.shop));
      j.check('and the bell still counts it',await j.waitFor(async () => (await j.bellCount()) === '1', 10000), await j.bellCount());
      await j.shot('07-next-morning');
    }],

    ['restart blog from the bell, then dismiss its crash', async () => {
      await j.win.locator('.bell:visible').first().click();
      await j.win.locator('.alerts-pop li[data-alert="crash"]').getByRole('button', { name: 'Restart' }).click();
      const up = await j.waitFor(() => j.answers(blogPort), 15000);
      j.check('Restart starts blog again', up && up.title === 'Blog', JSON.stringify(up));
      const toast = j.win.locator(`.toast.crash[data-app="${ids.blog}"]`);
      j.check('it crashes again and a fresh toast says so', await j.waitFor(() => toast.isVisible(), 20000));
      const runs = j.runs().filter((r) => r.appId === ids.blog && r.endedBy === 'crash');
      j.check('runs.json now holds two crashed runs for blog', runs.length === 2, `${runs.length}`);
      await toast.getByRole('button', { name: 'Dismiss' }).click();
      await j.win.locator('.bell:visible').first().click();
      await j.win.locator('.alerts-pop li[data-alert="crash"]').getByRole('button', { name: 'Dismiss' }).click();
      j.check('Dismiss in the bell clears the crash: the card reads stopped', await j.waitFor(async () => (await j.stateOf(ids.blog)) === 'stopped', 10000), await j.stateOf(ids.blog));
      j.check('the bell is empty', await j.waitFor(async () => (await j.bellCount()) === '', 10000), await j.bellCount());
      j.check('the runtime file no longer holds the stamp', !j.runtime()[ids.blog], JSON.stringify(j.runtime()[ids.blog]));
      await j.shot('08-crash-dismissed');
    }],
  ]);
})().catch((e) => { console.error(e); process.exit(1); });
