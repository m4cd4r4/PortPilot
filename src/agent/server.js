#!/usr/bin/env node
/**
 * PortPilot Web Agent (v3 preview)
 *
 * A hardened loopback HTTP server that exposes PortPilot's backend to a browser
 * UI. Can run two ways:
 *   - Standalone:  `npm run agent`  (its own ConfigStore)
 *   - Embedded:    createAgent({ configStore }) from the Electron main process,
 *                  sharing the desktop app's ConfigStore + process table.
 *
 * Defence layers (see SECURITY.md) - deliberately combined, none relied on alone:
 *   1. Binds to 127.0.0.1 ONLY              -> not reachable off-box.
 *   2. Per-session 256-bit token            -> required on every /api & /events.
 *   3. Host-header allowlist                -> defeats DNS-rebinding.
 *   4. Origin allowlist + locked CORS       -> blocks cross-origin browser calls.
 *   5. Custom header forces CORS preflight  -> "simple request" CSRF can't reach /api.
 *   6. Strict CSP on the served UI          -> no remote scripts / exfiltration.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { createDispatcher } = require('../core/dispatch');
const { getConfigDir } = require('../core/configPath');

const HOST = '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.PORTPILOT_AGENT_PORT || '7317', 10);

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const CORE_DIR = path.join(__dirname, '..', 'core');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };

/**
 * Build (but don't start) an agent bound to a ConfigStore.
 * @returns {{ start: Function, stop: Function, getInfo: Function }}
 */
function createAgent({ configStore, port = DEFAULT_PORT, token = crypto.randomBytes(32).toString('hex') }) {
  const dispatch = createDispatcher(configStore);
  const sseClients = new Set();

  const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

  // ---- Security helpers (close over this instance's port + token) ----
  const tokenOk = (provided) => {
    if (typeof provided !== 'string' || provided.length !== token.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token)); } catch { return false; }
  };
  const hostOk = (req) => allowedHosts.has((req.headers.host || '').toLowerCase());
  const originOk = (req) => {
    const origin = req.headers.origin;
    return !origin || allowedOrigins.has(origin.toLowerCase());
  };
  const setSecurityHeaders = (res, req) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin.toLowerCase())) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PortPilot-Token');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  };

  const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });

  // ---- Static UI: reuse the desktop renderer verbatim, inject token + shim ----
  const serveIndex = (res) => {
    let html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
    html = html.replace('</head>', `  <meta name="pp-token" content="${token}">\n</head>`);
    html = html.replace('<script src="renderer.js"></script>',
      '<script src="portpilot-web.js"></script>\n  <script src="renderer.js"></script>');
    send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  };
  const serveStatic = (res, file, dir) => {
    const full = path.join(dir, file);
    if (!path.resolve(full).startsWith(path.resolve(dir))) return send(res, 403, 'Forbidden');
    fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    });
  };

  // ---- Live updates: push config changes (e.g. MCP edits) to the browser ----
  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) { try { client.write(msg); } catch { /* dropped */ } }
  };
  const prevOnChange = configStore.onConfigChange;
  configStore.onConfigChange = (payload) => {
    if (typeof prevOnChange === 'function') { try { prevOnChange(payload); } catch { /* ignore */ } }
    broadcast('config-changed', payload);
  };

  const server = http.createServer((req, res) => {
    // (3) Host allowlist first - rejects DNS-rebinding before anything else.
    if (!hostOk(req)) return send(res, 403, 'Forbidden: bad Host header');
    setSecurityHeaders(res, req);
    if (req.method === 'OPTIONS') return send(res, 204, '');

    // ---- API ----
    if (req.url === '/api' && req.method === 'POST') {
      if (!originOk(req)) return sendJson(res, 403, { success: false, error: 'Bad origin' });
      if (!tokenOk(req.headers['x-portpilot-token'])) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
      let raw = '', tooBig = false;
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) { tooBig = true; req.destroy(); } });
      req.on('end', async () => {
        if (tooBig) return;
        let payload;
        try { payload = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
        const { action, args } = payload;
        if (typeof action !== 'string') return sendJson(res, 400, { success: false, error: 'Missing action' });
        sendJson(res, 200, await dispatch(action, Array.isArray(args) ? args : []));
      });
      return;
    }

    // ---- SSE (token via query: EventSource can't set headers; still Host+Origin+token checked) ----
    if (req.url.startsWith('/events') && req.method === 'GET') {
      if (!originOk(req)) return send(res, 403, 'Bad origin');
      const q = new URL(req.url, `http://${HOST}:${port}`).searchParams;
      if (!tokenOk(q.get('token'))) return send(res, 401, 'Unauthorized');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      res.write(': connected\n\n');
      sseClients.add(res);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* ignore */ } }, 25000);
      req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }

    // ---- Static UI (GET only; protected by Host check above) ----
    if (req.method === 'GET') {
      if (req.url === '/' || req.url === '/index.html') return serveIndex(res);
      if (req.url === '/portpilot-web.js') return serveStatic(res, 'portpilot-web.js', PUBLIC_DIR);
      if (req.url === '/renderer.js') return serveStatic(res, 'renderer.js', RENDERER_DIR);
      if (req.url === '/styles.css') return serveStatic(res, 'styles.css', RENDERER_DIR);
      // The renderer loads the shared status/classification model as a browser
      // global (it can't require under CSP). Without this route it 404s and
      // window.PortPilotStatus is undefined -> classify() throws on scan.
      if (req.url === '/core/status.js') return serveStatic(res, 'status.js', CORE_DIR);
      if (req.url === '/core/conflict.js') return serveStatic(res, 'conflict.js', CORE_DIR);
    }
    send(res, 404, 'Not found');
  });

  const info = () => ({ host: HOST, port, token, url: `http://${HOST}:${port}/` });

  return {
    start() {
      return new Promise((resolve, reject) => {
        const onErr = (err) => reject(err);
        server.once('error', onErr);
        server.listen(port, HOST, () => { server.removeListener('error', onErr); resolve(info()); });
      });
    },
    stop() {
      for (const c of sseClients) { try { c.end(); } catch { /* ignore */ } }
      sseClients.clear();
      // restore the previous onConfigChange so we don't leak this instance
      configStore.onConfigChange = prevOnChange;
      return new Promise((resolve) => server.close(resolve));
    },
    getInfo: info
  };
}

// ---- Cross-platform browser launch (best-effort) ----
function openBrowser(url) {
  const { spawn } = require('child_process');
  try {
    if (os.platform() === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (os.platform() === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* headless / no browser - URL is printed anyway */ }
}

// ---- Standalone CLI ----
async function main() {
  const { ConfigStore } = require('../main/configStore');
  const { findAvailablePort } = require('../main/portScanner');
  const configStore = new ConfigStore(null);
  // Auto-pick a free port from the default up so a busy 7317 doesn't error out.
  const port = (await findAvailablePort(DEFAULT_PORT)) || DEFAULT_PORT;
  const agent = createAgent({ configStore, port });
  let started;
  try {
    started = await agent.start();
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Set PORTPILOT_AGENT_PORT to choose another.`);
      process.exit(1);
    }
    throw err;
  }

  // Persist {port, token} for tooling, readable only by the user.
  let file = null;
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'agent.json');
    fs.writeFileSync(file, JSON.stringify({ ...started, pid: process.pid }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* non-POSIX */ }
  } catch (e) { console.error('Could not write agent.json:', e.message); }

  console.log('\n  PortPilot Web Agent running (loopback only)\n');
  console.log(`  →  ${started.url}`);
  console.log('\n  Bound to 127.0.0.1 and protected by a per-session token.');
  if (file) console.log(`  Token also written to ${file} (chmod 600).`);
  console.log('  Press Ctrl+C to stop.\n');

  if (!process.env.PORTPILOT_NO_OPEN && !process.argv.includes('--no-open')) openBrowser(started.url);

  const agentJson = path.join(getConfigDir(), 'agent.json');
  // Sync best-effort removal on any normal process exit. Covers Windows, where a
  // force-terminate (TerminateProcess) skips the async handlers below.
  process.on('exit', () => { try { fs.rmSync(agentJson, { force: true }); } catch { /* ignore */ } });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Hard exit even if cleanup hangs, so a stop never wedges the process.
    setTimeout(() => process.exit(0), 3000).unref();
    try { fs.rmSync(agentJson, { force: true }); } catch { /* ignore */ }
    // Opt-in: also stop the dev servers this agent started (mirrors the desktop
    // app's stopAppsOnQuit). Off by default, so dev servers survive a portal stop.
    if (process.env.PORTPILOT_STOP_APPS_ON_EXIT === '1') {
      try { await require('../main/processManager').cleanupAllProcesses(); } catch { /* ignore */ }
    }
    try { await agent.stop(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // When embedded by the VS Code extension we are spawned with an IPC channel.
  // SIGTERM is not a real signal on Windows (it force-terminates without running
  // the handler), so the extension sends a 'shutdown' message for a graceful
  // stop that honours PORTPILOT_STOP_APPS_ON_EXIT. 'disconnect' fires if the
  // parent (the extension host) dies, so we self-exit instead of orphaning.
  process.on('message', (m) => { if (m && m.type === 'shutdown') void shutdown(); });
  process.on('disconnect', () => void shutdown());
}

module.exports = { createAgent, openBrowser, DEFAULT_PORT };

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
