// Slice 1 proof: sidebar shell on the demo seed. Flag off (v3 tabs), v4 dark and light, and each sidebar item.
// Usage: node slice1-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const cases = [
  ['v3-flag-off', 'v3', 'tokyonight', null],
  ['v4-dark', 'v4', 'tokyonight', null],
  ['v4-light', 'v4', 'light', null],
  ['v4-dark-attention', 'v4', 'tokyonight', 'attention'],
  ['v4-dark-running', 'v4', 'tokyonight', 'running'],
  ['v4-dark-browsers', 'v4', 'tokyonight', 'browsers'],
  ['v4-dark-history', 'v4', 'tokyonight', 'history'],
];
const browser = await launch();
for (const width of [1440, 390]) {
  for (const [name, ui, theme, click] of cases) {
    const page = await newPage(browser, width, width > 600 ? 900 : 844);
    await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
    await page.addInitScript({ path: seedPath });
    await page.goto(`${url}?ui=${ui}`);
    await page.waitForSelector('.app-card, .app-row');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    if (click) {
      await page.click(`#v4-sidebar [data-section="${click}"]`);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(here, `slice1-${name}-${width}.png`) });
    const info = await page.evaluate(() => ({
      sidebarShown: (() => { const s = document.getElementById('v4-sidebar'); return !!s && getComputedStyle(s).display !== 'none'; })(),
      items: [...document.querySelectorAll('#v4-sidebar [data-section]')].map(e => e.textContent.trim().replace(/\s+/g, ' ')),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
