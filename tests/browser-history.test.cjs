/**
 * Browser history (src/core/browserHistory.js): URL redaction, recording, trimming, filters, the
 * dev-server link and the sampler. Run: node tests/browser-history.test.cjs (part of npm run test:unit)
 *
 * Temp config dirs and fake CDP answers only; no browser is launched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = require('../src/core/browserHistory');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bhist-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}
const newCfg = () => path.join(root, `case${++n}`, 'portpilot-config.json');
const read = (cfg) => JSON.parse(fs.readFileSync(h.historyPathFor(cfg), 'utf8')).runs;
const base = { profile: 'shop-a', port: 9300, browser: 'brave', mode: 'headless', startedBy: { kind: 'claude', surface: 'mcp', sessionId: 'abcd-1234', label: 'claude abcd' } };
const T0 = Date.parse('2026-10-13T00:00:00Z');

(async () => {
  console.log('\n=== browser history: redaction ===\n');

  await t('a secret-named query value becomes ***, other values stay byte for byte', () => {
    assert.strictEqual(h.redactUrl('https://app.example/cb?code=AbC123&state=xyz&q=hello%20world&page=2'),
      'https://app.example/cb?code=***&state=xyz&q=hello%20world&page=2');
    for (const name of ['token', 'access_token', 'apiKey', 'api_key', 'auth', 'sessionid', 'password', 'passwd', 'secret', 'jwt', 'sid', 'X-Amz-Signature']) {
      assert.strictEqual(h.redactUrl(`https://x.test/?${name}=SECRET1&keep=1`), `https://x.test/?${name}=***&keep=1`, name);
    }
  });

  await t('secret parameters inside the fragment are hidden, and a bare token-like fragment is hidden whole', () => {
    assert.strictEqual(h.redactUrl('https://x.test/cb#access_token=AAA&token_type=bearer&expires_in=3600'), 'https://x.test/cb#access_token=***&token_type=***&expires_in=3600');
    assert.strictEqual(h.redactUrl('https://x.test/app#/cb?code=ZZZ&tab=2'), 'https://x.test/app#/cb?code=***&tab=2');
    assert.strictEqual(h.redactUrl(`https://x.test/reset#${'a1B2'.repeat(10)}`), 'https://x.test/reset#***');
    assert.strictEqual(h.redactUrl('https://x.test/docs#install'), 'https://x.test/docs#install');
    assert.strictEqual(h.redactUrl('https://x.test/app#/users/42'), 'https://x.test/app#/users/42');
  });

  await t('userinfo is dropped', () => {
    assert.strictEqual(h.redactUrl('https://bob:hunter2@x.test/a'), 'https://x.test/a');
  });

  await t('only http, https and file pages are kept; junk and non-pages return null', () => {
    assert.strictEqual(h.redactUrl('about:blank'), null);
    assert.strictEqual(h.redactUrl('chrome://settings/'), null);
    assert.strictEqual(h.redactUrl('devtools://devtools/bundled/x.html'), null);
    assert.strictEqual(h.redactUrl('javascript:alert(1)'), null);
    assert.strictEqual(h.redactUrl('not a url'), null);
    assert.strictEqual(h.redactUrl(undefined), null);
    assert.ok(h.redactUrl('file:///C:/work/index.html').startsWith('file:///'));
  });

  await t('an over-long URL is cut back to its path', () => {
    const out = h.redactUrl(`https://x.test/p?${'a=1&'.repeat(400)}`);
    assert.ok(out.length <= 1000 && out === 'https://x.test/p', out.length);
  });

  await t('cleanTabs redacts, drops non-pages and duplicates, trims titles and caps the count', () => {
    const tabs = [
      { url: 'https://a.test/?token=abc', title: '  Dash\u0000board \n ' },
      { url: 'https://a.test/?token=zzz', title: 'dupe after redaction' },
      { url: 'about:blank', title: '' },
      { url: 'chrome://newtab', title: 'New Tab' },
      { url: 'https://b.test/', title: 'x'.repeat(500) },
    ];
    const out = h.cleanTabs(tabs);
    assert.deepStrictEqual(out.map((x) => x.url), ['https://a.test/?token=***', 'https://b.test/']);
    assert.strictEqual(out[0].title, 'Dash board');
    assert.strictEqual(out[1].title.length, 200);
    const many = Array.from({ length: 80 }, (_, i) => ({ url: `https://m.test/${i}`, title: '' }));
    assert.strictEqual(h.cleanTabs(many).length, h.MAX_TABS);
    assert.deepStrictEqual(h.cleanTabs(null), []);
  });

  console.log('\n=== browser history: recording ===\n');

  await t('open then close records who, when and the tabs; the file holds no raw secret', () => {
    const cfg = newCfg();
    const id = h.openSession(cfg, { ...base, tabs: [{ url: 'https://a.test/?token=SECRETVALUE', title: 'A' }], now: T0 });
    assert.match(id, /^b_20261013T000000_[0-9a-f]{8}$/);
    h.closeSession(cfg, 'SHOP-A', { endedBy: { kind: 'claude', surface: 'mcp', sessionId: 'abcd-1234' }, tabs: [{ url: 'https://b.test/page', title: 'B' }], now: T0 + 60000 });
    const [e] = read(cfg);
    assert.strictEqual(e.profile, 'shop-a');
    assert.strictEqual(e.port, 9300);
    assert.strictEqual(e.startedAt, '2026-10-13T00:00:00.000Z');
    assert.strictEqual(e.stoppedAt, '2026-10-13T00:01:00.000Z');
    assert.strictEqual(e.startedBy.sessionId, 'abcd-1234');
    assert.strictEqual(e.endedBy.kind, 'claude');
    assert.deepStrictEqual(e.tabs, [{ url: 'https://b.test/page', title: 'B' }]);
    assert.ok(!fs.readFileSync(h.historyPathFor(cfg), 'utf8').includes('SECRETVALUE'));
  });

  await t('closing with no tabs keeps the sampled ones', () => {
    const cfg = newCfg();
    h.openSession(cfg, { ...base, now: T0 });
    h.sampleSession(cfg, 'shop-a', [{ url: 'https://a.test/', title: 'A' }], T0 + 1000);
    h.closeSession(cfg, 'shop-a', { endedBy: { kind: 'human', surface: 'desktop' }, tabs: [], now: T0 + 2000 });
    assert.deepStrictEqual(read(cfg)[0].tabs, [{ url: 'https://a.test/', title: 'A' }]);
  });

  await t('sampling replaces the tabs, ignores an empty list, and writes nothing when nothing changed', () => {
    const cfg = newCfg();
    h.openSession(cfg, { ...base, now: T0 });
    assert.strictEqual(h.sampleSession(cfg, 'shop-a', [{ url: 'https://a.test/', title: 'A' }], T0 + 1000), true);
    assert.strictEqual(h.sampleSession(cfg, 'shop-a', [{ url: 'https://a.test/', title: 'A' }], T0 + 2000), false);
    assert.strictEqual(h.sampleSession(cfg, 'shop-a', [], T0 + 3000), false);
    assert.strictEqual(h.sampleSession(cfg, 'shop-a', [{ url: 'chrome://x', title: '' }], T0 + 3000), false);
    assert.strictEqual(read(cfg)[0].tabs.length, 1);
    assert.strictEqual(h.sampleSession(cfg, 'shop-a', [{ url: 'https://a.test/', title: 'A' }, { url: 'https://b.test/', title: 'B' }], T0 + 4000), true);
    assert.strictEqual(read(cfg)[0].tabs.length, 2);
    assert.strictEqual(h.sampleSession(cfg, 'other', [{ url: 'https://z.test/', title: '' }]), false, 'no open entry for that profile');
  });

  await t('closing with nothing open writes nothing; starting again closes a lost entry as unknown', () => {
    const cfg = newCfg();
    assert.strictEqual(h.closeSession(cfg, 'shop-a', { endedBy: { kind: 'human', surface: 'desktop' } }), null);
    assert.ok(!fs.existsSync(h.historyPathFor(cfg)) || read(cfg).length === 0);
    h.openSession(cfg, { ...base, now: T0 });
    h.openSession(cfg, { ...base, now: T0 + 5000 });
    const list = read(cfg);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].stoppedAt, '2026-10-13T00:00:05.000Z');
    assert.deepStrictEqual(list[0].endedBy, { kind: 'external', reason: 'unknown' });
    assert.strictEqual(list[1].stoppedAt, null);
  });

  await t('the file is capped at 500 entries by default; the oldest closed go first and an open one is kept', () => {
    const cfg = newCfg();
    fs.mkdirSync(path.dirname(h.historyPathFor(cfg)), { recursive: true });
    const runs = Array.from({ length: 500 }, (_, i) => ({ id: `old${i}`, profile: `p${i % 7}`, startedAt: new Date(T0 + i).toISOString(), stoppedAt: new Date(T0 + i + 1).toISOString(), tabs: [] }));
    runs[0].stoppedAt = null; // an old entry still open (another profile)
    runs[0].profile = 'long-open';
    fs.writeFileSync(h.historyPathFor(cfg), JSON.stringify({ v: 1, runs }));
    h.openSession(cfg, { ...base, now: T0 + 10000 });
    const list = read(cfg);
    assert.strictEqual(list.length, 500);
    assert.ok(list.some((r) => r.id === 'old0'), 'the open entry survives');
    assert.ok(!list.some((r) => r.id === 'old1'), 'the oldest closed one is dropped');
    assert.strictEqual(list[list.length - 1].profile, 'shop-a');
  });

  await t('settings.browserHistoryMaxRuns lowers the cap', () => {
    const cfg = newCfg();
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, JSON.stringify({ settings: { browserHistoryMaxRuns: 12 }, apps: [], groups: [] }));
    for (let i = 0; i < 20; i++) {
      h.openSession(cfg, { ...base, now: T0 + i * 1000 });
      h.closeSession(cfg, 'shop-a', { endedBy: { kind: 'human', surface: 'desktop' }, now: T0 + i * 1000 + 500 });
    }
    assert.strictEqual(read(cfg).length, 12);
  });

  console.log('\n=== browser history: listing ===\n');

  await t('parseSince reads 30m, 24h, 7d and dates; rejects the rest', () => {
    assert.strictEqual(h.parseSince('30m', T0), T0 - 30 * 60000);
    assert.strictEqual(h.parseSince('24h', T0), T0 - 24 * 3600000);
    assert.strictEqual(h.parseSince('7d', T0), T0 - 7 * 86400000);
    assert.strictEqual(h.parseSince('2026-10-01'), Date.parse('2026-10-01'));
    assert.strictEqual(h.parseSince(undefined), undefined);
    assert.strictEqual(h.parseSince('yesterday-ish'), null);
  });

  await t('listSessions is newest first and filters by profile, since and limit', () => {
    const cfg = newCfg();
    for (const [name, at] of [['a', 0], ['b', 1], ['a', 2], ['b', 3], ['a', 4]]) {
      h.openSession(cfg, { ...base, profile: name, now: T0 + at * 86400000 });
      h.closeSession(cfg, name, { endedBy: { kind: 'human', surface: 'desktop' }, now: T0 + at * 86400000 + 1000 });
    }
    const all = h.listSessions(cfg, {});
    assert.strictEqual(all.total, 5);
    assert.deepStrictEqual(all.entries.map((e) => e.profile), ['a', 'b', 'a', 'b', 'a']);
    assert.ok(Date.parse(all.entries[0].startedAt) > Date.parse(all.entries[1].startedAt));
    assert.strictEqual(h.listSessions(cfg, { profile: 'A' }).total, 3);
    assert.strictEqual(h.listSessions(cfg, { limit: 2 }).entries.length, 2);
    assert.strictEqual(h.listSessions(cfg, { limit: 2 }).total, 5);
    assert.strictEqual(h.listSessions(cfg, { since: T0 + 3 * 86400000 }).total, 2);
    assert.strictEqual(h.getSession(cfg, all.entries[0].id).id, all.entries[0].id);
    assert.strictEqual(h.getSession(cfg, 'nope'), null);
  });

  console.log('\n=== browser history: dev server link ===\n');

  const writeRuns = (cfg, runs) => {
    const p = path.join(path.dirname(cfg), 'history', 'runs.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ v: 1, runs }));
    return p;
  };

  await t('localhostPort reads localhost, 127.0.0.1 and [::1] only', () => {
    assert.strictEqual(h.localhostPort('http://localhost:3000/x'), 3000);
    assert.strictEqual(h.localhostPort('http://127.0.0.1:5173/'), 5173);
    assert.strictEqual(h.localhostPort('http://[::1]:8080/'), 8080);
    assert.strictEqual(h.localhostPort('https://example.com:3000/'), null);
    assert.strictEqual(h.localhostPort('http://localhost.evil.test:3000/'), null);
    assert.strictEqual(h.localhostPort('chrome://x'), null);
  });

  await t('a tab on a dev server port stamps the open run with testedIn, once per profile; other fields are untouched', () => {
    const cfg = newCfg();
    const p = writeRuns(cfg, [
      { id: 'r_open', appId: 'a', port: 3000, startedAt: '2026-10-13T00:00:00Z', stoppedAt: null, pinned: true, page: { title: 'T' } },
      { id: 'r_closed', appId: 'b', port: 3000, startedAt: '2026-10-12T00:00:00Z', stoppedAt: '2026-10-12T01:00:00Z' },
      { id: 'r_other', appId: 'c', port: 4000, startedAt: '2026-10-13T00:00:00Z', stoppedAt: null },
    ]);
    const tabs = [{ url: 'http://localhost:3000/dash', title: 'Dash' }, { url: 'https://example.com:4000/', title: 'no' }];
    assert.deepStrictEqual(h.linkTestedRuns(cfg, 'shop-a', tabs, T0), ['r_open']);
    assert.deepStrictEqual(h.linkTestedRuns(cfg, 'shop-a', tabs, T0 + 1000), [], 'already recorded for that profile');
    assert.deepStrictEqual(h.linkTestedRuns(cfg, 'blog-qa', [{ url: 'http://127.0.0.1:3000/', title: '' }], T0 + 2000), ['r_open']);
    const runs = JSON.parse(fs.readFileSync(p, 'utf8')).runs;
    const open = runs.find((r) => r.id === 'r_open');
    assert.deepStrictEqual(open.testedIn.map((x) => x.profile), ['shop-a', 'blog-qa']);
    assert.strictEqual(open.testedIn[0].at, '2026-10-13T00:00:00.000Z');
    assert.strictEqual(open.pinned, true);
    assert.deepStrictEqual(open.page, { title: 'T' });
    assert.strictEqual(runs.find((r) => r.id === 'r_closed').testedIn, undefined, 'a closed run is not stamped');
    assert.strictEqual(runs.find((r) => r.id === 'r_other').testedIn, undefined);
  });

  await t('no runs.json and no localhost tab: nothing is created', () => {
    const cfg = newCfg();
    assert.deepStrictEqual(h.linkTestedRuns(cfg, 'shop-a', [{ url: 'http://localhost:3000/', title: '' }]), []);
    assert.deepStrictEqual(h.linkTestedRuns(cfg, 'shop-a', [{ url: 'https://example.com/', title: '' }]), []);
    assert.ok(!fs.existsSync(path.join(path.dirname(cfg), 'history', 'runs.json')));
  });

  console.log('\n=== browser history: sampler ===\n');

  await t('sampleOnce stores the tabs of an open entry, links the dev server and leaves a closed entry alone', async () => {
    const cfg = newCfg();
    writeRuns(cfg, [{ id: 'r1', appId: 'a', port: 3000, startedAt: '2026-10-13T00:00:00Z', stoppedAt: null }]);
    h.openSession(cfg, { ...base, now: T0 });
    h.openSession(cfg, { ...base, profile: 'done', port: 9301, now: T0 });
    h.closeSession(cfg, 'done', { endedBy: { kind: 'human', surface: 'desktop' }, now: T0 + 1 });
    const asked = [];
    const d = {
      version: async (port) => { asked.push(port); return { Browser: 'Fake/1' }; },
      pageTabs: async () => [{ url: 'http://localhost:3000/', title: 'App' }, { url: 'https://x.test/?token=q', title: 'X' }],
    };
    const out = await h.sampleOnce(cfg, d, { now: T0 + 30000 });
    assert.deepStrictEqual(out, { sampled: 1, closed: 0 });
    assert.deepStrictEqual(asked, [9300], 'only the open entry is probed');
    assert.deepStrictEqual(read(cfg).find((r) => r.profile === 'shop-a').tabs.map((x) => x.url), ['http://localhost:3000/', 'https://x.test/?token=***']);
    const runs = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg), 'history', 'runs.json'), 'utf8')).runs;
    assert.strictEqual(runs[0].testedIn[0].profile, 'shop-a');
  });

  await t('a browser that stops answering is closed as closed outside PortPilot after two misses, keeping its last tabs', async () => {
    const cfg = newCfg();
    h.openSession(cfg, { ...base, tabs: [{ url: 'https://a.test/', title: 'A' }], now: T0 });
    const misses = new Map();
    const down = { version: async () => null, pageTabs: async () => [] };
    assert.deepStrictEqual(await h.sampleOnce(cfg, down, { misses, now: T0 + 30000 }), { sampled: 0, closed: 0 });
    assert.strictEqual(read(cfg)[0].stoppedAt, null, 'one miss is not enough');
    assert.deepStrictEqual(await h.sampleOnce(cfg, down, { misses, now: T0 + 60000 }), { sampled: 0, closed: 1 });
    const e = read(cfg)[0];
    assert.strictEqual(e.stoppedAt, '2026-10-13T00:01:00.000Z');
    assert.deepStrictEqual(e.endedBy, { kind: 'external', reason: 'closed' });
    assert.strictEqual(e.tabs.length, 1);
  });

  await t('an answer between two misses resets the count', async () => {
    const cfg = newCfg();
    h.openSession(cfg, { ...base, now: T0 });
    const misses = new Map();
    let up = false;
    const d = { version: async () => (up ? { Browser: 'x' } : null), pageTabs: async () => [] };
    await h.sampleOnce(cfg, d, { misses });
    up = true;
    await h.sampleOnce(cfg, d, { misses });
    up = false;
    await h.sampleOnce(cfg, d, { misses });
    assert.strictEqual(read(cfg)[0].stoppedAt, null);
  });

  await t('startSampler returns a stop function and never keeps the process alive', () => {
    const cfg = newCfg();
    const stop = h.startSampler(cfg, { version: async () => null, pageTabs: async () => [] }, { intervalMs: 60000 });
    assert.strictEqual(typeof stop, 'function');
    stop();
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
