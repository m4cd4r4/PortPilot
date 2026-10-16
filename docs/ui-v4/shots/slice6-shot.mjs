// Slice 6 proof: the History screen on the demo seed. Flag off (v3 Active Ports), v4 dark and light.
// Usage: node slice6-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const cases = [
  ['v3-flag-off', 'v3', 'tokyonight'],
  ['v4-dark', 'v4', 'tokyonight'],
  ['v4-light', 'v4', 'light'],
];
const browser = await launch();
for (const width of [1440, 390]) {
  for (const [name, ui, theme] of cases) {
    const page = await newPage(browser, width, width > 600 ? 900 : 844);
    await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
    await page.addInitScript({ path: seedPath });
    await page.goto(`${url}?ui=${ui}`);
    await page.waitForSelector('.now-card, .app-card');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    let before = 'n/a';
    if (ui === 'v4') {
      await page.click('#v4-sidebar [data-section="history"]');
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(here, `slice6-${name}-${width}.png`) });
    const info = await page.evaluate(() => ({
      focus: document.querySelector('main.content').dataset.v4Focus || null,
      rows: document.querySelectorAll('.hrow').length,
      footer: document.getElementById('history-footer').textContent,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    console.log(width, name, JSON.stringify({ countBeforeVisit: before, ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
