// Usage: node history-shot.mjs [outDir] [widths=1440,390]
// Loads the real renderer with demo-seed.js (fictional data) in Brave, opens the
// History tab and writes history-<width>.png. No backend, no real config.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const [out = path.join(repo, 'docs', 'demo', 'screenshots'), w = '1440,390'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
for (const width of w.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: width > 600 ? 1000 : 844 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.addInitScript({ path: path.join(repo, 'docs', 'demo', 'demo-seed.js') });
  await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
  await page.waitForSelector('.view-tab[data-view="history"]');
  await page.click('.view-tab[data-view="history"]');
  await page.waitForSelector('.hrow .hthumb img');
  await page.waitForTimeout(500);
  // The seed fires an Apps-view crash toast and a conflict toast; they are not part of this view.
  await page.evaluate(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; });
  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll('.hrow').length,
    thumbs: document.querySelectorAll('.hrow .hthumb img').length,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    footer: document.getElementById('history-footer').textContent,
    words: [...document.querySelectorAll('.hrow .state-word')].map((e) => e.textContent),
  }));
  console.log(width, JSON.stringify({ ...info, problems }));
  await page.screenshot({ path: path.join(out, `history-${width}.png`), fullPage: true });
  await page.close();
}
await browser.close();
