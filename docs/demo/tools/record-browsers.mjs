// Usage: npm run build:ui && node docs/demo/tools/record-browsers.mjs
// Clip: start and stop a debug browser from the v5 Browsers screen. Throwaway config and real Electron, and Start
// opens a real headless Brave on the profile's port. Writes docs/media/browsers-start-stop.webp.
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { addOverlay, caption, clickWithCursor, startRecording, encodeWebp, mediaDir, sleep } from './record-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const require = createRequire(path.join(root, 'package.json'));
const h = require(path.join(root, 'tests', 'e2e-harness'));
const sites = path.join(root, 'docs', 'demo', 'fictional', 'sites');

// Three profiles are enough for the story: a running one, the one we start and stop, and one left stopped.
// Cards sort open, then stopped, then by name, so Social keeps its slot whichever state it is in.
// No `sites` and a blank url: with no host to check, sign-in health reads unknown and the card shows no sign-in pill.
const PROFILES = [
  { name: 'Research', port: 9233, art: 'docs', purpose: 'Docs, papers and reading lists', accounts: [{ platform: 'GitHub', username: 'reader' }] },
  { name: 'Social', port: 9232, art: 'chat', purpose: 'Community and chat', accounts: [{ platform: 'Chatterbox', username: 'me' }] },
  { name: 'Work', port: 9231, art: 'dashboard', purpose: 'Client dashboards and admin', accounts: [{ platform: 'Google', username: 'work' }, { platform: 'Stripe', username: 'owner' }] },
];
const world = h.makeWorld('pp-clip-');
world.writeConfig({
  browserProfiles: PROFILES.map(({ art, ...p }) => ({ ...p, browser: 'brave', mode: 'headless', url: 'about:blank' })),
});

const { app, win } = await h.launch(world, { width: 1100, height: 540 });
try {
  await h.until(() => win.evaluate(() => !!document.querySelector('.home')), 20000, 'home');
  // An unfocused window can hang screenshots.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
  await win.emulateMedia({ colorScheme: 'dark' });

  // Each favicon becomes that profile's picture (the renderer can rasterise SVG; the art store wants PNG).
  const artDir = path.join(world.configDir, 'browser-art');
  fs.mkdirSync(artDir, { recursive: true });
  for (const p of PROFILES) {
    const svg = fs.readFileSync(path.join(sites, p.art, 'icon.svg'), 'utf8');
    const b64 = await win.evaluate((s) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, 0, 0, 256, 256); resolve(c.toDataURL('image/png').split(',')[1]); };
      img.onerror = () => reject(new Error('svg did not load'));
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(s);
    }), svg);
    fs.writeFileSync(path.join(artDir, `${p.name}.png`), Buffer.from(b64, 'base64'));
    fs.writeFileSync(path.join(artDir, `${p.name}.json`), JSON.stringify({ source: 'manual', ext: 'png', at: Date.now() }));
  }

  await win.evaluate(() => window.portpilot.browsers.start('Research'));
  await win.click('role=tab[name="Browsers"]');
  await win.click('role=button[name="Cards"]');
  await h.until(() => win.locator('.bcard[data-profile="Social"] .shot img').count().then((n) => n === 1), 20000, 'profile art');
  await h.until(() => win.evaluate(() => document.querySelector('.bcard[data-profile="Research"]')?.dataset.group !== 'stopped'), 20000, 'Research up');
  // Flat list, so the card stays where it is when its state changes.
  await win.click('role=button[name="Grouped"]');
  await win.evaluate(() => document.activeElement?.blur());
  await win.mouse.move(640, 480); // Off the button, or it opens the clip in its hover style.
  await sleep(500);
  await addOverlay(win);
  const button = (label) => `.bcard[data-profile="Social"] button:text-is("${label}")`;
  const group = () => win.evaluate(() => document.querySelector('.bcard[data-profile="Social"]').dataset.group);
  const until = async (test) => { for (let i = 0; i < 100 && !test(await group()); i++) await sleep(100); };

  const rec = startRecording(win);
  await caption(win, 'The <b>Social</b> profile is stopped. It owns debug port <b>:9232</b>.');
  await sleep(1800);
  await caption(win, 'Start it: Brave opens with <b>--remote-debugging-port=9232</b> and its own sign-ins');
  await clickWithCursor(win, button('Start'));
  await until((g) => g !== 'stopped');
  await sleep(600);
  await caption(win, 'Claude, or you, can now attach at <b>http://127.0.0.1:9232</b>');
  await sleep(2400);
  await caption(win, 'Stop it: the browser closes and the port is free again');
  await clickWithCursor(win, button('Stop'));
  await until((g) => g === 'stopped');
  await sleep(1800);
  const out = await rec.stop();
  const r = encodeWebp(out, path.join(mediaDir, 'browsers-start-stop.webp'), { width: 900 });
  fs.rmSync(out.dir, { recursive: true, force: true });
  console.log(JSON.stringify(r));
} finally {
  await h.closeBrowserOn(9233);
  await h.closeBrowserOn(9232);
  await h.closeApp(app);
}
process.exit(0);
