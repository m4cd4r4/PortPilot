/**
 * Row state cell (src/core/status.js rowStateOf / formatUptime) and the
 * crashed flag processManager exposes (isCrashed + getRunningApps).
 * Run: node tests/row-state.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const status = require('../src/core/status');
const pm = require('../src/main/processManager');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const claude = status.makeStartedBy({ kind: 'claude', surface: 'mcp', sessionId: 'a3f2-9b1c' });
const human = status.makeStartedBy({ kind: 'human', surface: 'desktop' });

// ---- formatUptime ----
t('formatUptime: seconds under a minute', () => assert.equal(status.formatUptime(45), '45s'));
t('formatUptime: minutes under an hour', () => assert.equal(status.formatUptime(12 * 60 + 30), '12m'));
t('formatUptime: hours under a day', () => assert.equal(status.formatUptime(2 * 3600 + 14 * 60), '2h'));
t('formatUptime: days', () => assert.equal(status.formatUptime(3 * 86400 + 5000), '3d'));
t('formatUptime: missing or negative is empty', () => {
  assert.equal(status.formatUptime(null), '');
  assert.equal(status.formatUptime(-5), '');
});

// ---- rowStateOf ----
t('running with uptime and claude provenance', () => {
  const r = status.rowStateOf({ running: true, uptimeSec: 7300, startedBy: claude });
  assert.equal(r.state, 'running');
  assert.equal(r.glyph, '●');
  assert.equal(r.word, 'Running');
  assert.equal(r.uptime, '2h');
  assert.equal(r.provenance, 'claude a3f2');
  assert.equal(r.text, '● Running 2h · claude a3f2');
});
t('running started by you reads "· you"', () => {
  const r = status.rowStateOf({ running: true, uptimeSec: 50, startedBy: human });
  assert.equal(r.text, '● Running 50s · you');
});
t('running with no startedBy shows no provenance (never "external")', () => {
  const r = status.rowStateOf({ running: true, uptimeSec: 50 });
  assert.equal(r.provenance, '');
  assert.equal(r.text, '● Running 50s');
});
t('crashed reads "Crashed · exit <code>", never stopped', () => {
  const r = status.rowStateOf({ running: false, crashed: true, exitCode: 1 });
  assert.equal(r.state, 'crashed');
  assert.equal(r.shape, 'cross');
  assert.equal(r.text, '✕ Crashed · exit 1');
});
t('crashed hides uptime and provenance', () => {
  const r = status.rowStateOf({ crashed: true, exitCode: 137, uptimeSec: 900, startedBy: claude });
  assert.equal(r.uptime, '');
  assert.equal(r.provenance, '');
  assert.equal(r.text, '✕ Crashed · exit 137');
});
t('crashed with no exit code (signal) has no reason', () => {
  assert.equal(status.rowStateOf({ crashed: true, exitCode: null }).text, '✕ Crashed');
});
t('stopped is plain', () => {
  const r = status.rowStateOf({});
  assert.equal(r.state, 'stopped');
  assert.equal(r.text, '○ Stopped');
});
t('unhealthy running reads "Not responding" and keeps uptime', () => {
  const r = status.rowStateOf({ running: true, unhealthy: true, uptimeSec: 120, startedBy: human });
  assert.equal(r.state, 'error');
  assert.equal(r.text, '⊗ Not responding 2m · you');
});
t('conflict reads "Port blocked" with the holder as reason', () => {
  const r = status.rowStateOf({ conflict: true, blockedBy: 'node 9812' });
  assert.equal(r.state, 'conflict');
  assert.equal(r.text, '▲ Port blocked · node 9812');
});
t('starting wins over a stale crash', () => {
  assert.equal(status.rowStateOf({ starting: true, crashed: true, exitCode: 1 }).state, 'starting');
});
t('running wins over a stale crash flag', () => {
  assert.equal(status.rowStateOf({ running: true, crashed: true }).state, 'running');
});
t('token and title are set for the renderer', () => {
  const r = status.rowStateOf({ running: true, startedBy: claude });
  assert.equal(r.token, '--status-running');
  assert.match(r.title, /Started by Claude/);
});

// ---- processManager.isCrashed (the exit handler's emitCrash condition) ----
t('isCrashed: exited after announcing, not user-stopped', () =>
  assert.equal(pm.isCrashed({ running: false, announced: true, userStopped: false, exitCode: 1 }), true));
t('isCrashed: user-stopped is not a crash', () =>
  assert.equal(pm.isCrashed({ running: false, announced: true, userStopped: true, exitCode: 1 }), false));
t('isCrashed: never announced (failed start) is not a crash', () =>
  assert.equal(pm.isCrashed({ running: false, announced: false, exitCode: 1 }), false));
t('isCrashed: still running is not a crash', () =>
  assert.equal(pm.isCrashed({ running: true, announced: true }), false));
t('getRunningApps exposes a boolean crashed field', () => {
  for (const a of pm.getRunningApps()) assert.equal(typeof a.crashed, 'boolean');
  assert.ok(/crashed:\s*isCrashed\(info\)/.test(require('fs').readFileSync(require.resolve('../src/main/processManager'), 'utf8')));
});

// ---- configFile.recordCrash (crash persisted for the VS Code extension) ----
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cf = require('../src/core/configFile');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-rowstate-'));
  const cfg = path.join(dir, 'portpilot-config.json');
  t('recordCrash stamps exitCode and time, and drops the dead run provenance', () => {
    cf.recordStart(cfg, 'web', claude, { pid: 42, port: 3000 });
    assert.equal(cf.recordCrash(cfg, 'web', 1), true);
    const entry = cf.readRuntime(cfg).apps.web;
    assert.equal(entry.crashed.exitCode, 1);
    assert.equal(typeof entry.crashed.at, 'number');
    // The crashed run's provenance must not attach to whatever starts next.
    assert.equal(entry.startedBy, undefined);
  });
  t('recordStart clears a previous crash', () => {
    cf.recordStart(cfg, 'web', human, { pid: 43, port: 3000 });
    assert.equal(cf.readRuntime(cfg).apps.web.crashed, undefined);
  });
  t('recordCrash creates an entry for an app with no start record', () => {
    assert.equal(cf.recordCrash(cfg, 'api', null), true);
    assert.equal(cf.readRuntime(cfg).apps.api.crashed.exitCode, null);
  });
  t('recordCrash without an appId is a no-op', () => assert.equal(cf.recordCrash(cfg, '', 1), false));
  t('recordCrash keeps who started the dead run, its port and output tail', () => {
    cf.recordStart(cfg, 'web', claude, { pid: 44, port: 3000 });
    cf.recordCrash(cfg, 'web', 1, { errorTail: 'x'.repeat(5000) + 'EADDRINUSE' });
    const { crashed } = cf.readRuntime(cfg).apps.web;
    assert.deepEqual(crashed.startedBy, claude);
    assert.equal(crashed.port, 3000);
    assert.equal(crashed.errorTail.length, cf.CRASH_TAIL_CHARS);
    assert.ok(crashed.errorTail.endsWith('EADDRINUSE'));
  });
  t('a second crash stamp keeps the first run owner; an explicit port wins', () => {
    cf.recordCrash(cfg, 'web', 2, { port: 3001 });
    const { crashed } = cf.readRuntime(cfg).apps.web;
    assert.deepEqual(crashed.startedBy, claude);
    assert.equal(crashed.port, 3001);
    assert.equal(crashed.errorTail, null);
  });
  t('readLogTail returns the end of logs/<appId>.log, or null when absent', () => {
    const log = cf.logPathFor(cfg, 'a/b:c');
    assert.equal(path.basename(log), 'a_b_c.log');
    assert.equal(cf.readLogTail(cfg, 'a/b:c'), null);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, 'start\n' + 'é'.repeat(3000) + '\nfatal');
    const tail = cf.readLogTail(cfg, 'a/b:c', 100);
    assert.equal(tail.length, 100);
    assert.ok(tail.endsWith('\nfatal'));
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- status.runtimeStateOf (the one crash rule for sidecar readers) ----
// tdd-guard:allow  (fix and tests written together against already-diagnosed bugs; red run checked below)
{
  const now = Date.parse('2026-10-07T04:00:30Z');
  const fresh = { startedBy: { kind: 'human', surface: 'desktop', at: '2026-10-07T04:00:00Z' }, port: 3000 };
  const old = { startedBy: { kind: 'human', surface: 'desktop', at: '2026-10-07T03:00:00Z' }, port: 3000 };
  t('runtimeStateOf: listening port is running', () =>
    assert.equal(status.runtimeStateOf(old, { listening: true, now }), 'running'));
  t('runtimeStateOf: no entry and not listening is nothing to report', () =>
    assert.equal(status.runtimeStateOf(null, { listening: false, now }), null));
  t('runtimeStateOf: just started and not listening yet is starting, not crashed', () =>
    assert.equal(status.runtimeStateOf(fresh, { listening: false, now }), 'starting'));
  t('runtimeStateOf: explicit crashed stamp wins over the start grace', () =>
    assert.equal(status.runtimeStateOf({ crashed: { exitCode: 1, at: now } }, { listening: false, now }), 'crashed'));
  t('runtimeStateOf: start recorded, long gone, never listening is crashed', () =>
    assert.equal(status.runtimeStateOf(old, { listening: false, now }), 'crashed'));
}

// ---- processManager: deliberate kills are not crashes (real child processes) ----
(async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cf = require('../src/core/configFile');
  const { checkPort } = require('../src/main/portScanner');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-crash-truth-'));
  const cfg = path.join(dir, 'portpilot-config.json');
  const crashes = [];
  pm.onAppCrash((c) => crashes.push(c.id));

  const cmd = (port) => `node -e "require('http').createServer().listen(${port})"`;
  const boot = async (id, port) => {
    const r = await pm.startApp({ id, name: id, command: cmd(port), preferredPort: port });
    assert.equal(r.success, true);
    cf.recordStart(cfg, id, human, { pid: r.pid, port });
    for (let i = 0; i < 30 && !(await checkPort(port)); i++) await sleep(200);
    assert.ok(await checkPort(port), 'server did not bind');
  };
  const state = (id) => pm.getRunningApps().find((a) => a.id === id);

  try {
    await boot('kill-by-port', 45871);
    await pm.killByPort(45871);
    await sleep(1500);
    t('killByPort on a managed app: no crash emitted', () => assert.ok(!crashes.includes('kill-by-port')));
    t('killByPort on a managed app: not reported crashed', () => assert.ok(!state('kill-by-port')?.crashed));

    await boot('real-crash', 45872);
    const holder = (await checkPort(45872)).pid;
    process.kill(holder, 'SIGKILL'); // forceful on win32 and posix, unlike taskkill
    await sleep(2000);
    t('a real crash (server killed outside PortPilot) still emits', () => assert.ok(crashes.includes('real-crash')));
    t('a real crash still reads crashed', () => assert.equal(state('real-crash')?.crashed, true));

    await boot('quit-clean', 45873);
    assert.ok(cf.readRuntime(cfg).apps['quit-clean']);
    await pm.cleanupAllProcesses(cfg);
    t('app quit records a stop for every tracked app', () => assert.equal(cf.readRuntime(cfg).apps['quit-clean'], undefined));
    t('app quit is not a crash', () => assert.ok(!crashes.includes('quit-clean')));
  } catch (e) {
    console.log('❌ process fixtures -', e.message); failed++;
  }
  await pm.cleanupAllProcesses();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
