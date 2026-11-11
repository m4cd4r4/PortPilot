/**
 * The main repo folder of each registered app, read from disk, for the Apps page's project groups
 * (src/core/appProjects.js). A linked worktree's `.git` is a file naming the main repo, so a repo
 * and its worktrees resolve to the same folder without running git.
 *
 * Answers are cached per folder: the Apps page asks on every refresh and a library of 170 apps is
 * 170 walks up the tree. A folder that is gone has no answer; the page then works from the path.
 */
const fs = require('fs');
const path = require('path');

const TTL_MS = 5 * 60 * 1000;
const MAX_UP = 12;
const cache = new Map(); // folder -> { root, at }

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

/** The main repo that holds `cwd`, or null when no `.git` is found above it. Never throws. */
function mainRepoOf(cwd) {
  let dir = norm(cwd);
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
    if (!hit || now - hit.at > TTL_MS) {
      hit = { root: mainRepoOf(key), at: now };
      cache.set(key, hit);
    }
    if (hit.root) out[app.id] = hit.root;
  }
  return out;
}

module.exports = { projectRoots, mainRepoOf, TTL_MS };
