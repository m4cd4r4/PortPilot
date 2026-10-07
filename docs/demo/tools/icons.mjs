import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
const { chromium } = require('playwright');
const sizeOf = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
for (const f of ['public/icon.png','vscode-extension/media/icon.png','docs/og-image.png']) console.log('before', f, sizeOf(f));
const svg = fs.readFileSync('public/icon.svg', 'utf8').replace(/width="512" height="512"/, 'width="100%" height="100%"');
const b = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
const p = await b.newPage();
const out = { 'public/icon.png': 512, 'vscode-extension/media/icon.png': sizeOf('vscode-extension/media/icon.png')[0], 'docs/favicon-32.png': 32, 'docs/apple-touch-icon.png': 180, 'docs/logo-128.png': 128 };
for (const s of [16,32,64,128,256,512]) out[`public/icon-${s}.png`] = s;
for (const [f, s] of Object.entries(out)) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
  await p.screenshot({ path: f, omitBackground: true });
  console.log('wrote', f, s);
}
fs.copyFileSync('public/icon.svg', 'docs/favicon.svg');
await b.close();
