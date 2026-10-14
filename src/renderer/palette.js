// ============ Ctrl+K command palette ============
// One keyboard door to what the buttons already do: start or stop an app, open it, see its
// history, free a port, start or stop a browser profile, go to a tab. The command list and
// the ranking are the pure model in src/core/palette.js; every command runs through the same
// function its button calls, so a command cannot do something a button cannot.
// Loaded after nowStrip.js; renderer.js provides state, escapeHtml and showToast, and the
// action functions are the globals it exposes.
(function () {
  const P = window.PortPilotPalette;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s));
  const KIND_LABEL = { app: 'App', history: 'History', port: 'Port', browser: 'Browser', view: 'Go to', global: 'App' };

  const p = {
    open: false,
    all: [],          // every command right now
    shown: [],        // the ranked, filtered ones
    active: -1,
    armed: null,      // id of a destructive command waiting for its second Enter
    returnTo: null,   // what had focus before the palette opened
  };

  /** Everything the model needs, read from the same state the screen is drawn from. */
  function snapshot() {
    const running = {};
    for (const r of state.runningApps || []) if (r.running) running[r.id] = { port: r.port };
    for (const [id, d] of Object.entries(state.detectedApps || {})) if (!running[id]) running[id] = { port: d && d.port };
    const S = window.PortPilotStatus;
    const ports = (state.ports || []).filter((x) => x.pid && S.classify(x) !== 'system');
    const B = window.PortPilotBrowsers;
    return {
      apps: state.apps || [],
      running,
      ports,
      profiles: B && B.profiles ? B.profiles() : [],
      view: document.querySelector('main.content')?.dataset.view || 'apps',
    };
  }

  function rowHtml(cmd, i) {
    const on = i === p.active;
    const armed = p.armed === cmd.id;
    return `<li id="palette-opt-${i}" class="palette-row${on ? ' active' : ''}${armed ? ' armed' : ''}" role="option" aria-selected="${on}" data-i="${i}">`
      + `<span class="palette-kind">${esc(KIND_LABEL[cmd.kind] || '')}</span>`
      + `<span class="palette-label">${esc(cmd.label)}</span>`
      + `<span class="palette-hint">${esc(cmd.hint || '')}</span></li>`;
  }

  function foot() {
    const cmd = p.shown[p.active];
    if (cmd && p.armed === cmd.id) return cmd.confirm;
    return p.shown.length ? 'Up and Down to move, Enter to run, Esc to close' : '';
  }

  function render() {
    const list = $('palette-list');
    const input = $('palette-input');
    list.innerHTML = p.shown.length
      ? p.shown.map(rowHtml).join('')
      : `<li class="palette-empty">${input.value.trim() ? `Nothing matches "${esc(input.value.trim())}"` : 'No commands yet'}</li>`;
    input.setAttribute('aria-activedescendant', p.active >= 0 ? `palette-opt-${p.active}` : '');
    const f = $('palette-foot');
    f.textContent = foot();
    f.classList.toggle('warn', !!(p.shown[p.active] && p.armed === p.shown[p.active].id));
    const row = p.active >= 0 ? $(`palette-opt-${p.active}`) : null;
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  // keepId: the row to stay on when the list is rebuilt under the user (a background refresh).
  // That also keeps an armed command armed, so a refresh cannot silently undo the first Enter.
  function refilter(keepId) {
    const armed = keepId && p.armed === keepId ? keepId : null;
    p.shown = P.rank($('palette-input').value, p.all);
    const at = keepId ? p.shown.findIndex((c) => c.id === keepId) : -1;
    p.active = at >= 0 ? at : (p.shown.length ? 0 : -1);
    p.armed = at >= 0 ? armed : null;
    render();
  }

  function openPalette() {
    if (p.open) return;
    if (document.querySelector('.modal:not(.hidden)')) return;   // a dialog is mid-task; do not stack on it
    p.open = true;
    p.returnTo = document.activeElement;
    p.all = P.buildCommands(snapshot());
    $('palette-input').value = '';
    $('palette').classList.remove('hidden');
    refilter();
    $('palette-input').focus();
    // Browser profiles load with the Browsers tab; fetch them once so they are searchable from anywhere.
    const B = window.PortPilotBrowsers;
    if (B && B.load) {
      B.load().then(() => {
        if (!p.open) return;
        const keep = p.shown[p.active] && p.shown[p.active].id;
        p.all = P.buildCommands(snapshot());
        refilter(keep);
      }).catch(() => {});
    }
  }

  function closePalette() {
    if (!p.open) return;
    p.open = false;
    p.armed = null;
    $('palette').classList.add('hidden');
    const back = p.returnTo;
    p.returnTo = null;
    if (back && back.isConnected && back.focus) back.focus();
  }

  const nameOf = (id) => ((state.apps || []).find((a) => a.id === id) || {}).name || 'that app';

  /** The same functions the buttons call. */
  function execute(action) {
    switch (action.type) {
      case 'startApp': return startApp(action.id);
      case 'stopApp': return stopApp(action.id);
      case 'openApp': return openInBrowser(action.id);
      case 'historyApp':
        return window.PortPilotHistory.showApp(action.id).then((has) => {
          if (!has) showToast(`No runs recorded for ${nameOf(action.id)} yet`, 'info');
        });
      case 'killPort':
        showToast(`Freeing :${action.port}...`, 'info');   // finding and stopping the holder can take seconds
        return killPort(action.port);
      case 'startBrowser':
      case 'stopBrowser': return window.PortPilotBrowsers.toggle(action.name);
      case 'view': return window.PortPilotHistory.setView(action.view);
      case 'scan': scanPorts(); return loadApps();
      case 'addApp': return openAppModal();
      default: return undefined;
    }
  }

  function run(i) {
    const cmd = p.shown[i];
    if (!cmd) return;
    if (cmd.confirm && p.armed !== cmd.id) {   // destructive: the first Enter only arms it
      p.armed = cmd.id;
      render();
      return;
    }
    closePalette();
    Promise.resolve(execute(cmd.action)).catch((err) => showToast(`${cmd.label} failed: ${err && err.message ? err.message : err}`, 'error'));
  }

  function move(delta) {
    p.active = P.moveIndex(p.active, p.shown.length, delta);
    p.armed = null;
    render();
  }

  function onInputKey(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Enter': e.preventDefault(); run(p.active); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); closePalette(); break;
      case 'Tab': e.preventDefault(); break;   // the box is one stop; the list is driven from the input
      default:
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('palette') || !P) return;
    $('palette-input').addEventListener('keydown', onInputKey);
    $('palette-input').addEventListener('input', () => refilter());
    $('palette-list').addEventListener('mousemove', (e) => {
      const row = e.target.closest('.palette-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (i !== p.active) { p.active = i; p.armed = null; render(); }
    });
    $('palette-list').addEventListener('click', (e) => {
      const row = e.target.closest('.palette-row');
      if (row) run(Number(row.dataset.i));
    });
    $('palette').addEventListener('mousedown', (e) => { if (e.target === $('palette')) closePalette(); });
    // Capture phase, so it also works while a text field has focus.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        if (p.open) closePalette(); else openPalette();
      }
    }, true);
  });

  window.PortPilotPaletteUi = { open: openPalette, close: closePalette };
})();
