/**
 * Browser profile store, validation, detection and pool.json import
 * (src/core/browserProfiles.js, browserDetect.js).
 * Run: node tests/browser-profiles.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs and invented names only; never the real PortPilot config.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const { detectBrowsers, browserIdFromPath } = require('../src/core/browserDetect');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bprof-'));
let n = 0;
let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}\n     ${err.stack || err.message}`);
    failed++;
  }
}
const fresh = () => path.join(root, `case${++n}`, 'portpilot-config.json');
const code = (c) => (err) => err instanceof bp.ProfileError && err.code === c;

console.log('\n=== browser profiles: store ===\n');

t('empty config (no file at all) lists no profiles', () => {
  assert.deepStrictEqual(bp.listProfiles(fresh()), []);
});

t('add stores defaults and persists beside existing config keys', () => {
  const cfg = fresh();
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ apps: [{ id: 'a1' }], settings: { theme: 'dark' }, groups: [] }));
  const p = bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  assert.deepStrictEqual(p, { name: 'shop-a', port: 9390, browser: 'chrome', mode: 'headed', url: '', note: '' });
  const onDisk = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  assert.strictEqual(onDisk.apps.length, 1);
  assert.strictEqual(onDisk.settings.theme, 'dark');
  assert.strictEqual(onDisk.browserProfiles.length, 1);
});

t('rejects bad name, port, browser, mode and url by code', () => {
  const cfg = fresh();
  assert.throws(() => bp.addProfile(cfg, { name: '../evil', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: '', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 80 }), code('BAD_PORT'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 70000 }), code('BAD_PORT'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 'x' }), code('BAD_PORT'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, browser: 'firefox' }), code('BAD_BROWSER'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, mode: 'minimised' }), code('BAD_MODE'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, url: 'javascript:alert(1)' }), code('BAD_URL'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: 'relative/dir' }), code('BAD_DIR'));
  assert.deepStrictEqual(bp.listProfiles(cfg), []);
});

t('name and port are unique (name case-insensitive)', () => {
  const cfg = fresh();
  bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  assert.throws(() => bp.addProfile(cfg, { name: 'SHOP-A', port: 9391 }), code('DUPLICATE_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: 'shop-b', port: 9390 }), code('DUPLICATE_PORT'));
  assert.strictEqual(bp.listProfiles(cfg).length, 1);
});

t('every profile gets its own dedicated user-data-dir under the config dir', () => {
  const cfg = fresh();
  const a = bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  const b = bp.addProfile(cfg, { name: 'shop-b', port: 9391 });
  const da = bp.userDataDirFor(cfg, a);
  const db = bp.userDataDirFor(cfg, b);
  assert.notStrictEqual(da, db);
  assert.strictEqual(da, path.join(path.dirname(cfg), 'browser-profiles', 'shop-a'));
});

t('update changes fields, keeps the name, and still enforces uniqueness', () => {
  const cfg = fresh();
  bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  bp.addProfile(cfg, { name: 'shop-b', port: 9391 });
  const u = bp.updateProfile(cfg, 'shop-a', { mode: 'offscreen', name: 'ignored', url: 'https://example.test/' });
  assert.strictEqual(u.name, 'shop-a');
  assert.strictEqual(u.mode, 'offscreen');
  assert.throws(() => bp.updateProfile(cfg, 'shop-a', { port: 9391 }), code('DUPLICATE_PORT'));
  assert.throws(() => bp.updateProfile(cfg, 'nope', { mode: 'headed' }), code('NOT_FOUND'));
});

t('remove keeps the folder unless purged; an adopted folder is never deleted', () => {
  const cfg = fresh();
  const a = bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  const dir = bp.userDataDirFor(cfg, a);
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(bp.removeProfile(cfg, 'shop-a').purged, false);
  assert.ok(fs.existsSync(dir));
  bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  assert.strictEqual(bp.removeProfile(cfg, 'shop-a', { purge: true }).purged, true);
  assert.ok(!fs.existsSync(dir));

  const adopted = path.join(root, `adopted${n}`);
  fs.mkdirSync(adopted, { recursive: true });
  bp.addProfile(cfg, { name: 'keep', port: 9392, userDataDir: adopted });
  assert.strictEqual(bp.removeProfile(cfg, 'keep', { purge: true }).purged, false);
  assert.ok(fs.existsSync(adopted));
});

t('names that would share or escape a folder are rejected: trailing dot, device names, dot-dot', () => {
  const cfg = fresh();
  assert.throws(() => bp.addProfile(cfg, { name: 'shop.', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: 'CON', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: 'nul.txt', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: '..', port: 9390 }), code('BAD_NAME'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a b', port: 9390 }), code('BAD_NAME'));
  assert.ok(bp.addProfile(cfg, { name: 'a.b_c-d', port: 9390 }));
});

t('an adopted folder must be safe and not shared: no root, home, config dir, profiles root or another profile\'s folder', () => {
  const cfg = fresh();
  const root = path.parse(cfg).root;
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: root }), code('BAD_DIR'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: os.homedir() }), code('BAD_DIR'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: path.dirname(cfg) }), code('BAD_DIR'));
  assert.throws(() => bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: bp.profilesRootFor(cfg) }), code('BAD_DIR'));
  const shared = path.join(root, 'tmp-shared-not-created');
  bp.addProfile(cfg, { name: 'a', port: 9390, userDataDir: shared });
  assert.throws(() => bp.addProfile(cfg, { name: 'b', port: 9391, userDataDir: shared }), code('DUPLICATE_DIR'));
  // b's default folder is <profiles root>/b; a profile adopting exactly that folder clashes
  assert.throws(() => bp.addProfile(cfg, { name: 'c', port: 9392, userDataDir: path.join(bp.profilesRootFor(cfg), 'b') }) && bp.addProfile(cfg, { name: 'b', port: 9393 }), code('DUPLICATE_DIR'));
});

t('a hand-edited config cannot reach a launch argument or a delete outside the profiles root', () => {
  const cfg = fresh();
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  const bad = (fields) => fs.writeFileSync(cfg, JSON.stringify({ browserProfiles: [{ port: 9390, browser: 'brave', mode: 'headed', ...fields }] }));
  bad({ name: '..' });
  assert.throws(() => bp.getProfile(cfg, '..'), code('BAD_NAME'));
  assert.throws(() => bp.removeProfile(cfg, '..', { purge: true }), code('BAD_NAME'));
  assert.ok(fs.existsSync(cfg), 'the config folder is still there');
  bad({ name: 'ok', url: '--renderer-cmd-prefix=calc.exe' });
  assert.throws(() => bp.getProfile(cfg, 'ok'), code('BAD_URL'));
  bad({ name: 'ok', port: '9390 --evil' });
  assert.throws(() => bp.getProfile(cfg, 'ok'), code('BAD_PORT'));
  bad({ name: 'ok', userDataDir: '/' });
  assert.throws(() => bp.getProfile(cfg, 'ok'), code('BAD_DIR'));
});

t('purge that cannot delete the folder leaves the profile listed', () => {
  const cfg = fresh();
  const a = bp.addProfile(cfg, { name: 'shop-a', port: 9390 });
  const dir = bp.userDataDirFor(cfg, a);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.rmSync;
  fs.rmSync = () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
  try {
    assert.throws(() => bp.removeProfile(cfg, 'shop-a', { purge: true }), /busy/);
  } finally { fs.rmSync = real; }
  assert.strictEqual(bp.listProfiles(cfg).length, 1);
});

console.log('\n=== browser profiles: pool.json import ===\n');

// Invented names and ports shaped like a real pool: ten profiles, 9222-9230 and 9240.
function writePool(extra = {}) {
  const dir = path.join(root, `pool${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const ports = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9240];
  const modes = ['headed', 'headed', 'offscreen', 'offscreen', 'headless', 'headed', 'headless', 'offscreen', 'headed', 'headless'];
  const pool = {
    bravePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    profileRoot: path.join(dir, 'profiles'),
    offscreenLeft: -2400,
    profiles: ports.map((port, i) => ({
      name: `site-${i + 1}`, port, mode: modes[i], url: `https://site${i + 1}.example.test/`, description: `Invented note ${i + 1}`,
    })),
    ...extra,
  };
  const file = path.join(dir, 'pool.json');
  fs.writeFileSync(file, JSON.stringify(pool));
  return { file, pool };
}

t('importing a ten-profile pool keeps every port and mode, maps description to note', () => {
  const cfg = fresh();
  const { file, pool } = writePool();
  const r = bp.importPool(cfg, file);
  assert.strictEqual(r.imported.length, 10);
  assert.deepStrictEqual(r.skipped, []);
  const got = bp.listProfiles(cfg);
  assert.deepStrictEqual(got.map((p) => [p.name, p.port, p.mode]), pool.profiles.map((p) => [p.name, p.port, p.mode]));
  assert.strictEqual(got[0].note, 'Invented note 1');
  assert.ok(got.every((p) => p.browser === 'brave' && !p.userDataDir));
});

t('import does not adopt old folders by default; --adopt-dirs adopts only folders that exist', () => {
  const { file, pool } = writePool();
  fs.mkdirSync(path.join(pool.profileRoot, 'site-2'), { recursive: true });
  const plain = fresh();
  bp.importPool(plain, file);
  assert.ok(bp.listProfiles(plain).every((p) => !p.userDataDir));
  const adopt = fresh();
  bp.importPool(adopt, file, { adoptDirs: true });
  const withDir = bp.listProfiles(adopt).filter((p) => p.userDataDir);
  assert.deepStrictEqual(withDir.map((p) => p.name), ['site-2']);
  assert.strictEqual(withDir[0].userDataDir, path.join(pool.profileRoot, 'site-2'));
});

t('re-import and clashes are skipped by name with a reason, nothing duplicated', () => {
  const cfg = fresh();
  const { file } = writePool();
  bp.importPool(cfg, file);
  const again = bp.importPool(cfg, file);
  assert.strictEqual(again.imported.length, 0);
  assert.strictEqual(again.skipped.length, 10);
  assert.strictEqual(bp.listProfiles(cfg).length, 10);
});

t('a bad entry is skipped, the rest still import', () => {
  const cfg = fresh();
  const { file, pool } = writePool();
  pool.profiles[3].port = 99;
  fs.writeFileSync(file, JSON.stringify(pool));
  const r = bp.importPool(cfg, file);
  assert.strictEqual(r.imported.length, 9);
  assert.strictEqual(r.skipped[0].name, 'site-4');
});

t('missing or malformed pool file is a BAD_POOL error, not a crash', () => {
  const cfg = fresh();
  assert.throws(() => bp.importPool(cfg, path.join(root, 'nope.json')), code('BAD_POOL'));
  const bad = path.join(root, 'bad.json');
  fs.writeFileSync(bad, '{"profiles": 3}');
  assert.throws(() => bp.importPool(cfg, bad), code('BAD_POOL'));
});

console.log('\n=== browser detection ===\n');

const has = (set) => (p) => set.includes(p);

t('Windows: finds Brave and Edge in Program Files, Chrome per-user', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  const exists = has([
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ]);
  const found = detectBrowsers({ platform: 'win32', env, exists });
  assert.deepStrictEqual(found.map((b) => b.id), ['chrome', 'edge', 'brave']);
});

t('macOS: finds apps in /Applications and ~/Applications', () => {
  const exists = has(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Users/u/Applications/Vivaldi.app/Contents/MacOS/Vivaldi']);
  const found = detectBrowsers({ platform: 'darwin', env: {}, home: '/Users/u', exists });
  assert.deepStrictEqual(found.map((b) => b.id), ['chrome', 'vivaldi']);
});

t('Linux: searches PATH then fixed dirs; first hit wins', () => {
  const exists = has(['/home/u/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser', '/opt/opera/opera']);
  const found = detectBrowsers({ platform: 'linux', env: { PATH: '/home/u/bin:/usr/bin' }, exists });
  assert.deepStrictEqual(found.map((b) => [b.id, b.path]), [
    ['brave', '/usr/bin/brave-browser'], ['chromium', '/home/u/bin/chromium'], ['opera', '/opt/opera/opera'],
  ]);
});

t('nothing installed -> empty list on every OS', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepStrictEqual(detectBrowsers({ platform, env: {}, home: '/h', exists: () => false }), []);
  }
});

t('browserIdFromPath maps launcher paths and falls back to chromium', () => {
  assert.strictEqual(browserIdFromPath('C:/x/brave.exe'), 'brave');
  assert.strictEqual(browserIdFromPath('C:/x/msedge.exe'), 'edge');
  assert.strictEqual(browserIdFromPath('/usr/bin/google-chrome'), 'chrome');
  assert.strictEqual(browserIdFromPath('/usr/bin/chromium'), 'chromium');
  assert.strictEqual(browserIdFromPath('/opt/weird'), 'chromium');
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
