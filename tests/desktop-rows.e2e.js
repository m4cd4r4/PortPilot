/**
 * Real-Electron check of the port-row actions (R2-4), against a THROWAWAY config.
 * Run: node tests/desktop-rows.e2e.js   (needs Electron + playwright; not part of test:unit)
 * Set PORTPILOT_SHOTS_DIR to save screenshots (3 themes x 1440 and 390, hover state).
 *
 * Covers: every port row has the same five action slots (an absent action is an empty slot),
 * so Kill sits at one x on every row; actions are hidden at rest and shown on hover and on
 * keyboard focus; at 390 nothing in the Apps view runs past the viewport and Kill is reachable;
 * the PID and command moved into the process tooltip when their columns are dropped.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-rows-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

async function main() {
  const [heldPort] = await h.freePorts(1);
  world.writeConfig({ apps: [] });
  const foreign = h.holdPort(heldPort);
  const { app, win } = await h.launch(world);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // The scanner re-renders rows in the background, so every read is one evaluate, never a held handle.
  const rows = () => win.evaluate(() => [...document.querySelectorAll('.port-row')].filter((r) => r.getBoundingClientRect().height).map((r) => {
    const box = r.querySelector('.port-row-actions');
    const kill = box && box.querySelector('[data-act="killPort"]');
    return { slots: box ? box.children.length : 0, killLeft: kill ? Math.round(kill.getBoundingClientRect().left) : null };
  }));
  const actionsState = (nth) => win.evaluate((n) => {
    const box = document.querySelectorAll('.port-row .port-row-actions')[n];
    const kill = box.querySelector('[data-act="killPort"]');
    const r = kill.getBoundingClientRect();
    return { opacity: getComputedStyle(box).opacity, left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  }, nth);
  const pastViewport = () => win.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('main *')].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none' && (r.right > vw + 0.5 || r.left < -0.5);
    }).map((el) => `${el.tagName.toLowerCase()}.${String(el.className.baseVal === undefined ? el.className : el.className.baseVal).split(' ').join('.')}`);
  });

  try {
    await until(async () => (await rows()).length > 0, 30000, 'port rows listed');
    // Expand every collapsed port group so there are rows to measure.
    await win.evaluate(() => document.querySelectorAll('.port-group-rows.collapsed').forEach((g) => { const hd = g.previousElementSibling; if (hd) hd.click(); }));
    await win.waitForTimeout(300);

    for (const [w, hh] of [[1440, 900], [390, 844]]) {
      console.log(`step: ${w}px`);
      await win.setViewportSize({ width: w, height: hh });
      await win.waitForTimeout(400);
      await win.mouse.move(0, 0);

      const all = await rows();
      check(`${w}: port rows are listed`, all.length > 0, String(all.length));
      check(`${w}: every row has the same five action slots`, all.every((r) => r.slots === 5), JSON.stringify([...new Set(all.map((r) => r.slots))]));
      const xs = [...new Set(all.map((r) => r.killLeft))];
      check(`${w}: Kill sits at one x on every row`, xs.length === 1, xs.join(','));

      const rest = await actionsState(0);
      check(`${w}: actions are hidden at rest`, rest.opacity === '0', rest.opacity);

      // A background rescan can replace the row under a stationary pointer (hover does not re-apply
      // until the mouse moves), so re-hover until it shows. A real bug never shows and times out.
      let hov = null;
      await until(async () => {
        await win.mouse.move(0, 0);
        await win.hover('.port-row');
        await win.waitForTimeout(250);
        hov = await actionsState(0);
        return hov.opacity === '1';
      }, 15000, 'row actions to show on hover').catch(() => {});
      hov = hov || await actionsState(0);
      check(`${w}: actions show on hover`, hov.opacity === '1', hov.opacity);
      check(`${w}: Kill is inside the viewport on hover`, hov.right <= hov.vw && hov.left >= 0, `${hov.left}-${hov.right} of ${hov.vw}`);

      await win.mouse.move(0, 0);
      await win.waitForTimeout(250);
      await win.evaluate(() => document.querySelectorAll('.port-row [data-act="killPort"]')[0].focus());
      await win.waitForTimeout(250);
      const foc = await actionsState(0);
      check(`${w}: actions show on keyboard focus`, foc.opacity === '1', foc.opacity);
      check(`${w}: Kill is inside the viewport on focus`, foc.right <= foc.vw && foc.left >= 0, `${foc.left}-${foc.right} of ${foc.vw}`);
      await win.evaluate(() => document.activeElement.blur());

      const over = await pastViewport();
      check(`${w}: nothing in the Apps view runs past the viewport`, over.length === 0, over.slice(0, 5).join(' | '));

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const theme of ['tokyonight', 'light', 'glass']) {
          await win.evaluate((t) => window.setTheme(t, false), theme);
          await win.waitForTimeout(400);
          await win.hover('.port-row');
          await win.waitForTimeout(250);
          await win.screenshot({ path: path.join(SHOTS, `rows-${theme}-${w}.png`) });
          await win.mouse.move(0, 0);
        }
        await win.evaluate(() => window.setTheme('tokyonight', false));
      }
    }

    const tip = await win.evaluate(() => { const p = [...document.querySelectorAll('.port-row')].find((r) => r.querySelector('.port-pid').textContent.trim()); return p ? p.querySelector('.port-proc').title : ''; });
    check('the process tooltip carries the PID', /\(PID \d+\)/.test(tip), tip);

    check('no console errors or page errors', errors.length === 0, errors.join(' | '));
  } finally {
    foreign.kill();
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
