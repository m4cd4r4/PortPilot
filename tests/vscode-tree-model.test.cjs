/**
 * VS Code sidebar ordering and bookkeeping (vscode-extension/src/treeModel.ts):
 * running first, stopped folded, ports naming their app, new-crash detection.
 * Requires the compiled module, so run `npm run compile` in vscode-extension/ first.
 * Run: node tests/vscode-tree-model.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const tm = require('../vscode-extension/out/treeModel.js');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

const k = (name, state, extra = {}) => ({ name, state, favorite: false, ...extra });
const names = (list) => list.map(x => x.name);

// ---- ordering ----
t('arrange: crashed, conflict, error, starting, running, stopped', () => {
  // Names run against the state order, so only the state weight can sort them.
  const items = [k('a', 'stopped'), k('b', 'running'), k('c', 'starting'), k('d', 'error'), k('e', 'conflict'), k('f', 'crashed')];
  const { visible } = tm.arrange(items, x => x, false);
  assert.deepEqual(visible.map(x => x.state), ['crashed', 'conflict', 'error', 'starting', 'running', 'stopped']);
});

t('arrange: favourites first within a state, then name', () => {
  const items = [k('zeta', 'running'), k('alpha', 'running'), k('mid', 'running', { favorite: true })];
  assert.deepEqual(names(tm.arrange(items, x => x, false).visible), ['mid', 'alpha', 'zeta']);
});

t('arrange: a favourite does not outrank a running app', () => {
  const items = [k('fav', 'stopped', { favorite: true }), k('live', 'running')];
  assert.deepEqual(names(tm.arrange(items, x => x, false).visible), ['live', 'fav']);
});

t('arrange: a stopped parent with a running branch counts as running', () => {
  const items = [k('aaa', 'stopped'), k('parent', 'stopped', { childStates: ['stopped', 'running'] })];
  const { visible, stopped } = tm.arrange(items, x => x, true);
  assert.deepEqual(names(visible), ['parent']);
  assert.deepEqual(names(stopped), ['aaa']);
});

t('arrange: a crashed branch lifts its parent to the top', () => {
  const items = [k('live', 'running'), k('parent', 'running', { childStates: ['crashed'] })];
  assert.deepEqual(names(tm.arrange(items, x => x, false).visible), ['parent', 'live']);
});

// ---- folding ----
t('arrange: fold splits idle apps off, sorted by name', () => {
  const items = [k('c', 'stopped'), k('live', 'running'), k('a', 'stopped')];
  const { visible, stopped } = tm.arrange(items, x => x, true);
  assert.deepEqual(names(visible), ['live']);
  assert.deepEqual(names(stopped), ['a', 'c']);
});

t('arrange: fold off keeps everything visible, stopped last', () => {
  const items = [k('a', 'stopped'), k('live', 'running')];
  const { visible, stopped } = tm.arrange(items, x => x, false);
  assert.deepEqual(names(visible), ['live', 'a']);
  assert.equal(stopped.length, 0);
});

t('arrange: does not mutate the input', () => {
  const items = [k('b', 'stopped'), k('a', 'running')];
  tm.arrange(items, x => x, true);
  assert.deepEqual(names(items), ['b', 'a']);
});

// ---- ports name their app ----
t('appIdByPort: inverts appId -> live port', () => {
  const m = tm.appIdByPort(new Map([['app-1', { port: 3000 }], ['app-2', { port: 5173 }]]));
  assert.equal(m.get(3000), 'app-1');
  assert.equal(m.get(5173), 'app-2');
});

t('appIdByPort: first app wins a shared port', () => {
  const m = tm.appIdByPort(new Map([['first', { port: 3000 }], ['second', { port: 3000 }]]));
  assert.equal(m.get(3000), 'first');
});

// ---- crash detection ----
const rt = {
  old: { crashed: { exitCode: 1, at: 100 } },
  fresh: { crashed: { exitCode: 137, at: 300 } },
  fresher: { crashed: { exitCode: null, at: 400 } },
  live: { startedBy: { kind: 'human' } },
};

t('newCrashes: only stamps newer than the mark, oldest first', () => {
  const { crashes, latest } = tm.newCrashes(rt, new Set(), 200);
  assert.deepEqual(crashes.map(c => c.appId), ['fresh', 'fresher']);
  assert.equal(latest, 400);
});

t('newCrashes: skips an app that is listening again', () => {
  const { crashes } = tm.newCrashes(rt, new Set(['fresh']), 200);
  assert.deepEqual(crashes.map(c => c.appId), ['fresher']);
});

t('newCrashes: nothing new keeps the mark', () => {
  const { crashes, latest } = tm.newCrashes(rt, new Set(), 400);
  assert.equal(crashes.length, 0);
  assert.equal(latest, 400);
});

t('newCrashes: seeding from 0 returns the newest stamp', () => {
  assert.equal(tm.newCrashes(rt, new Set(), 0).latest, 400);
  assert.equal(tm.newCrashes({}, new Set(), 0).latest, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
