/**
 * The Diagnose runner with a fake child process: events stream through,
 * the prompt goes in on stdin, cancel and timeout kill, a second start is
 * refused, and a missing CLI or folder is a clear error. No CLI is spawned.
 *
 * Run: node tests/diagnose-runner.test.cjs
 */
const assert = require('assert');
const { EventEmitter } = require('events');
const { createRunner, findClaude } = require('../src/main/diagnoseRunner');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); fail++; }
}

function fakeChild() {
  const c = new EventEmitter();
  c.pid = 4242;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdinData = '';
  c.stdin = { end: (s) => { c.stdinData = s; } };
  return c;
}

function setup(over = {}) {
  const child = fakeChild();
  const calls = { spawn: [], kill: 0, events: [], timers: [] };
  const runner = createRunner({
    spawn: (exe, args, opts) => { calls.spawn.push({ exe, args, opts }); return child; },
    find: () => 'C:/bin/claude.exe',
    send: (ev) => calls.events.push(ev),
    kill: () => { calls.kill++; },
    cwdExists: () => true,
    setTimer: (fn, ms) => { calls.timers.push({ fn, ms }); return { unref() {} }; },
    clearTimer: () => {},
    platform: 'linux',
    ...over,
  });
  return { child, calls, runner };
}

const ctx = { appId: 'a1', name: 'web', command: 'npm run dev', cwd: 'C:/x', port: 3000, exitCode: 1, tail: 'boom' };
const line = (o) => Buffer.from(JSON.stringify(o) + '\n');

(async () => {
  await t('streams text and tool events, ends with done then end', async () => {
    const { child, calls, runner } = setup();
    assert.deepStrictEqual(runner.start(ctx), { success: true });
    child.stdout.emit('data', line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.js' } }] } }));
    child.stdout.emit('data', line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Cause: x' }] } }));
    child.stdout.emit('data', line({ type: 'result', subtype: 'success', total_cost_usd: 0.1 }));
    child.emit('close', 0);
    assert.deepStrictEqual(calls.events.map((e) => e.kind), ['start', 'tool', 'text', 'done', 'end']);
    assert.ok(calls.events.every((e) => e.appId === 'a1'));
    assert.strictEqual(runner.isRunning('a1'), false);
  });

  await t('handles a line split across chunks', async () => {
    const { child, calls, runner } = setup();
    runner.start(ctx);
    const full = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }) + '\n';
    child.stdout.emit('data', Buffer.from(full.slice(0, 20)));
    child.stdout.emit('data', Buffer.from(full.slice(20)));
    assert.deepStrictEqual(calls.events.filter((e) => e.kind === 'text').map((e) => e.text), ['hello']);
  });

  await t('the prompt goes on stdin and the args are the read-only set', async () => {
    const { child, calls, runner } = setup();
    runner.start({ ...ctx, tail: 'API_KEY=supersecretvalue1' });
    assert.ok(child.stdinData.includes('web'));
    assert.ok(!child.stdinData.includes('supersecretvalue1'));
    const { args, opts } = calls.spawn[0];
    assert.ok(args.includes('--allowedTools') && !args.some((a) => a.includes('web')));
    assert.strictEqual(opts.cwd, 'C:/x');
  });

  await t('a second start for the same app is refused', async () => {
    const { runner } = setup();
    runner.start(ctx);
    const again = runner.start(ctx);
    assert.strictEqual(again.success, false);
    assert.match(again.error, /already running/);
  });

  await t('no CLI gives NO_CLI and spawns nothing', async () => {
    const { calls, runner } = setup({ find: () => null });
    const r = runner.start(ctx);
    assert.strictEqual(r.code, 'NO_CLI');
    assert.strictEqual(calls.spawn.length, 0);
  });

  await t('a missing app folder is a clear error', async () => {
    const { calls, runner } = setup({ cwdExists: () => false });
    const r = runner.start(ctx);
    assert.strictEqual(r.success, false);
    assert.match(r.error, /folder/);
    assert.strictEqual(calls.spawn.length, 0);
  });

  await t('cancel kills the child and reports Cancelled', async () => {
    const { child, calls, runner } = setup();
    runner.start(ctx);
    assert.strictEqual(runner.cancel('a1'), true);
    assert.strictEqual(calls.kill, 1);
    child.emit('close', 1);
    const err = calls.events.find((e) => e.kind === 'error');
    assert.strictEqual(err.text, 'Cancelled.');
    assert.strictEqual(runner.cancel('a1'), false);
  });

  await t('the timeout kills the child and says so', async () => {
    const { child, calls, runner } = setup();
    runner.start(ctx);
    calls.timers[0].fn();
    assert.strictEqual(calls.kill, 1);
    child.emit('close', 1);
    assert.match(calls.events.find((e) => e.kind === 'error').text, /3 minutes/);
  });

  await t('a failed run with auth stderr reads as not signed in', async () => {
    const { child, calls, runner } = setup();
    runner.start(ctx);
    child.stderr.emit('data', Buffer.from('Error: Not logged in'));
    child.emit('close', 1);
    assert.match(calls.events.find((e) => e.kind === 'error').text, /not signed in/i);
  });

  await t('a spawn error becomes an error event, once', async () => {
    const { child, calls, runner } = setup();
    runner.start(ctx);
    child.emit('error', new Error('ENOENT'));
    child.emit('close', null);
    assert.strictEqual(calls.events.filter((e) => e.kind === 'error').length, 1);
  });

  await t('findClaude searches PATH for the platform names', async () => {
    const win = findClaude({ platform: 'win32', env: { PATH: 'C:\\a;C:\\b' }, exists: (p) => p.endsWith('claude.cmd') && p.includes('b') });
    assert.ok(win && /claude\.cmd$/.test(win));
    assert.strictEqual(findClaude({ platform: 'linux', env: { PATH: '/x:/y' }, exists: () => false }), null);
    assert.ok(findClaude({ platform: 'linux', env: { PATH: '/x:/y' }, exists: (p) => /[\\/]y[\\/]/.test(p) }).includes('claude'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
