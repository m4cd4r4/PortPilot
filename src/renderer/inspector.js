// ============ v4 inspector (slice 3) ============
// On desktop the app details drawer is docked as a right-hand inspector in v4 (CSS in
// styles-v4.css; below 1000px it stays the slide-over). This file adds the two things the
// drawer lacks: a page preview at its top, and a first selection so the Apps screen
// opens with something in the inspector (the first app that needs you, else the first
// running one, else the first app). The drawer's own fields, actions and conflict strip
// are unchanged. Loaded after sidebar.js; with the flag off it does nothing.
(function () {
  if (document.documentElement.getAttribute('data-ui') !== 'v4') return;

  const DOCK_MIN = 1000;
  const header = document.querySelector('header.header');

  // The docked inspector starts under the header; measure it rather than assume a height.
  function syncHeader() {
    if (header) document.documentElement.style.setProperty('--v4-header-h', `${header.offsetHeight}px`);
  }
  syncHeader();
  window.addEventListener('resize', syncHeader);

  /** Preview block for the top of the drawer body: the cached thumbnail, or a reason it is missing. */
  function preview(app, live) {
    const thumbs = window.PortPilotRowThumbs;
    const url = thumbs && thumbs.urlFor ? thumbs.urlFor(app.id) : '';
    if (url) {
      return `<div class="v4-insp-preview"><img src="${url}" alt="Page preview of ${escapeHtml(app.name)}" decoding="sync"></div>`;
    }
    const why = live ? 'Preview not captured yet' : 'Start the app to see its page';
    return `<div class="v4-insp-preview v4-insp-preview-empty" role="img" aria-label="${escapeHtml(why)}"><span>${escapeHtml(why)}</span></div>`;
  }

  /** Pick something for the inspector when the Apps screen opens with nothing selected. */
  function autoSelect() {
    if (window.innerWidth < DOCK_MIN || state.drawerAppId || !state.apps.length) return;
    const id = window.PortPilotHomeModel.pickInspected(state.apps.map((a) => ({ id: a.id, state: appRowState(a).state })));
    if (id) openAppDrawer(id);
  }

  window.PortPilotInspector = { preview, autoSelect };
})();
