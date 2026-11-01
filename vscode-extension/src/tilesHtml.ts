// The Tiles webview page. No `vscode` import, so it can be rendered outside the editor (screenshots,
// tests) with the editor's colour variables stubbed. The page draws only from what the extension posts it.
export function tilesHtml(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { margin: 0; padding: 4px 8px 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  h2 { display: flex; align-items: baseline; gap: 6px; margin: 10px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  h2 small { font-weight: 400; letter-spacing: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .tile { position: relative; min-width: 0; overflow: hidden; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editor-background); }
  .tile:hover, .tile:focus-within { border-color: var(--vscode-focusBorder); }
  button { font: inherit; color: inherit; }
  .face { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
  .face:disabled { cursor: default; }
  .face:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .shot { position: relative; aspect-ratio: 16 / 10; display: grid; place-items: center; overflow: hidden; background: var(--vscode-editorWidget-background); color: var(--vscode-descriptionForeground); font-size: 22px; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .shot img.small { inset: 0; margin: auto; width: auto; height: auto; max-width: 52%; max-height: 62%; object-fit: contain; border-radius: 6px; }
  .tile.idle .shot img { opacity: 0.5; }
  .meta { display: flex; gap: 6px; align-items: center; min-width: 0; padding: 4px 6px 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .sub { padding: 0 6px 5px 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .lamp { flex: none; width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; }
  .lamp.running { background: var(--vscode-testing-iconPassed); }
  .lamp.blocked { background: var(--vscode-charts-orange); }
  .lamp.crashed { background: var(--vscode-errorForeground); }
  .lamp.starting { background: var(--vscode-charts-yellow); }
  .lamp.stopped { border: 1.5px solid var(--vscode-disabledForeground); }
  .acts { position: absolute; top: 4px; right: 4px; display: flex; gap: 4px; opacity: 0; }
  .tile:hover .acts, .tile:focus-within .acts, .row:hover .acts, .row:focus-within .acts { opacity: 1; }
  .acts button { padding: 1px 7px; font-size: 11px; border: 0; border-radius: 3px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .acts button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .acts button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .row { position: relative; display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 3px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row .acts { position: static; margin-left: auto; }
  .row .port { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .more { margin: 6px 0 0; padding: 2px 0; border: 0; background: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 12px; }
  .more:hover { text-decoration: underline; }
  .more:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  .note { margin: 4px 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
</style></head><body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const images = {};
  let state = null;
  let showStopped = !!(vscode.getState() || {}).showStopped;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== '') e.textContent = text; return e; };
  const send = (m) => vscode.postMessage(m);

  function shot(t, cls) {
    const box = el('div', 'shot' + (cls ? ' ' + cls : ''));
    const src = t.img && images[t.img];
    if (src) {
      const img = el('img'); img.alt = ''; img.src = src;
      img.addEventListener('load', () => { if (img.naturalWidth && img.naturalWidth < 320) img.className = 'small'; });
      box.append(img);
    } else box.append(el('span', '', t.letter));
    return box;
  }
  function button(label, fn, title) {
    const b = el('button', '', label); b.type = 'button'; if (title) b.title = title; b.setAttribute('aria-label', title || label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }
  const portText = (t) => (t.port ? ':' + t.port : 'no port');

  function appTile(t) {
    const tile = el('div', 'tile' + (t.lamp === 'running' ? '' : ' idle'));
    const face = el('button', 'face'); face.type = 'button'; face.disabled = !t.canOpen;
    const state = t.word + (t.port ? ', port ' + t.port : '');
    face.setAttribute('aria-label', t.name + ', ' + state + (t.canOpen ? '. Open in browser' : ''));
    face.title = t.name + ' - ' + state;
    face.dataset.keep = 'a:' + t.id;
    if (t.canOpen) face.addEventListener('click', () => send({ type: 'app', action: 'open', id: t.id }));
    const meta = el('div', 'meta'); meta.append(el('span', 'lamp ' + t.lamp), el('span', 'name', (t.favorite ? '\\u2605 ' : '') + t.name));
    face.append(shot(t), meta, el('div', 'sub', t.lamp === 'running' ? portText(t) : t.word + (t.port ? ' \\u00b7 :' + t.port : '')));
    tile.append(face);
    const acts = el('div', 'acts');
    if (t.canStop) acts.append(button('Stop', () => send({ type: 'app', action: 'stop', id: t.id }), 'Stop ' + t.name));
    if (t.canStart) acts.append(button('Start', () => send({ type: 'app', action: 'start', id: t.id }), 'Start ' + t.name));
    tile.append(acts);
    return tile;
  }

  function stoppedRow(t) {
    const row = el('div', 'row');
    row.append(el('span', 'lamp stopped'), el('span', 'name', t.name), el('span', 'port', portText(t)));
    const acts = el('div', 'acts'); acts.append(button('Start', () => send({ type: 'app', action: 'start', id: t.id }), 'Start ' + t.name));
    row.append(acts);
    return row;
  }

  function browserTile(t) {
    const tile = el('div', 'tile' + (t.lamp === 'running' ? '' : ' idle'));
    const face = el('button', 'face'); face.type = 'button'; face.disabled = !t.canFocus;
    const what = t.word + ', port ' + t.port + (t.leasedTo ? ', in use by ' + t.leasedTo : '');
    face.setAttribute('aria-label', t.name + ', ' + what + (t.canFocus ? '. Bring its page to the front' : ''));
    face.title = t.name + ' - ' + what;
    face.dataset.keep = 'b:' + t.name;
    if (t.canFocus) face.addEventListener('click', () => send({ type: 'browser', action: 'focus', name: t.name }));
    const meta = el('div', 'meta'); meta.append(el('span', 'lamp ' + t.lamp), el('span', 'name', t.name));
    face.append(shot(t), meta, el('div', 'sub', t.leasedTo ? 'In use by ' + t.leasedTo : t.lamp === 'running' ? ':' + t.port : t.word));
    tile.append(face);
    const acts = el('div', 'acts');
    if (t.canStop) acts.append(button('Stop', () => send({ type: 'browser', action: 'stop', name: t.name }), 'Stop ' + t.name));
    if (t.canStart) acts.append(button('Start', () => send({ type: 'browser', action: 'start', name: t.name }), 'Start ' + t.name));
    tile.append(acts);
    return tile;
  }

  function heading(text, count) { const h = el('h2', '', text); h.append(el('small', '', String(count))); return h; }

  function render() {
    if (!state) return;
    const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.keep : '';
    const nodes = [];
    const appCount = state.apps.length + state.stoppedApps.length;
    nodes.push(heading('Apps', appCount));
    if (!appCount) nodes.push(el('p', 'note', 'No apps yet. Add one from the Apps view.'));
    if (state.apps.length) { const g = el('div', 'grid'); g.append(...state.apps.map(appTile)); nodes.push(g); }
    if (state.stoppedApps.length) {
      const n = state.stoppedApps.length;
      const more = el('button', 'more', showStopped ? 'Hide ' + n + ' stopped' : 'Show ' + n + ' stopped');
      more.type = 'button'; more.dataset.keep = 'more'; more.setAttribute('aria-expanded', String(showStopped));
      more.addEventListener('click', () => { showStopped = !showStopped; vscode.setState({ showStopped }); render(); });
      nodes.push(more);
      if (showStopped) { const list = el('div'); list.append(...state.stoppedApps.map(stoppedRow)); nodes.push(list); }
    }
    nodes.push(heading('Browsers', state.browsers.length));
    if (!state.browsers.length) nodes.push(el('p', 'note', 'No browser profiles yet.'));
    else { const g = el('div', 'grid'); g.append(...state.browsers.map(browserTile)); nodes.push(g); }
    root.replaceChildren(...nodes);
    if (keep) { const k = [...root.querySelectorAll('[data-keep]')].find((n) => n.dataset.keep === keep); if (k && !k.disabled) k.focus(); }
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'state') return;
    Object.assign(images, m.images || {});
    state = m.state;
    render();
  });
  send({ type: 'ready' });
</script></body></html>`;
}
