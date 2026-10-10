/**
 * Browser profile start / stop / status / reservation warning (src/core/browserRun.js).
 * Run: node tests/browser-run.test.cjs   (part of npm run test:unit)
 *
 * A fake spawner starts a real local HTTP server that answers CDP's /json/version, so the
 * probing code runs for real; spawn, port inspection and kill are faked. No browser is
 * launched and the real PortPilot config is never touched.
 * tdd-guard:allow - written in one pass against code from the same slice (backfill).
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const cdp = require('../src/core/browserCdp');
const run = require('../src/core/browserRun');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-brun-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}\n     ${err.stack || err.message}`);
    failed++;
  }
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Servers on a port: `cdpServer` answers /json/version and /json like a browser; a foreign one is plain 404.
function listen(port, isCdp) {
  const server = http.createServer((req, res) => {
    if (isCdp && req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: 'FakeBrowser/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }));
    } else if (isCdp && req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 't1', type: 'page', title: 'Start', url: 'https://example.test/' }]));
    } else {
      res.statusCode = 404;
      res.end('no');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
const closeServer = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

// A pretend machine: holders of ports, calls recorded, behaviour switches.
function world({ installed = [{ id: 'brave', label: 'Brave', path: '/fake/brave' }] } = {}) {
  const w = {
    servers: new Map(), holders: new Map(), spawned: [], killed: [], parked: [],
    closeWorks: true, neverListens: false, spawnThrows: null, pid: 5000,
  };
  w.deps = {
    ...run.defaultDeps(),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    detect: () => installed,
    spawn(exe, args) {
      w.spawned.push({ exe, args });
      const pid = ++w.pid;
      const child = { pid, unref() {}, on(ev, cb) { if (ev === 'error' && w.spawnThrows) setImmediate(() => cb(w.spawnThrows)); } };
      if (w.neverListens || w.spawnThrows) return child;
      const port = Number(args.find((a) => a.startsWith('--remote-debugging-port=')).split('=')[1]);
      if (w.takenDuringStart) {
        w.foreign(port, w.takenDuringStart, true);
        return child;
      }
      w.holders.set(port, { pid, processName: 'fake-browser', commandLine: `${exe} ${args.join(' ')}` });
      listen(port, true).then((s) => w.servers.set(port, s));
      return child;
    },
    inspectPort: async (port) => w.holders.get(port) || null,
    closeBrowser: async (port) => {
      if (!w.closeWorks) return false;
      await w.drop(port);
      return true;
    },
    kill: async (pid) => {
      w.killed.push(pid);
      for (const [port, h] of w.holders) if (h.pid === pid) await w.drop(port);
    },
    park: async (port, left) => { w.parked.push({ port, left }); return { parked: true, left }; },
  };
  w.drop = async (port) => {
    const s = w.servers.get(port);
    w.holders.delete(port);
    w.servers.delete(port);
    if (s) await closeServer(s);
  };
  // Something unrelated already listening there (not CDP).
  w.foreign = async (port, holder, isCdp = false) => {
    w.holders.set(port, holder);
    w.servers.set(port, await listen(port, isCdp));
  };
  w.cleanup = async () => { for (const p of [...w.servers.keys()]) await w.drop(p); };
  return w;
}

async function setup(fields = {}) {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const port = await freePort();
  const profile = bp.addProfile(cfg, { name: 'shop-a', port, browser: 'brave', url: 'https://example.test/', ...fields });
  return { cfg, profile, port: profile.port };
}

(async () => {
  console.log('\n=== browser run: start ===\n');

  await t('start launches with the debug port, its own user-data-dir and the start URL; reports up with the pid', async () => {
    const w = world(); const { cfg, port } = await setup();
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.strictEqual(r.already, false);
    assert.strictEqual(r.owner, 'profile');
    assert.strictEqual(r.pid, 5001);
    assert.strictEqual(r.tabs[0].url, 'https://example.test/');
    const { exe, args } = w.spawned[0];
    assert.strictEqual(exe, '/fake/brave');
    assert.ok(args.includes(`--remote-debugging-port=${port}`));
    assert.ok(args.includes(`--user-data-dir=${path.join(path.dirname(cfg), 'browser-profiles', 'shop-a')}`));
    assert.strictEqual(args[args.length - 1], 'https://example.test/');
    assert.ok(!args.includes('--headless=new'));
    await w.cleanup();
  });

  await t('two profiles launch with two different user-data-dirs', async () => {
    const w = world(); const a = await setup();
    const p2 = bp.addProfile(a.cfg, { name: 'shop-b', port: await freePort(), browser: 'brave' });
    await run.startProfile(a.cfg, 'shop-a', { pollMs: 5 }, w.deps);
    await run.startProfile(a.cfg, p2.name, { pollMs: 5 }, w.deps);
    const dirs = w.spawned.map((s) => s.args.find((x) => x.startsWith('--user-data-dir=')));
    assert.strictEqual(new Set(dirs).size, 2);
    await w.cleanup();
  });

  await t('headless adds --headless=new; offscreen adds a window position and parks the window', async () => {
    const w = world(); const { cfg, port } = await setup();
    await run.startProfile(cfg, 'shop-a', { mode: 'headless', pollMs: 5 }, w.deps);
    assert.ok(w.spawned[0].args.includes('--headless=new'));
    await run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    const r = await run.startProfile(cfg, 'shop-a', { mode: 'offscreen', pollMs: 5 }, w.deps);
    assert.ok(w.spawned[1].args.includes(`--window-position=${run.OFFSCREEN_LEFT},0`));
    assert.deepStrictEqual(w.parked, [{ port, left: run.OFFSCREEN_LEFT }]);
    assert.strictEqual(r.offscreen.parked, true);
    await w.cleanup();
  });

  await t('starting an already-up profile spawns nothing', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    const again = await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.strictEqual(again.already, true);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('port held by another process: fails by name, reports the holder, kills nothing', async () => {
    const w = world(); const { cfg, port } = await setup();
    await w.foreign(port, { pid: 777, processName: 'node.exe', commandLine: 'node dev-server.js' });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps), (err) => {
      assert.strictEqual(err.code, 'PORT_HELD');
      assert.deepStrictEqual(err.holder, { pid: 777, processName: 'node.exe' });
      assert.ok(err.message.includes('node.exe') && err.message.includes('777') && err.message.includes('shop-a'));
      return true;
    });
    assert.strictEqual(w.spawned.length, 0);
    assert.deepStrictEqual(w.killed, []);
    assert.ok(w.servers.has(port), 'the other process is still listening');
    await w.cleanup();
  });

  await t('browser not installed -> BROWSER_NOT_FOUND naming what is installed; nothing spawned', async () => {
    const w = world({ installed: [{ id: 'edge', label: 'Microsoft Edge', path: '/fake/edge' }] }); const { cfg } = await setup();
    await assert.rejects(run.startProfile(cfg, 'shop-a', {}, w.deps), (err) => err.code === 'BROWSER_NOT_FOUND' && /edge/.test(err.message));
    assert.strictEqual(w.spawned.length, 0);
  });

  await t('a browser that never answers CDP -> START_TIMEOUT', async () => {
    const w = world(); w.neverListens = true; const { cfg } = await setup();
    await assert.rejects(run.startProfile(cfg, 'shop-a', { timeoutMs: 40, pollMs: 5 }, w.deps), (err) => err.code === 'START_TIMEOUT');
  });

  await t('a spawn error -> LAUNCH_FAILED', async () => {
    const w = world(); w.spawnThrows = new Error('ENOENT'); const { cfg } = await setup();
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps), (err) => err.code === 'LAUNCH_FAILED');
  });

  await t('start clears restored sessions in the profile dir before launching', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const sessions = path.join(bp.userDataDirFor(cfg, profile), 'Default', 'Sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'Session_1'), 'x');
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.deepStrictEqual(fs.readdirSync(sessions), []);
    await w.cleanup();
  });

  await t('buildArgs: Brave-only flag, no URL means about:blank', () => {
    const base = { name: 'x', port: 9390, url: '' };
    const brave = run.buildArgs({ ...base, browser: 'brave' }, 'headed', '/d');
    const chrome = run.buildArgs({ ...base, browser: 'chrome' }, 'headed', '/d');
    assert.ok(brave.includes('--disable-features=BraveRewards,BraveWallet'));
    assert.ok(!chrome.some((a) => a.includes('BraveRewards')));
    assert.strictEqual(chrome[chrome.length - 1], 'about:blank');
    assert.strictEqual(chrome[chrome.length - 2], '--', 'the URL can never be read as a switch');
  });

  await t('a start that times out ends the browser it spawned, so no orphan holds the folder', async () => {
    const w = world(); w.neverListens = true; const { cfg } = await setup();
    await assert.rejects(run.startProfile(cfg, 'shop-a', { timeoutMs: 20, pollMs: 5 }, w.deps), (err) => err.code === 'START_TIMEOUT');
    assert.deepStrictEqual(w.killed, [5001]);
  });

  await t('start refuses a foreign CDP browser it cannot identify, and spawns nothing', async () => {
    const w = world(); const { cfg, port } = await setup();
    w.servers.set(port, await listen(port, true));
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps), (err) => err.code === 'NOT_VERIFIED');
    assert.strictEqual(w.spawned.length, 0);
    await w.cleanup();
  });

  await t('start does not report success when another process takes the port during launch', async () => {
    const w = world(); const { cfg } = await setup();
    w.takenDuringStart = { pid: 999, processName: 'node.exe', commandLine: 'node late.js' };
    await assert.rejects(run.startProfile(cfg, 'shop-a', { timeoutMs: 100, pollMs: 5 }, w.deps), (err) => err.code === 'PORT_HELD' && err.holder.pid === 999);
    await w.cleanup();
  });

  console.log('\n=== browser run: status and reservation warning ===\n');

  await t('status: down with nothing listening', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const s = await run.profileStatus(cfg, profile, w.deps);
    assert.strictEqual(s.state, 'down');
    assert.strictEqual(s.warning, undefined);
  });

  await t('status: blocked carries a warning naming the holder, and allStatus lists it', async () => {
    const w = world(); const { cfg, profile, port } = await setup();
    await w.foreign(port, { pid: 31, processName: 'postgres', commandLine: 'postgres -D data' });
    const { rows, warnings } = await run.allStatus(cfg, [profile], w.deps);
    assert.strictEqual(rows[0].state, 'blocked');
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].kind, 'browser-port-held');
    assert.strictEqual(warnings[0].profile, 'shop-a');
    assert.deepStrictEqual(warnings[0].holder, { pid: 31, processName: 'postgres' });
    assert.ok(warnings[0].sentence.includes(`:${port} is held by postgres`));
    await w.cleanup();
  });

  await t('status: CDP answering with an unidentifiable holder is up but unverified', async () => {
    const w = world(); const { cfg, profile, port } = await setup();
    w.servers.set(port, await listen(port, true));
    const s = await run.profileStatus(cfg, profile, w.deps);
    assert.strictEqual(s.state, 'up');
    assert.strictEqual(s.owner, 'unverified');
    await w.cleanup();
  });

  await t('holdsDir matches quoted Windows paths and ignores case and slash style', () => {
    const holder = { commandLine: '"C:\\Brave\\brave.exe" --remote-debugging-port=9390 "--user-data-dir=C:\\Users\\U\\AppData\\Roaming\\portpilot\\browser-profiles\\shop-a" about:blank' };
    assert.strictEqual(run.holdsDir(holder, 'c:/users/u/appdata/roaming/portpilot/browser-profiles/shop-a'), true);
    assert.strictEqual(run.holdsDir(holder, 'C:/Users/U/AppData/Roaming/portpilot/browser-profiles/other'), false);
    assert.strictEqual(run.holdsDir({ commandLine: null }, '/x'), false);
  });

  await t('holdsDir compares the whole flag value: "shop" does not own a browser started for "shop-a"', () => {
    const forA = { processName: 'brave.exe', commandLine: '"C:\\B\\brave.exe" "--user-data-dir=C:\\cfg\\browser-profiles\\shop-a" about:blank' };
    assert.strictEqual(run.holdsDir(forA, 'C:/cfg/browser-profiles/shop-a'), true);
    assert.strictEqual(run.holdsDir(forA, 'C:/cfg/browser-profiles/shop'), false);
    assert.strictEqual(run.holdsDir(forA, 'C:/cfg/browser-profiles'), false);
    assert.strictEqual(run.holdsDir(forA, 'C:/'), false);
  });

  await t('holdsDir handles unquoted ps output with the start URL after the path, and a flag-quoted value', () => {
    const ps = { processName: 'chrome', commandLine: '/usr/bin/chrome --remote-debugging-port=9390 --user-data-dir=/h/pp/browser-profiles/shop -- https://example.test/' };
    assert.strictEqual(run.holdsDir(ps, '/h/pp/browser-profiles/shop'), true);
    assert.strictEqual(run.holdsDir(ps, '/h/pp/browser-profiles/sho'), false);
    const quoted = { processName: 'msedge.exe', commandLine: 'msedge.exe --user-data-dir="C:\\Users\\J Smith\\pp\\shop" --no-first-run' };
    assert.strictEqual(run.holdsDir(quoted, 'C:/Users/J Smith/pp/shop'), true);
  });

  await t('holdsDir: a non-browser process never owns a dir, even with the flag in its command line', () => {
    const node = { processName: 'node.exe', commandLine: 'node tool.js --user-data-dir=/p/shop' };
    assert.strictEqual(run.holdsDir(node, '/p/shop'), false);
    assert.strictEqual(run.holdsDir({ processName: 'node.exe', commandLine: 'node /srv/app/server.js' }, '/'), false);
  });

  await t('parseNetstat finds IPv4 and IPv6-only listeners, any language, and ignores connections and UDP', () => {
    const out = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1036',
      '  TCP    127.0.0.1:9390         0.0.0.0:0              LISTENING       30680',
      '  TCP    [::1]:5173             [::]:0                 ABH\u00d6REN        4242',
      '  TCP    127.0.0.1:9390         127.0.0.1:50110        ESTABLISHED     777',
      '  TCP    [::]:9500              [::]:0                 LISTENING       515',
      '  UDP    0.0.0.0:9600           *:*                                    616',
    ].join('\r\n');
    assert.strictEqual(run.parseNetstat(out, 9390), 30680);
    assert.strictEqual(run.parseNetstat(out, 5173), 4242);
    assert.strictEqual(run.parseNetstat(out, 9500), 515);
    assert.strictEqual(run.parseNetstat(out, 9600), null);
    assert.strictEqual(run.parseNetstat(out, 50110), null);
    assert.strictEqual(run.parseNetstat('', 9390), null);
  });

  console.log('\n=== browser run: stop ===\n');

  await t('stop asks the browser to quit over CDP first and does not kill when that works', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.strictEqual(r.state, 'down');
    assert.strictEqual(r.stoppedBy, 'cdp');
    assert.deepStrictEqual(w.killed, []);
  });

  await t('stop falls back to the PID when the browser ignores the CDP close', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.closeWorks = false;
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5, graceMs: 30 }, w.deps);
    assert.strictEqual(r.stoppedBy, 'pid');
    assert.deepStrictEqual(w.killed, [5001]);
  });

  await t('stop does not kill when the port changed hands during the grace period (pid reuse)', async () => {
    const w = world(); const { cfg, port } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.closeWorks = false;
    // Our browser exits on its own mid-grace and a different process takes the port.
    const origSleep = w.deps.sleep;
    let swapped = false;
    w.deps.sleep = async (ms) => {
      if (!swapped) {
        swapped = true;
        await w.drop(port);
        await w.foreign(port, { pid: 6001, processName: 'node.exe', commandLine: 'node other.js' });
      }
      return origSleep(ms);
    };
    await assert.rejects(run.stopProfile(cfg, 'shop-a', { pollMs: 5, graceMs: 20, killMs: 20 }, w.deps), (err) => err.code === 'STOP_FAILED');
    assert.deepStrictEqual(w.killed, [], 'nothing was killed');
    await w.cleanup();
  });

  await t('stop on a down profile is a no-op', async () => {
    const w = world(); const { cfg } = await setup();
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.strictEqual(r.already, true);
    assert.deepStrictEqual(w.killed, []);
  });

  await t('stop refuses a process that is not this profile\'s browser, and kills nothing', async () => {
    const w = world(); const { cfg, port } = await setup();
    await w.foreign(port, { pid: 888, processName: 'node.exe', commandLine: 'node other.js' });
    await assert.rejects(run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps), (err) => err.code === 'NOT_OURS' && err.holder.pid === 888);
    assert.deepStrictEqual(w.killed, []);
    await w.cleanup();
  });

  await t('stop refuses when CDP answers but the owner cannot be identified', async () => {
    const w = world(); const { cfg, port } = await setup();
    w.servers.set(port, await listen(port, true));
    await assert.rejects(run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps), (err) => err.code === 'NOT_VERIFIED');
    assert.deepStrictEqual(w.killed, []);
    await w.cleanup();
  });

  await t('stop that cannot bring the port down -> STOP_FAILED', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.closeWorks = false;
    w.deps.kill = async (pid) => { w.killed.push(pid); };
    await assert.rejects(run.stopProfile(cfg, 'shop-a', { pollMs: 5, graceMs: 20, killMs: 20 }, w.deps), (err) => err.code === 'STOP_FAILED');
    await w.cleanup();
  });

  await t('real CDP helpers: version and pageTabs read a live endpoint, null/[] when nothing listens', async () => {
    const port = await freePort();
    assert.strictEqual(await cdp.version(port), null);
    assert.deepStrictEqual(await cdp.pageTabs(port), []);
    const s = await listen(port, true);
    assert.strictEqual((await cdp.version(port)).Browser, 'FakeBrowser/1.0');
    assert.strictEqual((await cdp.pageTabs(port))[0].url, 'https://example.test/');
    await closeServer(s);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
