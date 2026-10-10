/**
 * Smoke test for a packaged build: run the bundled MCP server under the
 * packaged Electron runtime (ELECTRON_RUN_AS_NODE, the same path main.js uses
 * when it forks the server) and check it answers initialize + tools/list.
 *
 * Run after `electron-builder --dir`:
 *   node tests/packaged-mcp-smoke.cjs            (finds dist/*-unpacked)
 *   node tests/packaged-mcp-smoke.cjs <unpacked dir>
 *
 * Catches a build that ships mcp-server/index.js without its node_modules.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const distDir = path.join(__dirname, '..', 'dist');
const unpacked = process.argv[2] ||
  fs.readdirSync(distDir).filter(d => d.endsWith('-unpacked')).map(d => path.join(distDir, d))[0];
if (!unpacked) fail(`no *-unpacked directory in ${distDir}`);

const exe = ['PortPilot.exe', 'portpilot', 'PortPilot']
  .map(name => path.join(unpacked, name))
  .find(p => fs.existsSync(p));
if (!exe) fail(`no PortPilot executable in ${unpacked}`);

const server = path.join(unpacked, 'resources', 'mcp-server', 'index.js');
const sdk = path.join(unpacked, 'resources', 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk');
if (!fs.existsSync(server)) fail(`missing ${server}`);
const browserApi = path.join(unpacked, 'resources', 'mcp-server', 'browserApi.cjs');
if (!fs.existsSync(browserApi)) fail(`missing ${browserApi} - the build did not ship the browser-profile tools (package.json build.extraResources)`);
if (!fs.existsSync(sdk)) fail(`missing ${sdk} - the build did not bundle mcp-server/node_modules`);

const child = spawn(exe, [server], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
let buf = '';
let stderr = '';

child.stderr.on('data', d => { stderr += d; });
child.on('exit', code => fail(`server exited early (code ${code})\n${stderr}`));
child.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      console.log(`✅ initialize: ${msg.result.serverInfo.name} ${msg.result.serverInfo.version}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } else if (msg.id === 2) {
      const count = msg.result?.tools?.length || 0;
      if (count === 0) fail('tools/list returned no tools');
      console.log(`✅ tools/list: ${count} tools`);
      const names = msg.result.tools.map(x => x.name);
      for (const n of ['list_browser_profiles', 'start_browser', 'stop_browser']) {
        if (!names.includes(n)) fail(`tools/list is missing ${n}`);
      }
      console.log('✅ browser-profile tools listed');
      child.removeAllListeners('exit');
      child.kill();
      process.exit(0);
    }
  }
});

setTimeout(() => fail(`timed out waiting for the server\n${stderr}`), 20000);
send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'packaged-smoke', version: '0' } },
});

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}
