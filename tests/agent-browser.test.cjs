/**
 * Browser-profile tools over the web agent's HTTP routes: POST /api/browser/<tool>.
 * Run: node tests/agent-browser.test.cjs (part of npm run test:unit)
 *
 * A real agent on a free loopback port, a throwaway config, and the fake machine from
 * tests/browser-world.cjs: no browser is launched.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const bp = require('../src/core/browserProfiles');
const api = require('../src/core/browserApi');
const { createAgent } = require('../src/agent/server');
const { freePort, world } = require('./browser-world.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-abrowser-'));
let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); passed++; } catch (err) { console.log(`❌ ${name}\n     ${err.stack || err.message}`); failed++; }
}

function post(port, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: route, method: headers.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, raw }); });
    });
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}

(async () => {
  const cfg = path.join(root, 'portpilot-config.json');
  const profilePort = await freePort();
  bp.addProfile(cfg, { name: 'shop-a', port: profilePort, browser: 'brave', url: 'https://example.test/' });
  const w = world();
  const agentPort = await freePort();
  const token = 'a'.repeat(64);
  const agent = createAgent({ configStore: { configPath: cfg }, port: agentPort, token, browserDeps: w.deps });
  await agent.start();
  const auth = { 'x-portpilot-token': token };

  console.log('\n=== agent: browser routes ===\n');

  await t('no token -> 401', async () => {
    const r = await post(agentPort, '/api/browser/list_browser_profiles', {});
    assert.strictEqual(r.status, 401);
  });

  await t('wrong token -> 401', async () => {
    const r = await post(agentPort, '/api/browser/list_browser_profiles', {}, { 'x-portpilot-token': 'b'.repeat(64) });
    assert.strictEqual(r.status, 401);
  });

  await t('rebound Host -> 403 (DNS rebinding), even with the token', async () => {
    const r = await post(agentPort, '/api/browser/list_browser_profiles', {}, { ...auth, Host: `evil.example:${agentPort}` });
    assert.strictEqual(r.status, 403);
  });

  await t('foreign Origin -> 403, even with the token', async () => {
    const r = await post(agentPort, '/api/browser/list_browser_profiles', {}, { ...auth, Origin: 'https://evil.example' });
    assert.strictEqual(r.status, 403);
  });

  await t('GET -> 405, never reaches a tool', async () => {
    const r = await post(agentPort, '/api/browser/start_browser', '', { ...auth, method: 'GET' });
    assert.strictEqual(r.status, 405);
    assert.strictEqual(w.spawned.length, 0);
  });

  await t('bad JSON -> 400', async () => {
    const r = await post(agentPort, '/api/browser/start_browser', '{nope', auth);
    assert.strictEqual(r.status, 400);
  });

  await t('unknown tool -> 404 with the tool list as the action', async () => {
    const r = await post(agentPort, '/api/browser/launch_browser', {}, auth);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.code, 'UNKNOWN_TOOL');
    assert.ok(/start_browser/.test(r.json.action));
  });

  await t('a malformed percent escape in the path is an unknown tool, not a crash', async () => {
    const r = await post(agentPort, '/api/browser/%E0%A4%A', {}, auth);
    assert.strictEqual(r.status, 404);
  });

  await t('start_browser over HTTP returns the same shape as the direct call, with the port and cdpUrl', async () => {
    const r = await post(agentPort, '/api/browser/start_browser', { name: 'shop-a', agent: 'local-llm' }, auth);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.port, profilePort);
    assert.strictEqual(r.json.cdpUrl, `http://127.0.0.1:${profilePort}`);
    assert.strictEqual(r.json.claim.by, 'local-llm');
    assert.strictEqual(r.json.claim.surface, 'http');
    const direct = await api.call(cfg, 'start_browser', { name: 'shop-a', agent: 'local-llm' }, { surface: 'http', deps: w.deps });
    assert.deepStrictEqual(Object.keys(direct).sort(), Object.keys({ ...r.json, already: true }).sort());
  });

  await t('a second HTTP caller sees the claim and is not blocked', async () => {
    const r = await post(agentPort, '/api/browser/start_browser', { name: 'shop-a', agent: 'other' }, auth);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.already, true);
    assert.strictEqual(r.json.claim.by, 'local-llm');
    assert.ok(/local-llm/.test(r.json.claimNote));
  });

  await t('list_browser_profiles over HTTP equals the direct call', async () => {
    const r = await post(agentPort, '/api/browser/list_browser_profiles', {}, auth);
    const direct = await api.call(cfg, 'list_browser_profiles', {}, { surface: 'http', deps: w.deps });
    assert.deepStrictEqual(r.json, direct);
  });

  await t('stop_browser over HTTP stops it', async () => {
    const r = await post(agentPort, '/api/browser/stop_browser', { name: 'shop-a' }, auth);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.state, 'down');
  });

  await t('a port held by another process is an error body naming the holder, over HTTP too', async () => {
    await w.foreign(profilePort, { pid: 777, processName: 'node.exe', commandLine: 'node dev-server.js' });
    const r = await post(agentPort, '/api/browser/start_browser', { name: 'shop-a' }, auth);
    assert.strictEqual(r.json.success, false);
    assert.strictEqual(r.json.code, 'PORT_HELD');
    assert.ok(/node\.exe/.test(r.json.error) && /777/.test(r.json.error));
    assert.deepStrictEqual(w.killed, []);
  });

  await agent.stop();
  await w.cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
