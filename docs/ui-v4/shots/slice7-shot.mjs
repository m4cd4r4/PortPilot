// Slice 7 proof: Settings panel and the Add app dialog on the demo seed. Flag off (v3), v4 dark and light,
// plus a v4 run that starts with a retired v3 theme saved (nord): it must read as Auto without being overwritten.
// Usage: node slice7-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const cases = [
  ['v3-flag-off', 'v3', 'tokyonight'],
  ['v4-dark', 'v4', 'tokyonight'],
  ['v4-light', 'v4', 'light'],
  ['v4-retired-nord', 'v4', 'nord'],
];
const browser = await launch();
for (const width of [1440, 390]) {
  for (const [name, ui, theme] of cases) {
    if (name === 'v4-retired-nord' && width !== 1440) continue;
    const page = await newPage(browser, width, width > 600 ? 900 : 844);
    await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
    await page.addInitScript({ path: seedPath });
    await page.goto(`${url}?ui=${ui}`);
    await page.waitForSelector('.now-card, .app-card');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    await page.click('#btn-settings');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(here, `slice7-settings-${name}-${width}.png`) });
    const info = await page.evaluate(() => ({
      themeButtons: [...document.querySelectorAll('.theme-btn')].filter((b) => b.offsetParent).map((b) => b.textContent.trim() + (b.classList.contains('active') ? '*' : '')),
      storedTheme: localStorage.getItem('portpilot-theme'),
      bodyTheme: document.body.getAttribute('data-theme'),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    await page.click('#settings-close');
    await page.waitForTimeout(300);
    if (name !== 'v4-retired-nord') {
      await page.click('#btn-add-app');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(here, `slice7-modal-${name}-${width}.png`) });
    }
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
