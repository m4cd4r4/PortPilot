/**
 * Unit tests for the MCP add_worktree logic (Wave 3, Slice 11).
 * Drives the pure helpers exported from mcp-server/index.js - no server, no IO.
 *
 * Run: node tests/mcp-worktree.test.mjs
 */
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { cmdSafe as pluginCmdSafe } from '../plugin/hooks/observe.mjs';
import { normPath, appAtCwd, cmdSafe, startRefusal, observedDuplicate,pickColor, resolveWorktreeGit, registerWorktree } from '../mcp-server/index.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.message); fail++; }
}

const NOW = '2026-06-30T00:00:00.000Z';
const git = (over = {}) => ({ branch: 'feat/x', mainWorktree: 'C:/repo/main', isWorktree: true, ...over });
const parentApp = () => ({ id: 'app_parent', name: 'MyProj', command: 'npm run dev', cwd: 'C:/repo/main', preferredPort: 3000 });

t('nests under parent matched by main-worktree cwd', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x' }, git(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.action, 'added');
  assert.equal(r.app.parentId, 'app_parent');
  assert.equal(r.app.branch, 'feat/x');
  assert.equal(r.app.command, 'npm run dev'); // inherited from parent
  assert.equal(r.app.name, 'MyProj');
  assert.equal(r.app.worktreePath, 'C:/repo/wt-x');
  assert.equal(config.apps.length, 2);
});

t('add_app observed: the app already at a cwd is found whatever its slashes or case', () => {
  const apps = [{ id: 'a', name: 'shop', cwd: 'I:\\Scratch\\Shop\\' }];
  assert.equal(appAtCwd(apps, 'i:/scratch/shop', 'win32').id, 'a');
  assert.equal(appAtCwd(apps, 'I:/Scratch/Shop/web', 'win32'), null);
});

t('add_app observed: appAtCwd folds case on Windows and macOS only', () => {
  const apps = [{ id: 'a', name: 'web', cwd: '/home/u/Web/' }];
  assert.equal(appAtCwd(apps, '/home/u/web', 'darwin').id, 'a');
  assert.equal(appAtCwd(apps, '/home/u/web', 'linux'), null);
  assert.equal(appAtCwd(apps, '/home/u/Web', 'linux').id, 'a');
});

t('add_app: no copy of an observed app, whether the second add says observed or not', () => {
  const apps = [{ id: 'o', name: 'pp-live-proj', cwd: 'C:/t/proj', command: 'npm run dev', registeredBy: 'observed' }, { id: 'm', name: 'web', cwd: 'C:/t/web', command: 'npm run dev' }];
  assert.equal(observedDuplicate(apps, { cwd: 'C:\\t\\proj', command: 'npm run dev' }, 'win32').id, 'o');
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/web', command: 'npm run dev', registeredBy: 'observed' }, 'win32').id, 'm');
  // A plain add of another command is the user's call.
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/proj', command: 'npm run storybook' }, 'win32'), null);
});

// tdd-guard:allow  (review round 5 fixes: one test per finding)
t('review 5 (M5): a plain add of the same cwd and command as a plain app returns it', () => {
  const apps = [{ id: 'm', name: 'web', cwd: 'C:/t/web', command: 'npm run dev' }, { id: 's', name: 'sb', cwd: 'C:/t/web', command: 'npm run storybook' }];
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/web', command: 'npm run dev' }, 'win32').id, 'm');
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/web', command: 'npm run storybook' }, 'win32').id, 's');
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/web', command: 'npm run preview' }, 'win32'), null);
});

t('review 5 (M5): a Git Bash /i/ path matches I:/ on Windows only', () => {
  const apps = [{ id: 'o', name: 'y', cwd: 'I:/Scratch/y', command: 'npm run dev', registeredBy: 'observed' }];
  assert.equal(observedDuplicate(apps, { cwd: '/i/Scratch/y', command: 'npm run dev', registeredBy: 'observed' }, 'win32').id, 'o');
  assert.equal(observedDuplicate(apps, { cwd: '/i/Scratch/y', command: 'npm run dev' }, 'win32').id, 'o');
  assert.equal(appAtCwd(apps, '/i/Scratch/y', 'linux'), null);
});

t('review 5 (M5): commands compare in cmd-safe form', () => {
  const apps = [{ id: 'o', name: 'y', cwd: 'C:/t/y', command: 'npm run dev > /tmp/dev.log 2>&1' }];
  assert.equal(observedDuplicate(apps, { cwd: 'C:/t/y', command: 'npm run dev' }, 'win32').id, 'o');
  const saved = [{ id: 'p', name: 'z', cwd: 'C:/t/z', command: 'npm run dev', env: { PORT: '4000' } }];
  assert.equal(observedDuplicate(saved, { cwd: 'C:/t/z', command: 'PORT=4000 npm run dev &' }, 'win32').id, 'p');
});

t('review 6 (M1): a plain add on another port or with other env is a second instance, not a duplicate', () => {
  const apps = [{ id: 'w', name: 'web', cwd: 'I:/x/web', command: 'npm run dev', preferredPort: 3000 }];
  assert.equal(observedDuplicate(apps, { cwd: 'I:/x/web', command: 'PORT=4000 npm run dev' }, 'win32'), null);
  assert.equal(observedDuplicate(apps, { cwd: 'I:/x/web', command: 'npm run dev', env: { PORT: '4000' }, preferredPort: 4000 }, 'win32'), null);
  assert.equal(observedDuplicate(apps, { cwd: 'I:/x/web', command: 'npm run dev', preferredPort: 4000 }, 'win32'), null);
  assert.equal(observedDuplicate(apps, { cwd: 'I:/x/web', command: 'npm run dev', preferredPort: 3000 }, 'win32').id, 'w');
});

t('review 6 (M2/L3/L4): cmdSafe keeps quoted > and <, splits VAR= by shell words, strips >& and | tee', () => {
  const cases = [
    ['npm run dev -- --title "a > b"', 'npm run dev -- --title "a > b"', {}],
    ['node -e "require(\'http\').createServer((q,r)=>r.end()).listen(3000)"', 'node -e "require(\'http\').createServer((q,r)=>r.end()).listen(3000)"', {}],
    ['VAR=a\\ b npm run dev', 'npm run dev', { VAR: 'a b' }],
    ['FOO=a"b c" npm run dev', 'npm run dev', { FOO: 'ab c' }],
    ['npm run dev >& log', 'npm run dev', {}],
    ['npm run dev 2>&1 | tee dev.log', 'npm run dev', {}],
    ['npm run dev && echo hi', 'npm run dev && echo hi', {}],
    ['npm run dev -- --port 3000>x.log', 'npm run dev -- --port 3000', {}],
  ];
  for (const [raw, command, env] of cases) {
    assert.deepStrictEqual(cmdSafe(raw), { command, env }, raw);
    assert.deepStrictEqual(pluginCmdSafe(raw), { command, env }, raw);
  }
  const obs = (command) => ({ id: 'o', name: 'y', command, registeredBy: 'observed' });
  assert.equal(startRefusal(obs('npm run dev -- --title "a > b"')), null);
  assert.match(startRefusal(obs("node -e 'a=>b'")), /< or > outside double quotes/);
});

t('review 5 (M3): cmdSafe matches the plugin\'s, and start_app refuses an observed app with a redirect or VAR=', () => {
  for (const raw of ['npm run dev > /tmp/dev.log 2>&1 &', 'PORT=4000 npm run dev', "A='x y' npm start", 'npx vite --port 3005 &> o.log', 'npm run dev -- --port 3005']) {
    assert.deepStrictEqual(cmdSafe(raw), pluginCmdSafe(raw), raw);
  }
  const obs = (command) => ({ id: 'o', name: 'y', command, registeredBy: 'observed' });
  assert.match(startRefusal(obs('npm run dev > /tmp/dev.log 2>&1')), /shell redirection.*update_app: command "npm run dev"\./);
  assert.match(startRefusal(obs('PORT=4000 npm run dev')), /command "npm run dev" and put \{"PORT":"4000"\} in the app's env/);
  assert.equal(startRefusal(obs('cd web && npm run dev')), null);
  // A plain app's command is the user's: start_app runs it as on master.
  assert.equal(startRefusal({ id: 'm', name: 'm', command: 'npm run dev > dev.log' }), null);
});

t('re-registering the same cwd updates and keeps the id', () => {
  const config = { apps: [parentApp()] };
  const r1 = registerWorktree(config, { path: 'C:/repo/wt-x', preferredPort: 3001 }, git(), NOW);
  const r2 = registerWorktree(config, { path: 'C:/repo/wt-x', preferredPort: 3002 }, git(), NOW);
  assert.equal(r2.action, 'updated');
  assert.equal(r2.app.id, r1.app.id);
  assert.equal(r2.app.preferredPort, 3002);
  assert.equal(config.apps.length, 2); // no duplicate
});

t('no registered parent -> standalone with a note', () => {
  const config = { apps: [] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x' }, git(), NOW);
  assert.equal(r.app.parentId, null);
  assert.ok(r.notes.some(n => /standalone/i.test(n)));
});

t('explicit parent by name links correctly', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x', parent: 'myproj' }, git({ mainWorktree: null }), NOW);
  assert.equal(r.app.parentId, 'app_parent');
});

t('explicit parent not found -> error', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x', parent: 'nope' }, git(), NOW);
  assert.equal(r.ok, false);
});

t('does not nest a worktree under itself', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/main' }, git({ isWorktree: false }), NOW);
  assert.equal(r.app.parentId, null);
});

t('port collision with the parent produces a note', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x', preferredPort: 3000 }, git(), NOW);
  assert.ok(r.notes.some(n => /collide/i.test(n)));
});

t('explicit branch overrides the git-detected branch', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x', branch: 'hotfix' }, git(), NOW);
  assert.equal(r.app.branch, 'hotfix');
});

t('missing git branch -> note and null branch', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x' }, git({ branch: null }), NOW);
  assert.equal(r.app.branch, null);
  assert.ok(r.notes.some(n => /branch/i.test(n)));
});

t('explicit colour (e.g. Peacock) is stored with colorSource', () => {
  const config = { apps: [parentApp()] };
  const r = registerWorktree(config, { path: 'C:/repo/wt-x', color: '#1857A4', colorSource: 'peacock' }, git(), NOW);
  assert.equal(r.app.color, '#1857A4');
  assert.equal(r.app.colorSource, 'peacock');
});

t('pickColor is deterministic and within the palette', () => {
  const c = pickColor('feat/x');
  assert.equal(c, pickColor('feat/x'));
  assert.match(c, /^#[0-9A-F]{6}$/i);
});

t('normPath canonicalises slashes and case', () => {
  assert.equal(normPath('C:\\Repo\\Main\\'), 'c:/repo/main');
});

// Real-git smoke: this repo is a git repo, so resolveWorktreeGit must read it.
t('resolveWorktreeGit reads a real repo', () => {
  const g = resolveWorktreeGit(path.resolve(process.cwd()));
  assert.ok(g.branch, 'branch detected');
  assert.ok(g.mainWorktree, 'main worktree detected');
});

// Real linked-worktree integration: build a throwaway repo + worktree on disk
// and confirm resolveWorktreeGit + registerWorktree handle the actual feature
// path (isWorktree true, main worktree != dir, parent matched by main cwd).
t('end-to-end: real linked worktree nests under its main repo', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-wt-')));
  const repo = path.join(base, 'repo');
  const wt = path.join(base, 'repo-feat');
  const g = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    fs.mkdirSync(repo);
    g('git init -b main', repo);
    g('git config user.email t@t.t', repo);
    g('git config user.name test', repo);
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    g('git add -A', repo);
    g('git commit -m init', repo);
    g(`git worktree add "${wt}" -b feat/test`, repo);

    const resolved = resolveWorktreeGit(wt);
    assert.equal(resolved.branch, 'feat/test');
    assert.equal(resolved.isWorktree, true);
    assert.equal(normPath(resolved.mainWorktree), normPath(repo));

    const config = { apps: [{ id: 'app_main', name: 'Repo', command: 'npm run dev', cwd: repo, preferredPort: 3000 }] };
    const r = registerWorktree(config, { path: wt, preferredPort: 3001 }, resolved, NOW);
    assert.equal(r.app.parentId, 'app_main');
    assert.equal(r.app.branch, 'feat/test');
    assert.equal(config.apps.length, 2);
  } finally {
    try { g(`git worktree remove "${wt}" --force`, repo); } catch { /* best effort */ }
    fs.rmSync(base, { recursive: true, force: true });
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
