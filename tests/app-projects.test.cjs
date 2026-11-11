// Apps page at scale: apps group by project folder (a repo and its worktrees are one project),
// and apps not run in 30 days fold away. Paths here are made up.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectsOf, sections, lastRunByApp, mergeLastRun, loadLastRun, pruneOpen, olderIds, OLDER_DAYS } = require('../src/core/appProjects.js');
const { projectRoots, mainRepoOf, ttlFor, TTL_MS, SPREAD_MS } = require('../src/main/projectRoots.js');

const app = (id, cwd, extra = {}) => ({ id, name: id, cwd, ...extra });
const card = (a, state = 'stopped') => ({ app: a, state });

// ---- projectsOf -------------------------------------------------------------------------------
const apps = [
  app('web', 'D:\\Code\\shop\\apps\\web'),
  app('api', 'D:/Code/shop/apps/api'),
  app('wt', 'D:/Code/shop-checkout/apps/web'),            // a worktree still on disk: the host names its main repo
  app('gone', 'D:/Code/shop-old-fix/apps/web'),           // a worktree whose folder was removed
  app('child', 'D:/Elsewhere/tmp', { parentId: 'web' }),  // registered as a copy of web
  app('admin', 'D:/Code/shop-admin'),                     // its own repo, beside shop
  app('blog', 'D:/Code/blog/site'),                       // no repo found; under a folder that holds repos
  app('blogwt', 'D:/Code/blog-redesign'),                 // sibling of a guessed folder
  app('lone', 'E:/misc/thing'),
  app('nocwd', ''),
];
const roots = { web: 'D:/Code/shop', api: 'D:/Code/shop', wt: 'D:/Code/shop', admin: 'D:/Code/shop-admin' };
const p = projectsOf(apps, roots);
assert.strictEqual(p.web.key, 'd:/code/shop');
assert.strictEqual(p.web.name, 'shop', 'the name is the folder as written');
assert.strictEqual(p.api.key, p.web.key, 'backslashes and case do not split a project');
assert.strictEqual(p.wt.key, p.web.key, 'a worktree on disk joins its main repo');
assert.strictEqual(p.gone.key, p.web.key, 'a removed worktree joins the repo it sat beside');
assert.strictEqual(p.child.key, p.web.key, 'a copy follows its parent app');
assert.strictEqual(p.admin.key, 'd:/code/shop-admin', 'a repo of its own is not folded into its neighbour');
assert.strictEqual(p.blog.key, 'd:/code/blog', 'with no repo, the folder under the directory that holds repos');
assert.strictEqual(p.blog.name, 'blog');
assert.strictEqual(p.blogwt.key, p.blog.key, 'a guessed folder joins the sibling it is named after');
assert.strictEqual(p.lone.key, 'e:/misc/thing', 'nothing known: the folder itself');
assert.strictEqual(p.nocwd, undefined, 'no folder, no project');

// Without the host's reading (the folders are gone, or the host is older) paths still decide.
const bare = projectsOf([app('a', 'D:/Code/shop'), app('b', 'D:/Code/shop-fix'), app('c', 'D:/Code/shop/web')], {});
assert.strictEqual(bare.b.key, bare.a.key, 'sibling join works on paths alone');
assert.notStrictEqual(bare.c.key, bare.a.key, 'a folder inside another is not joined');
// An app registered at a parent directory must not swallow the projects under it.
const parentDir = projectsOf([app('top', 'D:/Code'), app('x', 'D:/Code/one'), app('y', 'D:/Code/two')], {});
assert.strictEqual(new Set([parentDir.top.key, parentDir.x.key, parentDir.y.key]).size, 3);
// With no repo read from disk, a worktree-shaped pair names the repo: the same folders under `shop`
// and `shop-fix`. Everything inside `shop` then joins it (F122).
const nested = projectsOf([app('n1', 'D:/Code/shop/apps/web'), app('n2', 'D:/Code/shop/apps/api'), app('n3', 'D:/Code/shop-fix/apps/web'), app('n4', 'D:/Code/mail/apps/web')], {});
assert.strictEqual(nested.n1.key, 'd:/code/shop', 'the pair names the repo');
assert.strictEqual(nested.n2.key, nested.n1.key, 'a folder inside the inferred repo joins it');
assert.strictEqual(nested.n3.key, nested.n1.key, 'the worktree joins it');
assert.strictEqual(nested.n4.key, 'd:/code/mail/apps/web', 'no pair, no guess: the folder itself');
// A sibling of a sibling ends at the same project (F126).
const chain = projectsOf([app('c1', 'D:/Code/a'), app('c2', 'D:/Code/a-b'), app('c3', 'D:/Code/a-b-c')], {});
assert.strictEqual(new Set([chain.c1.key, chain.c2.key, chain.c3.key]).size, 1, 'a, a-b and a-b-c are one project');
// ... but a repo read from disk is never folded into its neighbour, and keeps its own worktrees.
const chainRoot = projectsOf([app('c1', 'D:/Code/a'), app('c2', 'D:/Code/a-b'), app('c3', 'D:/Code/a-b-c')], { c2: 'D:/Code/a-b' });
assert.strictEqual(chainRoot.c2.key, 'd:/code/a-b');
assert.strictEqual(chainRoot.c3.key, 'd:/code/a-b');
// Lower-casing can change a string's length ("İ" becomes two code units): the folder is still cut at a slash (F131).
const turkish = projectsOf([app('t1', 'D:/İİİ/shop'), app('t2', 'D:/İİİ/blog/site')], { t1: 'D:/İİİ/shop' });
assert.strictEqual(turkish.t2.name, 'blog', 'the name is a whole folder name');
// A big library is worked out in one pass, not app by app (F129): 5,000 apps took about 4 s before.
const many = [];
for (let i = 0; i < 5000; i++) many.push(app(`m${i}`, `D:/Code/repo-${i % 700}${i % 3 ? '' : '-wt'}/apps/a${i % 5}`));
const manyRoots = {};
for (let i = 0; i < 5000; i += 2) manyRoots[`m${i}`] = `D:/Code/repo-${i % 700}`;
const t0 = Date.now();
projectsOf(many, manyRoots);
assert.ok(Date.now() - t0 < 1500, `5,000 apps in ${Date.now() - t0} ms`);
// A parent loop ends.
const loop = projectsOf([app('l1', 'D:/a', { parentId: 'l2' }), app('l2', 'D:/b', { parentId: 'l1' })], {});
assert.ok(loop.l1.key && loop.l2.key);
assert.deepStrictEqual(projectsOf(undefined, undefined), {});

// ---- sections ---------------------------------------------------------------------------------
const named = (id, name, cwd, extra = {}) => ({ id, name, cwd, ...extra });
const lib = [
  named('s1', 'Shop Web', 'D:/Code/shop/web'),
  named('s2', 'Shop API', 'D:/Code/shop/api'),
  named('s3', 'Shop Web (fix)', 'D:/Code/shop-fix/web'),
  named('b1', 'Blog', 'D:/Code/blog'),
  named('b2', 'Blog (redesign)', 'D:/Code/blog-redesign'),   // one row with Blog: not worth a heading
  named('m1', 'Mail', 'D:/Code/mail'),
  named('z1', 'Zed One', 'D:/Code/zed/one'),
  named('z2', 'Zed Two', 'D:/Code/zed/two'),
  named('h1', 'Hand', 'D:/Code/shop/hand', { group: 'g1' }),
];
const libRoots = { s1: 'D:/Code/shop', s2: 'D:/Code/shop', b1: 'D:/Code/blog', m1: 'D:/Code/mail', z1: 'D:/Code/zed', z2: 'D:/Code/zed', h1: 'D:/Code/shop' };
const proj = projectsOf(lib, libRoots);
const cardsOf = (state = {}) => lib.map((a) => card(a, state[a.id] || 'stopped'));
const groups = [{ id: 'g1', name: 'Clients' }];

let secs = sections(cardsOf(), groups, proj);
assert.deepStrictEqual(secs.map((s) => `${s.kind}:${s.name}:${s.cards.length}`), ['group:Clients:1', 'project:shop:3', 'project:zed:2', 'rest:Other:3']);
assert.strictEqual(secs.reduce((n, s) => n + s.cards.length, 0), lib.length, 'every app is in exactly one section');
assert.deepStrictEqual(secs[3].cards.map((c) => c.app.id), ['b1', 'b2', 'm1'], 'single apps keep the order they came in');
assert.ok(secs.every((s) => s.active === false));

// Something running lifts its section to the top.
secs = sections(cardsOf({ z2: 'running' }), groups, proj);
assert.deepStrictEqual(secs.map((s) => s.name), ['zed', 'Clients', 'shop', 'Other']);
assert.strictEqual(secs[0].active, true);

secs = sections(cardsOf({ m1: 'crashed' }), groups, proj);
assert.strictEqual(secs[0].name, 'Other', 'the single apps lead too when one of them is up or crashed');

// An app moved by hand leaves its project; a group named like a project takes the whole project.
assert.ok(!sections(cardsOf(), groups, proj).find((s) => s.name === 'shop').cards.some((c) => c.app.id === 'h1'));
secs = sections(cardsOf(), [{ id: 'g1', name: 'Shop' }], proj);
assert.deepStrictEqual(secs.map((s) => `${s.kind}:${s.name}:${s.cards.length}`), ['group:Shop:4', 'project:zed:2', 'rest:Other:3']);

// A group id that no longer exists does not lose the app.
secs = sections([card(named('q', 'Q', 'D:/Code/q', { group: 'deleted' }))], [], {});
assert.deepStrictEqual(secs.map((s) => `${s.name}:${s.cards.length}`), ['All apps:1'], 'one section is "All apps", not "Other"');
assert.deepStrictEqual(sections([], [], {}), []);
assert.deepStrictEqual(sections(undefined, undefined, undefined), []);

// ---- older ------------------------------------------------------------------------------------
const DAY = 86400000;
const now = Date.parse('2026-11-11T12:00:00Z');
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();
assert.strictEqual(OLDER_DAYS, 30);
const last = lastRunByApp([
  { appId: 'r1', startedAt: iso(40), stoppedAt: iso(39) },
  { appId: 'r1', startedAt: iso(50), stoppedAt: iso(49) },
  { appId: 'r2', startedAt: iso(31), stoppedAt: iso(29) },   // stopped inside the window
  { appId: 'r3', startedAt: iso(2), stoppedAt: null },
  { startedAt: iso(1) },                                     // a run of no registered app
  null,
]);
assert.strictEqual(last.r1, now - 39 * DAY, 'the latest run wins, and a stop counts');
assert.strictEqual(last.r2, now - 29 * DAY);
const old = olderIds([
  card({ id: 'r1', name: 'r1', createdAt: iso(90) }),
  card({ id: 'r2', name: 'r2', createdAt: iso(90) }),
  card({ id: 'r3', name: 'r3', createdAt: iso(90) }),
  card({ id: 'never-old', name: 'never-old', createdAt: iso(45) }),
  card({ id: 'never-new', name: 'never-new', createdAt: iso(3) }),
  card({ id: 'unknown', name: 'unknown' }),
  card({ id: 'up', name: 'up', createdAt: iso(90) }, 'running'),
  card({ id: 'dead', name: 'dead', createdAt: iso(90) }, 'crashed'),
  card({ id: 'edge', name: 'edge', createdAt: iso(30) }),
], last, now);
assert.deepStrictEqual([...old].sort(), ['edge', 'never-old', 'r1'], 'stopped, and neither run nor added in 30 days');
assert.strictEqual(olderIds([card({ id: 'r1', name: 'r1', createdAt: iso(90) })], last, now, 60).size, 0, 'the window is a parameter');
assert.strictEqual(olderIds(undefined, undefined, now).size, 0);
// Copies of one app go together: an old copy of an app that is still in use stays in its row.
const copies = (mainState, mainAdded) => olderIds([
  card({ id: 'main', name: 'Site (main)', createdAt: iso(mainAdded) }, mainState),
  card({ id: 'copy', name: 'Site (main)', parentId: 'main', branch: 'fix', createdAt: iso(60) }),
], {}, now);
assert.strictEqual(copies('running', 60).size, 0, 'a copy of a running app is not old');
assert.strictEqual(copies('stopped', 3).size, 0, 'nor a copy of a recent one');
assert.deepStrictEqual([...copies('stopped', 60)].sort(), ['copy', 'main'], 'all copies old: the whole row folds');

// ---- last run, remembered ---------------------------------------------------------------------
const regd = [{ id: 'r1' }, { id: 'r2' }, { id: 'kept' }];
const merged = mergeLastRun([{ appId: 'r1', startedAt: iso(5), stoppedAt: iso(4) }], { r1: 1, kept: 77, gone: 88 }, regd);
assert.deepStrictEqual(merged, { r1: now - 4 * DAY, kept: 77 }, 'the later time wins, a remembered time is kept, an unregistered app is dropped');
// Before the app list lands there is nothing to prune against: saving then would wipe the memory (F123).
assert.strictEqual(mergeLastRun([], { kept: 77 }, []), null, 'no apps: nothing to save');
assert.strictEqual(mergeLastRun([], { kept: 77 }, undefined), null);
(async () => {
  assert.deepStrictEqual(await loadLastRun(async () => ({ runs: [{ appId: 'r2', startedAt: iso(1) }] }), () => ({ kept: 77 }), () => regd), { r2: now - DAY, kept: 77 });
  assert.strictEqual(await loadLastRun(async () => { throw new Error('history is down'); }, () => ({ kept: 77 }), () => regd), null, 'a failed read saves nothing');
  assert.strictEqual(await loadLastRun(async () => null, () => ({ kept: 77 }), () => []), null);
})().catch((e) => { console.error(e); process.exit(1); });

// ---- which sections are open, remembered ------------------------------------------------------
assert.deepStrictEqual(pruneOpen({ 'p:d:/code/shop': true, 'p:d:/code/gone': false, g1: false }, ['p:d:/code/shop', 'g1', '']), { 'p:d:/code/shop': true, g1: false }, 'a section that no longer exists is forgotten (F127)');
assert.deepStrictEqual(pruneOpen(null, ['x']), {});

// ---- projectRoots (disk) ----------------------------------------------------------------------
// Expiry is spread out, so a big library is not re-read in one tick, and a missing folder is looked
// for again sooner than a found one (F125).
const spread = new Set();
for (let i = 0; i < 60; i++) {
  const t = ttlFor(`D:/Code/repo-${i}`, true);
  assert.ok(t >= TTL_MS && t <= TTL_MS + SPREAD_MS, `found: ${t}`);
  spread.add(t);
  assert.ok(ttlFor(`D:/Code/repo-${i}`, false) < TTL_MS / 2, 'missing: sooner');
}
assert.ok(spread.size > 30, `60 folders expire at ${spread.size} different times`);
assert.strictEqual(ttlFor('D:/Code/repo-1', true), ttlFor('D:/Code/repo-1', true), 'the same folder, the same time');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-roots-'));
try {
  const mk = (...parts) => { const d = path.join(tmp, ...parts); fs.mkdirSync(d, { recursive: true }); return d; };
  const main = mk('shop');
  mk('shop', '.git', 'worktrees', 'fix');
  const sub = mk('shop', 'apps', 'web');
  const wt = mk('shop-fix');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'fix')}\n`);
  const wtSub = mk('shop-fix', 'apps', 'web');
  const plain = mk('plain', 'site');
  const fwd = (s) => s.replace(/\\/g, '/');
  assert.strictEqual(mainRepoOf(sub), fwd(main), 'walks up to the folder holding .git');
  assert.strictEqual(mainRepoOf(wtSub), fwd(main), 'a worktree names its main repo');
  // The temp dir may itself sit inside a repo on a developer machine: only claim "none" when it does not.
  if (!mainRepoOf(tmp)) assert.strictEqual(mainRepoOf(plain), null, 'no .git above: no answer');
  // A folder that is gone has no answer: walking up from it would land in whatever repo sits above,
  // which need not be its own (F124).
  assert.strictEqual(mainRepoOf(path.join(main, 'removed', 'deep')), null, 'a missing folder inside a repo is not that repo');
  assert.strictEqual(mainRepoOf(path.join(tmp, 'missing', 'deep')), null, 'a missing folder never throws');
  assert.strictEqual(mainRepoOf(path.join(main, '.git', 'worktrees', 'fix', 'nofile.txt')), null);
  const got = projectRoots([{ id: 'a', cwd: sub }, { id: 'b', cwd: wtSub }, { id: 'c' }, null]);
  assert.deepStrictEqual({ a: got.a, b: got.b }, { a: fwd(main), b: fwd(main) });
  assert.strictEqual(got.c, undefined);
  // Cached: the answer holds after the folder goes, until the cache ages out.
  const t1 = Date.now();
  fs.rmSync(wt, { recursive: true, force: true });
  assert.strictEqual(projectRoots([{ id: 'b', cwd: wtSub }], t1).b, fwd(main));
  assert.strictEqual(projectRoots([{ id: 'b', cwd: wtSub }], t1 + TTL_MS + SPREAD_MS + 1000).b, undefined, 'and is read again once it ages out: the folder is gone, so no answer');
  // A folder that was missing and has come back is found again within a minute, not five.
  const late = path.join(tmp, 'late');
  assert.strictEqual(projectRoots([{ id: 'l', cwd: late }], t1).l, undefined);
  mk('late', '.git');
  assert.strictEqual(projectRoots([{ id: 'l', cwd: late }], t1 + 1000).l, undefined, 'still cached a second later');
  assert.strictEqual(projectRoots([{ id: 'l', cwd: late }], t1 + 60 * 1000).l, fwd(late), 'looked for again within a minute');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('app-projects: project folders, sections, the 30-day fold and repo roots on disk ok');
