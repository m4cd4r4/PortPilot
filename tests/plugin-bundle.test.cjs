/**
 * The plugin ships a prebuilt MCP server (plugin/mcp/, from
 * scripts/build-plugin.mjs) because a plugin installed from git gets no
 * `npm install`. Two checks:
 *   1. the committed bundle matches a fresh build of mcp-server/index.js
 *   2. copied to a folder with no node_modules and no src/core above it, the
 *      bundle answers initialize + tools/list over stdio
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let child = null;

const fresh = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-plugin.mjs'), '--check'], { encoding: 'utf8' });
if (fresh.status !== 0) fail(fresh.stderr || fresh.stdout);
console.log('✅ plugin/mcp matches a fresh build');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-plugin-run-'));
for (const f of fs.readdirSync(path.join(root, 'plugin', 'mcp'))) {
  fs.copyFileSync(path.join(root, 'plugin', 'mcp', f), path.join(dir, f));
}

child = spawn(process.execPath, [path.join(dir, 'portpilot-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
let buf = '';
let stderr = '';

child.stderr.on('data', d => { stderr += d; });
child.on('exit', code => fail(`bundle exited early (code ${code})\n${stderr}`));
child.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      console.log(`✅ standalone initialize: ${msg.result.serverInfo.name} ${msg.result.serverInfo.version}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } else if (msg.id === 2) {
      const count = msg.result?.tools?.length || 0;
      if (count === 0) fail('tools/list returned no tools');
      console.log(`✅ standalone tools/list: ${count} tools`);
      done(0);
    }
  }
});

const timer = setTimeout(() => fail(`timed out waiting for the bundle\n${stderr}`), 20000);
send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-bundle-test', version: '0' } },
});

function done(code) {
  clearTimeout(timer);
  child.removeAllListeners('exit');
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

function fail(message) {
  console.error(`❌ ${message}`);
  if (child) done(1);
  process.exit(1);
}
