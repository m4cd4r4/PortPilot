/**
 * Browsers screen extras (src/main/browserExtraIpc.js): brand art, sign-in health, lease release.
 * Run: node tests/browser-extra-ipc.test.cjs   (part of npm run test:unit)
 *
 * Temp config dirs, a fake fetch and the fake browser world; no network, no browser.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const configFile = require('../src/core/configFile');
const { claimsPathFor } = require('../src/core/browserApi');
const { setupBrowserExtraIpc } = require('../src/main/browserExtraIpc');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-bextra-'));
let n = 0;
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32, 7)]);
const HTML = '<head><meta property="og:image" content="/brand.png"></head>';

/** A fake fetch over a { url: Response factory } table; records the URLs asked for. */
function fakeFetch(table) {
  const asked = [];
  const impl = async (url) => {
    asked.push(url);
    const make = table[url];
    if (!make) return new Response('no', { status: 404 });
    return make();
  };
  impl.asked = asked;
  return impl;
}
const ok = (body, type) => () => new Response(body, { status: 200, headers: { 'content-type': type } });

async function setup(opts = {}) {
  const cfg = path.join(root, `case${++n}`, 'portpilot-config.json');
  const port = await freePort();
  bp.addProfile(cfg, { name: 'shop', port, browser: 'brave', url: 'https://shop.example.com/', sites: ['shop.example.com'] });
  const w = world();
  const handlers = new Map();
  setupBrowserExtraIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { configPath: cfg }, { runDeps: w.deps, ...opts });
  const call = (ch, ...args) => handlers.get(ch)({}, ...args);
  return { cfg, port, w, call, handlers };
}

(async () => {
  console.log('\n=== browser extra ipc ===\n');

  await t('registers exactly the eight channels', async () => {
    const { handlers } = await setup();
    assert.deepStrictEqual([...handlers.keys()].sort(), [
      'browser:art:choose', 'browser:art:clear', 'browser:art:get', 'browser:art:index', 'browser:art:refresh', 'browser:health', 'browser:release', 'browser:signInSetup',
    ]);
  });

  await t('refresh fetches the og:image, stores it, and index + get return it as a data URL', async () => {
    const f = fakeFetch({ 'https://shop.example.com/': ok(HTML, 'text/html'), 'https://shop.example.com/brand.png': ok(PNG, 'image/png') });
    const { call } = await setup({ fetch: f });
    assert.deepStrictEqual(await call('browser:art:index'), { success: true, byName: {} });
    const r = await call('browser:art:refresh', 'shop');
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.kind, 'og');
    const idx = await call('browser:art:index');
    assert.strictEqual(idx.byName.shop.source, 'auto');
    const got = await call('browser:art:get', ['shop']);
    assert.ok(got.arts.shop.startsWith('data:image/png;base64,'));
    assert.deepStrictEqual(Buffer.from(got.arts.shop.split(',')[1], 'base64'), PNG);
  });

  await t('a page with no usable picture is a miss, remembered so the next refresh makes no request', async () => {
    const f = fakeFetch({ 'https://shop.example.com/': ok('<html></html>', 'text/html') });
    const { call } = await setup({ fetch: f });
    assert.strictEqual((await call('browser:art:refresh', 'shop')).found, false);
    const before = f.asked.length;
    assert.strictEqual((await call('browser:art:refresh', 'shop')).found, false);
    assert.strictEqual(f.asked.length, before);
    assert.deepStrictEqual((await call('browser:art:index')).byName, {}); // a miss is not a picture
    await call('browser:art:refresh', 'shop', true); // force retries
    assert.ok(f.asked.length > before);
  });

  await t('bytes that are not an image (an html error page served as the image) are refused', async () => {
    const f = fakeFetch({ 'https://shop.example.com/': ok(HTML, 'text/html'), 'https://shop.example.com/brand.png': ok('<html>nope</html>', 'image/png') });
    const { call } = await setup({ fetch: f });
    assert.strictEqual((await call('browser:art:refresh', 'shop')).found, false);
  });

  await t('an image over 2 MB is refused', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const f = fakeFetch({ 'https://shop.example.com/': ok(HTML, 'text/html'), 'https://shop.example.com/brand.png': ok(big, 'image/png') });
    const { call } = await setup({ fetch: f });
    assert.strictEqual((await call('browser:art:refresh', 'shop')).found, false);
  });

  await t('a redirect to localhost is not followed', async () => {
    const f = fakeFetch({
      'https://shop.example.com/': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9999/secret' } }),
      'http://127.0.0.1:9999/secret': ok(PNG, 'image/png'),
    });
    const { call } = await setup({ fetch: f });
    await call('browser:art:refresh', 'shop');
    assert.ok(!f.asked.some((u) => u.includes('127.0.0.1')), f.asked.join(' '));
  });

  await t('a localhost profile has no art to fetch and makes no request', async () => {
    const f = fakeFetch({});
    const { cfg, call } = await setup({ fetch: f });
    bp.addProfile(cfg, { name: 'dev', port: await freePort(), browser: 'brave', url: 'http://localhost:3000/' });
    const r = await call('browser:art:refresh', 'dev');
    assert.deepStrictEqual([r.found, r.reason], [false, 'no-public-site']);
    assert.strictEqual(f.asked.length, 0);
  });

  await t('choose copies a picked image; a non-image or oversize pick is refused; manual art survives refresh', async () => {
    let pick = null;
    const f = fakeFetch({});
    const { call } = await setup({ fetch: f, pickFile: async () => pick });
    assert.strictEqual((await call('browser:art:choose', 'shop')).cancelled, true);
    const good = path.join(root, 'good.png');
    fs.writeFileSync(good, PNG);
    pick = good;
    assert.strictEqual((await call('browser:art:choose', 'shop')).success, true);
    assert.strictEqual((await call('browser:art:index')).byName.shop.source, 'manual');
    assert.strictEqual((await call('browser:art:refresh', 'shop')).kept, 'manual');
    assert.strictEqual(f.asked.length, 0);
    const bad = path.join(root, 'bad.txt');
    fs.writeFileSync(bad, 'hello hello hello hello');
    pick = bad;
    assert.strictEqual((await call('browser:art:choose', 'shop')).code, 'BAD_IMAGE');
    const huge = path.join(root, 'huge.png');
    fs.writeFileSync(huge, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    pick = huge;
    assert.strictEqual((await call('browser:art:choose', 'shop')).code, 'BAD_IMAGE');
  });

  await t('clear forgets the picture; unknown and malformed names are refused without touching disk', async () => {
    const f = fakeFetch({ 'https://shop.example.com/': ok(HTML, 'text/html'), 'https://shop.example.com/brand.png': ok(PNG, 'image/png') });
    const { call } = await setup({ fetch: f });
    await call('browser:art:refresh', 'shop');
    await call('browser:art:clear', 'shop');
    assert.deepStrictEqual((await call('browser:art:index')).byName, {});
    assert.strictEqual((await call('browser:art:refresh', 'nope')).code, 'NOT_FOUND');
    assert.strictEqual((await call('browser:art:refresh', '../../etc')).success, false);
    assert.strictEqual((await call('browser:art:refresh', 42)).code, 'BAD_ARGS');
    assert.deepStrictEqual((await call('browser:art:get', ['../x', 7, 'nope'])).arts, {});
  });

  await t('health: a stopped profile is unknown; a running one reads signed in or out from its cookies', async () => {
    let cookies = [{ name: 'sessionid', domain: '.example.com', expires: -1 }];
    const { call, port, w } = await setup({ cookies: async () => cookies });
    assert.strictEqual((await call('browser:health', ['shop'])).health.shop, 'unknown');
    await w.foreign(port, null, true);
    assert.strictEqual((await call('browser:health', ['shop'])).health.shop, 'in');
    cookies = [{ name: '_ga', domain: '.example.com', expires: -1 }];
    assert.strictEqual((await call('browser:health', ['shop'])).health.shop, 'in'); // 60 s cache
    await w.cleanup();
  });

  await t('health: signed out is reported when the cookies hold no login', async () => {
    const { call, port, w } = await setup({ cookies: async () => [{ name: '_ga', domain: '.example.com', expires: -1 }] });
    await w.foreign(port, null, true);
    assert.strictEqual((await call('browser:health', ['shop'])).health.shop, 'out');
    await w.cleanup();
  });

  await t('release clears the session on the claim and leaves the claim record; no claim is a quiet no-op', async () => {
    const { cfg, call } = await setup();
    assert.deepStrictEqual(await call('browser:release', 'shop'), { success: true, released: false });
    configFile.updateJson(claimsPathFor(cfg), (file) => {
      file.profiles = { shop: { by: 'claude aaaa', surface: 'mcp', at: new Date().toISOString(), sessionId: 'aaaa-1111', pid: 1 } };
    }, () => ({ profiles: {} }));
    assert.deepStrictEqual(await call('browser:release', 'shop'), { success: true, released: true });
    const claim = configFile.readJson(claimsPathFor(cfg), () => ({ profiles: {} })).profiles.shop;
    assert.strictEqual(claim.sessionId, null);
    assert.strictEqual(claim.by, 'claude aaaa');
    assert.strictEqual((await call('browser:release', 'nope')).code, 'NOT_FOUND');
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
