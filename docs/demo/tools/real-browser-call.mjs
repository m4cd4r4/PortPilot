// Usage: node real-browser-call.mjs
// Runs the real bundled MCP server against a throwaway config and profile folder:
// start_browser with `for`, then stop_browser. Prints the two results as JSON.
// A real (headed) Brave window opens for a moment on a free port and is stopped again.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { repo } from './lib.mjs';

const require = createRequire(import.meta.url);
const profiles = require(path.join(repo, 'src', 'core', 'browserProfiles.js'));

export async function realBrowserCall({ port = 9232 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-browser-'));
  const configPath = path.join(tmp, 'portpilot-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ apps: [], groups: [], settings: {} }));
  profiles.addProfile(configPath, {
    name: 'google', port, browser: 'brave', mode: 'headed',
    purpose: 'Google Search Console, Analytics', sites: ['search.google.com', 'analytics.google.com'],
    url: 'https://search.google.com/search-console',
  });
  profiles.addProfile(configPath, { name: 'github', port: port + 1, browser: 'brave', mode: 'headed', purpose: 'GitHub', sites: ['github.com'] });
  const server = path.join(repo, 'plugin', 'mcp', 'portpilot-mcp.mjs');
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORTPILOT_CONFIG_PATH: configPath }, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const t = setTimeout(() => reject(new Error(method + ' timed out')), 60000);
    pending.set(n, (m) => { clearTimeout(t); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'surface-shots', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).content[0].text);
  try {
    const started = await call('start_browser', { for: 'Google Search Console' });
    const stopped = await call('stop_browser', { name: 'google' });
    return { started, stopped };
  } finally {
    child.kill();
    try { await call; } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('real-browser-call.mjs')) {
  console.log(JSON.stringify(await realBrowserCall(), null, 1));
}
