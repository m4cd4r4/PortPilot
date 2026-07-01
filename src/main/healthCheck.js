/**
 * Liveness probe for a locally running app.
 *
 * Does a short-timeout HTTP GET against 127.0.0.1:<port><path> and classifies
 * the result. Used to tell "the port is open" apart from "the app is actually
 * responding", so a hung/erroring dev server can surface as unhealthy rather
 * than looking fine just because it holds the socket.
 */
const http = require('http');

/**
 * @param {number} port
 * @param {string} [healthPath='/']
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<'healthy'|'unhealthy'|'down'>}
 *   healthy   - responded 2xx/3xx
 *   unhealthy - responded, but 4xx/5xx
 *   down      - nothing listening / connection refused / timed out
 */
function probe(port, healthPath = '/', timeoutMs = 2000) {
  const p = parseInt(port, 10);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return Promise.resolve('down');
  const reqPath = healthPath && healthPath.startsWith('/') ? healthPath : `/${healthPath || ''}`;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };

    const req = http.get(
      { host: '127.0.0.1', port: p, path: reqPath, timeout: timeoutMs },
      (res) => {
        const code = res.statusCode || 0;
        res.resume(); // drain so the socket can close
        done(code >= 200 && code < 400 ? 'healthy' : 'unhealthy');
      }
    );
    req.on('timeout', () => { req.destroy(); done('down'); });
    req.on('error', () => done('down'));
  });
}

module.exports = { probe };
