/**
 * Run history: a local record of every start, stop and crash.
 *
 * configFile.recordStart / recordStop / recordCrash are the one choke point all
 * surfaces (desktop, web agent, MCP server, VS Code) go through, and each makes
 * one best-effort call here. Records live in <configDir>/history/runs.json,
 * written with configFile.updateJson (lock + atomic rename).
 *
 * Zero dependencies - the MCP server and the VS Code extension load a copy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Shipped beside configFile under either name: .js in src/core, .cjs in the
// MCP server and plugin bundles.
function sibling(name) {
  for (const p of [`./${name}`, `./${name}.cjs`]) {
    try { return require(p); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
  }
  throw new Error(`runHistory: ${name} not found`);
}
const configFile = sibling('configFile');

const historyDirFor = (configPath) => path.join(path.dirname(configPath), 'history');
const runsPathFor = (configPath) => path.join(historyDirFor(configPath), 'runs.json');
const emptyRuns = () => ({ v: 1, runs: [] });

function readRuns(configPath) {
  const data = configFile.readJson(runsPathFor(configPath), emptyRuns);
  return Array.isArray(data.runs) ? data.runs : [];
}

function newId(now) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  return `r_${stamp}_${crypto.randomBytes(4).toString('hex')}`;
}

function readApp(configPath, appId) {
  const config = configFile.readJson(configPath, () => ({ apps: [] }));
  return {
    app: (config.apps || []).find((a) => a.id === appId) || null,
    settings: config.settings || {},
  };
}

// ---- Git state and snapshot ------------------------------------------------
// Captured after the record is written, so a start never waits on git. The
// snapshot is a commit of the whole working tree (tracked changes AND untracked
// files, .gitignore respected) built in a temporary index, then pinned by a ref
// so `git gc` keeps it. The user's index, working tree and branches are never
// touched.

const GIT_CAPTURE_MS = 10000;
const DIRTY_MAX_BYTES = 20 * 1024 * 1024;
const FILES_CAP = 50;
const REF_PREFIX = 'refs/portpilot/runs/';

class Skip extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function gitEnv(extra = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extra };
  // Inherited from a hook that runs inside a git operation, these would point
  // every call below at the wrong repo.
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) if (!(k in extra)) delete env[k];
  return env;
}

// Runs git and resolves its stdout. Rejects with Skip('timeout') past the
// shared deadline and Skip('git-missing') when git is not installed.
function runGit(args, cwd, deadline, env) {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new Skip('timeout'));
  return new Promise((resolve, reject) => {
    require('child_process').execFile('git', args, {
      cwd, env: gitEnv(env), timeout: left, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    }, (err, stdout) => {
      if (!err) return resolve(stdout);
      if (err.code === 'ENOENT') return reject(new Skip('git-missing'));
      if (err.killed) return reject(new Skip('timeout'));
      reject(err);
    });
  });
}

function parseStatus(out) {
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    files.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++; // rename/copy carries the old path next
  }
  return files;
}

function bytesOf(root, rels) {
  let total = 0;
  for (const rel of rels) {
    try { total += fs.statSync(path.join(root, rel)).size; } catch { /* deleted file */ }
  }
  return total;
}

async function snapshotTree(repoRoot, runId, deadline, dirtyFiles, head) {
  // Every dirty path counts, tracked ones too: a changed 50 MB database file
  // would otherwise add a new blob to the repo on every start.
  if (bytesOf(repoRoot, dirtyFiles) > DIRTY_MAX_BYTES) throw new Skip('too-large');

  const realIndex = path.resolve(repoRoot, (await runGit(['rev-parse', '--git-path', 'index'], repoRoot, deadline)).trim());
  const tmpIndex = path.join(require('os').tmpdir(), `portpilot-index-${process.pid}-${runId}`);
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmpIndex);
    const env = {
      GIT_INDEX_FILE: tmpIndex,
      GIT_AUTHOR_NAME: 'PortPilot', GIT_AUTHOR_EMAIL: 'portpilot@localhost',
      GIT_COMMITTER_NAME: 'PortPilot', GIT_COMMITTER_EMAIL: 'portpilot@localhost',
    };
    await runGit(['add', '-A'], repoRoot, deadline, env);
    const tree = (await runGit(['write-tree'], repoRoot, deadline, env)).trim();
    const commit = (await runGit(['commit-tree', tree, '-p', head, '-m', `portpilot run ${runId}`], repoRoot, deadline, env)).trim();
    await runGit(['update-ref', REF_PREFIX + runId, commit], repoRoot, deadline);
    return { ref: REF_PREFIX + runId, commit, bytes: bytesOf(repoRoot, dirtyFiles) };
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch { /* never created */ }
  }
}

async function captureGit(cwd, runId, { snapshots }) {
  const gitState = (skipped, extra = {}) => ({
    branch: null, sha: null, subject: null, dirty: false, files: [], snapshot: null, skipped, ...extra,
  });
  if (!cwd || !fs.existsSync(cwd)) return { repoRoot: null, relCwd: null, git: gitState('not-a-repo') };
  const deadline = Date.now() + GIT_CAPTURE_MS;
  let repoRoot = null;
  // Kept outside the try so a timeout later on still returns what was learned.
  let relCwd = null, head = null, branch = null, subject = null;
  try {
    try {
      // git prints forward slashes already; keep records in one form on every OS.
      repoRoot = (await runGit(['rev-parse', '--show-toplevel'], cwd, deadline)).trim().replace(/\\/g, '/');
    } catch (err) {
      if (err instanceof Skip) throw err;
      return { repoRoot: null, relCwd: null, git: gitState('not-a-repo') };
    }
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
    // Both through realpath: git reports long names, a config can hold 8.3 or
    // symlinked ones, and path.relative would then climb out of the repo.
    relCwd = path.relative(real(repoRoot), real(cwd)).replace(/\\/g, '/');
    try {
      head = (await runGit(['rev-parse', '--verify', '-q', 'HEAD'], repoRoot, deadline)).trim();
    } catch (err) {
      if (err instanceof Skip) throw err;
      return { repoRoot, relCwd, git: gitState('unborn-head') };
    }
    branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], repoRoot, deadline).catch(() => '')).trim() || null;
    subject = (await runGit(['log', '-1', '--format=%s'], repoRoot, deadline)).trim();
    const status = parseStatus(await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot, deadline));
    const state = gitState(null, { branch, sha: head, subject, dirty: status.length > 0, files: status.slice(0, FILES_CAP) });
    if (!state.dirty) return { repoRoot, relCwd, git: state };

    // --type=bool accepts false/no/off/0; an unparseable value errors and counts as "not opted out".
    const optedOut = !snapshots
      || (await runGit(['config', '--type=bool', '--get', 'portpilot.snapshots'], repoRoot, deadline).catch(() => '')).trim() === 'false';
    if (optedOut) return { repoRoot, relCwd, git: { ...state, skipped: 'opted-out' } };
    try {
      state.snapshot = await snapshotTree(repoRoot, runId, deadline, status, head);
    } catch (err) {
      if (!(err instanceof Skip)) throw err;
      state.skipped = err.reason;
    }
    return { repoRoot, relCwd, git: state };
  } catch (err) {
    return { repoRoot, relCwd, git: gitState(err instanceof Skip ? err.reason : 'error', { branch, sha: head, subject }) };
  }
}

const pending = new Set();
/** Resolves when every git capture started so far has been patched in. */
async function whenIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}

function patchRun(configPath, runId, captured) {
  const { repoRoot, relCwd, git: gitState } = captured;
  const { result: kept } = configFile.updateJson(runsPathFor(configPath), (data) => {
    const run = (data.runs || []).find((r) => r.id === runId);
    if (!run) return false;
    run.repoRoot = repoRoot;
    run.relCwd = relCwd;
    run.git = gitState;
    return true;
  }, emptyRuns);
  // The run was pruned while git was working: do not strand its ref.
  if (!kept && gitState.snapshot && repoRoot) dropRefs([{ repoRoot, ref: gitState.snapshot.ref }]);
}

/**
 * Record a start. The record is written synchronously; git state is patched in
 * afterwards. Returns { id, done } where done resolves when the patch is in.
 */
function openRun(configPath, appId, startedBy, { port = null, rerunOf = null } = {}) {
  const { app, settings } = readApp(configPath, appId);
  const now = new Date();
  const id = newId(now);
  const runPort = port || (app && app.preferredPort) || null;
  const record = {
    id,
    appId,
    appName: app ? app.name : null,
    cwd: app ? app.cwd || null : null,
    repoRoot: null,
    relCwd: null,
    command: app ? app.command || null : null,
    port: runPort,
    url: runPort ? `http://localhost:${runPort}/` : null,
    startedBy,
    startedAt: now.toISOString(),
    stoppedAt: null,
    endedBy: null,
    exitCode: null,
    git: null,
    page: null,
    pinned: false,
  };
  if (rerunOf) record.rerunOf = String(rerunOf);
  const { result: dropped } = configFile.updateJson(runsPathFor(configPath), (data) => {
    if (!Array.isArray(data.runs)) data.runs = [];
    // The app is being started again, so any run still open for it was lost
    // without a stop or crash being seen.
    for (const run of data.runs) {
      if (run.appId === appId && !run.stoppedAt) {
        run.stoppedAt = record.startedAt;
        run.endedBy = 'unknown';
      }
    }
    data.runs.push(record);
    return prune(data, historyDirFor(configPath), capsFrom(settings));
  }, emptyRuns);
  dropRefs(dropped);
  const done = captureGit(record.cwd, id, { snapshots: settings.historySnapshots !== false })
    .then((captured) => patchRun(configPath, id, captured))
    .catch((err) => console.error('[runHistory] git capture failed:', err.message))
    .finally(() => pending.delete(done));
  pending.add(done);
  return { id, done };
}

// Only refs this module could have written are ever deleted, whatever runs.json says.
const REF_RE = /^refs\/portpilot\/runs\/r_[A-Za-z0-9_]+$/;

function deleteRefs(repoRoot, refs) {
  return new Promise((resolve) => {
    if (!fs.existsSync(repoRoot)) return resolve();
    const child = require('child_process').spawn('git', ['update-ref', '--stdin'], {
      cwd: repoRoot, env: gitEnv(), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => child.kill(), 15000);
    const finish = () => { clearTimeout(timer); resolve(); };
    child.on('error', finish);
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(refs.map((r) => `delete ${r}\n`).join(''));
  });
}

// Best-effort, and always outside the history lock. One git process per repo
// (a mass prune must not spawn one per ref), started after the caller returns
// so a start never waits on it.
function dropRefs(refs) {
  const byRepo = new Map();
  for (const { repoRoot, ref } of refs) {
    if (!repoRoot || !REF_RE.test(String(ref))) continue;
    if (!byRepo.has(repoRoot)) byRepo.set(repoRoot, []);
    byRepo.get(repoRoot).push(ref);
  }
  for (const [repoRoot, list] of byRepo) {
    const p = new Promise((resolve) => setImmediate(resolve))
      .then(() => deleteRefs(repoRoot, list))
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  }
}

// ---- Retention -------------------------------------------------------------
// Caps are settings (historyMaxRuns, historyMaxMB). Pinned runs never prune,
// and neither does a run that is still open. Called inside the same
// updateJson that appends, so the file never sits over a cap.

const DEFAULT_MAX_RUNS = 500;
const DEFAULT_MAX_MB = 150;
const MAX_PINS = 50;

function capsFrom(settings) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    maxRuns: Math.floor(num(settings.historyMaxRuns, DEFAULT_MAX_RUNS)),
    maxBytes: num(settings.historyMaxMB, DEFAULT_MAX_MB) * 1024 * 1024,
  };
}

function thumbPath(dir, run) {
  if (!run.page || !run.page.thumb) return null;
  // A thumb path read from runs.json must stay under history/.
  const p = path.resolve(dir, run.page.thumb);
  return p.startsWith(path.resolve(dir) + path.sep) ? p : null;
}

function thumbSize(dir, run) {
  const p = thumbPath(dir, run);
  if (!p) return 0;
  try { return fs.statSync(p).size; } catch { return 0; }
}

/** Drops the oldest unpinned, closed runs until both caps hold. Returns their refs. */
function prune(data, dir, { maxRuns, maxBytes }) {
  const runs = data.runs;
  const sizes = new Map(runs.map((r) => [r.id, thumbSize(dir, r)]));
  let total = Buffer.byteLength(JSON.stringify(data));
  for (const size of sizes.values()) total += size;
  const refs = [];
  for (let i = 0; i < runs.length && (runs.length > maxRuns || total > maxBytes);) {
    const run = runs[i];
    if (run.pinned || !run.stoppedAt) { i++; continue; }
    runs.splice(i, 1);
    total -= sizes.get(run.id) + Buffer.byteLength(JSON.stringify(run)) + 4;
    const thumb = thumbPath(dir, run);
    if (thumb) { try { fs.unlinkSync(thumb); } catch { /* already gone */ } }
    if (run.git && run.git.snapshot && run.repoRoot) refs.push({ repoRoot: run.repoRoot, ref: run.git.snapshot.ref });
  }
  return refs;
}

/** Pin or unpin a run. A 51st pin is refused. */
function pinRun(configPath, runId, pinned) {
  const { result } = configFile.updateJson(runsPathFor(configPath), (data) => {
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const run = runs.find((r) => r.id === runId);
    if (!run) return { ok: false, reason: 'not-found' };
    if (pinned && !run.pinned && runs.filter((r) => r.pinned).length >= MAX_PINS) return { ok: false, reason: 'pin-limit' };
    run.pinned = !!pinned;
    return { ok: true };
  }, emptyRuns);
  return result;
}

/** Attach a thumbnail (path under history/) and the page title, then re-check the byte cap. */
function setThumb(configPath, runId, thumb, title = null) {
  const settings = readApp(configPath, null).settings;
  const { result: dropped } = configFile.updateJson(runsPathFor(configPath), (data) => {
    const run = (data.runs || []).find((r) => r.id === runId);
    if (!run) return [];
    run.page = { ...(run.page || {}), thumb, ...(title ? { title: String(title).slice(0, 200) } : {}) };
    return prune(data, historyDirFor(configPath), capsFrom(settings));
  }, emptyRuns);
  dropRefs(dropped);
}

/** Close the newest open run of an app. No open run: nothing is written. */
function closeRun(configPath, appId, { endedBy, exitCode = null }) {
  configFile.updateJson(runsPathFor(configPath), (data) => {
    const runs = Array.isArray(data.runs) ? data.runs : [];
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      if (run.appId !== appId || run.stoppedAt) continue;
      run.stoppedAt = new Date().toISOString();
      run.endedBy = endedBy;
      run.exitCode = exitCode ?? null;
      break;
    }
  }, emptyRuns);
}

module.exports = {
  historyDirFor, runsPathFor, readRuns, openRun, closeRun, pinRun, setThumb, whenIdle, deleteRefs, REF_RE,
  MAX_PINS, DEFAULT_MAX_RUNS, DEFAULT_MAX_MB,
};
