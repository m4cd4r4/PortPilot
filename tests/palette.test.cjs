// Pure model of the Ctrl+K palette: which commands exist and how a query ranks them.
const assert = require('assert');
const P = require('../src/core/palette');

let n = 0;
const t = (name, fn) => { fn(); n += 1; };

const apps = [
  { id: 'a', name: 'shop', preferredPort: 3000 },
  { id: 'b', name: 'shop', branch: 'feat/cart', preferredPort: 3001 },
  { id: 'c', name: 'api', preferredPort: 4000 },
];
const state = {
  apps,
  running: { a: { port: 3000 } },
  ports: [{ port: 5432, pid: 812, processName: 'postgres.exe' }, { port: 8080 }],
  profiles: [{ name: 'gsc', state: 'up' }, { name: 'upwork', state: 'down' }],
  view: 'apps',
};
const cmds = P.buildCommands(state);
const ids = cmds.map((c) => c.id);

t('a running app offers Stop and Open, a stopped one offers Start, both offer History', () => {
  assert.ok(ids.includes('stop:a') && ids.includes('open:a') && !ids.includes('start:a'));
  assert.ok(ids.includes('start:b') && !ids.includes('stop:b') && !ids.includes('open:b'));
  assert.ok(ids.includes('history:a') && ids.includes('history:b') && ids.includes('history:c'));
});

t('a running app with no reported port shows its preferred port', () => {
  const c = P.buildCommands({ apps: [{ id: 'z', name: 'zed', preferredPort: 7000 }], running: { z: {} } });
  assert.strictEqual(c.find((x) => x.id === 'stop:z').hint, ':7000');
  assert.strictEqual(c.find((x) => x.id === 'open:z').hint, ':7000');
});

t('branches of one app are told apart by the branch in the label', () => {
  assert.strictEqual(cmds.find((c) => c.id === 'start:b').label, 'Start shop (feat/cart)');
  assert.strictEqual(cmds.find((c) => c.id === 'stop:a').label, 'Stop shop');
});

t('freeing a port needs a second Enter and names what it will stop', () => {
  const k = cmds.find((c) => c.id === 'kill:5432');
  assert.deepStrictEqual(k.action, { type: 'killPort', port: 5432 });
  assert.match(k.confirm, /postgres\.exe \(pid 812\) on :5432/);
  assert.match(cmds.find((c) => c.id === 'kill:8080').confirm, /a process on :8080/);
});

t('only the destructive port command asks for confirmation', () => {
  assert.deepStrictEqual(cmds.filter((c) => c.confirm).map((c) => c.kind), ['port', 'port']);
});

t('a browser profile offers the opposite of its state', () => {
  assert.deepStrictEqual(cmds.find((c) => c.id === 'bstop:gsc').action, { type: 'stopBrowser', name: 'gsc' });
  assert.deepStrictEqual(cmds.find((c) => c.id === 'bstart:upwork').action, { type: 'startBrowser', name: 'upwork' });
});

t('Go to leaves out the view already on screen', () => {
  assert.ok(!ids.includes('view:apps') && ids.includes('view:history') && ids.includes('view:browsers'));
  assert.ok(P.buildCommands({ ...state, view: 'history' }).some((c) => c.id === 'view:apps'));
});

t('nothing running and nothing else known still gives the global commands', () => {
  const only = P.buildCommands({}).map((c) => c.id);
  assert.deepStrictEqual(only.filter((i) => !i.startsWith('view:')), ['scan', 'add']);
});

t('every command id is unique', () => {
  assert.strictEqual(new Set(ids).size, ids.length);
});

t('an empty query keeps the input order', () => {
  assert.deepStrictEqual(P.rank('', cmds).map((c) => c.id), ids.slice(0, P.MAX_RESULTS));
  assert.deepStrictEqual(P.rank('   ', cmds).map((c) => c.id), ids.slice(0, P.MAX_RESULTS));
});

t('every word of the query must match', () => {
  assert.deepStrictEqual(P.rank('shop cart', cmds).map((c) => c.id), ['start:b', 'history:b']);
  assert.deepStrictEqual(P.rank('shop zzz', cmds), []);
});

t('a label that starts with the word beats one that only contains it', () => {
  const r = P.rank('start', cmds).map((c) => c.id);
  assert.ok(r.indexOf('start:b') < r.indexOf('bstart:upwork'), r.join());
});

t('a port number finds its port and its app', () => {
  assert.strictEqual(P.rank('5432', cmds)[0].id, 'kill:5432');
  assert.ok(P.rank('3001', cmds).map((c) => c.id).includes('start:b'));
});

t('matching ignores case', () => {
  assert.strictEqual(P.rank('POSTGRES', cmds)[0].id, 'kill:5432');
});

t('results are capped', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, label: `thing ${i}`, keywords: '', hint: '' }));
  assert.strictEqual(P.rank('thing', many).length, P.MAX_RESULTS);
  assert.strictEqual(P.rank('', many).length, P.MAX_RESULTS);
});

t('moveIndex wraps both ways and survives an empty list', () => {
  assert.strictEqual(P.moveIndex(0, 3, -1), 2);
  assert.strictEqual(P.moveIndex(2, 3, 1), 0);
  assert.strictEqual(P.moveIndex(1, 3, 1), 2);
  assert.strictEqual(P.moveIndex(-1, 3, 1), 0);
  assert.strictEqual(P.moveIndex(-1, 3, -1), 2);
  assert.strictEqual(P.moveIndex(0, 0, 1), -1);
});

console.log(`palette: ${n} cases ok`);
