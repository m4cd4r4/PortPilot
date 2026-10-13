/**
 * Real-Electron check of the Apps-row page preview hover and the narrow-window search box,
 * against a THROWAWAY config.
 * Run: node tests/desktop-preview.e2e.js   (needs Electron + playwright; not part of test:unit)
 *
 * Covers: search placeholder readable at 390 px; hovering or focusing the 32 x 18 row thumbnail
 * opens a ~256 x 144 popover that never changes row height and hides again; rowPreviews off
 * means no thumbnail and no popover.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-preview-');

const card = (id) => `.app-card[data-id="${id}"]`;

async function main() {
  const [shopPort] = await h.freePorts(1);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [{ id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort }],
  });

  const { app, win } = await h.launch(world);
  try {
    await win.waitForSelector(card('app_shop'));

    // ---- Search box at phone width ---------------------------------------------
    console.log('step: search box at 390 px');
    await win.setViewportSize({ width: 390, height: 844 });
    const fit = await win.evaluate(() => {
      const el = document.getElementById('global-search');
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const need = ctx.measureText('Search apps and ports...').width;
      const have = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { need: Math.ceil(need), have: Math.floor(have), page: document.documentElement.scrollWidth };
    });
    check('390 px: the search placeholder fits its field', fit.have >= fit.need, `needs ${fit.need}px, field text area is ${fit.have}px`);
    check('390 px: the page does not scroll sideways', fit.page <= 390, `scrollWidth ${fit.page}`);
    await win.setViewportSize({ width: 1440, height: 900 });
    const wide = await win.$eval('#global-search', (e) => Math.round(e.getBoundingClientRect().width));
    check('1440 px: the search box keeps its wide size', wide >= 300, `${wide}px`);

    // ---- Hover preview ---------------------------------------------------------
    console.log('step: hover preview');
    await win.click(`${card('app_shop')} [data-act="startApp"]`);
    await until(async () => (await win.$$(`${card('app_shop')} .row-thumb img`)).length === 1, 60000, 'row thumbnail');
    const thumb = win.locator(`${card('app_shop')} .row-thumb`);
    const rowBefore = await win.$eval(card('app_shop'), (e) => e.offsetHeight);
    await thumb.hover();
    await win.waitForSelector('#row-preview.open', { timeout: 5000 }).catch(() => {});
    const pop = await win.evaluate(() => {
      const p = document.getElementById('row-preview');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check('hovering the row thumbnail opens a popover about 256 px wide', !!pop && Math.abs(pop.w - 256) <= 8, JSON.stringify(pop));
    check('the popover is about 144 px high', !!pop && Math.abs(pop.h - 144) <= 8, JSON.stringify(pop));
    const during = await win.evaluate(() => {
      const r = document.getElementById('row-preview').getBoundingClientRect();
      const src = (sel) => document.querySelector(sel).currentSrc;
      return {
        row: document.querySelector('.app-card[data-id="app_shop"]').offsetHeight,
        onScreen: r.left >= 0 && r.top >= 0 && r.right <= document.documentElement.clientWidth && r.bottom <= document.documentElement.clientHeight,
        sameImage: src('#row-preview img') === src('.app-card[data-id="app_shop"] .row-thumb img'),
        loaded: document.querySelector('#row-preview img').naturalWidth > 0,
      };
    });
    check('row height is unchanged while the popover is open', during.row === rowBefore, `${rowBefore} -> ${during.row}`);
    check('the popover sits fully on screen', during.onScreen);
    check('the popover shows the same image as the thumbnail, decoded', during.sameImage && during.loaded);
    const thumbSize = await win.$eval(`${card('app_shop')} .row-thumb`, (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    check('the inline thumbnail stays 32 x 18', thumbSize === '32x18', thumbSize);

    await win.mouse.move(700, 600);
    await until(async () => !(await win.$eval('#row-preview', (e) => e.classList.contains('open'))), 3000, 'popover hidden');
    check('moving the pointer away hides the popover', true);
    check('row height is unchanged after it hides', (await win.$eval(card('app_shop'), (e) => e.offsetHeight)) === rowBefore);

    // Keyboard: focus opens it, Escape and blur close it, and the thumbnail has an accessible name.
    const name = await thumb.getAttribute('aria-label');
    check('the thumbnail has an accessible name', /Page preview of shop/.test(name || ''), name);
    await thumb.focus();
    await win.waitForSelector('#row-preview.open', { timeout: 3000 });
    check('keyboard focus on the thumbnail opens the popover', true);
    await win.keyboard.press('Escape');
    await until(async () => !(await win.$eval('#row-preview', (e) => e.classList.contains('open'))), 3000, 'popover closed by Escape');
    check('Escape closes the popover', true);

    // Survives a refresh: the rows are rebuilt while the pointer stays on the thumbnail.
    await thumb.hover();
    await win.waitForSelector('#row-preview.open', { timeout: 3000 });
    await win.evaluate(() => window.renderApps());
    await win.waitForTimeout(300);
    check('a row re-render under the pointer keeps the popover open', await win.$eval('#row-preview', (e) => e.classList.contains('open')));

    // A short window: no room below the row, so it flips above and still never leaves the screen.
    await win.mouse.move(700, 100);
    await win.setViewportSize({ width: 1440, height: 260 });
    await win.waitForTimeout(300);
    await thumb.hover();
    await win.waitForSelector('#row-preview.open', { timeout: 3000 });
    const tight = await win.evaluate(() => {
      const r = document.getElementById('row-preview').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: document.documentElement.clientHeight };
    });
    check('in a 260 px high window the popover still fits on screen', tight.top >= 0 && tight.bottom <= tight.vh, JSON.stringify(tight));
    await win.mouse.move(700, 100);
    await win.setViewportSize({ width: 1440, height: 900 });

    // ---- Setting off: no thumbnail, no popover ---------------------------------
    console.log('step: rowPreviews off');
    await win.evaluate(async () => { document.getElementById('setting-row-previews').checked = false; await window.saveSettings(); });
    await until(async () => (await win.$$(`${card('app_shop')} .row-thumb`)).length === 0, 8000, 'thumbnail removed');
    check('rowPreviews off removes the row thumbnail', true);
    check('rowPreviews off leaves no open popover', await win.evaluate(() => { const p = document.getElementById('row-preview'); return !p || !p.classList.contains('open'); }));
    await win.mouse.move(60, 200);
    check('rowPreviews off: there is nothing to hover', (await win.$$('.row-thumb')).length === 0);
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
