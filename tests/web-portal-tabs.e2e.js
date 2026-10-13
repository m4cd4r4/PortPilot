/**
 * The web portal (`node src/agent/server.js`) must not show tabs it cannot serve.
 * Run: node tests/web-portal-tabs.e2e.js   (needs playwright + Brave; not part of test:unit)
 *
 * The portal serves only the Apps view. History and Browsers are desktop-only for now, so the
 * served page must hide their tabs, reference no script that 404s, and log no console errors.
 * Runs the real agent against a THROWAWAY config dir and a free port; never the real config.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;
const { spawn } = require('child_process');

const BRAVE = process.env.BRAVE_EXE || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

const { check, finish } = h.checker();
const world = h.makeWorld('pp-portal-');

async function main() {
  const [agentPort] = await h.freePorts(1);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [{ id: 'app_shop', name: 'shop', command: 'node server.js', cwd: shop, preferredPort: 0 }],
  });

  // APPDATA picks the throwaway config dir on Windows; XDG_CONFIG_HOME does it elsewhere.
  const agent = spawn(process.execPath, [path.join(h.root, 'src/agent/server.js'), '--no-open'], {
    cwd: h.root,
    env: { ...process.env, APPDATA: world.tmp, XDG_CONFIG_HOME: world.tmp, PORTPILOT_AGENT_PORT: String(agentPort), PORTPILOT_NO_OPEN: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  let browser;
  try {
    const agentJson = path.join(world.configDir, 'agent.json');
    const info = await until(() => JSON.parse(fs.readFileSync(agentJson, 'utf8')), 60000, 'agent.json');
    check('agent runs on the throwaway config dir and the free port', info.port === agentPort, `port ${info.port}`);

    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath: BRAVE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(info.url, { waitUntil: 'load' });

    const visibleTabs = await page.$$eval('.view-tab', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));
    check('no History or Browsers tab is visible', !visibleTabs.some((t) => /history|browsers/i.test(t)), visibleTabs.join(' | '));

    const srcs = await page.$$eval('script[src]', (els) => els.map((e) => e.getAttribute('src')));
    const bad = [];
    for (const src of srcs) {
      const r = await fetch(new URL(src, info.url));
      if (r.status !== 200 || !/javascript/.test(r.headers.get('content-type') || '')) bad.push(`${src} -> ${r.status} ${r.headers.get('content-type')}`);
    }
    check('every script the page references returns 200 as JavaScript', srcs.length > 0 && bad.length === 0, bad.length ? bad.join('; ') : `${srcs.length} scripts`);

    await page.waitForSelector('.app-card[data-id="app_shop"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the first scan and polls settle
    check('no console errors or pageerrors on load', problems.length === 0, problems.join(' | '));

    check('Apps view lists the registered app', (await page.$$('.app-card[data-id="app_shop"]')).length === 1);
    check('Apps tab is shown and selected', await page.$eval('.view-tab[data-view="apps"]', (e) => e.getAttribute('aria-selected') === 'true' && e.offsetParent !== null));

    // Ports: Scan, then clicking the Apps tab again, must stay error-free.
    problems.length = 0;
    await page.click('#btn-scan');
    await page.waitForTimeout(2500);
    await page.click('.view-tab[data-view="apps"]');
    await page.waitForTimeout(500);
    check('Ports scan and the Apps tab click log no errors', problems.length === 0, problems.join(' | '));
    check('Apps view still lists the app after scanning', (await page.$$('.app-card[data-id="app_shop"]')).length === 1);

    // PORTAL_SHOT=<file> saves what the portal looks like at 1440x900, for a human to read.
    if (process.env.PORTAL_SHOT) await page.screenshot({ path: process.env.PORTAL_SHOT, type: 'jpeg', quality: 80 });
  } finally {
    if (browser) await browser.close().catch(() => {});
    agent.kill();
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
