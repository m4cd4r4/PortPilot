// ============ v4 sidebar (slice 1) ============
// The left sidebar that replaces the Apps / History / Browsers tabs when the v4 flag is on.
// Each item shows a live count; "Needs attention" turns red when anything is crashed, in
// conflict or unhealthy, so the sidebar answers "is anything wrong" without a click.
// What each item lists comes from src/core/sidebarModel.js. The Apps-family items
// (Running, Needs attention, Apps, Ports) are focus modes of the existing Apps view
// (main.content[data-v4-focus]); slices 2 to 4 replace them with real screens.
// Loaded after palette.js. With the flag off this file does nothing and the nav stays hidden.
(function () {
  if (document.documentElement.getAttribute('data-ui') !== 'v4') return;
  const M = window.PortPilotSidebarModel;
  const nav = document.getElementById('v4-sidebar');
  const content = document.querySelector('main.content');
  if (!M || !nav || !content) return;

  const ICONS = { running: 'play', attention: null, apps: 'home', ports: 'plug', browsers: 'browser', history: 'logs' };
  const TRIANGLE = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2l7 12H1L8 2z"/></svg>`;
  const BAD = new Set(['conflict', 'crashed', 'error']);

  let focus = 'apps';

  function counts() {
    const live = (a) => !!(state.runningApps.find((r) => r.id === a.id && r.running) || state.detectedApps[a.id]);
    const attention = state.apps.filter((a) => BAD.has(appRowState(a).state)).length;
    const browsers = window.PortPilotBrowsers ? window.PortPilotBrowsers.profiles().length : 0;
    return { running: state.apps.filter(live).length, attention, apps: state.apps.length, ports: state.ports.length, browsers };
  }

  function currentFocus() { return content.dataset.v4Focus || 'apps'; }

  function itemHtml(it, activeId) {
    const glyph = it.id === 'attention' ? TRIANGLE(14) : icon(ICONS[it.id], 14);
    const on = it.id === activeId;
    const num = it.count === null ? '' : `<span class="v4-nav-count">${it.count}</span>`;
    const label = it.count === null ? it.label : `${it.label}, ${it.count}`;
    return `<button type="button" class="v4-nav-item${on ? ' on' : ''}" data-section="${it.id}"${it.tone ? ` data-tone="${it.tone}"` : ''} aria-label="${label}"${on ? ' aria-current="page"' : ''}>
      <span class="v4-nav-glyph" aria-hidden="true">${glyph}</span><span class="v4-nav-label">${it.label}</span>${num}
    </button>`;
  }

  function render() {
    const view = content.dataset.view || 'apps';
    focus = currentFocus();
    const activeId = M.activeId(view, focus);
    nav.hidden = false;
    nav.innerHTML = `
      <div class="v4-brand"><span class="v4-brand-mark" aria-hidden="true"></span><span class="v4-brand-name">PortPilot</span></div>
      <div class="v4-nav-list">${M.items(counts()).map((it) => itemHtml(it, activeId)).join('')}</div>
      <div class="v4-nav-foot">
        <button type="button" class="v4-nav-item" data-section="palette" aria-label="Search or run a command"><span class="v4-nav-glyph" aria-hidden="true">${icon('search', 14)}</span><span class="v4-nav-label">Search or run</span><kbd class="v4-kbd">Ctrl K</kbd></button>
        <button type="button" class="v4-nav-item" data-section="settings" aria-label="Settings"><span class="v4-nav-glyph" aria-hidden="true">${icon('gear', 14)}</span><span class="v4-nav-label">Settings</span></button>
      </div>`;
  }

  function open(id) {
    if (id === 'settings') return document.getElementById('btn-settings').click();
    if (id === 'palette') return document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    const it = M.SECTIONS.find((s) => s.id === id);
    if (!it) return;
    window.PortPilotHistory.setView(it.view);
    if (it.view === 'apps') {
      content.dataset.v4Focus = it.focus;
      if (it.focus === 'ports') {
        state.portsCollapsed = false;
        document.getElementById('ports-section')?.classList.remove('collapsed');
      }
    } else {
      delete content.dataset.v4Focus;
    }
    content.scrollTop = 0;
    render();
  }

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-section]');
    if (b) open(b.dataset.section);
  });
  // The palette and the old tabs change the view too: keep the highlight honest.
  new MutationObserver(render).observe(content, { attributes: true, attributeFilter: ['data-view'] });

  document.body.classList.add('v4-shell');
  window.PortPilotSidebar = { render };
  render();
})();
