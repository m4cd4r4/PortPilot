/**
 * Seeded history for the long-haul journey: two weeks of runs and browser sessions, written while
 * PortPilot is down, in the shape the app itself writes (src/core/runHistory.js, browserHistory.js).
 * Oldest first in the file, as the app appends.
 */
const crypto = require('crypto');

const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const SHOP_BRANCHES = ['main', 'feature/cart', 'fix/checkout'];

/**
 * n runs spread evenly from `days` ago to 30 minutes ago. Of every ten: four shop, two blog, two api,
 * two of a terminal server in the docs folder (detected, so History can start it again).
 * apps: { shop, blog, api } -> { id, port, cwd, command }; docs: { cwd, port, startCommand }.
 */
function seedRuns({ n, days, now = Date.now(), apps, docs }) {
  const first = now - days * DAY + 3600 * 1000;
  const step = (now - 30 * 60 * 1000 - first) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = Math.round(first + i * step);
    const slot = i % 10;
    const kind = slot < 4 ? 'shop' : slot < 6 ? 'blog' : slot < 8 ? 'api' : 'docs';
    const branch = kind === 'shop' ? SHOP_BRANCHES[Math.floor(i / 10) % 3] : kind === 'api' ? 'release/2.0' : 'main';
    const crash = i % 37 === 0;
    const base = kind === 'docs'
      ? { appId: 'det_docs_seed', appName: 'docs', cwd: docs.cwd, command: docs.startCommand, port: docs.port,
        startedBy: { kind: 'detected' }, detected: true, startCommand: docs.startCommand }
      : { appId: apps[kind].id, appName: kind, cwd: apps[kind].cwd, command: apps[kind].command, port: apps[kind].port,
        startedBy: { kind: 'human', surface: 'desktop' } };
    out.push({
      id: `r_seed_${String(i).padStart(4, '0')}`,
      ...base,
      repoRoot: null, relCwd: null,
      url: `http://localhost:${base.port}/`,
      startedAt: iso(at),
      stoppedAt: iso(at + 20 * 60 * 1000),
      endedBy: crash ? 'crash' : 'stop',
      exitCode: crash ? 1 : null,
      git: kind === 'docs' ? { branch: null, sha: null, subject: null, dirty: false, files: [], snapshot: null, skipped: 'not-a-repo' }
        : { branch, sha: sha(`${kind}${i}`), subject: `${kind} change ${i}`, dirty: false, files: [], snapshot: null, skipped: null },
      page: null,
      pinned: false,
    });
  }
  return out;
}

/** n closed browser sessions of one profile over `days`; the newest holds `lastTabs`. */
function seedBrowserRuns({ n, days, now = Date.now(), profile, port, site, lastTabs }) {
  const first = now - days * DAY + 3600 * 1000;
  const step = (now - 60 * 60 * 1000 - first) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = Math.round(first + i * step);
    out.push({
      id: `b_seed_${String(i).padStart(4, '0')}`,
      profile, port, browser: 'brave', mode: 'headless',
      startedBy: i % 5 === 0 ? { kind: 'agent', surface: 'mcp', sessionId: 'seed-0001' } : { kind: 'human', surface: 'desktop' },
      startedAt: iso(at),
      stoppedAt: iso(at + 15 * 60 * 1000),
      endedBy: { kind: 'human', surface: 'desktop' },
      tabs: i === n - 1 ? lastTabs : [{ url: `${site}/page-${i}`, title: `Page ${i}` }],
      sampledAt: iso(at + 15 * 60 * 1000),
    });
  }
  return out;
}

/** What runHistory.prune keeps after `added` is appended: oldest unpinned closed runs go first. */
function expectPrune(runs, added, max) {
  const sim = [...runs, added];
  for (let i = 0; i < sim.length && sim.length > max;) {
    if (sim[i].pinned || !sim[i].stoppedAt) i++; else sim.splice(i, 1);
  }
  return sim;
}

module.exports = { seedRuns, seedBrowserRuns, expectPrune, DAY };
