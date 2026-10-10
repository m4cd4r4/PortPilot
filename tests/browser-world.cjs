/**
 * Fakes shared by the browser-profile surface tests: a pretend machine whose browser is a real
 * local HTTP server answering CDP's /json/version and /json. Spawn, port inspection and kill are
 * faked; no browser is launched. (Same pattern as tests/browser-run.test.cjs.)
 */
const http = require('http');
const net = require('net');
const run = require('../src/core/browserRun');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Servers on a port: `cdpServer` answers /json/version and /json like a browser; a foreign one is plain 404.
function listen(port, isCdp) {
  const server = http.createServer((req, res) => {
    if (isCdp && req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: 'FakeBrowser/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` }));
    } else if (isCdp && req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 't1', type: 'page', title: 'Start', url: 'https://example.test/' }]));
    } else {
      res.statusCode = 404;
      res.end('no');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
const closeServer = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

// A pretend machine: holders of ports, calls recorded, behaviour switches.
function world({ installed = [{ id: 'brave', label: 'Brave', path: '/fake/brave' }] } = {}) {
  const w = {
    servers: new Map(), holders: new Map(), spawned: [], killed: [], parked: [],
    closeWorks: true, neverListens: false, spawnThrows: null, pid: 5000,
  };
  w.deps = {
    ...run.defaultDeps(),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    detect: () => installed,
    spawn(exe, args) {
      w.spawned.push({ exe, args });
      const pid = ++w.pid;
      const child = { pid, unref() {}, on(ev, cb) { if (ev === 'error' && w.spawnThrows) setImmediate(() => cb(w.spawnThrows)); } };
      if (w.neverListens || w.spawnThrows) return child;
      const port = Number(args.find((a) => a.startsWith('--remote-debugging-port=')).split('=')[1]);
      if (w.takenDuringStart) {
        w.foreign(port, w.takenDuringStart, true);
        return child;
      }
      w.holders.set(port, { pid, processName: 'fake-browser', commandLine: `${exe} ${args.join(' ')}` });
      listen(port, true).then((s) => w.servers.set(port, s));
      return child;
    },
    inspectPort: async (port) => w.holders.get(port) || null,
    closeBrowser: async (port) => {
      if (!w.closeWorks) return false;
      await w.drop(port);
      return true;
    },
    kill: async (pid) => {
      w.killed.push(pid);
      for (const [port, h] of w.holders) if (h.pid === pid) await w.drop(port);
    },
    park: async (port, left) => { w.parked.push({ port, left }); return { parked: true, left }; },
  };
  w.drop = async (port) => {
    const s = w.servers.get(port);
    w.holders.delete(port);
    w.servers.delete(port);
    if (s) await closeServer(s);
  };
  // Something unrelated already listening there (not CDP).
  w.foreign = async (port, holder, isCdp = false) => {
    w.holders.set(port, holder);
    w.servers.set(port, await listen(port, isCdp));
  };
  w.cleanup = async () => { for (const p of [...w.servers.keys()]) await w.drop(p); };
  return w;
}

module.exports = { freePort, listen, closeServer, world };
