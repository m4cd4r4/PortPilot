/**
 * End-to-end "Re-run this version" against a throwaway git repo, with the real
 * git, npm, MCP register CLI, process manager and run history. Only Electron is
 * absent. APPDATA/HOME point at a temp dir, so the user's PortPilot config is
 * never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-rerun-'));
process.env.APPDATA = tmp;
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
const configDir = process.platform === 'win32'
  ? path.join(tmp, 'portpilot')
  : process.platform === 'darwin' ? path.join(tmp, 'Library', 'Application Support', 'portpilot') : path.join(tmp, '.config', 'portpilot');
fs.mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, 'portpilot-config.json');

const root = path.join(__dirname, '..');
const runHistory = require(path.join(root, 'src/core/runHistory.js'));
const { rerunVersion } = require(path.join(root, 'src/main/rerun.js'));
const { startApp, stopApp } = require(path.join(root, 'src/main/processManager.js'));
const { findAvailablePort } = require(path.join(root, 'src/main/portScanner.js'));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const get = (port) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve(body));
  }).on('error', reject);
});
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    try { return await fn(); } catch (err) { if (Date.now() > end) throw err; await new Promise((r) => setTimeout(r, 250)); }
  }
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function main() {
  const repo = path.join(tmp, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', scripts: {} }));
  execFileSync('npm', ['install', '--package-lock-only', '--silent'], { cwd: repo, shell: true, windowsHide: true });
  fs.writeFileSync(path.join(repo, 'server.js'),
    "const a = process.argv.indexOf('--port');\n"
    + "const port = a > -1 ? Number(process.argv[a + 1]) : Number(process.env.PORT);\n"
    + "const body = require('fs').readFileSync(__dirname + '/page.txt', 'utf8');\n"
    + "require('http').createServer((q, r) => r.end(body)).listen(port, '127.0.0.1');\n");
  fs.writeFileSync(path.join(repo, 'page.txt'), 'committed');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  const sha = git(repo, 'rev-parse', 'HEAD');

  // Dirty tree: one tracked edit and one untracked file.
  fs.writeFileSync(path.join(repo, 'page.txt'), 'dirty edit');
  fs.writeFileSync(path.join(repo, 'new-file.txt'), 'untracked');

  const origPort = await freePort();
  const cfg = { apps: [{ id: 'app_shop', name: 'shop', command: `node server.js --port ${origPort}`, cwd: repo, preferredPort: origPort }], settings: {}, groups: [] };
  fs.writeFileSync(configPath, JSON.stringify(cfg));

  const opened = runHistory.openRun(configPath, 'app_shop', { kind: 'human', surface: 'desktop' }, { port: origPort });
  await opened.done;
  const run = runHistory.readRuns(configPath).find((r) => r.id === opened.id);
  assert(run.git && run.git.snapshot, 'snapshot was captured');

  // The tree moves on: the dirty state is gone, only the snapshot has it.
  fs.writeFileSync(path.join(repo, 'page.txt'), 'later edit');
  fs.unlinkSync(path.join(repo, 'new-file.txt'));
  git(repo, 'commit', '-q', '-am', 'later');

  const store = { getApps: () => JSON.parse(fs.readFileSync(configPath, 'utf8')).apps };
  const stages = [];
  const res = await rerunVersion(run, { configStore: store, configPath, onProgress: (p) => stages.push(p.stage) }, {
    mcpEntry: () => path.join(root, 'mcp-server', 'index.js'),
    findAvailablePort,
  });
  assert.strictEqual(res.success, true, `re-run failed: ${JSON.stringify(res)}`);
  try {
    const wt = `${repo}-run-${run.id.replace(/^r_/, '')}`;
    assert.notStrictEqual(res.port, origPort, 'uses a different port');
    assert.strictEqual(git(wt, 'rev-parse', 'HEAD'), sha, 'worktree HEAD is the original commit');
    const status = git(wt, 'status', '--porcelain');
    assert(/^M page\.txt/m.test(status), `tracked edit is uncommitted: ${status}`);
    assert(/\?\? new-file\.txt/.test(status), `untracked file is back: ${status}`);
    assert.strictEqual(fs.readFileSync(path.join(wt, 'page.txt'), 'utf8'), 'dirty edit');
    assert.deepStrictEqual(stages.filter((s, i) => stages.indexOf(s) === i), ['checking', 'worktree', 'install', 'register', 'start', 'done']);

    assert.strictEqual(await waitFor(() => get(res.port)), 'dirty edit', 'serves the snapshot on the new port');

    const apps = store.getApps();
    const child = apps.find((a) => a.id === res.appId);
    assert.strictEqual(child.parentId, 'app_shop', 'nested under the original app');
    assert.strictEqual(child.preferredPort, res.port);
    assert(child.command.includes(`--port ${res.port}`), 'the --port flag was rewritten');
    assert(/^run \d{4}-\d{2}-\d{2}$/.test(child.branch), `branch label: ${child.branch}`);

    await runHistory.whenIdle();
    const rerunRecord = runHistory.readRuns(configPath).find((r) => r.appId === res.appId);
    assert(rerunRecord, 'a run record was opened for the re-run');
    assert.strictEqual(rerunRecord.rerunOf, run.id, 'record carries rerunOf');
    assert.strictEqual(rerunRecord.port, res.port);

    // A second press reuses the worktree and app: no duplicate registration.
    await stopApp(res.appId);
    const again = await rerunVersion(run, { configStore: store, configPath }, {
      mcpEntry: () => path.join(root, 'mcp-server', 'index.js'),
      findAvailablePort,
    });
    assert.strictEqual(again.success, true, JSON.stringify(again));
    assert.strictEqual(again.appId, res.appId, 'same app is reused');
    assert.strictEqual(store.getApps().filter((a) => a.parentId === 'app_shop').length, 1);
    await stopApp(again.appId);

    // Pressed while its re-run is up: same app, same port, nothing re-registered or restarted.
    const before = JSON.stringify(store.getApps());
    const up = await rerunVersion(run, { configStore: store, configPath }, {
      mcpEntry: () => path.join(root, 'mcp-server', 'index.js'),
      findAvailablePort,
      isRunning: () => true,
      startApp: async () => ({ success: false, error: 'App is already running' }),
    });
    assert.strictEqual(up.success, true, JSON.stringify(up));
    assert.strictEqual(up.appId, again.appId);
    assert.strictEqual(up.port, again.port, 'the running app keeps its port');
    assert.strictEqual(JSON.stringify(store.getApps()), before, 'config untouched');

    // Refusals name which thing is missing.
    const gone = await rerunVersion({ ...run, repoRoot: path.join(tmp, 'nope') }, { configStore: store, configPath }, {});
    assert.strictEqual(gone.code, 'repo-gone');
    const pruned = await rerunVersion({ ...run, git: { ...run.git, snapshot: { ref: 'refs/portpilot/runs/r_missing', commit: '0'.repeat(40) } } }, { configStore: store, configPath }, {});
    assert.strictEqual(pruned.code, 'ref-pruned');
    const nogit = await rerunVersion({ ...run, git: null }, { configStore: store, configPath }, {});
    assert.strictEqual(nogit.code, 'no-git');
  } finally {
    try { await stopApp(res.appId); } catch { /* already stopped */ }
  }
  console.log('rerun e2e: ok');
}

main().then(() => {
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked by a dying child */ } process.exit(0); }, 500);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
