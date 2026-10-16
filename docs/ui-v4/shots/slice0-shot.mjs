// Slice 0 proof: the real renderer on the demo seed with the v4 flag off (v3 look) and on (Dark, Light).
// Usage: node slice0-shot.mjs
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
    await page.waitForSelector('.app-card, .app-row');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(here, `slice0-${name}-${width}.png`) });
    const info = await page.evaluate(() => ({
      dataUi: document.documentElement.getAttribute('data-ui'),
      theme: document.body.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.body).getPropertyValue('--accent-primary').trim(),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
