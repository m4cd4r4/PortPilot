/**
 * The localhost watcher's state machine (src/main/localhostWatcher.js) with a fake
 * scanner, probe and matcher over a real temp history: debounce, close, restart reuse,
 * startup reconcile, the setting, failure containment.
 * Run: node tests/localhost-watcher.test.cjs   (part of npm run test:unit)
 * Temp config dirs only; nothing is scanned or probed for real.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLocalhostWatcher } = require('../src/main/localhostWatcher');
const runHistory = require('../src/core/runHistory');
const { detectedAppId } = require('../src/core/localhostDetect');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-watch-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const NODE = (port, over = {}) => ({ port, pid: port, address: `127.0.0.1:${port}`, processName: 'node.exe', commandLine: 'node server.js', ...over });
const SYSTEM = { port: 135, pid: 4, address: '0.0.0.0:135', processName: 'svchost.exe', commandLine: '' };

// A watcher over a fresh config dir. `world.ports` is what the next scan returns.
function setup(over = {}) {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'portpilot-config.json');
  const apps = [{ id: 'app_shop', name: 'shop-web', command: 'npm run dev', cwd: dir, preferredPort: 3111 }];
  fs.writeFileSync(configPath, JSON.stringify({ apps, settings: {}, groups: [] }));
  const world = { ports: [SYSTEM, NODE(3111)], owned: new Set(), answers: {}, settings: {}, scanFails: false, probed: [], started: new Set() };
  const watcher = createLocalhostWatcher({
    configPath,
    getSettings: () => world.settings,
    getApps: () => [],
    scan: async () => { if (world.scanFails) throw new Error('netstat blew up'); return world.ports; },
    registeredPorts: async () => world.owned,
    probe: async (port, p, ms, host) => { world.probed.push([port, host]); return world.answers[port] || 'healthy'; },
    startCommandFor: async () => 'npm run dev',
    startedByPortPilot: (id) => world.started.has(id),
    log: () => {},
    ...over,
  });
  const runs = () => runHistory.readRuns(configPath);
  const ticks = async (k) => { for (let i = 0; i < k; i++) await watcher.tick(); };
  return { world, watcher, runs, ticks, configPath };
}

(async () => {
  await t('a server must answer on two scans in a row before a run opens', async () => {
    const s = setup();
    await s.ticks(1);
    assert.equal(s.runs().length, 0);
    await s.ticks(1);
    const [run] = s.runs();
    assert.equal(s.runs().length, 1);
    assert.equal(run.detected, true);
    assert.equal(run.port, 3111);
    assert.equal(run.appName, 'node server.js');
    assert.equal(run.startCommand, null, 'no folder on the command line: nothing to read a script from');
    assert.equal(run.startedBy.kind, 'detected');
    assert.equal(run.appId, detectedAppId(null, 'node server.js', 3111));
    assert.equal(run.stoppedAt, null);
    await s.ticks(3);
    assert.equal(s.runs().length, 1, 'no second run while it stays up');
  });

  await t('a port that does not answer HTTP never opens a run, and its count starts over', async () => {
    const s = setup();
    s.world.answers[3111] = 'down';
    await s.ticks(4);
    assert.equal(s.runs().length, 0);
    s.world.answers[3111] = 'healthy';
    await s.ticks(1);
    assert.equal(s.runs().length, 0, 'one answer after the silence is not two in a row');
    await s.ticks(1);
    assert.equal(s.runs().length, 1);
  });

  await t('a 404 still counts as an answer', async () => {
    const s = setup();
    s.world.answers[3111] = 'unhealthy';
    await s.ticks(2);
    assert.equal(s.runs().length, 1);
  });

  await t('ports a registered app owns, browsers and non-servers are never recorded', async () => {
    const s = setup();
    s.world.owned = new Set([3111]);
    s.world.ports = [SYSTEM, NODE(3111), NODE(3112, { processName: 'brave.exe' }), NODE(3113, { commandLine: 'node mcp-server/index.js' }), NODE(80, { address: '0.0.0.0:80' }), NODE(8788)];
    await s.ticks(4);
    assert.equal(s.runs().length, 0);
    assert.deepEqual(s.world.probed, [], 'nothing skipped is even probed');
  });

  await t('the probe only ever asks loopback', async () => {
    const s = setup();
    s.world.ports = [SYSTEM, NODE(3111, { address: '[::1]:3111' }), NODE(3112, { address: '0.0.0.0:3112' })];
    await s.ticks(2);
    for (const [, host] of s.world.probed) assert.ok(host === '127.0.0.1' || host === '::1', host);
    assert.ok(s.world.probed.some(([p, h]) => p === 3111 && h === '::1'));
    assert.ok(s.world.probed.some(([p, h]) => p === 3112 && h === '127.0.0.1'));
  });

  await t('a run closes after the port is gone for two scans, not one', async () => {
    const s = setup();
    await s.ticks(2);
    s.world.ports = [SYSTEM];
    await s.ticks(1);
    assert.equal(s.runs()[0].stoppedAt, null);
    await s.ticks(1);
    assert.ok(s.runs()[0].stoppedAt);
    assert.equal(s.runs()[0].endedBy, 'stop');
  });

  await t('one missed scan does not close a run', async () => {
    const s = setup();
    await s.ticks(2);
    s.world.ports = [SYSTEM];
    await s.ticks(1);
    s.world.ports = [SYSTEM, NODE(3111)];
    await s.ticks(3);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].stoppedAt, null);
  });

  await t('a restart within 60 s of the close reuses the run', async () => {
    const s = setup();
    await s.ticks(2);
    const first = s.runs()[0].id;
    s.world.ports = [SYSTEM];
    await s.ticks(2);
    assert.ok(s.runs()[0].stoppedAt);
    s.world.ports = [SYSTEM, NODE(3111)];
    await s.ticks(2);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].id, first);
    assert.equal(s.runs()[0].stoppedAt, null);
  });

  await t('the same port taken by another project closes the old run and opens a new one', async () => {
    const s = setup();
    await s.ticks(2);
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: 'python app.py' })];
    await s.ticks(2);
    const runs = s.runs();
    assert.equal(runs.length, 2);
    assert.equal(runs.filter((r) => !r.stoppedAt).length, 1);
    assert.equal(runs.find((r) => !r.stoppedAt).appName, 'python app.py');
  });

  await t('startup: a detected run whose server is still up is adopted, one whose server is gone is closed as unknown', async () => {
    const s = setup();
    const up = detectedAppId(null, 'node server.js', 3111);
    const gone = detectedAppId(null, 'node old.js', 3999);
    const meta = (name) => ({ name, cwd: null, command: name, startCommand: null });
    const by = { kind: 'detected', surface: 'desktop', at: new Date().toISOString() };
    const adopted = runHistory.openRun(s.configPath, up, by, { port: 3111, meta: meta('node server.js') });
    runHistory.openRun(s.configPath, gone, by, { port: 3999, meta: meta('node old.js') });
    await s.ticks(1);
    const byApp = Object.fromEntries(s.runs().map((r) => [r.appId, r]));
    assert.equal(s.runs().length, 2, 'no duplicate for the adopted run');
    assert.equal(byApp[up].id, adopted.id);
    assert.equal(byApp[up].stoppedAt, null);
    assert.equal(byApp[gone].endedBy, 'unknown');
    await s.ticks(1);
    assert.equal(s.runs().length, 2);
    assert.ok(s.watcher.state().open[up]);
  });

  await t('turning the setting off closes the open runs and stops recording; on again resumes', async () => {
    const s = setup();
    await s.ticks(2);
    s.world.settings = { autoTrackLocalhost: false };
    await s.ticks(1);
    assert.ok(s.runs()[0].stoppedAt);
    s.world.ports = [SYSTEM, NODE(3111), NODE(3222)];
    await s.ticks(4);
    assert.equal(s.runs().length, 1);
    assert.deepEqual(s.world.probed.filter(([p]) => p === 3222), []);
    s.world.settings = {};
    await s.ticks(2);
    assert.ok(s.runs().some((r) => r.port === 3222 && !r.stoppedAt));
  });

  await t('an empty or failed scan changes nothing', async () => {
    const s = setup();
    await s.ticks(2);
    s.world.ports = [];
    await s.ticks(4);
    assert.equal(s.runs()[0].stoppedAt, null);
    s.world.scanFails = true;
    await s.ticks(4);
    assert.equal(s.runs()[0].stoppedAt, null);
  });

  await t('a probe or history failure on one port is contained and the next port still records', async () => {
    const s = setup({
      probe: async (port) => { if (port === 3111) throw new Error('socket exploded'); return 'healthy'; },
    });
    s.world.ports = [SYSTEM, NODE(3111), NODE(3112)];
    await s.ticks(2);
    assert.deepEqual(s.runs().map((r) => r.port), [3112]);
  });

  await t('onlyPorts limits the watcher to the listed ports', async () => {
    const s = setup({ onlyPorts: [3112] });
    s.world.ports = [SYSTEM, NODE(3111), NODE(3112)];
    await s.ticks(2);
    assert.deepEqual(s.runs().map((r) => r.port), [3112]);
  });

  await t('ownPorts are never tracked', async () => {
    const s = setup({ ownPorts: [3111] });
    await s.ticks(3);
    assert.equal(s.runs().length, 0);
  });

  // ---- a registered app whose server was started outside PortPilot ----
  const BY_HUMAN = { kind: 'human', surface: 'desktop', at: new Date().toISOString() };

  await t('a registered app\'s server started outside PortPilot gets a run under the app\'s id, after two scans', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, 'app_shop']]);
    await s.ticks(1);
    assert.equal(s.runs().length, 0);
    await s.ticks(1);
    const [run] = s.runs();
    assert.equal(s.runs().length, 1);
    assert.equal(run.appId, 'app_shop');
    assert.equal(run.appName, 'shop-web');
    assert.equal(run.detected, true);
    assert.equal(run.startedBy.kind, 'detected');
    assert.equal(run.port, 3111);
    await s.ticks(3);
    assert.equal(s.runs().length, 1, 'no second run while it stays up');
  });

  await t('that run closes after two absent scans and a quick restart reuses it', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, 'app_shop']]);
    await s.ticks(2);
    const first = s.runs()[0].id;
    s.world.ports = [SYSTEM];
    await s.ticks(1);
    assert.equal(s.runs()[0].stoppedAt, null);
    await s.ticks(1);
    assert.equal(s.runs()[0].endedBy, 'stop');
    s.world.ports = [SYSTEM, NODE(3111)];
    await s.ticks(2);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].id, first);
    assert.equal(s.runs()[0].stoppedAt, null);
  });

  await t('an app PortPilot started (runtime entry) never gets a detected run', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, 'app_shop']]);
    s.world.started.add('app_shop');
    await s.ticks(4);
    assert.equal(s.runs().length, 0);
  });

  await t('an app with an open run of its own never gets a second one', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, 'app_shop']]);
    const own = runHistory.openRun(s.configPath, 'app_shop', BY_HUMAN, { port: 3111 });
    await s.ticks(4);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].id, own.id);
    assert.equal(s.runs()[0].stoppedAt, null);
    s.world.ports = [SYSTEM];
    await s.ticks(3);
    assert.equal(s.runs()[0].stoppedAt, null, 'the watcher never closes a run it did not open');
  });

  await t('PortPilot taking over a tracked app leaves its run alone and records no duplicate', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, 'app_shop']]);
    await s.ticks(2);
    assert.ok(s.watcher.state().open.app_shop);
    s.world.started.add('app_shop');
    await s.ticks(1);
    assert.equal(s.watcher.state().open.app_shop, undefined);
    s.world.ports = [SYSTEM];
    await s.ticks(3);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].stoppedAt, null, 'the stop belongs to PortPilot now');
  });

  await t('a stranger on a registered app\'s port (a conflict) is not tracked', async () => {
    const s = setup();
    s.world.owned = new Map([[3111, null]]);
    await s.ticks(4);
    assert.equal(s.runs().length, 0);
  });

  // ---- a relative script ("node server.js"): the folder is found, never guessed ----
  const SCRIPT_CMD = '"C:\\Program Files\\nodejs\\node.exe" server.js --port 3111';
  const projectWith = (name, ageSeconds = 0) => {
    const d = path.join(root, `proj-${++n}-${name}`);
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 'server.js');
    fs.writeFileSync(f, '// server');
    const at = new Date(Date.now() - ageSeconds * 1000);
    fs.utimesSync(f, at, at);
    return d;
  };

  await t('a relative script is resolved through a live session: cwd, folder name, start command, folder-keyed id', async () => {
    const dir = projectWith('shop-api');
    const sessions = [{ sessionId: 's1', cwd: dir, at: Date.now() }];
    const s = setup({ liveSessions: () => sessions, startCommandFor: async () => null });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    const [run] = s.runs();
    assert.equal(s.runs().length, 1);
    assert.equal(run.cwd, dir);
    assert.equal(run.appName, path.basename(dir));
    assert.equal(run.startCommand, SCRIPT_CMD, 'no package.json script: the command line, now runnable from the known folder');
    assert.equal(run.appId, detectedAppId(dir, path.basename(dir), 3111));
    assert.equal(run.detected, true);
  });

  await t('a package.json start command wins over the raw command line', async () => {
    const dir = projectWith('with-pkg');
    const s = setup({ liveSessions: () => [{ sessionId: 's1', cwd: dir, at: Date.now() }], startCommandFor: async () => 'npm run dev' });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    assert.equal(s.runs()[0].startCommand, 'npm run dev');
  });

  await t('the folder sticks to the process: the session going away does not split the run', async () => {
    const dir = projectWith('sticky');
    let sessions = [{ sessionId: 's1', cwd: dir, at: Date.now() }];
    const s = setup({ liveSessions: () => sessions, startCommandFor: async () => null });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    const id = s.runs()[0].id;
    sessions = [];
    await s.ticks(4);
    assert.equal(s.runs().length, 1);
    assert.equal(s.runs()[0].id, id);
    assert.equal(s.runs()[0].stoppedAt, null);
  });

  await t('with no session, a registered app\'s folder, then a recent run\'s folder, is tried', async () => {
    const appDir = projectWith('registered-dir');
    const a = setup({ getApps: () => [{ id: 'app_other', cwd: appDir, preferredPort: 4000 }], liveSessions: () => [], startCommandFor: async () => null });
    a.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await a.ticks(2);
    assert.equal(a.runs().length, 1);
    assert.equal(a.runs()[0].cwd, appDir);

    const runDir = projectWith('earlier-run');
    const r = setup({ liveSessions: () => [], startCommandFor: async () => null });
    runHistory.openRun(r.configPath, 'det_earlier', { kind: 'detected', surface: 'desktop' }, { port: 9999, meta: { name: 'earlier-run', cwd: runDir, command: 'x', startCommand: null } });
    r.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await r.ticks(2);
    assert.equal(r.runs().find((x) => x.port === 3111).cwd, runDir);
  });

  await t('two folders that both hold the script and cannot be told apart leave the folder unknown', async () => {
    const one = projectWith('twin-a');
    const two = projectWith('twin-b', 20);
    const s = setup({ liveSessions: () => [{ cwd: one }, { cwd: two }], startCommandFor: async () => null });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    const [run] = s.runs();
    assert.equal(run.cwd, null);
    assert.equal(run.appName, 'node server.js');
    assert.equal(run.startCommand, null);
  });

  await t('the newer script wins when the two folders are over a minute apart', async () => {
    const stale = projectWith('stale', 900);
    const fresh = projectWith('fresh', 0);
    const s = setup({ liveSessions: () => [{ cwd: stale }, { cwd: fresh }], startCommandFor: async () => null });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    assert.equal(s.runs()[0].cwd, fresh);
  });

  await t('a script that exists in no candidate folder stays unresolved, and an absolute one is untouched', async () => {
    const dir = path.join(root, `empty-${++n}`);
    fs.mkdirSync(dir);
    const s = setup({ liveSessions: () => [{ cwd: dir }], startCommandFor: async () => null });
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: SCRIPT_CMD })];
    await s.ticks(2);
    assert.equal(s.runs()[0].cwd, null);
    assert.equal(s.runs()[0].appName, 'node server.js');

    const abs = projectWith('absolute');
    const decoy = projectWith('decoy');
    const b = setup({ liveSessions: () => [{ cwd: decoy }], startCommandFor: async () => null });
    b.world.ports = [SYSTEM, NODE(3111, { commandLine: `node ${path.join(abs, 'server.js')}` })];
    await b.ticks(2);
    assert.equal(b.runs()[0].cwd, abs);
  });

  await t('a project folder is named and given its start command', async () => {
    const proj = path.join(root, 'shop-web');
    fs.mkdirSync(path.join(proj, 'node_modules', 'next', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'package.json'), '{}');
    const s = setup();
    s.world.ports = [SYSTEM, NODE(3111, { commandLine: `"C:\\Program Files\\nodejs\\node.exe" "${path.join(proj, 'node_modules', 'next', 'bin', 'next')}" dev` })];
    await s.ticks(2);
    const [run] = s.runs();
    assert.equal(run.appName, 'shop-web');
    assert.equal(run.cwd, proj);
    assert.equal(run.startCommand, 'npm run dev');
    assert.equal(run.command, 'npm run dev');
  });

  await runHistory.whenIdle();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp dir, swept by the OS */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
