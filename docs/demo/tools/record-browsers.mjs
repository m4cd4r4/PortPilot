// Usage: node record-browsers.mjs
// Clip: start and stop a debug browser from the Browsers tab. Writes docs/media/browsers-start-stop.webp.
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { launch, newPage, repo, seedPath, goSection } from './lib.mjs';
import { addOverlay, caption, clickWithCursor, startRecording, encodeWebp, mediaDir, sleep } from './record-lib.mjs';

const browser = await launch();
const page = await newPage(browser, 960, 620);
await page.addInitScript({ path: seedPath });
await page.goto(pathToFileURL(path.join(repo, 'src', 'renderer', 'index.html')).href);
await page.waitForSelector('.now-card, .app-card');
await page.evaluate(() => window.portpilot.browsers.stop('google'));
await goSection(page, 'browsers');
await page.waitForSelector('.brow');
// Three profiles are enough for the story: a running one, the one we start and stop, and a held port.
await page.addStyleTag({ content: '.toast.error{display:none} .brow[data-name="facebook"],.brow[data-name="reddit"],.brow[data-name="upwork"]{display:none}' });
await page.evaluate(() => { for (const t of document.querySelectorAll('.toast')) t.remove(); });
await addOverlay(page);
const sel = (act) => `.brow[data-name="google"] [data-bact="${act}"]`;
const stateText = () => page.evaluate(() => document.querySelector('.brow[data-name="google"] .state-word').textContent);
const until = async (word) => { for (let i = 0; i < 60 && (await stateText()) !== word; i++) await sleep(100); };

const rec = startRecording(page);
await caption(page, 'The <b>google</b> profile is stopped. It owns debug port <b>:9232</b>.');
await sleep(1800);
await caption(page, 'Start it: Brave opens with <b>--remote-debugging-port=9232</b> and its own sign-ins');
await clickWithCursor(page, sel('toggle'));
await until('Running');
await sleep(600);
await caption(page, 'Claude, or you, can now attach at <b>http://127.0.0.1:9232</b>');
await sleep(2400);
await caption(page, 'Stop it: the browser closes and the port is free again');
await clickWithCursor(page, sel('toggle'));
await until('Stopped');
await sleep(1800);
const out = await rec.stop();
const r = encodeWebp(out, path.join(mediaDir, 'browsers-start-stop.webp'), { width: 900 });
fs.rmSync(out.dir, { recursive: true, force: true });
console.log(JSON.stringify(r), page.problems);
await browser.close();
