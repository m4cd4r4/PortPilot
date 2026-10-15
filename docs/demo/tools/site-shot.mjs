// Usage: node site-shot.mjs <outDir> [selector=#browsers]
// Screenshots one section of docs/index.html at 1440 and 390 (the page opened from disk, reveal animations forced on).
import path from 'path';
import { pathToFileURL } from 'url';
import { launch, newPage, repo } from './lib.mjs';

const [out, selector = '#browsers'] = process.argv.slice(2);
const browser = await launch();
for (const width of [1440, 390]) {
  const page = await newPage(browser, width, width > 600 ? 900 : 844);
  await page.goto(pathToFileURL(path.join(repo, 'docs', 'index.html')).href);
  // The page's CSP blocks injected styles, so force the reveal state with its own class.
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('animate-in'));
    document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
  });
  await page.waitForTimeout(1500);
  const el = await page.$(selector);
  await el.screenshot({ path: path.join(out, `site-${selector.replace(/\W/g, '')}-${width}.png`) });
  console.log(width, await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth })), page.problems);
  await page.close();
}
await browser.close();
