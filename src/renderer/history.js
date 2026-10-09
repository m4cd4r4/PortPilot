// ============ History view ============
// Runs recorded by PortPilot (history/runs.json), newest first: filter, open the
// page, copy the SHA, pin, and "Re-run this version". Pure logic (filtering,
// state words, formatting) is in ../core/runView.js. Loaded after renderer.js,
// which provides state, escapeHtml, showToast and loadApps.
(function () {
  const RV = window.PortPilotRunView;
  const PAGE = 50;
  const POLL_MS = 4000;
  const STAGE_TEXT = {
    checking: 'Checking the repo',
    worktree: 'Creating the worktree',
    install: 'Installing dependencies',
    register: 'Registering the app',
    start: 'Starting',
    done: 'Started',
  };

  const h = {
    runs: [],
    live: new Set(),
    stats: null,
    thumbs: new Map(),      // runId -> data URL
    asked: new Set(),       // `${runId}:${thumb}` already requested
    limit: PAGE,
    progress: new Map(),    // runId -> text while a Re-run is in flight
    errors: new Map(),      // runId -> last Re-run / pin failure
    timer: null,
    lastHtml: '',
    facetKey: '',
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);

  function filters() {
    return {
      query: $('history-search').value,
      app: $('history-app').value,
      branch: $('history-branch').value,
      from: $('history-from').value,
      to: $('history-to').value,
      dirtyOnly: $('history-dirty').checked,
    };
  }
  const isFiltered = (f) => !!(f.query || f.app || f.branch || f.from || f.to || f.dirtyOnly);

  function fillFacets() {
    const f = RV.facets(h.runs);
    const key = JSON.stringify(f);
    if (key === h.facetKey) return;
    h.facetKey = key;
    const fill = (sel, first, items) => {
      const cur = sel.value;
      sel.innerHTML = `<option value="">${first}</option>` + items
        .map((it) => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('');
      sel.value = items.some((it) => it.id === cur) ? cur : '';
    };
    fill($('history-app'), 'App: all', f.apps);
    fill($('history-branch'), 'Branch: all', f.branches.map((b) => ({ id: b, name: b })));
  }

  function thumbHtml(run) {
    const url = h.thumbs.get(run.id);
    return url
      ? `<img src="${url}" alt="Preview of ${esc(run.appName || 'the app')}" loading="lazy" width="96" height="60">`
      : '<span class="hthumb-empty">no preview</span>';
  }

  function actionsHtml(run) {
    const live = h.live.has(run.id);
    const busy = h.progress.has(run.id);
    const hasGit = !!(run.git && run.git.sha && run.repoRoot);
    const btn = (act, label, extra = '', title = '') =>
      `<button type="button" class="btn btn-small btn-secondary" data-hact="${act}" data-run="${esc(run.id)}"${title ? ` title="${esc(title)}"` : ''}${extra}>${label}</button>`;
    return [
      btn('open', 'Open URL', live ? '' : ' disabled', live ? run.url : 'Only while this run is up'),
      btn('rerun', busy ? 'Re-running' : 'Re-run this version', busy || !hasGit ? ' disabled' : '',
        hasGit ? 'Bring this version back in a new worktree' : 'No git state was recorded for this run'),
      btn('sha', 'Copy SHA', hasGit ? '' : ' disabled'),
      btn('pin', run.pinned ? 'Unpin' : 'Pin', '', run.pinned ? 'Exempt from pruning' : 'Keep this run when the history is pruned'),
    ].join('');
  }

  function rowHtml(run) {
    const live = h.live.has(run.id);
    const st = RV.runStateOf(run, live);
    const title = (run.page && run.page.title) || '';
    const prog = h.progress.get(run.id);
    const err = h.errors.get(run.id);
    return `<article class="hrow" data-run="${esc(run.id)}">
  <div class="hthumb${h.thumbs.has(run.id) ? '' : ' empty'}">${thumbHtml(run)}</div>
  <div class="hmain">
    <div class="hline">
      <span class="happ">${esc(run.appName || run.appId)}</span>${run.port ? `<span class="hport">:${esc(run.port)}</span>` : ''}${run.pinned ? '<span class="hpin" title="Pinned" aria-label="Pinned">&#9733;</span>' : ''}
      <span class="hwhen" title="${esc(run.startedAt)}">${esc(RV.formatWhen(run))}</span>
    </div>
    <div class="hline hline-sub">
      ${title ? `<span class="htitle">${esc(title)}</span>` : `<span class="hcmd">${esc(run.command || '')}</span>`}
      <span class="hgit">${esc(RV.gitLine(run))}</span>
    </div>
    <div class="hline hline-sub">
      <span class="state-cell state-${esc(st.state)}" style="--state-color: var(${esc(st.token)})"><span class="state-glyph" aria-hidden="true">${esc(st.glyph)}</span><span class="state-word">${esc(st.word)}</span>${st.reason ? `<span class="state-meta">${esc(st.reason)}</span>` : ''}</span>
      <span class="hby">${esc(RV.startedByWord(run))}</span>${run.rerunOf ? '<span class="hby">re-run</span>' : ''}
    </div>
    ${prog ? `<div class="hprog" role="status">${esc(prog)}</div>` : ''}
    ${err ? `<div class="herr" role="alert">${esc(err)}</div>` : ''}
    <div class="hactions">${actionsHtml(run)}</div>
  </div>
</article>`;
  }

  function render() {
    fillFacets();
    const f = filters();
    const matches = RV.filterRuns(h.runs, f);
    const shown = matches.slice(0, h.limit);
    let html;
    if (!h.runs.length) html = '<div class="empty-state">No runs recorded yet. Start an app and it appears here.</div>';
    else if (!matches.length) html = '<div class="empty-state">No runs match these filters.</div>';
    else html = shown.map(rowHtml).join('');
    if (html !== h.lastHtml) { $('history-list').innerHTML = html; h.lastHtml = html; }

    const foot = RV.footerText(h.stats);
    const count = isFiltered(f) || matches.length > shown.length ? ` · showing ${shown.length} of ${matches.length}` : '';
    $('history-footer').textContent = foot + count;
    $('history-more').classList.toggle('hidden', matches.length <= shown.length);
    wantThumbs(shown);
  }

  async function wantThumbs(runs) {
    const ids = runs
      .filter((r) => r.page && r.page.thumb && !h.thumbs.has(r.id) && !h.asked.has(`${r.id}:${r.page.thumb}`))
      .map((r) => r.id);
    if (!ids.length) return;
    for (const r of runs) if (ids.includes(r.id)) h.asked.add(`${r.id}:${r.page.thumb}`);
    try {
      const res = await window.portpilot.history.thumbs(ids);
      if (!res.success) return;
      for (const [id, url] of Object.entries(res.thumbs)) h.thumbs.set(id, url);
      render();
    } catch { /* thumbnails are decoration */ }
  }

  async function load() {
    try {
      const res = await window.portpilot.history.list();
      if (!res.success) throw new Error(res.error);
      h.runs = res.runs;
      h.live = new Set(res.live);
      h.stats = res.stats;
      render();
    } catch (err) {
      $('history-list').innerHTML = `<div class="empty-state">Could not read the history: ${esc(err.message)}</div>`;
      h.lastHtml = '';
    }
  }

  function setView(view) {
    const history = view === 'history';
    document.querySelector('main.content').dataset.view = history ? 'history' : 'apps';
    for (const tab of document.querySelectorAll('.view-tab')) {
      const on = tab.dataset.view === (history ? 'history' : 'apps');
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    clearInterval(h.timer);
    h.timer = null;
    if (history) {
      h.limit = PAGE;
      load();
      h.timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    }
  }

  async function rerun(runId) {
    const run = h.runs.find((r) => r.id === runId);
    if (!run || h.progress.has(runId)) return;
    h.errors.delete(runId);
    h.progress.set(runId, STAGE_TEXT.checking);
    render();
    try {
      const res = await window.portpilot.history.rerun(runId);
      if (res.success) {
        showToast(`Re-running ${run.appName || 'app'} on :${res.port}`, 'success');
        if (res.warning) showToast(res.warning, 'warning');
        if (typeof loadApps === 'function') loadApps();
      } else {
        h.errors.set(runId, res.error || 'Re-run failed.');
      }
    } catch (err) {
      h.errors.set(runId, err.message);
    }
    h.progress.delete(runId);
    await load();
  }

  async function onAction(btn) {
    const runId = btn.dataset.run;
    const run = h.runs.find((r) => r.id === runId);
    if (!run) return;
    switch (btn.dataset.hact) {
      case 'open':
        if (run.url) window.portpilot.openExternal(run.url);
        break;
      case 'sha':
        navigator.clipboard.writeText(run.git.sha);
        showToast(`Copied ${run.git.sha.slice(0, 7)}`, 'success');
        break;
      case 'pin': {
        const res = await window.portpilot.history.pin(runId, !run.pinned);
        if (!res.success) { h.errors.set(runId, res.error); render(); } else { h.errors.delete(runId); await load(); }
        break;
      }
      case 'rerun':
        rerun(runId);
        break;
      default:
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('history-section')) return;
    for (const tab of document.querySelectorAll('.view-tab')) tab.addEventListener('click', () => setView(tab.dataset.view));
    $('history-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hact]');
      if (btn && !btn.disabled) onAction(btn);
    });
    for (const id of ['history-search', 'history-app', 'history-branch', 'history-from', 'history-to', 'history-dirty']) {
      $(id).addEventListener('input', () => { h.limit = PAGE; render(); });
    }
    $('history-more').addEventListener('click', () => { h.limit += PAGE; render(); });
    window.portpilot.on('history-progress', (p) => {
      if (!p || !h.progress.has(p.runId)) return;
      const base = STAGE_TEXT[p.stage] || p.stage;
      h.progress.set(p.runId, p.stage === 'install' && p.line ? `${base}: ${p.line}` : base);
      render();
    });
  });

  window.PortPilotHistory = { setView, load };
})();
