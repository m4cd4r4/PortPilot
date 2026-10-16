/**
 * PortPilot v4 Running home model: the greeting, the one-line tally and which apps are
 * blocked, running or ready. Pure, so the renderer and the tests share one definition.
 * Loaded as a CommonJS module and as the browser global window.PortPilotHomeModel.
 *
 * "Blocked" is any app whose row state is conflict, crashed or error: the same set the
 * sidebar's Needs attention count uses, so the two never disagree.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotHomeModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLOCKED = new Set(['conflict', 'crashed', 'error']);
  const LIVE = new Set(['running', 'starting']);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /**
   * @param {Array<{id:string,state:string}>} rows one entry per top-level app
   * @returns {{empty:boolean,headline:string,sub:string,tone:'ok'|'bad',blocked:string[],running:string[],ready:string[]}}
   */
  function summarise(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const blocked = list.filter((r) => BLOCKED.has(r.state)).map((r) => r.id);
    const running = list.filter((r) => LIVE.has(r.state)).map((r) => r.id);
    const ready = list.filter((r) => !BLOCKED.has(r.state) && !LIVE.has(r.state)).map((r) => r.id);
    const parts = [`${running.length} running`, `${ready.length} ready`];
    if (blocked.length) parts.push(`${blocked.length} blocked`);
    return {
      empty: list.length === 0,
      headline: blocked.length ? `${plural(blocked.length, 'thing needs', 'things need')} you` : 'All good',
      sub: parts.join(' · '),
      tone: blocked.length ? 'bad' : 'ok',
      blocked,
      running,
      ready,
    };
  }

  return { summarise };
});
