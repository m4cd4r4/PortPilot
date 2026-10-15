// Usage: node browsers-shot.mjs [outDir] [widths=1440,390]
// The real Browsers tab on the demo seed: running debug browsers with their ports, a held port, stopped profiles.
// Writes browsers-<width>.png and, at 1440, crop-browsers.png (the profile rows only).
import path from 'path';
import { pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath, shotsDir } from './lib.mjs';

const [out = shotsDir, w = '1440,390'] = process.argv.slice(2);
const browser = await launch();
for (const width of w.split(',').map(Number)) {
  const page = await newPage(browser, width, width > 600 ? 900 : 844);
  await page.addInitScript({ path: seedPath });
  await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
  await page.waitForSelector('.app-card');
  await page.click('.view-tab[data-view="browsers"]');
  await page.waitForSelector('.brow');
  await page.addStyleTag({ content: '.toast{display:none!important}' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `browsers-${width}.png`), fullPage: true });
  const info = await page.evaluate(() => ({ rows: document.querySelectorAll('.brow').length, summary: document.getElementById('browsers-summary').textContent, overflowX: document.documentElement.scrollWidth > innerWidth }));
  console.log(width, JSON.stringify({ ...info, problems: page.problems }));
  await page.close();
}
await browser.close();
