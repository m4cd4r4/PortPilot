// Screenshot each .win in both mock-ups via raw CDP on a PortPilot-leased Brave profile.
import fs from 'node:fs';
const port = process.argv[2];
const dir = 'I:/Scratch/PortPilot-2026/docs/redesign';
for (const [tag, file] of [['a', 'mockup.html'], ['b', 'mockup-b.html']]) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?file:///${dir}/${file}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pend.get(m.id)?.(m.result); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => (ws.onopen = r));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 1500));
  for (const n of [1, 2, 3]) {
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const b=document.getElementById('w${n}').getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}})()` });
    const b = r.result.value;
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, captureBeyondViewport: true, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } });
    fs.writeFileSync(`${dir}/${tag}${n}.jpg`, Buffer.from(shot.data, 'base64'));
  }
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
  ws.close();
}
console.log('ok');
