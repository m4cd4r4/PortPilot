/**
 * Crash-safe, multi-process access to the shared config file.
 *
 * Four processes write portpilot-config.json: the desktop app, the web agent,
 * the MCP server and the VS Code extension. A plain writeFileSync can leave a
 * truncated file if the process dies mid-write, and two read-modify-write
 * cycles that overlap silently drop one of the changes. So:
 *
 *   - writeJsonAtomic: write a temp file in the same directory, then rename it
 *     over the target. Readers see the old file or the new one, never half.
 *   - withLock: an exclusive lock file (<config>.lock, created with 'wx') held
 *     across the whole read-modify-write. A lock older than STALE_MS is from a
 *     crashed holder and is taken over (see breakStaleLock).
 *   - updateJson: withLock + fresh read + mutate + atomic write.
 *
 * Synchronous on purpose: every caller's existing API is synchronous.
 * Zero dependencies - the MCP server and the VS Code extension load a copy.
 */
const fs = require('fs');
const path = require('path');

const STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;
const RENAME_RETRY_MS = 1000;

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[configFile] Failed to read ${file}:`, err.message);
      // Unparseable: the next write would replace it with defaults, so keep a copy.
      if (err instanceof SyntaxError) {
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
      }
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Windows refuses the rename (EPERM/EBUSY/EACCES) while another process, or
  // an antivirus scanner, briefly holds the target open. Retry for a moment.
  const deadline = Date.now() + RENAME_RETRY_MS;
  for (;;) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
      if (!transient || Date.now() > deadline) {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        throw err;
      }
      sleepSync(10);
    }
  }
}

function readLockToken(lockPath) {
  try { return fs.readFileSync(lockPath, 'utf8'); } catch { return null; }
}

/**
 * Take over a lock whose holder looks crashed. Two contenders can both see the
 * same lock as stale; a plain unlink would let the slower one delete the lock
 * the faster one has just created. So move the lock aside first, then check
 * the moved file is still old and still carries the token we read (every
 * holder writes a unique one). If not, it is a live lock - put it back.
 */
function breakStaleLock(lockPath, staleToken) {
  const aside = `${lockPath}.stale-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return; // gone or taken over by someone else - just retry the open
  }
  let live = true;
  try {
    live = readLockToken(aside) !== staleToken || Date.now() - fs.statSync(aside).mtimeMs <= STALE_MS;
  } catch { /* unreadable - treat as live */ }
  if (live) {
    // Residual: if a third process created a lock in the instant since the
    // rename, the link fails and that holder overlaps this one. Needs a stale
    // lock and three contenders within microseconds.
    try { fs.linkSync(aside, lockPath); } catch { /* lockPath re-created meanwhile */ }
  }
  try { fs.unlinkSync(aside); } catch { /* best effort */ }
}

function withLock(file, fn) {
  const lockPath = `${file}.lock`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      // Windows answers EPERM/EACCES, not EEXIST, while another process's
      // unlink of the lock is still pending. Both mean "held - retry".
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      if (err.code === 'EEXIST') {
        let stale = false;
        try {
          stale = Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS;
        } catch { /* released between our open and stat - retry */ }
        if (stale) {
          const staleToken = readLockToken(lockPath);
          if (staleToken !== null) breakStaleLock(lockPath, staleToken);
          continue;
        }
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for config lock ${lockPath} (${err.code})`);
      sleepSync(5 + Math.floor(Math.random() * 20));
    }
  }
  try {
    fs.writeSync(fd, token);
    fs.closeSync(fd);
    return fn();
  } finally {
    // Only release our own lock: if we overran STALE_MS it may now be someone else's.
    if (readLockToken(lockPath) === token) {
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }
  }
}

/**
 * Locked read-modify-write. The mutator edits the freshly read object in place
 * and its return value is passed back. The file is only rewritten when the
 * object actually changed, so an error path that returns early writes nothing.
 * Returns { config, result }.
 */
function updateJson(file, mutator, fallback) {
  return withLock(file, () => {
    const config = readJson(file, fallback);
    const before = JSON.stringify(config);
    const result = mutator(config);
    if (JSON.stringify(config) !== before || !fs.existsSync(file)) writeJsonAtomic(file, config);
    return { config, result };
  });
}

// ---- Runtime state ---------------------------------------------------------
// Who started each running app lives in portpilot-runtime.json beside the
// config, not in the config itself: it changes on every start and stop, and it
// must not ride along in a config export or backup. Shape:
//   { apps: { <appId>: { startedBy, pid, port } } }
// An entry says who started the app last; whether it is still running is the
// reader's call (match the live port/pid). Writes are best-effort: a failed
// stamp must never fail the start or stop it describes.

function runtimePathFor(configPath) {
  return path.join(path.dirname(configPath), 'portpilot-runtime.json');
}

const emptyRuntime = () => ({ apps: {} });

function readRuntime(configPath) {
  const runtime = readJson(runtimePathFor(configPath), emptyRuntime);
  if (!runtime.apps || typeof runtime.apps !== 'object') runtime.apps = {};
  return runtime;
}

function recordStart(configPath, appId, startedBy, { pid = null, port = null } = {}) {
  if (!appId || !startedBy) return false;
  try {
    updateJson(runtimePathFor(configPath), (runtime) => {
      if (!runtime.apps || typeof runtime.apps !== 'object') runtime.apps = {};
      runtime.apps[appId] = { startedBy, pid: pid || null, port: port || null };
    }, emptyRuntime);
    return true;
  } catch (err) {
    console.error('[configFile] Failed to record app start:', err.message);
    return false;
  }
}

function recordStop(configPath, appId) {
  if (!appId) return false;
  try {
    updateJson(runtimePathFor(configPath), (runtime) => {
      if (runtime.apps && runtime.apps[appId]) delete runtime.apps[appId];
    }, emptyRuntime);
    return true;
  } catch (err) {
    console.error('[configFile] Failed to record app stop:', err.message);
    return false;
  }
}

// Stamp an unexpected exit so surfaces outside the desktop process (the VS
// Code extension) can tell a crash from a clean stop. The stamp replaces the
// dead run's entry, so its startedBy never labels a later process on the same
// port. recordStart replaces the entry, which clears it; recordStop deletes it.
function recordCrash(configPath, appId, exitCode) {
  if (!appId) return false;
  try {
    updateJson(runtimePathFor(configPath), (runtime) => {
      if (!runtime.apps || typeof runtime.apps !== 'object') runtime.apps = {};
      runtime.apps[appId] = { crashed: { exitCode: exitCode ?? null, at: Date.now() } };
    }, emptyRuntime);
    return true;
  } catch (err) {
    console.error('[configFile] Failed to record app crash:', err.message);
    return false;
  }
}

module.exports = {
  readJson, writeJsonAtomic, withLock, updateJson,
  runtimePathFor, readRuntime, recordStart, recordStop, recordCrash,
};
