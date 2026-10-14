/**
 * Purpose routing and window placement through the browser tools (src/core/browserApi.js,
 * browserRun.js): start_browser / list_browser_profiles `for`, NO_MATCH / AMBIGUOUS, the lease
 * with `for`, a headed profile's saved window (apply, read back, keep in front, reuse), and the
 * desktop's "Capture current position".
 * Run: node tests/browser-purpose-api.test.cjs   (part of npm run test:unit)
 *
 * The fake machine from tests/browser-world.cjs, with fake window calls and an injected
 * always-on-top function: no browser is launched, no real window is touched, and the real
 * PortPilot config is never touched.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const api = require('../src/core/browserApi');
const run = require('../src/core/browserRun');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bpurp-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const A = 'aaaa1111-2222-3333-4444-555555555555';
const B = 'bbbb1111-2222-3333-4444-555555555555';

const GSC = { name: 'search-console', purpose: 'Google Search Console, Analytics', sites: ['search.google.com', 'analytics.google.com'] };
const FB = { name: 'facebook', purpose: 'Facebook pages', sites: ['facebook.com'] };

async function setup(defs = [GSC, FB]) {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const ports = {};
  for (const d of defs) {
    ports[d.name] = await freePort();
    bp.addProfile(cfg, { browser: 'brave', url: 'https://example.test/', mode: 'headed', ...d, port: ports[d.name] });
  }
  const w = world();
  const ctx = (surface = 'mcp') => ({ surface, deps: w.deps, pollMs: 5, sampler: false });
  const beat = (id) => {
    const dir = path.join(path.dirname(cfg), 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ sessionId: id, cwd: 'C:/x', at: Date.now() - 1000 }));
  };
  const call = (tool, args, surface) => api.call(cfg, tool, args, ctx(surface));
  return { cfg, ports, w, ctx, beat, call };
}

(async () => {
  console.log('\n=== start_browser for ===\n');

  await t('for a site name starts the profile whose purpose fits, and says why', async () => {
    const { call, ports, w } = await setup();
    const r = await call('start_browser', { for: 'access Google Search Console' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.name, 'search-console');
    assert.strictEqual(r.port, ports['search-console']);
    assert.strictEqual(r.cdpUrl, `http://127.0.0.1:${ports['search-console']}`);
    assert.strictEqual(r.matchedBy.for, 'access Google Search Console');
    assert.ok(r.matchedBy.reason.includes('purpose'), r.matchedBy.reason);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('for a URL matches by site, and a second call reuses the running browser', async () => {
    const { call, w } = await setup();
    const a = await call('start_browser', { for: 'https://search.google.com/search-console/performance?resource_id=x' });
    assert.strictEqual(a.name, 'search-console');
    assert.ok(/site search\.google\.com/.test(a.matchedBy.reason));
    const b = await call('start_browser', { for: 'search.google.com' });
    assert.strictEqual(b.already, true);
    assert.strictEqual(w.spawned.length, 1);
    await w.cleanup();
  });

  await t('NO_MATCH names the existing profiles, tells the model to ask the user, and starts nothing', async () => {
    const { call, w } = await setup();
    const r = await call('start_browser', { for: 'linkedin' });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.code, 'NO_MATCH');
    assert.match(r.error, /search-console, facebook/);
    assert.deepStrictEqual(r.known, ['search-console', 'facebook']);
    assert.match(r.action, /ask them to create or label one/);
    assert.match(r.action, /Do not invent a port/);
    assert.strictEqual(w.spawned.length, 0);
    const none = await setup([]);
    const r2 = await none.call('start_browser', { for: 'linkedin' });
    assert.strictEqual(r2.code, 'NO_MATCH');
    assert.match(r2.error, /no profiles yet/);
    await w.cleanup(); await none.w.cleanup();
  });

  await t('AMBIGUOUS lists the candidates and starts nothing', async () => {
    const { call, w } = await setup([GSC, { name: 'ga', purpose: 'Google Analytics reports', sites: ['analytics.google.com'] }]);
    const r = await call('start_browser', { for: 'https://analytics.google.com/analytics/web' });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.code, 'AMBIGUOUS');
    assert.deepStrictEqual(r.candidates.map((c) => c.name).sort(), ['ga', 'search-console']);
    assert.ok(r.candidates[0].reason);
    assert.match(r.action, /Do not guess/);
    assert.strictEqual(w.spawned.length, 0);
    await w.cleanup();
  });

  await t('name and for together, or a for that is not text, is BAD_ARGS', async () => {
    const { call, w } = await setup();
    const both = await call('start_browser', { name: 'facebook', for: 'facebook' });
    assert.strictEqual(both.code, 'BAD_ARGS');
    assert.match(both.error, /not both/);
    for (const bad of ['', '   ', 5, {}, []]) {
      const r = await call('start_browser', { for: bad });
      assert.strictEqual(r.code, 'BAD_ARGS', JSON.stringify(bad));
    }
    assert.strictEqual(w.spawned.length, 0);
    await w.cleanup();
  });

  await t('name "any" still hands out a free profile, and name still starts exactly that profile', async () => {
    const { call, w } = await setup();
    const any = await call('start_browser', { name: 'any', sessionId: A });
    assert.strictEqual(any.success, true);
    assert.strictEqual(any.picked, true);
    assert.strictEqual(any.matchedBy, undefined);
    const exact = await call('start_browser', { name: 'FACEBOOK' });
    assert.strictEqual(exact.name, 'facebook');
    assert.strictEqual(exact.matchedBy, undefined);
    const free = await call('start_browser', { free: true });
    assert.strictEqual(free.success, true);
    await w.cleanup();
  });

  await t('the lease applies to for: a profile another live session holds is IN_USE, never swapped for another', async () => {
    const { call, beat, w } = await setup();
    beat(A); beat(B);
    assert.strictEqual((await call('start_browser', { for: 'google search console', sessionId: A })).success, true);
    const b = await call('start_browser', { for: 'google search console', sessionId: B });
    assert.strictEqual(b.code, 'IN_USE');
    assert.match(b.action, /throwaway browser with no logins/);
    assert.strictEqual(w.spawned.length, 1, 'no second browser, and no other profile started in its place');
    const taken = await call('start_browser', { for: 'google search console', sessionId: B, takeover: true });
    assert.strictEqual(taken.success, true);
    assert.ok(taken.takeoverNote);
    await w.cleanup();
  });

  console.log('\n=== list_browser_profiles ===\n');

  await t('rows carry purpose, sites and window; with no for, every profile is listed unranked', async () => {
    const { call, w } = await setup([{ ...GSC, window: { left: 5, top: 6, width: 800, height: 600, front: true } }, FB]);
    const r = await call('list_browser_profiles', {});
    assert.strictEqual(r.profiles.length, 2);
    const g = r.profiles.find((p) => p.name === 'search-console');
    assert.strictEqual(g.purpose, 'Google Search Console, Analytics');
    assert.deepStrictEqual(g.sites, ['search.google.com', 'analytics.google.com']);
    assert.deepStrictEqual(g.window, { left: 5, top: 6, width: 800, height: 600, front: true });
    assert.strictEqual(g.match, undefined);
    assert.strictEqual(r.for, undefined);
    await w.cleanup();
  });

  await t('for filters to the matches, best first, with a reason and no start', async () => {
    const { call, w } = await setup([GSC, FB, { name: 'shop', note: 'Facebook ad checks', purpose: '' }]);
    const r = await call('list_browser_profiles', { for: 'facebook' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.ambiguous, false);
    assert.deepStrictEqual(r.profiles.map((p) => p.name), ['facebook', 'shop'], 'the weaker note-only match is listed below, search-console is left out');
    assert.strictEqual(r.profiles[0].match.rank, 1);
    assert.strictEqual(r.profiles[1].match.rank, 2);
    assert.ok(r.profiles[0].match.score > r.profiles[1].match.score);
    assert.ok(r.profiles[0].match.reason);
    assert.strictEqual(w.spawned.length, 0);
    const miss = await call('list_browser_profiles', { for: 'linkedin' });
    assert.strictEqual(miss.success, true);
    assert.deepStrictEqual(miss.profiles, []);
    assert.match(miss.note, /ask them to create or label/);
    await w.cleanup();
  });

  await t('for in the list marks an ambiguity instead of ranking one profile as the answer', async () => {
    const { call, w } = await setup([GSC, { name: 'ga', purpose: 'Google Analytics', sites: ['analytics.google.com'] }]);
    const r = await call('list_browser_profiles', { for: 'analytics.google.com' });
    assert.strictEqual(r.ambiguous, true);
    assert.strictEqual(r.profiles.length, 2);
    assert.match(r.note, /do not guess/);
    assert.strictEqual((await call('list_browser_profiles', { for: 3 })).code, 'BAD_ARGS');
    await w.cleanup();
  });

  console.log('\n=== window placement ===\n');

  const WIN = { left: 100, top: 50, width: 1200, height: 800 };

  await t('a headed profile with a window is placed after the page is up, and the real bounds are reported', async () => {
    const { call, w, ports } = await setup([{ name: 'px', mode: 'headed', window: WIN }]);
    const r = await call('start_browser', { name: 'px' });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(w.placed, [{ port: ports.px, want: WIN }]);
    assert.deepStrictEqual(r.window.requested, WIN);
    assert.deepStrictEqual(r.window.actual, { ...WIN, windowState: 'normal' });
    assert.strictEqual(r.window.applied, true);
    assert.strictEqual(r.window.front, undefined, 'no front asked, none done');
    assert.deepStrictEqual(w.fronted, []);
    assert.deepStrictEqual(w.pinned, []);
    await w.cleanup();
  });

  await t('the OS moving the window is reported as not applied, with where it really is', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: WIN }]);
    w.clamp = { left: 0, top: 0 };
    const r = await call('start_browser', { name: 'px' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.window.applied, false);
    assert.strictEqual(r.window.actual.left, 0);
    assert.deepStrictEqual(r.window.requested, WIN);
    await w.cleanup();
  });

  await t('a small nudge inside the tolerance still counts as applied', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: WIN }]);
    w.clamp = { left: WIN.left + run.PLACE_TOLERANCE, width: WIN.width - run.PLACE_TOLERANCE };
    assert.strictEqual((await call('start_browser', { name: 'px' })).window.applied, true);
    await w.cleanup();
  });

  await t('a browser that cannot be asked fails soft: the start succeeds, applied is false, nothing throws', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: WIN }]);
    w.placeFails = true;
    const r = await call('start_browser', { name: 'px' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.state, 'up');
    assert.strictEqual(r.window.applied, false);
    assert.strictEqual(r.window.actual, null);
    assert.strictEqual(w.placed.length, 3, 'tried three times');
    await w.cleanup();
  });

  await t('a placement call that throws is logged and swallowed', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: { ...WIN, front: true } }]);
    w.deps.placeWindow = async () => { throw new Error('socket exploded'); };
    w.deps.bringToFront = async () => { throw new Error('no page'); };
    w.deps.pinTopmost = async () => { throw new Error('user32 said no'); };
    const logged = [];
    const orig = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    let r;
    try { r = await call('start_browser', { name: 'px' }); } finally { console.error = orig; }
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.window.applied, false);
    assert.deepStrictEqual(r.window.front, { raised: false, topmost: null });
    assert.ok(logged.some((l) => /user32 said no/.test(l)), logged.join('\n'));
    await w.cleanup();
  });

  await t('front: raises the page and asks for always-on-top with the browser pid', async () => {
    const { call, w, ports } = await setup([{ name: 'px', mode: 'headed', window: { ...WIN, front: true } }]);
    const r = await call('start_browser', { name: 'px' });
    assert.deepStrictEqual(w.fronted, [ports.px]);
    assert.deepStrictEqual(w.pinned, [w.holders.get(ports.px).pid]);
    assert.deepStrictEqual(r.window.front, { raised: true, topmost: true });
    await w.cleanup();
  });

  await t('always-on-top refused or not available: reported, never an error', async () => {
    const refused = await setup([{ name: 'px', mode: 'headed', window: { front: true } }]);
    refused.w.pinResult = false;
    const r = await refused.call('start_browser', { name: 'px' });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.window.front, { raised: true, topmost: false });
    assert.deepStrictEqual(r.window.requested, {}, 'front alone asks for no bounds');
    assert.strictEqual(r.window.applied, true);
    assert.deepStrictEqual(refused.w.placed, [], 'no bounds, no placement call');
    const other = await setup([{ name: 'px', mode: 'headed', window: { front: true } }]);
    other.w.pinResult = null; // not Windows: nothing tried
    assert.deepStrictEqual((await other.call('start_browser', { name: 'px' })).window.front, { raised: true, topmost: null });
    await refused.w.cleanup(); await other.w.cleanup();
  });

  await t('reusing a running browser that must stay in front puts it back and raises it, every call', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: { ...WIN, front: true } }]);
    await call('start_browser', { name: 'px' });
    w.placed.length = 0; w.fronted.length = 0; w.pinned.length = 0;
    w.actual = { ...w.actual, left: 700 }; // someone moved it
    const again = await call('start_browser', { name: 'px' });
    assert.strictEqual(again.already, true);
    assert.strictEqual(w.placed.length, 1);
    assert.strictEqual(w.fronted.length, 1);
    assert.strictEqual(w.pinned.length, 1);
    assert.strictEqual(again.window.actual.left, WIN.left);
    await w.cleanup();
  });

  await t('reusing a browser whose window is saved but not set to stay in front leaves the window alone', async () => {
    const { call, w } = await setup([{ name: 'px', mode: 'headed', window: WIN }]);
    await call('start_browser', { name: 'px' });
    w.placed.length = 0;
    const again = await call('start_browser', { name: 'px' });
    assert.strictEqual(again.already, true);
    assert.strictEqual(again.window, undefined);
    assert.deepStrictEqual(w.placed, []);
    await w.cleanup();
  });

  await t('offscreen and headless ignore the window; a headed profile without one is untouched', async () => {
    const off = await setup([{ name: 'o', mode: 'offscreen', window: { ...WIN, front: true } }]);
    const r = await off.call('start_browser', { name: 'o' });
    assert.strictEqual(r.offscreen.parked, true);
    assert.strictEqual(r.window, undefined);
    assert.deepStrictEqual([off.w.placed, off.w.fronted, off.w.pinned], [[], [], []]);
    const head = await setup([{ name: 'h', mode: 'headless', window: { ...WIN, front: true } }]);
    assert.strictEqual((await head.call('start_browser', { name: 'h' })).window, undefined);
    assert.deepStrictEqual([head.w.placed, head.w.fronted, head.w.pinned], [[], [], []]);
    const plain = await setup([{ name: 'p', mode: 'headed' }]);
    assert.strictEqual((await plain.call('start_browser', { name: 'p' })).window, undefined);
    assert.deepStrictEqual(plain.w.placed, []);
    await off.w.cleanup(); await head.w.cleanup(); await plain.w.cleanup();
  });

  await t('the real pinTopmost does nothing off Windows or for a bad pid', async () => {
    assert.strictEqual(await run.pinTopmost(0), null);
    assert.strictEqual(await run.pinTopmost('12; calc'), null);
    assert.strictEqual(await run.pinTopmost(-4), null);
    if (process.platform !== 'win32') assert.strictEqual(await run.pinTopmost(process.pid), null);
  });

  console.log('\n=== capture current position ===\n');

  await t('captureWindow reads a running browser\'s real bounds', async () => {
    const { call, w, cfg, ctx } = await setup([{ name: 'px', mode: 'headed' }]);
    await call('start_browser', { name: 'px' });
    w.actual = { left: -1900, top: 30, width: 1000, height: 700, windowState: 'normal' };
    const r = await api.captureWindow(cfg, 'px', ctx());
    assert.deepStrictEqual(r, { success: true, name: 'px', window: { left: -1900, top: 30, width: 1000, height: 700 }, windowState: 'normal' });
    w.actual = { ...w.actual, windowState: 'maximized' };
    assert.strictEqual((await api.captureWindow(cfg, 'px', ctx())).windowState, 'maximized');
    await w.cleanup();
  });

  await t('captureWindow on a stopped profile is NOT_RUNNING; a browser with no answer is CAPTURE_FAILED; an unknown name is NOT_FOUND', async () => {
    const { call, w, cfg, ctx } = await setup([{ name: 'px', mode: 'headed' }]);
    assert.strictEqual((await api.captureWindow(cfg, 'px', ctx())).code, 'NOT_RUNNING');
    await call('start_browser', { name: 'px' });
    w.windowFails = true;
    assert.strictEqual((await api.captureWindow(cfg, 'px', ctx())).code, 'CAPTURE_FAILED');
    assert.strictEqual((await api.captureWindow(cfg, 'nope', ctx())).code, 'NOT_FOUND');
    await w.cleanup();
  });

  await t('the model tools are unchanged in number and name: capture is not one of them', async () => {
    assert.deepStrictEqual([...api.TOOL_NAMES].sort(),
      ['browser_history', 'list_browser_profiles', 'list_browsers', 'set_browser_mode', 'start_browser', 'stop_browser']);
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
