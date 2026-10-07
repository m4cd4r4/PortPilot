/**
 * Plugin mod pure logic (plugin/hooks/guard-core.mjs).
 * Run: node tests/plugin-mod.test.mjs   (part of npm run test:unit)
 *
 * Covers: listener parsing per platform, the status line (worst state first,
 * the Claude mark), dev-server start detection, and the guard decision
 * (deny / route / pass). The hooks wiring in register.tsx is covered locally by
 * `claude plugin test plugin`; CI has no claude CLI.
 */
import assert from 'node:assert';
import {
  parseListeners, parseTasklistName, appStates, statusLine, parseStart, normPath, startDir, decide, routeResult,
  planAutoRegister, worktreeParent,
} from '../plugin/hooks/guard-core.mjs';

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.message); failed++; }
}

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
  const dir = startDir(cwd, start.cd, { windows: true });
  return decide({ start, dir, config: cfg, runtime, listeners, windows: true });
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
  assert.equal(normPath('/i/Scratch/App/', { windows: true }), 'i:/scratch/app');
  assert.equal(normPath('I:\\Scratch\\App\\web\\..\\api', { windows: true }), 'i:/scratch/app/api');
  assert.equal(startDir('I:/Scratch/app', 'web', { windows: true }), 'i:/scratch/app/web');
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

// ---- auto-register (docs/run-history/DESIGN.md, PR A) -----------------------
// tdd-guard:allow  (table-driven port of the design's test table)

const TOOLS = { add: true, start: true };
const UNREG = 'I:/Scratch/shop/apps/web';

/** The guard then the auto-register plan, composed as register.tsx composes them. */
function autoPlan(command, { cwd = UNREG, listeners = listen(), cfg = config, pkg = null, tools = TOOLS, home = 'C:/Users/me' } = {}) {
  const start = parseStart(command);
  if (!start) return { decision: null, plan: null };
  const dir = startDir(cwd, start.cd, { windows: true, home });
  const decision = decide({ start, dir, config: cfg, runtime: {}, listeners, windows: true });
  const plan = decision.action === 'pass'
    ? planAutoRegister({ start, dir, cwd: startDir(cwd, start.cd, { windows: true, home, keepCase: true }), config: cfg, listeners, pkg, home, tools, windows: true })
    : null;
  return { decision, plan };
}

t('auto-register: an explicit --port in an unregistered dir plans add + route', () => {
  const { plan } = autoPlan('npm run dev -- --port 3005', { pkg: { name: '@acme/shop-web' } });
  assert.deepStrictEqual(plan, { name: 'shop-web', command: 'npm run dev -- --port 3005', cwd: UNREG, port: 3005 });
});

t('auto-register: parseStart keeps the raw step; the command is not the normalised script', () => {
  const s = parseStart('cd web && npm run dev -- --port 3005 &');
  assert.equal(s.raw, 'npm run dev -- --port 3005');
  assert.equal(s.script, 'npm dev');
});

t('auto-register: a leading PORT=N is stripped from the command (start_app sets PORT)', () => {
  const { plan } = autoPlan('PORT=3005 npm run dev');
  assert.equal(plan.command, 'npm run dev');
  assert.equal(plan.port, 3005);
});

t('auto-register: bare python -m http.server is 8000, cwd follows the cd in its own case', () => {
  const { plan } = autoPlan('cd mock && python -m http.server', { cwd: 'I:/Scratch/Shop' });
  assert.deepStrictEqual(plan, { name: 'mock', command: 'python -m http.server', cwd: 'I:/Scratch/Shop/mock', port: 8000 });
  // Anything after it (a positional port past a flag) is not read: pass.
  assert.equal(autoPlan('python -m http.server --bind 0.0.0.0 9000').plan, null);
});

t('auto-register: the port comes from the package.json script the command names', () => {
  assert.equal(autoPlan('npm run dev', { pkg: { scripts: { dev: 'vite --port 5174' } } }).plan.port, 5174);
  assert.equal(autoPlan('pnpm start', { pkg: { scripts: { start: 'next start -p 3100' } } }).plan.port, 3100);
});

t('auto-register: a framework default port is not certain: pass, no plan', () => {
  for (const dev of ['next dev', 'vite', 'astro dev']) {
    assert.equal(autoPlan('npm run dev', { pkg: { scripts: { dev } } }).plan, null, dev);
  }
  assert.equal(autoPlan('npm run dev').plan, null, 'no package.json');
  // Two ports, or a port from a variable, in the script: unknown.
  assert.equal(autoPlan('npm run dev', { pkg: { scripts: { dev: 'concurrently "vite --port 5174" "node api.js --port 4000"' } } }).plan, null);
  assert.equal(autoPlan('npm run dev', { pkg: { scripts: { dev: 'vite --port $PORT' } } }).plan, null);
});

t('auto-register: uncertain commands pass with no plan', () => {
  for (const cmd of ['npm install && npm run dev --port 3005', 'npm run dev --port $P', 'PORT=$P npm run dev',
    'cd "$(mktemp -d)" && npm run dev -- --port 3005', 'npm run dev -- --port 3005 "unbalanced']) {
    const { decision, plan } = autoPlan(cmd);
    assert.ok(!decision || decision.action === 'pass', cmd);
    assert.equal(plan, null, cmd);
  }
});

t('auto-register: a start that is not bare (pipe, redirect, env, later step) passes', () => {
  for (const cmd of ['npm run dev -- --port 3005 | tee dev.log', 'npm run dev -- --port 3005 > dev.log',
    'FOO=1 npm run dev -- --port 3005', 'npm run dev -- --port 3005; echo done']) {
    assert.deepStrictEqual(autoPlan(cmd), { decision: { action: 'pass' }, plan: null }, cmd);
  }
});

t('auto-register: a listening port is never a registration; decide keeps its deny', () => {
  const { decision, plan } = autoPlan('npm run dev -- --port 3005', { listeners: listen(3005) });
  assert.equal(decision.action, 'deny');
  assert.equal(plan, null);
  // A port only the script knows, busy: decide passes (it cannot see it), the plan refuses.
  assert.deepStrictEqual(autoPlan('npm run dev', { pkg: { scripts: { dev: 'vite --port 5174' } }, listeners: listen(5174) }),
    { decision: { action: 'pass' }, plan: null });
});

t('auto-register: never in the home dir, a drive root or /', () => {
  assert.equal(autoPlan('python -m http.server', { cwd: 'C:/Users/me' }).plan, null);
  assert.equal(autoPlan('python -m http.server', { cwd: 'C:/Users/Me/' }).plan, null);
  assert.equal(autoPlan('python -m http.server', { cwd: 'D:/' }).plan, null);
  assert.equal(autoPlan('cd / && python -m http.server').plan, null);
});

t('auto-register: settings.autoRegister false opts out', () => {
  const cfg = { ...config, settings: { autoRegister: false } };
  assert.equal(autoPlan('npm run dev -- --port 3005', { cfg }).plan, null);
  assert.ok(autoPlan('npm run dev -- --port 3005', { cfg: { ...config, settings: {} } }).plan);
});

t('auto-register: a registered dir keeps its existing route or pass', () => {
  assert.deepStrictEqual(autoPlan('npm run dev -- --port 4100', { cwd: 'I:/Scratch/app/api' }), { decision: { action: 'pass' }, plan: null });
  assert.equal(autoPlan('npm run dev', { cwd: 'I:/Scratch/app/api' }).decision.action, 'route');
});

t('auto-register: add_app or start_app not connected: pass', () => {
  assert.equal(autoPlan('npm run dev -- --port 3005', { tools: { add: false, start: true } }).plan, null);
  assert.equal(autoPlan('npm run dev -- --port 3005', { tools: { add: true, start: false } }).plan, null);
});

t('auto-register: a name clash appends the parent folder, then -2', () => {
  const cfg = { apps: [...config.apps, { id: 'w2', name: 'Web', cwd: 'I:/elsewhere/web' }] };
  assert.equal(autoPlan('npm run dev -- --port 3005', { cfg, pkg: { name: 'web' } }).plan.name, 'web (apps)');
  const taken = { apps: [...cfg.apps, { id: 'w3', name: 'web (apps)', cwd: 'I:/x/apps/web' }] };
  assert.equal(autoPlan('npm run dev -- --port 3005', { cfg: taken, pkg: { name: 'web' } }).plan.name, 'web (apps)-2');
});

t('auto-register: a linked worktree nests under the registered main checkout', () => {
  const cfg = { apps: [{ id: 'shop', name: 'shop', cwd: 'I:/Scratch/shop' }] };
  const dir = 'i:/scratch/shop-checkout';
  assert.equal(worktreeParent({ dir, gitDir: 'I:/Scratch/shop/.git/worktrees/shop-checkout', commonDir: 'I:/Scratch/shop/.git', config: cfg, windows: true }).id, 'shop');
  // The main checkout itself (git dir = common dir), outside a repo, or an unregistered repo: no parent.
  assert.equal(worktreeParent({ dir: 'i:/scratch/shop/apps/web', gitDir: 'I:/Scratch/shop/.git', commonDir: 'I:/Scratch/shop/.git', config: cfg, windows: true }), null);
  assert.equal(worktreeParent({ dir, gitDir: null, commonDir: null, config: cfg, windows: true }), null);
  assert.equal(worktreeParent({ dir, gitDir: 'I:/Other/.git/worktrees/x', commonDir: 'I:/Other/.git', config: cfg, windows: true }), null);
});

t('auto-register: the route note says the app was registered', () => {
  const ok = routeResult({ app: { id: 'n1', name: 'shop-web' }, port: 3005, cd: null, registered: true }, { text: '{"success":true}' });
  assert.match(ok.result.stdout, /PortPilot started shop-web on :3005/);
  assert.match(ok.result.stdout, /registered it as "shop-web" first/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
