#!/usr/bin/env node
/**
 * Browser profiles CLI (plan row 26, slice 1). The only way to reach the core until the
 * desktop panel and MCP tools land (slice 2).
 *
 *   node scripts/browser-profiles.js detect
 *   node scripts/browser-profiles.js list
 *   node scripts/browser-profiles.js add <name> --port 9390 [--browser brave] [--mode headed] [--url ...] [--note ...]
 *   node scripts/browser-profiles.js start|stop <name> [--mode offscreen]
 *   node scripts/browser-profiles.js status [name]
 *   node scripts/browser-profiles.js remove <name> [--purge]
 *   node scripts/browser-profiles.js --import-pool <pool.json> [--adopt-dirs]
 *
 * --config <file> points at a different portpilot-config.json (a throwaway one for tests);
 * the default is the real PortPilot config. Importing is explicit: nothing reads a pool.json on its own.
 */
const { getConfigPath } = require('../src/core/configPath');
const { detectBrowsers } = require('../src/core/browserDetect');
const profiles = require('../src/core/browserProfiles');
const run = require('../src/core/browserRun');

function parse(argv) {
  const flags = {};
  const rest = [];
  const valued = new Set(['config', 'port', 'browser', 'mode', 'url', 'note', 'import-pool']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const key = a.slice(2);
    flags[key] = valued.has(key) ? argv[++i] : true;
  }
  return { flags, rest };
}

const row = (cols, widths) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
function table(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  console.log(row(header, widths));
  for (const r of rows) console.log(row(r, widths));
}

async function main() {
  const { flags, rest } = parse(process.argv.slice(2));
  const configPath = flags.config || getConfigPath();
  const [cmd, name] = rest;

  if (flags['import-pool']) {
    const { imported, skipped } = profiles.importPool(configPath, flags['import-pool'], { adoptDirs: !!flags['adopt-dirs'] });
    console.log(`imported ${imported.length}, skipped ${skipped.length}`);
    for (const s of skipped) console.log(`  skipped ${s.name}: ${s.reason}`);
    return;
  }

  switch (cmd) {
    case 'detect': {
      const found = detectBrowsers();
      if (!found.length) console.log('no Chromium-family browser found');
      table(['ID', 'BROWSER', 'PATH'], found.map((b) => [b.id, b.label, b.path]));
      break;
    }
    case 'list':
      table(['NAME', 'PORT', 'BROWSER', 'MODE', 'URL'],
        profiles.listProfiles(configPath).map((p) => [p.name, p.port, p.browser, p.mode, p.url]));
      break;
    case 'add': {
      const p = profiles.addProfile(configPath, { name, port: flags.port, browser: flags.browser, mode: flags.mode, url: flags.url, note: flags.note });
      console.log(`added ${p.name} on :${p.port} (${p.browser}, ${p.mode})`);
      break;
    }
    case 'remove': {
      const { removed, purged } = profiles.removeProfile(configPath, name, { purge: !!flags.purge });
      console.log(`removed ${removed.name}${purged ? ' and deleted its user-data-dir' : '; user-data-dir kept'}`);
      break;
    }
    case 'start': {
      const r = await run.startProfile(configPath, name, { mode: flags.mode });
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'stop': {
      const r = await run.stopProfile(configPath, name);
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case 'status':
    case undefined: {
      const list = profiles.listProfiles(configPath).filter((p) => !name || p.name.toLowerCase() === name.toLowerCase());
      const { rows, warnings } = await run.allStatus(configPath, list);
      table(['NAME', 'PORT', 'MODE', 'STATE', 'PID', 'TAB'],
        rows.map((r) => [r.name, r.port, r.mode, r.state, r.pid ?? '-', (r.tabs[0] && r.tabs[0].url || '').slice(0, 58)]));
      for (const w of warnings) console.log(`warning: ${w.sentence}`);
      break;
    }
    default:
      console.error(`unknown command "${cmd}". detect | list | add | remove | start | stop | status | --import-pool <file>`);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`browser-profiles: ${err.code ? `[${err.code}] ` : ''}${err.message}`);
  process.exitCode = 1;
});
