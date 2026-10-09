/**
 * Pure helpers for "Re-run this version" (the IO lives in src/main/rerun.js).
 * Zero dependencies. The lockfile table mirrors rerunSteps in mcp-server/index.js,
 * so find_run's literal steps and the desktop button do the same thing.
 */
const path = require('path');

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];

// -p is a port flag only for these tools; for others (python -m, npm -p) it is not.
const SHORT_P_TOOLS = /\b(next|nuxt|nuxi|http-server|serve|flask|vite|astro)\b/;

/**
 * Point a start command at a new port. A `--port N` / `--port=N` (and `-p N` for
 * tools that take it) is rewritten; a leading `PORT=N` too. Anything else is
 * left alone and the caller sets the PORT env var instead.
 * @returns {{ command: string, rewritten: boolean }}
 */
function rewritePort(command, port) {
  const n = String(Number(port));
  let rewritten = false;
  // Work one `a && b | c` segment at a time, so a `-p` belonging to `docker run`
  // is never taken for the port flag of a `next dev` further along.
  const out = String(command || '').split(/(&&|\|\||;|\|)/).map((seg) => {
    if (/^(&&|\|\||;|\|)$/.test(seg)) return seg;
    const swap = (re) => { seg = seg.replace(re, (_, pre) => { rewritten = true; return `${pre}${n}`; }); };
    swap(/(--port(?:\s+|=))\d+/);
    if (SHORT_P_TOOLS.test(seg)) swap(/(\s-p(?:\s+|=)?)\d+(?![\d:])/);
    swap(/((?:^|\s)PORT=)\d+/);
    return seg;
  }).join('');
  return { command: out, rewritten };
}

const SHA_RE = /^[0-9a-f]{40,64}$/i;
const SNAPSHOT_REF_RE = /^refs\/portpilot\/runs\/r_[A-Za-z0-9_]+$/;

/**
 * Run records are read from a file anyone can edit, and their values reach git
 * and the filesystem. Refuse anything that is not shaped like a record
 * PortPilot wrote. Returns { code, message } or null.
 */
function validateRecord(run) {
  const bad = (message) => ({ code: 'bad-record', message });
  const g = run.git;
  if (!/^r_[A-Za-z0-9_]+$/.test(String(run.id))) return bad('This run record has an invalid id.');
  if (!path.isAbsolute(String(run.repoRoot)) || !path.basename(String(run.repoRoot))) {
    return bad('This run record has no usable repo folder.');
  }
  if (!SHA_RE.test(String(g.sha))) return bad('This run record has an invalid commit.');
  if (g.snapshot) {
    if (g.snapshot.ref && !SNAPSHOT_REF_RE.test(String(g.snapshot.ref))) return bad('This run record has an invalid snapshot ref.');
    if (g.snapshot.commit && !SHA_RE.test(String(g.snapshot.commit))) return bad('This run record has an invalid snapshot commit.');
  }
  const rel = String(run.relCwd || '');
  if (path.isAbsolute(rel) || rel.split(/[\\/]+/).includes('..')) return bad('This run record has a folder outside its repo.');
  if (!String(run.command || '').trim()) return bad('This run record has no start command.');
  return null;
}

/**
 * Which install a fresh worktree needs. Looks for a lockfile in the run's
 * folder, then the repo root; falls back to `npm install` where a package.json
 * is. Null when the run has no Node project.
 * @param {string} root   worktree root
 * @param {string} rel    run folder relative to the root ('' for the root)
 * @param {(p: string) => boolean} exists
 * @returns {{ dir: string, cmd: string, lockfile: string|null } | null}
 */
function detectInstall(root, rel, exists) {
  const dirs = [rel || '', ''].filter((d, i, a) => a.indexOf(d) === i);
  const at = (d, file) => path.join(root, d, file);
  for (const d of dirs) {
    const lock = LOCKFILES.find((f) => exists(at(d, f)));
    if (!lock) continue;
    const berry = lock === 'yarn.lock' && exists(at(d, '.yarnrc.yml'));
    const cmd = {
      'package-lock.json': 'npm ci',
      'pnpm-lock.yaml': 'pnpm install --frozen-lockfile',
      'yarn.lock': berry ? 'yarn install --immutable' : 'yarn install --frozen-lockfile',
      'bun.lockb': 'bun install --frozen-lockfile',
      'bun.lock': 'bun install --frozen-lockfile',
    }[lock];
    return { dir: d, cmd, lockfile: lock };
  }
  const d = dirs.find((dir) => exists(at(dir, 'package.json')));
  return d === undefined ? null : { dir: d, cmd: 'npm install', lockfile: null };
}

/** Sibling worktree folder for a run, matching rerunSteps in the MCP server. */
function worktreePathFor(run) {
  return `${String(run.repoRoot).replace(/[\\/]+$/, '')}-run-${String(run.id).replace(/^r_/, '')}`;
}

/**
 * Why a run cannot be re-run, from facts the caller gathered, or null.
 * `facts`: { repoExists, targetExists } where targetExists says whether the
 * snapshot ref (or, for a clean tree, the commit) still resolves in the repo.
 * @returns {{ code: string, message: string } | null}
 */
function refusalFor(run, facts) {
  if (!run || !run.git || !run.git.sha || !run.repoRoot) {
    return { code: 'no-git', message: 'No git state was recorded for this run, so its files cannot be restored.' };
  }
  if (!facts.repoExists) {
    return { code: 'repo-gone', message: `The repo is gone: ${run.repoRoot}` };
  }
  if (!facts.targetExists) {
    return run.git.snapshot
      ? { code: 'ref-pruned', message: 'The snapshot for this run was pruned from the repo (git gc or a cleared ref).' }
      : { code: 'commit-gone', message: `Commit ${String(run.git.sha).slice(0, 7)} is no longer in the repo.` };
  }
  return null;
}

module.exports = { rewritePort, detectInstall, worktreePathFor, refusalFor, validateRecord, LOCKFILES };
