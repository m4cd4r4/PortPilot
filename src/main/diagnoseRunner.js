/**
 * Runs one headless `claude -p` diagnosis per app and streams its events to a
 * callback. The CLI is the user's own install and login: PortPilot never sees
 * a credential. Spawn, lookup and timers are injectable so
 * tests/diagnose-runner.test.cjs drives it with a fake child.
 */
const fs = require('fs');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const diagnose = require('../core/diagnose');

/** The claude executable on PATH (an .exe, or an npm .cmd shim on Windows), or null. */
function findClaude({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try { if (exists(full)) return full; } catch { /* next */ }
    }
  }
  return null;
}

/** Kills a child and, on Windows, everything it started (a .cmd shim leaves a node child). */
function killTree(child, platform = process.platform, spawn = nodeSpawn) {
  try {
    if (platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

function createRunner({
  spawn = nodeSpawn, find = findClaude, send = () => {}, kill = killTree,
  setTimer = setTimeout, clearTimer = clearTimeout, cwdExists = fs.existsSync,
  timeoutMs = diagnose.RUN_TIMEOUT_MS, platform = process.platform,
} = {}) {
  const runs = new Map();   // appId -> { child, timer, cancelled, timedOut }

  function start(ctx) {
    const { appId, name, command, cwd, port, exitCode, tail } = ctx || {};
    if (!appId) return { success: false, error: 'Unknown app' };
    if (runs.has(appId)) return { success: false, error: 'A diagnosis is already running for this app' };
    const exe = find();
    if (!exe) {
      return { success: false, code: 'NO_CLI', error: 'Claude Code is not installed. Install it from https://claude.com/claude-code, sign in once, and try again.' };
    }
    if (!cwd || !cwdExists(cwd)) return { success: false, error: 'The app folder no longer exists, so there is nothing to read.' };

    const prompt = diagnose.buildPrompt({ name, command, cwd, port, exitCode, tail });
    const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
    let child;
    try {
      const opts = { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
      // A .cmd shim needs a shell. The args are fixed tokens (the prompt is on stdin), so one quoted line is safe.
      child = shell
        ? spawn(`"${exe}" ${diagnose.claudeArgs().join(' ')}`, [], { ...opts, shell: true })
        : spawn(exe, diagnose.claudeArgs(), opts);
    } catch (err) {
      return { success: false, error: `Could not start Claude: ${err.message}` };
    }

    const run = { child, timer: null, cancelled: false, timedOut: false, finished: false, stderr: '' };
    runs.set(appId, run);
    const emit = (event) => { try { send({ appId, ...event }); } catch { /* the window is gone */ } };
    emit({ kind: 'start' });

    run.timer = setTimer(() => { run.timedOut = true; kill(child, platform); }, timeoutMs);
    if (run.timer && typeof run.timer.unref === 'function') run.timer.unref();

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        for (const ev of diagnose.parseEvent(line) || []) {
          if (ev.kind === 'done' || ev.kind === 'error') run.finished = true;
          emit(ev);
        }
      }
    });
    child.stderr.on('data', (chunk) => { run.stderr = (run.stderr + chunk.toString('utf8')).slice(-4000); });
    child.on('error', (err) => {
      if (!run.finished) { run.finished = true; emit({ kind: 'error', text: `Could not run Claude: ${err.message}` }); }
    });
    child.on('close', (code) => {
      clearTimer(run.timer);
      runs.delete(appId);
      if (!run.finished) {
        emit({ kind: 'error', text: diagnose.friendlyError({ code, stderr: run.stderr, timedOut: run.timedOut, cancelled: run.cancelled }) });
      }
      emit({ kind: 'end' });
    });

    try { child.stdin.end(prompt); } catch { /* close handles it */ }
    return { success: true };
  }

  function cancel(appId) {
    const run = runs.get(appId);
    if (!run) return false;
    run.cancelled = true;
    kill(run.child, platform);
    return true;
  }

  return { start, cancel, isRunning: (appId) => runs.has(appId), cancelAll: () => { for (const id of [...runs.keys()]) cancel(id); } };
}

module.exports = { createRunner, findClaude, killTree };
