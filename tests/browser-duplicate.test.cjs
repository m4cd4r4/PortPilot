/**
 * Duplicate profile + installed-extension list (src/core/browserDuplicate.js, browserExtensions.js).
 * Run: node tests/browser-duplicate.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs and the slice 1 fake spawner only; no browser is launched and the real
 * PortPilot config is never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const run = require('../src/core/browserRun');
const dup = require('../src/core/browserDuplicate');
const ext = require('../src/core/browserExtensions');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bdup-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const EXT_ID = 'a'.repeat(32);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

/** A signed-in source profile: settings, one installed extension, and every credential file we must not copy. */
function seedSource(dir) {
  write(path.join(dir, 'Default', 'Preferences'), JSON.stringify({
    profile: { name: 'shop', content_settings: { exceptions: { site_engagement: { 'https://bank.test:443,*': { setting: { rawScore: 40 } } } } } },
    account_info: [{ email: 'me@example.test' }],
    brave: { wallet: { keyring: 'SECRET' } },
    extensions: { toolbar: [EXT_ID] },
    protection: { macs: { extensions: 'mac' } },
  }));
  write(path.join(dir, 'Default', 'Secure Preferences'), JSON.stringify({
    extensions: { settings: { [EXT_ID]: { state: 1 } } },
    protection: { super_mac: 'mac' },
    sync: { gaia_id: 'SECRET' },
  }));
  write(path.join(dir, 'Default', 'Extensions', EXT_ID, '1.2.0_0', 'manifest.json'),
    JSON.stringify({ name: 'Vault Pass', version: '1.2.0' }));
  for (const secret of [
    ['Local State'],
    ['Default', 'Cookies'],
    ['Default', 'Network', 'Cookies'],
    ['Default', 'Login Data'],
    ['Default', 'Login Data For Account'],
    ['Default', 'Web Data'],
    ['Default', 'History'],
    ['Default', 'Local Storage', 'leveldb', '000003.log'],
    ['Default', 'Sessions', 'Session_1'],
    ['Default', 'Local Extension Settings', EXT_ID, '000003.log'],
    ['SingletonLock'],
  ]) write(path.join(dir, ...secret), 'SECRET');
}

async function setup() {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const port = await freePort();
  const src = bp.addProfile(cfg, { name: 'shop', port, browser: 'brave', mode: 'offscreen', url: 'https://example.test/', note: 'signed in' });
  const srcDir = bp.userDataDirFor(cfg, src);
  seedSource(srcDir);
  const w = world();
  return { cfg, port, src, srcDir, w, newPort: await freePort() };
}

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
});

(async () => {
  console.log('\n=== duplicate profile + extension list ===\n');

  await t('duplicate copies settings and extensions, and nothing else', async () => {
    const { cfg, w, srcDir, newPort } = await setup();
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    const dir = bp.userDataDirFor(cfg, r.profile);
    assert.deepStrictEqual(walk(dir).sort(), [
      `Default/Extensions/${EXT_ID}/1.2.0_0/manifest.json`,
      'Default/Preferences',
      'Default/Secure Preferences',
    ]);
    assert.deepStrictEqual(r.copied.sort(), ['Default/Extensions', 'Default/Preferences', 'Default/Secure Preferences']);
    assert.ok(fs.existsSync(path.join(srcDir, 'Default', 'Login Data')), 'the source is untouched');
  });

  await t('no credential file reaches the copy (cookies, passwords, local state, sessions, extension data)', async () => {
    const { cfg, w, newPort } = await setup();
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    const files = walk(bp.userDataDirFor(cfg, r.profile));
    for (const f of files) {
      assert.ok(!/cookies|login data|local state|web data|history|sessions|local storage|local extension settings|singleton/i.test(f), `leaked ${f}`);
      assert.notStrictEqual(fs.readFileSync(path.join(bp.userDataDirFor(cfg, r.profile), f), 'utf8'), 'SECRET');
    }
    assert.match(r.leftOut, /sign-ins/);
  });

  await t('the copied preferences hold only the extensions and protection keys', async () => {
    const { cfg, w, newPort } = await setup();
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    const dir = bp.userDataDirFor(cfg, r.profile);
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'));
    const secure = JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Secure Preferences'), 'utf8'));
    assert.deepStrictEqual(Object.keys(prefs).sort(), ['extensions', 'protection']);
    assert.deepStrictEqual(Object.keys(secure).sort(), ['extensions', 'protection']);
    assert.deepStrictEqual(prefs.extensions, { toolbar: [EXT_ID] });
    const raw = fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8') + fs.readFileSync(path.join(dir, 'Default', 'Secure Preferences'), 'utf8');
    assert.ok(!/me@example|bank\.test|keyring|gaia_id|SECRET/.test(raw), 'no account, visited site or wallet data');
  });

  await t('a preferences file that is not a JSON object is skipped, not copied raw', async () => {
    const { cfg, srcDir, w, newPort } = await setup();
    write(path.join(srcDir, 'Default', 'Preferences'), '[1,2');
    write(path.join(srcDir, 'Default', 'Secure Preferences'), '[]');
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    assert.ok(!r.copied.includes('Default/Preferences') && !r.copied.includes('Default/Secure Preferences'));
    assert.ok(!fs.existsSync(path.join(bp.userDataDirFor(cfg, r.profile), 'Default', 'Preferences')));
  });

  await t('the new profile inherits browser, mode and url, takes its own name and port, and registers', async () => {
    const { cfg, w, newPort } = await setup();
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort, note: 'second' }, w.deps);
    assert.deepStrictEqual(r.profile, { name: 'shop-2', port: newPort, browser: 'brave', mode: 'offscreen', url: 'https://example.test/', note: 'second' });
    assert.ok(bp.listProfiles(cfg).some((p) => p.name === 'shop-2'));
  });

  await t('the note defaults to the source note', async () => {
    const { cfg, w, newPort } = await setup();
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    assert.strictEqual(r.profile.note, 'signed in');
  });

  await t('a running source is refused, and nothing is created', async () => {
    const { cfg, w, newPort } = await setup();
    await run.startProfile(cfg, 'shop', { pollMs: 5 }, w.deps);
    await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps), { code: 'SOURCE_RUNNING' });
    assert.strictEqual(bp.listProfiles(cfg).length, 1);
    assert.ok(!fs.existsSync(path.join(path.dirname(cfg), 'browser-profiles', 'shop-2')));
    await w.cleanup();
  });

  await t('bad name, taken name and taken port are refused before any folder is made', async () => {
    const { cfg, port, w, newPort } = await setup();
    await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: '../x', port: newPort }, w.deps), { code: 'BAD_NAME' });
    await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: 'SHOP', port: newPort }, w.deps), { code: 'DUPLICATE_NAME' });
    await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port }, w.deps), { code: 'DUPLICATE_PORT' });
    assert.deepStrictEqual(fs.readdirSync(path.join(path.dirname(cfg), 'browser-profiles')), ['shop']);
  });

  await t('an unknown source is NOT_FOUND', async () => {
    const { cfg, w, newPort } = await setup();
    await assert.rejects(dup.duplicateProfile(cfg, 'nope', { name: 'x', port: newPort }, w.deps), { code: 'NOT_FOUND' });
  });

  await t('an existing folder is never overwritten', async () => {
    const { cfg, w, newPort } = await setup();
    const taken = path.join(path.dirname(cfg), 'browser-profiles', 'shop-2');
    write(path.join(taken, 'keep.txt'), 'mine');
    await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps), { code: 'DUPLICATE_DIR' });
    assert.strictEqual(fs.readFileSync(path.join(taken, 'keep.txt'), 'utf8'), 'mine');
    assert.strictEqual(bp.listProfiles(cfg).length, 1);
  });

  await t('a source with no settings or extensions still duplicates to an empty folder', async () => {
    const { cfg, src, srcDir, w, newPort } = await setup();
    fs.rmSync(path.join(srcDir, 'Default'), { recursive: true, force: true });
    const r = await dup.duplicateProfile(cfg, src.name, { name: 'shop-2', port: newPort }, w.deps);
    assert.deepStrictEqual(r.copied, []);
    assert.ok(fs.existsSync(bp.userDataDirFor(cfg, r.profile)));
  });

  await t('a failed copy leaves no folder and no profile, and the error names no path', async () => {
    const { cfg, w, newPort } = await setup();
    const real = fs.promises.cp;
    fs.promises.cp = async () => { const e = new Error(`EPERM: operation not permitted, copyfile '${cfg}'`); e.code = 'EPERM'; throw e; };
    try {
      await assert.rejects(dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps), (err) => {
        assert.strictEqual(err.code, 'COPY_FAILED');
        assert.ok(!err.message.includes(root), 'the message must not carry an absolute path');
        return true;
      });
    } finally { fs.promises.cp = real; }
    assert.ok(!fs.existsSync(path.join(path.dirname(cfg), 'browser-profiles', 'shop-2')));
    assert.strictEqual(bp.listProfiles(cfg).length, 1);
  });

  await t('a junctioned Default folder is not followed out of the source', async () => {
    const { cfg, w, srcDir, newPort } = await setup();
    const outside = path.join(root, `outside-default${n}`);
    write(path.join(outside, 'Preferences'), JSON.stringify({ extensions: { leaked: true } }));
    write(path.join(outside, 'Extensions', EXT_ID, '9.9_0', 'manifest.json'), '{"name":"Leaked","version":"9.9"}');
    fs.rmSync(path.join(srcDir, 'Default'), { recursive: true, force: true });
    try { fs.symlinkSync(outside, path.join(srcDir, 'Default'), 'junction'); } catch {
      console.log('   SKIPPED (not a pass): no rights to make a junction here, so Default-link containment was NOT exercised');
      return;
    }
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    assert.deepStrictEqual(r.copied, []);
    assert.deepStrictEqual(walk(bp.userDataDirFor(cfg, r.profile)), []);
  });

  await t('a symlink in the source is not followed', async () => {
    const { cfg, w, srcDir, newPort } = await setup();
    const outside = path.join(root, `outside${n}`);
    write(path.join(outside, 'secret.txt'), 'SECRET');
    try { fs.symlinkSync(outside, path.join(srcDir, 'Default', 'Extensions', 'linked'), 'junction'); } catch { return; } // no link rights: nothing to check
    const r = await dup.duplicateProfile(cfg, 'shop', { name: 'shop-2', port: newPort }, w.deps);
    assert.ok(!walk(bp.userDataDirFor(cfg, r.profile)).some((f) => f.includes('secret.txt')));
  });

  await t('listExtensions reads id, name and the newest version', async () => {
    const dir = path.join(root, 'ext1');
    write(path.join(dir, 'Default', 'Extensions', EXT_ID, '1.9.0_0', 'manifest.json'), JSON.stringify({ name: 'Vault Pass', version: '1.9.0' }));
    write(path.join(dir, 'Default', 'Extensions', EXT_ID, '1.10.2_0', 'manifest.json'), JSON.stringify({ name: 'Vault Pass', version: '1.10.2' }));
    assert.deepStrictEqual(ext.listExtensions(dir), [{ id: EXT_ID, name: 'Vault Pass', version: '1.10.2' }]);
  });

  await t('listExtensions resolves __MSG_ names from _locales and falls back to the id', async () => {
    const dir = path.join(root, 'ext2');
    const idB = 'b'.repeat(32);
    const idC = 'c'.repeat(32);
    write(path.join(dir, 'Default', 'Extensions', EXT_ID, '2.0_0', 'manifest.json'), JSON.stringify({ name: '__MSG_appName__', default_locale: 'en', version: '2.0' }));
    write(path.join(dir, 'Default', 'Extensions', EXT_ID, '2.0_0', '_locales', 'en', 'messages.json'), JSON.stringify({ appName: { message: 'Bitwarden' } }));
    write(path.join(dir, 'Default', 'Extensions', idB, '1.0_0', 'manifest.json'), JSON.stringify({ name: '__MSG_missing__', version: '1.0' }));
    write(path.join(dir, 'Default', 'Extensions', idC, '1.0_0', 'manifest.json'), '{ not json');
    const list = ext.listExtensions(dir);
    assert.deepStrictEqual(list.map((e) => e.name), [idB, 'Bitwarden'].sort((a, b) => a.localeCompare(b)));
    assert.ok(!list.some((e) => e.id === idC), 'a corrupt manifest is skipped');
  });

  await t('listExtensions does not read a locale file outside the extension (default_locale "../..")', async () => {
    const dir = path.join(root, 'ext4');
    const base = path.join(dir, 'Default', 'Extensions', EXT_ID, '1.0_0');
    write(path.join(base, 'manifest.json'), JSON.stringify({ name: '__MSG_appName__', default_locale: '../..', version: '1.0' }));
    write(path.join(dir, 'Default', 'Extensions', EXT_ID, 'messages.json'), JSON.stringify({ appName: { message: 'ESCAPED' } }));
    write(path.join(base, '_locales', '..', '..', 'messages.json'), JSON.stringify({ appName: { message: 'ESCAPED' } }));
    const list = ext.listExtensions(dir);
    assert.strictEqual(list.length, 1);
    assert.notStrictEqual(list[0].name, 'ESCAPED');
  });

  await t('listExtensions ignores Temp and odd folders, and returns [] when there is no profile yet', async () => {
    const dir = path.join(root, 'ext3');
    write(path.join(dir, 'Default', 'Extensions', 'Temp', 'x.tmp'), '');
    write(path.join(dir, 'Default', 'Extensions', 'not-an-id', '1_0', 'manifest.json'), '{"name":"x"}');
    assert.deepStrictEqual(ext.listExtensions(dir), []);
    assert.deepStrictEqual(ext.listExtensions(path.join(root, 'does-not-exist')), []);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
