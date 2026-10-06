/**
 * Plugin mod pure logic (plugin/hooks/guard-core.mjs).
 * Run: node tests/plugin-mod.test.mjs   (part of npm run test:unit)
 *
 * Covers: listener parsing per platform, the status line (worst state first,
 * the Claude mark), dev-server start detection, and the guard decision
 * (deny / route / pass). The hooks wiring in register.ts is covered locally by
 * `claude plugin test plugin`; CI has no claude CLI.
 */
import assert from 'node:assert';
import {
  parseListeners, parseTasklistName, appStates, statusLine, parseStart, normPath, startDir, decide,
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
    { id: 'web', name: 'web', cwd: 'I:/Scratch/app/web', preferredPort: 3000 },
    { id: 'api', name: 'api', cwd: 'I:/Scratch/app/api', preferredPort: 4000 },
    { id: 'docs', name: 'docs', cwd: 'I:/Scratch/app/docs', preferredPort: 5000 },
    { id: 'idle', name: 'idle', cwd: 'I:/Scratch/app/idle', preferredPort: 6000 },
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

t('statusLine: undefined when no apps are registered', () => {
  assert.equal(statusLine({ apps: [] }, {}, listen(3000)), undefined);
  assert.equal(statusLine(null, {}, listen()), undefined);
});

t('appStates: sidecar port wins over preferredPort', () => {
  const rows = appStates(config, { apps: { web: { port: 3001 } } }, listen(3001));
  assert.deepStrictEqual(rows.map((r) => [r.id, r.port, r.state]), [['web', 3001, 'running']]);
});

// ---- parseStart -------------------------------------------------------------

t('parseStart: cd chain then npm run dev', () => {
  assert.deepStrictEqual(parseStart('cd web && npm run dev'), { cd: 'web', port: null });
  assert.deepStrictEqual(parseStart('cd "I:/Scratch/my app" && pnpm dev'), { cd: 'I:/Scratch/my app', port: null });
});

t('parseStart: PORT= env prefix', () => {
  assert.deepStrictEqual(parseStart('PORT=3001 npm run dev'), { cd: null, port: 3001 });
});

t('parseStart: --port and -p flags', () => {
  assert.deepStrictEqual(parseStart('npx vite --port 5174'), { cd: null, port: 5174 });
  assert.deepStrictEqual(parseStart('npm run dev -- --port=3002 &'), { cd: null, port: 3002 });
  assert.deepStrictEqual(parseStart('npx next dev -p 3005'), { cd: null, port: 3005 });
  assert.deepStrictEqual(parseStart('python -m http.server 8080'), { cd: null, port: 8080 });
});

t('parseStart: non-server commands return null', () => {
  assert.equal(parseStart('npm run build'), null);
  assert.equal(parseStart('npm test'), null);
  assert.equal(parseStart('cd web && git status'), null);
  assert.equal(parseStart(''), null);
});

t('parseStart: a non-cd step before the start drops the cd', () => {
  assert.deepStrictEqual(parseStart('cd web && npm install && npm run dev'), { cd: null, port: null });
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

const dirOf = (cwd) => normPath(cwd, { windows: true });

t('decide: deny when the same app already runs on its port', () => {
  const r = decide({
    start: { cd: null, port: null }, dir: dirOf('I:/Scratch/app/web'), config,
    runtime: { apps: { web: { startedBy: claudeStart, port: 3000 } } }, listeners: listen(3000), windows: true,
  });
  assert.equal(r.action, 'deny');
  assert.match(r.reason, /web is already running on :3000/);
  assert.match(r.reason, /reuse http:\/\/localhost:3000/);
});

t('decide: deny for an unmanaged holder, naming it', () => {
  const listeners = new Map([[3000, { port: 3000, pid: 4812, processName: 'node.exe' }]]);
  const r = decide({ start: { cd: null, port: 3000 }, dir: '/tmp/other', config: { apps: [] }, runtime: {}, listeners });
  assert.equal(r.action, 'deny');
  assert.match(r.reason, /:3000 is held by node\.exe \(PID 4812.*not managed\)/);
  assert.match(r.reason, /ask the user before stopping it/);
});

t('decide: route a registered app on a free port', () => {
  const r = decide({ start: { cd: null, port: null }, dir: dirOf('I:/Scratch/app/api'), config, runtime: {}, listeners: listen(3000), windows: true });
  assert.equal(r.action, 'route');
  assert.equal(r.app.id, 'api');
  assert.equal(r.port, 4000);
});

t('decide: route when the explicit port equals preferredPort', () => {
  const r = decide({ start: { cd: null, port: 4000 }, dir: dirOf('I:/Scratch/app/api'), config, runtime: {}, listeners: listen(), windows: true });
  assert.equal(r.action, 'route');
});

t('decide: pass when an explicit free port differs from preferredPort', () => {
  const r = decide({ start: { cd: null, port: 4100 }, dir: dirOf('I:/Scratch/app/api'), config, runtime: {}, listeners: listen(4000), windows: true });
  assert.deepStrictEqual(r, { action: 'pass' });
});

t('decide: pass when no registered app matches and the port is free', () => {
  const r = decide({ start: { cd: null, port: null }, dir: '/somewhere/else', config, runtime: {}, listeners: listen(3000) });
  assert.deepStrictEqual(r, { action: 'pass' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
