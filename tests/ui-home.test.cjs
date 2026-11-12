// What Home lists: every running app once, open browsers, and recently used apps that are not running.
// Its counts are the same ones Apps shows, worktree copies included.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Compile the real ui/src files and load them with no page; a relative import loads the same way.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', js)((id) => (id.startsWith('.') ? load(path.join(path.dirname(file), `${id}.ts`)) : require(id)), mod, mod.exports);
  return mod.exports;
}
const ui = path.join(__dirname, '../ui/src');
const { tally } = load(path.join(ui, 'model.ts'));
const { homeLists, RECENT_ROWS, BROWSER_ROWS } = load(path.join(ui, 'homeModel.ts'));

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); } catch (e) { failed++; console.log(`❌ ${name}\n     ${e.message}`); }
}

const app = (id, extra = {}) => ({ id, name: id, preferredPort: 3000, ...extra });
const day = (n) => new Date(Date.UTC(2026, 10, n)).toISOString();
const run = (appId, n) => ({ appId, startedAt: day(n) });
const snap = (over = {}) => ({ apps: [], running: {}, crashed: {}, profiles: [], groups: [], ports: [], ...over });
const ids = (list) => list.map((c) => c.app.id);
const names = (list) => list.map((p) => p.name);

console.log('\n=== ui/src/homeModel.ts ===\n');

t('the app count is every listed app, worktree copies included, as on Apps', () => {
  const s = snap({ apps: [app('a'), app('a-wt', { parentId: 'a' }), app('b')], running: { 'a-wt': { port: 3001 } } });
  const c = tally(s);
  assert.strictEqual(c.apps, 3);
  assert.strictEqual(c.running, 1);
});

t('Running lists every running app, a worktree copy too, newest start first', () => {
  const s = snap({ apps: [app('a'), app('a-wt', { parentId: 'a' }), app('b'), app('c')], running: { a: { port: 1 }, 'a-wt': { port: 2 }, c: { port: 3 } } });
  const { running } = homeLists(s, [run('a', 1), run('c', 5), run('a-wt', 3)]);
  assert.deepStrictEqual(ids(running), ['c', 'a-wt', 'a']);
});

t('a running app is never repeated under Recently used', () => {
  const s = snap({ apps: [app('a'), app('b'), app('c')], running: { a: { port: 1 } } });
  const { running, recent } = homeLists(s, [run('a', 9), run('b', 8), run('c', 7), run('b', 2)]);
  assert.deepStrictEqual(ids(running), ['a']);
  assert.deepStrictEqual(ids(recent), ['b', 'c']);
});

t('Recently used is newest first, one row per app, and capped', () => {
  const apps = Array.from({ length: 12 }, (_, i) => app(`x${i}`));
  const runs = apps.flatMap((a, i) => [run(a.id, i + 1), run(a.id, i + 1)]);
  const { recent } = homeLists(snap({ apps }), runs);
  assert.strictEqual(recent.length, RECENT_ROWS);
  assert.strictEqual(recent[0].app.id, 'x11');
  assert.strictEqual(new Set(ids(recent)).size, recent.length);
});

t('an app that was removed, or never ran, is not under Recently used', () => {
  const { recent } = homeLists(snap({ apps: [app('a'), app('b')] }), [run('gone', 5), run('a', 4)]);
  assert.deepStrictEqual(ids(recent), ['a']);
});

t('every open browser is listed, however many', () => {
  const profiles = ['p1', 'p2', 'p3', 'p4', 'p5'].map((name, i) => ({ name, state: i < 4 ? 'up' : 'down', lastUsed: day(i + 1) }));
  const { browsers, open } = homeLists(snap({ profiles }), []);
  assert.strictEqual(open, 4);
  assert.deepStrictEqual(names(browsers), ['p4', 'p3', 'p2', 'p1']);
});

t('with few browsers open, the most recently used closed ones fill the list', () => {
  const profiles = [{ name: 'old', state: 'down', lastUsed: day(1) }, { name: 'new', state: 'down', lastUsed: day(9) }, { name: 'mid', state: 'blocked', lastUsed: day(5) }, { name: 'open', state: 'up', lastUsed: day(2) }];
  const { browsers, open } = homeLists(snap({ profiles }), []);
  assert.strictEqual(open, 1);
  assert.strictEqual(browsers.length, BROWSER_ROWS);
  assert.deepStrictEqual(names(browsers), ['open', 'new', 'mid']);
});

t('an empty library gives empty lists', () => {
  const { running, recent, browsers, open } = homeLists(snap(), []);
  assert.deepStrictEqual([running.length, recent.length, browsers.length, open], [0, 0, 0, 0]);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
