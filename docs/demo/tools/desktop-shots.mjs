// Usage: node desktop-shots.mjs [outDir] [widths=1440,390]
// The real desktop renderer (src/renderer/index.html) on the fictional demo seed, in Brave.
// Writes desktop-apps, desktop-conflict, desktop-crash-toast and desktop-rerun at each width.
// History and the row-state crop have their own scripts (history-shot.mjs, assets.mjs).
import path from 'path';
import { pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath, shotsDir } from './lib.mjs';

const [out = shotsDir, w = '1440,390'] = process.argv.slice(2);
const browser = await launch();
const file = (n, width) => path.join(out, `desktop-${n}-${width}.png`);

for (const width of w.split(',').map(Number)) {
  const page = await newPage(browser, width, width > 600 ? 1000 : 844);
  await page.addInitScript({ path: seedPath });
  await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
  await page.waitForSelector('.app-card');
  await page.waitForSelector('.crash-toast');
  await page.waitForTimeout(1200);

  // Crash toast first, while it is the thing on screen; then hide it and the conflict toast.
  await (await page.$('.crash-toast')).screenshot({ path: file('crash-toast', width) });
  await page.addStyleTag({ content: '.toast{display:none!important}' });

  const conflict = await page.evaluateHandle(() => [...document.querySelectorAll('.app-card')].find((c) => c.innerText.includes('buoy-preview')));
  await conflict.asElement().screenshot({ path: file('conflict', width) });
  await page.screenshot({ path: file('apps', width), fullPage: true });
  const apps = await page.evaluate(() => ({ cards: document.querySelectorAll('.app-card').length, overflowX: document.documentElement.scrollWidth > innerWidth }));

  await page.click('.view-tab[data-view="history"]');
  await page.waitForSelector('.hrow .hthumb img');
  await page.click('.hrow[data-run="r_demo02"] [data-hact="rerun"]');
  await page.waitForTimeout(900); // the seed walks checking -> worktree -> install; catch it mid-way
  const rerun = await page.evaluate(() => document.querySelector('.hrow[data-run="r_demo02"]').innerText.replace(/\s+/g, ' ').slice(0, 220));
  await page.screenshot({ path: file('rerun', width), fullPage: true });
  console.log(width, JSON.stringify({ ...apps, rerun, problems: page.problems }));
  await page.close();
}
await browser.close();
