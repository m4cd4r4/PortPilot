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
import { checkNotices, cmdSafe, EMPTY, isOneShot, noteStart, NOTICE_MS, takeQueued, uniqueAppName } from '../plugin/hooks/observe.mjs';

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
  assert.deepStrictEqual([m.get(3000).address, m.get(5173).address], ['0.0.0.0', '[::]']);
});

t('darwin lsof: port, pid and command name', () => {
  const out = [
    'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'node    71234 mac   23u  IPv6 0xabc      0t0  TCP *:3000 (LISTEN)',
    'Python  555   mac   4u   IPv4 0xdef      0t0  TCP 127.0.0.1:8000 (LISTEN)',
  ].join('\n');
  const m = parseListeners('darwin', out);
  assert.deepStrictEqual(m.get(3000), { port: 3000, pid: 71234, processName: 'node', address: '*' });
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
  assert.deepStrictEqual(m.get(3000), { port: 3000, pid: 2211, processName: 'node', address: '0.0.0.0' });
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

// ---- observe, don't take over: Claude confirms (docs/run-history/DESIGN.md, PR A) ----
// tdd-guard:allow  (table-driven port of the design's test table)

const UNREG = 'I:/Scratch/shop/apps/web';
const HOME = 'C:/Users/me';
const T0 = Date.parse('2026-10-08T02:00:00Z');
const held = (port, pid = 300) => [port, { port, pid, processName: 'node.exe' }];
const ports = (...list) => new Map(list.map((p) => held(p)));

/**
 * The wiring register.tsx runs: decide, note the start (Bash hook, before the
 * call), then a check per later tool result or status tick.
 */
function obsRun(command, { cwd = UNREG, cfg = config, runtime = {}, before = listen(), pkg = null } = {}) {
  const start = parseStart(command);
  let state = EMPTY;
  if (!start) return { decision: null, state, check: () => [] };
  const dir = startDir(cwd, start.cd, { windows: true, home: HOME });
  const decision = decide({ start, dir, config: cfg, runtime, listeners: before, windows: true });
  if (decision.action === 'pass') state = noteStart(state, { start, sessionCwd: cwd, config: cfg, listeners: before, home: HOME, windows: true, now: T0, pkg });
  const check = (listeners, at = T0 + 5_000, rt = runtime) => {
    const r = checkNotices(state, { config: cfg, runtime: rt, listeners }, at);
    state = r.state;
    return r.notices;
  };
  return { decision, get state() { return state; }, check };
}

t('observe: the first start passes untouched, whatever bash syntax it uses', () => {
  for (const cmd of ['npm run dev', 'npx vite --base $BASE --port 5174', "npx vite --base '/app/'", 'npm run dev &',
    'npm run dev > dev.log 2>&1 &', 'cd web && pnpm dev', 'npm run dev -- --port 3005 | tee dev.log']) {
    const r = obsRun(cmd);
    assert.deepStrictEqual(r.decision, { action: 'pass' }, cmd);
    assert.equal(r.state.notes.length, 1, cmd);
  }
  assert.equal(obsRun('npx vite --base $BASE --port 5174').state.notes[0].command, 'npx vite --base $BASE --port 5174');
});

t('observe: the notice names the port, the directory and the command, and how to register', () => {
  const r = obsRun('npm run dev -- --port 3005', { pkg: { name: '@acme/shop-web' } });
  const [n] = r.check(ports(5173));
  assert.match(n, /^PortPilot: :5173 started listening after `npm run dev -- --port 3005` in web\./);
  assert.match(n, /add_app/);
  assert.ok(n.includes(`cwd "${UNREG}"`) && n.includes('name "shop-web"') && n.includes('preferredPort 5173') && n.includes('registeredBy "observed"'), n);
});

t('observe: one notice per port per session', () => {
  const r = obsRun('npm run dev');
  assert.equal(r.check(ports(5173)).length, 1);
  assert.deepStrictEqual(r.check(ports(5173), T0 + 20_000), []);
  // Gone and back: still told once.
  r.check(listen(), T0 + 30_000);
  assert.deepStrictEqual(r.check(ports(5173), T0 + 40_000), []);
  // A second new port is its own notice.
  assert.equal(r.check(ports(5173, 5174), T0 + 50_000).length, 1);
});

t('observe: no notice without a recent unregistered start in this session', () => {
  // Nothing noted: a new port says nothing.
  assert.deepStrictEqual(checkNotices(EMPTY, { config, runtime: null, listeners: ports(5173) }, T0).notices, []);
  // A note past two minutes has expired.
  const r = obsRun('npm run dev');
  assert.deepStrictEqual(r.check(ports(5173), T0 + NOTICE_MS + 1), []);
  assert.deepStrictEqual(r.state.notes, []);
  // A port already listening at the start is not new.
  assert.deepStrictEqual(obsRun('npm run dev', { before: listen(5173) }).check(ports(5173)), []);
});

t('observe: no notice for a port a running registered app holds', () => {
  // 4100 is web's by the sidecar's pid; 4000 is api's by its sidecar start.
  assert.deepStrictEqual(obsRun('npm run dev').check(ports(4100), T0 + 5_000, { apps: { web: { port: 4100, pid: 300 } } }), []);
  assert.deepStrictEqual(obsRun('npm run dev').check(new Map([held(4000, 77)]), T0 + 5_000, { apps: { api: { pid: 999 } } }), []);
});

t('review 5 (M4): an app that merely has the port as preferredPort does not suppress the notice', () => {
  // 4000 is api's preferredPort, but api has no sidecar entry: it is not running.
  const [n] = obsRun('npm run dev').check(ports(4000));
  assert.match(n, /^PortPilot: :4000 started listening after `npm run dev` in web\./);
});

t('review 5 (H1): an unrelated port in the window is named by its PID and process, apart from Claude\'s', () => {
  const r = obsRun('npm run dev');
  const listeners = new Map([
    [4799, { port: 4799, pid: 300, processName: 'node.exe', address: '0.0.0.0' }],
    [4800, { port: 4800, pid: 812, processName: 'python.exe', address: '127.0.0.1' }],
  ]);
  const notices = r.check(listeners);
  assert.equal(notices.length, 1);
  const [n] = notices;
  assert.ok(n.includes('- :4799: node.exe, PID 300, bound to 0.0.0.0'), n);
  assert.ok(n.includes('- :4800: python.exe, PID 812, bound to 127.0.0.1'), n);
  assert.match(n, /Register only a port you are confident your own start opened\. A port held by a process you did not start is not yours: ignore it\./);
  assert.match(n, /preferredPort set to the one port your start opened \(:4799 or :4800\)/);
});

t('review 5 (M2): ports of one process are one line, the lowest non-ephemeral suggested', () => {
  const r = obsRun('npm run dev');
  const one = (port) => [port, { port, pid: 300, processName: 'node.exe', address: '[::1]' }];
  const notices = r.check(new Map([one(60123), one(24678), one(5173)]));
  assert.equal(notices.length, 1);
  assert.ok(notices[0].includes('- :5173: node.exe, PID 300, bound to [::1] (also :24678, :60123: extra listeners of the same process'), notices[0]);
  assert.match(notices[0], /preferredPort 5173, registeredBy "observed"/);
  // A process with only ephemeral ports still gets one suggested.
  assert.match(obsRun('npm run dev').check(new Map([one(60123), one(50001)]))[0], /preferredPort 50001,/);
});

t('review 5 (M3): the notice suggests a cmd-safe command, with leading assignments as env', () => {
  const [n] = obsRun('PORT=4000 NODE_ENV=development npm run dev > /tmp/dev.log 2>&1 &').check(ports(4000));
  assert.ok(n.includes('command "npm run dev", env {"PORT":"4000","NODE_ENV":"development"}'), n);
  assert.ok(n.startsWith('PortPilot: :4000 started listening after `PORT=4000 NODE_ENV=development npm run dev > /tmp/dev.log 2>&1`'), n);
  assert.deepStrictEqual(cmdSafe('npm run dev -- --port 3005 >> dev.log 2>&1'), { command: 'npm run dev -- --port 3005', env: {} });
  assert.deepStrictEqual(cmdSafe('npx vite --port 3005 &> out.log'), { command: 'npx vite --port 3005', env: {} });
  assert.deepStrictEqual(cmdSafe('npm run dev -- --port 3000>x.log'), { command: 'npm run dev -- --port 3000', env: {} });
});

t('review 5 (H1): a deny for an observed app names the holder and how to fix a wrong registration', () => {
  const obs = { apps: [...config.apps, { id: 'obs', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173, registeredBy: 'observed' }] };
  const r = obsRun('npm run dev', { cfg: obs, before: new Map([[5173, { port: 5173, pid: 812, processName: 'python.exe' }]]) });
  assert.match(r.decision.reason, /If python\.exe \(PID 812\) is not this project's server, that registration is wrong: fix its preferredPort with update_app/);
  // A managed app's deny is master's, word for word.
  const managed = { apps: [...config.apps, { id: 'm', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173 }] };
  assert.doesNotMatch(obsRun('npm run dev', { cfg: managed, before: ports(5173) }).decision.reason, /observed/);
});

t('review 5 (L7): opting out clears queued notices, and takeQueued hands none over', () => {
  const offCfg = { ...config, settings: { autoRegister: false } };
  const queued = { ...EMPTY, queue: [{ text: 'PortPilot: :5173 ...', at: T0 }] };
  assert.deepStrictEqual(takeQueued(queued, offCfg, T0 + 1_000), { state: { ...queued, queue: [] }, notices: [] });
  assert.deepStrictEqual(checkNotices(queued, { config: offCfg, runtime: null, listeners: ports(5173) }, T0).state.queue, []);
  assert.deepStrictEqual(takeQueued(queued, config, T0 + 1_000).notices, ['PortPilot: :5173 ...']);
});

t('review 5 (L8): a queued notice older than NOTICE_MS is dropped', () => {
  const queued = { ...EMPTY, queue: [{ text: 'old', at: T0 }, { text: 'new', at: T0 + NOTICE_MS }] };
  const r = takeQueued(queued, config, T0 + NOTICE_MS + 1);
  assert.deepStrictEqual([r.notices, r.state.queue], [['new'], []]);
});

t('observe: a build, lint, uncertain or unparseable command is never noted', () => {
  for (const cmd of ['npx next build --port 3005', 'npx vite build', 'npx astro check', 'npx nuxi generate', 'next build', 'npm run build',
    'npm install && npm run dev', 'PORT=$P npm run dev', 'npm run dev --port 3005', 'npm run dev -- --port 3005 "unbalanced',
    'cd "$(mktemp -d)" && npm run dev', 'set PORT=3005 && npm run dev']) {
    const r = obsRun(cmd);
    assert.deepStrictEqual([r.state.notes, r.check(ports(5173))], [[], []], cmd);
  }
});

t('observe: an observed app is guarded (busy port: reuse), never routed (free port: pass, not noted)', () => {
  const plain = { apps: [...config.apps, { id: 'obs', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173, registeredBy: 'observed' }] };
  const reuse = obsRun('npm run dev', { cfg: plain, before: ports(5173), runtime: { apps: { obs: { port: 5173, pid: 300 } } } });
  assert.match(reuse.decision.reason, /shop-web is already running on :5173 - reuse http:\/\/localhost:5173/);
  const free = obsRun('npm run dev', { cfg: plain });
  assert.deepStrictEqual([free.decision, free.state.notes], [{ action: 'pass' }, []]);
  const managed = { apps: [...config.apps, { id: 'm', name: 'shop-web', cwd: UNREG, command: 'npm run dev', preferredPort: 5173 }] };
  assert.equal(obsRun('npm run dev', { cfg: managed }).decision.action, 'route');
});

t('observe: settings.autoRegister false means no note and no notice', () => {
  const off = { ...config, settings: { autoRegister: false } };
  const r = obsRun('npm run dev', { cfg: off });
  assert.deepStrictEqual([r.state.notes, r.check(ports(5173))], [[], []]);
  // Turned off after the note: the note is dropped, nothing said.
  const on = obsRun('npm run dev');
  assert.deepStrictEqual(checkNotices(on.state, { config: off, runtime: null, listeners: ports(5173) }, T0 + 5_000), { state: { ...on.state, notes: [] }, notices: [] });
});

t('observe: never a UNC path, a root, the home folder or its Desktop, Documents, Downloads', () => {
  for (const cwd of ['//wsl.localhost/Ubuntu/home/u/app', 'C:/Users/me', 'C:/Users/Me/', 'C:/Users/me/Desktop', 'C:/Users/me/documents', 'C:/Users/me/Downloads', 'D:/']) {
    assert.deepStrictEqual(obsRun('python -m http.server', { cwd }).state.notes, [], cwd);
  }
  assert.deepStrictEqual(obsRun('cd \\\\server\\share\\app && npm run dev').state.notes, []);
  assert.deepStrictEqual(obsRun('cd / && python -m http.server').state.notes, []);
  assert.equal(obsRun('python -m http.server', { cwd: 'C:/Users/me/Documents/site' }).state.notes.length, 1);
});

t('observe: the noted cwd has an upper-case drive letter, Git Bash form included', () => {
  assert.equal(obsRun('npm run dev', { cwd: 'i:/Scratch/shop' }).state.notes[0].cwd, 'I:/Scratch/shop');
  assert.equal(obsRun('npm run dev', { cwd: '/i/Scratch/shop' }).state.notes[0].cwd, 'I:/Scratch/shop');
});

t('observe: two recent starts are both named; a restart in one dir replaces its note', () => {
  let s = EMPTY;
  const note = (cwd, now) => { s = noteStart(s, { start: parseStart('npm run dev'), sessionCwd: cwd, config, listeners: listen(), home: HOME, windows: true, now }); };
  note(UNREG, T0); note('I:/Scratch/shop/apps/api', T0 + 1_000); note(UNREG, T0 + 2_000);
  assert.deepStrictEqual(s.notes.map((n) => n.cwd), ['I:/Scratch/shop/apps/api', UNREG]);
  const [n] = checkNotices(s, { config, runtime: null, listeners: ports(5173) }, T0 + 5_000).notices;
  assert.match(n, /in api, or `npm run dev` in web/);
});

t('observe: a suggested name avoids a clash: parent folder, then -2', () => {
  const apps = [{ id: 'a', name: 'Web' }];
  assert.equal(uniqueAppName('web', 'I:/x/apps/web', apps), 'web (apps)');
  assert.equal(uniqueAppName('web', 'I:/x/apps/web', [...apps, { id: 'b', name: 'web (apps)' }]), 'web (apps)-2');
  assert.equal(isOneShot('PORT=1 npx vite build'), true);
  assert.equal(isOneShot('npx vite --port 3005'), false);
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
