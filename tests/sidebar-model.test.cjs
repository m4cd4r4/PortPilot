// v4 slice 1: the sidebar model lists the sections in order, carries live counts, and
// turns "Needs attention" red only when it is above zero.
const assert = require('assert');
const model = require('../src/core/sidebarModel.js');

const ids = model.items().map(i => i.id);
assert.deepStrictEqual(ids, ['running', 'attention', 'apps', 'ports', 'browsers', 'history']);

const calm = model.items({ running: 3, attention: 0, apps: 10, ports: 4, browsers: 2 });
const by = id => calm.find(i => i.id === id);
assert.strictEqual(by('running').count, 3);
assert.strictEqual(by('running').tone, 'ok');
assert.strictEqual(by('attention').tone, 'ok');
assert.strictEqual(by('history').count, null);
assert.strictEqual(by('history').tone, null);

const bad = model.items({ attention: 2 }).find(i => i.id === 'attention');
assert.strictEqual(bad.count, 2);
assert.strictEqual(bad.tone, 'bad');

// Junk counts collapse to 0 rather than rendering NaN.
const junk = model.items({ running: NaN, apps: -5, ports: '7' });
assert.strictEqual(junk.find(i => i.id === 'running').count, 0);
assert.strictEqual(junk.find(i => i.id === 'apps').count, 0);
assert.strictEqual(junk.find(i => i.id === 'ports').count, 0);

assert.strictEqual(model.activeId('history'), 'history');
assert.strictEqual(model.activeId('browsers'), 'browsers');
assert.strictEqual(model.activeId('apps'), 'apps');
assert.strictEqual(model.activeId('apps', 'attention'), 'attention');
assert.strictEqual(model.activeId('apps', 'running'), 'running');
assert.strictEqual(model.activeId('apps', 'bogus'), 'apps');

console.log('sidebar-model: order, counts, tone and activeId ok');
