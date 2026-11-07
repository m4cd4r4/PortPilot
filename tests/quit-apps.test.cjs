/**
 * Quit and PortPilot-started apps (product decision 2026-11-07): quit keeps them running unless
 * "Stop PortPilot-started apps on quit" is ticked, and a server started in an earlier session (left
 * running, adopted on relaunch) can still be stopped (F42).
 * Run: node tests/quit-apps.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-quit-apps-'));

(async () => {
  await t('a new config does not stop apps on quit', () => {
    const { ConfigStore } = require('../src/main/configStore');
    const store = new ConfigStore(null, path.join(dir, 'portpilot-config.json'));
    try { assert.equal(store.getSettings().stopAppsOnQuit, false); } finally { store.close(); }
  });
  const { ConfigStore } = require('../src/main/configStore');
  const openStore = (file) => new ConfigStore(null, file);
  await t('F101: a config saved before this update with stop-on-quit ticked (the old default) is reset to off once', () => {
    const file = path.join(dir, 'old-config.json');
    fs.writeFileSync(file, JSON.stringify({ apps: [], groups: [], settings: { stopAppsOnQuit: true, closeToTray: true } }));
    const s = openStore(file);
    try { assert.equal(s.getSettings().stopAppsOnQuit, false); } finally { s.close(); }
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')).settings;
    assert.equal(onDisk.stopAppsOnQuit, false, JSON.stringify(onDisk));
    assert.equal(onDisk.closeToTray, true, 'another setting changed');
  });
  await t('F101: ticked after the reset, it stays ticked across relaunches', () => {
    const file = path.join(dir, 'old-config.json'); // migrated by the test above
    const a = openStore(file);
    try { a.updateSettings({ stopAppsOnQuit: true }); } finally { a.close(); }
    for (let launch = 0; launch < 2; launch++) {
      const b = openStore(file);
      try { assert.equal(b.getSettings().stopAppsOnQuit, true, `reset on relaunch ${launch + 1}`); } finally { b.close(); }
    }
  });

  const quit = require('../src/main/quitApps');
  await t('a config that never set it keeps apps on quit; only a saved true stops them', () => {
    assert.deepEqual([{}, { stopAppsOnQuit: false }, { stopAppsOnQuit: true }, null].map(quit.stopsAppsOnQuit), [false, false, true, false]);
  });

  // ---- adopted: a server an earlier session started (shell 100 -> npm 200 -> node 300 on the port) ----
  const adopted = require('../src/main/adoptedApps');
  const at = Date.parse('2026-11-07T01:00:00.000Z');
  const entry = { startedBy: { kind: 'human', surface: 'desktop', at: new Date(at).toISOString() }, pid: 100, port: 4100 };
  const tree = [{ pid: 100, ppid: 1, created: at - 600 }, { pid: 200, ppid: 100, created: at - 400 }, { pid: 300, ppid: 200, created: at - 200 }];
  await t('adopted: the listener under the recorded shell, started with it, is ours', () => {
    assert.deepEqual(adopted.verifyAdopted({ entry, listenerPid: 300, procs: tree }), { ok: true, pid: 100 });
  });
  await t('adopted: a shell pid reused by a later process is not ours, nor is anything under it', () => {
    const reused = [{ pid: 100, ppid: 1, created: at + 3600000 }, { pid: 300, ppid: 100, created: at + 3600500 }];
    assert.equal(adopted.verifyAdopted({ entry, listenerPid: 300, procs: reused }).ok, false);
  });
  await t('adopted: a stranger whose parent pid was the shell\'s before the shell existed is not ours', () => {
    const stranger = [tree[0], { pid: 700, ppid: 100, created: at - 86400000 }, { pid: 800, ppid: 700, created: at + 60000 }];
    assert.equal(adopted.verifyAdopted({ entry, listenerPid: 800, procs: stranger }).ok, false);
  });
  await t('adopted: the shell died with the quit; its orphaned server, started with it, is ours: the top of the chain is killed', () => {
    // Measured in the restarts journey: the cmd.exe PortPilot spawned is gone after a quit, its server is not.
    assert.deepEqual(adopted.verifyAdopted({ entry, listenerPid: 300, procs: tree.slice(1) }), { ok: true, pid: 200 });
  });
  await t('adopted: with the shell gone, a listener older than the start whose parent pid matches is not ours', () => {
    const old = [{ pid: 300, ppid: 100, created: at - 3600000 }];
    assert.equal(adopted.verifyAdopted({ entry, listenerPid: 300, procs: old }).ok, false);
  });
  await t('F94: with the shell gone, a chain top whose parent pid matches but was created an hour after the start is not ours', () => {
    // A later process handed the dead shell's pid as its parent (pid reuse), then started a listener.
    const later = [{ pid: 300, ppid: 100, created: at + 3600000 }];
    assert.equal(adopted.verifyAdopted({ entry, listenerPid: 300, procs: later }).ok, false);
  });

  const tree2 = require('../src/main/processTree');
  await t('F99: a Windows process with no CreationDate is kept, with created null (and so is never verified)', () => {
    const procs = tree2.parseProcessList('4 0 \r\n100 4 1762477200000\r\n', 'win32');
    assert.deepEqual(procs, [{ pid: 4, ppid: 0, created: null }, { pid: 100, ppid: 4, created: 1762477200000 }]);
  });

  await t('F95: ps elapsed time as macOS and Linux both print it ([[dd-]hh:]mm:ss) gives the start time', () => {
    const now = Date.parse('2026-11-07T12:00:00.000Z');
    const procs = tree2.parseProcessList('  1     0 1-02:03:04\n 200     1    05:06\n 300   200 01:02:03\n', 'darwin', now);
    assert.deepEqual(procs.map((p) => [p.pid, p.ppid, (now - p.created) / 1000]), [[1, 0, 93784], [200, 1, 306], [300, 200, 3723]]);
  });

  await t('F96: Unix Stop on an adopted app signals the whole tree deepest first, SIGKILLs what ignores SIGTERM, and succeeds only once the port is free', async () => {
    const run = async ({ freesPort }) => {
      const sent = [];
      const dead = new Set();
      const deps = {
        platform: 'linux',
        readRuntime: () => ({ apps: { a: entry } }),
        snap: { procs: tree, listenerOf: () => 300 },
        signal: (pid, sig) => { sent.push(`${sig} ${pid}`); if (sig === 'SIGKILL' || pid !== 300) dead.add(pid); },
        alive: (pid) => !dead.has(pid), // 300 (the server) ignores SIGTERM
        graceMs: 200,
        scanPorts: async () => [freesPort && dead.has(300) ? { port: 9999, pid: 9 } : { port: entry.port, pid: 300 }],
        freeWithinMs: 300,
      };
      return { r: await adopted.stopAdopted('cfg', 'a', deps), sent };
    };
    const ok = await run({ freesPort: true });
    assert.deepEqual(ok.sent, ['SIGTERM 300', 'SIGTERM 200', 'SIGTERM 100', 'SIGKILL 300']);
    assert.equal(ok.r.success, true, JSON.stringify(ok.r));
    const held = await run({ freesPort: false });
    assert.equal(held.r.success, false, 'reported success while the port was still held');
  });

  // reconcileStale against a fake OS: tree is shell 100 -> npm 200 -> node 300; 9 is unrelated on 9999.
  const reconcileWith = async (e, { procs = tree, ports = [] } = {}) => {
    const gone = [];
    await adopted.reconcileStale('cfg', { before: at + 60000, deps: {
      readRuntime: () => ({ apps: { app: e } }),
      recordGone: (_c, id) => { gone.push(id); return true; },
      listProcesses: async () => [...procs, { pid: 9, ppid: 0, created: at - 1e7 }],
      scanPorts: async () => [...ports, { port: 9999, pid: 9 }],
    } });
    return gone;
  };
  await t('F102: launch keeps a start whose server is alive but not bound yet (slow compile, nodemon restart), shell gone', async () => {
    assert.deepEqual(await reconcileWith(entry, { procs: tree.slice(1) }), []);
  });
  await t('F102: launch keeps a start whose server bound a fallback port (Vite 5174 for a recorded 5173)', async () => {
    assert.deepEqual(await reconcileWith(entry, { ports: [{ port: entry.port + 1, pid: 300 }] }), []);
  });
  await t('F102: launch never drops a start that recorded no port (an app with no preferredPort), even with its shell gone', async () => {
    assert.deepEqual(await reconcileWith({ ...entry, port: null }, { procs: [] }), []);
  });
  await t('F102: launch still drops a start whose shell and children are all gone and whose port is quiet', async () => {
    assert.deepEqual(await reconcileWith(entry, { procs: [] }), ['app']);
  });
  await t('F105: the quit snapshot caps the port scan as well as the process list', async () => {
    const seen = {};
    await adopted.snapshot({ listProcesses: async (o) => { seen.procs = o; return tree; }, scanPorts: async (o) => { seen.ports = o; return [{ port: 1, pid: 9 }]; } }, { timeoutMs: 4000 });
    assert.deepEqual(seen, { procs: { timeoutMs: 4000 }, ports: { timeoutMs: 4000 } });
  });
  await t('F103: Stop never clears an adopted app when the port scan failed (an empty netstat), even with its shell gone', async () => {
    const gone = [];
    const r = await adopted.stopAdopted('cfg', 'app', { readRuntime: () => ({ apps: { app: entry } }), recordGone: (_c, id) => gone.push(id),
      scanPorts: async () => [], listProcesses: async () => tree.slice(1) });
    assert.equal(r.success, false, JSON.stringify(r));
    assert.deepEqual(gone, []);
  });
  await t('F103: after the kill, a failed port scan is not read as a free port', async () => {
    let scans = 0;
    let checks = 0; // checkPort is scanPorts().find(): a failed scan reads as null, i.e. "free"
    const r = await adopted.stopAdopted('cfg', 'app', { readRuntime: () => ({ apps: { app: entry } }), platform: 'win32',
      killProcess: async () => ({ success: true }), listProcesses: async () => tree, freeWithinMs: 300,
      scanPorts: async () => (scans++ === 0 ? [{ port: entry.port, pid: 300 }] : []),
      checkPort: async () => (checks++ === 0 ? { port: entry.port, pid: 300 } : null) });
    assert.equal(r.success, false, JSON.stringify(r));
  });

  // A runtime file of four starts, and a quit that records what it would stop.
  const fakeQuit = () => {
    const mk = (surface) => ({ startedBy: { kind: 'human', surface, at: new Date(at).toISOString() }, pid: 1, port: 1 });
    const calls = { stopped: [], snaps: [], snapArgs: [] };
    const deps = {
      cleanupAllProcesses: async () => {},
      readRuntime: () => ({ apps: { win: mk('desktop'), portal: mk('web'), ext: mk('vscode'), claude: mk('mcp') } }),
      recordStop: () => {},
      snapshot: async (_d, o) => { calls.snaps.push(o); return { procs: [], listenerOf: () => null }; },
      stopAdopted: async (_c, id, d) => { calls.stopped.push(id); calls.snapArgs.push(d && d.snap); return { success: true }; },
    };
    return { calls, deps };
  };
  await t('F98: quit with the setting on also stops apps started from the web portal (the desktop process serves it), never VS Code or MCP starts', async () => {
    const { calls, deps } = fakeQuit();
    await quit.stopAppsForQuit({ stopAppsOnQuit: true }, 'cfg', deps);
    assert.deepEqual(calls.stopped.sort(), ['portal', 'win']);
  });
  await t('F97: quit reads the OS once for every adopted app, with a process-list timeout inside the 10 s quit hold', async () => {
    const { calls, deps } = fakeQuit();
    await quit.stopAppsForQuit({ stopAppsOnQuit: true }, 'cfg', deps);
    assert.equal(calls.snaps.length, 1, `${calls.snaps.length} snapshots`);
    assert.ok(calls.snaps[0].timeoutMs > 0 && calls.snaps[0].timeoutMs < 10000, JSON.stringify(calls.snaps[0]));
    assert.ok(calls.snapArgs.length === 2 && calls.snapArgs.every((s) => s && Array.isArray(s.procs)), 'a stop did its own OS read');
  });

  await t('F100: the legacy Settings shows the same label and hint as the React one (off by default, picked up next launch)', () => {
    const tsx = fs.readFileSync(path.join(__dirname, '../ui/src/components/Settings.tsx'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
    const row = /key: 'stopAppsOnQuit', label: '([^']+)', hint: '([^']+)'/.exec(tsx);
    assert.ok(row, 'React row not found');
    const legacy = /<label class="setting-row"[^>]*title="([^"]+)"[^>]*>\s*<span>([^<]+)<\/span>\s*<input type="checkbox" id="setting-stop-apps-on-quit">/.exec(html);
    assert.ok(legacy, 'legacy row has no hint');
    assert.deepEqual([legacy[2].trim(), legacy[1]], [row[1], row[2]]);
    assert.ok(/web portal/.test(row[2]) && /next time/.test(row[2]), row[2]);
  });

  // ---- real processes: a server an "earlier session" started, unknown to this processManager ----
  const { exec } = require('child_process');
  const net = require('net');
  const cf = require('../src/core/configFile');
  const status = require('../src/core/status');
  const { checkPort } = require('../src/main/portScanner');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const cfg = path.join(dir, 'portpilot-config.json');
  const human = () => status.makeStartedBy({ kind: 'human', surface: 'desktop' }); // fresh per start, as the desktop stamps it
  const children = [];
  /** A server under its own shell, stamped in the runtime file as a desktop start. Returns its port. */
  async function earlierSession(id, { stamp = true } = {}) {
    const port = await freePort();
    const child = exec(`node -e "require('http').createServer((q, s) => s.end('${id}')).listen(${port})"`, { windowsHide: true });
    children.push(child);
    for (let i = 0; i < 40 && !(await checkPort(port)); i++) await sleep(150);
    if (stamp) cf.recordStart(cfg, id, human(), { pid: child.pid, port });
    return port;
  }
  const portGone = async (port) => { for (let i = 0; i < 40; i++) { if (!(await checkPort(port))) return true; await sleep(150); } return false; };

  await t('adopted: Stop on a server an earlier session started frees its port', async () => {
    const port = await earlierSession('adopted-stop');
    const r = await adopted.stopAdopted(cfg, 'adopted-stop');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(await portGone(port), 'port still held');
  });
  await t('adopted: Stop reaches the orphaned server when its shell died (as after a real quit)', async () => {
    const port = await earlierSession('orphan');
    const shellPid = cf.readRuntime(cfg).apps.orphan.pid;
    process.kill(shellPid); // the shell only: its server lives on, as the restarts journey saw
    await sleep(500);
    assert.ok(await checkPort(port), 'the server died with its shell');
    const r = await adopted.stopAdopted(cfg, 'orphan');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(await portGone(port), 'port still held');
  });
  await t('adopted: a stranger on the recorded port is never killed', async () => {
    const port = await earlierSession('stranger', { stamp: false });
    const other = exec('node -e "setInterval(() => {}, 1000)"', { windowsHide: true });
    children.push(other);
    cf.recordStart(cfg, 'stranger', human(), { pid: other.pid, port });
    const r = await adopted.stopAdopted(cfg, 'stranger');
    assert.equal(r.success, false, JSON.stringify(r));
    await sleep(500);
    assert.ok(await checkPort(port), 'the stranger was killed');
  });
  const pm = require('../src/main/processManager');
  await t('Stop (processManager.stopApp) reaches an adopted server when given the config path', async () => {
    const port = await earlierSession('adopted-card');
    const r = await pm.stopApp('adopted-card', { configPath: cfg });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(await portGone(port), 'port still held');
  });

  const runHistory = require('../src/core/runHistory');
  const openRun = (id) => runHistory.readRuns(cfg).filter((r) => r.appId === id && !r.stoppedAt);
  const lastRun = (id) => runHistory.readRuns(cfg).filter((r) => r.appId === id).pop();
  await t('F93: on launch, a desktop start whose server is gone loses its entry and its run closes as unknown; a live one and an MCP start stay', async () => {
    const livePort = await earlierSession('still-up');
    const gonePort = await earlierSession('gone');
    const goneShell = cf.readRuntime(cfg).apps.gone.pid;
    const holder = await checkPort(gonePort);
    await pm.killProcess(goneShell); await pm.killProcess(holder.pid); // died while PortPilot was closed (a reboot)
    assert.ok(await portGone(gonePort), 'gone still answers');
    cf.recordStart(cfg, 'via-mcp', status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: '11111111-2222-3333-4444-555555555555' }), { port: gonePort });
    const dropped = await adopted.reconcileStale(cfg, { before: Date.now() });
    const rt = cf.readRuntime(cfg).apps;
    // The earlier tests' stopped servers left entries too (the test calls no recordStop): stale as well.
    assert.ok(dropped.includes('gone') && !dropped.includes('still-up') && !dropped.includes('via-mcp'), JSON.stringify(dropped));
    assert.ok(!rt.gone, 'the stale entry is still there');
    assert.equal(lastRun('gone').endedBy, 'unknown', JSON.stringify(lastRun('gone')));
    assert.ok(rt['still-up']?.startedBy && openRun('still-up').length === 1, 'the live adopted app lost its entry or run');
    assert.ok(rt['via-mcp']?.startedBy, 'the MCP start was touched');
    assert.ok(await checkPort(livePort), 'the live adopted server was stopped');
    await adopted.stopAdopted(cfg, 'still-up');
    cf.recordStop(cfg, 'via-mcp');
  });

  await t('F93: Stop on an adopted app whose server and shell are both gone says it was not running and clears it', async () => {
    const port = await earlierSession('dead-adopted');
    const holder = await checkPort(port);
    await pm.killProcess(cf.readRuntime(cfg).apps['dead-adopted'].pid); await pm.killProcess(holder.pid);
    assert.ok(await portGone(port), 'still answers');
    const r = await adopted.stopAdopted(cfg, 'dead-adopted');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.ok(r.notRunning && /was not running/.test(r.message), JSON.stringify(r));
    assert.ok(!cf.readRuntime(cfg).apps['dead-adopted'], 'entry left');
    assert.equal(lastRun('dead-adopted').endedBy, 'unknown');
  });

  // ---- quit ----
  /** An app this session started, as the desktop's Start does. Returns its port. */
  async function thisSession(id) {
    const port = await freePort();
    const r = await pm.startApp({ id, name: id, command: `node -e "require('http').createServer().listen(${port})"`, preferredPort: port });
    assert.equal(r.success, true, JSON.stringify(r));
    cf.recordStart(cfg, id, human(), { pid: r.pid, port });
    for (let i = 0; i < 40 && !(await checkPort(port)); i++) await sleep(150);
    return port;
  }
  let keptPort = 0;
  await t('quit with the setting off stops nothing: the server answers, its run and runtime entry stay', async () => {
    keptPort = await thisSession('kept');
    await quit.stopAppsForQuit({}, cfg);
    await sleep(500);
    assert.ok(await checkPort(keptPort), 'the server was stopped');
    assert.ok(cf.readRuntime(cfg).apps.kept?.startedBy, 'runtime entry dropped');
    assert.equal(openRun('kept').length, 1, 'run closed');
  });
  await t('quit with the setting on stops this session\'s app and an adopted one, records both stops, leaves a VS Code start alone', async () => {
    const adoptedPort = await earlierSession('adopted-quit');
    const vsPort = await earlierSession('from-vscode', { stamp: false });
    cf.recordStart(cfg, 'from-vscode', status.makeStartedBy({ kind: 'human', surface: 'vscode' }), { pid: children[children.length - 1].pid, port: vsPort });
    await quit.stopAppsForQuit({ stopAppsOnQuit: true }, cfg);
    assert.ok(await portGone(keptPort), 'this session\'s app still answers');
    assert.ok(await portGone(adoptedPort), 'the adopted app still answers');
    const rt = cf.readRuntime(cfg).apps;
    assert.ok(!rt.kept && !rt['adopted-quit'], `runtime entries left: ${Object.keys(rt)}`);
    assert.equal(openRun('kept').length + openRun('adopted-quit').length, 0, 'a run is still open');
    assert.ok(await checkPort(vsPort), 'the VS Code-started server was stopped');
    assert.ok(rt['from-vscode']?.startedBy, 'the VS Code start lost its entry');
  });

  // ---- F92: a server left running by quit keeps logging after PortPilot is gone ----
  await t('F92: an app this session started keeps answering, and logging, after the PortPilot process exits', async () => {
    const port = await freePort();
    const srv = path.join(dir, 'chatty.js');
    fs.writeFileSync(srv, `require('http').createServer((q, s) => { console.log('GET', q.url); console.error('served', q.url); s.end('ok'); }).listen(${port}, () => console.log('listening'));`);
    const parent = path.join(dir, 'parent.js');
    fs.writeFileSync(parent, `const pm = require(${JSON.stringify(path.join(__dirname, '../src/main/processManager'))});
if (pm.setLogConfigPath) pm.setLogConfigPath(${JSON.stringify(cfg)});
pm.startApp({ id: 'chatty', name: 'chatty', command: 'node ' + JSON.stringify(${JSON.stringify(srv)}), preferredPort: ${port} })
  .then((r) => { console.log(JSON.stringify(r)); setTimeout(() => process.exit(0), 1500); });`);
    const { spawn } = require('child_process');
    const p = spawn(process.execPath, [parent], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    await new Promise((r) => p.on('exit', r)); // PortPilot is gone, as after a quit that keeps apps
    const get = async () => { try { return (await fetch(`http://127.0.0.1:${port}/x`, { signal: AbortSignal.timeout(2000) })).status; } catch { return 0; } };
    const answers = [];
    for (let i = 0; i < 3; i++) { answers.push(await get()); await sleep(300); }
    const holder = await checkPort(port);
    if (holder && holder.pid) await pm.killProcess(holder.pid);
    assert.deepEqual(answers, [200, 200, 200], `parent said ${out.trim()}`);
    const log = cf.readLogTail(cfg, 'chatty') || '';
    assert.ok(/GET \/x/.test(log) && /served \/x/.test(log), `log file: ${JSON.stringify(log)}`);
    pm.setLogConfigPath(cfg); // the in-app log of an app this process never started reads the same file
    assert.ok(/GET \/x/.test(pm.getAppLogs('chatty').stdout), JSON.stringify(pm.getAppLogs('chatty')));
  });
  await t('F104: a new Start appends to the log (an older copy may still write it); its errors come from this run only', async () => {
    pm.setLogConfigPath(cfg);
    const file = cf.logPathFor(cfg, 'appender');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'older run still writing\n');
    const r = await pm.startApp({ id: 'appender', name: 'appender', command: 'node -e "console.error(\'second run failed\'); process.exit(3)"' });
    assert.equal(r.success, false, JSON.stringify(r));
    assert.ok(/second run failed/.test(r.error) && !/older run/.test(r.error), r.error);
    const body = fs.readFileSync(file, 'utf8');
    assert.ok(/older run still writing/.test(body) && /second run failed/.test(body), JSON.stringify(body));
  });
  await t('F104: a log over 10 MB is moved to <id>.log.1 at Start, so appending never grows it without bound', async () => {
    const file = cf.logPathFor(cfg, 'big');
    fs.writeFileSync(file, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    await pm.startApp({ id: 'big', name: 'big', command: 'node -e "console.log(\'fresh\')"' });
    assert.equal(fs.statSync(`${file}.1`).size, 10 * 1024 * 1024 + 1, 'not rotated');
    assert.ok(fs.statSync(file).size < 1000, `${fs.statSync(file).size} bytes left in the live log`);
  });

  for (const c of children) { if (c.exitCode === null) { try { await pm.killProcess(c.pid); } catch { /* gone */ } } }
  await pm.cleanupAllProcesses();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
