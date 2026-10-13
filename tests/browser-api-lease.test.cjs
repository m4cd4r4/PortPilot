/**
 * Browser tools: the session lease (IN_USE, takeover, dead owner, "any") and the history tool
 * (start and stop recorded, browser_history, Open again). Run: node tests/browser-api-lease.test.cjs
 * (part of npm run test:unit)
 *
 * The fake machine from tests/browser-world.cjs and real heartbeat files in a throwaway config dir:
 * no browser is launched, and the real PortPilot config is never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const api = require('../src/core/browserApi');
const hist = require('../src/core/browserHistory');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-blease-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const A = 'aaaa1111-2222-3333-4444-555555555555';
const B = 'bbbb1111-2222-3333-4444-555555555555';

async function setup(names = ['shop-a']) {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const ports = {};
  for (const name of names) {
    ports[name] = await freePort();
    bp.addProfile(cfg, { name, port: ports[name], browser: 'brave', url: 'https://example.test/' });
  }
  const w = world();
  const ctx = (surface = 'mcp') => ({ surface, deps: w.deps, pollMs: 5, sampler: false });
  /** A session heartbeat, as the plugin's mod writes it every 15 s. */
  const beat = (id, ageMs = 1000) => {
    const dir = path.join(path.dirname(cfg), 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ sessionId: id, cwd: 'C:/x', at: Date.now() - ageMs }));
  };
  const call = (tool, args, surface) => api.call(cfg, tool, args, ctx(surface));
  const histFile = () => hist.listSessions(cfg, { limit: 50 }).entries;
  return { cfg, ports, w, ctx, beat, call, histFile };
}

(async () => {
  console.log('\n=== browser api: lease ===\n');

  await t('a profile started by session A is refused to live session B: IN_USE names the owner and start time, and nothing starts', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    const a = await call('start_browser', { name: 'shop-a', sessionId: A });
    assert.strictEqual(a.success, true);
    assert.strictEqual(a.claim.sessionId, A);
    const b = await call('start_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(b.success, false);
    assert.strictEqual(b.code, 'IN_USE');
    assert.match(b.error, /"shop-a" is in use by claude aaaa, who started it/);
    assert.strictEqual(b.leasedTo.session, 'aaaa');
    assert.ok(b.leasedTo.since);
    assert.match(b.action, /list_browser_profiles/);
    assert.match(b.action, /free: true/);
    assert.match(b.action, /"any"/);
    assert.match(b.action, /takeover:true/);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('the owner may start again (reuse) and stop; a stranger may not stop', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const again = await call('start_browser', { name: 'shop-a', sessionId: A });
    assert.strictEqual(again.success, true);
    assert.strictEqual(again.already, true);
    const refused = await call('stop_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(refused.success, false);
    assert.strictEqual(refused.code, 'IN_USE');
    assert.match(refused.action, /Leave it running/);
    assert.match(refused.action, /takeover:true/);
    assert.strictEqual(w.killed.length, 0);
    const list = await call('list_browser_profiles', {});
    assert.strictEqual(list.profiles[0].state, 'up', 'still running');
    const stopped = await call('stop_browser', { name: 'shop-a', sessionId: A });
    assert.strictEqual(stopped.success, true);
    assert.strictEqual(stopped.state, 'down');
    await w.cleanup();
  });

  await t('takeover:true lets B start and stop a profile A holds, moves the lease, and says so', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const took = await call('start_browser', { name: 'shop-a', sessionId: B, takeover: true });
    assert.strictEqual(took.success, true);
    assert.strictEqual(took.already, true);
    assert.strictEqual(took.claim.sessionId, B);
    assert.match(took.takeoverNote, /Took "shop-a" over from claude aaaa/);
    assert.match(took.takeoverNote, /tell the user/);
    const aNow = await call('stop_browser', { name: 'shop-a', sessionId: A });
    assert.strictEqual(aNow.code, 'IN_USE', 'the old owner is now the stranger');
    const stop = await call('stop_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(stop.success, true);
    await w.cleanup();
  });

  await t('stop with takeover:true works for a stranger and carries a note', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const r = await call('stop_browser', { name: 'shop-a', sessionId: B, takeover: true });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.state, 'down');
    assert.match(r.takeoverNote, /claude aaaa was using/);
    await w.cleanup();
  });

  await t('a dead owner frees the profile: B may start it and takes the claim over', async () => {
    const { call, beat, w, cfg } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    beat(A, 5 * 60000); // A's session ended minutes ago: its heartbeat is stale
    const list = await call('list_browser_profiles', {});
    assert.strictEqual(list.profiles[0].leasedTo, null);
    assert.strictEqual(list.profiles[0].free, true);
    const b = await call('start_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(b.success, true);
    assert.strictEqual(b.already, true);
    assert.strictEqual(b.claim.sessionId, B, 'the claim passes to the session that asked');
    assert.strictEqual(b.claimNote, undefined);
    const stored = JSON.parse(fs.readFileSync(api.claimsPathFor(cfg), 'utf8')).profiles['shop-a'];
    assert.strictEqual(stored.sessionId, B);
    await w.cleanup();
  });

  await t('a dead owner does not block stop either', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    beat(A, 5 * 60000);
    const r = await call('stop_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(r.success, true);
    await w.cleanup();
  });

  await t('callers with no sessionId are never refused (a person in the desktop app, a harness without the plugin)', async () => {
    const { call, beat, w } = await setup();
    beat(A);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const human = await call('start_browser', { name: 'shop-a', agent: 'PortPilot desktop' }, 'desktop');
    assert.strictEqual(human.success, true);
    assert.strictEqual(human.claim.sessionId, A, 'the claim stays with A');
    assert.match(human.claimNote, /not blocked/i);
    const stop = await call('stop_browser', { name: 'shop-a', agent: 'PortPilot desktop' }, 'desktop');
    assert.strictEqual(stop.success, true);
    await w.cleanup();
  });

  await t('a profile started by a caller with no session is no lease: a session may use it as before', async () => {
    const { call, beat, w } = await setup();
    beat(B);
    await call('start_browser', { name: 'shop-a', agent: 'planner' });
    const b = await call('start_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(b.success, true);
    assert.strictEqual(b.claim.by, 'planner', 'not taken over');
    assert.match(b.claimNote, /planner/);
    await w.cleanup();
  });

  await t('a leftover claim on a browser that died is no lease', async () => {
    const { call, beat, w, ports } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    await w.drop(ports['shop-a']); // the browser dies outside PortPilot; A's session is still live
    const b = await call('start_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(b.success, true);
    assert.strictEqual(b.already, false);
    assert.strictEqual(b.claim.sessionId, B);
    await w.cleanup();
  });

  await t('two sessions asking for a stopped profile at the same moment: one wins, the other gets IN_USE, one browser starts', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    const [ra, rb] = await Promise.all([
      call('start_browser', { name: 'shop-a', sessionId: A }),
      call('start_browser', { name: 'shop-a', sessionId: B }),
    ]);
    const wins = [ra, rb].filter((r) => r.success);
    const loses = [ra, rb].filter((r) => !r.success);
    assert.strictEqual(wins.length, 1, JSON.stringify([ra, rb]));
    assert.strictEqual(loses[0].code, 'IN_USE');
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('a failed launch releases the reservation', async () => {
    const { call, beat, w, cfg, ctx } = await setup();
    beat(A); beat(B);
    w.neverListens = true;
    const failedStart = await api.call(cfg, 'start_browser', { name: 'shop-a', sessionId: A }, { ...ctx(), timeoutMs: 50 });
    assert.strictEqual(failedStart.success, false);
    assert.notStrictEqual(failedStart.code, 'IN_USE');
    const claims = fs.existsSync(api.claimsPathFor(cfg)) ? JSON.parse(fs.readFileSync(api.claimsPathFor(cfg), 'utf8')).profiles : {};
    assert.strictEqual(claims['shop-a'], undefined, 'no stale reservation');
    w.neverListens = false;
    const b = await call('start_browser', { name: 'shop-a', sessionId: B });
    assert.strictEqual(b.success, true);
    await w.cleanup();
  });

  console.log('\n=== browser api: leasedTo, free and "any" ===\n');

  await t('list_browser_profiles adds leasedTo and free to every row', async () => {
    const { call, beat, w } = await setup(['shop-a', 'shop-b', 'shop-c']);
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    await call('start_browser', { name: 'shop-b', agent: 'planner' }); // no session: advisory only
    const list = await call('list_browser_profiles', { sessionId: B });
    const row = (name) => list.profiles.find((p) => p.name === name);
    assert.strictEqual(row('shop-a').free, false);
    assert.strictEqual(row('shop-a').leasedTo.by, 'claude aaaa');
    assert.strictEqual(row('shop-a').leasedTo.session, 'aaaa');
    assert.strictEqual(row('shop-a').mine, undefined);
    assert.strictEqual(row('shop-b').free, false, 'somebody opened it: not free to take');
    assert.strictEqual(row('shop-b').leasedTo, null);
    assert.strictEqual(row('shop-c').free, true);
    assert.strictEqual(row('shop-c').leasedTo, null);
    const mine = await call('list_browser_profiles', { sessionId: A });
    assert.strictEqual(mine.profiles.find((p) => p.name === 'shop-a').mine, true);
    await w.cleanup();
  });

  await t('name "any" gives a session a stopped free profile, skipping ones in use', async () => {
    const { call, beat, w } = await setup(['shop-a', 'shop-b']);
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const r = await call('start_browser', { name: 'any', sessionId: B });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.name, 'shop-b');
    assert.strictEqual(r.picked, true);
    assert.strictEqual(r.claim.sessionId, B);
    await w.cleanup();
  });

  await t('name "any" again returns the profile the session already holds, not a second one', async () => {
    const { call, beat, w } = await setup(['shop-a', 'shop-b']);
    beat(A);
    const first = await call('start_browser', { name: 'any', sessionId: A });
    const second = await call('start_browser', { name: 'ANY', sessionId: A });
    assert.strictEqual(first.name, second.name);
    assert.strictEqual(second.already, true);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('no name with free:true is the same as "any"', async () => {
    const { call, beat, w } = await setup(['shop-a']);
    beat(A);
    const r = await call('start_browser', { sessionId: A, free: true });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.name, 'shop-a');
    const bad = await call('start_browser', { sessionId: A });
    assert.strictEqual(bad.code, 'BAD_ARGS');
    await w.cleanup();
  });

  await t('"any" with every profile in use: NO_FREE_PROFILE says what to do', async () => {
    const { call, beat, w } = await setup(['shop-a']);
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const r = await call('start_browser', { name: 'any', sessionId: B });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.code, 'NO_FREE_PROFILE');
    assert.match(r.action, /takeover:true/);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('"any" prefers a stopped profile over taking one whose owner is gone, and takes the latter when it must', async () => {
    const { call, beat, w } = await setup(['shop-a', 'shop-b']);
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    beat(A, 5 * 60000);
    const r = await call('start_browser', { name: 'any', sessionId: B });
    assert.strictEqual(r.name, 'shop-b', 'a stopped one first');
    beat('cccc-3333');
    const r2 = await call('start_browser', { name: 'any', sessionId: 'cccc-3333' });
    assert.strictEqual(r2.name, 'shop-a', 'nothing stopped is left, so the one whose owner is gone');
    assert.strictEqual(r2.claim.sessionId, 'cccc-3333');
    await w.cleanup();
  });

  await t('a profile literally named "any" is started by that name', async () => {
    const { call, beat, w } = await setup(['any', 'shop-b']);
    beat(A);
    const r = await call('start_browser', { name: 'any', sessionId: A });
    assert.strictEqual(r.name, 'any');
    assert.strictEqual(r.picked, undefined);
    await w.cleanup();
  });

  await t('"any" never picks a profile whose port another program holds', async () => {
    const { call, beat, w, ports } = await setup(['shop-a', 'shop-b']);
    beat(A);
    await w.foreign(ports['shop-a'], { pid: 777, processName: 'node.exe', commandLine: 'node dev-server.js' });
    const r = await call('start_browser', { name: 'any', sessionId: A });
    assert.strictEqual(r.name, 'shop-b');
    assert.strictEqual(w.killed.length, 0);
    await w.cleanup();
  });

  console.log('\n=== browser api: history ===\n');

  await t('start and stop each leave one history entry with who, when and the tabs open at stop', async () => {
    const { call, beat, w, histFile } = await setup();
    beat(A);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    let [e] = histFile();
    assert.strictEqual(e.profile, 'shop-a');
    assert.strictEqual(e.stoppedAt, null);
    assert.strictEqual(e.startedBy.kind, 'claude');
    assert.strictEqual(e.startedBy.surface, 'mcp');
    assert.strictEqual(e.startedBy.sessionId, A);
    assert.strictEqual(e.browser, 'brave');
    assert.deepStrictEqual(e.tabs.map((x) => x.url), ['https://example.test/']);
    await call('stop_browser', { name: 'shop-a', sessionId: A });
    const all = histFile();
    assert.strictEqual(all.length, 1);
    e = all[0];
    assert.ok(e.stoppedAt);
    assert.strictEqual(e.endedBy.sessionId, A);
    assert.deepStrictEqual(e.tabs.map((x) => x.url), ['https://example.test/']);
    await w.cleanup();
  });

  await t('a desktop start is recorded as you (human, desktop)', async () => {
    const { call, w, histFile } = await setup();
    await call('start_browser', { name: 'shop-a', agent: 'PortPilot desktop' }, 'desktop');
    assert.strictEqual(histFile()[0].startedBy.kind, 'human');
    assert.strictEqual(histFile()[0].startedBy.surface, 'desktop');
    await w.cleanup();
  });

  await t('starting an already-running profile twice records one session; one up with no record gets one', async () => {
    const { call, cfg, w, histFile } = await setup();
    await call('start_browser', { name: 'shop-a', agent: 'planner' });
    await call('start_browser', { name: 'shop-a', agent: 'planner' });
    assert.strictEqual(histFile().length, 1);
    fs.rmSync(hist.historyPathFor(cfg)); // as if it had been started before history existed
    await call('start_browser', { name: 'shop-a', agent: 'late' });
    assert.strictEqual(histFile().length, 1);
    assert.strictEqual(histFile()[0].startedBy.label, 'planner', 'the claim says who really started it');
    await w.cleanup();
  });

  await t('a refused start or stop records nothing', async () => {
    const { call, beat, w, histFile } = await setup();
    beat(A); beat(B);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    await call('start_browser', { name: 'shop-a', sessionId: B });
    await call('stop_browser', { name: 'shop-a', sessionId: B });
    const all = histFile();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].stoppedAt, null);
    await w.cleanup();
  });

  await t('browser_history lists newest first with tabs, and filters by profile, since and limit', async () => {
    const { call, w } = await setup(['shop-a', 'shop-b']);
    await call('start_browser', { name: 'shop-a', agent: 'x' });
    await call('stop_browser', { name: 'shop-a', agent: 'x' });
    await call('start_browser', { name: 'shop-b', agent: 'x' });
    await call('stop_browser', { name: 'shop-b', agent: 'x' });
    await call('start_browser', { name: 'shop-a', agent: 'x' });
    const all = await call('browser_history', {});
    assert.strictEqual(all.success, true);
    assert.strictEqual(all.total, 3);
    assert.strictEqual(all.count, 3);
    assert.strictEqual(all.sessions[0].profile, 'shop-a');
    assert.strictEqual(all.sessions[0].running, true);
    assert.strictEqual(all.sessions[0].tabs[0].url, 'https://example.test/');
    assert.ok(all.sessions[0].id.startsWith('b_'));
    assert.strictEqual((await call('browser_history', { profile: 'shop-a' })).total, 2);
    assert.strictEqual((await call('browser_history', { limit: 1 })).sessions.length, 1);
    assert.strictEqual((await call('browser_history', { since: '1h' })).total, 3);
    assert.strictEqual((await call('browser_history', { since: '2999-01-01' })).count, 1, 'only the one still open');
    await w.cleanup();
  });

  await t('browser_history: limit defaults to 10, is capped at 50, and bad arguments are BAD_ARGS', async () => {
    const { call, cfg, w } = await setup();
    fs.mkdirSync(path.dirname(hist.historyPathFor(cfg)), { recursive: true });
    const runs = Array.from({ length: 70 }, (_, i) => ({ id: `b_${i}`, profile: 'shop-a', startedAt: new Date(Date.now() - i * 1000).toISOString(), stoppedAt: new Date().toISOString(), tabs: [] }));
    fs.writeFileSync(hist.historyPathFor(cfg), JSON.stringify({ v: 1, runs }));
    assert.strictEqual((await call('browser_history', {})).count, 10);
    assert.strictEqual((await call('browser_history', { limit: 500 })).count, 50);
    assert.strictEqual((await call('browser_history', { limit: 500 })).total, 70);
    for (const args of [{ limit: 0 }, { limit: 'many' }, { limit: 1.5 }, { since: 'a while ago' }, { profile: 5 }]) {
      const r = await call('browser_history', args);
      assert.strictEqual(r.code, 'BAD_ARGS', JSON.stringify(args));
    }
    await w.cleanup();
  });

  await t('the HTTP surface serves the same tool', async () => {
    const { call, w } = await setup();
    const r = await call('browser_history', {}, 'http');
    assert.strictEqual(r.success, true);
    assert.ok(api.TOOL_NAMES.includes('browser_history'));
    await w.cleanup();
  });

  console.log('\n=== browser api: Open again ===\n');

  const reopenSetup = async () => {
    const s = await setup();
    const opened = [];
    s.opened = opened;
    s.w.deps.openTab = async (port, url) => { opened.push({ port, url }); return true; };
    return s;
  };
  const seed = (cfg, tabs, profile = 'shop-a') => {
    fs.mkdirSync(path.dirname(hist.historyPathFor(cfg)), { recursive: true });
    fs.writeFileSync(hist.historyPathFor(cfg), JSON.stringify({ v: 1, runs: [{
      id: 'b_seed', profile, port: 1, browser: 'brave', mode: 'headless', startedBy: null,
      startedAt: '2026-10-12T00:00:00.000Z', stoppedAt: '2026-10-12T01:00:00.000Z', endedBy: null, tabs,
    }] }));
  };

  await t('Open again starts the profile and opens the past http(s) tabs on its own port, skipping one already open', async () => {
    const { cfg, w, ports, opened } = await reopenSetup();
    seed(cfg, [
      { url: 'https://example.test/', title: 'Start (already open after start)' },
      { url: 'https://shop.test/admin', title: 'Admin' },
      { url: 'http://localhost:3000/', title: 'App' },
    ]);
    const r = await api.reopen(cfg, 'b_seed', { deps: w.deps, pollMs: 5, sampler: false });
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.state, 'up');
    assert.strictEqual(r.opened, 2);
    assert.deepStrictEqual(opened.map((o) => o.url), ['https://shop.test/admin', 'http://localhost:3000/']);
    assert.ok(opened.every((o) => o.port === ports['shop-a']));
    await w.cleanup();
  });

  await t('Open again refuses non-http(s) URLs and opens at most 20 tabs', async () => {
    const { cfg, w, opened } = await reopenSetup();
    const tabs = [{ url: 'file:///C:/secret.txt', title: 'f' }, { url: 'javascript:alert(1)', title: 'j' }, { url: 'chrome://settings', title: 'c' }];
    for (let i = 0; i < 30; i++) tabs.push({ url: `https://many.test/${i}`, title: `p${i}` });
    seed(cfg, tabs);
    const r = await api.reopen(cfg, 'b_seed', { deps: w.deps, pollMs: 5, sampler: false });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.opened, 20);
    assert.strictEqual(opened.length, 20);
    assert.ok(opened.every((o) => /^https:\/\/many\.test\//.test(o.url)));
    await w.cleanup();
  });

  await t('Open again counts tabs the browser would not open, and flags hidden secrets', async () => {
    const { cfg, w } = await reopenSetup();
    w.deps.openTab = async () => false;
    seed(cfg, [{ url: 'https://a.test/?token=***', title: 'A' }, { url: 'https://b.test/', title: 'B' }]);
    const r = await api.reopen(cfg, 'b_seed', { deps: w.deps, pollMs: 5, sampler: false });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.opened, 0);
    assert.strictEqual(r.failed, 2);
    assert.strictEqual(r.hidden, 1);
    await w.cleanup();
  });

  await t('Open again on an unknown entry or a removed profile is NOT_FOUND, and starts nothing', async () => {
    const { cfg, w } = await reopenSetup();
    seed(cfg, [{ url: 'https://a.test/', title: 'A' }], 'gone-profile');
    assert.strictEqual((await api.reopen(cfg, 'b_missing', { deps: w.deps })).code, 'NOT_FOUND');
    assert.strictEqual((await api.reopen(cfg, 'b_seed', { deps: w.deps })).code, 'NOT_FOUND');
    assert.strictEqual(w.spawned.length, 0);
    await w.cleanup();
  });

  await t('Open again obeys the lease for a caller that names a session', async () => {
    const { cfg, w, beat, call } = await reopenSetup();
    beat(A); beat(B);
    seed(cfg, [{ url: 'https://a.test/', title: 'A' }]);
    await call('start_browser', { name: 'shop-a', sessionId: A });
    const r = await api.reopen(cfg, 'b_seed', { deps: w.deps, pollMs: 5, sampler: false, sessionId: B });
    assert.strictEqual(r.code, 'IN_USE');
    await w.cleanup();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
