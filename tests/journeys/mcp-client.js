/**
 * A minimal MCP client over Streamable HTTP for journeys, as Claude Code is one: its own MCP session.
 * Same as the one in claude-sessions.journey.js (which keeps its own copy for now).
 *
 * Each POST gets a fresh connection: with fetch (kept-alive sockets) runs died on ECONNRESET as the
 * server's 5 s keep-alive timer closed a reused socket.
 */
const http = require('http');

/** Ports the developer's own PortPilot and browsers use: a journey never talks MCP to them. */
const devPort = (p) => !(p > 0) || p === 8788 || (p >= 9222 && p <= 9241);

function post(port, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false, headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: 90000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => req.destroy(new Error('no answer in 90 s')));
    req.on('error', reject);
    req.end(body);
  });
}

async function mcpClient(port) {
  if (devPort(port)) throw new Error(`refusing to talk MCP to :${port}: not the journey's own port`);
  let sid = null;
  let id = 0;
  async function rpc(method, params, notify = false) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sid) headers['mcp-session-id'] = sid;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
    const r = await post(port, headers, JSON.stringify(body));
    sid = r.headers['mcp-session-id'] || sid;
    if (notify) return null;
    if (r.status < 200 || r.status > 299) throw new Error(`MCP ${method}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
    const msgs = /text\/event-stream/.test(r.headers['content-type'] || '')
      ? r.text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
      : [JSON.parse(r.text)];
    const msg = msgs.find((m) => m.id === body.id);
    if (!msg) throw new Error(`MCP ${method}: no answer in ${r.text.slice(0, 200)}`);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: 'journey' } });
  await rpc('notifications/initialized', {}, true);
  return {
    async tool(name, args) {
      const res = await rpc('tools/call', { name, arguments: args });
      const text = (res.content && res.content[0] && res.content[0].text) || '';
      let body = text;
      try { body = JSON.parse(text); } catch { /* plain text answer */ }
      return { isError: !!res.isError, body };
    },
  };
}

module.exports = { mcpClient, devPort };
