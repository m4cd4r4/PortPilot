// Shared helpers for the surface-shot scripts: Playwright (from the main checkout, which has
// node_modules), Brave, and the demo seed loaded either into a page or into Node.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '..', '..', '..');
export const seedPath = path.join(repo, 'docs', 'demo', 'demo-seed.js');
export const shotsDir = path.join(repo, 'docs', 'demo', 'screenshots');
export const BRAVE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

const require = createRequire('I:/Scratch/PortPilot-2026/package.json');
export const { chromium } = require('playwright');

export const launch = () => chromium.launch({ executablePath: BRAVE });

// The seed's window.portpilot, evaluated in Node so a script can answer API calls with it.
export function loadSeed() {
  const ctx = { window: {}, Date, Promise, Object, Set, console, setTimeout, URL };
  vm.runInNewContext(fs.readFileSync(seedPath, 'utf8'), ctx);
  return ctx.window.portpilot;
}

// A page that collects page errors and console errors so a shot never hides a broken view.
export async function newPage(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.problems.push(`console: ${m.text()}`); });
  return page;
}
