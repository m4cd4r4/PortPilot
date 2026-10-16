// Slice 3 proof: the Apps list with the docked inspector. Flag off (v3), v4 dark and light on
// the auto-selected app, then a running app picked by clicking its row (preview shows).
// Usage: node slice3-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const cases = [
  ['v3-flag-off', 'v3', 'tokyonight', false],
  ['v4-dark', 'v4', 'tokyonight', false],
  ['v4-light', 'v4', 'light', false],
  ['v4-dark-running-app', 'v4', 'tokyonight', true],
];
const browser = await launch();
for (const width of [1440, 390]) {
  for (const [name, ui, theme, pickRunning] of cases) {
    const page = await newPage(browser, width, width > 600 ? 900 : 844);
    await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
    await page.addInitScript({ path: seedPath });
    await page.goto(`${url}?ui=${ui}`);
    await page.waitForSelector('.now-card, .app-card');
    await page.addStyleTag({ content: '.toast{display:none!important}' });
    if (ui === 'v4') {
      await page.click('#v4-sidebar [data-section="apps"]');
      await page.waitForTimeout(400);
      if (pickRunning) {
        await page.click('.now-card[data-id] .now-name', { force: true }).catch(() => {});
        await page.click('.app-card:has(.state-running)').catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(here, `slice3-${name}-${width}.png`) });
    const info = await page.evaluate(() => {
      const d = document.getElementById('app-drawer');
      const r = d.getBoundingClientRect();
      return {
        drawerOpen: !d.classList.contains('hidden'),
        drawerTitle: document.getElementById('app-drawer-title').textContent,
        drawerBox: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        hasPreview: !!document.querySelector('#app-drawer-body .v4-insp-preview'),
        overflowX: document.documentElement.scrollWidth > innerWidth,
      };
    });
    console.log(width, name, JSON.stringify({ ...info, problems: page.problems }));
    await page.close();
  }
}
await browser.close();
