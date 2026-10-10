// ============ Browsers view ============
// Named browser profiles for automated sessions: start, stop, mode, add, edit, duplicate, remove, and a
// read-only list of the extensions installed in each. Everything goes through window.portpilot.browsers
// (main/browserIpc.js), which uses the same code as the MCP tools, so a start here leaves the same
// advisory claim. Pure logic (state words, ordering, plain-language errors) is in ../core/browserView.js.
// Loaded after history.js, which owns the view tabs and announces 'portpilot:view'.
(function () {
  const BV = window.PortPilotBrowserView;
  const POLL_MS = 4000;

  const b = {
    rows: [],
    browsers: [],
    warnings: [],
    busy: new Map(),     // lowercased name -> text while a start / stop / mode change is in flight
    errors: new Map(),   // lowercased name -> last failure sentence
    timer: null,
    lastHtml: '',
    loadSeq: 0,          // bumps on every load: an older response never repaints over a newer one
    dialog: null,       // { kind, name }
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const key = (name) => String(name).toLowerCase();
  const rowOf = (name) => b.rows.find((r) => key(r.name) === key(name));
  const browserLabel = (id) => (b.browsers.find((x) => x.id === id) || {}).label || id;

  // ---- List ----------------------------------------------------------------------

  function modesHtml(row) {
    const locked = b.busy.has(key(row.name));
    return `<div class="bmodes" role="group" aria-label="Mode for ${esc(row.name)}">${BV.MODES.map((m) =>
      `<button type="button" class="bmode" data-bact="mode" data-name="${esc(row.name)}" data-mode="${esc(m.id)}" aria-pressed="${row.mode === m.id}" title="${esc(m.hint)}"${locked ? ' disabled' : ''}>${esc(m.label)}</button>`).join('')}</div>`;
  }

  function rowHtml(row) {
    const st = BV.stateOf(row);
    const busyText = b.busy.get(key(row.name));
    const err = b.errors.get(key(row.name));
    const up = row.state === 'up';
    const tabs = BV.tabsLine(row.tabs);
    const sub = [row.note, tabs || row.url].filter(Boolean); // a running profile's tabs already say where it is
    const claim = BV.claimLine(row.claim);
    const btn = (act, label, extra = '', title = '') =>
      `<button type="button" class="btn btn-small btn-secondary" data-bact="${act}" data-name="${esc(row.name)}"${title ? ` title="${esc(title)}"` : ''}${extra}>${label}</button>`;
    return `<article class="brow" data-name="${esc(row.name)}">
  <div class="hline">
    <span class="happ">${esc(row.name)}</span><span class="hport">:${esc(row.port)}</span><span class="hby">${esc(browserLabel(row.browser))}</span>
    <span class="state-cell state-${esc(st.state)}" style="--state-color: var(${esc(st.token)})"><span class="state-glyph" aria-hidden="true">${esc(st.glyph)}</span><span class="state-word">${esc(st.word)}</span></span>
  </div>
  <div class="hline hline-sub">${modesHtml(row)}${claim ? `<span class="bclaim">${esc(claim)}</span>` : ''}</div>
  ${sub.length ? `<div class="hline hline-sub bsub">${sub.map((x) => `<span class="bsub-item">${esc(x)}</span>`).join('')}</div>` : ''}
  ${row.warning ? `<div class="bwarn" role="status">${esc(row.warning)}</div>` : ''}
  ${busyText ? `<div class="hprog" role="status">${esc(busyText)}</div>` : ''}
  ${err ? `<div class="herr" role="alert">${esc(err)}</div>` : ''}
  <div class="hactions">
    <button type="button" class="btn btn-small ${up ? 'btn-secondary' : 'btn-primary'}" data-bact="toggle" data-name="${esc(row.name)}"${busyText ? ' disabled' : ''}>${up ? 'Stop' : 'Start'}</button>
    ${btn('edit', 'Edit')}
    ${btn('duplicate', 'Duplicate', up ? ' disabled' : '', up ? 'Stop the profile first' : 'Copy its extensions into a new profile')}
    ${btn('extensions', 'Extensions')}
    ${btn('cdp', 'Copy CDP URL', '', row.cdpUrl)}
    ${btn('remove', 'Remove', up ? ' disabled' : '', up ? 'Stop the profile first' : 'Remove from PortPilot. The folder stays on disk.')}
  </div>
</article>`;
  }

  function render() {
    const rows = BV.sortRows(b.rows);
    const html = rows.length
      ? rows.map(rowHtml).join('')
      : '<div class="empty-state">No browser profiles yet. Add one, and Claude can start it by name.</div>';
    if (html !== b.lastHtml) { $('browsers-list').innerHTML = html; b.lastHtml = html; }
    $('browsers-summary').textContent = rows.length ? BV.summary(rows) : '';
  }

  async function load() {
    const mine = ++b.loadSeq;
    try {
      const res = await window.portpilot.browsers.list();
      if (mine !== b.loadSeq) return; // a newer load started: its answer wins, this one is stale
      if (!res.success) throw new Error(BV.failureText(res));
      b.rows = res.profiles;
      b.browsers = res.browsers || [];
      b.warnings = res.warnings || [];
      render();
    } catch (err) {
      if (mine !== b.loadSeq) return;
      $('browsers-list').innerHTML = `<div class="empty-state">Could not read the browser profiles: ${esc(err.message)}</div>`;
      b.lastHtml = '';
    }
  }

  // ---- Row actions ---------------------------------------------------------------

  async function runAction(name, busyText, fn) {
    const k = key(name);
    if (b.busy.has(k)) return;
    b.errors.delete(k);
    b.busy.set(k, busyText);
    render();
    let res;
    try { res = await fn(); } catch (err) { res = { success: false, error: err.message }; }
    b.busy.delete(k);
    if (!res.success) b.errors.set(k, BV.failureText(res));
    await load();
    return res;
  }

  async function toggle(name) {
    const row = rowOf(name);
    if (!row) return;
    if (row.state === 'up') {
      await runAction(name, 'Stopping', () => window.portpilot.browsers.stop(name));
      return;
    }
    const res = await runAction(name, 'Starting', () => window.portpilot.browsers.start(name));
    if (res && res.success) {
      showToast(`Started ${name} on :${res.port}`, 'success');
      if (res.offscreen && res.offscreen.parked === false) {
        showToast('The window could not be moved off screen on this system, so it may be visible.', 'warning');
      }
    }
  }

  async function setMode(name, mode) {
    const row = rowOf(name);
    if (!row || row.mode === mode) return;
    const res = await runAction(name, 'Changing mode', () => window.portpilot.browsers.setMode(name, mode));
    if (res && res.success && res.note) showToast(res.note, 'warning');
  }

  // ---- Dialog --------------------------------------------------------------------

  const field = (id, label, input) => `<div class="form-group"><label for="${id}">${esc(label)}</label>${input}</div>`;
  const text = (id, value = '', extra = '') => `<input type="text" id="${id}" value="${esc(value)}" autocomplete="off" spellcheck="false"${extra}>`;

  function browserSelect(current) {
    const ids = b.browsers.map((x) => x.id);
    const opts = b.browsers.map((x) => ({ id: x.id, label: x.label }));
    if (current && !ids.includes(current)) opts.push({ id: current, label: `${browserLabel(current)} (not installed)` });
    return `<select id="bf-browser">${opts.map((o) => `<option value="${esc(o.id)}"${o.id === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  }

  function modeSelect(current) {
    return `<select id="bf-mode">${BV.MODES.map((m) => `<option value="${esc(m.id)}"${m.id === current ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <div class="bhint" id="bf-mode-hint">${esc(BV.modeInfo(current).hint)}</div>`;
  }

  const DIALOGS = {
    add: () => ({
      title: 'Add browser profile',
      ok: 'Add',
      html: (b.browsers.length ? '' : '<div class="herr">No supported browser was found on this computer.</div>')
        + field('bf-name', 'Name', text('bf-name', '', ' maxlength="64" placeholder="e.g. shop-tests"'))
        + `<div class="form-row">${field('bf-port', 'Port', `<input type="number" id="bf-port" value="${BV.suggestPort(b.rows)}" min="1024" max="65535">`)}${field('bf-browser', 'Browser', browserSelect(BV.defaultBrowser(b.rows, b.browsers)))}</div>`
        + field('bf-mode', 'Mode', modeSelect('headed'))
        + field('bf-url', 'Start URL (optional)', text('bf-url', '', ' placeholder="https://"'))
        + field('bf-note', 'Note (optional)', text('bf-note', '', ' maxlength="500"')),
      submit: () => window.portpilot.browsers.save(null, formFields(true)),
      done: (res) => {
        showToast(`Added ${res.profile.name} on :${res.profile.port}`, 'success');
        if (res.reusedFolder) showToast(`An earlier "${res.profile.name}" folder was found on disk: its sign-ins carry over.`, 'warning');
      },
    }),
    edit: (row) => ({
      title: `Edit ${row.name}`,
      ok: 'Save',
      html: field('bf-name', 'Name', text('bf-name', row.name, ' disabled'))
        + `<div class="form-row">${field('bf-port', 'Port', `<input type="number" id="bf-port" value="${esc(row.port)}" min="1024" max="65535"${row.state === 'up' ? ' disabled' : ''}>`)}${field('bf-browser', 'Browser', browserSelect(row.browser).replace('<select', row.state === 'up' ? '<select disabled' : '<select'))}</div>`
        + (row.state === 'up' ? '<div class="bhint">Stop the profile to change its port or browser.</div>' : '')
        + field('bf-mode', 'Mode', modeSelect(row.mode))
        + field('bf-url', 'Start URL (optional)', text('bf-url', row.url || '', ' placeholder="https://"'))
        + field('bf-note', 'Note (optional)', text('bf-note', row.note || '', ' maxlength="500"')),
      submit: () => window.portpilot.browsers.save(row.name, formFields(row.state !== 'up')),
      done: () => showToast(`Saved ${row.name}`, 'success'),
    }),
    duplicate: (row) => ({
      title: `Duplicate ${row.name}`,
      ok: 'Duplicate',
      html: '<p class="bhint">Copies the installed extensions into a new folder. Everything else starts fresh: '
        + 'sign-ins, saved passwords, history, site data and browser settings. Sign in once in the new profile.</p>'
        + field('bf-name', 'New name', text('bf-name', '', ' maxlength="64"'))
        + field('bf-port', 'Port', `<input type="number" id="bf-port" value="${BV.suggestPort(b.rows)}" min="1024" max="65535">`)
        + field('bf-note', 'Note (optional)', text('bf-note', row.note || '', ' maxlength="500"')),
      submit: () => window.portpilot.browsers.duplicate(row.name, { name: $('bf-name').value, port: $('bf-port').value, note: $('bf-note').value }),
      done: (res) => showToast(`Created ${res.profile.name} from ${row.name}. Start it once to sign in.`, 'success'),
    }),
    remove: (row) => ({
      title: `Remove ${row.name}`,
      ok: 'Remove',
      danger: true,
      html: `<p class="warning-text">Remove "${esc(row.name)}" from PortPilot?</p>
        <p class="bhint">Its folder stays on disk, with any sign-ins in it. Claude can no longer start it by name.</p>`,
      submit: () => window.portpilot.browsers.remove(row.name),
      done: () => showToast(`Removed ${row.name}`, 'success'),
    }),
    extensions: (row) => ({
      title: `Extensions in ${row.name}`,
      ok: null,
      html: '<div id="bf-ext" class="bext" aria-live="polite">Reading the profile folder...</div>'
        + '<p class="bhint">To add one, start the profile headed and install it from the browser\'s own store. '
        + 'It stays in this profile, and Duplicate carries it over.</p>',
      after: async () => {
        const res = await window.portpilot.browsers.extensions(row.name);
        const el = $('bf-ext');
        if (!el || !b.dialog || b.dialog.name !== row.name) return;
        el.innerHTML = !res.success ? `<div class="herr">${esc(BV.failureText(res))}</div>`
          : res.extensions.length
            ? `<ul class="bext-list">${res.extensions.map((e) => `<li><span class="bext-name">${esc(e.name)}</span><span class="hport">${esc(e.version)}</span></li>`).join('')}</ul>`
            : esc(BV.extensionsText([]));
      },
    }),
  };

  function formFields(withMoves) {
    const f = { mode: $('bf-mode').value, url: $('bf-url').value, note: $('bf-note').value };
    if ($('bf-name') && !$('bf-name').disabled) f.name = $('bf-name').value;
    if (withMoves) { f.port = $('bf-port').value; f.browser = $('bf-browser').value; }
    return f;
  }

  function openDialog(kind, name) {
    const row = name ? rowOf(name) : null;
    if (name && !row) return;
    const spec = DIALOGS[kind](row);
    b.dialog = { kind, name: name || null, spec };
    $('browser-modal-title').textContent = spec.title;
    $('browser-modal-body').innerHTML = spec.html;
    $('browser-modal-error').textContent = '';
    const ok = $('browser-modal-ok');
    ok.classList.toggle('hidden', !spec.ok);
    ok.classList.toggle('btn-danger', !!spec.danger);
    ok.classList.toggle('btn-primary', !spec.danger);
    ok.textContent = spec.ok || '';
    ok.disabled = false;
    $('browser-modal-cancel').textContent = spec.ok ? 'Cancel' : 'Close';
    $('modal-browser').classList.remove('hidden');
    const first = $('browser-modal-body').querySelector('input:not([disabled]), select:not([disabled])');
    if (first) first.focus(); else (spec.ok ? ok : $('browser-modal-cancel')).focus();
    if (spec.after) spec.after();
    const mode = $('bf-mode');
    if (mode) mode.addEventListener('change', () => { $('bf-mode-hint').textContent = BV.modeInfo(mode.value).hint; });
  }

  function closeDialog() {
    b.dialog = null;
    $('modal-browser').classList.add('hidden');
  }

  async function submitDialog() {
    const d = b.dialog;
    if (!d || !d.spec.ok) return;
    const ok = $('browser-modal-ok');
    if (ok.disabled) return;
    ok.disabled = true;
    $('browser-modal-error').textContent = '';
    let res;
    try { res = await d.spec.submit(); } catch (err) { res = { success: false, error: err.message }; }
    if (b.dialog !== d) return; // closed while waiting
    if (res.success) {
      closeDialog();
      d.spec.done(res);
      await load();
    } else {
      ok.disabled = false;
      $('browser-modal-error').textContent = BV.failureText(res);
    }
  }

  // ---- Wiring --------------------------------------------------------------------

  function onAction(btn) {
    const name = btn.dataset.name;
    switch (btn.dataset.bact) {
      case 'toggle': toggle(name); break;
      case 'mode': setMode(name, btn.dataset.mode); break;
      case 'edit': openDialog('edit', name); break;
      case 'duplicate': openDialog('duplicate', name); break;
      case 'extensions': openDialog('extensions', name); break;
      case 'remove': openDialog('remove', name); break;
      case 'cdp': {
        const row = rowOf(name);
        if (row) { navigator.clipboard.writeText(row.cdpUrl); showToast(`Copied ${row.cdpUrl}`, 'success'); }
        break;
      }
      default:
    }
  }

  function onView(view) {
    clearInterval(b.timer);
    b.timer = null;
    if (view !== 'browsers') return;
    load();
    b.timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('browsers-section')) return;
    $('browsers-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bact]');
      if (btn && !btn.disabled) onAction(btn);
    });
    $('browsers-add').addEventListener('click', () => openDialog('add'));
    $('browser-modal-close').addEventListener('click', closeDialog);
    $('browser-modal-cancel').addEventListener('click', closeDialog);
    $('browser-modal-ok').addEventListener('click', submitDialog);
    $('modal-browser').addEventListener('click', (e) => { if (e.target === $('modal-browser')) closeDialog(); });
    $('modal-browser').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDialog();
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitDialog(); }
    });
    document.addEventListener('portpilot:view', (e) => onView(e.detail.view));
  });

  window.PortPilotBrowsers = { load };
})();
