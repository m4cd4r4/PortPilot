/**
 * config:patchApp (src/core/dispatch.js + ConfigStore.patchApp).
 * Run: node tests/patch-app.test.cjs   (part of npm run test:unit)
 *
 * Covers: a group move made through config:patchApp keeps a change another
 * process wrote to the config file after the caller loaded its copy (the
 * move-to-group / drag-to-group stale write-back bug), that saving the stale
 * copy with config:saveApp does lose it, and the patch validation
 * (non-object rejected, id/createdAt stripped, unknown app).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { updateJson } = require('../src/core/configFile');
const { ConfigStore } = require('../src/main/configStore');
const { createDispatcher } = require('../src/core/dispatch');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-patchapp-'));
let n = 0;
const tmpConfig = () => {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'portpilot-config.json');
};

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

// One app on disk, a copy of it as the renderer would hold it, then another
// process changes the app's command behind that copy's back.
function setup() {
  const file = tmpConfig();
  const store = new ConfigStore(null, file);
  const created = store.saveApp({ name: 'web', command: 'npm run dev', cwd: root });
  const stale = JSON.parse(JSON.stringify(created));
  updateJson(file, (c) => {
    c.apps.find(a => a.id === created.id).command = 'pnpm dev --external';
  }, () => ({ apps: [] }));
  const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8')).apps.find(a => a.id === created.id);
  return { store, dispatch: createDispatcher(store), stale, onDisk };
}

(async () => {
  console.log('\n=== config:patchApp ===\n');

  await t('patchApp moves the app to a group and keeps the external change', async () => {
    const { store, dispatch, stale, onDisk } = setup();
    try {
      const r = await dispatch('config:patchApp', [stale.id, { group: 'g1' }]);
      assert.equal(r.success, true, r.error);
      assert.equal(r.app.group, 'g1');
      assert.equal(r.app.command, 'pnpm dev --external');
      assert.equal(onDisk().group, 'g1');
      assert.equal(onDisk().command, 'pnpm dev --external');
    } finally {
      store.close();
    }
  });

  await t('patchApp with group null moves the app out of its group', async () => {
    const { store, dispatch, stale, onDisk } = setup();
    try {
      await dispatch('config:patchApp', [stale.id, { group: 'g1' }]);
      const r = await dispatch('config:patchApp', [stale.id, { group: null }]);
      assert.equal(r.success, true, r.error);
      assert.equal(onDisk().group, null);
      assert.equal(onDisk().command, 'pnpm dev --external');
    } finally {
      store.close();
    }
  });

  await t('control: saveApp of the stale copy loses the external change (the old path)', async () => {
    const { store, dispatch, stale, onDisk } = setup();
    try {
      await dispatch('config:saveApp', [{ ...stale, group: 'g1' }]);
      assert.equal(onDisk().group, 'g1');
      assert.equal(onDisk().command, 'npm run dev');
    } finally {
      store.close();
    }
  });

  await t('patchApp rejects a patch that is not a plain object', async () => {
    const { store, dispatch, stale } = setup();
    try {
      for (const bad of [null, 'g1', 42, ['g1']]) {
        const r = await dispatch('config:patchApp', [stale.id, bad]);
        assert.equal(r.success, false, `accepted ${JSON.stringify(bad)}`);
      }
    } finally {
      store.close();
    }
  });

  await t('patchApp strips id and createdAt from the patch', async () => {
    const { store, dispatch, stale, onDisk } = setup();
    try {
      const r = await dispatch('config:patchApp', [stale.id, { id: 'hijack', createdAt: '1999-01-01', group: 'g2' }]);
      assert.equal(r.success, true, r.error);
      assert.equal(onDisk().id, stale.id);
      assert.equal(onDisk().createdAt, stale.createdAt);
      assert.equal(onDisk().group, 'g2');
    } finally {
      store.close();
    }
  });

  await t('patchApp on an unknown app reports App not found', async () => {
    const { store, dispatch } = setup();
    try {
      const r = await dispatch('config:patchApp', ['no-such-app', { group: 'g1' }]);
      assert.equal(r.success, false);
      assert.equal(r.error, 'App not found');
    } finally {
      store.close();
    }
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
