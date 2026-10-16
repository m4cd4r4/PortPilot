// Usage: node webp-peek.mjs <webp> <outPrefix> [seconds=1,4,7]
// Shows an animated WebP in Brave and screenshots it at the given seconds, so a re-recorded clip can be read.
import path from 'path';
import { pathToFileURL } from 'url';
import { launch } from './lib.mjs';

const [file, prefix, secs = '1,4,7'] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 920, height: 600 } });
await page.goto(pathToFileURL(path.resolve(file)).href);
let last = 0;
for (const s of secs.split(',').map(Number)) {
  await page.waitForTimeout((s - last) * 1000);
  last = s;
  await page.screenshot({ path: `${prefix}-${s}s.png` });
}
await browser.close();
