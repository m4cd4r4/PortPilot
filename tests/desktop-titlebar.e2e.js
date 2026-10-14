/**
 * Real-Electron check of the overlay title bar (Windows): no File/Edit/View/Window menu, no
 * separate OS title bar, the PortPilot header carries the window buttons, and the header's
 * own buttons stay clear of them. Against a THROWAWAY config.
 * Run: node tests/desktop-titlebar.e2e.js   (Windows only; needs Electron + playwright)
 * Set PORTPILOT_SHOTS_DIR to save real screen captures of the window (the OS draws the
 * window buttons, so a page screenshot cannot show them).
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;
const { execFileSync } = require('child_process');

const { check, finish } = h.checker();
const world = h.makeWorld('pp-titlebar-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';

/** Capture the screen rectangle of the window with PowerShell (the OS-drawn buttons included). */
function screenCapture(file, b) {
  // The capture runs DPI-aware, so b must be in physical pixels (screen.dipToScreenRect).
  const ps = `Add-Type -AssemblyName System.Drawing; Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name Dpi -Namespace Win; [Win.Dpi]::SetProcessDPIAware() | Out-Null; $bmp = New-Object System.Drawing.Bitmap ${b.width}, ${b.height}; `
    + `$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${b.x}, ${b.y}, 0, 0, $bmp.Size); `
    + `$bmp.Save('${file}'); $g.Dispose(); $bmp.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
}

async function main() {
  if (process.platform !== 'win32') { console.log('skip: the overlay title bar is Windows only'); return; }
  world.writeConfig({ apps: [] });
  const { app, win } = await h.launch(world);
  try {
    await win.waitForSelector('.header');

    check('the application menu is gone', await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null));

    const wco = await win.evaluate(() => {
      const o = navigator.windowControlsOverlay;
      const r = o && o.getTitlebarAreaRect();
      const hr = document.querySelector('.header-right').getBoundingClientRect();
      const hd = document.querySelector('.header').getBoundingClientRect();
      return { visible: !!o && o.visible, areaRight: r ? Math.round(r.x + r.width) : null, areaH: r ? Math.round(r.height) : null,
        btnRight: Math.round(hr.right), headerH: Math.round(hd.height), vw: window.outerWidth };
    });
    check('the header is the title bar (window controls overlay is on)', wco.visible, JSON.stringify(wco));
    check('the window buttons sit inside the header height', wco.areaH != null && wco.areaH <= wco.headerH, `${wco.areaH} vs ${wco.headerH}`);
    check('the header buttons end before the window buttons start', wco.btnRight <= wco.areaRight, JSON.stringify(wco));
    check('there is room kept for the window buttons', wco.vw - wco.areaRight >= 100, `${wco.vw - wco.areaRight}px`);

    // Colours follow the theme and the IPC refuses nonsense.
    const themes = await win.evaluate(() => {
      const out = {};
      for (const t of ['tokyonight', 'light', 'glass']) {
        document.body.setAttribute('data-theme', t);
        out[t] = window.titleBarColors();   // read straight after the switch: must not lag the 200 ms fade
      }
      document.body.setAttribute('data-theme', 'tokyonight');
      return out;
    });
    check('each theme gives opaque #rrggbb title bar colours', Object.values(themes).every((c) => c && /^#[0-9a-f]{6}$/.test(c.color) && /^#[0-9a-f]{6}$/.test(c.symbolColor)), JSON.stringify(themes));
    check('light and dark themes get different title bar colours', themes.light.color !== themes.tokyonight.color, `${themes.light.color} vs ${themes.tokyonight.color}`);
    check('the light theme gets dark window symbols (not light-on-light)', themes.light.symbolColor !== themes.tokyonight.symbolColor && themes.light.symbolColor < '#808080', themes.light.symbolColor);
    const ok = await win.evaluate((c) => window.portpilot.window.setTitleBar({ ...c, height: 46 }), themes.light);
    check('the main process accepts those colours', ok.success === true, JSON.stringify(ok));
    const bad = await win.evaluate(() => window.portpilot.window.setTitleBar({ color: 'red; x', symbolColor: '#fff', height: 46 }));
    check('and refuses a malformed colour', bad.success === false, JSON.stringify(bad));
    await win.evaluate((c) => window.portpilot.window.setTitleBar({ ...c, height: 46 }), themes.tokyonight);

    // The shortcuts the removed menu carried.
    // Keys go in through the main process (sendInputEvent): page-level synthetic keys never reach
    // the window's before-input-event hook, which is where these shortcuts live.
    const key = (keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, k) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, modifiers: k.modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, modifiers: k.modifiers });
    }, { keyCode, modifiers });
    const wcState = (fn) => app.evaluate(({ BrowserWindow }, f) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return f === 'dev' ? wc.isDevToolsOpened() : wc.getZoomLevel();
    }, fn);
    await key('F12');
    await until(async () => wcState('dev'), 5000, 'devtools open on F12').catch(() => {});
    check('F12 opens DevTools (the menu used to)', await wcState('dev'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.closeDevTools());
    const z0 = await wcState('zoom');
    await key('=', ['control']);
    const z1 = await wcState('zoom');
    check('Ctrl+= zooms in', z1 > z0, `${z0} -> ${z1}`);
    await key('0', ['control']);
    check('Ctrl+0 resets zoom', (await wcState('zoom')) === 0);
    const typed = await win.evaluate(() => document.querySelector('#global-search').value);
    check('the shortcut keys did not type into the search box', typed === '', JSON.stringify(typed));

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.show(); w.focus();
        return screen.dipToScreenRect(w, w.getBounds());
      });
      for (const theme of ['tokyonight', 'light', 'glass']) {
        await win.evaluate((t) => { window.setTheme(t, false); }, theme);
        // Windows refuses focus-stealing, so another app can sit over the window; pin it on top for the capture.
        await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); });
        await win.waitForTimeout(1500);   // the body fades over 200 ms and Glass repaints its backdrop after
        screenCapture(path.join(SHOTS, `titlebar-${theme}.png`), bounds);
      }
      await win.evaluate(() => window.setTheme('tokyonight', false));
    }
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
