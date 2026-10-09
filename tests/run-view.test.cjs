/**
 * History tab logic: filtering, state words, Re-run helpers, orphan sweep.
 * Run: node tests/run-view.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs and temp git repos only; never the real PortPilot config.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const view = require('../src/core/runView');
const rerun = require('../src/core/rerun');
const sweep = require('../src/core/runSweep');
const runHistory = require('../src/core/runHistory');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; }
  catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const run = (over = {}) => ({
  id: 'r_20261005T011204_7f3a', appId: 'a1', appName: 'shop-web', command: 'npm run dev -- --port 3005',
  port: 3005, startedAt: '2026-10-05T01:12:04.000Z', stoppedAt: '2026-10-05T03:40:51.000Z',
  endedBy: 'stop', exitCode: null, startedBy: { kind: 'human', surface: 'desktop' },
  git: { branch: 'feat/checkout', sha: '9c41e0a1234', subject: 'wip: checkout layout', dirty: true, files: ['src/pages/checkout.tsx', 'a.html'], snapshot: { ref: 'refs/portpilot/runs/r_x', commit: 'e02bd71' } },
  page: { title: 'Checkout - Shop', thumb: 'thumbs/r_20261005T011204_7f3a.jpg' }, pinned: false, ...over,
});

(async () => {
  // ---- filtering ----
  const runs = [
    run(),
    run({ id: 'r_2', appId: 'a2', appName: 'mockups', command: 'python -m http.server 8000', startedAt: '2026-10-04T13:03:00.000Z', git: null, page: { title: 'Directory listing for /' } }),
    run({ id: 'r_3', startedAt: '2026-10-07T22:00:00.000Z', git: { branch: 'main', sha: 'abc1234ffff', subject: 'init', dirty: false, files: [] } }),
  ];
  await t('filterRuns returns newest first', () => {
    assert.deepStrictEqual(view.filterRuns(runs).map((r) => r.id), ['r_3', 'r_20261005T011204_7f3a', 'r_2']);
  });
  await t('query hits file names, title, command and a sha prefix; every word must hit', () => {
    assert.deepStrictEqual(view.filterRuns(runs, { query: 'checkout' }).map((r) => r.id), ['r_3', 'r_20261005T011204_7f3a']);
    assert.strictEqual(view.filterRuns(runs, { query: 'directory listing' }).length, 1);
    assert.strictEqual(view.filterRuns(runs, { query: 'http.server' }).length, 1);
    assert.strictEqual(view.filterRuns(runs, { query: '9c41e0a' }).length, 1);
    assert.strictEqual(view.filterRuns(runs, { query: 'e0a1' }).length, 0, 'a sha only matches from its start');
    assert.strictEqual(view.filterRuns(runs, { query: 'checkout mockups' }).length, 0);
  });
  await t('app, branch and dirty-only filters', () => {
    assert.strictEqual(view.filterRuns(runs, { app: 'a2' }).length, 1);
    assert.strictEqual(view.filterRuns(runs, { branch: 'main' }).length, 1);
    assert.strictEqual(view.filterRuns(runs, { branch: 'feat' }).length, 0, 'branch is an exact pick, not a substring');
    assert.deepStrictEqual(view.filterRuns(runs, { dirtyOnly: true }).map((r) => r.id), ['r_20261005T011204_7f3a']);
  });
  await t('From / To are inclusive local calendar days', () => {
    const local = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
    const rs = [run({ id: 'a', startedAt: local(2026, 10, 1, 0) }), run({ id: 'b', startedAt: local(2026, 10, 8, 23) }), run({ id: 'c', startedAt: local(2026, 10, 9, 1) })];
    assert.deepStrictEqual(view.filterRuns(rs, { from: '2026-10-01', to: '2026-10-08' }).map((r) => r.id), ['b', 'a']);
    assert.deepStrictEqual(view.filterRuns(rs, { from: '2026-10-09' }).map((r) => r.id), ['c']);
  });
  await t('facets list distinct apps and branches, sorted', () => {
    const f = view.facets(runs);
    assert.deepStrictEqual(f.apps.map((a) => a.name), ['mockups', 'shop-web']);
    assert.deepStrictEqual(f.branches, ['feat/checkout', 'main']);
  });

  // ---- state words ----
  await t('state words follow the app rows: running, stopped, crashed with exit code', () => {
    assert.strictEqual(view.runStateOf(run({ stoppedAt: null, endedBy: null }), true).word, 'Running');
    assert.strictEqual(view.runStateOf(run(), false).word, 'Stopped');
    const crashed = view.runStateOf(run({ endedBy: 'crash', exitCode: 1 }), false);
    assert.strictEqual(crashed.text, '✕ Crashed · exit 1');
    assert.match(view.runStateOf(run({ endedBy: 'unknown' }), false).text, /Stopped · end not seen/);
  });
  await t('a closed run is never shown running', () => {
    assert.strictEqual(view.runStateOf(run(), false).state, 'stopped');
  });
  await t('rowThumbs: newest open run per app, only when it has a thumb', () => {
    const open = (id, appId, startedAt, thumb) => run({ id, appId, startedAt, stoppedAt: null, page: thumb ? { thumb } : null });
    const got = view.rowThumbs([
      open('r_old', 'a1', '2026-10-09T01:00:00Z', 'thumbs/r_old.jpg'),
      open('r_new', 'a1', '2026-10-09T02:00:00Z', null),            // newer run, capture pending: hide the old page
      open('r_two', 'a2', '2026-10-09T01:30:00Z', 'thumbs/r_two.jpg'),
      run({ id: 'r_closed', appId: 'a3', stoppedAt: '2026-10-09T03:00:00Z' }), // closed: never shown
    ]);
    assert.deepStrictEqual(got, { a2: { id: 'r_two', thumb: 'thumbs/r_two.jpg', port: 3005 } });
    assert.deepStrictEqual(view.rowThumbs(null), {});
  });
  await t('formatting: when, git line, footer', () => {
    assert.match(view.formatWhen(run()), /^\w{3} \d{1,2} \w{3}, \d\d:\d\d - (\w{3} \d{1,2} \w{3}, )?\d\d:\d\d$/);
    assert.match(view.formatWhen(run({ stoppedAt: null })), / -$/);
    assert.strictEqual(view.gitLine(run()), 'feat/checkout @ 9c41e0a +2');
    assert.strictEqual(view.gitLine(run({ git: null })), 'no git');
    assert.strictEqual(view.gitLine(run({ git: { branch: null, sha: 'abcdef1234', dirty: false, files: [] } })), 'detached @ abcdef1');
    assert.strictEqual(view.footerText({ runs: 312, bytes: 41 * 1048576, maxBytes: 150 * 1048576 }), '312 runs · 41 MB of 150 MB');
    assert.strictEqual(view.footerText({ runs: 1, bytes: 2048, maxBytes: 150 * 1048576 }), '1 run · 2 KB of 150 MB');
  });

  // ---- port rewrite ----
  await t('rewritePort changes --port, --port=, -p (for tools that take it) and PORT=', () => {
    assert.deepStrictEqual(rerun.rewritePort('npm run dev -- --port 3005', 3101), { command: 'npm run dev -- --port 3101', rewritten: true });
    assert.strictEqual(rerun.rewritePort('vite --port=5173 --host', 5200).command, 'vite --port=5200 --host');
    assert.strictEqual(rerun.rewritePort('next dev -p 3000', 3004).command, 'next dev -p 3004');
    assert.strictEqual(rerun.rewritePort('PORT=4000 node server.js', 4010).command, 'PORT=4010 node server.js');
    assert.strictEqual(rerun.rewritePort('cross-env PORT=4000 node server.js', 4010).command, 'cross-env PORT=4010 node server.js');
  });
  await t('rewritePort leaves a command with no port alone, and ignores -p for other tools', () => {
    assert.deepStrictEqual(rerun.rewritePort('npm run dev', 3101), { command: 'npm run dev', rewritten: false });
    assert.deepStrictEqual(rerun.rewritePort('python -m pip install -p 8', 3101), { command: 'python -m pip install -p 8', rewritten: false });
    assert.strictEqual(rerun.rewritePort('node server.js --portal 9', 3101).rewritten, false);
  });

  // ---- lockfile detection ----
  const has = (...files) => (p) => files.some((f) => p.replace(/\\/g, '/').endsWith(f));
  await t('detectInstall picks the lockfile install', () => {
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/package-lock.json')).cmd, 'npm ci');
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/pnpm-lock.yaml')).cmd, 'pnpm install --frozen-lockfile');
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/yarn.lock')).cmd, 'yarn install --frozen-lockfile');
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/yarn.lock', '/r/.yarnrc.yml')).cmd, 'yarn install --immutable');
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/bun.lockb')).cmd, 'bun install --frozen-lockfile');
  });
  await t('detectInstall finds a monorepo root lockfile and falls back to npm install', () => {
    const hit = rerun.detectInstall('/r', 'apps/web', has('/r/pnpm-lock.yaml'));
    assert.deepStrictEqual([hit.dir, hit.cmd], ['', 'pnpm install --frozen-lockfile']);
    const own = rerun.detectInstall('/r', 'apps/web', has('/r/apps/web/package-lock.json', '/r/pnpm-lock.yaml'));
    assert.strictEqual(own.dir, 'apps/web', 'the run folder wins over the root');
    assert.deepStrictEqual(rerun.detectInstall('/r', 'apps/web', has('/r/apps/web/package.json')), { dir: 'apps/web', cmd: 'npm install', lockfile: null });
    assert.strictEqual(rerun.detectInstall('/r', '', has('/r/main.py')), null);
  });

  // ---- refusals and paths ----
  await t('refusalFor names which thing is missing', () => {
    const ok = { repoExists: true, targetExists: true };
    const r = run({ repoRoot: 'I:/Scratch/shop' });
    assert.strictEqual(rerun.refusalFor(r, ok), null);
    assert.strictEqual(rerun.refusalFor(r, { ...ok, repoExists: false }).code, 'repo-gone');
    assert.match(rerun.refusalFor(r, { ...ok, repoExists: false }).message, /repo is gone: I:\/Scratch\/shop/);
    assert.strictEqual(rerun.refusalFor(r, { ...ok, targetExists: false }).code, 'ref-pruned');
    assert.strictEqual(rerun.refusalFor(run({ repoRoot: 'x', git: { sha: 'abc1234', snapshot: null } }), { ...ok, targetExists: false }).code, 'commit-gone');
    assert.strictEqual(rerun.refusalFor(run({ repoRoot: 'x', git: null }), ok).code, 'no-git');
  });
  await t('worktreePathFor is the sibling folder find_run also names', () => {
    assert.strictEqual(rerun.worktreePathFor(run({ repoRoot: 'I:/Scratch/shop' })), 'I:/Scratch/shop-run-20261005T011204_7f3a');
  });

  // ---- sweep plan (pure) ----
  await t('planSweep removes only unowned, old-enough thumbs and refs', () => {
    const H = 3600 * 1000;
    const plan = sweep.planSweep({
      runs: [{ id: 'r_a', page: { thumb: 'thumbs/r_a.jpg' } }],
      thumbFiles: [{ name: 'r_a.jpg', ageMs: 9 * H }, { name: 'r_gone.jpg', ageMs: 9 * H }, { name: 'r_new.jpg', ageMs: H / 4 }],
      refs: [
        { repoRoot: '/x', ref: 'refs/portpilot/runs/r_a', ageMs: 9 * H },
        { repoRoot: '/x', ref: 'refs/portpilot/runs/r_gone', ageMs: 9 * H },
        { repoRoot: '/x', ref: 'refs/portpilot/runs/r_fresh', ageMs: H / 4 },
        { repoRoot: '/x', ref: 'refs/heads/main', ageMs: 9 * H },
      ],
    });
    assert.deepStrictEqual(plan.thumbs, ['r_gone.jpg']);
    assert.deepStrictEqual(plan.refs, [{ repoRoot: '/x', ref: 'refs/portpilot/runs/r_gone' }]);
  });

  // ---- sweep against real git ----
  await t('sweep deletes an orphan snapshot ref and thumb, keeps the owned ones', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-sweep-'));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    git('add', '-A'); git('commit', '-q', '-m', 'one');
    const head = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/portpilot/runs/r_owned', head);
    git('update-ref', 'refs/portpilot/runs/r_orphan', head);

    const configPath = path.join(root, 'portpilot-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ apps: [{ id: 'a1', name: 'x', cwd: repo }], settings: {} }));
    const thumbs = path.join(root, 'history', 'thumbs');
    fs.mkdirSync(thumbs, { recursive: true });
    fs.writeFileSync(path.join(thumbs, 'r_owned.jpg'), 'x');
    fs.writeFileSync(path.join(thumbs, 'r_orphan.jpg'), 'x');
    fs.writeFileSync(path.join(root, 'history', 'runs.json'), JSON.stringify({ v: 1, runs: [
      { id: 'r_owned', appId: 'a1', repoRoot: repo.replace(/\\/g, '/'), startedAt: new Date().toISOString(), stoppedAt: new Date().toISOString(), page: { thumb: 'thumbs/r_owned.jpg' }, git: { snapshot: { ref: 'refs/portpilot/runs/r_owned' } } },
    ] }));

    const later = Date.now() + 2 * 3600 * 1000; // past the one-hour guard
    const done = await sweep.sweep(configPath, { now: later });
    assert.deepStrictEqual(done, { thumbs: 1, refs: 1 });
    assert.deepStrictEqual(fs.readdirSync(thumbs), ['r_owned.jpg']);
    assert.strictEqual(git('for-each-ref', '--format=%(refname)', 'refs/portpilot/runs/'), 'refs/portpilot/runs/r_owned');
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('sweepIfDue runs once, then waits a week; nothing younger than an hour goes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-sweepdue-'));
    const configPath = path.join(root, 'portpilot-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ apps: [], settings: {} }));
    const thumbs = path.join(root, 'history', 'thumbs');
    fs.mkdirSync(thumbs, { recursive: true });
    fs.writeFileSync(path.join(thumbs, 'r_fresh.jpg'), 'x');
    assert.deepStrictEqual(await sweep.sweepIfDue(configPath), { thumbs: 0, refs: 0 }, 'a thumb minutes old survives');
    assert.strictEqual(await sweep.sweepIfDue(configPath), null, 'second call inside the week does nothing');
    // With no runs.json at all nothing is deleted: an empty history owns no thumbs or refs to judge.
    assert.deepStrictEqual(await sweep.sweepIfDue(configPath, { now: Date.now() + 8 * 86400 * 1000 }), { thumbs: 0, refs: 0 });
    assert.ok(fs.existsSync(path.join(thumbs, 'r_fresh.jpg')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await t('historyStats counts runs and thumb bytes against the caps', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-stats-'));
    const configPath = path.join(root, 'portpilot-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ apps: [], settings: { historyMaxMB: 10 } }));
    fs.mkdirSync(path.join(root, 'history', 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'history', 'thumbs', 'a.jpg'), Buffer.alloc(5000));
    fs.writeFileSync(path.join(root, 'history', 'runs.json'), JSON.stringify({ v: 1, runs: [{ id: 'r_a' }, { id: 'r_b' }] }));
    const s = sweep.historyStats(configPath);
    assert.strictEqual(s.runs, 2);
    assert.ok(s.bytes > 5000 && s.bytes < 6000, `bytes ${s.bytes}`);
    assert.strictEqual(s.maxBytes, 10 * 1048576);
    assert.strictEqual(s.maxRuns, runHistory.DEFAULT_MAX_RUNS);
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
