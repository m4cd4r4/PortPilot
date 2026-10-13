/**
 * Real-Electron check: a port held by a process PortPilot itself started is never a conflict,
 * however the app's command is written. Against a THROWAWAY config.
 * Run: node tests/desktop-own-port.e2e.js   (needs Electron + playwright; not part of test:unit)
 *
 * The folder names share no word with the app names, so only process ownership can tie the
 * listener to its app (a relative `node server.js` names neither the cwd nor the app).
 */
const h = require('./e2e-harness');
const { fs, path, until, sleep } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-ownport-');
const card = (id) => `.app-card[data-id="${id}"]`;

async function main() {
  const ports = await h.freePorts(4);
  const forms = [
    ['alpha', 'relative path', (dir, p) => `node server.js --port ${p}`],
    ['bravo', 'absolute path', (dir, p) => `node "${path.join(dir, 'server.js').replace(/\\/g, '/')}" --port ${p}`],
    ['charlie', 'npm start', () => 'npm start'],
    ['delta', 'relative, port from $PORT', () => 'node server.js'],
  ];
  const apps = forms.map(([name, label, mk], i) => {
    const dir = world.mkdir(`zz-demo-${i + 1}`);
    fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `own-port-${i}`, scripts: { start: `node server.js --port ${ports[i]}` } }));
    return { id: `app_${name}`, name, label, command: mk(dir, ports[i]), cwd: dir, preferredPort: ports[i] };
  });
  world.writeConfig({ apps: apps.map(({ label, ...a }) => a) });

  const { app, win } = await h.launch(world);
  try {
    for (const a of apps) await win.waitForSelector(card(a.id));
    for (const a of apps) await win.click(`${card(a.id)} [data-act="startApp"]`);
    for (const a of apps) await until(async () => (await fetch(`http://127.0.0.1:${a.preferredPort}/`)).ok, 30000, `${a.name} answering`);

    // Several scans: a conflict can appear on any of them, not just the first.
    const strips = {}; const conflicts = {};
    for (let i = 0; i < 5; i++) {
      await win.evaluate(() => window.loadApps());
      await sleep(1000);
      for (const a of apps) {
        if (await win.$(`${card(a.id)} .conflict-strip`)) strips[a.id] = true;
        if (await win.evaluate((id) => state.unknownConflicts.some((c) => c.appId === id), a.id)) conflicts[a.id] = true;
      }
    }
    for (const a of apps) {
      check(`running app (${a.label}) shows no conflict strip`, !strips[a.id] && !conflicts[a.id], a.command);
      const word = await win.$eval(`${card(a.id)} .state-word`, (e) => e.textContent.trim());
      check(`running app (${a.label}) says Running, not Port blocked`, /^running$/i.test(word), word);
      const detected = await win.evaluate((id) => state.detectedApps[id]?.port, a.id);
      check(`running app (${a.label}) is matched to its own port`, detected === a.preferredPort, String(detected));
    }
  } finally {
    const w = app.windows()[0];
    if (w) {
      const { apps: list = [] } = await w.evaluate(() => window.portpilot.process.list()).catch(() => ({}));
      for (const a of list.filter((x) => x.running)) await w.evaluate((x) => window.portpilot.process.stop(x), a.id).catch(() => {});
    }
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); finish(); process.exit(2); });
