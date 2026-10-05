/**
 * MCP HTTP mode must refuse DNS-rebinding and cross-origin requests.
 * Spawns the real server on a free loopback port and probes it over HTTP.
 *
 * Run: node tests/mcp-http-guard.test.mjs
 */
import assert from 'node:assert';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp-server', 'index.js');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'guard-test', version: '0' } },
});

function post(port, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(INIT);
  });
}

async function waitUp(port) {
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.message); fail++; }
}

const port = await freePort();
const child = spawn(process.execPath, [SERVER, '--port', String(port)], { stdio: 'ignore' });
try {
  await waitUp(port);

  await t('accepts Host 127.0.0.1:<port> with no Origin (Claude Code)', async () => {
    assert.equal(await post(port, {}), 200);
  });
  await t('accepts Host localhost:<port>', async () => {
    assert.equal(await post(port, { Host: `localhost:${port}` }), 200);
  });
  await t('rejects a rebound Host (DNS rebinding)', async () => {
    assert.equal(await post(port, { Host: `evil.example:${port}` }), 403);
  });
  await t('rejects a foreign Origin (cross-site browser call)', async () => {
    assert.equal(await post(port, { Origin: 'https://evil.example' }), 403);
  });
  await t('rejects Origin "null" (sandboxed iframe / file page)', async () => {
    assert.equal(await post(port, { Origin: 'null' }), 403);
  });
  await t('accepts a same-origin loopback Origin', async () => {
    assert.equal(await post(port, { Origin: `http://127.0.0.1:${port}` }), 200);
  });
} finally {
  child.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
