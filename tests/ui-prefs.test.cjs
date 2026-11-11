// Apps has no Cards view. A saved "cards" choice becomes Tiles on Apps and stays Cards on Browsers,
// which used to share the one saved view with Apps.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// prefs.ts is plain logic plus one React hook: compile the real file and load it with no page.
const src = fs.readFileSync(path.join(__dirname, '../ui/src/prefs.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)((id) => (id === 'react' ? { useSyncExternalStore() {} } : require(id)), mod, mod.exports);
const { parsePrefs, APP_VIEWS, VIEWS, gridClass, showsShot } = mod.exports;

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); } catch (e) { failed++; console.log(`❌ ${name}\n     ${e.message}`); }
}
const views = (raw) => { const p = parsePrefs(raw); return [p.view, p.browserView]; };

console.log('\n=== ui/src/prefs.ts ===\n');

t('Apps offers Rows and Tiles; Browsers keeps Rows, Tiles and Cards', () => {
  assert.deepStrictEqual(APP_VIEWS.map((v) => v.v), ['rows', 'tiles']);
  assert.deepStrictEqual(VIEWS.map((v) => v.v), ['rows', 'tiles', 'cards']);
});

t('a saved "cards" view becomes Tiles on Apps and stays Cards on Browsers', () =>
  assert.deepStrictEqual(views('{"view":"cards"}'), ['tiles', 'cards']));

t('the older "gallery" name, which meant Cards, goes the same way', () =>
  assert.deepStrictEqual(views('{"view":"gallery"}'), ['tiles', 'cards']));

t('the older "compact" name is still Rows on both', () =>
  assert.deepStrictEqual(views('{"view":"compact"}'), ['rows', 'rows']));

t('a saved view from before the split carries over to Browsers', () =>
  assert.deepStrictEqual(views('{"view":"tiles"}'), ['tiles', 'tiles']));

t('once Browsers has its own saved view, the Apps view does not change it', () => {
  assert.deepStrictEqual(views('{"view":"rows","browserView":"cards"}'), ['rows', 'cards']);
  assert.deepStrictEqual(views('{"view":"cards","browserView":"rows"}'), ['tiles', 'rows']);
});

t('"cards" can never come back as the Apps view', () => {
  for (const raw of ['{"view":"cards"}', '{"view":"gallery"}', '{"view":"cards","browserView":"cards"}']) {
    assert.ok(APP_VIEWS.some((v) => v.v === parsePrefs(raw).view), raw);
  }
});

t('unknown or unreadable values fall back to Rows', () => {
  assert.deepStrictEqual(views('{"view":"bogus","browserView":"bogus"}'), ['rows', 'rows']);
  assert.deepStrictEqual(views('{"browserView":"bogus","view":"tiles"}'), ['tiles', 'tiles']);
  assert.deepStrictEqual(views(null), ['rows', 'rows']);
  assert.deepStrictEqual(views('not json'), ['rows', 'rows']);
});

t('the other saved choices are untouched by the move', () => {
  const p = parsePrefs('{"view":"cards","accent":"teal","grouping":false,"density":"cozy"}');
  assert.deepStrictEqual([p.accent, p.grouping, p.density], ['teal', false, 'cozy']);
});

t('Tiles is the small grid, Cards the large one, and both show a screenshot', () => {
  assert.deepStrictEqual(['rows', 'tiles', 'cards'].map(gridClass), ['rows', 'minis', 'tiles']);
  assert.deepStrictEqual(['rows', 'tiles', 'cards'].map(showsShot), [false, true, true]);
});

console.log(`\n${failed ? `${failed} failed` : 'all passed'}\n`);
process.exit(failed ? 1 : 0);
