/**
 * The Diagnose panel: a read-only headless Claude run on a crashed app, shown
 * in the app. Opened from the crash toast. States: no Claude CLI, first-use
 * consent, running (tool activity + streamed answer), done, error.
 * Everything from the model goes in with textContent, never innerHTML.
 */
(function () {
  const api = () => window.portpilot && window.portpilot.diagnose;
  let panel = null;       // { root, appId, body, foot, answer, activity, status }
  let offEvent = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(label, cls, onClick) {
    const b = el('button', `diag-btn ${cls || ''}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function close() {
    if (!panel) return;
    if (panel.running) api().cancel(panel.appId).catch(() => {});
    if (offEvent) { offEvent(); offEvent = null; }
    panel.root.remove();
    panel = null;
  }

  function setFoot(...buttons) {
    panel.foot.replaceChildren(...buttons);
  }

  function showMessage(text, tone) {
    panel.body.replaceChildren(el('p', `diag-msg ${tone || ''}`.trim(), text));
  }

  function onEvent(ev) {
    if (!panel || ev.appId !== panel.appId) return;
    if (ev.kind === 'tool') {
      panel.activity.appendChild(el('div', 'diag-tool', ev.label));
      panel.activity.scrollTop = panel.activity.scrollHeight;
    } else if (ev.kind === 'text') {
      panel.answer.textContent += (panel.answer.textContent ? '\n\n' : '') + ev.text;
      panel.status.textContent = 'Writing the answer...';
    } else if (ev.kind === 'error') {
      panel.error = ev.text;
    } else if (ev.kind === 'done') {
      panel.done = true;
    } else if (ev.kind === 'end') {
      panel.running = false;
      if (panel.error) {
        panel.status.textContent = '';
        panel.body.appendChild(el('p', 'diag-msg error', panel.error));
      } else {
        panel.status.textContent = 'Done. Claude only read files; nothing was changed.';
      }
      setFoot(
        button('Copy answer', '', () => navigator.clipboard.writeText(panel.answer.textContent).catch(() => {})),
        button('Close', 'ghost', close),
      );
    }
  }

  async function run() {
    panel.running = true;
    panel.error = null;
    panel.done = false;
    panel.activity = el('div', 'diag-activity');
    panel.answer = el('div', 'diag-answer');
    panel.status = el('div', 'diag-status', 'Reading the crash output and project files...');
    panel.body.replaceChildren(panel.status, panel.activity, panel.answer);
    setFoot(button('Cancel', '', () => { api().cancel(panel.appId).catch(() => {}); }));
    if (!offEvent) offEvent = api().onEvent(onEvent);
    const res = await api().start(panel.appId).catch((e) => ({ success: false, error: e.message }));
    if (!res || !res.success) {
      panel.running = false;
      showMessage((res && res.error) || 'Could not start the diagnosis.', 'error');
      setFoot(button('Close', 'ghost', close));
    }
  }

  async function askConsent() {
    panel.body.replaceChildren(
      el('p', 'diag-msg', 'Diagnose sends this app\'s last crash output and folder path to your own Claude Code, using your own sign-in or API key and your usage.'),
      el('p', 'diag-msg dim', 'Claude can only read files in the app folder (no commands, no edits, your Claude Code settings and hooks are not used). Keys and passwords in the crash output are masked first, but files it reads, such as a .env, are sent as they are. You can cancel at any time.'),
    );
    setFoot(
      button('Allow and diagnose', 'primary', async () => {
        const r = await api().consent().catch(() => ({ success: false }));
        if (r && r.success) run(); else showMessage('Could not save your choice.', 'error');
      }),
      button('Not now', 'ghost', close),
    );
  }

  async function open(appId, name) {
    if (!api()) return;
    if (panel) close();
    const root = el('div', 'diag-overlay');
    const card = el('div', 'diag-card');
    const head = el('div', 'diag-head');
    head.appendChild(el('div', 'diag-title', `Diagnose ${name || 'app'}`));
    head.appendChild(button('Close', 'ghost', close));
    const body = el('div', 'diag-body');
    const foot = el('div', 'diag-foot');
    card.append(head, body, foot);
    root.appendChild(card);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.body.appendChild(root);
    panel = { root, appId, body, foot, running: false };

    const st = await api().status(appId).catch(() => null);
    if (!panel || panel.appId !== appId) return;
    if (!st || !st.success) { showMessage('Could not check Claude Code.', 'error'); setFoot(button('Close', 'ghost', close)); return; }
    if (!st.cli) {
      showMessage('Claude Code is not installed. Install it from https://claude.com/claude-code and sign in once, then try again.', 'error');
      setFoot(button('Close', 'ghost', close));
      return;
    }
    if (st.running) { showMessage('A diagnosis is already running for this app.'); setFoot(button('Close', 'ghost', close)); return; }
    if (!st.consent) { askConsent(); return; }
    run();
  }

  window.openDiagnose = open;
})();
