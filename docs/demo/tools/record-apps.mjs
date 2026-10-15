// Usage: node record-apps.mjs [conflict|crash]
// Clips on the Apps view of the demo seed. Writes docs/media/conflict-resolve.webp and crash-ask-claude.webp.
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from './lib.mjs';
import { addOverlay, caption, clickWithCursor, startRecording, encodeWebp, mediaDir, sleep } from './record-lib.mjs';

const which = process.argv[2] || 'all';
const browser = await launch();

async function open() {
  const page = await newPage(browser, 1000, 620);
  await page.addInitScript({ path: seedPath });
  await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
  await page.waitForSelector('.app-card');
  await page.waitForSelector('.crash-toast');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { for (const t of document.querySelectorAll('.toast')) t.remove(); });
  return page;
}

async function finish(page, rec, name, width = 900) {
  const out = await rec.stop();
  const r = encodeWebp(out, path.join(mediaDir, name), { width });
  fs.rmSync(out.dir, { recursive: true, force: true });
  console.log(name, JSON.stringify(r), page.problems);
  await page.close();
}

if (which === 'all' || which === 'conflict') {
  const page = await open();
  // Put the alight row near the top of the frame.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.app-row, .app-card')].find((c) => c.innerText.includes('alight') && !c.innerText.includes('cosmos'));
    row.scrollIntoView({ block: 'center' });
  });
  await addOverlay(page);
  const btn = '[data-confirm-key="kill-start:a_admin"]';
  const rec = startRecording(page);
  await caption(page, '<b>alight</b> wants port <b>:3007</b>, but <b>solaisoft</b> already holds it');
  await sleep(2400);
  await caption(page, 'PortPilot names the holder, how long it has run and who started it. One click to take the port');
  await clickWithCursor(page, btn);
  await sleep(900);
  await caption(page, 'The button arms first, so a stray click cannot kill a server');
  await clickWithCursor(page, btn, { pause: 400 });
  await page.waitForSelector('.toast:has-text("alight started")', { timeout: 8000 });
  await sleep(900);
  // The page scrolls inside a container, not the window: find it from any list row.
  console.log('scrolled to top:', await page.evaluate(() => new Promise((done) => {
    let el = document.querySelector('.app-card');
    while (el && el !== document.body && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) el = el.parentElement;
    const sc = el && el !== document.body ? el : document.scrollingElement;
    const from = sc.scrollTop, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      sc.scrollTop = from * (1 - (k * k * (3 - 2 * k)));
      if (k < 1) requestAnimationFrame(step); else done(sc.scrollTop === 0);
    };
    requestAnimationFrame(step);
  })));
  await caption(page, '<b>solaisoft</b> stopped, <b>alight</b> is running on <b>:3007</b> and joins Now running');
  await sleep(3200);
  await finish(page, rec, 'conflict-resolve.webp');
}

if (which === 'all' || which === 'crash') {
  const page = await open();
  await page.evaluate(() => window.scrollTo(0, 0));
  await addOverlay(page);
  const rec = startRecording(page);
  await caption(page, '<b>550-au</b> crashes while Claude is working on something else');
  await sleep(1600);
  await page.evaluate(() => window.showCrashToast({
    appId: 'a_metrics', name: '550-au', title: '550-au crashed 2x in 5m', meta: ':3210 · exit 1', count: 2, at: Date.now(),
    lines: ['error when starting dev server:', 'Error: Port 3210 is already in use'],
    session: { id: 'b71c9e04-demo', short: 'b71c', reason: 'owner' },
  }));
  await sleep(500);
  await caption(page, 'A sticky toast keeps the stderr tail. <b>Ask Claude</b> appears when the session that started the app is still open');
  await sleep(2600);
  await clickWithCursor(page, '.crash-toast-btn.primary');
  await sleep(500);
  await caption(page, 'The crash and its stderr go to that session. No copy and paste');
  await sleep(2600);
  await finish(page, rec, 'crash-ask-claude.webp');
}

await browser.close();
