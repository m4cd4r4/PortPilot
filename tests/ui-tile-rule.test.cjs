// Start on a stopped app whose port is taken names the holder: a stranger from the scan's conflicts,
// or another registered app running on that port. The scan credits a port to one app only, so the
// second case never shows up as a conflict, and Start used to say nothing at all.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '../ui/src/tileRule.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
const { appBlocked, portHolder } = mod.exports;

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); } catch (e) { failed++; console.log(`❌ ${name}\n     ${e.message}`); }
}
const shop = { id: 'shop', name: 'Shop', preferredPort: 3000 };
const shopWt = { id: 'shop-wt', name: 'Shop (worktree)', preferredPort: 3000 };
const blog = { id: 'blog', name: 'Blog', preferredPort: 4000 };
const snap = (o) => ({ apps: [shop, shopWt, blog], running: {}, conflicts: [], ...o });

console.log('\n=== ui/src/tileRule.ts ===\n');

t('nothing on the port: no notice', () => assert.strictEqual(appBlocked(snap({}), shop), null));

t('a stranger on the port is named with its pid', () => {
  const n = appBlocked(snap({ conflicts: [{ appId: 'shop', port: 3000, occupiedBy: { pid: 42, processName: 'node.exe' } }] }), shop);
  assert.strictEqual(n.text, 'Shop cannot start: :3000 is held by node (pid 42).');
  assert.deepStrictEqual([n.ports, n.port], [true, 3000]);
});

t('another registered app running on the port is named', () => {
  const n = appBlocked(snap({ running: { 'shop-wt': { port: 3000, pid: 7 } } }), shop);
  assert.strictEqual(n.text, 'Shop cannot start: :3000 is held by Shop (worktree), another of your apps. Stop it first.');
  assert.strictEqual(n.port, 3000);
});

t('an app is never blocked by itself, running or not', () => {
  assert.strictEqual(appBlocked(snap({ running: { shop: { port: 3000 } } }), shop), null);
  assert.strictEqual(portHolder(snap({ running: { blog: { port: 4000 } } }), blog), null);
});

t('another app on a different port does not block', () =>
  assert.strictEqual(appBlocked(snap({ running: { blog: { port: 4000 } } }), shop), null));

t('an app with no preferred port is only blocked by a scan conflict', () =>
  assert.strictEqual(appBlocked(snap({ running: { 'shop-wt': { port: 3000 } } }), { id: 'x', name: 'X' }), null));

console.log(failed ? `\n${failed} failed` : '\nall passed');
if (failed) process.exit(1);
