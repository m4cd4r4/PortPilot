/**
 * Real-Electron check of the home "Now running" strip (homeLayout: preview), against a
 * THROWAWAY config.
 * Run: node tests/desktop-strip.e2e.js   (needs Electron + playwright; not part of test:unit)
 * Set PORTPILOT_SHOTS_DIR to save strip screenshots (3 themes x 1440 and 390).
 *
 * Covers: a fresh config defaults to the preview home; classic layout shows no strip; preview layout shows a card only for a running
 * app, with a decoded 16:9 page preview, Open / Details / Stop; Details opens the drawer;
 * Stop removes the card; at 390 px the strip is a horizontal swipe row and the page does
 * not scroll sideways.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-strip-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

const card = (id) => `.now-card[data-id="${id}"]`;

async function main() {
  const [shopPort, idlePort, blockedPort] = await h.freePorts(3);
  const shop = world.mkdir('shop');
  fs.writeFileSync(path.join(shop, 'server.js'), h.SERVER);
  world.writeConfig({
    apps: [
      { id: 'app_shop', name: 'shop', command: `node server.js --port ${shopPort}`, cwd: shop, preferredPort: shopPort },
      { id: 'app_idle', name: 'idle', command: `node server.js --port ${idlePort}`, cwd: shop, preferredPort: idlePort },
      { id: 'app_blocked', name: 'blocked', command: `node server.js --port ${blockedPort}`, cwd: shop, preferredPort: blockedPort },
    ],
  }, { freshSettings: true });

  let foreign = null;
  const { app, win } = await h.launch(world);
  try {
    await win.waitForSelector('.app-card[data-id="app_shop"]');

    // ---- Default: a fresh config gets the preview home --------------------------
    console.log('step: default layout');
    check('default: a fresh config shows the strip', await win.evaluate(() => !document.getElementById('now-strip').hidden && document.getElementById('setting-home-layout').value === 'preview'));

    // ---- Classic: the strip is absent ------------------------------------------
    console.log('step: classic layout');
    await win.evaluate(async () => { document.getElementById('setting-home-layout').value = 'classic'; await window.saveSettings(); });
    await win.click('.app-card[data-id="app_shop"] [data-act="startApp"]');
    await until(async () => (await win.$$('.app-card[data-id="app_shop"] .row-thumb img')).length === 1, 60000, 'row thumbnail');
    check('classic: the strip is hidden', await win.$eval('#now-strip', (e) => e.hidden && getComputedStyle(e).display === 'none'));
    check('classic: no strip cards exist', (await win.$$('.now-card')).length === 0);
    check('classic: the running app stays in the list', (await win.$$('.app-card[data-id="app_shop"]')).length === 1);
    check('classic: the ports section keeps its name and stays open', await win.evaluate(() =>
      /Active Ports/.test(document.querySelector('#ports-section .section-label').textContent) && !document.getElementById('ports-section').classList.contains('collapsed')));

    // ---- Preview: a card for the running app only ------------------------------
    console.log('step: preview layout');
    await win.evaluate(async () => { document.getElementById('setting-home-layout').value = 'preview'; await window.saveSettings(); });
    await win.waitForSelector(card('app_shop'), { timeout: 8000 });
    check('preview: the running app has a card', true);
    check('preview: the stopped app has none', (await win.$$(card('app_idle'))).length === 0);
    await until(async () => (await win.$$(`${card('app_shop')} .now-preview img`)).length === 1, 30000, 'strip preview image');
    const img = await win.evaluate((sel) => {
      const i = document.querySelector(`${sel} .now-preview img`);
      const box = i.parentElement.getBoundingClientRect();
      return { loaded: i.naturalWidth > 0, ratio: box.width / box.height, w: Math.round(box.width) };
    }, card('app_shop'));
    check('the preview image is decoded', img.loaded);
    check('the preview box is 16:9', Math.abs(img.ratio - 16 / 9) < 0.03, img.ratio.toFixed(3));
    check('the preview is much larger than the 32 px row thumbnail', img.w >= 200, `${img.w}px wide`);
    const chips = await win.$eval(card('app_shop'), (e) => e.querySelector('.now-chips').textContent);
    check('the card shows the port', chips.includes(`:${shopPort}`), chips.trim());
    for (const act of ['openInBrowser', 'openDrawer', 'stopApp']) {
      check(`the card has the ${act} button`, (await win.$$(`${card('app_shop')} [data-act="${act}"]`)).length === 1);
    }

    // ---- Home hierarchy: strip, then the rest, then one ports row --------------
    console.log('step: home hierarchy');
    check('the running app leaves the list (it is on the strip)', (await win.$$('.app-card[data-id="app_shop"]')).length === 0);
    check('the stopped app stays in the list', (await win.$$('.app-card[data-id="app_idle"]')).length === 1);
    check('the list section is named Other apps', /Other apps/.test(await win.$eval('#apps-list .app-section .section-title', (e) => e.textContent)));
    const order = await win.evaluate(() => {
      const y = (s) => document.querySelector(s).getBoundingClientRect().top;
      return { strip: y('#now-strip'), list: y('#apps-list'), ports: y('#ports-section') };
    });
    check('order is strip, then list, then ports', order.strip < order.list && order.list < order.ports, JSON.stringify(order));
    const ports = await win.evaluate(() => {
      const sec = document.getElementById('ports-section');
      return {
        label: sec.querySelector('.section-label').textContent,
        collapsed: sec.classList.contains('collapsed'),
        gridHidden: getComputedStyle(document.getElementById('ports-list')).display === 'none' || document.getElementById('ports-list').offsetHeight === 0,
        barH: Math.round(sec.querySelector('.section-header-bar').getBoundingClientRect().height),
      };
    });
    check('the ports block is one row named Everything listening', /Everything listening/.test(ports.label), ports.label);
    check('that row starts collapsed, with no port rows showing', ports.collapsed && ports.gridHidden, JSON.stringify(ports));
    await win.click('#ports-section-toggle');
    check('clicking the row opens the port list', await win.evaluate(() => !document.getElementById('ports-section').classList.contains('collapsed')));
    await win.click('#ports-section-toggle');
    check('and clicking again folds it', await win.evaluate(() => document.getElementById('ports-section').classList.contains('collapsed')));

    // The prescriptive conflict card stays in the list.
    foreign = h.holdPort(blockedPort);
    await until(async () => { await win.evaluate(() => window.loadApps()); return win.$('.app-card[data-id="app_blocked"] .conflict-strip'); }, 30000, 'conflict strip');
    check('a port conflict still shows its card in the list', true);

    // Search narrows the strip too.
    await win.fill('#global-search', 'zzz-nothing');
    await win.waitForTimeout(400);
    check('a search with no match empties the strip and says so', /No running app matches/.test(await win.$eval('#now-strip', (e) => e.textContent)));
    await win.fill('#global-search', 'shop');
    await win.waitForTimeout(400);
    check('a matching search keeps the card', (await win.$$(card('app_shop'))).length === 1);
    await win.fill('#global-search', '');
    await win.waitForTimeout(300);

    // ---- No-preview fallback ---------------------------------------------------
    console.log('step: no-preview fallback');
    await win.evaluate(async () => { document.getElementById('setting-row-previews').checked = false; await window.saveSettings(); });
    await win.waitForSelector(`${card('app_shop')} .now-preview-empty`, { timeout: 8000 });
    const why = await win.$eval(`${card('app_shop')} .now-why`, (e) => e.textContent);
    check('with previews off the card says so, not "not yet"', /off in Settings/.test(why), why);
    await win.evaluate(async () => { document.getElementById('setting-row-previews').checked = true; await window.saveSettings(); });
    await until(async () => (await win.$$(`${card('app_shop')} .now-preview img`)).length === 1, 30000, 'preview back');

    // ---- Details opens the drawer ----------------------------------------------
    console.log('step: details');
    await win.click(`${card('app_shop')} [data-act="openDrawer"]`);
    await win.waitForSelector('#app-drawer:not(.hidden)', { timeout: 5000 });
    check('Details opens the drawer for that app', await win.evaluate(() => /shop/.test(document.getElementById('app-drawer').textContent)));
    check('the opened card is marked', await win.$eval(card('app_shop'), (e) => e.classList.contains('drawer-open')));
    await win.evaluate(() => document.querySelector('#app-drawer-backdrop[data-act="closeAppDrawer"]').click());
    await win.waitForSelector('#app-drawer.hidden', { state: 'attached', timeout: 5000 });

    // ---- Phone width -----------------------------------------------------------
    console.log('step: 390 px');
    await win.setViewportSize({ width: 390, height: 844 });
    await win.waitForTimeout(300);
    const phone = await win.evaluate((sel) => {
      const row = document.querySelector('.now-row');
      const c = document.querySelector(sel).getBoundingClientRect();
      return { display: getComputedStyle(row).display, overflowX: getComputedStyle(row).overflowX, cardW: Math.round(c.width), page: document.documentElement.scrollWidth };
    }, card('app_shop'));
    check('390 px: the strip is a horizontal swipe row', phone.display === 'flex' && phone.overflowX === 'auto', JSON.stringify(phone));
    check('390 px: a card fits inside the screen', phone.cardW <= 390, `${phone.cardW}px`);
    check('390 px: the page does not scroll sideways', phone.page <= 390, `scrollWidth ${phone.page}`);
    await win.setViewportSize({ width: 1440, height: 900 });

    // ---- Screenshots for a person to read --------------------------------------
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const theme of ['tokyonight', 'light', 'glass']) {
        await win.evaluate((t) => document.body.setAttribute('data-theme', t), theme);
        for (const w of [1440, 390]) {
          await win.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
          await win.waitForTimeout(300);
          await win.screenshot({ path: path.join(SHOTS, `strip-${theme}-${w}.png`) });
        }
      }
      await win.evaluate(() => document.body.setAttribute('data-theme', 'tokyonight'));
      await win.setViewportSize({ width: 1440, height: 900 });
    }

    // ---- Stop removes the card -------------------------------------------------
    console.log('step: stop');
    await win.click(`${card('app_shop')} [data-act="stopApp"]`);
    await until(async () => (await win.$$(card('app_shop'))).length === 0, 15000, 'card removed');
    check('Stop removes the card', true);
    check('with nothing running the strip says so', /Nothing is running/.test(await win.$eval('#now-strip', (e) => e.textContent)));
    check('the stopped app is back in the list', (await win.$$('.app-card[data-id="app_shop"]')).length === 1);

    // ---- Back to classic restores the old shape --------------------------------
    await win.evaluate(async () => { document.getElementById('setting-home-layout').value = 'classic'; await window.saveSettings(); });
    await win.waitForTimeout(400);
    check('classic again: the strip hides and the ports section is named and open again', await win.evaluate(() =>
      document.getElementById('now-strip').hidden && /Active Ports/.test(document.querySelector('#ports-section .section-label').textContent) && !document.getElementById('ports-section').classList.contains('collapsed')));
  } finally {
    if (foreign) foreign.kill();
    const w = app.windows()[0];
    if (w) {
      const { apps = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of apps.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
