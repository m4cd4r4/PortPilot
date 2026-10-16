/**
 * PortPilot v4 sidebar model: which sections the left sidebar lists, the live count on
 * each, and whether a count signals a problem. Pure, so the desktop renderer and the
 * tests share one definition. Loaded as a CommonJS module and as the browser global
 * window.PortPilotSidebarModel.
 *
 * The signature move of v4: the sidebar is the status board. "Needs attention" is the
 * only item that ever turns red, and it is hidden from the eye as a number only when
 * zero (a calm dot-less row), so a glance answers "is anything wrong".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotSidebarModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Section order, ids and the view each one opens. `view` is a main.content data-view. */
  const SECTIONS = [
    { id: 'running',   label: 'Running',         view: 'apps',     focus: 'running' },
    { id: 'attention', label: 'Needs attention', view: 'apps',     focus: 'attention' },
    { id: 'apps',      label: 'Apps',            view: 'apps',     focus: 'apps' },
    { id: 'ports',     label: 'Ports',           view: 'apps',     focus: 'ports' },
    { id: 'browsers',  label: 'Browsers',        view: 'browsers', focus: null },
    { id: 'history',   label: 'History',         view: 'history',  focus: null },
  ];

  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

  /**
   * @param {{running?:number, attention?:number, apps?:number, ports?:number, browsers?:number}} counts
   * @returns {Array<{id:string,label:string,view:string,focus:string|null,count:number|null,tone:'bad'|'ok'|null}>}
   *   count is null for sections that carry no number (History).
   */
  function items(counts = {}) {
    return SECTIONS.map((s) => {
      const count = s.id === 'history' ? null : n(counts[s.id]);
      let tone = null;
      if (s.id === 'attention') tone = count > 0 ? 'bad' : 'ok';
      else if (s.id === 'running' && count > 0) tone = 'ok';
      return { ...s, count, tone };
    });
  }

  /** The section that is selected for a given main.content view and focus. */
  function activeId(view, focus) {
    if (view === 'history') return 'history';
    if (view === 'browsers') return 'browsers';
    const hit = SECTIONS.find((s) => s.view === 'apps' && s.focus === (focus || 'apps'));
    return hit ? hit.id : 'apps';
  }

  return { SECTIONS, items, activeId };
});
