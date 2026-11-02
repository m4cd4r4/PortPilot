// Apps page: worktree copies of one project fold into a single cluster instead of 20 near-identical tiles.
const assert = require('assert');
const { clusterCards, baseName } = require('../src/core/appClusters.js');

const card = (id, name, state = 'stopped', extra = {}) => ({ app: { id, name, ...extra }, state });

assert.strictEqual(baseName('Examworthy Web (main)'), 'Examworthy Web');
assert.strictEqual(baseName('Cosmos Collective'), 'Cosmos Collective');
assert.strictEqual(baseName('550 AU (main control)'), '550 AU');
assert.strictEqual(baseName('(only parens)'), '(only parens)');

// Children by parentId fold under the parent; unparented siblings with the same base name join them.
const list = [
  card('p', 'Examworthy Web (main)'),
  card('c1', 'Examworthy Web (main)', 'stopped', { parentId: 'p', branch: 'feat/seal-web' }),
  card('c2', 'Examworthy Web (main)', 'running', { parentId: 'p', branch: 'feat/seal-flip' }),
  card('s', 'Examworthy Web (guides-v2)'),
  card('solo', 'Solaisoft'),
  card('x', 'Other (a)'),
  card('y', 'Other (b)', 'crashed'),
];
const out = clusterCards(list);
assert.deepStrictEqual(out.map((c) => c.name), ['Other', 'Examworthy Web', 'Solaisoft'], 'crashed, then running, then stopped');
const ew = out.find((c) => c.name === 'Examworthy Web');
assert.strictEqual(ew.members.length, 4);
assert.strictEqual(ew.state, 'running', 'the cluster shows its best member state');
assert.strictEqual(ew.head.app.id, 'c2', 'the running member leads');
assert.strictEqual(ew.members[0].app.id, 'c2', 'members sort best state first');
// Within a state, members sort by their label: the branch if it has one, else the name.
assert.deepStrictEqual(ew.members.slice(1).map((m) => m.app.id), ['s', 'p', 'c1']);

// A single app keeps its own name and is not a cluster.
const solo = out.find((c) => c.name === 'Solaisoft');
assert.strictEqual(solo.members.length, 1);
const lone = clusterCards([card('z', 'Zed (main)')]);
assert.strictEqual(lone[0].name, 'Zed (main)', 'a lone app keeps its full name');

// A child whose parent was filtered out of the list still clusters by base name.
const orphan = clusterCards([card('c9', 'Examworthy Web (main)', 'stopped', { parentId: 'gone', branch: 'feat/x' }), card('s9', 'Examworthy Web (dark)')]);
assert.strictEqual(orphan.length, 1);
assert.strictEqual(orphan[0].members.length, 2);

// Head is the parent when everyone is stopped.
const calm = clusterCards([card('k1', 'Q (main)', 'stopped', { parentId: 'k0', branch: 'b' }), card('k0', 'Q (main)')]);
assert.strictEqual(calm[0].head.app.id, 'k0');

// The copy other apps hang off leads, even when a loose sibling sorts first by label.
const lead = clusterCards([card('a1', 'R (dark)'), card('r0', 'R (main)'), card('r1', 'R (main)', 'stopped', { parentId: 'r0', branch: 'feat/z' })]);
assert.strictEqual(lead[0].head.app.id, 'r0');

assert.deepStrictEqual(clusterCards([]), []);
assert.deepStrictEqual(clusterCards(undefined), []);

console.log('app-clusters: parent and name folding, best-state head, member order and lone apps ok');
