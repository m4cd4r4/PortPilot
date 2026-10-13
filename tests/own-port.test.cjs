/**
 * A port held by a process PortPilot itself started is that app's own port, never a conflict.
 * Run: node tests/own-port.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const { matchPortsToApps } = require('../src/main/ipcHandlers');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('OK ', name); passed++; }
  catch (e) { console.log('XX ', name, '-', e.message); failed++; }
}

// A relative-path command: the listener's command line names neither the cwd nor the app.
const shop = { id: 'app_shop', name: 'shop', cwd: 'C:\\work\\zz-demo-1', preferredPort: 5001 };
const listener = { port: 5001, pid: 700, processName: 'node.exe', address: '127.0.0.1:5001', commandLine: 'node  server.js --port 5001' };

t('without ownership info, a relative-command listener is still an unknown conflict', () => {
  const { unknownConflicts } = matchPortsToApps([listener], [shop]);
  assert.equal(unknownConflicts.length, 1);
});

t('a listener owned by the app is matched to it, not recorded as a conflict', () => {
  const { matches, unknownConflicts } = matchPortsToApps([listener], [shop], { app_shop: new Set([700]) });
  assert.equal(unknownConflicts.length, 0);
  assert.equal(matches.app_shop.port, 5001);
  assert.equal(matches.app_shop.pid, 700);
  assert.equal(matches.app_shop.confidence, 'high');
});

t('a foreign holder is still a conflict even when the app owns other pids', () => {
  const { matches, unknownConflicts } = matchPortsToApps([listener], [shop], { app_shop: new Set([1, 2]) });
  assert.equal(matches.app_shop, undefined);
  assert.equal(unknownConflicts.length, 1);
  assert.equal(unknownConflicts[0].occupiedBy.pid, 700);
});

t('an owned match is not overwritten by a later cwd match on another port', () => {
  const other = { port: 5002, pid: 701, processName: 'node.exe', address: '127.0.0.1:5002', commandLine: 'node c:\\work\\zz-demo-1\\x.js' };
  const { matches } = matchPortsToApps([other, listener], [shop], { app_shop: new Set([700]) });
  assert.equal(matches.app_shop.port, 5001);
});

const { descendantsOf } = require('../src/main/processTree');

t('descendantsOf returns the roots and every child, grandchild and so on', () => {
  const pairs = [[10, 1], [11, 10], [12, 11], [13, 10], [20, 1], [21, 20]];
  assert.deepEqual([...descendantsOf([10], pairs)].sort((a, b) => a - b), [10, 11, 12, 13]);
});

t('descendantsOf survives a cycle and unknown roots', () => {
  const pairs = [[1, 2], [2, 1]];
  assert.deepEqual([...descendantsOf([1, 99], pairs)].sort((a, b) => a - b), [1, 2, 99]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
