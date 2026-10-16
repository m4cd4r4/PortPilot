// Slice 8 proof: crash toast and command palette on the demo seed. v3 (flag off), v4 dark and light.
// Usage: node slice8-shot.mjs
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
    await page.waitForSelector('.crash-toast');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(here, `slice8-crash-${name}-${width}.png`) });
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-box');
    await page.keyboard.type('re');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(here, `slice8-palette-${name}-${width}.png`) });
    const info = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth }));
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
