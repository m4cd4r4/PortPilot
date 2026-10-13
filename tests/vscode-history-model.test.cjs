/**
 * VS Code History view model (vscode-extension/src/historyModel.ts, portWait.ts):
 * day buckets across DST, newest-first order, the 200 cap, state words, search,
 * corrupt input, and the start-again port wait.
 * Requires the compiled modules (vscode-extension/out is committed; rebuild with
 * `npm run compile` in vscode-extension/ after editing the sources).
 * Run: node tests/vscode-history-model.test.cjs   (part of npm run test:unit)
 */
// Before any Date is built: both DST edges of 2026 fall in this zone.
process.env.TZ = 'America/New_York';

const assert = require('assert');
const net = require('net');
const hm = require('../vscode-extension/out/historyModel.js');
const pw = require('../vscode-extension/out/portWait.js');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); passed++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); failed++; }
}

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const run = (id, startedAt, over = {}) => ({
  id, appId: 'a1', appName: 'shop-web', cwd: 'C:/p/shop', command: 'npm run dev', port: 3005,
  url: 'http://localhost:3005/', startedAt: new Date(startedAt).toISOString(), stoppedAt: null,
  endedBy: null, exitCode: null, startedBy: { kind: 'human', surface: 'desktop' },
  git: null, page: null, pinned: false, ...over,
});
const closed = (id, startedAt, over = {}) => run(id, startedAt, { stoppedAt: new Date(startedAt).toISOString(), endedBy: 'stop', ...over });
const NOW = local(2026, 10, 13, 15, 0); // Tue 13 Oct 2026
const ids = (g) => g.entries.map((e) => e.run.id);

(async () => {
  await t('the test zone is in effect (otherwise the DST cases prove nothing)', () => {
    assert.notEqual(local(2026, 3, 7).getTimezoneOffset(), local(2026, 3, 9).getTimezoneOffset());
  });

  // ---- buckets ----
  await t('bucketOf: today, yesterday, dated days, Earlier', () => {
    assert.equal(hm.bucketOf(local(2026, 10, 13, 0, 1), NOW).label, 'Today');
    assert.equal(hm.bucketOf(local(2026, 10, 12, 23, 59), NOW).label, 'Yesterday');
    assert.equal(hm.bucketOf(local(2026, 10, 11), NOW).label, 'Sun 11 Oct');
    assert.equal(hm.bucketOf(local(2026, 10, 5), NOW).label, 'Mon 5 Oct'); // 7 dated days after yesterday
    assert.equal(hm.bucketOf(local(2026, 10, 4, 23, 59), NOW).label, 'Earlier');
  });

  await t('bucketOf: Earlier is collapsed, recent days are not', () => {
    assert.equal(hm.bucketOf(local(2026, 9, 1), NOW).collapsed, true);
    assert.equal(hm.bucketOf(local(2026, 10, 12), NOW).collapsed, false);
    assert.equal(hm.bucketOf(local(2026, 10, 8), NOW).key, '2026-10-08');
  });

  await t('bucketOf: a future or unparseable start does not throw or vanish', () => {
    assert.equal(hm.bucketOf(local(2026, 10, 14), NOW).label, 'Today');
    assert.equal(hm.bucketOf(new Date('nope'), NOW).label, 'Earlier');
  });

  await t('bucketOf: spring-forward (23h day) still counts calendar days', () => {
    // 23:30 EST on the 7th, noon EDT on the 8th: 12.5h apart, different days.
    assert.equal(hm.bucketOf(local(2026, 3, 7, 23, 30), local(2026, 3, 8, 12)).label, 'Yesterday');
    // 00:30 EST on the 8th to 00:10 EDT on the 9th is 23h40m, still a day apart.
    assert.equal(hm.bucketOf(local(2026, 3, 8, 0, 30), local(2026, 3, 9, 0, 10)).label, 'Yesterday');
    // 8th 03:30 EDT vs 9th 02:00 EDT: under 24h, different days.
    assert.equal(hm.bucketOf(local(2026, 3, 8, 3, 30), local(2026, 3, 9, 2)).label, 'Yesterday');
  });

  await t('bucketOf: fall-back (25h day) keeps one day per calendar day', () => {
    assert.equal(hm.bucketOf(local(2026, 11, 1, 0, 30), local(2026, 11, 1, 23, 45)).label, 'Today');
    assert.equal(hm.bucketOf(local(2026, 10, 31, 23, 30), local(2026, 11, 1, 23, 45)).label, 'Yesterday');
    // The window edge is counted in calendar days across the 25h Sunday, not in hours.
    assert.equal(hm.bucketOf(local(2026, 10, 24, 12), local(2026, 11, 2, 12)).label, 'Earlier');
    assert.equal(hm.bucketOf(local(2026, 10, 25, 12), local(2026, 11, 2, 12)).label, 'Sun 25 Oct');
  });

  // ---- ordering, grouping, cap ----
  await t('buildHistory: newest first inside day groups, groups in day order', () => {
    const runs = [
      closed('old', local(2026, 9, 1)),
      closed('y', local(2026, 10, 12, 9)),
      closed('t1', local(2026, 10, 13, 8)),
      closed('t2', local(2026, 10, 13, 14)),
      closed('d', local(2026, 10, 9, 10)),
    ];
    const { groups, shown } = hm.buildHistory(runs, { now: NOW });
    assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Fri 9 Oct', 'Earlier']);
    assert.deepEqual(ids(groups[0]), ['t2', 't1']);
    assert.equal(shown, 5);
  });

  await t('buildHistory: an unparseable startedAt sorts last and lands in Earlier', () => {
    const runs = [closed('bad', local(2026, 10, 13), { startedAt: 'garbage' }), closed('ok', local(2026, 10, 13, 9))];
    const { groups } = hm.buildHistory(runs, { now: NOW });
    assert.deepEqual(groups.map((g) => g.label), ['Today', 'Earlier']);
    assert.deepEqual(ids(groups[1]), ['bad']);
  });

  await t('buildHistory: caps at 200, keeping the newest', () => {
    const runs = [];
    for (let i = 0; i < 250; i++) runs.push(closed(`r${i}`, new Date(NOW.getTime() - i * 60000)));
    const { groups, shown, matched } = hm.buildHistory(runs, { now: NOW });
    const all = groups.flatMap((g) => g.entries.map((e) => e.run.id));
    assert.equal(shown, 200);
    assert.equal(matched, 250);
    assert.equal(all[0], 'r0');
    assert.equal(all[199], 'r199');
    assert.ok(!all.includes('r200'));
  });

  await t('buildHistory: does not mutate the input array', () => {
    const runs = [closed('a', local(2026, 10, 1)), closed('b', local(2026, 10, 13))];
    hm.buildHistory(runs, { now: NOW });
    assert.deepEqual(runs.map((r) => r.id), ['a', 'b']);
  });

  // ---- state ----
  await t('state: live needs an open run AND a listening port', () => {
    const open = run('o', local(2026, 10, 13, 9));
    const e = (listening) => hm.buildHistory([open], { now: NOW, listening }).groups[0].entries[0];
    assert.equal(e([3005]).state, 'live');
    assert.equal(e([3005]).live, true);
    assert.equal(e([4000]).state, 'unseen'); // open, nothing answering: its end was not seen
    assert.equal(e([4000]).live, false);
  });

  await t('state: stopped, crashed, ended-unseen words', () => {
    const [s, c, u] = hm.buildHistory([
      closed('s', local(2026, 10, 13, 9)),
      closed('c', local(2026, 10, 13, 10), { endedBy: 'crash', exitCode: 1 }),
      closed('u', local(2026, 10, 13, 11), { endedBy: 'unknown' }),
    ], { now: NOW }).groups[0].entries.reverse();
    assert.equal(s.state, 'stopped');
    assert.equal(s.stateWord, 'Stopped');
    assert.equal(c.state, 'crashed');
    assert.equal(c.stateWord, 'Crashed');
    assert.match(c.stateText, /exit 1/);
    assert.equal(u.state, 'unseen');
    assert.match(u.stateText, /end not seen/);
  });

  await t('state: a closed run is never live even when its port is listening', () => {
    const e = hm.buildHistory([closed('x', local(2026, 10, 13, 9))], { now: NOW, listening: [3005] }).groups[0].entries[0];
    assert.equal(e.live, false);
  });

  await t('liveRunIds: only the newest open run per port is live', () => {
    const a = run('a', local(2026, 10, 12, 9));
    const b = run('b', local(2026, 10, 13, 9));
    assert.deepEqual([...hm.liveRunIds([a, b], [3005])], ['b']);
    assert.deepEqual([...hm.liveRunIds([a, b], [])], []);
  });

  await t('entry: label, time and markers', () => {
    const [named, bare, det] = hm.buildHistory([
      run('n', local(2026, 10, 13, 9, 5), { pinned: true }),
      run('b', local(2026, 10, 13, 10), { appName: null, port: 8000 }),
      run('d', local(2026, 10, 13, 11), { detected: true, appName: 'python http.server', port: null, url: null }),
    ], { now: NOW }).groups[0].entries.reverse();
    assert.equal(named.label, 'shop-web');
    assert.equal(named.time, '09:05 · :3005');
    assert.equal(named.pinned, true);
    assert.equal(bare.label, 'localhost:8000');
    assert.equal(det.detected, true);
    assert.equal(det.time, '11:00');
    assert.equal(det.url, null);
  });

  // ---- search ----
  const corpus = [
    closed('r1', local(2026, 10, 13, 9), { appName: 'shop-web', port: 3005, page: { title: 'Checkout - Shop' }, git: { branch: 'feat/checkout', sha: '9c41e0a1234', subject: 'wip', dirty: false, files: [] } }),
    closed('r2', local(2026, 10, 13, 10), { appName: 'mockups', port: 8000, command: 'python -m http.server 8000', url: 'http://localhost:8000/' }),
    closed('r3', local(2026, 10, 13, 11), { appName: 'docs', port: 4173, detected: true }),
  ];
  const found = (q) => hm.buildHistory(corpus, { now: NOW, query: q }).groups.flatMap((g) => g.entries.map((e) => e.run.id)).sort();
  await t('search: name, port (with or without colon), title, branch, sha', () => {
    assert.deepEqual(found('mockups'), ['r2']);
    assert.deepEqual(found('3005'), ['r1']);
    assert.deepEqual(found(':8000'), ['r2']);
    assert.deepEqual(found('checkout'), ['r1']);
    assert.deepEqual(found('feat/checkout'), ['r1']);
    assert.deepEqual(found('9c41'), ['r1']);
  });
  await t('search: every word must hit; no match gives no groups; blank shows all', () => {
    assert.deepEqual(found('shop 3005'), ['r1']);
    assert.deepEqual(found('shop 8000'), []);
    assert.deepEqual(found('zzz'), []);
    assert.deepEqual(found('   '), ['r1', 'r2', 'r3']);
    assert.equal(hm.buildHistory(corpus, { now: NOW, query: 'zzz' }).groups.length, 0);
  });

  // ---- corrupt input ----
  await t('corrupt input: never throws, keeps what is readable', () => {
    for (const bad of [null, undefined, 'x', 42, {}, { runs: [] }, [], [null, 7, 'a', [], {}, { id: 5 }]]) {
      const r = hm.buildHistory(bad, { now: NOW, query: 'a', listening: [3005] });
      assert.deepEqual(r.groups, []);
    }
    const r = hm.buildHistory([null, { id: 'bare' }, { id: 'p', port: '3005', startedAt: 7, stoppedAt: {}, page: 'x', git: 5 }], { now: NOW });
    assert.equal(r.shown, 2);
    assert.equal(hm.tooltipLines(r.groups[0].entries[0]).length > 0, true);
  });

  // ---- start again ----
  await t('cannotStart: needs a folder and a start command', () => {
    assert.equal(hm.cannotStart({ id: 'a', cwd: 'C:/p', command: 'npm run dev' }), null);
    assert.match(hm.cannotStart({ id: 'a', command: 'npm run dev' }), /folder/);
    assert.match(hm.cannotStart({ id: 'a', cwd: 'C:/p' }), /command/);
  });
  await t('cannotStart: a detected run needs startCommand, not the process command line', () => {
    assert.match(hm.cannotStart({ id: 'd', detected: true, cwd: 'C:/p', command: 'node C:/p/node_modules/.bin/vite.js' }), /command/);
    assert.equal(hm.cannotStart({ id: 'd', detected: true, cwd: 'C:/p', startCommand: 'npm run dev' }), null);
  });
  await t('urlOf: recorded URL, else localhost on the port, else null', () => {
    assert.equal(hm.urlOf({ id: 'a', url: 'http://localhost:3000/app' }), 'http://localhost:3000/app');
    assert.equal(hm.urlOf({ id: 'a', port: 5173 }), 'http://localhost:5173/');
    assert.equal(hm.urlOf({ id: 'a' }), null);
  });

  // ---- tooltip ----
  await t('tooltipLines: title, URL, when, git, folder', () => {
    const e = hm.buildHistory([closed('r1', local(2026, 10, 13, 9), {
      page: { title: 'Checkout - Shop' }, cwd: 'C:/p/shop',
      git: { branch: 'feat/checkout', sha: '9c41e0a1234', dirty: false, files: [] },
    })], { now: NOW }).groups[0].entries[0];
    const text = hm.tooltipLines(e).join('\n');
    assert.match(text, /Title: Checkout - Shop/);
    assert.match(text, /URL: http:\/\/localhost:3005\//);
    assert.match(text, /When: Tue 13 Oct, 09:00/);
    assert.match(text, /feat\/checkout @ 9c41e0a/);
    assert.match(text, /Folder: C:\/p\/shop/);
  });

  // ---- port wait ----
  const listen = () => new Promise((resolve) => {
    const s = net.createServer((c) => c.end()).listen(0, '127.0.0.1', () => resolve(s));
  });
  await t('waitForPort: resolves true once the port answers', async () => {
    const probe = await listen();
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    let server;
    setTimeout(() => { server = net.createServer((c) => c.end()); server.listen(port, '127.0.0.1'); }, 300);
    const ok = await pw.waitForPort(port, { timeoutMs: 5000, intervalMs: 100 });
    await new Promise((r) => server.close(r));
    assert.equal(ok, true);
  });
  await t('waitForPort: false on timeout, and false at once when cancelled', async () => {
    const probe = await listen();
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    assert.equal(await pw.waitForPort(port, { timeoutMs: 400, intervalMs: 100 }), false);
    const t0 = Date.now();
    assert.equal(await pw.waitForPort(port, { timeoutMs: 5000, cancelled: () => true }), false);
    assert.ok(Date.now() - t0 < 500);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
