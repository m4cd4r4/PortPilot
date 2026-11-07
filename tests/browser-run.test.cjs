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
    // The process table: pid -> { pid, ppid, processName, commandLine }. A browser leaves it when its
    // port drops, unless `lingerPolls` says how many process lookups it outlives that (Infinity: never goes).
    procs: new Map(), lingerPolls: 0, lookups: 0, killCalls: [], queryFails: false, failPids: new Set(), psStyle: false, refuseKill: false,
  };
  w.deps = {
    ...run.defaultDeps(),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    detect: () => installed,
    spawn(exe, args) {
      w.spawned.push({ exe, args });
      const pid = ++w.pid;
      const child = { pid, unref() {}, on(ev, cb) { if (ev === 'error' && w.spawnThrows) setImmediate(() => cb(w.spawnThrows)); } };
      if (w.spawnThrows) return child;
      const proc = { pid, ppid: 1, processName: 'fake-browser', commandLine: `${exe} ${args.join(' ')}`, createdAt: `t${pid}` };
      // A pid a test already put in the table stands for one the OS has reused: it is not replaced.
      if (!w.procs.has(pid)) w.procs.set(pid, { ...proc });
      if (w.neverListens) return child;
      const port = Number(args.find((a) => a.startsWith('--remote-debugging-port=')).split('=')[1]);
      if (w.takenDuringStart) {
        w.foreign(port, w.takenDuringStart, true);
        return child;
      }
      w.holders.set(port, proc);
      listen(port, true).then((s) => w.servers.set(port, s));
      return child;
    },
    inspectPort: async (port) => w.holders.get(port) || null,
    processInfo: async (pid) => {
      if (w.queryFails || w.failPids.has(pid)) return { unknown: true };
      const p = w.procs.get(pid);
      if (p && p.leaving !== undefined && ++w.lookups > p.leaving) { w.procs.delete(pid); return null; }
      return p ? { ...p } : null;
    },
    // psStyle: rows as macOS/Linux ps gives them, with no start time.
    dirHolders: async () => (w.queryFails ? null : [...w.procs.values()].map((p) => ({ ...p, ...(w.psStyle ? { createdAt: null } : {}) }))),
    closeBrowser: async (port) => {
      if (!w.closeWorks) return false;
      await w.drop(port);
      return true;
    },
    // The contract of browserProcessQuery.killVerified: same pid AND start time, or nothing happens;
    // its children go only when they are the same browser exe. Every call is recorded as asked.
    killVerified: async (target) => {
      w.killCalls.push(target);
      if (w.queryFails) return 'unknown';
      const p = w.procs.get(target.pid);
      if (!p) return 'gone';
      if (!target.createdAt || p.createdAt !== target.createdAt) return 'mismatch';
      if (target.main && /--type=/.test(p.commandLine || '')) return 'mismatch';
      if (w.refuseKill) return 'mismatch';
      w.killed.push(target.pid);
      for (const [port, h] of w.holders) if (h.pid === target.pid) await w.drop(port);
      for (const c of [...w.procs.values()]) if (c.pid === target.pid || (c.ppid === target.pid && c.processName === p.processName)) w.procs.delete(c.pid);
      return 'killed';
    },
    park: async (port, left) => { w.parked.push({ port, left }); return { parked: true, left }; },
  };
  w.drop = async (port) => {
    const s = w.servers.get(port);
    const h = w.holders.get(port);
    const p = h && w.procs.get(h.pid);
    if (p && w.lingerPolls) p.leaving = w.lookups + w.lingerPolls;
    else if (p) w.procs.delete(h.pid);
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

  await t('a start that times out never kills its child pid once that pid names another process', async () => {
    const w = world(); w.neverListens = true; const { cfg } = await setup();
    // The launched browser handed off and exited; the OS reused its pid for something else.
    w.procs.set(5001, { pid: 5001, ppid: 1, processName: 'editor.exe', commandLine: 'editor.exe notes.txt', createdAt: 'later' });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { timeoutMs: 20, pollMs: 5 }, w.deps), (err) => err.code === 'START_TIMEOUT');
    assert.deepStrictEqual(w.killed, []);
    assert.ok(w.procs.has(5001));
  });

  await t('a start that times out kills nothing when the launch identity (start time) was never read', async () => {
    const w = world(); w.neverListens = true; const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    w.failPids.add(5001); // the lookup right after spawn fails (slow query)
    const sleep = w.deps.sleep;
    w.deps.sleep = async (ms) => {
      // Meanwhile the child handed off and exited; the pid now names a renderer of a browser on the folder.
      if (w.failPids.size) {
        w.failPids.clear();
        w.procs.set(5001, { pid: 5001, ppid: 900, processName: 'fake-browser', commandLine: `/fake/brave --type=renderer --user-data-dir=${dir} --lang=en`, createdAt: 'other' });
      }
      return sleep(ms);
    };
    await assert.rejects(run.startProfile(cfg, 'shop-a', { timeoutMs: 20, pollMs: 5 }, w.deps), (err) => err.code === 'START_TIMEOUT');
    assert.deepStrictEqual(w.killCalls, []);
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

  await t('start ends a crash reporter left on the folder by a browser that is gone, then launches', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(4100, { pid: 4100, ppid: 4000, processName: 'fake-browser', commandLine: `/fake/brave --type=crashpad-handler --user-data-dir=${dir} /prefetch:4`, createdAt: 'c4100' });
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.deepStrictEqual(w.killed, [4100]);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('start refuses a browser it did not launch that has the folder open: FOLDER_IN_USE, nothing killed or spawned', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(4200, { pid: 4200, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} --` });
    w.procs.set(4201, { pid: 4201, ppid: 4200, processName: 'fake-browser', commandLine: `/fake/brave --type=crashpad-handler --user-data-dir=${dir} /prefetch:4` });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps),
      (err) => err.code === 'FOLDER_IN_USE' && /PID 4200/.test(err.message) && !/START_TIMEOUT/.test(err.code));
    assert.deepStrictEqual(w.killed, []);
    assert.strictEqual(w.spawned.length, 0);
  });

  await t('start after an outside close ends the lingering browser it launched itself, then launches (F45)', async () => {
    const w = world(); const { cfg, port } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    await w.drop(port); // closed from outside: the port is quiet, the main process is still on the folder
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.deepStrictEqual(w.killed, [5001]);
    assert.strictEqual(r.pid, 5002);
    await w.cleanup();
  });

  await t('start never ends helpers whose parent is alive and not ours (a hand-launched browser the check cannot read)', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    // Its own command line ends in a bare site name, so holdsDir does not match it; its helpers do.
    w.procs.set(4400, { pid: 4400, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} example.com`, createdAt: 'a' });
    w.procs.set(4401, { pid: 4401, ppid: 4400, processName: 'fake-browser', commandLine: `/fake/brave --type=renderer --user-data-dir=${dir} --lang=en`, createdAt: 'b' });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps), (err) => err.code === 'FOLDER_IN_USE' && /PID 4401/.test(err.message));
    assert.deepStrictEqual(w.killCalls, []);
    assert.strictEqual(w.spawned.length, 0);
  });

  await t('start refuses a reused pid with a different start time, even on the same folder: not ours, not killed', async () => {
    const w = world(); const { cfg, port, profile } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    await w.drop(port); // our browser closes from outside and is gone
    const dir = bp.userDataDirFor(cfg, profile);
    // Someone opens the folder by hand and the OS gives that browser our old pid.
    w.procs.set(5001, { pid: 5001, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} --`, createdAt: 'reborn' });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps), (err) => err.code === 'FOLDER_IN_USE');
    assert.deepStrictEqual(w.killCalls, []);
  });

  await t('a launch whose start time could not be read is not remembered: a later browser on that pid is not ended as ours', async () => {
    const w = world(); const { cfg, port, profile } = await setup();
    w.failPids.add(5001); // every lookup of the launched pid fails during this Start
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.failPids.clear();
    await w.drop(port);
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(5001, { pid: 5001, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} --`, createdAt: 'reborn' });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps), (err) => err.code === 'FOLDER_IN_USE');
    assert.deepStrictEqual(w.killCalls, []);
  });

  await t('ps-style holders (no start time, macOS and Linux): its own leftover is still found by pid AND start time and ended', async () => {
    const w = world(); const { cfg, port } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    await w.drop(port);
    w.psStyle = true;
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.deepStrictEqual(w.killCalls.map((k) => [k.pid, k.createdAt]), [[5001, 't5001']]);
    await w.cleanup();
  });

  await t('a helper whose parent pid now names a process started after it is an orphan: ended, then the launch goes ahead', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(4500, { pid: 4500, ppid: 4499, processName: 'fake-browser', commandLine: `/fake/brave --type=crashpad-handler --user-data-dir=${dir} /prefetch:4`, createdAt: '2026-11-07T01:00:00.0000000Z' });
    // Its browser is gone and the OS gave pid 4499 to an editor started later.
    w.procs.set(4499, { pid: 4499, ppid: 1, processName: 'editor.exe', commandLine: 'editor.exe notes.txt', createdAt: '2026-11-07T02:00:00.0000000Z' });
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.deepStrictEqual(w.killed, [4500]);
    assert.ok(w.procs.has(4499), 'the editor is untouched');
    await w.cleanup();
  });

  await t('FOLDER_IN_USE for a leftover that refused the kill says nothing was killed, not that it was ended', async () => {
    const w = world(); const { cfg, port } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    await w.drop(port);
    w.refuseKill = true;
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20, killMs: 20 }, w.deps),
      (err) => err.code === 'FOLDER_IN_USE' && /nothing was killed/.test(err.message) && !/ended them/.test(err.message));
  });

  await t('a pid seen gone is forgotten: a browser opened by hand that reuses it is not ended as ours', async () => {
    const w = world(); const { cfg, profile } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    await run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(5001, { pid: 5001, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} --` });
    await assert.rejects(run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 20 }, w.deps), (err) => err.code === 'FOLDER_IN_USE');
    assert.deepStrictEqual(w.killed, []);
  });

  await t('start waits for a browser that is leaving the folder by itself and kills nothing', async () => {
    const w = world(); const { cfg, profile } = await setup();
    const dir = bp.userDataDirFor(cfg, profile);
    w.procs.set(4300, { pid: 4300, ppid: 1, processName: 'fake-browser', commandLine: `/fake/brave --user-data-dir=${dir} --` });
    const sleep = w.deps.sleep;
    let naps = 0;
    w.deps.sleep = async (ms) => { if (++naps === 3) w.procs.delete(4300); return sleep(ms); };
    const r = await run.startProfile(cfg, 'shop-a', { pollMs: 5, folderMs: 1000 }, w.deps);
    assert.strictEqual(r.state, 'up');
    assert.deepStrictEqual(w.killed, []);
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

  await t('holdsDir sees Brave\'s crash reporter on the folder (unquoted value, then /prefetch:4), whole value only', () => {
    const line = (dir) => `"C:\\B\\brave.exe" --type=crashpad-handler --user-data-dir=${dir} /prefetch:4 --database=${dir}\\Crashpad`;
    assert.strictEqual(run.holdsDir({ processName: 'brave.exe', commandLine: line('C:\\cfg\\browser-profiles\\shop') }, 'C:/cfg/browser-profiles/shop'), true);
    assert.strictEqual(run.holdsDir({ processName: 'brave.exe', commandLine: line('C:\\cfg\\browser-profiles\\shop-a') }, 'C:/cfg/browser-profiles/shop'), false);
  });

  await t('parsePsTable reads pid, parent pid and the command line from ps (macOS and Linux)', () => {
    const rows = run.parsePsTable('  812     1 /opt/brave/brave --user-data-dir=/h/pp/shop --\n  813   812 /opt/brave/brave --type=crashpad-handler\nbad line\n');
    assert.deepStrictEqual(rows.map((r) => [r.pid, r.ppid, r.processName]), [[812, 1, 'brave'], [813, 812, 'brave']]);
    assert.strictEqual(run.holdsDir(rows[0], '/h/pp/shop'), true);
  });

  await t('parsePsTable names macOS browsers whose path has spaces (Chrome, Edge), so their folder holders are seen', () => {
    const rows = run.parsePsTable([
      '  900     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/h/pp/shop --',
      '  901     1 /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge --user-data-dir=/h/pp/shop --',
    ].join('\n'));
    assert.deepStrictEqual(rows.map((r) => r.processName), ['Google Chrome', 'Microsoft Edge']);
    assert.deepStrictEqual(rows.map((r) => run.holdsDir(r, '/h/pp/shop')), [true, true]);
  });

  await t('a signal refused for lack of permission is unknown, never gone: only ESRCH means no such process', () => {
    const { signalResult } = require('../src/core/browserProcessQuery');
    assert.deepStrictEqual([null, { code: 'ESRCH' }, { code: 'EPERM' }].map(signalResult), ['killed', 'gone', 'unknown']);
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

  await t('stop waits for the browser process it launched to exit after the port goes quiet, and kills nothing', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = 3;
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    assert.strictEqual(r.stoppedBy, 'cdp');
    assert.strictEqual(w.procs.has(5001), false, 'the browser process is gone when stop returns');
    assert.deepStrictEqual(r.browserExit && { pid: r.browserExit.pid, how: r.browserExit.how }, { pid: 5001, how: 'exited' });
    assert.deepStrictEqual(w.killed, []);
  });

  await t('stop ends the launched browser when it outlives the wait: one verified kill by pid and start time, reported as killed', async () => {
    const w = world(); const { cfg, profile } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5, exitMs: 30 }, w.deps);
    assert.strictEqual(r.browserExit.how, 'killed');
    assert.deepStrictEqual(w.killCalls, [{ pid: 5001, createdAt: 't5001', dir: bp.userDataDirFor(cfg, profile), main: true }]);
  });

  await t('stop with a failing process query says unknown, never exited, and kills nothing', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    w.queryFails = true;
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5, exitMs: 30 }, w.deps);
    assert.strictEqual(r.state, 'down');
    assert.strictEqual(r.browserExit.how, 'unknown');
    assert.deepStrictEqual(w.killCalls, []);
  });

  await t('stop reports mismatch, not exited, when the check inside the kill refuses the process', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    w.refuseKill = true;
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5, exitMs: 30 }, w.deps);
    assert.strictEqual(r.browserExit.how, 'mismatch');
    assert.deepStrictEqual(w.killed, []);
  });

  await t('stop never kills a reused pid: same number, another command line', async () => {
    const w = world(); const { cfg } = await setup();
    await run.startProfile(cfg, 'shop-a', { pollMs: 5 }, w.deps);
    w.lingerPolls = Infinity;
    const close = w.deps.closeBrowser;
    w.deps.closeBrowser = async (port) => {
      const ok = await close(port);
      // The browser is gone and the OS hands its pid to another browser, on another folder.
      w.procs.set(5001, { pid: 5001, ppid: 1, processName: 'fake-browser', commandLine: '/fake/brave --user-data-dir=/elsewhere/other --' });
      return ok;
    };
    const r = await run.stopProfile(cfg, 'shop-a', { pollMs: 5, exitMs: 30 }, w.deps);
    assert.strictEqual(r.browserExit.how, 'exited');
    assert.deepStrictEqual(w.killed, []);
    assert.ok(w.procs.has(5001), 'the other process is untouched');
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
    w.deps.killVerified = async ({ pid }) => { w.killed.push(pid); return 'killed'; };
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
