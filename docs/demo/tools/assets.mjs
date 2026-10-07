import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
const { chromium } = require('playwright');
const root = process.cwd(); const out = 'docs/screenshots';
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const b = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
async function open(w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.addInitScript({ path: 'docs/demo/demo-seed.js' });
  await p.goto(`http://localhost:${srv.address().port}/src/renderer/index.html`);
  await p.waitForTimeout(800); await p.evaluate(() => typeof loadApps === 'function' && loadApps()); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '.toast:not(.crash-toast){display:none!important}' });
  return p;
}
const union = async (p, sels, pad = 0) => {
  const bs = []; for (const s of sels) { const e = await p.$(s); bs.push(await e.boundingBox()); }
  const x = Math.min(...bs.map(b => b.x)) - pad, y = Math.min(...bs.map(b => b.y)) - pad;
  return { x, y, width: Math.max(...bs.map(b => b.x + b.width)) - x + pad, height: Math.max(...bs.map(b => b.y + b.height)) - y + pad };
};
let p = await open(1280, 820);
await p.screenshot({ path: `${out}/hero-app.png` });
await (await p.$('.crash-toast')).screenshot({ path: `${out}/crop-crash-toast.png` });
await p.close();
p = await open(820, 900);
const cards = await p.$$('.app-card');
const ids = await p.evaluate(() => [...document.querySelectorAll('.app-card')].map((c, i) => c.innerText.split('\n')[0] + '|' + i));
console.log(ids.join(' / '));
await p.screenshot({ path: `${out}/crop-row-state.png`, clip: await union(p, ['.app-card:nth-of-type(1)']).then(async () => {
  const bs = await Promise.all(cards.slice(0, 4).map(c => c.boundingBox()));
  return { x: bs[0].x, y: bs[0].y, width: bs[0].width, height: bs[3].y + bs[3].height - bs[0].y };
}) });
const conflict = cards.find(async () => true);
const ci = await p.evaluate(() => [...document.querySelectorAll('.app-card')].findIndex(c => c.innerText.includes('buoy-preview')));
await cards[ci].screenshot({ path: `${out}/crop-conflict.png` });
await b.close(); srv.close();
