/**
 * Browser profile card data: brand art picking (src/core/browserArt.js), sign-in health
 * (src/core/browserHealth.js) and the accounts field (src/core/browserProfiles.js).
 * Run: node tests/browser-art-health.test.cjs (part of npm run test:unit)
 */
const assert = require('assert');
const art = require('../src/core/browserArt');
const health = require('../src/core/browserHealth');
const { validateProfile } = require('../src/core/browserProfiles');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

console.log('\n=== browser art ===\n');

t('public host test refuses localhost, IPs, single labels and ports', () => {
  for (const h of ['localhost', 'app.localhost', '127.0.0.1', '192.168.1.5', 'intranet', 'printer.local', '[::1]', 'a.com:8080', '']) {
    assert.strictEqual(art.isPublicHost(h), false, h);
  }
  assert.strictEqual(art.isPublicHost('github.com'), true);
  assert.strictEqual(art.isPublicHost('Search.Google.com'), true);
});

t('pageUrlFor prefers the start url, falls back to the first public site, else null', () => {
  assert.strictEqual(art.pageUrlFor({ url: 'https://upwork.com/jobs', sites: ['x.com'] }), 'https://upwork.com/jobs');
  assert.strictEqual(art.pageUrlFor({ url: 'about:blank', sites: ['search.google.com'] }), 'https://search.google.com/');
  assert.strictEqual(art.pageUrlFor({ url: 'http://localhost:3000', sites: [] }), null);
  assert.strictEqual(art.pageUrlFor({ url: '', sites: ['localhost'] }), null);
  assert.strictEqual(art.pageUrlFor({ url: 'https://user:pw@example.com/' }), null);
  assert.strictEqual(art.pageUrlFor({ url: 'file:///c:/x.html' }), null);
});

t('og:image beats twitter:image beats touch icon beats icon beats /favicon.ico', () => {
  const html = `<head>
    <link rel="icon" href="/small.png" sizes="16x16">
    <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <meta property="og:image" content="/og.png">
  </head>`;
  const urls = art.artCandidates(html, 'https://example.com/').map((c) => c.url);
  assert.deepStrictEqual(urls, [
    'https://example.com/og.png', 'https://cdn.example.com/tw.jpg', 'https://example.com/touch.png', 'https://example.com/small.png', 'https://example.com/favicon.ico',
  ]);
  assert.strictEqual(art.artCandidates(html, 'https://example.com/')[0].kind, 'og');
});

t('attributes in any order, single quotes and entities are read', () => {
  const html = `<meta content='/a.png?x=1&amp;y=2' property='og:image'>`;
  assert.strictEqual(art.artCandidates(html, 'https://example.com/p')[0].url, 'https://example.com/a.png?x=1&y=2');
});

t('larger touch icons come first; candidates are not repeated', () => {
  const html = `<link rel="apple-touch-icon" href="/a.png" sizes="57x57"><link rel="apple-touch-icon" href="/b.png" sizes="180x180"><link rel="icon" href="/favicon.ico">`;
  const urls = art.artCandidates(html, 'https://example.com/').map((c) => c.url);
  assert.deepStrictEqual(urls, ['https://example.com/b.png', 'https://example.com/a.png', 'https://example.com/favicon.ico']);
});

t('non-public or non-http image URLs are dropped (javascript:, data:, localhost, internal IP)', () => {
  const html = `<meta property="og:image" content="javascript:alert(1)"><meta property="og:image" content="data:image/png;base64,AAAA"><meta property="og:image" content="http://127.0.0.1/x.png"><meta property="og:image" content="http://10.0.0.5/x.png">`;
  assert.deepStrictEqual(art.artCandidates(html, 'https://example.com/').map((c) => c.url), ['https://example.com/favicon.ico']);
  assert.deepStrictEqual(art.artCandidates('<html>', 'http://localhost:3000/'), []);
});

t('sniffImage accepts png, jpeg, webp, gif, ico and refuses svg, html and short buffers', () => {
  const pad = Buffer.alloc(16);
  const mk = (...b) => Buffer.concat([Buffer.from(b), pad]);
  assert.strictEqual(art.sniffImage(mk(0x89, 0x50, 0x4e, 0x47)).ext, 'png');
  assert.strictEqual(art.sniffImage(mk(0xff, 0xd8, 0xff, 0xe0)).ext, 'jpg');
  assert.strictEqual(art.sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])).ext, 'webp');
  assert.strictEqual(art.sniffImage(Buffer.concat([Buffer.from('GIF89a'), pad])).ext, 'gif');
  assert.strictEqual(art.sniffImage(mk(0, 0, 1, 0)).ext, 'ico');
  assert.strictEqual(art.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.strictEqual(art.sniffImage(Buffer.from('<!doctype html><html>')), null);
  assert.strictEqual(art.sniffImage(Buffer.alloc(4)), null);
});

console.log('\n=== browser health ===\n');

const NOW = 1_800_000_000;
const ck = (name, domain, expires = -1) => ({ name, domain, expires });

t('a live session cookie with a login name on the profile site is signed in', () => {
  assert.strictEqual(health.signInState([ck('sessionid', '.upwork.com')], ['www.upwork.com'], NOW), 'in');
  assert.strictEqual(health.signInState([ck('c_user', '.facebook.com', NOW + 1000)], ['facebook.com'], NOW), 'in');
  assert.strictEqual(health.signInState([ck('SAPISID', '.google.com', NOW + 1000)], ['search.google.com'], NOW), 'in');
});

t('tracking cookies and other sites do not count', () => {
  assert.strictEqual(health.signInState([ck('_ga', '.upwork.com'), ck('_fbp', '.upwork.com')], ['upwork.com'], NOW), 'out');
  assert.strictEqual(health.signInState([ck('sessionid', '.other.com')], ['upwork.com'], NOW), 'out');
  assert.strictEqual(health.signInState([], ['upwork.com'], NOW), 'out');
});

t('an expired cookie is not a login', () => {
  assert.strictEqual(health.signInState([ck('sessionid', '.upwork.com', NOW - 10)], ['upwork.com'], NOW), 'out');
});

t('no hosts or a non-list is unknown, not out', () => {
  assert.strictEqual(health.signInState([ck('sessionid', '.x.com')], [], NOW), 'unknown');
  assert.strictEqual(health.signInState(null, ['x.com'], NOW), 'unknown');
});

t('a name only contains the keyword is not enough: "session" matches, "sessions_total" does not', () => {
  assert.strictEqual(health.AUTH_NAME_RE.test('session'), true);
  assert.strictEqual(health.AUTH_NAME_RE.test('auth-token'), true);
  assert.strictEqual(health.AUTH_NAME_RE.test('sessions_total'), false);
  assert.strictEqual(health.AUTH_NAME_RE.test('authorised_ads'), false);
});

t('domainCoversHost handles the leading dot and refuses look-alikes', () => {
  assert.strictEqual(health.domainCoversHost('.example.com', 'www.example.com'), true);
  assert.strictEqual(health.domainCoversHost('example.com', 'example.com'), true);
  assert.strictEqual(health.domainCoversHost('example.com', 'notexample.com'), false);
});

t('hostsFor lists sites then the start url host, no repeats', () => {
  assert.deepStrictEqual(health.hostsFor({ sites: ['a.com'], url: 'https://A.com/x' }), ['a.com']);
  assert.deepStrictEqual(health.hostsFor({ sites: [], url: 'https://b.com/' }), ['b.com']);
  assert.deepStrictEqual(health.hostsFor({ url: 'about:blank' }), []);
});

console.log('\n=== accounts field ===\n');

const base = { name: 'x', port: 9300 };

t('accounts keep platform, username and note only, trimmed', () => {
  const p = validateProfile({ ...base, accounts: [{ platform: ' Upwork ', username: 'macdara', note: 'main', password: 'hunter2' }] });
  assert.deepStrictEqual(p.accounts, [{ platform: 'Upwork', username: 'macdara', note: 'main' }]);
});

t('blank rows are dropped and an empty list stores nothing', () => {
  assert.strictEqual(validateProfile({ ...base, accounts: [{ platform: '', username: '  ' }] }).accounts, undefined);
  assert.strictEqual(validateProfile({ ...base }).accounts, undefined);
});

t('too many, too long, or the wrong shape is refused with BAD_ACCOUNTS', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ platform: `p${i}` }));
  for (const accounts of [rows, [{ platform: 'x'.repeat(41) }], [{ username: 'u'.repeat(121) }], 'upwork', [5], [[]]]) {
    assert.throws(() => validateProfile({ ...base, accounts }), (e) => e.code === 'BAD_ACCOUNTS');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
