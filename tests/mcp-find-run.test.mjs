/**
 * Unit tests for the MCP find_run logic (run history PR B1).
 * Drives the pure helpers exported from mcp-server/index.js - no server, no git.
 *
 * Run: node tests/mcp-find-run.test.mjs
 */
import assert from 'node:assert';
import { findRuns, rerunSteps, alreadyRunning } from '../mcp-server/index.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); fail++; }
}

const run = (id, over = {}) => ({
  id, appId: 'a1', appName: 'shop-web', cwd: 'C:/x/shop', repoRoot: 'C:/x/shop', relCwd: '',
  command: 'npm run dev', port: 3005, url: 'http://localhost:3005/',
  startedBy: { kind: 'claude', surface: 'mcp', sessionId: 's', at: '' },
  startedAt: '2026-10-05T01:00:00.000Z', stoppedAt: '2026-10-05T02:00:00.000Z', endedBy: 'stop', exitCode: null,
  git: { branch: 'main', sha: 'abc1234def', subject: 'first', dirty: false, files: [], snapshot: null, skipped: null },
  page: null, pinned: false, ...over,
});
const ids = (r) => r.runs.map((x) => x.id);

t('filters by app, branch, since/until and dirty_only; newest first; default limit 5, max 20', () => {
  const runs = [
    run('r1', { startedAt: '2026-10-01T00:00:00.000Z' }),
    run('r2', { appId: 'a2', appName: 'blog', startedAt: '2026-10-02T00:00:00.000Z' }),
    run('r3', { startedAt: '2026-10-03T00:00:00.000Z', git: { branch: 'feat/checkout', sha: 'f00', subject: 's', dirty: true, files: ['public/mock.html'], snapshot: null, skipped: null } }),
    run('r4', { startedAt: '2026-10-04T00:00:00.000Z' }),
  ];
  assert.deepEqual(ids(findRuns(runs, {})), ['r4', 'r3', 'r2', 'r1']);
  assert.deepEqual(ids(findRuns(runs, { app: 'blog' })), ['r2']);
  assert.deepEqual(ids(findRuns(runs, { app: 'a1' })), ['r4', 'r3', 'r1']);
  assert.deepEqual(ids(findRuns(runs, { branch: 'checkout' })), ['r3']);
  assert.deepEqual(ids(findRuns(runs, { dirty_only: true })), ['r3']);
  assert.deepEqual(ids(findRuns(runs, { since: '2026-10-02T00:00:00.000Z', until: '2026-10-03T12:00:00.000Z' })), ['r3', 'r2']);
  assert.deepEqual(ids(findRuns(runs, { limit: 2 })), ['r4', 'r3']);
  const many = Array.from({ length: 30 }, (_, i) => run(`m${i}`, { startedAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() }));
  assert.equal(findRuns(many, {}).runs.length, 5);
  assert.equal(findRuns(many, { limit: 99 }).runs.length, 20);
  assert.equal(findRuns(many, { limit: 99 }).count, 20);
});

t('a date-only since/until is a whole LOCAL day; total counts matches beyond the page', () => {
  const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
  const runs = [
    run('early', { startedAt: at(2026, 10, 5, 0, 5) }),
    run('late', { startedAt: at(2026, 10, 5, 23, 55) }),
    run('next', { startedAt: at(2026, 10, 6, 0, 5) }),
    run('bad', { startedAt: 'not-a-date' }),
  ];
  assert.deepEqual(ids(findRuns(runs, { since: '2026-10-05', until: '2026-10-05' })).sort(), ['early', 'late']);
  assert.deepEqual(ids(findRuns(runs, { until: '2026-10-05' })).sort(), ['early', 'late']);
  assert.deepEqual(ids(findRuns(runs, { since: '2026-10-06' })), ['next']);
  const many = Array.from({ length: 8 }, (_, i) => run(`m${i}`, { startedAt: at(2026, 10, 1, i) }));
  const page = findRuns(many, {});
  assert.equal(page.count, 5);
  assert.equal(page.total, 8);
});

t('alreadyRunning: a listening preferredPort means no second start; no port or free port means start', () => {
  const app = { name: 'shop', preferredPort: 3005 };
  const up = alreadyRunning(app, () => ({ pid: 1 }));
  assert.equal(up.success, true);
  assert.equal(up.alreadyRunning, true);
  assert.equal(alreadyRunning(app, () => null), null);
  assert.equal(alreadyRunning({ name: 'x' }, () => ({ pid: 1 })), null);
});

t('rerunSteps: no cwd does not emit cd "null"', () => {
  const r = rerunSteps(run('r1', { cwd: null, git: null }));
  assert.ok(r.steps.every((s) => !s.includes('null')), r.steps.join(' | '));
});

t('query matches app name, branch, page title, file names, command, commit subject and sha prefix; all terms must hit', () => {
  const runs = [
    run('r1', { appName: 'storefront' }),
    run('r2', { git: { branch: 'feat/Checkout', sha: '9c41e0aaa', subject: 'wip: layout', dirty: true, files: ['src/pages/cart.tsx'], snapshot: null, skipped: null } }),
    run('r3', { page: { title: 'Pricing - Shop', thumb: null } }),
    run('r4', { git: { branch: 'main', sha: 'beef000', subject: 'fix hero spacing', dirty: true, files: ['public/mock/checkout-v2.html'], snapshot: null, skipped: null } }),
    run('r5', { command: 'pnpm storybook --port 6006' }),
  ];
  assert.deepEqual(ids(findRuns(runs, { query: 'store' })), ['r1']);
  assert.deepEqual(ids(findRuns(runs, { query: 'CHECKOUT' })).sort(), ['r2', 'r4']);
  assert.deepEqual(ids(findRuns(runs, { query: 'pricing' })), ['r3']);
  assert.deepEqual(ids(findRuns(runs, { query: 'hero spacing' })), ['r4']);
  assert.deepEqual(ids(findRuns(runs, { query: 'storybook' })), ['r5']);
  assert.deepEqual(ids(findRuns(runs, { query: '9c41e0a' })), ['r2']);
  assert.deepEqual(ids(findRuns(runs, { query: 'checkout layout' })), ['r2']);
  assert.deepEqual(ids(findRuns(runs, { query: 'nothing-like-this' })), []);
  // A hex-looking term only matches the START of a sha, not the middle.
  assert.deepEqual(ids(findRuns(runs, { query: 'e0aaa' })), []);
});

t('rerunSteps: worktree at the snapshot ref, lockfile install, then the start command in the same sub-folder', () => {
  const r = run('r_20261005T011204_7f3a', {
    repoRoot: 'I:/Scratch/shop', cwd: 'I:/Scratch/shop/apps/web', relCwd: 'apps/web', command: 'npm run dev -- --port 3005',
    git: { branch: 'feat/x', sha: 'abc1234def', subject: 's', dirty: true, files: ['a'], snapshot: { ref: 'refs/portpilot/runs/r_20261005T011204_7f3a', commit: 'c0ffee', bytes: 1 }, skipped: null },
  });
  const has = (...names) => (p) => names.some((n) => p.replace(/\\/g, '/').endsWith(n));
  const steps = rerunSteps(r, has('apps/web/package-lock.json')).steps;
  assert.deepEqual(steps, [
    'git -C "I:/Scratch/shop" worktree add --detach "I:/Scratch/shop-run-20261005T011204_7f3a" refs/portpilot/runs/r_20261005T011204_7f3a',
    'cd "I:/Scratch/shop-run-20261005T011204_7f3a/apps/web" && npm ci',
    'cd "I:/Scratch/shop-run-20261005T011204_7f3a/apps/web" && npm run dev -- --port 3005',
  ]);
  assert.equal(rerunSteps(r, has('pnpm-lock.yaml')).steps[1].endsWith('pnpm install --frozen-lockfile'), true);
  // No lockfile and no package.json: nothing to install.
  assert.equal(rerunSteps(r, () => false).steps.length, 2);
  assert.equal(rerunSteps(r, has('apps/web/package.json')).steps[1].endsWith('npm install'), true);
});

t('rerunSteps: a clean run restores the commit; a dirty run with no snapshot says what was lost; no repo starts in place', () => {
  const clean = run('r_20261005T011204_aaaa', { repoRoot: 'C:/x/shop', relCwd: '', git: { branch: 'main', sha: 'abc1234def', subject: 's', dirty: false, files: [], snapshot: null, skipped: null } });
  const c = rerunSteps(clean, () => false);
  assert.match(c.steps[0], /worktree add --detach .* abc1234def$/);
  assert.equal(c.note, undefined);

  const lost = run('r_20261005T011204_bbbb', { repoRoot: 'C:/x/shop', relCwd: '', git: { branch: 'main', sha: 'abc1234def', subject: 's', dirty: true, files: ['a'], snapshot: null, skipped: 'too-large' } });
  assert.match(rerunSteps(lost, () => false).note, /too-large/);

  const plain = run('r_20261005T011204_cccc', { repoRoot: null, cwd: 'C:/x/plain', relCwd: null, git: { branch: null, sha: null, subject: null, dirty: false, files: [], snapshot: null, skipped: 'not-a-repo' } });
  const p = rerunSteps(plain, () => false);
  assert.deepEqual(p.steps, ['cd "C:/x/plain" && npm run dev']);
  assert.match(p.note, /not a git repository/i);

  const pending = run('r_20261005T011204_dddd', { repoRoot: null, git: null });
  assert.match(rerunSteps(pending, () => false).note, /not captured/i);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
