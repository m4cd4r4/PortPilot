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
  fs.writeFileSync(configPath, JSON.stringify({ apps: [], settings: {}, groups: [] }));
  const world = { ports: [SYSTEM, NODE(3111)], owned: new Set(), answers: {}, settings: {}, scanFails: false, probed: [] };
  const watcher = createLocalhostWatcher({
    configPath,
    getSettings: () => world.settings,
    getApps: () => [],
    scan: async () => { if (world.scanFails) throw new Error('netstat blew up'); return world.ports; },
    registeredPorts: async () => world.owned,
    probe: async (port, p, ms, host) => { world.probed.push([port, host]); return world.answers[port] || 'healthy'; },
    startCommandFor: async () => 'npm run dev',
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
