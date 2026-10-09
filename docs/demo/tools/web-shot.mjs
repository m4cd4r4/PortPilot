// Usage: node web-shot.mjs [outDir] [widths=1440,390]
// Starts the REAL web agent (src/agent/server.js, port 7399, loopback) so the portal HTML, the
// web shim and the CSP are the production ones. Only the /api answers are swapped for the demo
// seed (fictional data), so no real config is read. Writes web-apps-<w>.png, and
// web-history-<w>.png only when the History tab renders runs through the web shim.
import path from 'path';
import { launch, newPage, loadSeed, shotsDir } from './lib.mjs';
import { createRequire } from 'module';
const requireCjs = createRequire(import.meta.url);
const { createAgent } = requireCjs('../../../src/agent/server.js');

const [out = shotsDir, w = '1440,390'] = process.argv.slice(2);
const PORT = 7399;
const seed = loadSeed();
const agent = createAgent({ configStore: { onConfigChange: null }, port: PORT });
const info = await agent.start();
const browser = await launch();
try {
  for (const width of w.split(',').map(Number)) {
    const page = await newPage(browser, width, width > 600 ? 1000 : 844);
    await page.route('**/api', async (route) => {
      const { action, args } = JSON.parse(route.request().postData() || '{}');
      const [ns, fn] = String(action).split(':');
      const impl = seed[ns] && seed[ns][fn];
      const body = impl ? await impl(...(args || [])) : { success: false, error: `no seed for ${action}` };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(info.url);
    await page.waitForSelector('.app-card');
    await page.waitForTimeout(1200);
    const apps = await page.evaluate(() => ({
      cards: document.querySelectorAll('.app-card').length,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      token: !!document.querySelector('meta[name="pp-token"]'),
      hasHistoryApi: !!(window.portpilot && window.portpilot.history),
    }));
    console.log(width, 'apps', JSON.stringify({ ...apps, problems: page.problems }));
    await page.screenshot({ path: path.join(out, `web-apps-${width}.png`), fullPage: true });

    page.problems.length = 0;
    await page.click('.view-tab[data-view="history"]');
    await page.waitForTimeout(1200);
    const hist = await page.evaluate(() => ({ rows: document.querySelectorAll('.hrow').length, thumbs: document.querySelectorAll('.hrow .hthumb img').length }));
    console.log(width, 'history', JSON.stringify({ ...hist, problems: page.problems }));
    // The portal does not serve history.js or the history shim (plan row 24), so there is
    // nothing true to show yet. Write the shot only once the tab renders runs.
    if (hist.rows > 0) await page.screenshot({ path: path.join(out, `web-history-${width}.png`), fullPage: true });
    else console.log(width, 'History tab is empty in the web portal: no web-history shot written');
    await page.close();
  }
} finally {
  await browser.close();
  await agent.stop();
}
