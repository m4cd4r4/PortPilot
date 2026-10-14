/**
 * Real-Electron check that History and Browsers rows use the round 2 card tokens (R2-5), against a
 * THROWAWAY config.
 * Run: node tests/desktop-hb-tokens.e2e.js   (needs Electron + playwright; not part of test:unit)
 * Set PORTPILOT_SHOTS_DIR to save screenshots (3 themes x 1440 and 390, both views).
 *
 * For every theme: a History row and a Browsers row have the card radius and elevation the theme
 * defines (--radius-card, --elev-card, compared against a probe element so the check follows the
 * tokens rather than a hard-coded value), and the "detected" and "claimed" chips share the radius
 * and outline treatment of the strip's chip (--radius-sm, border-width token). Those two chips do
 * not occur in this world, so the spec adds one of each to the DOM and measures the CSS.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-hbtok-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
const THEMES = ['tokyonight', 'light', 'nord', 'dracula', 'glass'];

async function main() {
  const [shopPort, profPort] = await h.freePorts(2);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [{ id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort }],
    browserProfiles: [{ name: 'tok-qa', port: profPort, browser: 'brave', mode: 'headless', url: 'about:blank', note: '' }],
  });
  const { app, win } = await h.launch(world);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // One evaluate per read (rows are re-rendered in the background). The probe element carries the
  // tokens themselves, so "same as the token" is checked by the browser, not by string handling.
  const measure = (sel, probeCss) => win.evaluate(([s, css]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const probe = document.createElement('div');
    probe.style.cssText = css;
    document.body.appendChild(probe);
    const cs = getComputedStyle(el); const ps = getComputedStyle(probe);
    const out = { radius: cs.borderTopLeftRadius, wantRadius: ps.borderTopLeftRadius, shadow: cs.boxShadow, wantShadow: ps.boxShadow };
    probe.remove();
    return out;
  }, [sel, probeCss]);
  const CARD = 'border-radius: var(--radius-card); box-shadow: var(--elev-card);';
  const chipRadius = (cls) => win.evaluate((c) => {
    const host = document.querySelector('.hrow .hline') || document.querySelector('.brow .hline-sub');
    const el = document.createElement('span');
    el.className = c; el.textContent = 'x';
    host.appendChild(el);
    const p = document.createElement('div');
    p.style.cssText = 'border-radius: var(--radius-sm); border: var(--border-width) solid #000;';
    document.body.appendChild(p);
    const cs = getComputedStyle(el); const ps = getComputedStyle(p);
    const out = { radius: cs.borderTopLeftRadius, want: ps.borderTopLeftRadius, width: cs.borderTopWidth, wantWidth: ps.borderTopWidth };
    el.remove(); p.remove();
    return out;
  }, cls);

  try {
    await until(() => win.evaluate(() => (state.apps || []).length === 1), 30000, 'apps loaded');
    await win.evaluate(() => window.startApp('app_shop'));
    await until(() => win.evaluate(() => state.runningApps.some((r) => r.id === 'app_shop' && r.running)), 60000, 'shop running');
    await until(() => win.evaluate(async () => (await window.portpilot.history.list()).runs.some((r) => r.appId === 'app_shop')), 30000, 'run recorded');

    for (const view of ['history', 'browsers']) {
      console.log(`step: ${view}`);
      await win.click(`.view-tab[data-view="${view}"]`);
      const rowSel = view === 'history' ? '.hrow' : '.brow';
      await until(async () => (await win.$$(rowSel)).length > 0, 15000, `${view} rows`);

      for (const theme of THEMES) {
        await win.evaluate((t) => window.setTheme(t, false), theme);
        await win.waitForTimeout(250);
        const m = await measure(rowSel, CARD);
        check(`${view} / ${theme}: row has the card radius`, !!m && m.radius === m.wantRadius, m && `${m.radius} vs ${m.wantRadius}`);
        check(`${view} / ${theme}: row has the card elevation`, !!m && m.shadow === m.wantShadow && m.shadow !== 'none', m && `${m.shadow} vs ${m.wantShadow}`);
      }
      await win.evaluate(() => window.setTheme('tokyonight', false));

      const chipClass = view === 'history' ? 'hdetected' : 'bclaim';
      const c = await chipRadius(chipClass);
      check(`${view}: the .${chipClass} chip uses --radius-sm`, c.radius === c.want, `${c.radius} vs ${c.want}`);
      check(`${view}: the .${chipClass} chip uses the border-width token`, c.width === c.wantWidth, `${c.width} vs ${c.wantWidth}`);

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const theme of ['tokyonight', 'light', 'glass']) {
          for (const [w, hh] of [[1440, 900], [390, 844]]) {
            await win.setViewportSize({ width: w, height: hh });
            await win.evaluate((t) => window.setTheme(t, false), theme);
            await win.waitForTimeout(400);
            await win.screenshot({ path: path.join(SHOTS, `${view}-${theme}-${w}.png`) });
          }
        }
        await win.setViewportSize({ width: 1440, height: 900 });
        await win.evaluate(() => window.setTheme('tokyonight', false));
      }
    }

    check('no console errors or page errors', errors.length === 0, errors.join(' | '));
  } finally {
    const w = app.windows()[0];
    if (w) {
      const { apps = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of apps.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
