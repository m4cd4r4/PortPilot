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
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
