// Usage: node shot.mjs <url> <outPrefix> [widths=1440,390] [--sections]
import { createRequire } from 'module';
const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
const { chromium } = require('playwright');
const [url, out, w = '1440,390', flag] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
for (const width of w.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  // scroll through so reveal animations fire
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 400) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({ h: document.body.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth,
    sections: [...document.querySelectorAll('main > *, footer')].map(s => `${s.id || s.className.split(' ')[0]}:${Math.round(s.getBoundingClientRect().height)}`) }));
  console.log(width, JSON.stringify(info));
  await page.screenshot({ path: `${out}-${width}.png`, fullPage: true });
  if (flag === '--sections') {
    let i = 0;
    for (const el of await page.$$('main > *, footer')) { await el.screenshot({ path: `${out}-${width}-s${String(i++).padStart(2,'0')}.png` }); }
  }
  await page.close();
}
await browser.close();
