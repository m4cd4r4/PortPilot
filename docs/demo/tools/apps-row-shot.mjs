// Usage: node apps-row-shot.mjs [outDir] [widths=1440,390]
// Loads the real renderer with demo-seed.js (fictional data) in Brave, waits for the
// page previews on the Apps rows, asserts the DOM and writes apps-row-<width>.png.
// No backend, no real config.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import assert from 'assert';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const [out = path.join(repo, 'docs', 'demo', 'screenshots'), w = '1440,390'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' });
for (const width of w.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width, height: width > 600 ? 1000 : 844 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.addInitScript({ path: path.join(repo, 'docs', 'demo', 'demo-seed.js') });
  await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
  // At <= 600 px the preview is hidden by CSS (the port chip needs the room), but still rendered.
  await page.waitForSelector('.app-card .row-thumb img', { state: 'attached' });
  await page.waitForTimeout(500);
  // The seed fires a crash toast and a conflict toast; they are not part of this view.
  await page.evaluate(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; });
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.app-card')];
    const withThumb = cards.filter((c) => c.querySelector('.row-thumb img'));
    const plain = cards.filter((c) => !c.querySelector('.row-thumb') && !c.classList.contains('has-conflict'));
    return {
      cards: cards.length,
      thumbNames: withThumb.map((c) => c.querySelector('.app-name-text').textContent + (c.classList.contains('is-branch') ? ' (branch)' : '')),
      thumbRowHeights: withThumb.map((c) => Math.round(c.getBoundingClientRect().height)),
      plainRowHeights: [...new Set(plain.map((c) => Math.round(c.getBoundingClientRect().height)))],
      stoppedWithThumb: cards.filter((c) => /Stopped/.test(c.querySelector('.state-word')?.textContent || '') && c.querySelector('.row-thumb')).length,
      shown: withThumb.every((c) => getComputedStyle(c.querySelector('.row-thumb')).display !== 'none'),
      decoded: withThumb.every((c) => { const i = c.querySelector('img'); return i.complete && i.naturalWidth > 0; }),
      overflowX: document.documentElement.scrollWidth > innerWidth,
      nameWidths: withThumb.map((c) => Math.round(c.querySelector('.app-name-text').getBoundingClientRect().width)),
    };
  });
  console.log(width, JSON.stringify({ ...info, problems }));
  assert.ok(info.thumbNames.length >= 2, 'a parent and a worktree child row show a preview');
  assert.ok(info.thumbNames.some((n) => n.includes('(branch)')), 'the worktree child row shows one');
  assert.strictEqual(info.stoppedWithThumb, 0, 'stopped rows show no preview');
  assert.strictEqual(info.shown, width > 600, 'previews show on desktop widths and hide on phone width');
  assert.ok(info.decoded,'previews are decoded as soon as the row renders');
  assert.ok(info.thumbRowHeights.every((h) => info.plainRowHeights.includes(h)), `rows with a preview are no taller than rows without (${info.thumbRowHeights} vs ${info.plainRowHeights})`);
  assert.ok(!info.overflowX, 'no horizontal overflow');
  assert.deepStrictEqual(problems, []);
  await page.screenshot({ path: path.join(out, `apps-row-${width}.png`), fullPage: true });
  await page.close();
}
await browser.close();
