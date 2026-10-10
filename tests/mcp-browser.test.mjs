/**
 * The browser-profile MCP tools, over real stdio JSON-RPC against the real server.
 * A throwaway config (PORTPILOT_CONFIG_PATH) holds the profiles; no browser is launched: the
 * port-held case is a plain HTTP listener in this process, and the real port inspection names it.
 *
 * Run: node tests/mcp-browser.test.mjs   (part of npm run test:mcp)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const profiles = require('../src/core/browserProfiles');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.stack || e.message); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portpilot-mcpb-'));
const cfg = path.join(dir, 'portpilot-config.json');
const profilePort = await freePort();
profiles.addProfile(cfg, { name: 'shop-a', port: profilePort, browser: 'brave', url: 'https://example.test/' });

const child = spawn(process.execPath, [path.join(here, '..', 'mcp-server', 'index.js')], {
  env: { ...process.env, PORTPILOT_CONFIG_PATH: cfg }, stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const pending = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let nextId = 0;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => reject(new Error(`no answer to ${method}\n${stderr}`)), 20000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const tool = async (name, args) => {
  const m = await rpc('tools/call', { name, arguments: args });
  return { isError: !!m.result.isError, body: JSON.parse(m.result.content[0].text) };
};

let blocker;
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'browser-test', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  await t('tools/list carries the five browser tools', async () => {
    const m = await rpc('tools/list', {});
    const names = m.result.tools.map((x) => x.name);
    for (const n of ['list_browser_profiles', 'list_browsers', 'start_browser', 'stop_browser', 'set_browser_mode']) {
      assert.ok(names.includes(n), `${n} missing`);
    }
  });

  await t('list_browser_profiles returns the profile with its port and cdpUrl', async () => {
    const { isError, body } = await tool('list_browser_profiles', {});
    assert.strictEqual(isError, false);
    assert.strictEqual(body.profiles[0].name, 'shop-a');
    assert.strictEqual(body.profiles[0].cdpUrl, `http://127.0.0.1:${profilePort}`);
    assert.strictEqual(body.profiles[0].state, 'down');
  });

  await t('an unknown profile is an error result with code, sentence and action', async () => {
    const { isError, body } = await tool('start_browser', { name: 'nope' });
    assert.strictEqual(isError, true);
    assert.strictEqual(body.code, 'NOT_FOUND');
    assert.deepStrictEqual(body.known, ['shop-a']);
    assert.ok(body.error && body.action);
  });

  await t('a port held by another process: PORT_HELD names the holder and nothing starts', async () => {
    blocker = http.createServer((q, r) => r.end('no'));
    await new Promise((resolve) => blocker.listen(profilePort, '127.0.0.1', resolve));
    const { isError, body } = await tool('start_browser', { name: 'shop-a', agent: 'mcp-test' });
    assert.strictEqual(isError, true);
    assert.strictEqual(body.code, 'PORT_HELD');
    assert.ok(body.error.includes(String(process.pid)), body.error);
    assert.strictEqual(body.holder.pid, process.pid);
    const listed = await tool('list_browser_profiles', {});
    assert.strictEqual(listed.body.profiles[0].state, 'blocked');
    assert.ok(listed.body.profiles[0].warning);
  });

  await t('stop_browser on that blocked port is refused with NOT_OURS', async () => {
    const { isError, body } = await tool('stop_browser', { name: 'shop-a' });
    assert.strictEqual(isError, true);
    assert.strictEqual(body.code, 'NOT_OURS');
    assert.ok(blocker.listening, 'the other process is untouched');
  });

  await t('set_browser_mode persists a mode and rejects a bad one with the valid list', async () => {
    const ok = await tool('set_browser_mode', { name: 'shop-a', mode: 'offscreen' });
    assert.strictEqual(ok.body.mode, 'offscreen');
    assert.strictEqual(profiles.getProfile(cfg, 'shop-a').mode, 'offscreen');
    const bad = await tool('set_browser_mode', { name: 'shop-a', mode: 'invisible' });
    assert.strictEqual(bad.isError, true);
    assert.strictEqual(bad.body.code, 'BAD_MODE');
  });

  await t('list_browsers answers', async () => {
    const { isError, body } = await tool('list_browsers', {});
    assert.strictEqual(isError, false);
    assert.ok(Array.isArray(body.browsers));
  });
} finally {
  child.kill();
  if (blocker) blocker.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
