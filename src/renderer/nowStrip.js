// ============ Home "Now running" strip ============
// Large page previews for every running or detected app, above the Apps list, when
// the setting homeLayout is 'preview' (the default). Which apps and in what order comes from
// src/core/nowStrip.js; the pixels are the 480 px thumbnails rowThumbs.js already
// fetches, so nothing new is captured here. With homeLayout 'classic'
// the strip is hidden and empty, and the Apps screen is exactly as it was.
// Loaded after rowThumbs.js, which provides the thumbnail cache; renderer.js provides
// state, appRowState, icon and escapeHtml, and calls render() at the end of renderApps.
(function () {
  const M = window.PortPilotNowStrip;

  const host = () => document.getElementById('now-strip');
  const enabled = () => M.homeLayoutOf(state.settings) === 'preview';

  function previewHtml(card) {
    const thumbs = window.PortPilotRowThumbs;
    const url = thumbs && thumbs.urlFor ? thumbs.urlFor(card.id) : '';
    if (url) {
      return `<div class="now-preview"><img src="${url}" alt="Page preview of ${escapeHtml(card.name)}" decoding="sync"></div>`;
    }
    const why = M.noPreviewReason(card, false, !!(thumbs && thumbs.enabled && thumbs.enabled()));
    const initial = escapeHtml(String(card.name || '?').trim().charAt(0).toUpperCase() || '?');
    return `<div class="now-preview now-preview-empty" role="img" aria-label="${escapeHtml(`${why} for ${card.name}`)}"><span class="now-initial" aria-hidden="true">${initial}</span><span class="now-why">${escapeHtml(why)}</span></div>`;
  }

  function cardHtml(card) {
    const row = appRowState(state.apps.find((a) => a.id === card.id));
    const claude = /^claude/.test(row.provenance || '');
    const chips = [];
    if (card.port != null) chips.push(`<span class="app-port-badge">:${card.port}</span>`);
    if (card.branch) chips.push(`<span class="branch-chip" style="--branch-color:${escapeHtml(card.color)}" title="Branch / worktree">${icon('branch', 11)}${escapeHtml(card.branch)}</span>`);
    if (claude) chips.push(`<span class="now-claude" title="${escapeHtml(row.provenance)}">${escapeHtml(row.provenance)}</span>`);
    if (row.uptime) chips.push(`<span class="now-uptime">${escapeHtml(row.uptime)}</span>`);
    const active = state.drawerAppId === card.id ? ' drawer-open' : '';
    return `
      <article class="now-card${active}" data-id="${escapeHtml(card.id)}" aria-label="${escapeHtml(card.name)}, running${card.port != null ? ` on port ${card.port}` : ''}">
        ${previewHtml(card)}
        <div class="now-body">
          <div class="now-title"><span class="now-name">${escapeHtml(card.name)}</span></div>
          <div class="now-chips">${chips.join('')}</div>
          <div class="now-actions">
            <button class="btn btn-small btn-secondary" data-act="openInBrowser" data-id="${escapeHtml(card.id)}" title="Open in browser">${icon('browser', 12)} Open</button>
            <button class="btn btn-small btn-secondary" data-act="openDrawer" data-id="${escapeHtml(card.id)}" title="Details">Details</button>
            <button class="btn btn-small btn-danger" data-act="stopApp" data-id="${escapeHtml(card.id)}" data-confirm-key="stop-kill:${escapeHtml(card.id)}" title="Stop">${icon('stop', 12)} Stop</button>
          </div>
        </div>
      </article>`;
  }

  // The layout the page was last set up for; null until the first render.
  let applied = null;

  /**
   * Everything around the strip that follows homeLayout: a body class for CSS, the
   * ports section's name, and its open/closed state. Preview folds the port list into
   * one "Everything listening" row; a switch of layout sets it, later clicks stay.
   */
  function applyLayout() {
    const layout = M.homeLayoutOf(state.settings);
    if (layout === applied) return;
    document.body.classList.toggle('home-preview', layout === 'preview');
    const label = document.querySelector('#ports-section .section-label');
    if (label) label.textContent = layout === 'preview' ? 'Everything listening' : 'Active Ports';
    if (applied !== null || layout === 'preview') {
      state.portsCollapsed = layout === 'preview';
      const section = document.getElementById('ports-section');
      if (section) section.classList.toggle('collapsed', state.portsCollapsed);
    }
    applied = layout;
  }

  /** Rebuild the strip from current state. Cheap: runs on every renderApps. */
  function render() {
    applyLayout();
    const el = host();
    if (!el) return;
    if (!enabled()) { el.hidden = true; el.innerHTML = ''; return; }
    // The search box narrows the strip like it narrows the list.
    const cards = M.runningCards({ ...state, apps: _filterApps(state.apps) });
    if (!cards.length) {
      el.hidden = false;
      const msg = state.globalSearch
        ? `No running app matches "${escapeHtml(state.globalSearch)}".`
        : 'Nothing is running. Start an app below and its page shows up here.';
      el.innerHTML = `<div class="now-head"><span class="now-title-text">Now running</span><span class="count-badge count-badge-small">0</span></div><div class="now-empty">${msg}</div>`;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<div class="now-head"><span class="now-title-text">Now running</span><span class="count-badge count-badge-small">${cards.length}</span></div><div class="now-row">${cards.map(cardHtml).join('')}</div>`;
    reapplyArmed(el);
  }

  window.PortPilotStripView = { render };
})();
