// v4 slice 2: the Running home model agrees with the sidebar on what "blocked" means and
// words the headline for zero, one and many.
const assert = require('assert');
const { summarise } = require('../src/core/homeModel.js');

const empty = summarise([]);
assert.strictEqual(empty.empty, true);
assert.strictEqual(summarise(undefined).empty, true);

const calm = summarise([
  { id: 'a', state: 'running' }, { id: 'b', state: 'starting' }, { id: 'c', state: 'stopped' },
]);
assert.strictEqual(calm.empty, false);
assert.strictEqual(calm.headline, 'All good');
assert.strictEqual(calm.tone, 'ok');
assert.strictEqual(calm.sub, '2 running · 1 ready');
assert.deepStrictEqual(calm.running, ['a', 'b']);
assert.deepStrictEqual(calm.ready, ['c']);

const one = summarise([{ id: 'x', state: 'conflict' }, { id: 'y', state: 'running' }]);
assert.strictEqual(one.headline, '1 thing needs you');
assert.strictEqual(one.tone, 'bad');
assert.strictEqual(one.sub, '1 running · 0 ready · 1 blocked');

const many = summarise([{ id: 'x', state: 'crashed' }, { id: 'y', state: 'error' }, { id: 'z', state: 'conflict' }]);
assert.strictEqual(many.headline, '3 things need you');
assert.deepStrictEqual(many.blocked, ['x', 'y', 'z']);
// A blocked app is never also counted as ready.
assert.deepStrictEqual(many.ready, []);

// The inspector opens on the first blocked app, else the first running, else the first.
const { pickInspected } = require('../src/core/homeModel.js');
assert.strictEqual(pickInspected([{ id: 'a', state: 'stopped' }, { id: 'b', state: 'running' }, { id: 'c', state: 'crashed' }]), 'c');
assert.strictEqual(pickInspected([{ id: 'a', state: 'stopped' }, { id: 'b', state: 'running' }]), 'b');
assert.strictEqual(pickInspected([{ id: 'a', state: 'stopped' }]), 'a');
assert.strictEqual(pickInspected([]), null);

console.log('home-model: headline, tally, blocked/running/ready split and inspector pick ok');
