const assert = require('assert');
const { normalizeScene, upsertScene, pruneScene, MAX_SCENES } = require('../src/core/scenes');

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`✅ ${name}`); };

t('a scene needs a name and a member', () => {
  assert.throws(() => normalizeScene({ name: ' ', apps: ['a'] }), /name/);
  assert.throws(() => normalizeScene({ name: 'x' }), /at least one/);
  assert.throws(() => normalizeScene(null), /name/);
});

t('members are trimmed, de-duplicated and non-strings dropped', () => {
  const s = normalizeScene({ name: ' Work ', apps: ['a', ' a ', 3, '', 'b'], browsers: ['upwork', 'upwork'] });
  assert.strictEqual(s.name, 'Work');
  assert.deepStrictEqual(s.apps, ['a', 'b']);
  assert.deepStrictEqual(s.browsers, ['upwork']);
  assert.match(s.id, /^scene_/);
});

t('a caller cannot choose an unsafe id', () => {
  assert.notStrictEqual(normalizeScene({ id: '../x', name: 'n', apps: ['a'] }).id, '../x');
  assert.strictEqual(normalizeScene({ id: 'scene_ok_1', name: 'n', apps: ['a'] }).id, 'scene_ok_1');
});

t('upsert replaces by id and keeps names unique', () => {
  const first = upsertScene([], { name: 'Work', apps: ['a'] });
  const edited = upsertScene(first.scenes, { id: first.scene.id, name: 'Work', apps: ['a', 'b'] });
  assert.strictEqual(edited.scenes.length, 1);
  assert.deepStrictEqual(edited.scenes[0].apps, ['a', 'b']);
  assert.throws(() => upsertScene(first.scenes, { name: 'work', apps: ['c'] }), /already exists/);
});

t('the scene count is capped', () => {
  let scenes = [];
  for (let i = 0; i < MAX_SCENES; i += 1) scenes = upsertScene(scenes, { name: `s${i}`, apps: ['a'] }).scenes;
  assert.throws(() => upsertScene(scenes, { name: 'one more', apps: ['a'] }), /At most/);
});

t('prune removes members that no longer exist', () => {
  const s = pruneScene({ id: 'scene_1', name: 'n', apps: ['a', 'gone'], browsers: ['p', 'gone'] }, ['a'], ['p']);
  assert.deepStrictEqual(s.apps, ['a']);
  assert.deepStrictEqual(s.browsers, ['p']);
});

console.log(`\n${pass} passed, 0 failed`);
