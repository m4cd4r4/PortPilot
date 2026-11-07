/**
 * The real OS side of browser process safety (src/core/browserProcessQuery.js), Windows only:
 * killVerified against real processes. A copy of node named brave.exe stands in for the browser,
 * started with a throwaway --user-data-dir; it starts one helper (the same exe, --type=renderer)
 * and one unrelated child (plain node, standing for a PDF viewer opened from a download).
 * Nothing outside this test's own processes is ever touched.
 * Run: node tests/browser-process.test.cjs   (part of npm run test:unit; skips off Windows)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const q = require('../src/core/browserProcessQuery');

if (process.platform !== 'win32') { console.log('SKIP browser-process: Windows only'); process.exit(0); }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bproc-'));
const exe = path.join(root, 'brave.exe');
try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
const dir = path.join(root, 'profile');
fs.mkdirSync(dir);
const pidsFile = path.join(root, 'pids.json');
const mainJs = path.join(root, 'main.js');
fs.writeFileSync(mainJs, `
const { spawn } = require('child_process');
const fs = require('fs');
const keep = ['-e', 'setInterval(() => {}, 1000)'];
const helper = spawn(process.execPath, [...keep, '--', '--type=renderer', '--user-data-dir=' + ${JSON.stringify(dir)}], { stdio: 'ignore', detached: true });
const other = spawn(${JSON.stringify(process.execPath)}, keep, { stdio: 'ignore', detached: true });
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ helper: helper.pid, other: other.pid }));
setInterval(() => {}, 1000);
`);

let passed = 0;
let failed = 0;
const mine = [];
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Start the stand-in browser; resolves { main, helper, other } pids once all three run. */
async function startBrowser() {
  try { fs.rmSync(pidsFile, { force: true }); } catch { /* none */ }
  const child = spawn(exe, [mainJs, `--user-data-dir=${dir}`], { stdio: 'ignore', windowsHide: true });
  mine.push(child.pid);
  for (let i = 0; i < 100 && !fs.existsSync(pidsFile); i++) await sleep(100);
  const p = JSON.parse(fs.readFileSync(pidsFile, 'utf8'));
  mine.push(p.helper, p.other);
  return { main: child.pid, ...p };
}

(async () => {
  console.log('\n=== browser process: killVerified on real processes ===\n');

  await t('killVerified ends the browser and its own helper, and never a non-browser child', async () => {
    const b = await startBrowser();
    const info = await q.processInfo(b.main);
    assert.ok(info && info.createdAt, JSON.stringify(info));
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir }), 'killed');
    await sleep(500);
    assert.strictEqual(alive(b.main), false, 'main ended');
    assert.strictEqual(alive(b.helper), false, 'its helper ended');
    assert.strictEqual(alive(b.other), true, 'the unrelated child survives');
  });

  await t('killVerified refuses the right pid with another start time (a reused pid), and the wrong folder', async () => {
    const b = await startBrowser();
    const info = await q.processInfo(b.main);
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: '2001-01-01T00:00:00.0000000Z', dir }), 'mismatch');
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir: path.join(root, 'other') }), 'mismatch');
    assert.strictEqual(alive(b.main), true, 'not killed');
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir }), 'killed', 'the control: the true identity is accepted');
  });

  for (const pid of mine) { try { process.kill(pid); } catch { /* gone */ } }
  await sleep(300);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a handle may linger */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
