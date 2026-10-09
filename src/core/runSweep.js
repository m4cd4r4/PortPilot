/**
 * Weekly clean-up of what run history can leak, plus the footer's size figures.
 *
 * Pruning (runHistory.prune) removes a dropped run's thumb and ref. Two things
 * escape it: a thumb written for a run that was pruned a moment later, and a
 * snapshot ref whose record never landed (the process died between update-ref
 * and the record patch, or runs.json was lost). The sweep removes both. Nothing
 * younger than an hour is touched, so a capture in flight is never raced.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const runHistory = require('./runHistory');
const configFile = require('./configFile');

const MIN_AGE_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const REF_ID_RE = /^refs\/portpilot\/runs\/(r_[A-Za-z0-9_]+)$/;

/**
 * Pure. thumbFiles: [{ name, ageMs }] in history/thumbs; refs: [{ repoRoot, ref, ageMs }].
 * Returns what to delete: thumbs no run points at, refs no run owns.
 */
function planSweep({ runs, thumbFiles, refs, minAgeMs = MIN_AGE_MS }) {
  const kept = new Set();
  const ids = new Set();
  for (const r of runs) {
    ids.add(r.id);
    if (r.page && r.page.thumb) kept.add(path.basename(String(r.page.thumb)));
  }
  return {
    thumbs: thumbFiles.filter((f) => !kept.has(f.name) && f.ageMs >= minAgeMs).map((f) => f.name),
    refs: refs.filter((x) => {
      const m = REF_ID_RE.exec(x.ref);
      return m && !ids.has(m[1]) && x.ageMs >= minAgeMs;
    }).map(({ repoRoot, ref }) => ({ repoRoot, ref })),
  };
}

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

// The repos to look in: every one a run was taken in, plus every registered
// app's, because an orphan ref is by definition one no run record names.
async function repoRootsFor(configPath, runs) {
  const found = runs.map((r) => r.repoRoot).filter(Boolean);
  const cfg = configFile.readJson(configPath, () => ({ apps: [] }));
  const cwds = [...new Set((cfg.apps || []).map((a) => a.cwd).filter((c) => c && fs.existsSync(c)))].slice(0, 200);
  for (const cwd of cwds) {
    const top = await git(['rev-parse', '--show-toplevel'], cwd);
    if (top) found.push(top.trim().replace(/\\/g, '/'));
  }
  // One entry per real folder: git reports long names, a record can hold 8.3 or
  // differently cased ones, and the same repo must not be listed twice.
  const byReal = new Map();
  for (const r of found) {
    if (!fs.existsSync(r)) continue;
    let real = r;
    try { real = fs.realpathSync.native(r); } catch { /* keep raw */ }
    if (!byReal.has(real.toLowerCase())) byReal.set(real.toLowerCase(), r);
  }
  return [...byReal.values()];
}

async function listRefs(repoRoot, now) {
  const out = await git(['for-each-ref', '--format=%(refname) %(committerdate:unix)', 'refs/portpilot/runs/'], repoRoot);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [ref, unix] = line.split(' ');
    return { repoRoot, ref, ageMs: now - Number(unix) * 1000 };
  });
}

/**
 * runs.json read strictly. runHistory.readRuns answers [] for any read error,
 * and an empty list makes every ref and thumb look orphaned, so the sweep must
 * tell "unreadable" from "empty". Throws on anything but a well-formed file.
 */
function readRunsStrict(configPath) {
  let raw;
  try { raw = fs.readFileSync(runHistory.runsPathFor(configPath), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return []; // no history yet: nothing to sweep
    throw err;
  }
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.runs)) throw new Error('runs.json has no runs array');
  return data.runs;
}

/**
 * Remove orphan thumbs and refs now. Resolves { thumbs, refs } counts removed.
 * Throws (deleting nothing) when runs.json is unreadable; deletes nothing when
 * it lists no runs, because a profile with no history owns none of the refs.
 */
async function sweep(configPath, { now = Date.now() } = {}) {
  const runs = readRunsStrict(configPath);
  if (!runs.length) return { thumbs: 0, refs: 0 };
  const thumbDir = path.join(runHistory.historyDirFor(configPath), 'thumbs');
  let thumbFiles = [];
  try {
    thumbFiles = fs.readdirSync(thumbDir).map((name) => {
      try { return { name, ageMs: now - fs.statSync(path.join(thumbDir, name)).mtimeMs }; } catch { return null; }
    }).filter(Boolean);
  } catch { /* no thumbs yet */ }

  const refs = [];
  for (const repoRoot of await repoRootsFor(configPath, runs)) refs.push(...await listRefs(repoRoot, now));

  const plan = planSweep({ runs, thumbFiles, refs });
  for (const name of plan.thumbs) { try { fs.unlinkSync(path.join(thumbDir, name)); } catch { /* gone */ } }
  const byRepo = new Map();
  for (const { repoRoot, ref } of plan.refs) byRepo.set(repoRoot, [...(byRepo.get(repoRoot) || []), ref]);
  for (const [repoRoot, list] of byRepo) await runHistory.deleteRefs(repoRoot, list);
  return { thumbs: plan.thumbs.length, refs: plan.refs.length };
}

/** Run the sweep when the last one is over a week old. Never throws. */
async function sweepIfDue(configPath, { now = Date.now() } = {}) {
  const stamp = path.join(runHistory.historyDirFor(configPath), 'last-sweep');
  try {
    if (now - fs.statSync(stamp).mtimeMs < SWEEP_EVERY_MS) return null;
  } catch { /* never swept */ }
  try {
    await runHistory.whenIdle();
    const result = await sweep(configPath, { now });
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, new Date(now).toISOString());
    return result;
  } catch (err) {
    console.error('[runSweep] failed:', err.message);
    return null;
  }
}

function dirBytes(dir) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      try { total += fs.statSync(path.join(dir, name)).size; } catch { /* raced a delete */ }
    }
  } catch { /* no dir */ }
  return total;
}

/** Footer figures: run count and bytes (runs.json plus thumbs) against the caps. */
function historyStats(configPath) {
  const dir = runHistory.historyDirFor(configPath);
  const settings = (configFile.readJson(configPath, () => ({})).settings) || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  let json = 0;
  try { json = fs.statSync(runHistory.runsPathFor(configPath)).size; } catch { /* none yet */ }
  return {
    runs: runHistory.readRuns(configPath).length,
    bytes: json + dirBytes(path.join(dir, 'thumbs')),
    maxRuns: Math.floor(num(settings.historyMaxRuns, runHistory.DEFAULT_MAX_RUNS)),
    maxBytes: num(settings.historyMaxMB, runHistory.DEFAULT_MAX_MB) * 1024 * 1024,
  };
}

module.exports = { planSweep, sweep, sweepIfDue, historyStats, MIN_AGE_MS };
