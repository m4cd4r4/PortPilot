/**
 * checkPort (src/main/portScanner.js) with retries: a full scan now and then misses a port that is
 * listening, and Kill then said "No process found" while the server kept running (Vikunja #3772).
 * Run: node tests/check-port-retry.test.cjs   (part of npm run test:unit)
 */
const assert = require('assert');
const { checkPort } = require('../src/main/portScanner');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); } catch (e) { console.log('❌', name, '-', e.message); failed++; }
}
// A scan that answers each listed result in turn, then the last one forever.
const scans = (...answers) => { let i = 0; const f = async () => { f.calls++; return answers[Math.min(i++, answers.length - 1)]; }; f.calls = 0; return f; };
const hit = { port: 3000, pid: 42 };

(async () => {
  await t('a port found on the first scan is returned at once', async () => {
    const scan = scans([hit]);
    assert.deepStrictEqual(await checkPort(3000, { retries: 2, delayMs: 0, scan }), hit);
    assert.strictEqual(scan.calls, 1);
  });
  await t('one empty scan is retried, and the port is found', async () => {
    const scan = scans([], [hit]);
    assert.deepStrictEqual(await checkPort(3000, { retries: 2, delayMs: 0, scan }), hit);
    assert.strictEqual(scan.calls, 2);
  });
  await t('a port that is really free costs retries + 1 scans, then null', async () => {
    const scan = scans([]);
    assert.strictEqual(await checkPort(3000, { retries: 2, delayMs: 0, scan }), null);
    assert.strictEqual(scan.calls, 3);
  });
  await t('with no retries (the default) a miss is answered at once', async () => {
    const scan = scans([], [hit]);
    assert.strictEqual(await checkPort(3000, { scan }), null);
    assert.strictEqual(scan.calls, 1);
  });
  if (failed) process.exit(1);
})();
