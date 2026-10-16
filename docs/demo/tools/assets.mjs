// Usage: node docs/demo/tools/assets.mjs   (run from the repo root)
// The v4 UI on the demo seed, in Brave: the site's hero and its four crops, written to docs/screenshots/.
// hero-app, crop-crash-toast, crop-row-state, crop-conflict at 2x; crop-history at 1x. Prints each size in CSS px
// so the width/height on the <img> tags in docs/index.html can be checked.
import { createRequire } from 'module';
import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
const { chromium } = require('playwright');
const root = process.cwd(); const out = 'docs/screenshots';
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const b = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
async function open(w, h, scale = 2) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.addInitScript({ path: 'docs/demo/demo-seed.js' });
  await p.goto(`http://localhost:${srv.address().port}/src/renderer/index.html?ui=v4`);
  await p.waitForSelector('.now-card, .app-card');
  await p.waitForSelector('.crash-toast');
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '.toast:not(.crash-toast){display:none!important}' });
  return p;
}
const sizeOf = (n) => { const d = fs.readFileSync(`${out}/${n}.png`); return `${n}: ${d.readUInt32BE(16)}x${d.readUInt32BE(20)} px`; };
const log = [];
let p = await open(1280, 820);
await p.screenshot({ path: `${out}/hero-app.png` });
await (await p.$('.crash-toast')).screenshot({ path: `${out}/crop-crash-toast.png` });
await p.addStyleTag({ content: '.toast{display:none!important}' });
const alert = await p.evaluateHandle(() => [...document.querySelectorAll('.v4-alert')].find((c) => c.innerText.includes('alight')));
await alert.asElement().screenshot({ path: `${out}/crop-conflict.png` });
await p.click('.v4-nav-item[data-section="apps"]');
await p.waitForSelector('.app-card');
await p.waitForTimeout(500);
const cards = await p.$$('.app-card');
const bs = await Promise.all(cards.slice(0, 4).map((c) => c.boundingBox()));
await p.screenshot({ path: `${out}/crop-row-state.png`, clip: { x: 236, y: bs[0].y, width: bs[0].x + bs[0].width - 236 + 6, height: bs[3].y + bs[3].height - bs[0].y } });
await p.close();

p = await open(1440, 900, 1);
await p.click('.v4-nav-item[data-section="history"]');
await p.waitForSelector('.hrow .hthumb img');
await p.waitForTimeout(500);
await p.addStyleTag({ content: '.toast{display:none!important}' });
const rows = await p.$$('.hrow');
const hb = await Promise.all(rows.slice(0, 4).map((r) => r.boundingBox()));
await p.screenshot({ path: `${out}/crop-history.png`, clip: { x: 220, y: hb[0].y - 12, width: 1220, height: hb[3].y + hb[3].height - hb[0].y + 24 } });
await b.close(); srv.close();
for (const n of ['hero-app', 'crop-crash-toast', 'crop-row-state', 'crop-conflict', 'crop-history']) log.push(sizeOf(n));
console.log(log.join('\n'));
