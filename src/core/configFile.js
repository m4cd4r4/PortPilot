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
 *     crashed holder and is taken over.
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

function withLock(file, fn) {
  const lockPath = `${file}.lock`;
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
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch { /* released between our open and stat - retry */ }
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for config lock ${lockPath} (${err.code})`);
      sleepSync(5 + Math.floor(Math.random() * 20));
    }
  }
  try {
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return fn();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
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

module.exports = { readJson, writeJsonAtomic, withLock, updateJson };
