/**
 * PortPilot port-conflict model.
 *
 * Answers one question every surface asks when an app's port is taken: what
 * holds it, how do we say so in one line, and which actions do we offer, in
 * which order? The desktop renderer draws the answer as the inline conflict
 * strip; the MCP start guard (Wave 2 row #7) reuses it so Claude is offered
 * the same choices a human is.
 *
 * Pure and side-effect free. Loadable as a CommonJS module (agent, tests) and
 * as the browser global window.PortPilotConflict (the renderer cannot require).
 * Depends on status.js for provenance words; in the browser status.js must be
 * loaded first.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotConflict = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // How long a destructive button stays armed ("Confirm kill?") after the
  // first click. A second click inside the window runs the action.
  const CONFIRM_MS = 3000;

  function statusApi() {
    if (typeof module !== 'undefined' && module.exports) return require('./status');
    return root && root.PortPilotStatus;
  }

  /** "just now" | "12m ago" | "3h ago" | "2d ago", or '' for an unknown age. */
  function fmtAge(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  /**
   * Describe a port conflict.
   *
   * @param {object} c
   * @param {number} c.port              the contested port
   * @param {object} c.holder            { processName?, pid?, uptime? (seconds) }
   * @param {object} [c.holderApp]       registered app holding the port ({ name }), if any
   * @param {object} [c.holderStartedBy] startedBy record of the holder, if known
   * @param {object} [c.app]             the app that wants the port ({ name })
   * @param {number} [c.freePort]        next free port, if already looked up
   * @returns {{ kind, port, holderName, sentence, title, actions }}
   *   kind     'managed' (a registered app holds it) | 'unmanaged'
   *   sentence one line of plain text (callers must escape it for HTML)
   *   actions  recommended first: useFreePort, killAndStart, showProcess
   */
  function describeConflict(c) {
    const o = c || {};
    const port = Number(o.port);
    const holder = o.holder || {};
    const holderApp = o.holderApp && o.holderApp.name ? o.holderApp : null;
    const kind = holderApp ? 'managed' : 'unmanaged';
    const proc = holder.processName || 'an unknown process';
    const holderName = holderApp ? holderApp.name : proc;

    const S = statusApi();
    const prov = o.holderStartedBy && S ? S.provenanceOf(o.holderStartedBy) : null;
    const known = prov && prov.kind !== 'external';

    const details = [];
    if (holderApp) details.push(proc);
    if (holder.pid != null) details.push(`PID ${holder.pid}`);
    const age = fmtAge(holder.uptime);
    if (age) details.push(`started ${age}`);
    if (known) details.push(`started by ${prov.word}`);
    else if (!holderApp) details.push('not managed');

    const sentence = `:${port} is held by ${holderName}` + (details.length ? ` (${details.join(', ')})` : '');
    const title = known ? prov.title : '';

    const freePort = Number(o.freePort) || null;
    const appName = o.app && o.app.name ? o.app.name : 'the app';
    const actions = [
      {
        id: 'useFreePort',
        label: freePort ? `Use :${freePort} instead` : 'Use next free port',
        title: `Start ${appName} on ${freePort ? `:${freePort}` : 'the next free port'} for this run. The saved port stays :${port}.`,
        destructive: false,
        recommended: true,
      },
      {
        id: 'killAndStart',
        label: holderApp ? `Stop ${holderApp.name} & start` : 'Kill & start',
        title: `End ${holderName}${holder.pid != null ? ` (PID ${holder.pid})` : ''}, then start ${appName} on :${port}`,
        confirmLabel: holderApp ? 'Confirm stop?' : 'Confirm kill?',
        destructive: true,
        recommended: false,
      },
      {
        id: 'showProcess',
        label: 'Show process',
        title: `Find :${port} in the Ports list`,
        destructive: false,
        recommended: false,
      },
    ];

    return { kind, port, holderName, sentence, title, actions };
  }

  /** One conflict's identity across scans: same app, port and holder pid. */
  function conflictKey(c) {
    const pid = c && c.occupiedBy ? c.occupiedBy.pid : null;
    return `${c && c.appId}:${c && c.port}:${pid == null ? '' : pid}`;
  }

  /**
   * The toast a scan should raise for its conflicts. The row strip carries a
   * standing conflict, so only conflicts absent from the previous scan are
   * announced, and several at once share one toast.
   *
   * @param {Set<string>} seen   keys announced by earlier scans
   * @param {object[]} conflicts this scan's conflicts ({ appId, appName, port, occupiedBy })
   * @returns {{ keys: Set<string>, message: string|null }}
   *   keys    pass back as `seen` next scan (a resolved conflict drops out, so
   *           its return is announced again)
   *   message null when there is nothing new to say
   */
  function conflictToast(seen, conflicts) {
    const list = Array.isArray(conflicts) ? conflicts : [];
    const keys = new Set(list.map(conflictKey));
    const fresh = list.filter(c => !(seen && seen.has(conflictKey(c))));
    let message = null;
    if (fresh.length === 1) {
      const c = fresh[0];
      const h = c.occupiedBy || {};
      message = `Port ${c.port} blocked for ${c.appName} by ${h.processName || 'Unknown'}` +
        (h.pid != null ? ` (PID ${h.pid})` : '');
    } else if (fresh.length > 1) {
      message = `${fresh.length} port conflicts - see the marked rows`;
    }
    return { keys, message };
  }

  return { CONFIRM_MS, fmtAge, describeConflict, conflictKey, conflictToast };
});
