/**
 * Run history records (src/core/runHistory.js, hooked in by configFile.record*).
 * Run: node tests/run-history.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs and temp git repos only; never the real PortPilot config.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const runHistory = require('../src/core/runHistory');
const configFile = require('../src/core/configFile');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-runhist-'));
let n = 0;

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}\n     ${err.stack || err.message}`);
    failed++;
  }
}

// A config dir holding one app, optionally rooted at `cwd`.
function setup(app = {}, settings = {}) {
  const dir = path.join(root, `case${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'portpilot-config.json');
  const full = { id: 'app1', name: 'shop-web', command: 'npm run dev', cwd: dir, preferredPort: 3005, ...app };
  fs.writeFileSync(configPath, JSON.stringify({ apps: [full], settings, groups: [] }));
  return { dir, configPath, app: full };
}
const runsOf = (configPath) => runHistory.readRuns(configPath);

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
// A repo with one commit holding src/app.txt and README.md.
function makeRepo(name = 'repo') {
  const dir = path.join(root, `${name}${++n}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'src', 'app.txt'), 'v1\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}
// Open a run for an app living in `cwd` and wait for the git patch.
async function runIn(cwd, settings) {
  const s = setup({ cwd }, settings);
  const { id, done } = runHistory.openRun(s.configPath, s.app.id, startedBy, {});
  await done;
  return { ...s, id, run: runsOf(s.configPath).find((r) => r.id === id) };
}
const startedBy = { kind: 'claude', surface: 'mcp', sessionId: 's1', at: '2026-10-05T01:12:04.118Z' };

(async () => {
  await t('openRun writes a record at once with the app, port, url and who started it', async () => {
    const { configPath, app } = setup();
    const { id } = runHistory.openRun(configPath, app.id, startedBy, { port: 3005 });
    const [run] = runsOf(configPath);
    assert.equal(run.id, id);
    assert.match(id, /^r_\d{8}T\d{6}_[0-9a-f]{8}$/);
    assert.equal(run.appId, 'app1');
    assert.equal(run.appName, 'shop-web');
    assert.equal(run.command, 'npm run dev');
    assert.equal(run.port, 3005);
    assert.equal(run.url, 'http://localhost:3005/');
    assert.deepEqual(run.startedBy, startedBy);
    assert.ok(run.startedAt);
    assert.equal(run.stoppedAt, null);
    assert.equal(run.pinned, false);
  });

  await t('closeRun stamps the newest open run of the app as stopped', async () => {
    const { configPath, app } = setup();
    const { id } = runHistory.openRun(configPath, app.id, startedBy, {});
    runHistory.closeRun(configPath, app.id, { endedBy: 'stop' });
    const [run] = runsOf(configPath);
    assert.equal(run.id, id);
    assert.equal(run.endedBy, 'stop');
    assert.equal(run.exitCode, null);
    assert.ok(Date.parse(run.stoppedAt) >= Date.parse(run.startedAt));
    // A second close with nothing open changes nothing.
    runHistory.closeRun(configPath, app.id, { endedBy: 'stop' });
    assert.equal(runsOf(configPath).length, 1);
  });

  await t('a start while the app has an open run closes the earlier run as unknown', async () => {
    const { configPath, app } = setup();
    const first = runHistory.openRun(configPath, app.id, startedBy, {});
    const second = runHistory.openRun(configPath, app.id, startedBy, {});
    const runs = runsOf(configPath);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].id, first.id);
    assert.equal(runs[0].endedBy, 'unknown');
    assert.ok(runs[0].stoppedAt);
    assert.equal(runs[1].id, second.id);
    assert.equal(runs[1].stoppedAt, null);
    // A crash then closes only the newest.
    runHistory.closeRun(configPath, app.id, { endedBy: 'crash', exitCode: 1 });
    const after = runsOf(configPath);
    assert.equal(after[1].endedBy, 'crash');
    assert.equal(after[1].exitCode, 1);
    assert.equal(after[0].endedBy, 'unknown');
  });

  await t('a dirty tree, untracked file included, is snapshotted and restores exactly; the real repo is untouched', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'v2 edited\n');
    fs.mkdirSync(path.join(repo, 'public'));
    fs.writeFileSync(path.join(repo, 'public', 'mock.html'), '<h1>mockup</h1>\n');
    fs.writeFileSync(path.join(repo, 'ignored.log'), 'x');
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', 'README.md'); // a staged no-op must not matter
    const statusBefore = git(repo, 'status', '--porcelain=v1', '-uall');
    const branchesBefore = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads');
    const indexBefore = fs.readFileSync(path.join(repo, '.git', 'index'));

    const { run, id } = await runIn(path.join(repo, 'src'));

    assert.equal(run.git.branch, 'main');
    assert.equal(run.git.sha, git(repo, 'rev-parse', 'HEAD'));
    assert.equal(run.git.subject, 'first');
    assert.equal(run.git.dirty, true);
    assert.ok(run.git.files.includes('src/app.txt') && run.git.files.includes('public/mock.html'));
    assert.equal(run.git.skipped, null);
    assert.equal(run.git.snapshot.ref, `refs/portpilot/runs/${id}`);
    const norm = (p) => fs.realpathSync.native(p).replace(/\\/g, '/').toLowerCase();
    assert.equal(norm(run.repoRoot), norm(repo));
    assert.equal(run.relCwd, 'src');

    // Restore: a worktree at the snapshot commit has the exact files.
    const restored = path.join(root, `restore${++n}`);
    git(repo, 'worktree', 'add', '--detach', restored, run.git.snapshot.ref);
    assert.equal(fs.readFileSync(path.join(restored, 'src', 'app.txt'), 'utf8'), 'v2 edited\n');
    assert.equal(fs.readFileSync(path.join(restored, 'public', 'mock.html'), 'utf8'), '<h1>mockup</h1>\n');
    assert.equal(fs.existsSync(path.join(restored, 'ignored.log')), false);

    // The user's index, working tree and branches never moved.
    assert.equal(git(repo, 'status', '--porcelain=v1', '-uall'), statusBefore);
    assert.equal(git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), branchesBefore);
    assert.ok(fs.readFileSync(path.join(repo, '.git', 'index')).equals(indexBefore));
    assert.equal(fs.readFileSync(path.join(repo, 'src', 'app.txt'), 'utf8'), 'v2 edited\n');
  });

  // tdd-guard:allow  (backfill: the snapshot guard paths are one function, written with the snapshot test above)
  await t('a clean tree stores no snapshot and no ref', async () => {
    const repo = makeRepo();
    const { run } = await runIn(repo);
    assert.equal(run.git.dirty, false);
    assert.equal(run.git.snapshot, null);
    assert.equal(run.git.skipped, null);
    assert.equal(run.git.sha, git(repo, 'rev-parse', 'HEAD'));
    assert.equal(git(repo, 'for-each-ref', 'refs/portpilot'), '');
  });

  await t('untracked files over 20 MB skip the snapshot with too-large and the run is still recorded', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'big.bin'), Buffer.alloc(21 * 1024 * 1024));
    const { run } = await runIn(repo);
    assert.equal(run.git.dirty, true);
    assert.equal(run.git.snapshot, null);
    assert.equal(run.git.skipped, 'too-large');
    assert.equal(git(repo, 'for-each-ref', 'refs/portpilot'), '');
  });

  await t('a large change to a TRACKED file also skips the snapshot (no repo growth per start)', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'db.sqlite'), Buffer.alloc(1024));
    git(repo, 'add', 'db.sqlite'); git(repo, 'commit', '-q', '-m', 'db');
    fs.writeFileSync(path.join(repo, 'db.sqlite'), Buffer.alloc(21 * 1024 * 1024, 1));
    const { run } = await runIn(repo);
    assert.equal(run.git.skipped, 'too-large');
    assert.equal(run.git.snapshot, null);
    assert.equal(run.git.dirty, true);
  });

  await t('every false spelling of the per-repo opt-out is honoured', async () => {
    for (const value of ['no', 'off', '0']) {
      const repo = makeRepo();
      fs.writeFileSync(path.join(repo, 'new.txt'), 'n');
      git(repo, 'config', 'portpilot.snapshots', value);
      assert.equal((await runIn(repo)).run.git.skipped, 'opted-out', value);
    }
  });

  await t('dropping many refs at once removes all of them without blocking the start', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'wip.txt'), 'w');
    const s = setup({ cwd: repo, id: 'a1' }, { historyMaxRuns: 1000 });
    for (let i = 0; i < 12; i++) await runHistory.openRun(s.configPath, 'a1', startedBy, {}).done;
    assert.equal(git(repo, 'for-each-ref', 'refs/portpilot').split('\n').length, 12);
    const cfg = JSON.parse(fs.readFileSync(s.configPath, 'utf8'));
    cfg.settings.historyMaxRuns = 2;
    fs.writeFileSync(s.configPath, JSON.stringify(cfg));
    const t0 = Date.now();
    const last = runHistory.openRun(s.configPath, 'a1', startedBy, {});
    assert.ok(Date.now() - t0 < 1000, 'openRun returned before the ref deletes');
    await last.done;
    await runHistory.whenIdle();
    assert.equal(runsOf(s.configPath).length, 2);
    assert.equal(git(repo, 'for-each-ref', 'refs/portpilot').split('\n').filter(Boolean).length, 2);
  });

  await t('a thumb path in runs.json that climbs out of history/ is never deleted by pruning', async () => {
    const s = setup({}, { historyMaxRuns: 1 });
    const outside = path.join(s.dir, 'precious.txt');
    fs.writeFileSync(outside, 'keep');
    const a = runHistory.openRun(s.configPath, 'app1', startedBy, {});
    runHistory.closeRun(s.configPath, 'app1', { endedBy: 'stop' });
    const data = JSON.parse(fs.readFileSync(path.join(runHistory.historyDirFor(s.configPath), 'runs.json'), 'utf8'));
    data.runs.find((r) => r.id === a.id).page = { thumb: '../precious.txt' };
    fs.writeFileSync(path.join(runHistory.historyDirFor(s.configPath), 'runs.json'), JSON.stringify(data));
    runHistory.openRun(s.configPath, 'app1', startedBy, {});
    assert.equal(runsOf(s.configPath).length, 1); // the first run was pruned
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
  });

  await t('an unborn HEAD skips the snapshot', async () => {
    const dir = path.join(root, `unborn${++n}`);
    fs.mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const { run } = await runIn(dir);
    assert.equal(run.git.skipped, 'unborn-head');
    assert.equal(run.git.snapshot, null);
    assert.ok(run.repoRoot);
  });

  await t('not a repo: git is null-state with skipped not-a-repo', async () => {
    const dir = path.join(root, `plain${++n}`);
    fs.mkdirSync(dir);
    const { run } = await runIn(dir);
    assert.equal(run.git.skipped, 'not-a-repo');
    assert.equal(run.repoRoot, null);
  });

  await t('opt-out: the global setting and the per-repo git config both fall back to no snapshot', async () => {
    const dirty = (repo) => fs.writeFileSync(path.join(repo, 'new.txt'), 'n');
    const a = makeRepo(); dirty(a);
    const viaSetting = (await runIn(a, { historySnapshots: false })).run;
    assert.equal(viaSetting.git.skipped, 'opted-out');
    assert.equal(viaSetting.git.dirty, true);
    assert.equal(viaSetting.git.snapshot, null);
    const b = makeRepo(); dirty(b);
    git(b, 'config', 'portpilot.snapshots', 'false');
    const viaRepo = (await runIn(b)).run;
    assert.equal(viaRepo.git.skipped, 'opted-out');
    assert.equal(git(b, 'for-each-ref', 'refs/portpilot'), '');
  });

  await t('a missing git still records the run', async () => {
    const repo = makeRepo();
    const savedPath = process.env.PATH;
    const empty = path.join(root, 'empty-path');
    fs.mkdirSync(empty, { recursive: true });
    process.env.PATH = empty;
    let out;
    try { out = await runIn(repo); } finally { process.env.PATH = savedPath; }
    assert.equal(out.run.git.skipped, 'git-missing');
    assert.equal(out.run.appId, 'app1');
    assert.equal(out.run.stoppedAt, null);
  });

  await t('pruning by count drops the oldest, keeps the newest, and deletes the dropped snapshot refs', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'wip.txt'), 'w');
    const s = setup({ cwd: repo, id: 'a1' }, { historyMaxRuns: 3 });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const { id, done } = runHistory.openRun(s.configPath, 'a1', startedBy, {});
      await done;
      ids.push(id);
    }
    await runHistory.whenIdle();
    assert.deepEqual(runsOf(s.configPath).map((r) => r.id), ids.slice(2));
    const refs = git(repo, 'for-each-ref', '--format=%(refname)', 'refs/portpilot').split('\n').filter(Boolean);
    assert.deepEqual(refs.sort(), ids.slice(2).map((id) => `refs/portpilot/runs/${id}`).sort());
  });

  await t('pruning by bytes counts runs.json plus thumbs and removes the dropped runs thumbs', async () => {
    const s = setup({}, { historyMaxMB: 0.2 });
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const { id, done } = runHistory.openRun(s.configPath, 'app1', startedBy, {});
      await done;
      const thumbs = path.join(runHistory.historyDirFor(s.configPath), 'thumbs');
      fs.mkdirSync(thumbs, { recursive: true });
      fs.writeFileSync(path.join(thumbs, `${id}.jpg`), Buffer.alloc(80 * 1024));
      runHistory.setThumb(s.configPath, id, `thumbs/${id}.jpg`);
      ids.push(id);
    }
    const kept = runsOf(s.configPath).map((r) => r.id);
    assert.ok(kept.length < 4 && kept.length >= 1, `kept ${kept.length}`);
    assert.deepEqual(kept, ids.slice(4 - kept.length));
    for (const id of ids.slice(0, 4 - kept.length)) {
      assert.equal(fs.existsSync(path.join(runHistory.historyDirFor(s.configPath), 'thumbs', `${id}.jpg`)), false);
    }
    assert.equal(fs.existsSync(path.join(runHistory.historyDirFor(s.configPath), 'thumbs', `${kept[kept.length - 1]}.jpg`)), true);
  });

  await t('a pinned run survives pruning; pins stop at 50', async () => {
    const s = setup({}, { historyMaxRuns: 2 });
    const first = runHistory.openRun(s.configPath, 'app1', startedBy, {});
    assert.equal(runHistory.pinRun(s.configPath, first.id, true).ok, true);
    for (let i = 0; i < 4; i++) runHistory.openRun(s.configPath, 'app1', startedBy, {});
    const ids = runsOf(s.configPath).map((r) => r.id);
    assert.equal(ids.length, 2); // pins count toward the cap: the pin and the newest run
    assert.equal(ids[0], first.id);

    const many = setup({}, { historyMaxRuns: 500 });
    const pinned = [];
    for (let i = 0; i < 51; i++) pinned.push(runHistory.openRun(many.configPath, 'app1', startedBy, {}).id);
    const results = pinned.map((id) => runHistory.pinRun(many.configPath, id, true));
    assert.equal(results.filter((r) => r.ok).length, 50);
    assert.equal(results[50].ok, false);
    assert.equal(results[50].reason, 'pin-limit');
    assert.equal(runHistory.pinRun(many.configPath, pinned[0], false).ok, true);
    assert.equal(runHistory.pinRun(many.configPath, pinned[50], true).ok, true);
  });

  await t('configFile.recordStart / recordCrash / recordStop feed the history', async () => {
    const s = setup();
    assert.equal(configFile.recordStart(s.configPath, 'app1', startedBy, { port: 3005 }), true);
    assert.equal(runsOf(s.configPath).length, 1);
    assert.equal(configFile.recordCrash(s.configPath, 'app1', 137, {}), true);
    let [run] = runsOf(s.configPath);
    assert.equal(run.endedBy, 'crash');
    assert.equal(run.exitCode, 137);
    configFile.recordStart(s.configPath, 'app1', startedBy, { port: 3005 });
    assert.equal(configFile.recordStop(s.configPath, 'app1'), true);
    run = runsOf(s.configPath)[1];
    assert.equal(run.endedBy, 'stop');
    await runHistory.whenIdle();
  });

  await t('a history that cannot be written never fails the start, stop or crash record', async () => {
    const s = setup();
    // history/ is a file, so every history write throws.
    fs.writeFileSync(runHistory.historyDirFor(s.configPath), 'not a directory');
    const realError = console.error;
    console.error = () => {};
    try {
      assert.equal(configFile.recordStart(s.configPath, 'app1', startedBy, { port: 3005 }), true);
      assert.equal(configFile.recordCrash(s.configPath, 'app1', 1, {}), true);
      assert.equal(configFile.recordStop(s.configPath, 'app1'), true);
    } finally { console.error = realError; }
    assert.deepEqual(configFile.readRuntime(s.configPath).apps, {});
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await runHistory.whenIdle();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp dir, swept by the OS */ }
  process.exit(failed ? 1 : 0);
})();
