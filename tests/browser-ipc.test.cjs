/**
 * Browsers tab IPC handlers (src/main/browserIpc.js), driven through a fake ipcMain.
 * Run: node tests/browser-ipc.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs and the slice 1 fake spawner only; no browser is launched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const { setupBrowserIpc } = require('../src/main/browserIpc');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bipc-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

async function setup() {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const port = await freePort();
  bp.addProfile(cfg, { name: 'shop', port, browser: 'brave', url: 'https://example.test/' });
  const w = world();
  const handlers = new Map();
  setupBrowserIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { configPath: cfg }, { runDeps: w.deps, pollMs: 5 });
  const call = (ch, ...args) => handlers.get(ch)({}, ...args);
  return { cfg, port, w, call, handlers, newPort: await freePort() };
}

(async () => {
  console.log('\n=== browser ipc ===\n');

  await t('registers exactly the eight channels', async () => {
    const { handlers } = await setup();
    assert.deepStrictEqual([...handlers.keys()].sort(), [
      'browser:duplicate', 'browser:extensions', 'browser:list', 'browser:remove',
      'browser:save', 'browser:setMode', 'browser:start', 'browser:stop',
    ]);
  });

  await t('list returns the profiles, the installed browsers and no warnings when the port is free', async () => {
    const { call, port } = await setup();
    const r = await call('browser:list');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.profiles[0].name, 'shop');
    assert.strictEqual(r.profiles[0].port, port);
    assert.strictEqual(r.profiles[0].state, 'down');
    assert.deepStrictEqual(r.browsers.map((b) => b.id), ['brave']);
    assert.deepStrictEqual(r.warnings, []);
  });

  await t('start and stop round-trip, and the desktop leaves an advisory claim', async () => {
    const { call, w } = await setup();
    const s = await call('browser:start', 'shop');
    assert.strictEqual(s.success, true);
    assert.strictEqual(s.state, 'up');
    assert.strictEqual(s.claim.by, 'PortPilot desktop');
    assert.strictEqual(s.claim.surface, 'desktop');
    const listed = await call('browser:list');
    assert.strictEqual(listed.profiles[0].claim.by, 'PortPilot desktop');
    const x = await call('browser:stop', 'shop');
    assert.strictEqual(x.success, true);
    assert.strictEqual(x.state, 'down');
    await w.cleanup();
  });

  await t('a second start while one is in flight is refused as BUSY, not run twice', async () => {
    const { call, w } = await setup();
    const [a, b] = await Promise.all([call('browser:start', 'shop'), call('browser:start', 'shop')]);
    const codes = [a, b].map((r) => (r.success ? 'ok' : r.code)).sort();
    assert.deepStrictEqual(codes, ['BUSY', 'ok']);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('list is shared while one is in flight and reused for a moment, then refreshed after an action', async () => {
    const { call, w } = await setup();
    const [a, b] = await Promise.all([call('browser:list'), call('browser:list')]);
    assert.strictEqual(a, b, 'the same sweep answers both callers');
    await call('browser:start', 'shop');
    const after = await call('browser:list');
    assert.strictEqual(after.profiles[0].state, 'up', 'a mutation drops the cached list');
    await w.cleanup();
  });

  await t('setMode changes the stored mode and says a running browser keeps the old one', async () => {
    const { call, cfg, w } = await setup();
    const r = await call('browser:setMode', 'shop', 'offscreen');
    assert.strictEqual(r.success, true);
    assert.strictEqual(bp.getProfile(cfg, 'shop').mode, 'offscreen');
    await call('browser:start', 'shop');
    const r2 = await call('browser:setMode', 'shop', 'headless');
    assert.match(r2.note, /keeps its old mode/);
    assert.strictEqual((await call('browser:setMode', 'shop', 'sideways')).code, 'BAD_MODE');
    await w.cleanup();
  });

  await t('save adds a profile and an edit changes note, url and mode', async () => {
    const { call, cfg, newPort } = await setup();
    const added = await call('browser:save', null, { name: 'blog', port: newPort, browser: 'brave', mode: 'headless', url: '', note: 'hello' });
    assert.strictEqual(added.success, true);
    assert.strictEqual(added.profile.mode, 'headless');
    const edited = await call('browser:save', 'blog', { note: 'changed', url: 'https://b.test/' });
    assert.strictEqual(edited.profile.note, 'changed');
    assert.strictEqual(bp.getProfile(cfg, 'blog').url, 'https://b.test/');
  });

  await t('save refuses a duplicate name or port with a plain error, and cannot rename', async () => {
    const { call, cfg, port, newPort } = await setup();
    assert.strictEqual((await call('browser:save', null, { name: 'SHOP', port: newPort })).code, 'DUPLICATE_NAME');
    assert.strictEqual((await call('browser:save', null, { name: 'blog', port })).code, 'DUPLICATE_PORT');
    await call('browser:save', 'shop', { name: 'renamed' });
    assert.ok(bp.listProfiles(cfg).every((p) => p.name === 'shop'));
  });

  await t('the renderer cannot set a folder: userDataDir is ignored on add and on edit', async () => {
    const { call, cfg, newPort } = await setup();
    const evil = path.join(root, 'elsewhere');
    await call('browser:save', null, { name: 'blog', port: newPort, userDataDir: evil });
    await call('browser:save', 'shop', { userDataDir: evil });
    for (const p of bp.listProfiles(cfg)) assert.strictEqual(p.userDataDir, undefined);
  });

  await t('changing the port or browser of a running profile is refused; its note still changes', async () => {
    const { call, cfg, w, newPort } = await setup();
    await call('browser:start', 'shop');
    const moved = await call('browser:save', 'shop', { port: newPort });
    assert.strictEqual(moved.code, 'PROFILE_RUNNING');
    assert.strictEqual((await call('browser:save', 'shop', { browser: 'chrome' })).code, 'PROFILE_RUNNING');
    assert.strictEqual((await call('browser:save', 'shop', { note: 'ok' })).success, true);
    assert.notStrictEqual(bp.getProfile(cfg, 'shop').port, newPort);
    await w.cleanup();
  });

  await t('remove drops the profile, keeps its folder, and refuses a running one', async () => {
    const { call, cfg, w } = await setup();
    const dir = bp.userDataDirFor(cfg, bp.getProfile(cfg, 'shop'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep'), 'x');
    await call('browser:start', 'shop');
    assert.strictEqual((await call('browser:remove', 'shop')).code, 'PROFILE_RUNNING');
    await call('browser:stop', 'shop');
    const r = await call('browser:remove', 'shop');
    assert.deepStrictEqual([r.success, r.folderKept], [true, true]);
    assert.strictEqual(bp.listProfiles(cfg).length, 0);
    assert.ok(fs.existsSync(path.join(dir, 'keep')), 'sign-ins stay on disk');
    await w.cleanup();
  });

  await t('duplicate registers a copy without sign-ins; extensions lists what was carried over', async () => {
    const { call, cfg, newPort } = await setup();
    const dir = bp.userDataDirFor(cfg, bp.getProfile(cfg, 'shop'));
    const id = 'a'.repeat(32);
    fs.mkdirSync(path.join(dir, 'Default', 'Extensions', id, '1.0_0'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Default', 'Extensions', id, '1.0_0', 'manifest.json'), '{"name":"Vault Pass","version":"1.0"}');
    fs.writeFileSync(path.join(dir, 'Default', 'Cookies'), 'SECRET');
    const r = await call('browser:duplicate', 'shop', { name: 'shop-2', port: newPort });
    assert.strictEqual(r.success, true);
    assert.match(r.leftOut, /sign-ins/);
    assert.ok(!fs.existsSync(path.join(bp.userDataDirFor(cfg, r.profile), 'Default', 'Cookies')));
    const e = await call('browser:extensions', 'shop-2');
    assert.deepStrictEqual(e.extensions, [{ id, name: 'Vault Pass', version: '1.0' }]);
  });

  await t('bad arguments and unknown profiles come back as plain failures, never a throw', async () => {
    const { call } = await setup();
    assert.strictEqual((await call('browser:start', 42)).code, 'BAD_ARGS');
    assert.strictEqual((await call('browser:stop', '')).code, 'BAD_ARGS');
    assert.strictEqual((await call('browser:duplicate', 'shop', null)).code, 'BAD_ARGS');
    assert.strictEqual((await call('browser:extensions', 'nope')).code, 'NOT_FOUND');
    assert.strictEqual((await call('browser:remove', 'nope')).code, 'NOT_FOUND');
  });

  await t('a raw Node error is reported as INTERNAL, without its path', async () => {
    const { call, cfg } = await setup();
    const real = bp.removeProfile;
    bp.removeProfile = () => { const e = new Error(`EPERM: operation not permitted, unlink '${cfg}'`); e.code = 'EPERM'; throw e; };
    const quiet = console.error; console.error = () => {};
    let r;
    try { r = await call('browser:remove', 'shop'); } finally { console.error = quiet; bp.removeProfile = real; }
    assert.deepStrictEqual([r.success, r.code], [false, 'INTERNAL']);
    assert.ok(!String(r.error).includes(root));
  });

  await t('a Node errno from a start comes back as INTERNAL with no path in it', async () => {
    const { call, cfg } = await setup();
    const real = fs.mkdirSync;
    fs.mkdirSync = (p, ...rest) => {
      if (String(p).includes('browser-profiles')) { const e = new Error(`EPERM: operation not permitted, mkdir '${p}'`); e.code = 'EPERM'; throw e; }
      return real(p, ...rest);
    };
    const quiet = console.error; console.error = () => {};
    let r;
    try { r = await call('browser:start', 'shop'); } finally { console.error = quiet; fs.mkdirSync = real; }
    assert.deepStrictEqual([r.success, r.code], [false, 'INTERNAL']);
    assert.ok(!JSON.stringify(r).includes(path.dirname(cfg)) && !/operation not permitted/.test(r.error));
  });

  await t('a failed launch is generic: the browser exe path does not reach the panel', async () => {
    const { call, w } = await setup();
    w.spawnThrows = new Error('spawn C:\\Program Files\\BraveSoftware\\brave.exe ENOENT');
    const r = await call('browser:start', 'shop');
    assert.strictEqual(r.code, 'LAUNCH_FAILED');
    assert.ok(!/brave\.exe|Program Files/.test(r.error), r.error);
  });

  await t('a known error that mentions a path is scrubbed (drive, UNC and posix)', async () => {
    const { call } = await setup();
    const real = bp.removeProfile;
    bp.removeProfile = () => { throw new bp.ProfileError('NOT_FOUND', 'no profile at C:\\Users\\me\\x and \\\\srv\\share\\y and /home/me/z/w and C:/a/b'); };
    let r;
    try { r = await call('browser:remove', 'shop'); } finally { bp.removeProfile = real; }
    assert.strictEqual(r.code, 'NOT_FOUND');
    assert.strictEqual(r.error, 'no profile at [path] and [path] and [path] and [path]');
  });

  await t('a foreign process on the port does not block editing the port or removing the profile', async () => {
    const { call, cfg, port, w, newPort } = await setup();
    await w.foreign(port, { pid: 777, processName: 'node', commandLine: 'node server.js' });
    const moved = await call('browser:save', 'shop', { port: newPort });
    assert.strictEqual(moved.success, true, moved.error);
    assert.strictEqual(bp.getProfile(cfg, 'shop').port, newPort);
    const gone = await call('browser:remove', 'shop');
    assert.strictEqual(gone.success, true, gone.error);
    await w.cleanup();
  });

  await t('list is single-flight past the ttl while a sweep runs, and the ttl counts from the sweep finishing', async () => {
    const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
    bp.addProfile(cfg, { name: 'shop', port: await freePort(), browser: 'brave' });
    const w = world();
    let sweeps = 0;
    const real = w.deps.inspectPort;
    w.deps.inspectPort = async (p) => { sweeps += 1; await new Promise((r) => setTimeout(r, 80)); return real(p); };
    const handlers = new Map();
    setupBrowserIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { configPath: cfg }, { runDeps: w.deps, pollMs: 5, listTtlMs: 30 });
    const list = () => handlers.get('browser:list')({});
    const first = list();
    await new Promise((r) => setTimeout(r, 50)); // past the 30 ms ttl, sweep still running
    const second = list();
    assert.strictEqual(await first, await second, 'the running sweep answers the late caller too');
    assert.strictEqual(sweeps, 1);
    await list(); // finished a moment ago: inside the ttl
    assert.strictEqual(sweeps, 1, 'ttl counts from completion');
    await new Promise((r) => setTimeout(r, 50));
    await list();
    assert.strictEqual(sweeps, 2, 'after the ttl a new sweep runs');
  });

  await t('a list started before an action is not handed to a caller after it', async () => {
    const { call, w } = await setup();
    const stale = call('browser:list'); // sweep begins while the profile is down
    await call('browser:start', 'shop');
    const fresh = await call('browser:list');
    assert.strictEqual(fresh.profiles[0].state, 'up');
    assert.notStrictEqual(await stale, fresh);
    await w.cleanup();
  });

  await t('profile names are compared trimmed: " shop " cannot start while "shop" is starting', async () => {
    const { call, w } = await setup();
    const [a, b] = await Promise.all([call('browser:start', 'shop'), call('browser:start', ' Shop ')]);
    assert.deepStrictEqual([a, b].map((r) => (r.success ? 'ok' : r.code)).sort(), ['BUSY', 'ok']);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('adding over a leftover folder says so; a fresh name does not', async () => {
    const { call, cfg, newPort } = await setup();
    const left = bp.userDataDirFor(cfg, { name: 'blog' });
    fs.mkdirSync(left, { recursive: true });
    const a = await call('browser:save', null, { name: 'blog', port: newPort });
    assert.deepStrictEqual([a.success, a.reusedFolder], [true, true]);
    const b = await call('browser:save', null, { name: 'fresh', port: await freePort() });
    assert.deepStrictEqual([b.success, b.reusedFolder], [true, false]);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
