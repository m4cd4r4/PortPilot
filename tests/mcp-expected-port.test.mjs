/**
 * expectedPort: the port start_app verifies is the one the command pins, not a stale preferredPort.
 * Case: Solaisoft had preferredPort 3002 and `npm run dev -- --port 3007`; start_app reported
 * "port 3002 never came up" while the app was healthy on 3007.
 *
 * Run: node tests/mcp-expected-port.test.mjs
 */
import assert from 'node:assert';
import { expectedPort, alreadyRunning } from '../mcp-server/index.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); fail++; }
}

const app = (command, preferredPort = null) => ({ name: 'x', command, preferredPort });

t('--port in the command beats a different preferredPort', () => {
  assert.strictEqual(expectedPort(app('npm run dev -- --port 3007', 3002)), 3007);
});
t('--port=N form', () => assert.strictEqual(expectedPort(app('vite --port=5174', 3000)), 5174));
t('-p N form', () => assert.strictEqual(expectedPort(app('next dev -p 3400', 3000)), 3400));
t('no flag falls back to preferredPort', () => assert.strictEqual(expectedPort(app('npm run dev', 3300)), 3300));
t('no flag and no preferredPort is null', () => assert.strictEqual(expectedPort(app('npm run dev')), null));
t('out-of-range port in the command is ignored', () => assert.strictEqual(expectedPort(app('serve --port 99999', 3000)), 3000));
t('a flag that merely ends in -p is not a port', () => assert.strictEqual(expectedPort(app('tool --skip-p 80', 3000)), 3000));
t('alreadyRunning checks the command port', () => {
  const seen = [];
  const r = alreadyRunning(app('npm run dev -- --port 3007', 3002), (p) => { seen.push(p); return p === 3007; });
  assert.deepStrictEqual(seen, [3007]);
  assert.strictEqual(r.alreadyRunning, true);
  assert.match(r.message, /3007/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
