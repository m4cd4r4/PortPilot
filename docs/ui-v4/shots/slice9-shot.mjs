// Slice 9 proof: a fresh profile with no query lands on v4; ?ui=v3 is the way back and sticks.
// Usage: node slice9-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const browser = await launch();
for (const width of [1440, 390]) {
  const page = await newPage(browser, width, width > 600 ? 900 : 844);
  await page.addInitScript({ path: seedPath });
  await page.goto(url);
  await page.waitForSelector('.now-card, .app-card');
  await page.addStyleTag({ content: '.toast{display:none!important}' });
  await page.waitForTimeout(400);
  const fresh = await page.evaluate(() => ({ dataUi: document.documentElement.getAttribute('data-ui'), stored: localStorage.getItem('portpilot-ui') }));
  await page.screenshot({ path: path.join(here, `slice9-default-${width}.png`) });
  await page.goto(`${url}?ui=v3`);
  await page.waitForSelector('.app-card');
  await page.goto(url);
  await page.waitForSelector('.app-card');
  const v3 = await page.evaluate(() => ({ dataUi: document.documentElement.getAttribute('data-ui'), stored: localStorage.getItem('portpilot-ui') }));
  console.log(width, JSON.stringify({ fresh, v3Sticks: v3, problems: page.problems }));
  await page.close();
}
await browser.close();
