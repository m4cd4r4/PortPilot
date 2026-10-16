// Proof for the in-app Diagnose panel: consent, running (mid-stream) and done states, with a scripted stub of window.portpilot.diagnose.
// Usage: node diagnose-shot.mjs
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath } from '../../demo/tools/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href;
const browser = await launch();

const ANSWER = [
  'Cause: Dependencies were never installed. `express` is declared in package.json but the project has no node_modules.',
  'Evidence: `Cannot find module \'express\'` from server.js:1. package.json:1 lists "express": "^4.19.0".',
  'Fix: Run `npm install` in the project folder, then restart the app from PortPilot.',
].join('\n');

for (const [theme, width] of [['tokyonight', 1440], ['light', 1440], ['tokyonight', 390]]) {
  const page = await newPage(browser, width, width > 600 ? 900 : 844);
  await page.addInitScript(`localStorage.setItem('portpilot-theme','${theme}')`);
  await page.addInitScript({ path: seedPath });
  await page.goto(url);
  await page.waitForSelector('.now-card, .app-card');
  await page.addStyleTag({ content: '.toast{display:none!important}' });

  // consent state
  await page.evaluate(() => {
    let listener = null;
    window.__emit = (ev) => listener && listener({ appId: state.apps[0].id, ...ev });
    window.portpilot.diagnose = {
      status: async () => ({ success: true, cli: true, consent: false, running: false }),
      consent: async () => ({ success: true }),
      start: async () => ({ success: true }),
      cancel: async () => ({ success: true }),
      onEvent: (cb) => { listener = cb; return () => { listener = null; }; },
    };
    window.openDiagnose(state.apps[0].id, state.apps[0].name);
  });
  await page.waitForSelector('.diag-card');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(here, `diagnose-consent-${theme}-${width}.png`) });

  // running, mid-stream
  await page.click('.diag-btn.primary');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__emit({ kind: 'tool', label: 'Glob C:\\Scratch\\crashapp' });
    window.__emit({ kind: 'tool', label: 'Read C:\\Scratch\\crashapp\\package.json' });
    window.__emit({ kind: 'tool', label: 'Read C:\\Scratch\\crashapp\\server.js' });
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(here, `diagnose-running-${theme}-${width}.png`) });

  // done
  await page.evaluate((answer) => {
    window.__emit({ kind: 'text', text: answer });
    window.__emit({ kind: 'done', cost: 0.1 });
    window.__emit({ kind: 'end' });
  }, ANSWER);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(here, `diagnose-done-${theme}-${width}.png`) });
  const info = await page.evaluate(() => {
    const c = document.querySelector('.diag-card').getBoundingClientRect();
    return { cardW: Math.round(c.width), fits: c.left >= 0 && c.right <= window.innerWidth, buttons: [...document.querySelectorAll('.diag-foot .diag-btn')].map((b) => b.textContent) };
  });
  console.log(theme, width, JSON.stringify({ ...info, problems: page.problems }));
  await page.close();
}
await browser.close();
