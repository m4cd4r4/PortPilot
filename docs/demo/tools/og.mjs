// Renders docs/og-image.png (1200x630) from the logo and the demo-seed hero shot.
// Usage: node docs/demo/tools/og.mjs   (run from the repo root)
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
const { chromium } = require('playwright');
const logo = fs.readFileSync('public/icon.svg', 'utf8').replace(/width="512" height="512"/, 'width="72" height="72"');
const shot = 'data:image/png;base64,' + fs.readFileSync('docs/screenshots/hero-app.png').toString('base64');
const html = `<style>
body{margin:0;width:1200px;height:630px;overflow:hidden;background:radial-gradient(700px 400px at 90% 0%,rgba(122,162,247,.18),transparent 60%),#1a1b26;
font-family:'Segoe UI',sans-serif;color:#c0caf5;position:relative}
.t{position:absolute;left:72px;top:84px;width:520px}
.b{display:flex;align-items:center;gap:18px;font-size:34px;font-weight:700;margin-bottom:40px}
h1{font-size:58px;line-height:1.1;margin:0 0 24px;letter-spacing:-1px}
p{font-size:24px;color:#a9b1d6;margin:0}
img{position:absolute;left:640px;top:90px;width:760px;border-radius:14px;border:1px solid rgba(65,72,104,.8);box-shadow:0 20px 60px rgba(0,0,0,.5)}
.s{position:absolute;left:72px;bottom:64px;font:18px Consolas,monospace;color:#a9b1d6;background:#16161e;border:1px solid #2f3549;border-radius:8px;padding:10px 16px}
.r{color:#f7768e}</style>
<div class="t"><div class="b">${logo} PortPilot</div><h1>You and Claude Code, one view of what's running</h1><p>Dev servers, ports and crashes, shared with Claude Code.</p></div>
<img src="${shot}"><div class="s">&#9875; <span class="r">1 crashed</span> · 6 up · :3000 harbor-web</div>`;
const b = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html);
await p.screenshot({ path: 'docs/og-image.png' });
await b.close();
console.log('wrote docs/og-image.png');
