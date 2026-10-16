// Slice 2 proof: the Running home on the demo seed. Flag off (v3), v4 dark and light,
// the all-clear state (conflicts and crashes removed) and the first-run welcome (no apps).
// Usage: node slice2-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const NO_APPS = `window.portpilot.config.getApps = () => Promise.resolve({ success: true, apps: [] });
window.portpilot.process.list = () => Promise.resolve({ success: true, apps: [], runtime: {} });`;
const cases = [
  ['v3-flag-off', 'v3', 'tokyonight', ''],
  ['v4-dark', 'v4', 'tokyonight', ''],
  ['v4-light', 'v4', 'light', ''],
  ['v4-first-run-dark', 'v4', 'tokyonight', NO_APPS],
  ['v4-first-run-light', 'v4', 'light', NO_APPS],
];
const browser = await launch();
for (const width of [1440, 390]) {
  for (const [name, ui, theme, patch] of cases) {
    const page = await newPage(browser, width, width > 600 ? 900 : 844);
    await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
    await page.addInitScript({ path: seedPath });
    if (patch) await page.addInitScript(patch);
    await page.goto(`${url}?ui=${ui}`);
    await page.waitForSelector(patch ? '.v4-empty' : '.now-card');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(here, `slice2-${name}-${width}.png`) });
    if (!patch && ui === 'v4') {
      await page.evaluate(() => { const c = document.querySelector('main.content'); c.scrollTop = c.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(here, `slice2-${name}-scrolled-${width}.png`) });
    }
    const info = await page.evaluate(() => ({
      focus: document.querySelector('main.content').dataset.v4Focus || null,
      hello: document.querySelector('.v4-hello')?.textContent.trim().replace(/\s+/g, ' ') || null,
      alerts: document.querySelectorAll('.v4-alert').length,
      tiles: document.querySelectorAll('.v4-tile').length,
      running: document.querySelectorAll('.now-card').length,
      homeVisible: [...document.querySelectorAll('.v4-home')].some((e) => !e.hidden && getComputedStyle(e).display !== 'none'),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
