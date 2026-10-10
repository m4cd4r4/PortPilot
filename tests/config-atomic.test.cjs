/**
 * Shared-config write safety (src/core/configFile.js + ConfigStore).
 * Run: node tests/config-atomic.test.cjs   (part of npm run test:unit)
 *
 * Covers: concurrent writers in separate processes lose nothing, a stale lock
 * from a crashed holder is taken over, a live lock is waited on, no temp files
 * are left behind, ConfigStore does not overwrite another process's change,
 * and ConfigStore's watcher keeps firing after rename-replace (on Linux a
 * plain file watch goes silent after the first replace).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HELPER = path.join(__dirname, '..', 'src', 'core', 'configFile.js');
const { updateJson, readJson, withLock } = require(HELPER);
const { ConfigStore } = require('../src/main/configStore');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-atomic-'));
let n = 0;
const tmpConfig = () => path.join(root, `case${++n}`, 'portpilot-config.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}\n     ${err.message}`);
    failed++;
  }
}

// A child process that appends `count` tagged apps, one locked update each.
function writer(file, tag, count) {
  const code = `
    const { updateJson } = require(${JSON.stringify(HELPER)});
    for (let i = 0; i < ${count}; i++) {
      updateJson(${JSON.stringify(file)}, c => { c.apps.push({ id: '${tag}-' + i }); }, () => ({ apps: [] }));
    }`;
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('exit', c => (c === 0 ? resolve() : reject(new Error(`writer ${tag} exited ${c}: ${err}`))));
  });
}

(async () => {
  console.log('\n=== src/core/configFile.js ===\n');

  await t('two concurrent writer processes: 2 x 100 updates, none lost', async () => {
    const file = tmpConfig();
    await Promise.all([writer(file, 'a', 100), writer(file, 'b', 100)]);
    const ids = readJson(file, null).apps.map(a => a.id);
    assert.strictEqual(new Set(ids).size, 200, `expected 200 unique apps, got ${new Set(ids).size}`);
  });

  await t('no .tmp or .lock files left behind', async () => {
    const file = tmpConfig();
    for (let i = 0; i < 5; i++) updateJson(file, c => { c.apps.push(i); }, () => ({ apps: [] }));
    const leftovers = fs.readdirSync(path.dirname(file)).filter(f => f !== 'portpilot-config.json');
    assert.deepStrictEqual(leftovers, []);
  });

  await t('stale lock (crashed holder) is taken over', async () => {
    const file = tmpConfig();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.lock`, '99999');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(`${file}.lock`, old, old);
    const start = Date.now();
    updateJson(file, c => { c.apps.push('x'); }, () => ({ apps: [] }));
    assert.ok(Date.now() - start < 1000, 'took over a stale lock without waiting');
    assert.deepStrictEqual(readJson(file, null).apps, ['x']);
  });

  await t('stale lock + two concurrent writers: 2 x 50 updates, none lost', async () => {
    // Both writers see the same stale lock; only one may take it over, and the
    // other must not then delete the new holder's lock.
    const file = tmpConfig();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.lock`, 'crashed-holder');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(`${file}.lock`, old, old);
    await Promise.all([writer(file, 'a', 50), writer(file, 'b', 50)]);
    const ids = readJson(file, null).apps.map(a => a.id);
    assert.strictEqual(new Set(ids).size, 100, `expected 100 unique apps, got ${new Set(ids).size}`);
    const leftovers = fs.readdirSync(path.dirname(file)).filter(f => f !== 'portpilot-config.json');
    assert.deepStrictEqual(leftovers, []);
  });

  await t('release does not delete a lock that is no longer ours', async () => {
    const file = tmpConfig();
    withLock(file, () => { fs.writeFileSync(`${file}.lock`, 'someone-else'); });
    assert.strictEqual(fs.readFileSync(`${file}.lock`, 'utf8'), 'someone-else');
    fs.unlinkSync(`${file}.lock`);
  });

  await t('live lock held by another process is waited on, not broken', async () => {
    const file = tmpConfig();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const code = `
      const { withLock } = require(${JSON.stringify(HELPER)});
      withLock(${JSON.stringify(file)}, () => { process.stdout.write('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); });`;
    const child = spawn(process.execPath, ['-e', code]);
    await new Promise(r => child.stdout.once('data', r));
    const start = Date.now();
    updateJson(file, c => { c.apps.push('after'); }, () => ({ apps: [] }));
    assert.ok(Date.now() - start >= 200, `should have waited for the holder (waited ${Date.now() - start}ms)`);
    await new Promise(r => child.on('exit', r));
    assert.deepStrictEqual(readJson(file, null).apps, ['after']);
  });

  await t('mutator that changes nothing does not rewrite the file', async () => {
    const file = tmpConfig();
    updateJson(file, () => {}, () => ({ apps: [] }));
    const before = fs.statSync(file).mtimeMs;
    await sleep(30);
    const r = updateJson(file, () => 'nothing', () => ({ apps: [] }));
    assert.strictEqual(r.result, 'nothing');
    assert.strictEqual(fs.statSync(file).mtimeMs, before);
  });

  await t('lock is released when the mutator throws', async () => {
    const file = tmpConfig();
    assert.throws(() => updateJson(file, () => { throw new Error('boom'); }, () => ({ apps: [] })), /boom/);
    assert.ok(!fs.existsSync(`${file}.lock`));
    withLock(file, () => {}); // would time out if the lock leaked
  });

  console.log('\n=== src/main/configStore.js ===\n');

  await t('saveApp keeps an app another process added since load', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    try {
      updateJson(file, c => { c.apps.push({ id: 'from-mcp', name: 'mcp', command: 'x' }); }, () => ({ apps: [] }));
      store.saveApp({ name: 'from-app', command: 'npm run dev' }); // before the watcher reloads
      const names = readJson(file, null).apps.map(a => a.name).sort();
      assert.deepStrictEqual(names, ['from-app', 'mcp']);
    } finally {
      store.close();
    }
  });

  await t('patchApp keeps a field another process changed since load', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    try {
      const app = store.saveApp({ name: 'web', command: 'npm run dev', description: 'old' });
      updateJson(file, c => { c.apps[0].description = 'new'; }, () => ({ apps: [] }));
      const patched = store.patchApp(app.id, a => ({ isFavorite: !a.isFavorite })); // cache still says 'old'
      assert.strictEqual(patched.isFavorite, true);
      const onDisk = readJson(file, null).apps[0];
      assert.strictEqual(onDisk.description, 'new');
      assert.strictEqual(onDisk.isFavorite, true);
      assert.strictEqual(store.patchApp('missing', { isFavorite: true }), null);
    } finally {
      store.close();
    }
  });

  await t('updateDiscovery keeps a scan path another process added since load', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    try {
      updateJson(file, c => { c.settings.discovery.scanPaths.push('/from-mcp'); }, null);
      store.updateDiscovery(d => { d.scanPaths = [...(d.scanPaths || []), '/from-app']; });
      assert.deepStrictEqual(readJson(file, null).settings.discovery.scanPaths, ['/from-mcp', '/from-app']);
    } finally {
      store.close();
    }
  });

  await t('import: bad input returns false; a failed write throws and keeps the old config', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    try {
      assert.strictEqual(store.import('not json'), false);
      assert.strictEqual(store.import('{"apps": 3}'), false);
      store.saveApp({ name: 'keep', command: 'x' });
      fs.unlinkSync(file);
      fs.mkdirSync(file); // the rename onto the config path now fails
      assert.throws(() => store.import('{"apps": [{"name": "new", "command": "y"}]}'), /Failed to save imported config/);
      assert.deepStrictEqual(store.getApps().map(a => a.name), ['keep']);
    } finally {
      store.close();
    }
  });

  await t('watcher still fires after the file is replaced by rename', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    const seen = [];
    store.onConfigChange = (payload) => seen.push(payload.apps.length);
    try {
      await sleep(150);
      updateJson(file, c => { c.apps.push({ id: '1' }); }, () => ({ apps: [] }));
      await sleep(400);
      updateJson(file, c => { c.apps.push({ id: '2' }); }, () => ({ apps: [] }));
      await sleep(400);
      assert.deepStrictEqual(seen, [1, 2], `change events seen: ${JSON.stringify(seen)}`);
    } finally {
      store.close();
    }
  });

  await t('a browser-profile-only change reloads the cache but does not announce an apps change', async () => {
    const file = tmpConfig();
    const store = new ConfigStore(null, file);
    const seen = [];
    store.onConfigChange = (payload) => seen.push(payload.apps.length);
    try {
      await sleep(150);
      updateJson(file, c => { c.browserProfiles = [{ name: 'shop', port: 9231 }]; }, () => ({ apps: [] }));
      await sleep(400);
      assert.deepStrictEqual(seen, [], `an apps-change event fired for a profile edit: ${JSON.stringify(seen)}`);
      assert.deepStrictEqual(store.config.browserProfiles, [{ name: 'shop', port: 9231 }], 'the cache still picks the profile up');
    } finally {
      store.close();
    }
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
