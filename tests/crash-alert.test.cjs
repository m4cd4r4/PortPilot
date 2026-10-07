/**
 * Desktop crash toast logic (src/core/crashAlert.js).
 * Run: node tests/crash-alert.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const { pickSession, tailLines, createCrashHistory, buildCrashAlert, sameTree } = require('../src/core/crashAlert');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const sessions = [
  { sessionId: 'newest-1', cwd: 'C:/other', at: 3 },
  { sessionId: 'b71c-2', cwd: 'C:/Dev/Harbor', at: 2 },
  { sessionId: 'owner-3', cwd: 'D:/x', at: 1 },
];

t('pickSession: the owner first, then a session in the app folder, then the newest', () => {
  assert.equal(pickSession(sessions, { ownerSessionId: 'owner-3', cwd: 'C:/dev/harbor/web' }).sessionId, 'owner-3');
  assert.equal(pickSession(sessions, { ownerSessionId: 'gone', cwd: 'c:\\dev\\harbor\\web' }).reason, 'folder');
  assert.equal(pickSession(sessions, { cwd: 'E:/elsewhere' }).sessionId, 'newest-1');
  assert.equal(pickSession([], { ownerSessionId: 'owner-3' }), null);
});

t('sameTree matches a folder and its children only', () => {
  assert.ok(sameTree('C:/dev/harbor', 'c:\\dev\\harbor\\web\\'));
  assert.ok(!sameTree('C:/dev/harbor', 'C:/dev/harbor-2'));
  assert.ok(!sameTree('', 'C:/dev'));
});

t('tailLines keeps the last three non-empty lines', () => {
  assert.deepStrictEqual(tailLines('a\n\nb\r\nc\nd\n'), ['b', 'c', 'd']);
  assert.deepStrictEqual(tailLines(null), []);
});

t('createCrashHistory counts crashes inside five minutes', () => {
  const h = createCrashHistory();
  assert.equal(h.note('web', 0), 1);
  assert.equal(h.note('web', 60_000), 2);
  assert.equal(h.note('api', 60_000), 1);
  assert.equal(h.note('web', 5 * 60_000 + 1), 2);
});

t('buildCrashAlert: title groups repeats; session carries its short id', () => {
  const a = buildCrashAlert({ id: 'web', name: 'web', code: 1, port: 3000, errorTail: 'x\nError: boom', count: 3, session: { sessionId: 'B71C-9f', reason: 'owner' }, at: 5 });
  assert.equal(a.title, 'web crashed 3x in 5m');
  assert.equal(a.meta, ':3000 · exit 1');
  assert.deepStrictEqual(a.lines, ['x', 'Error: boom']);
  assert.deepStrictEqual(a.session, { id: 'B71C-9f', short: 'b71c', reason: 'owner' });
  const b = buildCrashAlert({ id: 'web', name: 'web' });
  assert.equal(b.title, 'web crashed');
  assert.equal(b.meta, '');
  assert.equal(b.session, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
