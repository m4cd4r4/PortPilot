/**
 * "Re-run this version": bring a recorded run back as a new app, in a sibling
 * worktree, on a free port. The pure decisions live in src/core/rerun.js; this
 * file does the git, install, register and start. Every external effect is in
 * `deps` so tests can drive it without Electron.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn, fork } = require('child_process');

const rerun = require('../core/rerun');

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const normPath = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();

function gitEnv() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[k];
  return env;
}

/** Resolves { ok, out, err }. Never rejects. */
function git(args, cwd, timeout = 120000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env: gitEnv(), windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || ''), err: String(stderr || (error && error.message) || '') }));
  });
}

/** Run an install command, reporting its last output line. Resolves { ok, tail }. */
function runInstall(cmd, cwd, onLine) {
  return new Promise((resolve) => {
    let tail = '';
    const child = spawn(cmd, { cwd, shell: true, windowsHide: true, env: process.env });
    // shell:true on Windows makes child the cmd.exe wrapper; kill the whole tree or npm keeps writing.
    const kill = () => {
      try {
        if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        else child.kill();
      } catch { /* gone */ }
    };
    const timer = setTimeout(kill, INSTALL_TIMEOUT_MS);
    const feed = (chunk) => {
      tail = (tail + chunk.toString()).slice(-2000);
      const line = chunk.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
      if (line) onLine(line.slice(0, 120));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, tail: err.message }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, tail }); });
  });
}

/**
 * Register through the MCP server's register-worktree CLI (the add_worktree logic).
 * `configPath` is the desktop's own config, so the app lands where the UI reads it
 * (a custom --user-data-dir would otherwise send it elsewhere). Resolves { ok, app, error }.
 */
function registerViaCli(mcpEntry, flags, configPath, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const args = ['register-worktree'];
    for (const [k, v] of Object.entries(flags)) if (v !== null && v !== undefined && v !== '') args.push(`--${k}`, String(v));
    let out = '';
    let err = '';
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (configPath) env.PORTPILOT_CONFIG_PATH = configPath;
    const child = fork(mcpEntry, args, { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      resolve({ ok: false, error: 'Registering the app timed out (the config may be locked by another tool).' });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: (err || `register-worktree exited ${code}`).trim() });
      try { resolve({ ok: true, app: JSON.parse(out).app }); } catch { resolve({ ok: false, error: 'register-worktree printed no result' }); }
    });
  });
}

function defaultMcpEntry() {
  const { app } = require('electron');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp-server', 'index.js')
    : path.join(__dirname, '..', '..', 'mcp-server', 'index.js');
}

/** First port at or above `from` that nothing listens on and no registered app claims. */
async function pickPort(from, claimed, findAvailablePort) {
  let start = from;
  for (let i = 0; i < 30; i++) {
    const p = await findAvailablePort(start, start + 100);
    if (!p) return null;
    if (!claimed.has(p)) return p;
    start = p + 1;
  }
  return null;
}

const fail = (code, error) => ({ success: false, code, error });

// Re-runs share the port list and the config, so the pick-register-start step runs one at a time.
let lock = Promise.resolve();
function serialise(fn) {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}

/**
 * @param {object} run      a run record from history/runs.json
 * @param {object} ctx      { configStore, configPath, onProgress }
 * @param {object} [deps]   test seams
 */
async function rerunVersion(run, ctx, deps = {}) {
  const { configStore, configPath } = ctx;
  const progress = ctx.onProgress || (() => {});
  const d = {
    git, runInstall, registerViaCli, exists: fs.existsSync,
    mcpEntry: deps.mcpEntry || defaultMcpEntry,
    findAvailablePort: deps.findAvailablePort || require('./portScanner').findAvailablePort,
    startApp: deps.startApp || require('./processManager').startApp,
    isRunning: deps.isRunning || ((id) => require('./processManager').getRunningApps().some((a) => a.id === id && a.running)),
    recordStart: deps.recordStart || require('../core/configFile').recordStart,
    makeStartedBy: deps.makeStartedBy || require('../core/status').makeStartedBy,
    ...deps,
  };
  const say = (stage, line) => progress({ runId: run.id, stage, line: line || null });

  try {
    say('checking');
    if (!run || !run.git || !run.git.sha || !run.repoRoot) return fail('no-git', rerun.refusalFor(run, {}).message);
    const invalid = rerun.validateRecord(run);
    if (invalid) return fail(invalid.code, invalid.message);
    const repoExists = d.exists(run.repoRoot);
    let target = null;
    let gitBroken = null;
    if (repoExists) {
      const candidates = run.git.snapshot ? [run.git.snapshot.ref, run.git.snapshot.commit] : [run.git.sha];
      for (const c of candidates.filter(Boolean)) {
        const r = await d.git(['rev-parse', '--verify', '-q', `${c}^{commit}`], run.repoRoot);
        if (r.ok && r.out.trim()) { target = c; break; }
        // git exits 1 when the object is simply absent; anything else (not installed, dubious ownership, not a repo) is a different problem.
        if (!r.ok && r.err && /ENOENT|dubious ownership|not a git repository|spawn/i.test(r.err)) gitBroken = r.err.trim().slice(-200);
      }
    }
    if (repoExists && !target && gitBroken) return fail('git-failed', `git could not read the repo: ${gitBroken}`);
    const refusal = rerun.refusalFor(run, { repoExists, targetExists: !!target });
    if (refusal) return fail(refusal.code, refusal.message);

    const wt = rerun.worktreePathFor(run);
    const rel = run.relCwd || '';
    const runDir = path.join(wt, rel);
    const resetToOriginal = () => d.git(['-C', wt, 'reset', '--mixed', run.git.sha], run.repoRoot);
    // A half-made worktree is our own mess: take it back out so the next press starts clean.
    const discardWorktree = async () => {
      await d.git(['worktree', 'remove', '--force', wt], run.repoRoot);
      await d.git(['worktree', 'prune'], run.repoRoot);
    };

    if (!d.exists(wt)) {
      say('worktree');
      const add = await d.git(['worktree', 'add', '--detach', wt, target], run.repoRoot, 600000);
      if (!add.ok) {
        if (d.exists(wt)) await discardWorktree();
        return fail('worktree-failed', `git worktree add failed: ${add.err.trim().slice(-300)}`);
      }
      if (run.git.snapshot) {
        const reset = await resetToOriginal();
        if (!reset.ok) {
          await discardWorktree();
          return fail('reset-failed', `git reset failed: ${reset.err.trim().slice(-300)}`);
        }
      }
    } else {
      // Reused folder: trust it only if it is still at the original commit. A folder made from
      // find_run's steps sits at the snapshot commit (changes committed), so finish the reset it lacks.
      const head = await d.git(['-C', wt, 'rev-parse', 'HEAD'], run.repoRoot);
      const at = head.ok ? head.out.trim().toLowerCase() : '';
      const snap = run.git.snapshot && run.git.snapshot.commit ? String(run.git.snapshot.commit).toLowerCase() : null;
      if (at === String(run.git.sha).toLowerCase()) { /* as we left it */ }
      else if (snap && at === snap) {
        const reset = await resetToOriginal();
        if (!reset.ok) return fail('reset-failed', `git reset failed: ${reset.err.trim().slice(-300)}`);
      } else {
        return fail('worktree-stale', `${wt.replace(/\\/g, '/')} exists but is not at this run's commit. Remove that folder and try again.`);
      }
    }

    const install = rerun.detectInstall(wt, rel, d.exists);
    const modules = install && path.join(wt, install.dir, 'node_modules');
    if (install && !d.exists(modules)) {
      say('install', install.cmd);
      const res = await d.runInstall(install.cmd, path.join(wt, install.dir), (line) => say('install', line));
      if (!res.ok) {
        // We created this node_modules (it did not exist a moment ago); a partial one would be skipped next time.
        try { fs.rmSync(modules, { recursive: true, force: true }); } catch { /* locked; the next press reports it */ }
        return fail('install-failed', `${install.cmd} failed: ${res.tail.trim().split('\n').pop() || 'no output'}`);
      }
    }

    // Pick a port, register and start as one step: two presses at once must not choose the same port.
    return await serialise(async () => {
      say('register');
      const apps = configStore.getApps();
      const existing = apps.find((a) => a.cwd && normPath(a.cwd) === normPath(runDir));
      let app;
      let port;
      if (existing && Number(existing.preferredPort) && d.isRunning(existing.id)) {
        // Pressed again while its re-run is up: same app, same port, nothing to register.
        port = Number(existing.preferredPort);
        app = existing;
      } else {
        const claimed = new Set(apps.map((a) => Number(a.preferredPort)).filter(Boolean));
        // A stopped re-run may reuse its own port if it is still free (its old server can linger on some platforms).
        if (existing) claimed.delete(Number(existing.preferredPort));
        port = await pickPort(Number(run.port) || 3000, claimed, d.findAvailablePort);
        if (!port) return fail('no-port', 'No free port found near the original one.');
        const { command } = rerun.rewritePort(run.command, port);
        const parent = apps.find((a) => a.id === run.appId);
        const reg = await d.registerViaCli(d.mcpEntry(), {
          path: runDir.replace(/\\/g, '/'),
          branch: `run ${String(run.startedAt || '').slice(0, 10)}`.trim(),
          port,
          parent: parent ? parent.id : null,
          name: run.appName || path.basename(wt),
          command,
        }, configPath);
        if (!reg.ok) return fail('register-failed', reg.error);
        app = { ...reg.app, preferredPort: port, command };
      }

      say('start');
      const started = await d.startApp(app);
      const result = { success: true, appId: app.id, port, path: runDir.replace(/\\/g, '/'), rerunOf: run.id };
      if (run.git.dirty && !run.git.snapshot) {
        result.warning = 'This run had uncommitted changes that were not captured, so only its commit was restored.';
      }
      if (started && !started.success && /already running/i.test(started.error || '')) {
        say('done');
        return result; // pressed again while its re-run is up: nothing to start, same port
      }
      if (!started || !started.success) return fail('start-failed', (started && started.error) || 'The app did not start.');
      d.recordStart(configPath, app.id, d.makeStartedBy({ kind: 'human', surface: 'desktop' }),
        { pid: started.pid, port, rerunOf: run.id });
      say('done');
      return result;
    });
  } catch (err) {
    return fail('error', err.message);
  }
}

module.exports = { rerunVersion, pickPort, registerViaCli, runInstall };
