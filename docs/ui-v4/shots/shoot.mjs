// Screenshots every direction x state of canvas.html via raw CDP (Brave from PortPilot).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const canvas = 'file:///' + path.resolve(here, '..', 'canvas.html').replace(/\\/g, '/');
const base = process.argv[2] || 'http://127.0.0.1:9222';
const tgt = await (await fetch(base + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });
const combos = [];
for (const d of ['A', 'B', 'C']) for (const s of ['home', 'clean', 'empty']) combos.push([d, s, '']);
for (const s of ['home', 'clean', 'empty']) { combos.push(['A', s, 'light']); combos.push(['B', s, 'dark']); }
for (const [d, s, t] of combos) {
  await send('Page.navigate', { url: `${canvas}?d=${d}&s=${s}${t ? '&t=' + t : ''}` });
  await new Promise(r => setTimeout(r, 700));
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 150, width: 1700, height: 830, scale: 1 } });
  fs.writeFileSync(path.join(here, `${d}-${s}${t ? '-' + t : ''}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log('saved', d, s);
}
await fetch(base + '/json/close/' + tgt.id);
ws.close();
