// ============ Apps row page previews ============
// A running app's row shows the latest page thumbnail PortPilot already took for
// its open run (history/thumbs, see src/main/thumbnails.js). No capture happens
// here: main picks the run (history:rowThumbs, no probes) and the pixels come
// from the same history:thumbs call the History tab uses. Stopped apps show
// nothing, so a row never claims a page that is no longer served.
// Loaded after renderer.js, which provides state, renderApps and loadApps.
(function () {
  const W = 32;
  const H = 18;
  const BATCH = 60;         // history:thumbs answers at most this many ids per call
  const cache = new Map();  // runId -> data URL
  const asked = new Set();  // `${runId}:${thumb}` already requested
  let byApp = {};           // appId -> { id, thumb }, from history:rowThumbs

  const api = () => (window.portpilot && window.portpilot.history) || null;
  const enabled = () => state.settings.rowPreviews !== false && !!(api() && api().rowThumbs);
  const isRunning = (id) => !!(state.runningApps.find((r) => r.id === id && r.running) || state.detectedApps[id]);
  const livePort = (id) => (state.runningApps.find((r) => r.id === id && r.running) || state.detectedApps[id] || {}).port;
  /** The run's thumb belongs to the server on screen only when the ports agree. */
  const portMatches = (id, cur) => cur.port == null || livePort(id) == null || cur.port === livePort(id);

  /** True when the row exists and is on screen (not inside a collapsed group). */
  function visibleCard(id) {
    const el = document.querySelector(`.app-card[data-id="${CSS.escape(id)}"]`);
    return !!el && el.offsetParent !== null;
  }

  /** The thumbnail cell for one row, or '' (the row then looks exactly as before). */
  function html(app, running) {
    if (!running || !enabled()) return '';
    const cur = byApp[app.id];
    const url = cur && portMatches(app.id, cur) && cache.get(cur.id);
    if (!url) return '';
    // role=img + aria-label names the whole control; tabindex lets the keyboard open the large preview.
    const label = `Page preview of ${escapeHtml(app.name)}, hover or focus to enlarge`;
    return `<span class="row-thumb" role="img" tabindex="0" aria-label="${label}" data-app="${escapeHtml(app.id)}"><img src="${url}" alt="" width="${W}" height="${H}" decoding="sync"></span>`;
  }

  // ---- Large preview (hover / keyboard focus) ----
  // One shared popover on <body>, position:fixed, so it cannot change a row's height or
  // be clipped by the list. It shows the very pixels already in the thumbnail's <img>
  // (the stored 480 px history thumbnail), so no second capture or fetch exists.
  const PW = 256;
  const PH = 144;
  const GAP = 6;
  const MARGIN = 8;
  let pop = null;
  let shownId = null;

  function popover() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'row-preview';
    pop.setAttribute('aria-hidden', 'true'); // the thumbnail carries the accessible name
    pop.innerHTML = '<img alt="" width="' + PW + '" height="' + PH + '">';
    document.body.appendChild(pop);
    return pop;
  }

  function place(anchor) {
    const p = popover();
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // Below the thumbnail when it fits, else above; then clamped on screen.
    let top = r.bottom + GAP;
    if (top + PH > vh - MARGIN) top = r.top - GAP - PH;
    top = Math.max(MARGIN, Math.min(top, vh - PH - MARGIN));
    const left = Math.max(MARGIN, Math.min(r.left, vw - PW - MARGIN));
    p.style.top = `${Math.round(top)}px`;
    p.style.left = `${Math.round(left)}px`;
  }

  function show(anchor) {
    const img = anchor.querySelector('img');
    if (!enabled() || !img || !img.src) return hide();
    const p = popover();
    const big = p.firstChild;
    if (big.src !== img.src) big.src = img.src;
    shownId = anchor.dataset.app || null;
    place(anchor);
    p.classList.add('open');
  }

  function hide() {
    shownId = null;
    if (pop) pop.classList.remove('open');
  }

  /** Rows are rebuilt on every refresh: follow the same app's new thumbnail, or hide. */
  function reanchor() {
    if (!shownId) return;
    const t = enabled() && document.querySelector(`.row-thumb[data-app="${CSS.escape(shownId)}"]`);
    if (t && (t.matches(':hover') || t === document.activeElement)) show(t); else hide();
  }

  const thumbOf = (e) => (e.target && e.target.closest ? e.target.closest('.row-thumb') : null);
  document.addEventListener('mouseover', (e) => { const t = thumbOf(e); if (t) show(t); });
  document.addEventListener('mouseout', (e) => { const t = thumbOf(e); if (t && !t.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { const t = thumbOf(e); if (t) show(t); });
  document.addEventListener('focusout', (e) => { if (thumbOf(e)) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  /** Fetch pixels for visible running rows that lack them; re-render once they land. */
  async function sync() {
    reanchor(); // renderApps just rebuilt the rows
    if (!enabled()) return;
    const need = Object.entries(byApp).filter(([id, cur]) =>
      !cache.has(cur.id) && !asked.has(`${cur.id}:${cur.thumb}`) && isRunning(id) && visibleCard(id)).slice(0, BATCH);
    if (!need.length) return;
    const keys = need.map(([, cur]) => `${cur.id}:${cur.thumb}`);
    keys.forEach((k) => asked.add(k));
    let got = 0;
    try {
      const res = await api().thumbs(need.map(([, cur]) => cur.id));
      if (res.success) {
        const entries = Object.entries(res.thumbs);
        for (const [rid, url] of entries) cache.set(rid, url);
        got = entries.length;
      }
    } catch { /* previews are decoration */ }
    // Anything that did not come back may be asked for again on a later refresh.
    need.forEach(([, cur], i) => { if (!cache.has(cur.id)) asked.delete(keys[i]); });
    if (got) renderApps();
  }

  /** Ask main which run each app shows; called after every loadApps. */
  async function refresh() {
    if (!enabled()) return;
    try {
      const res = await api().rowThumbs();
      if (!res.success) return;
      const next = res.byApp || {};
      if (JSON.stringify(next) === JSON.stringify(byApp)) return;
      byApp = next;
      const live = new Set(Object.values(byApp).map((cur) => cur.id));
      for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
      for (const key of [...asked]) if (!live.has(key.split(':')[0])) asked.delete(key);
      renderApps();
    } catch { /* previews are decoration */ }
  }

  /** The Settings toggle changed: redraw now, fetch if it was just turned on. */
  function settingChanged() {
    if (!enabled()) { hide(); byApp = {}; cache.clear(); asked.clear(); renderApps(); return; }
    refresh().then(renderApps);
  }

  window.PortPilotRowThumbs = { html, sync, refresh, settingChanged };
})();
