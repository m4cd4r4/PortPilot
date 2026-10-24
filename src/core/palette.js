/**
 * Pure model for the Ctrl+K command palette: which commands exist right now and how a typed
 * query ranks them. Loaded as a browser global (window.PortPilotPalette) by the renderer,
 * which runs without Node, and as a CommonJS module by tests. It only describes commands as
 * data ({ type, ... }); the renderer decides how each type runs, through the same functions
 * the buttons already call.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotPalette = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_RESULTS = 50;
  const VIEWS = [
    { view: 'apps', label: 'Go to Apps' },
    { view: 'history', label: 'Go to History' },
    { view: 'browsers', label: 'Go to Browsers' },
  ];

  const appName = (a) => String(a.name || a.id || 'app');

  /**
   * @param {object} s
   * @param {Array<{id,name,preferredPort?,branch?}>} s.apps
   * @param {Object<string,{port?:number}>} s.running   appId -> live info, present only while the app is up
   * @param {Array<{port,pid?,processName?}>} s.ports   user-killable listeners (the renderer drops system ones)
   * @param {Array<{name,state}>} s.profiles            browser profiles; state 'up' means running
   * @param {Array<{view,label}>} [s.views]              the "Go to" targets; defaults to the v4 renderer's tabs
   * @param {string} [s.view]                           the view on screen, left out of "Go to"
   */
  function buildCommands(s) {
    const out = [];
    const running = s.running || {};
    for (const a of s.apps || []) {
      const name = appName(a);
      const branch = a.branch ? ` (${a.branch})` : '';
      const live = running[a.id];
      if (live) {
        out.push({ id: `stop:${a.id}`, kind: 'app', label: `Stop ${name}${branch}`, hint: (live.port || a.preferredPort) ? `:${live.port || a.preferredPort}` : 'running',
          keywords: `${name} ${a.branch || ''} stop kill`, action: { type: 'stopApp', id: a.id } });
        out.push({ id: `open:${a.id}`, kind: 'app', label: `Open ${name}${branch} in browser`, hint: (live.port || a.preferredPort) ? `:${live.port || a.preferredPort}` : '',
          keywords: `${name} ${a.branch || ''} open browser visit`, action: { type: 'openApp', id: a.id } });
      } else {
        out.push({ id: `start:${a.id}`, kind: 'app', label: `Start ${name}${branch}`, hint: a.preferredPort ? `:${a.preferredPort}` : 'stopped',
          keywords: `${name} ${a.branch || ''} start run launch`, action: { type: 'startApp', id: a.id } });
      }
      out.push({ id: `history:${a.id}`, kind: 'history', label: `History for ${name}${branch}`, hint: 'past runs',
        keywords: `${name} ${a.branch || ''} history runs log`, action: { type: 'historyApp', id: a.id } });
    }
    for (const p of s.ports || []) {
      const who = p.processName ? String(p.processName) : 'a process';
      out.push({ id: `kill:${p.port}`, kind: 'port', label: `Free port ${p.port}`, hint: p.pid ? `${who} (pid ${p.pid})` : who,
        keywords: `${p.port} ${who} free kill port`, action: { type: 'killPort', port: p.port },
        confirm: `Press Enter again to stop ${who}${p.pid ? ` (pid ${p.pid})` : ''} on :${p.port}` });
    }
    for (const pr of s.profiles || []) {
      const up = pr.state === 'up';
      out.push({ id: `${up ? 'bstop' : 'bstart'}:${pr.name}`, kind: 'browser', label: `${up ? 'Stop' : 'Start'} browser ${pr.name}`, hint: up ? 'running' : 'stopped',
        keywords: `${pr.name} browser profile ${up ? 'stop' : 'start'}`, action: { type: up ? 'stopBrowser' : 'startBrowser', name: pr.name } });
    }
    for (const v of s.views || VIEWS) {
      if (v.view === s.view) continue;
      out.push({ id: `view:${v.view}`, kind: 'view', label: v.label, hint: '', keywords: `${v.view} tab screen`, action: { type: 'view', view: v.view } });
    }
    out.push({ id: 'scan', kind: 'global', label: 'Scan ports', hint: 'Ctrl+R', keywords: 'scan refresh ports reload', action: { type: 'scan' } });
    out.push({ id: 'add', kind: 'global', label: 'Add app', hint: 'Ctrl+N', keywords: 'add new app register', action: { type: 'addApp' } });
    return out;
  }

  /** Score one command for a query; null when any word of the query is missing from it. */
  function score(cmd, words) {
    const label = cmd.label.toLowerCase();
    const hay = `${label} ${String(cmd.keywords || '').toLowerCase()} ${String(cmd.hint || '').toLowerCase()}`;
    let total = 0;
    for (const w of words) {
      const at = hay.indexOf(w);
      if (at < 0) return null;
      const inLabel = label.indexOf(w);
      if (inLabel === 0) total += 40;
      else if (inLabel > 0 && /[\s:(/.-]/.test(label[inLabel - 1])) total += 25;   // starts a word in the label
      else if (inLabel > 0) total += 10;
      else total += 4;                                                              // only in keywords or hint
      total -= Math.min(at, 20) / 20;                                               // earlier is better, never decisive
    }
    return total;
  }

  /** The commands matching the query, best first; the input order breaks ties. Empty query keeps the input order. */
  function rank(query, commands) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands.slice(0, MAX_RESULTS);
    const scored = [];
    commands.forEach((cmd, i) => {
      const sc = score(cmd, words);
      if (sc != null) scored.push({ cmd, sc, i });
    });
    scored.sort((a, b) => b.sc - a.sc || a.i - b.i);
    return scored.slice(0, MAX_RESULTS).map((x) => x.cmd);
  }

  /** Move the highlighted row by delta, wrapping at both ends; -1 when the list is empty. */
  function moveIndex(index, count, delta) {
    if (!count) return -1;
    const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
    return (((from + delta) % count) + count) % count;
  }

  return { buildCommands, rank, moveIndex, MAX_RESULTS };
});
