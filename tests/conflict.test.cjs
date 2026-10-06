/**
 * Port-conflict model (src/core/conflict.js).
 * Run: node tests/conflict.test.cjs   (part of npm run test:unit)
 *
 * Covers: managed vs unmanaged kind, the one-line sentence, provenance words
 * for a Claude- or human-started holder, action order (non-destructive first),
 * the free-port label, and fmtAge.
 */
const assert = require('assert');
const { describeConflict, fmtAge, CONFIRM_MS } = require('../src/core/conflict');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const holder = { processName: 'node.exe', pid: 4812, uptime: 3 * 3600 + 120 };

t('unmanaged holder -> kind unmanaged, sentence says not managed', () => {
  const d = describeConflict({ port: 3000, holder, app: { name: 'harbor-web' } });
  assert.equal(d.kind, 'unmanaged');
  assert.equal(d.sentence, ':3000 is held by node.exe (PID 4812, started 3h ago, not managed)');
});

t('registered holder app -> kind managed, named first, no "not managed"', () => {
  const d = describeConflict({ port: 3000, holder, holderApp: { name: 'harbor-admin' }, app: { name: 'harbor-web' } });
  assert.equal(d.kind, 'managed');
  assert.equal(d.sentence, ':3000 is held by harbor-admin (node.exe, PID 4812, started 3h ago)');
  assert.equal(d.actions[1].label, 'Stop harbor-admin & start');
  assert.equal(d.actions[1].confirmLabel, 'Confirm stop?');
});

t('Claude-started holder -> says so, full session in title', () => {
  const d = describeConflict({
    port: 3000,
    holder: { processName: 'node.exe', pid: 4812 },
    holderStartedBy: { kind: 'claude', surface: 'mcp', sessionId: 'a3f2-9b1c' },
  });
  assert.equal(d.sentence, ':3000 is held by node.exe (PID 4812, started by claude a3f2)');
  assert.ok(d.title.includes('a3f2-9b1c'));
});

t('human-started holder -> "started by you"', () => {
  const d = describeConflict({ port: 3000, holder: { processName: 'node.exe', pid: 1 }, holderStartedBy: { kind: 'human', surface: 'desktop' } });
  assert.ok(d.sentence.includes('started by you'));
});

t('external startedBy is treated as not managed', () => {
  const d = describeConflict({ port: 3000, holder: { processName: 'node.exe', pid: 1 }, holderStartedBy: { kind: 'external', surface: 'desktop' } });
  assert.ok(d.sentence.endsWith('not managed)'));
  assert.equal(d.title, '');
});

t('actions are ordered recommended-first; only kill is destructive', () => {
  const d = describeConflict({ port: 3000, holder });
  assert.deepEqual(d.actions.map(a => a.id), ['useFreePort', 'killAndStart', 'showProcess']);
  assert.equal(d.actions[0].recommended, true);
  assert.deepEqual(d.actions.map(a => a.destructive), [false, true, false]);
  assert.equal(d.actions[1].confirmLabel, 'Confirm kill?');
});

t('free port known -> "Use :3001 instead"; unknown -> generic label', () => {
  assert.equal(describeConflict({ port: 3000, holder, freePort: 3001 }).actions[0].label, 'Use :3001 instead');
  assert.equal(describeConflict({ port: 3000, holder }).actions[0].label, 'Use next free port');
});

t('missing holder fields degrade without throwing', () => {
  const d = describeConflict({ port: 4321, holder: {} });
  assert.equal(d.sentence, ':4321 is held by an unknown process (not managed)');
});

t('fmtAge buckets', () => {
  assert.equal(fmtAge(5), 'just now');
  assert.equal(fmtAge(720), '12m ago');
  assert.equal(fmtAge(7200), '2h ago');
  assert.equal(fmtAge(200000), '2d ago');
  assert.equal(fmtAge(undefined), '');
  assert.equal(fmtAge(-1), '');
});

t('CONFIRM_MS is 3 s', () => assert.equal(CONFIRM_MS, 3000));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
