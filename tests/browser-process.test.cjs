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
// The stand-in reads its folder from its own --user-data-dir. Children: a helper (same exe,
// --type=renderer, the folder), a twin (same exe, no folder) and other (plain node: another name).
fs.writeFileSync(mainJs, `
const { spawn } = require('child_process');
const fs = require('fs');
const dir = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice(16);
const keep = ['-e', 'setInterval(() => {}, 1000)'];
const opts = { stdio: 'ignore', detached: true };
const helper = spawn(process.execPath, [...keep, '--', '--type=renderer', '--user-data-dir=' + dir], opts);
const twin = spawn(process.execPath, keep, opts);
const other = spawn(${JSON.stringify(process.execPath)}, keep, opts);
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ helper: helper.pid, twin: twin.pid, other: other.pid }));
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

/** Start the stand-in browser on `folder`; resolves { main, helper, twin, other } pids once all run. */
async function startBrowser(folder = dir, file = exe) {
  try { fs.rmSync(pidsFile, { force: true }); } catch { /* none */ }
  const child = spawn(file, [mainJs, `--user-data-dir=${folder}`], { stdio: 'ignore', windowsHide: true });
  mine.push(child.pid);
  for (let i = 0; i < 100 && !fs.existsSync(pidsFile); i++) await sleep(100);
  const p = JSON.parse(fs.readFileSync(pidsFile, 'utf8'));
  mine.push(p.helper, p.twin, p.other);
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
    assert.strictEqual(alive(b.twin), true, 'a child of the same exe that does not name the folder survives');
  });

  await t('killVerified refuses the right pid with another start time (a reused pid), and the wrong folder', async () => {
    const b = await startBrowser();
    const info = await q.processInfo(b.main);
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: '2001-01-01T00:00:00.0000000Z', dir }), 'mismatch');
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir: path.join(root, 'other') }), 'mismatch');
    assert.strictEqual(alive(b.main), true, 'not killed');
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir }), 'killed', 'the control: the true identity is accepted');
  });

  await t('killVerified refuses a process that names the folder but is not a browser (exe name check)', async () => {
    const b = await startBrowser(dir, process.execPath); // node.exe, the same command line
    const info = await q.processInfo(b.main);
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir }), 'mismatch');
    assert.strictEqual(alive(b.main), true);
  });

  await t('killVerified with main: true refuses a helper (--type=) on the folder; main: false ends it', async () => {
    const b = await startBrowser();
    const info = await q.processInfo(b.helper);
    assert.strictEqual(await q.killVerified({ pid: b.helper, createdAt: info.createdAt, dir, main: true }), 'mismatch');
    assert.strictEqual(alive(b.helper), true);
    assert.strictEqual(await q.killVerified({ pid: b.helper, createdAt: info.createdAt, dir, main: false }), 'killed');
  });

  await t('a folder with quotes (\' and U+2019), a space and non-ASCII is read, found and killed by its own value, never as script', async () => {
    const odd = path.join(root, 'pro\'f ’Seán');
    fs.mkdirSync(odd);
    const b = await startBrowser(odd);
    const info = await q.processInfo(b.main);
    assert.ok(info.commandLine.includes(odd), `command line read back as: ${info.commandLine}`);
    const held = await q.dirHolders(odd);
    assert.ok(held && held.some((h) => h.pid === b.main), JSON.stringify(held));
    assert.strictEqual(await q.killVerified({ pid: b.main, createdAt: info.createdAt, dir: odd }), 'killed');
  });

  await t('a failing CIM query is null (unknown), never an empty list that reads as "nothing holds the folder"', async () => {
    assert.strictEqual(await q.winList('Get-CimInstance -ClassName PP_NoSuchClass'), null);
    assert.deepStrictEqual(await q.winList('Get-CimInstance Win32_Process -Filter "ProcessId=999999999"'), [], 'the control: a query that works and finds nothing');
  });

  for (const pid of mine) { try { process.kill(pid); } catch { /* gone */ } }
  await sleep(300);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a handle may linger */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
