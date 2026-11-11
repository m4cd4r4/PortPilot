/**
 * The main repo folder of each registered app, read from disk, for the Apps page's project groups
 * (src/core/appProjects.js). A linked worktree's `.git` is a file naming the main repo, so a repo
 * and its worktrees resolve to the same folder without running git.
 *
 * Answers are cached per folder: the Apps page asks on every refresh and a library of 170 apps is
 * 170 walks up the tree. Each folder ages out at its own time, so the library is never re-read in
 * one tick. A folder that is gone has no answer and is looked for again sooner; the page then
 * works from the path.
 */
const fs = require('fs');
const path = require('path');

const TTL_MS = 5 * 60 * 1000;
const SPREAD_MS = 60 * 1000;
const MISSING_TTL_MS = 30 * 1000;
const MISSING_SPREAD_MS = 15 * 1000;
const MAX_UP = 12;
const cache = new Map(); // folder -> { root, at }

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/** How long an answer for this folder is kept. The same folder always gets the same time. */
function ttlFor(folder, found) {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) >>> 0;
  return found ? TTL_MS + (h % SPREAD_MS) : MISSING_TTL_MS + (h % MISSING_SPREAD_MS);
}

/**
 * The main repo that holds `cwd`, or null when no `.git` is found above it. Never throws.
 * A folder that does not exist has no repo: walking up from it would stop at whatever repo sits
 * above (a dotfiles repo in the home folder), which need not be its own.
 */
function mainRepoOf(cwd) {
  let dir = norm(cwd);
  try {
    if (!dir || !fs.statSync(dir).isDirectory()) return null;
  } catch { return null; }
  for (let i = 0; i < MAX_UP && dir; i++) {
    const dotGit = `${dir}/.git`;
    try {
      if (fs.statSync(dotGit).isDirectory()) return dir;
      // A file: "gitdir: <main>/.git/worktrees/<name>" for a worktree, ".git/modules/..." for a submodule.
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (m) {
        const gitDir = norm(path.resolve(dir, m[1].trim()));
        const worktree = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitDir);
        return worktree ? worktree[1] : dir;
      }
    } catch { /* no .git here: look one folder up */ }
    const up = dir.replace(/\/[^/]*$/, '');
    if (up === dir || !up.includes('/')) break;
    dir = up;
  }
  return null;
}

/** { appId: main repo folder } for the apps whose folder resolves. */
function projectRoots(apps, now = Date.now()) {
  const out = {};
  for (const app of Array.isArray(apps) ? apps : []) {
    if (!app || !app.id || !app.cwd) continue;
    const key = norm(app.cwd);
    let hit = cache.get(key);
    if (!hit || now - hit.at > ttlFor(key, !!hit.root)) {
      hit = { root: mainRepoOf(key), at: now };
      cache.set(key, hit);
    }
    if (hit.root) out[app.id] = hit.root;
  }
  return out;
}

module.exports = { projectRoots, mainRepoOf, ttlFor, TTL_MS, SPREAD_MS };
