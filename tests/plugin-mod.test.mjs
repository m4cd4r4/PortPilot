/**
 * Plugin mod pure logic (plugin/hooks/guard-core.mjs).
 * Run: node tests/plugin-mod.test.mjs   (part of npm run test:unit)
 *
 * Covers: listener parsing per platform, the status line (worst state first,
 * the Claude mark), dev-server start detection, and the guard decision
 * (deny / route / pass), and observing an unregistered start through the real
 * noteStart / completeObservations (plugin/hooks/observe.mjs) with faked I/O. The rest of the hooks
 * wiring in register.tsx is covered locally by `claude plugin test plugin`;
 * CI has no claude CLI.
 */
import assert from 'node:assert';
import {
  parseListeners, parseTasklistName, appStates, statusLine, parseStart, normPath, startDir, decide, routeResult,
} from '../plugin/hooks/guard-core.mjs';
import { completeObservations, isOneShot, noteStart, parseProcTable, pickPendingFiles, READ_LIMIT, removeArgv, sessionPid, uniqueAppName } from '../plugin/hooks/observe.mjs';

let passed = 0;
let failed = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ---- parseListeners ---------------------------------------------------------

t('win32 netstat: LISTENING rows only, PID kept, established skipped', () => {
  const out = [
    'Active Connections',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4812',
    '  TCP    [::]:5173              [::]:0                 LISTENING       900',
    '  TCP    127.0.0.1:3000         127.0.0.1:51234        ESTABLISHED     4812',
    '  UDP    0.0.0.0:5353           *:*                                    1200',
  ].join('\r\n');
  const m = parseListeners('win32', out);
  assert.deepStrictEqual([...m.keys()].sort((a, b) => a - b), [3000, 5173]);
  assert.equal(m.get(3000).pid, 4812);
  assert.equal(m.get(3000).processName, 'Unknown');
});

t('darwin lsof: port, pid and command name', () => {
  const out = [
    'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'node    71234 mac   23u  IPv6 0xabc      0t0  TCP *:3000 (LISTEN)',
    'Python  555   mac   4u   IPv4 0xdef      0t0  TCP 127.0.0.1:8000 (LISTEN)',
  ].join('\n');
  const m = parseListeners('darwin', out);
  assert.deepStrictEqual(m.get(3000), { port: 3000, pid: 71234, processName: 'node' });
  assert.equal(m.get(8000).processName, 'Python');
  assert.equal(m.size, 2);
});

t('linux ss -tlnp: port, pid and name from users:(...)', () => {
  const out = [
    'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0      511    0.0.0.0:3000      0.0.0.0:*     users:(("node",pid=2211,fd=21))',
    'LISTEN 0      128    [::]:22           [::]:*',
  ].join('\n');
  const m = parseListeners('linux', out);
  assert.deepStrictEqual(m.get(3000), { port: 3000, pid: 2211, processName: 'node' });
  assert.equal(m.get(22).pid, null);
});

t('parseTasklistName reads the image name from CSV', () => {
  assert.equal(parseTasklistName('"node.exe","4812","Console","1","52,000 K"\r\n'), 'node.exe');
  assert.equal(parseTasklistName('INFO: No tasks are running'), null);
});

// ---- statusLine -------------------------------------------------------------

const claudeStart = { kind: 'claude', surface: 'mcp', sessionId: 'abcd1234' };
const config = {
  apps: [
    { id: 'web', name: 'web', cwd: 'I:/Scratch/app/web', command: 'npm run dev', preferredPort: 3000 },
    { id: 'api', name: 'api', cwd: 'I:/Scratch/app/api', command: 'npm run dev', preferredPort: 4000 },
    { id: 'docs', name: 'docs', cwd: 'I:/Scratch/app/docs', command: 'npm run dev', preferredPort: 5000 },
    { id: 'idle', name: 'idle', cwd: 'I:/Scratch/app/idle', command: 'npm run dev', preferredPort: 6000 },
  ],
};
const listen = (...ports) => new Map(ports.map((p) => [p, { port: p, pid: 1, processName: 'node.exe' }]));

t('statusLine: crashed first, Claude mark, idle app left out', () => {
  const runtime = { apps: { web: { startedBy: claudeStart, port: 3000 }, api: { startedBy: { kind: 'human', surface: 'desktop' } } } };
  const line = statusLine(config, runtime, listen(3000, 5000));
  assert.equal(line, '⚓ 1 crashed · 2 up · ✕ api · :3000 web✦ · :5000 docs');
});

t('statusLine: rows past three collapse to +N', () => {
  const runtime = { apps: { api: {}, idle: {} } };
  const line = statusLine(config, runtime, listen(3000, 5000));
  assert.equal(line, '⚓ 2 crashed · 2 up · ✕ api · ✕ idle · :3000 web · +1');
});

// tdd-guard:allow  (fix and tests written together; the red run is checked against the old rule)
t('statusLine: a just-started app that is not listening yet reads starting, not crashed', () => {
  const now = Date.parse('2026-10-07T04:00:20Z');
  const runtime = { apps: { web: { startedBy: { kind: 'human', surface: 'desktop', at: '2026-10-07T04:00:00Z' }, port: 3000 } } };
  assert.equal(statusLine(config, runtime, listen(), now), '⚓ 1 starting · 0 up · ◐ web');
});

t('statusLine: the explicit crashed stamp is a crash even inside the start window', () => {
  const now = Date.parse('2026-10-07T04:00:20Z');
  const runtime = { apps: { web: { crashed: { exitCode: 1, at: now - 1000 }, port: 3000 } } };
  assert.equal(statusLine(config, runtime, listen(), now), '⚓ 1 crashed · 0 up · ✕ web');
});

t('statusLine: no sidecar entry (after a stop or an app quit) leaves the app out', () => {
  assert.equal(statusLine(config, { apps: {} }, listen()), '⚓ 0 up');
});

t('statusLine: undefined when no apps are registered', () => {
  assert.equal(statusLine({ apps: [] }, {}, listen(3000)), undefined);
  assert.equal(statusLine(null, {}, listen()), undefined);
});

t('appStates: sidecar port wins over preferredPort', () => {
  const rows = appStates(config, { apps: { web: { port: 3001 } } }, listen(3001));
  assert.deepStrictEqual(rows.map((r) => [r.id, r.port, r.state]), [['web', 3001, 'running']]);
});

// ---- parseStart -------------------------------------------------------------

const cdPort = (cmd) => { const s = parseStart(cmd); return s && { cd: s.cd, port: s.port }; };

t('parseStart: cd chain then npm run dev', () => {
  assert.deepStrictEqual(cdPort('cd web && npm run dev'), { cd: 'web', port: null });
  assert.deepStrictEqual(cdPort('cd "I:/Scratch/my app" && pnpm dev'), { cd: 'I:/Scratch/my app', port: null });
});

t('parseStart: PORT= env prefix', () => {
  assert.deepStrictEqual(cdPort('PORT=3001 npm run dev'), { cd: null, port: 3001 });
});

t('parseStart: --port and -p flags', () => {
  assert.deepStrictEqual(cdPort('npx vite --port 5174'), { cd: null, port: 5174 });
  assert.deepStrictEqual(cdPort('npm run dev -- --port=3002 &'), { cd: null, port: 3002 });
  assert.deepStrictEqual(cdPort('npx next dev -p 3005'), { cd: null, port: 3005 });
  assert.deepStrictEqual(cdPort('python -m http.server 8080'), { cd: null, port: 8080 });
});

t('parseStart: non-server commands return null', () => {
  assert.equal(parseStart('npm run build'), null);
  assert.equal(parseStart('npm test'), null);
  assert.equal(parseStart('cd web && git status'), null);
  assert.equal(parseStart(''), null);
});

// The whole guard, composed the way register.tsx composes it.
function guard(command, { cwd = 'I:/Scratch/app/web', runtime = {}, listeners = listen(), cfg = config } = {}) {
  const start = parseStart(command);
  if (!start) return null;
  const dir = startDir(cwd, start.cd, { windows: true, session: 'sess-1' });
  return decide({ start, dir, config: cfg, runtime, listeners, windows: true, session: 'sess-1' });
}

t('case 1: a non-cd step before the start passes, busy port or free', () => {
  // The cd moves to api; the guard must not judge web (the session cwd) instead.
  assert.deepStrictEqual(guard('cd ../api && npm install && npm run dev'), { action: 'pass' });
  assert.deepStrictEqual(guard('cd ../api && npm install && npm run dev', { listeners: listen(3000) }), { action: 'pass' });
});

t('case 2: a pipe, fallback, redirect or later step is never routed (start_app would drop it)', () => {
  for (const cmd of ['npm run dev | tee dev.log', 'npm run dev || echo fail', 'npm run dev > dev.log 2>&1 &',
    'npm run dev & sleep 5 && curl localhost:3000', 'npm run dev; echo done', 'NODE_ENV=test npm run dev']) {
    assert.deepStrictEqual(guard(cmd), { action: 'pass' }, cmd);
    // The port is still certain, so a busy one is still denied.
    assert.equal(guard(cmd, { listeners: listen(3000) }).action, 'deny', cmd);
  }
  // A bare start, a leading cd chain and a trailing & still route.
  assert.equal(guard('npm run dev &').action, 'route');
  assert.equal(guard('cd ../api && npm run dev').app.id, 'api');
});

t('case 3: export PORT is read; a start whose bound port is unknown is not a collision', () => {
  // export PORT=3005 binds 3005, not web's 3000.
  assert.deepStrictEqual(guard('export PORT=3005 && npm run dev', { listeners: listen(3000) }), { action: 'pass' });
  assert.equal(guard('export PORT=3005 && npm run dev', { listeners: listen(3005) }).action, 'deny');
  // vite preview binds 4173, not the preferredPort of an app registered as `npm run dev`.
  assert.deepStrictEqual(guard('npm run preview', { listeners: listen(3000) }), { action: 'pass' });
  // PORT from a variable, and bash's `set PORT=` (which exports nothing): unknown.
  assert.deepStrictEqual(guard('PORT=$P npm run dev', { listeners: listen(3000) }), { action: 'pass' });
  assert.deepStrictEqual(guard('set PORT=3005 && npm run dev', { listeners: listen(3000) }), { action: 'pass' });
  // An app registered with its own --port: a bare `npm run dev` binds the script's default, unknown.
  const flagged = { apps: [{ id: 'sol', name: 'sol', cwd: 'I:/Scratch/app/web', command: 'npm run dev -- --port 3007', preferredPort: 3002 }] };
  assert.deepStrictEqual(guard('npm run dev', { cfg: flagged, listeners: listen(3002, 3007) }), { action: 'pass' });
  assert.equal(guard('npm run dev -- --port 3007', { cfg: flagged }).action, 'route');
});

t('case 4: two apps on one preferredPort: the holder is named by sidecar, and counted once', () => {
  const shared = { apps: [
    { id: 'web', name: 'web', cwd: 'I:/Scratch/app/web', command: 'npm run dev', preferredPort: 3000 },
    { id: 'wt', name: 'web-wt', cwd: 'I:/Scratch/app/web-wt', command: 'npm run dev', preferredPort: 3000 },
  ] };
  const held = new Map([[3000, { port: 3000, pid: 4812, processName: 'node.exe' }]]);
  // web is running (its sidecar records the start); starting web-wt must not say web-wt is running.
  const runtime = { apps: { web: { startedBy: claudeStart, port: 3000 } } };
  const r = guard('npm run dev', { cwd: 'I:/Scratch/app/web-wt', cfg: shared, runtime, listeners: held });
  assert.equal(r.action, 'deny');
  assert.match(r.reason, /:3000 is held by web \(/);
  assert.doesNotMatch(r.reason, /web-wt is already running/);
  // Both have sidecar entries: the listener's pid picks the holder.
  const both = { apps: { web: { port: 3000, pid: 1 }, wt: { port: 3000, pid: 4812 } } };
  assert.match(guard('npm run dev', { cfg: shared, runtime: both, listeners: held }).reason, /:3000 is held by web-wt/);
  // Neither recorded: say it is ambiguous rather than guess.
  assert.match(guard('npm run dev', { cfg: shared, listeners: held }).reason, /web, web-wt are all registered on :3000/);
  // The status line counts the port once and names the holder.
  assert.equal(statusLine(shared, runtime, held), '⚓ 1 up · :3000 web✦');
});

t('case 5: a start_app error is reported as a refusal, never as "started"', () => {
  const route = { app: config.apps[1], port: 4000, cd: null };
  // start_app sets isError when the start fails (mcp-server/index.js start_app).
  const failed = routeResult(route, { isError: true, text: '{"success":false,"error":"Port 4000 did not open"}' });
  assert.ok(failed.deny, 'an isError result must deny');
  assert.match(failed.deny, /starting it through start_app failed/);
  assert.match(failed.deny, /Port 4000 did not open/);
  assert.equal(failed.result, undefined);
  // A tool-call deny (permission refused) is still a refusal.
  assert.match(routeResult(route, { deny: 'user said no' }).deny, /was refused \(user said no\)/);
  // Success reads as started, with the tool's text.
  const ok = routeResult(route, { text: '{"success":true}' });
  assert.equal(ok.deny, undefined);
  assert.match(ok.result.stdout, /^PortPilot started api on :4000 through its start_app tool/);
  assert.match(ok.result.stdout, /\{"success":true\}$/);
  assert.doesNotMatch(ok.result.stdout, /working directory/);
  // A routed `cd sub && npm run dev` never ran its cd: say the shell did not move.
  const moved = routeResult({ ...route, cd: '../api' }, { text: '{"success":true}' });
  assert.match(moved.result.stdout, /shell's working directory was not changed/);
});

t('case 6: the guard judges the cwd it is handed, which follows a cd from an earlier Bash call', () => {
  // Not a bug: $.session.cwd() reports the Bash tool's persisted cwd (headless
  // probe, Claude Code 2.1.291: `cd plugin` then a start read .../plugin).
  // After `cd ../api` in one call, a bare start in the next is judged as api.
  assert.equal(guard('npm run dev', { cwd: 'I:/Scratch/app/api', listeners: listen(3000) }).app.id, 'api');
  // A relative cd in the start's own command is resolved from that cwd.
  assert.equal(guard('cd ../docs && npm run dev', { cwd: 'I:/Scratch/app/api' }).app.id, 'docs');
});

// ---- paths ------------------------------------------------------------------

t('normPath / startDir: Git Bash drive form, relative cd, case-folding on windows', () => {
  assert.equal(normPath('/i/Scratch/App/', { windows: true, session: 'sess-1' }), 'i:/scratch/app');
  assert.equal(normPath('I:\\Scratch\\App\\web\\..\\api', { windows: true, session: 'sess-1' }), 'i:/scratch/app/api');
  assert.equal(startDir('I:/Scratch/app', 'web', { windows: true, session: 'sess-1' }), 'i:/scratch/app/web');
  assert.equal(startDir('/home/u', '~/x', { home: '/home/u' }), '/home/u/x');
  assert.equal(startDir('/home/u/app', null), '/home/u/app');
});

// ---- decide -----------------------------------------------------------------

t('decide: deny when the same app already runs on its port', () => {
  const r = guard('npm run dev', { runtime: { apps: { web: { startedBy: claudeStart, port: 3000 } } }, listeners: listen(3000) });
  assert.equal(r.action, 'deny');
  assert.match(r.reason, /web is already running on :3000/);
  assert.match(r.reason, /reuse http:\/\/localhost:3000/);
});

t('decide: deny for an unmanaged holder, naming it', () => {
  const listeners = new Map([[3000, { port: 3000, pid: 4812, processName: 'node.exe' }]]);
  const r = guard('npm run dev -- --port 3000', { cwd: 'I:/tmp/other', cfg: { apps: [] }, listeners });
  assert.equal(r.action, 'deny');
  assert.match(r.reason, /:3000 is held by node\.exe \(PID 4812.*not managed\)/);
  assert.match(r.reason, /ask the user before stopping it/);
});

t('decide: route a registered app on a free port', () => {
  const r = guard('npm run dev', { cwd: 'I:/Scratch/app/api', listeners: listen(3000) });
  assert.equal(r.action, 'route');
  assert.equal(r.app.id, 'api');
  assert.equal(r.port, 4000);
});

t('decide: route when the explicit port equals preferredPort', () => {
  const r = guard('npm run dev -- --port 4000', { cwd: 'I:/Scratch/app/api' });
  assert.equal(r.action, 'route');
});

t('decide: pass when an explicit free port differs from preferredPort', () => {
  const r = guard('npm run dev -- --port 4100', { cwd: 'I:/Scratch/app/api', listeners: listen(4000) });
  assert.deepStrictEqual(r, { action: 'pass' });
});

t('decide: pass when no registered app matches and the port is free', () => {
  const r = guard('npm run dev', { cwd: 'I:/somewhere/else', listeners: listen(3000) });
  assert.deepStrictEqual(r, { action: 'pass' });
});

// ---- observe, don't take over (docs/run-history/DESIGN.md, PR A) -----------
// tdd-guard:allow  (table-driven port of the design's test table)

const UNREG = 'I:/Scratch/shop/apps/web';
const HOME = 'C:/Users/me';
const T0 = Date.parse('2026-10-08T02:00:00Z');
// This session: claude.exe 100 -> bash 200 -> node 300 (the server); the probe
// (powershell 900) is also a child of 100. Another session: claude.exe 500 -> node 600.
const TABLE = 'SELF 900\n1 0 System\n100 1 claude.exe\n900 100 powershell.exe\n200 100 bash.exe\n300 200 node.exe\n310 200 node.exe\n500 1 claude.exe\n600 500 node.exe\n';
const held = (port, pid) => [port, { port, pid, processName: 'node.exe' }];

/**
 * Fake I/O for observe.mjs over an in-memory observing/ folder. `after` is the
 * listener map once the server is up; add_app records its calls.
 */
function obsWorld({ cfg = config, rt = null, after = new Map(), table = TABLE, cwds = {}, addTool = true, addReply = null, pkg = null } = {}) {
  const files = new Map();
  const adds = [];
  let up = false;
  const io = {
    readPending: async (key) => files.get(key) || null,
    writePending: async (key, rec) => { files.set(key, rec); },
    removePending: async (key) => { files.delete(key); },
    listPending: async () => [...files.values()],
    snapshot: async () => ({ config: cfg, runtime: rt, listeners: up ? after : listen() }),
    procTable: async () => parseProcTable(table),
    cwdOf: async (pid) => cwds[pid] || null,
    readJson: async () => pkg,
    tool: async (name) => (name === 'add_app' && addTool ? 'mcp__portpilot__add_app' : null),
    call: async (args) => { adds.push(args); return addReply || { text: JSON.stringify({ success: true, app: { id: 'new1' } }) }; },
  };
  return { io, files, adds, serverUp: () => { up = true; } };
}

/** The Bash hook's pass path as register.tsx composes it: decide, note, the server comes up, complete. */
async function observeRun(command, { cwd = UNREG, cfg = config, runtime = {}, before = listen(), up = true, at = T0 + 5_000, ...w } = {}) {
  const world = obsWorld({ cfg, ...w });
  const start = parseStart(command);
  if (!start) return { decision: null, noted: null, results: [], ...world };
  const dir = startDir(cwd, start.cd, { windows: true, home: HOME });
  const decision = decide({ start, dir, config: cfg, runtime, listeners: before, windows: true, session: 'sess-1' });
  if (decision.action !== 'pass') return { decision, noted: null, results: [], ...world };
  const noted = await noteStart(world.io, { start, sessionCwd: cwd, config: cfg, listeners: before, home: HOME, windows: true, session: 'sess-1', now: T0 });
  if (up) world.serverUp();
  const results = await completeObservations(world.io, { now: at, windows: true, session: 'sess-1' });
  return { decision, noted, results, ...world };
}

t('observe: the first start passes untouched, whatever bash syntax it uses', async () => {
  for (const cmd of ['npm run dev', 'npx vite --base $BASE --port 5174', "npx vite --base '/app/'", 'npm run dev &',
    'npm run dev > dev.log 2>&1 &', 'cd web && pnpm dev', 'npm run dev -- --port 3005 | tee dev.log']) {
    const r = await observeRun(cmd, { up: false });
    assert.deepStrictEqual(r.decision, { action: 'pass' }, cmd);
    assert.ok(r.noted, cmd);
    assert.deepStrictEqual(r.adds, [], cmd);
  }
  assert.equal((await observeRun('npx vite --base $BASE --port 5174', { up: false })).noted.raw, 'npx vite --base $BASE --port 5174');
});

t('observe: a new listener in this session records exactly one app, on the OBSERVED port', async () => {
  // The command says 3005; the server bound 5173. The observation wins.
  const r = await observeRun('npm run dev -- --port 3005', { after: new Map([held(5173, 300)]), pkg: { name: '@acme/shop-web' } });
  assert.deepStrictEqual(r.adds, [{
    tool: 'mcp__portpilot__add_app', name: 'shop-web', command: 'npm run dev -- --port 3005', cwd: UNREG, preferredPort: 5173,
    description: 'Recorded from Claude Code', registeredBy: 'observed', observedSession: 'sess-1',
  }]);
  assert.deepStrictEqual(r.results.map((x) => [x.done, x.port]), [['recorded', 5173]]);
  // Done: a later tick adds nothing.
  assert.deepStrictEqual(await completeObservations(r.io, { now: T0 + 20_000, windows: true, session: 'sess-1' }), []);
  assert.equal(r.adds.length, 1);
});

t('observe: no listener records nothing, and the observation expires', async () => {
  const r = await observeRun('npm run dev', { up: false });
  assert.deepStrictEqual([r.results, r.adds], [[], []]);
  assert.deepStrictEqual((await completeObservations(r.io, { now: T0 + 61_000, windows: true, session: 'sess-1' })).map((x) => x.done), ['expired']);
  r.serverUp();
  assert.deepStrictEqual(await completeObservations(r.io, { now: T0 + 70_000, windows: true, session: 'sess-1' }), []);
  assert.deepStrictEqual(r.adds, []);
});

t('observe: a port that is not this session\'s, or not in this cwd, is never recorded', async () => {
  const other = await observeRun('npm run dev', { after: new Map([held(5173, 600)]) });
  assert.deepStrictEqual([other.results, other.adds], [[], []]);
  // A port listening before the start is not the start's.
  const old = await observeRun('npm run dev', { before: listen(5173), after: new Map([held(5173, 300)]) });
  assert.deepStrictEqual(old.adds, []);
  // Where the platform reports a cwd, it must be the start's.
  const elsewhere = await observeRun('npm run dev', { after: new Map([held(5173, 300)]), cwds: { 300: 'I:/Scratch/other' } });
  assert.deepStrictEqual(elsewhere.adds, []);
  assert.equal((await observeRun('npm run dev', { after: new Map([held(5173, 300)]), cwds: { 300: 'i:\\scratch\\shop\\apps\\web' } })).adds.length, 1);
  // No process table (the probe failed): nothing.
  assert.deepStrictEqual((await observeRun('npm run dev', { after: new Map([held(5173, 300)]), table: '' })).adds, []);
});

t('observe: two new ports, or one port two pendings could own, is uncertain: nothing', async () => {
  const two = await observeRun('npm run dev', { after: new Map([held(5173, 300), held(4100, 310)]) });
  assert.deepStrictEqual([two.results.map((x) => x.done), two.adds], [['ambiguous'], []]);
  // Two cwds started in this session, one new port: which one bound it is a guess.
  const w = obsWorld({ after: new Map([held(5173, 300)]) });
  for (const cwd of [UNREG, 'I:/Scratch/shop/apps/api']) {
    await noteStart(w.io, { start: parseStart('npm run dev'), sessionCwd: cwd, config, listeners: listen(), home: HOME, windows: true, session: 'sess-1', now: T0 });
  }
  w.serverUp();
  const res = await completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' });
  assert.deepStrictEqual([res.map((x) => x.done), w.adds], [['ambiguous', 'ambiguous'], []]);
});

t('observe: two concurrent starts in one cwd make one pending and one app', async () => {
  const w = obsWorld({ after: new Map([held(5173, 300)]) });
  const note = (now, before) => noteStart(w.io, { start: parseStart('npm run dev'), sessionCwd: UNREG, config, listeners: before, home: HOME, windows: true, session: 'sess-1', now });
  const first = await note(T0, listen());
  // The second start sees the first's port already up; it keeps the first's baseline.
  const second = await note(T0 + 1_000, listen(5173));
  assert.deepStrictEqual(second, first);
  assert.equal(w.files.size, 1);
  w.serverUp();
  await Promise.all([completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' }), completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' })]);
  assert.equal(w.adds.length, 1);
});

t('observe: a build, lint or check command is never recorded, even with a port flag', async () => {
  for (const cmd of ['npx next build --port 3005', 'npx vite build', 'npx astro check', 'npx nuxi generate', 'next build', 'npm run build']) {
    const r = await observeRun(cmd, { after: new Map([held(5173, 300)]) });
    assert.deepStrictEqual([r.noted, r.adds], [null, []], cmd);
  }
});

t('observe: an observed app is guarded (busy port: reuse), never routed (free port: pass)', async () => {
  const plain = { apps: [...config.apps, { id: 'obs', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173, registeredBy: 'observed' }] };
  const reuse = await observeRun('npm run dev', { cfg: plain, before: new Map([held(5173, 300)]), runtime: { apps: { obs: { port: 5173, pid: 300 } } } });
  assert.match(reuse.decision.reason, /shop-web is already running on :5173 - reuse http:\/\/localhost:5173/);
  // Free port: the same bare start a managed app would route runs as typed, and is not observed again.
  const free = await observeRun('npm run dev', { cfg: plain, after: new Map([held(5173, 300)]) });
  assert.deepStrictEqual([free.decision, free.noted, free.adds], [{ action: 'pass' }, null, []]);
  // The same app, managed, still routes.
  const managed = { apps: [...config.apps, { id: 'm', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173 }] };
  assert.equal((await observeRun('npm run dev', { cfg: managed })).decision.action, 'route');
});

t('observe: settings.autoRegister false records nothing', async () => {
  const off = { ...config, settings: { autoRegister: false } };
  const r = await observeRun('npm run dev', { cfg: off, after: new Map([held(5173, 300)]) });
  assert.deepStrictEqual([r.noted, r.adds], [null, []]);
  // Turned off while a start was pending: it is dropped, not recorded.
  const w = obsWorld({ cfg: off, after: new Map([held(5173, 300)]) });
  await noteStart(w.io, { start: parseStart('npm run dev'), sessionCwd: UNREG, config, listeners: listen(), home: HOME, windows: true, session: 'sess-1', now: T0 });
  w.serverUp();
  assert.deepStrictEqual((await completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' })).map((x) => x.done), ['off']);
  assert.deepStrictEqual(w.adds, []);
});

t('observe: uncertain or unparseable commands are not observed', async () => {
  for (const cmd of ['npm install && npm run dev', 'PORT=$P npm run dev', 'npm run dev --port 3005', 'npm run dev -- --port 3005 "unbalanced',
    'cd "$(mktemp -d)" && npm run dev', 'set PORT=3005 && npm run dev']) {
    const r = await observeRun(cmd, { after: new Map([held(5173, 300)]) });
    assert.deepStrictEqual([r.noted, r.adds], [null, []], cmd);
  }
});

t('observe: never a UNC path, a root, the home folder or its Desktop, Documents, Downloads', async () => {
  for (const cwd of ['//wsl.localhost/Ubuntu/home/u/app', 'C:/Users/me', 'C:/Users/Me/', 'C:/Users/me/Desktop', 'C:/Users/me/documents', 'C:/Users/me/Downloads', 'D:/']) {
    assert.equal((await observeRun('python -m http.server', { cwd, up: false })).noted, null, cwd);
  }
  assert.equal((await observeRun('cd \\\\server\\share\\app && npm run dev', { up: false })).noted, null);
  assert.equal((await observeRun('cd / && python -m http.server', { up: false })).noted, null);
  assert.ok((await observeRun('python -m http.server', { cwd: 'C:/Users/me/Documents/site', up: false })).noted);
});

t('observe: the saved cwd has an upper-case drive letter, Git Bash form included', async () => {
  assert.equal((await observeRun('npm run dev', { cwd: 'i:/Scratch/shop', up: false })).noted.cwd, 'I:/Scratch/shop');
  assert.equal((await observeRun('npm run dev', { cwd: '/i/Scratch/shop', up: false })).noted.cwd, 'I:/Scratch/shop');
});

t('observe: add_app missing or failing records nothing and does not retry', async () => {
  const none = await observeRun('npm run dev', { after: new Map([held(5173, 300)]), addTool: false });
  assert.deepStrictEqual([none.results.map((x) => x.done), none.adds], [['no-tool'], []]);
  const failed = await observeRun('npm run dev', { after: new Map([held(5173, 300)]), addReply: { isError: true, text: 'exists' } });
  assert.deepStrictEqual(failed.results.map((x) => x.done), ['failed']);
  assert.deepStrictEqual(await completeObservations(failed.io, { now: T0 + 20_000, windows: true, session: 'sess-1' }), []);
});

t('observe: a name clash appends the parent folder, then -2', () => {
  const apps = [{ id: 'a', name: 'Web' }];
  assert.equal(uniqueAppName('web', 'I:/x/apps/web', apps), 'web (apps)');
  assert.equal(uniqueAppName('web', 'I:/x/apps/web', [...apps, { id: 'b', name: 'web (apps)' }]), 'web (apps)-2');
});

t('observe: the process table and this session\'s pid', () => {
  const table = parseProcTable(TABLE.replace(/\n/g, '\r\n'));
  assert.equal(table.self, 900);
  assert.equal(sessionPid(table), 100);
  // POSIX ps: no claude in the chain, the nearest node owns it.
  assert.equal(sessionPid(parseProcTable('SELF 50\n  40 1 /usr/bin/node\n  50 40 sh\n')), 40);
  assert.equal(sessionPid(parseProcTable('')), null);
  assert.equal(isOneShot('PORT=1 npx vite build'), true);
  assert.equal(isOneShot('npx vite --port 3005'), false);
});

// ---- review round 3: attribution ------------------------------------------------

// Windows table with creation times and command lines: pid, ppid, created, name, cmd.
const row = (pid, ppid, created, name, cmd = '') => `${pid}\t${ppid}\t${created}\t${name}\t${cmd}`;
const BASH = (cmd) => `"C:\\Program Files\\Git\\bin\\bash.exe" -c "source snap.sh 2>/dev/null || true && eval '${cmd.replace(/'/g, "'\\''")}' < /dev/null"`;
const wtable = (...rows) => ['SELF 900', row(1, 0, 0, 'System'), row(100, 1, T0 - 600_000, 'claude.exe', 'claude.exe'),
  row(900, 100, T0 + 4_000, 'powershell.exe', 'powershell -Command probe'), ...rows].join('\r\n');

t('round 3: another session\'s pending is never completed here, even with a matching port', async () => {
  const w = obsWorld({ after: new Map([held(5173, 300)]) });
  await noteStart(w.io, { start: parseStart('npm run dev'), sessionCwd: UNREG, config, listeners: listen(), home: HOME, windows: true, session: 'sess-2', now: T0 });
  w.serverUp();
  assert.deepStrictEqual(await completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' }), []);
  assert.deepStrictEqual([w.adds, w.files.size], [[], 1]);
  // Its own session records it.
  assert.deepStrictEqual((await completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-2' })).map((x) => x.done), ['recorded']);
});

t('round 3: Claude\'s own unrelated background server is not taken', async () => {
  const table = wtable(row(200, 100, T0 + 1_000, 'bash.exe', BASH('npm run dev')), row(300, 200, T0 + 1_100, 'node.exe', 'node npm-cli.js run dev'),
    row(210, 100, T0 + 1_500, 'bash.exe', BASH('node tests/test-servers.js')), row(310, 210, T0 + 1_600, 'node.exe', 'node tests/test-servers.js'));
  // Only the unrelated server is up: nothing.
  const r = await observeRun('npm run dev', { table, after: new Map([held(9100, 310)]) });
  assert.deepStrictEqual([r.results, r.adds], [[], []]);
  // Both up: the noted start's port, not the other.
  const both = await observeRun('npm run dev', { table, after: new Map([held(9100, 310), held(5173, 300)]) });
  assert.deepStrictEqual(both.adds.map((a) => a.preferredPort), [5173]);
});

t('round 3: a port held by claude.exe itself, or an MCP server\'s child, is not taken', async () => {
  const self = await observeRun('npm run dev', { table: wtable(), after: new Map([held(5173, 100)]) });
  assert.deepStrictEqual(self.adds, []);
  // MCP stdio server (node, Claude's direct child) -> browser with a debug port.
  const mcp = wtable(row(400, 100, T0 + 1_000, 'node.exe', 'node chrome-devtools-mcp'), row(410, 400, T0 + 1_200, 'chrome.exe', 'chrome --remote-debugging-port=9333'));
  assert.deepStrictEqual((await observeRun('npm run dev', { table: mcp, after: new Map([held(9333, 410)]) })).adds, []);
  // The same under `cmd /c npx` (a shell child of Claude): the command lines do not carry `npm run dev`.
  const viaCmd = wtable(row(400, 100, T0 + 1_000, 'cmd.exe', 'cmd /c npx chrome-devtools-mcp'), row(410, 400, T0 + 1_200, 'chrome.exe', 'chrome --remote-debugging-port=9333'));
  assert.deepStrictEqual((await observeRun('npm run dev', { table: viaCmd, after: new Map([held(9333, 410)]) })).adds, []);
});

t('round 3: a registered app\'s port is not taken', async () => {
  // 4000 is api's preferredPort; 4100 is held by the sidecar's pid of web.
  assert.deepStrictEqual((await observeRun('npm run dev', { after: new Map([held(4000, 300)]) })).adds, []);
  assert.deepStrictEqual((await observeRun('npm run dev', { rt: { apps: { web: { port: 4100, pid: 300 } } }, after: new Map([held(4100, 300)]) })).adds, []);
});

t('round 3: two same-session starts in two dirs resolve by command line', async () => {
  const api = 'I:/Scratch/shop/apps/api';
  const table = wtable(row(200, 100, T0 + 1_000, 'bash.exe', BASH(`cd ${UNREG} && npm run dev`)), row(300, 200, T0 + 1_100, 'node.exe', 'node vite.js'),
    row(210, 100, T0 + 1_500, 'bash.exe', BASH(`cd ${api} && npm run dev`)), row(310, 210, T0 + 1_600, 'node.exe', 'node vite.js'));
  const w = obsWorld({ table, after: new Map([held(5173, 300), held(5174, 310)]) });
  for (const d of [UNREG, api]) {
    const command = `cd ${d} && npm run dev`;
    await noteStart(w.io, { start: parseStart(command), sessionCwd: 'I:/Scratch', config, listeners: listen(), home: HOME, windows: true, session: 'sess-1', now: T0, command });
  }
  w.serverUp();
  const res = await completeObservations(w.io, { now: T0 + 5_000, windows: true, session: 'sess-1' });
  assert.deepStrictEqual(res.map((x) => [x.done, x.port]).sort(), [['recorded', 5173], ['recorded', 5174]]);
  assert.deepStrictEqual(w.adds.map((a) => [a.cwd, a.preferredPort]).sort(), [[api, 5174], [UNREG, 5173]]);
  // Same command in both, no cd to tell them apart: still ambiguous.
  const same = wtable(row(200, 100, T0 + 1_000, 'bash.exe', BASH('npm run dev')), row(300, 200, T0 + 1_100, 'node.exe', ''),
    row(210, 100, T0 + 1_500, 'bash.exe', BASH('npm run dev')), row(310, 210, T0 + 1_600, 'node.exe', ''));
  const w2 = obsWorld({ table: same, after: new Map([held(5173, 300), held(5174, 310)]) });
  for (const d of [UNREG, api]) await noteStart(w2.io, { start: parseStart('npm run dev'), sessionCwd: d, config, listeners: listen(), home: HOME, windows: true, session: 'sess-1', now: T0, command: 'npm run dev' });
  w2.serverUp();
  assert.deepStrictEqual((await completeObservations(w2.io, { now: T0 + 5_000, windows: true, session: 'sess-1' })).map((x) => x.done), ['ambiguous', 'ambiguous']);
});

t('round 3: a reused pid in the chain is rejected by creation time', async () => {
  // The bash pid was reused after the note, but the server predates it: not a parent.
  const reused = wtable(row(200, 100, T0 + 3_000, 'bash.exe', BASH('npm run dev')), row(300, 200, T0 + 1_000, 'node.exe', 'node npm-cli.js run dev'));
  assert.deepStrictEqual((await observeRun('npm run dev', { table: reused, after: new Map([held(5173, 300)]) })).adds, []);
  // A server started before the note is not this start's, whatever its parent.
  const old = wtable(row(200, 100, T0 - 60_000, 'bash.exe', BASH('npm run dev')), row(300, 200, T0 - 59_000, 'node.exe', 'node npm-cli.js run dev'));
  assert.deepStrictEqual((await observeRun('npm run dev', { table: old, after: new Map([held(5173, 300)]) })).adds, []);
  const ok = wtable(row(200, 100, T0 + 1_000, 'bash.exe', BASH('npm run dev')), row(300, 200, T0 + 1_100, 'node.exe', 'node npm-cli.js run dev'));
  assert.equal((await observeRun('npm run dev', { table: ok, after: new Map([held(5173, 300)]) })).adds.length, 1);
});

t('round 3: quoted commands match the eval-wrapped shell command line', async () => {
  const cmd = "npx vite --base '/app/' --port 5174";
  const table = wtable(row(200, 100, T0 + 1_000, 'bash.exe', BASH(cmd)), row(300, 200, T0 + 1_100, 'node.exe', 'node vite.js --base /app/'));
  assert.equal((await observeRun(cmd, { table, after: new Map([held(5174, 300)]) })).adds.length, 1);
});

t('round 3: finished files are deleted, stale ones pruned, reads bounded', async () => {
  const r = await observeRun('npm run dev', { after: new Map([held(5173, 300)]) });
  assert.deepStrictEqual([r.adds.length, r.files.size], [1, 0]);
  const x = await observeRun('npm run dev', { up: false });
  await completeObservations(x.io, { now: T0 + 61_000, windows: true, session: 'sess-1' });
  assert.equal(x.files.size, 0);
  // Another session's pending, past an hour: pruned by whoever ticks.
  const w = obsWorld();
  await noteStart(w.io, { start: parseStart('npm run dev'), sessionCwd: UNREG, config, listeners: listen(), home: HOME, windows: true, session: 'gone', now: T0 });
  await completeObservations(w.io, { now: T0 + 30 * 60_000, windows: true, session: 'sess-1' });
  assert.equal(w.files.size, 1);
  await completeObservations(w.io, { now: T0 + 61 * 60_000, windows: true, session: 'sess-1' });
  assert.equal(w.files.size, 0);
  // The real listing: newest first, at most READ_LIMIT read and pruned, foreign names left alone.
  const entries = [...Array(60)].map((_, i) => ({ name: `dir-${i.toString(16)}.json`, mtimeMs: T0 - i * 1_000 }));
  const picked = pickPendingFiles([...entries, { name: 'dir-ff.json', mtimeMs: T0 - 2 * 3_600_000 }, { name: 'notes.txt', mtimeMs: 0 }], T0);
  assert.deepStrictEqual([picked.read.length, picked.read[0], picked.prune], [READ_LIMIT, 'dir-0.json', ['dir-ff.json']]);
  assert.deepStrictEqual(removeArgv('C:/Users/me/AppData/Roaming/portpilot/observing/dir-1a.json', true),
    ['cmd', '/d', '/c', 'del', '/f', '/q', 'C:\\Users\\me\\AppData\\Roaming\\portpilot\\observing\\dir-1a.json']);
  assert.deepStrictEqual(removeArgv('/home/u/.config/portpilot/observing/dir-1a.json', false), ['rm', '-f', '--', '/home/u/.config/portpilot/observing/dir-1a.json']);
  for (const [f, win] of [['C:/x/observing/config.json', true], ['C:/a&b/observing/dir-1.json', true], ['/x/observing/../config.json', false]]) assert.equal(removeArgv(f, win), null, f);
});

t('round 3: the process table reads POSIX args and Windows tab rows', () => {
  const posix = parseProcTable('SELF 50\n  40 1 claude\n  50 40 sh\n ARGS\n  40 claude --resume\n  50 sh -c echo SELF $$\n');
  assert.deepStrictEqual(posix.procs.get(40), { pid: 40, ppid: 1, name: 'claude', created: 0, cmd: 'claude --resume' });
  const win = parseProcTable(`SELF 9\r\n${row(9, 8, 123, 'powershell.exe', 'powershell -c x')}\r\n${row(8, 1, 100, 'claude.exe', '')}\r\n`);
  assert.deepStrictEqual(win.procs.get(9), { pid: 9, ppid: 8, name: 'powershell.exe', created: 123, cmd: 'powershell -c x' });
  assert.equal(sessionPid(win), 8);
});

// ---- parser corrections kept from the review rounds ---------------------------

t('review: npm dev / serve / preview are not npm commands and start nothing', () => {
  for (const cmd of ['npm dev', 'npm serve -- --port 3005', 'npm preview']) assert.equal(parseStart(cmd), null, cmd);
  assert.ok(parseStart('npm start'));
  assert.ok(parseStart('pnpm dev'));
});

t('review: npm keeps a port flag before `--` for itself, so the port is unknown', () => {
  assert.equal(parseStart('npm run dev --port 3005').certain, false);
  assert.deepStrictEqual(guard('npm run dev --port 3005', { listeners: listen(3005) }), { action: 'pass' });
  assert.equal(parseStart('npm run dev -- --port 3005').port, 3005);
});

t('review: -p is a port only for the tools that take it', () => {
  assert.equal(parseStart('npx vite -p 3005').port, null);
  assert.equal(parseStart('npx next dev -p 3005').port, 3005);
  assert.equal(parseStart('npx http-server -p 8081').port, 8081);
  assert.equal(parseStart('npm run dev -- -p 3005').port, 3005);
});

t('review: parseStart keeps the raw step; the script stays normalised', () => {
  const s = parseStart('cd web && npm run dev -- --port 3005 &');
  assert.equal(s.raw, 'npm run dev -- --port 3005');
  assert.equal(s.script, 'npm dev');
});

for (const [name, fn] of tests) {
  try { await fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
