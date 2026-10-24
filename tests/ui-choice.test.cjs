/**
 * Which UI loads (src/core/uiChoice.js): new by default, classic by setting, environment overrides.
 * Run: node tests/ui-choice.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const { chooseUi } = require('../src/core/uiChoice');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

console.log('\n=== ui choice ===\n');

t('new is the default when it is built', () => {
  assert.deepStrictEqual(chooseUi({ built: true }), { ui: 'new', forced: false, missing: false });
});

t('settings.ui = classic loads classic; any other value is new', () => {
  assert.strictEqual(chooseUi({ setting: 'classic', built: true }).ui, 'classic');
  assert.strictEqual(chooseUi({ setting: 'new', built: true }).ui, 'new');
  assert.strictEqual(chooseUi({ setting: 'garbage', built: true }).ui, 'new');
});

t('PORTPILOT_NEW_UI=0 forces classic over a setting of new; =1 forces new over classic', () => {
  assert.deepStrictEqual(chooseUi({ env: '0', setting: 'new', built: true }), { ui: 'classic', forced: true, missing: false });
  assert.deepStrictEqual(chooseUi({ env: '1', setting: 'classic', built: true }), { ui: 'new', forced: true, missing: false });
});

t('any other environment value is ignored', () => {
  assert.deepStrictEqual(chooseUi({ env: 'yes', setting: 'classic', built: true }), { ui: 'classic', forced: false, missing: false });
});

t('a new UI that is not built falls back to classic and says so, however it was chosen', () => {
  assert.deepStrictEqual(chooseUi({ built: false }), { ui: 'classic', forced: false, missing: true });
  assert.deepStrictEqual(chooseUi({ env: '1', built: false }), { ui: 'classic', forced: true, missing: true });
});

t('classic never reports missing, built or not', () => {
  assert.strictEqual(chooseUi({ setting: 'classic', built: false }).missing, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
