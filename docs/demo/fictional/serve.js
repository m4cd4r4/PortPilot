// Serves one fictional demo site: node serve.js --site shop --port 3101
// Sites live in ./sites/<name>/ (index.html + icon.svg). No dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : ''; };
const site = arg('site');
const port = Number(arg('port'));
const dir = path.join(__dirname, 'sites', path.basename(site || ''));
if (!site || !port || !fs.existsSync(path.join(dir, 'index.html'))) {
  console.error('usage: node serve.js --site <name> --port <port>');
  process.exit(1);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const name = req.url === '/' || req.url.startsWith('/?') ? 'index.html' : path.basename(req.url.split('?')[0]);
  const file = path.join(dir, name);
  if (!TYPES[path.extname(file)] || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`${site} on http://localhost:${port}`));
