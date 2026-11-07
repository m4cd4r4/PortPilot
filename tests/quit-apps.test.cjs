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

  // ---- quit ----
  const openRun = (id) => require('../src/core/runHistory').readRuns(cfg).filter((r) => r.appId === id && !r.stoppedAt);
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

  for (const c of children) { if (c.exitCode === null) { try { await pm.killProcess(c.pid); } catch { /* gone */ } } }
  await pm.cleanupAllProcesses();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
