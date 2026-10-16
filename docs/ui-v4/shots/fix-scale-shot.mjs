// Proof for the 51-app case: pads the demo seed with ready apps and an empty group, then shoots Running, Apps and the sidebar logo.
// Usage: node fix-scale-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const browser = await launch();
for (const [theme, width] of [['tokyonight', 1440], ['light', 1440], ['tokyonight', 390]]) {
  const page = await newPage(browser, width, width > 600 ? 900 : 844);
  await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
  await page.addInitScript({ path: seedPath });
  await page.goto(url);
  await page.waitForSelector('.now-card, .app-card');
  await page.addStyleTag({ content: '.toast{display:none!important}' });
  await page.evaluate(() => {
    for (let i = 0; i < 41; i++) state.apps.push({ id: `pad_${i}`, name: `project-${i + 1}`, command: 'npm run dev', cwd: 'C:/x', preferredPort: 4000 + i, group: null });
    state.groups.push({ id: 'g_empty', name: 'Azure & AWS Prep', expanded: true });
    if (typeof renderApps === 'function') renderApps();
    document.dispatchEvent(new Event('portpilot:apps'));
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('v4-home-ready').scrollIntoView());
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({ rows: document.querySelectorAll('.v4-ready-row').length, tiles: document.querySelectorAll('.v4-tile').length, logo: !!document.querySelector('svg.v4-brand-mark') }));
  await page.screenshot({ path: path.join(here, `fixscale-running-${theme}-${width}.png`) });
  console.log(theme, width, JSON.stringify({ ...info, problems: page.problems }));
  await page.close();
}
await browser.close();
