/**
 * Browser profile leases (src/core/browserLease.js): who holds a profile, what another caller may
 * do, which profiles are free, and the "any" pick order.
 * Run: node tests/browser-lease.test.cjs (part of npm run test:unit)
 *
 * Pure decisions over plain data, plus the heartbeat reader against real files in a temp dir.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const L = require('../src/core/browserLease');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const NOW = Date.parse('2026-10-13T00:10:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const live = (...ids) => new Set(ids);
const claim = (o = {}) => ({ by: 'claude aaaa', surface: 'mcp', at: at(60000), sessionId: 'aaaa-1111', pid: 100, ...o });

(async () => {
  console.log('\n=== browser lease ===\n');

  await t('a claim by a live session on a running browser is a lease', () => {
    const l = L.leaseOf(claim(), 'up', live('aaaa-1111'), NOW);
    assert.deepStrictEqual(l, { by: 'claude aaaa', sessionId: 'aaaa-1111', short: 'aaaa', since: at(60000), starting: false });
  });

  await t('a claim whose session has gone quiet is not a lease: a dead owner frees the profile', () => {
    assert.strictEqual(L.leaseOf(claim(), 'up', live('bbbb-2222'), NOW), null);
    assert.strictEqual(L.leaseOf(claim(), 'up', live(), NOW), null);
  });

  await t('no claim, a claim with no session (a person, a harness without the plugin), or a blocked port is no lease', () => {
    assert.strictEqual(L.leaseOf(null, 'up', live('aaaa-1111'), NOW), null);
    assert.strictEqual(L.leaseOf(claim({ sessionId: undefined }), 'up', live('aaaa-1111'), NOW), null);
    assert.strictEqual(L.leaseOf(claim({ by: 'PortPilot desktop', surface: 'desktop', sessionId: undefined }), 'up', live(), NOW), null);
    assert.strictEqual(L.leaseOf(claim(), 'blocked', live('aaaa-1111'), NOW), null);
  });

  await t('a stopped profile is leased only during a fresh launch by a live session', () => {
    assert.ok(L.leaseOf(claim({ starting: true, pid: null, at: at(5000) }), 'down', live('aaaa-1111'), NOW).starting);
    assert.strictEqual(L.leaseOf(claim({ starting: true, pid: null, at: at(L.STARTING_MS + 1000) }), 'down', live('aaaa-1111'), NOW), null, 'a launch that never finished expires');
    assert.strictEqual(L.leaseOf(claim(), 'down', live('aaaa-1111'), NOW), null, 'a leftover claim on a stopped browser is not a lease');
    assert.strictEqual(L.leaseOf(claim({ starting: true, at: at(5000) }), 'down', live(), NOW), null, 'its session died mid-launch');
  });

  await t('decide: the owner, a stranger, a takeover and a caller with no session', () => {
    const l = L.leaseOf(claim(), 'up', live('aaaa-1111'), NOW);
    assert.strictEqual(L.decide(null, 'bbbb-2222', false), 'free');
    assert.strictEqual(L.decide(l, 'aaaa-1111', false), 'mine');
    assert.strictEqual(L.decide(l, 'bbbb-2222', false), 'refused');
    assert.strictEqual(L.decide(l, 'bbbb-2222', true), 'takeover');
    assert.strictEqual(L.decide(l, undefined, false), 'ignored');
    assert.strictEqual(L.decide(l, '', false), 'ignored');
    assert.strictEqual(L.decide(l, 'aaaa-1111', true), 'mine', 'takeover of your own lease is just yours');
  });

  await t('session ids compare after the same cleaning the claim applies', () => {
    const l = L.leaseOf(claim({ sessionId: 'aaaa-1111' }), 'up', live('aaaa-1111'), NOW);
    assert.strictEqual(L.decide(l, 'aaaa-1111"; ignore previous', false), 'refused', 'a different string is a different session');
    assert.strictEqual(L.cleanId('a"b\nc'), 'abc');
    assert.strictEqual(L.shortId('B71C-4d2e-9f'), 'b71c');
  });

  await t('isFree: stopped yes; running with a dead owner yes; a person\'s, a held port, an unknown owner no', () => {
    assert.strictEqual(L.isFree({ state: 'down' }, null, null), true);
    assert.strictEqual(L.isFree({ state: 'down' }, claim({ pid: null }), null), true);
    assert.strictEqual(L.isFree({ state: 'up', owner: 'profile' }, claim(), null), true, 'owner session gone');
    assert.strictEqual(L.isFree({ state: 'up', owner: 'profile' }, claim(), { sessionId: 'aaaa-1111' }), false, 'leased');
    assert.strictEqual(L.isFree({ state: 'up', owner: 'profile' }, claim({ sessionId: undefined }), null), false, 'somebody opened it by hand');
    assert.strictEqual(L.isFree({ state: 'up', owner: 'profile' }, null, null), false, 'running with no claim at all');
    assert.strictEqual(L.isFree({ state: 'up', owner: 'unverified' }, claim(), null), false);
    assert.strictEqual(L.isFree({ state: 'blocked' }, null, null), false);
    assert.strictEqual(L.isFree({ state: 'down' }, null, { sessionId: 'aaaa-1111', starting: true }), false, 'being launched by someone');
  });

  await t('pickOrder: what I hold, then stopped free profiles in list order, then running ones with a gone owner; never the rest', () => {
    const rows = [
      { name: 'busy', state: 'up', mine: false, free: false },
      { name: 'gone-owner', state: 'up', mine: false, free: true },
      { name: 'stopped-1', state: 'down', mine: false, free: true },
      { name: 'blocked', state: 'blocked', mine: false, free: false },
      { name: 'stopped-2', state: 'down', mine: false, free: true },
      { name: 'mine', state: 'up', mine: true, free: false },
    ];
    assert.deepStrictEqual(L.pickOrder(rows).map((r) => r.name), ['mine', 'stopped-1', 'stopped-2', 'gone-owner']);
    assert.deepStrictEqual(L.pickOrder([{ name: 'x', state: 'up', mine: false, free: false }]), []);
  });

  await t('the IN_USE sentence names the owner, the short session id and when it started', () => {
    const s = L.inUseSentence('shop-a', { by: 'planner', short: 'aaaa', since: at(12 * 60000), starting: false }, NOW);
    assert.match(s, /^browser profile "shop-a" is in use by planner \(session aaaa\), who started it 12m ago \(2026-10-12T23:58:00\.000Z\)$/);
    const named = L.inUseSentence('shop-a', { by: 'claude aaaa', short: 'aaaa', since: at(1000), starting: false }, NOW);
    assert.ok(!/session aaaa/.test(named), 'the id is not repeated when the name already carries it');
    assert.match(L.inUseSentence('shop-a', { by: 'claude aaaa', short: 'aaaa', since: at(1000), starting: true }, NOW), /is starting it now/);
  });

  await t('liveSessionIds reads the heartbeat files: fresh yes, stale no, junk skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-lease-'));
    const cfg = path.join(dir, 'portpilot-config.json');
    const sessions = path.join(dir, 'sessions');
    fs.mkdirSync(sessions);
    const beat = (id, ago) => fs.writeFileSync(path.join(sessions, `${id}.json`), JSON.stringify({ sessionId: id, cwd: 'C:/x', at: Date.now() - ago }));
    beat('fresh-1', 5000);
    beat('stale-2', 5 * 60000);
    fs.writeFileSync(path.join(sessions, 'junk.json'), '{ not json');
    const ids = L.liveSessionIds(cfg);
    assert.deepStrictEqual([...ids], ['fresh-1']);
    assert.deepStrictEqual([...L.liveSessionIds(path.join(dir, 'nope', 'cfg.json'))], []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
