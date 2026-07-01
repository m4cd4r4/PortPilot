/**
 * PortPilot Renderer - UI Logic (Redesigned)
 * Single-pane unified view with glassmorphism cards
 */

// ============ SVG Icons ============
function icon(name, size = 16) {
  const icons = {
    play: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>`,
    stop: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>`,
    browser: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 4 0 6s2 4 0 6"/></svg>`,
    folder: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h5l2 2h7v8H1V3z"/></svg>`,
    trash: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1m-8 0h10m-9 0v9a1 1 0 001 1h6a1 1 0 001-1V4"/></svg>`,
    edit: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>`,
    star: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2.2 4.6L15 6.3l-3.5 3.4.8 4.9L8 12.3 3.7 14.6l.8-4.9L1 6.3l4.8-.7L8 1z"/></svg>`,
    'star-outline': `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M8 1l2.2 4.6L15 6.3l-3.5 3.4.8 4.9L8 12.3 3.7 14.6l.8-4.9L1 6.3l4.8-.7L8 1z"/></svg>`,
    gear: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1h3l.4 2.1a5.5 5.5 0 011.3.7l2-.8 1.5 2.6-1.6 1.3a5.5 5.5 0 010 1.5l1.6 1.3-1.5 2.6-2-.8a5.5 5.5 0 01-1.3.7L9.5 15h-3l-.4-2.1a5.5 5.5 0 01-1.3-.7l-2 .8-1.5-2.6 1.6-1.3a5.5 5.5 0 010-1.5L1.3 6.3l1.5-2.6 2 .8a5.5 5.5 0 011.3-.7L6.5 1zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/></svg>`,
    search: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>`,
    plus: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>`,
    close: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
    more: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`,
    plug: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 1v4M10 1v4M4 5h8v3a4 4 0 01-8 0V5zM8 12v3"/></svg>`,
    copy: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/></svg>`,
    refresh: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8a6 6 0 0110.3-4.2M14 8a6 6 0 01-10.3 4.2"/><path d="M12 1v4h-4M4 15v-4h4"/></svg>`,
    grip: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" opacity="0.4"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg>`,
    chevron: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>`,
    docker: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3h2v2H9zM6 3h2v2H6zM3 3h2v2H3zM6 0h2v2H6zM9 0h2v2H9zM0 5h2v2H0zM3 0h2v2H3zM12 3h2v2h-2zM0 8c0 3.3 2.7 6 6 6h4c3.3 0 6-2.7 6-6H0z"/></svg>`,
    kill: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
    home: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l6-6 6 6M4 7v6h3v-3h2v3h3V7"/></svg>`,
    globe: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c-2 2-2 4 0 6s2 4 0 6"/></svg>`,
    logs: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M3 8h10M3 12h6"/></svg>`,
    branch: `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="3" r="2"/><circle cx="4" cy="13" r="2"/><circle cx="12" cy="5" r="2"/><path d="M4 5v6M12 7c0 3-4 2-8 4"/></svg>`,
  };
  return icons[name] || '';
}

// ============ State ============
const state = {
  ports: [],
  apps: [],
  groups: [],
  runningApps: [],
  detectedApps: {},
  unknownConflicts: [],
  startingApps: {},
  settings: {},
  globalSearch: '',
  appSort: 'default',
  theme: 'tokyonight',
  dockerRunning: false,
  favoritesExpanded: true,
  otherProjectsExpanded: true,
  deleteAppId: null,
  selectedApps: new Set(),
  selectedProjects: new Set(),
  drawerAppId: null,
  staleApps: new Set(),
  health: {},
  expandedPorts: new Map(),
  portsCollapsed: false,
  portGroupExpanded: { dev: true, other: true, system: false },
  settingsOpen: false
};

// ============ Requirement Detection ============
function detectRequirements(app) {
  const cmd = (app.command || '').toLowerCase();
  const cwd = (app.cwd || '').toLowerCase();

  return {
    docker: cmd.includes('docker') || cmd.includes('compose'),
    node: cmd.includes('npm') || cmd.includes('npx') || cmd.includes('pnpm') || cmd.includes('yarn') || cmd.includes('node') || cmd.includes('bun'),
    python: cmd.includes('python') || cmd.includes('uvicorn') || cmd.includes('flask') || cmd.includes('django') || cmd.includes('gunicorn') || cmd.includes('pip'),
    database: cmd.includes('postgres') || cmd.includes('mysql') || cmd.includes('redis') || cmd.includes('mongo') || cmd.includes('sqlite'),
    autoStart: app.autoStart || false,
    remote: cwd.includes('ssh') || cwd.includes('@') || app.remote || false
  };
}

function detectStartupDelay(app) {
  if (app.startupDelay && app.startupDelay > 0) return app.startupDelay;
  const cmd = (app.command || '').toLowerCase();
  if (cmd.includes('docker') || cmd.includes('compose')) return 20;
  if (cmd.includes('npm') || cmd.includes('pnpm') || cmd.includes('yarn') || cmd.includes('node') || cmd.includes('bun')) return 10;
  if (cmd.includes('python') || cmd.includes('uvicorn') || cmd.includes('flask') || cmd.includes('django')) return 5;
  return 8;
}

async function checkPortReady(port) {
  try {
    const result = await window.portpilot.ports.check(port);
    return result.inUse && result.info;
  } catch {
    return false;
  }
}

function startPortReadinessCheck(appId, port, maxDelay) {
  let elapsed = 0;
  state.startingApps[appId] = {
    countdown: maxDelay,
    port,
    interval: setInterval(async () => {
      elapsed++;
      const remaining = maxDelay - elapsed;
      const ready = await checkPortReady(port);
      if (ready || remaining <= 0) {
        clearInterval(state.startingApps[appId].interval);
        delete state.startingApps[appId];
        await loadApps();
      } else {
        state.startingApps[appId].countdown = remaining;
        renderApps();
      }
    }, 1000)
  };
}

// ============ Auto-Scan ============
// Periodically refresh ports + running-app status so the list stays live while
// juggling several localhost apps. Driven by the (previously inert) autoScan /
// scanInterval settings. Skips work while the window is hidden (tray) to save CPU.
let _autoScanTimer = null;
function setupAutoScan() {
  if (_autoScanTimer) {
    clearInterval(_autoScanTimer);
    _autoScanTimer = null;
  }
  if (state.settings.autoScan === false) return;

  const seconds = Math.max(1, Math.round((state.settings.scanInterval || 5000) / 1000));
  _autoScanTimer = setInterval(() => {
    if (document.hidden) return;            // window minimised / in tray
    if (state.settingsOpen) return;          // don't churn while editing settings
    if (Object.keys(state.startingApps).length > 0) return; // a startup countdown owns refresh
    loadApps();                              // silent refresh (no toast)
  }, seconds * 1000);
}

async function checkDockerStatus() {
  try {
    const result = await window.portpilot.docker.status();
    state.dockerRunning = result.running;
    return result.running;
  } catch {
    state.dockerRunning = false;
    return false;
  }
}

async function startDocker() {
  showToast('Starting Docker Desktop...', 'success');
  try {
    const result = await window.portpilot.docker.start();
    if (result.success) {
      showToast('Docker Desktop starting - please wait...', 'success');
      pollDockerReady();
    } else {
      showToast('Failed to start Docker: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to start Docker: ' + error.message, 'error');
  }
}

function pollDockerReady(attempts = 0) {
  if (attempts > 30) {
    showToast('Docker taking too long to start', 'error');
    return;
  }
  setTimeout(async () => {
    const running = await checkDockerStatus();
    if (running) {
      showToast('Docker Desktop is ready!', 'success');
      renderApps();
    } else {
      pollDockerReady(attempts + 1);
    }
  }, 2000);
}

// ============ DOM References ============
const dom = {
  portsList: document.getElementById('ports-list'),
  appsList: document.getElementById('apps-list'),
  portCount: document.getElementById('port-count'),
  portsSummary: document.getElementById('ports-summary'),
  modal: document.getElementById('modal-app'),
  appForm: document.getElementById('app-form'),
  toastContainer: document.getElementById('toast-container')
};

// ============ Initialization ============
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupIcons();
  loadTheme();
  await loadSettings();
  initWebAgentUI();
  checkDockerStatus();
  await loadApps();

  if (state.settings.autoScan) {
    await scanPorts();
  }

  setupAutoScan();

  window.portpilot.on('trigger-scan', scanPorts);
  window.portpilot.on('toast', (payload) => {
    if (payload && payload.message) showToast(payload.message, payload.type || 'info');
    loadApps();   // reflect tray-initiated changes (e.g. "Stop All Apps")
  });
  window.portpilot.on('config-changed', async (data) => {
    console.log('[Renderer] Config changed externally, refreshing apps list...');
    await loadApps();
    showToast('Apps list updated (external change detected)', 'info');
  });
});

// ============ Setup Icons in DOM ============
function setupIcons() {
  // Header buttons
  const scanBtn = document.getElementById('btn-scan');
  scanBtn.querySelector('.btn-icon-svg').innerHTML = icon('refresh', 14);

  const addBtn = document.getElementById('btn-add-app');
  addBtn.querySelector('.btn-icon-svg').innerHTML = icon('plus', 14);

  const settingsBtn = document.getElementById('btn-settings');
  settingsBtn.querySelector('.btn-icon-svg').innerHTML = icon('gear', 14);

  // Search icon
  document.querySelector('.search-icon').innerHTML = icon('search', 14);

  // Close buttons
  document.querySelectorAll('.btn-close').forEach(btn => {
    btn.innerHTML = icon('close', 14);
  });

  // Section chevron
  document.querySelectorAll('.section-chevron').forEach(el => {
    el.innerHTML = icon('chevron', 12);
  });
}

// ============ Event Delegation ============
// All UI actions use data-act / data-change attributes routed through delegated
// listeners (instead of inline on* handlers). This lets the CSP forbid inline
// scripts (script-src 'self'), removing the main XSS->code-exec vector.
function setupDelegation() {
  const CLICK = {
    copyCmdPath: el => copyCmdPath(el.dataset.cmd),
    openPortInBrowser: el => openPortInBrowser(+el.dataset.port),
    openProcessFolder: el => openProcessFolder(el.dataset.path),
    copyPort: el => copyPort(+el.dataset.port),
    killPort: el => killPort(+el.dataset.port),
    adoptPort: el => adoptPort(+el.dataset.port),
    toggleSection: el => toggleSection(el.dataset.section),
    togglePortGroup: el => togglePortGroup(el.dataset.portgroup),
    toggleGroup: el => toggleGroup(el.dataset.group),
    openRenameGroupModal: el => openRenameGroupModal(el.dataset.group),
    confirmDeleteGroup: el => confirmDeleteGroup(el.dataset.group),
    startDocker: () => startDocker(),
    killConflictingProcess: el => killConflictingProcess(el.dataset.id),
    startOnFreePort: el => startOnFreePort(el.dataset.id),
    startApp: el => startApp(el.dataset.id),
    openInBrowser: el => openInBrowser(el.dataset.id),
    viewLogs: el => viewLogs(el.dataset.id),
    stopApp: el => stopApp(el.dataset.id),
    toggleFavorite: el => toggleFavorite(el.dataset.id),
    openAppFolder: el => openAppFolder(el.dataset.id),
    addBranch: el => addBranch(el.dataset.id),
    editApp: el => editApp(el.dataset.id),
    deleteApp: el => deleteApp(el.dataset.id),
    removeScanPath: el => removeScanPath(el.dataset.path),
    addDiscoveredProject: el => addDiscoveredProject(+el.dataset.index),
    selectGroupColor: el => selectGroupColor(el.dataset.color),
    selectAllApps: () => selectAllApps(),
    favoriteSelected: () => favoriteSelected(),
    unfavoriteSelected: () => unfavoriteSelected(),
    deleteSelected: () => deleteSelected(),
    clearSelection: () => clearSelection(),
    closeGroupModal: () => closeGroupModal(),
    saveGroupModal: () => saveGroupModal(),
    closeAppDrawer: () => closeAppDrawer(),
    detectWorktrees: el => detectWorktrees(el.dataset.id),
    confirmAddWorktrees: () => confirmAddWorktrees(),
    closeWorktreesModal: () => closeWorktreesModal()
  };
  const CHANGE = {
    toggleAppSelection: el => toggleAppSelection(el.dataset.id),
    toggleProjectSelection: el => toggleProjectSelection(+el.dataset.index),
    moveSelectedToGroup: el => { moveSelectedToGroup(el.value); el.selectedIndex = 0; }
  };

  document.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && CLICK[actEl.dataset.act]) {
      CLICK[actEl.dataset.act](actEl, e);
      return;
    }
    // Card expand: click anywhere on a card except an interactive control.
    const card = e.target.closest('.app-card');
    if (card && !e.target.closest('button, input, a, [data-act], .btn-star, .req-badge, .drag-handle')) {
      openAppDrawer(card.dataset.id);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el, e);
  });

  // Keyboard activation for cards (separate from the global shortcut handler).
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest('.app-card');
    if (card && e.target === card) handleCardKeydown(e, card.dataset.id);
  });

  // Drag-and-drop reordering, delegated on the apps list.
  const list = dom.appsList;
  list.addEventListener('dragstart', handleDragStart);
  list.addEventListener('dragover', handleDragOver);
  list.addEventListener('dragenter', handleDragEnter);
  list.addEventListener('dragleave', handleDragLeave);
  list.addEventListener('drop', handleDrop);
  list.addEventListener('dragend', handleDragEnd);
}

// ============ Event Listeners ============
function setupEventListeners() {
  setupDelegation();
  // Header
  document.getElementById('btn-scan').addEventListener('click', scanPorts);
  document.getElementById('btn-add-app').addEventListener('click', () => openAppModal());

  // Settings panel
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);

  // Global search
  let searchDebounce = null;
  document.getElementById('global-search').addEventListener('input', (e) => {
    state.globalSearch = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      renderApps();
      renderPorts();
    }, 150);
  });

  // App sort
  document.getElementById('app-sort').addEventListener('change', (e) => {
    state.appSort = e.target.value;
    renderApps();
  });

  // Toolbar buttons
  document.getElementById('btn-new-group').addEventListener('click', openNewGroupModal);

  // Ports section toggle
  document.getElementById('ports-section-toggle').addEventListener('click', () => {
    state.portsCollapsed = !state.portsCollapsed;
    const section = document.getElementById('ports-section');
    section.classList.toggle('collapsed', state.portsCollapsed);
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-find-port').addEventListener('click', findFreePort);
  document.getElementById('btn-auto-detect').addEventListener('click', browseAndAutoDetect);
  dom.appForm.addEventListener('submit', handleAppSubmit);

  // Close modal on backdrop click
  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) closeModal();
  });

  // Settings
  document.getElementById('setting-autoscan').addEventListener('change', saveSettings);
  document.getElementById('setting-interval').addEventListener('change', saveSettings);
  document.getElementById('setting-devtools').addEventListener('change', saveSettings);
  document.getElementById('setting-close-to-tray').addEventListener('change', saveSettings);
  document.getElementById('setting-stop-apps-on-quit').addEventListener('change', saveSettings);
  document.getElementById('setting-auto-resize').addEventListener('change', saveSettings);
  document.getElementById('btn-export').addEventListener('click', exportConfig);
  document.getElementById('btn-import').addEventListener('click', importConfig);

  // Discovery
  document.getElementById('btn-add-scan-path').addEventListener('click', addScanPath);
  document.getElementById('btn-discover-projects').addEventListener('click', discoverProjects);
  document.getElementById('discoveries-close').addEventListener('click', () => {
    document.getElementById('modal-discoveries').classList.add('hidden');
  });
  document.getElementById('btn-discoveries-cancel').addEventListener('click', () => {
    document.getElementById('modal-discoveries').classList.add('hidden');
  });
  document.getElementById('btn-select-all-projects').addEventListener('click', selectAllProjects);
  document.getElementById('btn-add-selected-projects').addEventListener('click', addSelectedProjects);
  document.getElementById('btn-add-all-discoveries').addEventListener('click', addAllDiscoveries);

  // Delete Confirmation Modal
  document.getElementById('delete-confirm-close').addEventListener('click', closeDeleteConfirm);
  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteConfirm);
  document.getElementById('btn-delete-confirm').addEventListener('click', confirmDeleteApp);
  document.getElementById('btn-delete-all-instead').addEventListener('click', deleteAllInstead);

  // Web agent toggle (Option C) - only in the desktop build (preload exposes agent)
  if (window.portpilot.agent) {
    document.getElementById('setting-web-agent').addEventListener('change', toggleWebAgent);
    document.getElementById('btn-open-web').addEventListener('click', () => window.portpilot.agent.open());
    document.getElementById('btn-copy-web').addEventListener('click', () => {
      const url = document.getElementById('web-agent-url').textContent;
      if (url) { navigator.clipboard.writeText(url); showToast('URL copied', 'success'); }
    });
  } else {
    document.getElementById('web-agent-section')?.classList.add('hidden');
  }

  // Logs modal
  document.getElementById('logs-close').addEventListener('click', closeLogs);
  document.getElementById('logs-refresh').addEventListener('click', refreshLogs);
  document.getElementById('logs-copy').addEventListener('click', copyLogs);
  document.getElementById('modal-logs').addEventListener('click', (e) => {
    if (e.target.id === 'modal-logs') closeLogs();
  });

  // Theme selector
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        closeModal();
        closeGroupModal();
        closeDeleteConfirm();
        closeWorktreesModal();
        closeSettings();
        closeLogs();
        document.getElementById('modal-discoveries').classList.add('hidden');
      }
      if (e.key === 'Enter' && e.target.id === 'group-name-input') {
        e.preventDefault();
        saveGroupModal();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          scanPorts();
          loadApps();
          break;
        case 'n':
          e.preventDefault();
          openAppModal();
          break;
        case 'f':
          e.preventDefault();
          document.getElementById('global-search')?.focus();
          break;
        case 'g':
          e.preventDefault();
          openNewGroupModal();
          break;
      }
    } else if (e.key === 'Escape') {
      closeModal();
      closeGroupModal();
      closeDeleteConfirm();
      closeSettings();
      closeAppDrawer();
      closeWorktreesModal();
      document.getElementById('modal-discoveries').classList.add('hidden');
    }
  });
}

// ============ Settings Panel ============
function openSettings() {
  state.settingsOpen = true;
  document.getElementById('settings-panel').classList.remove('hidden');
  document.getElementById('settings-backdrop').classList.remove('hidden');
}

function closeSettings() {
  state.settingsOpen = false;
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('settings-backdrop').classList.add('hidden');
}

// ============ Port Operations ============
async function scanPorts() {
  const btn = document.getElementById('btn-scan');
  btn.disabled = true;

  try {
    const result = await window.portpilot.ports.scan();
    if (result.success) {
      state.ports = result.ports.sort((a, b) => a.port - b.port);
      renderPorts();
      showToast(`Found ${state.ports.length} active ports`, 'success');
      fetchAllPortDetails();
    } else {
      showToast('Failed to scan ports: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Scan error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderPorts() {
  const S = window.PortPilotStatus;

  // Ports matched to a registered app are shown in the Apps section, not here.
  // (Phase 2 of the redesign unifies the two surfaces.) Everything else is
  // classified into dev / other / system and shown in collapsible groups, so
  // the user's real dev servers are no longer buried in OS noise.
  const matchedPorts = new Set();
  for (const detected of Object.values(state.detectedApps)) {
    if (detected && detected.port) matchedPorts.add(detected.port);
  }
  let ports = state.ports.filter(p => !matchedPorts.has(p.port));

  if (state.globalSearch) {
    const q = state.globalSearch.toLowerCase();
    ports = ports.filter(p =>
      `${p.port} ${p.processName || ''} ${p.commandLine || ''}`.toLowerCase().includes(q));
  }

  const buckets = { dev: [], other: [], system: [] };
  for (const p of ports) buckets[S.classify(p)].push(p);

  const total = ports.length;
  dom.portCount.textContent = `${total}`;
  if (dom.portsSummary) {
    dom.portsSummary.textContent = total === 0
      ? ''
      : `${buckets.dev.length} dev · ${buckets.other.length} other · ${buckets.system.length} system`;
  }

  if (total === 0) {
    dom.portsList.innerHTML = `<div class="empty-state">${
      state.ports.length === 0
        ? 'Click scan to discover active ports'
        : (state.globalSearch
            ? `No ports match "${escapeHtml(state.globalSearch)}"`
            : 'All ports are matched to apps.')
    }</div>`;
    return;
  }

  dom.portsList.innerHTML = S.GROUP_ORDER
    .filter(key => buckets[key].length > 0)
    .map(key => renderPortGroup(key, S.GROUPS[key], buckets[key]))
    .join('');
}

function renderPortGroup(key, meta, rows) {
  const expanded = state.portGroupExpanded[key] !== false;
  const chev = expanded
    ? icon('chevron', 10)
    : '<span style="display:inline-block;transform:rotate(-90deg)">' + icon('chevron', 10) + '</span>';
  return `
    <div class="port-group" data-portgroup="${key}">
      <div class="section-header port-group-header" data-act="togglePortGroup" data-portgroup="${key}">
        <span class="section-toggle">${chev}</span>
        <span class="section-title">${escapeHtml(meta.label)}</span>
        <span class="section-count">${rows.length}</span>
      </div>
      <div class="port-group-rows ${expanded ? '' : 'collapsed'}">
        ${rows.map(p => renderPortRow(p, key)).join('')}
      </div>
    </div>`;
}

function renderPortRow(p, group) {
  const S = window.PortPilotStatus;
  // Active listening ports are, by definition, running. Other states
  // (conflict / error / starting) arrive once apps are merged in.
  const status = S.statusOf({ running: true });
  const proc = p.processName || 'Unknown';
  const cmdLine = p.commandLine || '';
  const exePath = extractExePath(cmdLine);
  const addr = p.address || '';
  const exposed = addr && !(addr.includes('127.0.0.1') || addr.includes('[::1]') || addr.includes('localhost'));
  // Adopt promotes an unregistered running port into a managed app. System
  // ports (svchost et al) are never adoption candidates.
  const canAdopt = group !== 'system';

  return `
    <div class="port-row" data-port="${p.port}">
      <span class="status-dot status-dot--${status.shape}" style="--dot-color: var(${status.token})" title="${status.label}"></span>
      <span class="port-cell">
        <a class="port-link" data-act="openPortInBrowser" data-port="${p.port}" title="Open localhost:${p.port}">:${p.port}</a>
        ${exposed ? `<span class="port-exposed" title="Listening on all interfaces - network accessible">${icon('globe', 10)}</span>` : ''}
      </span>
      <span class="port-proc" title="${escapeHtml(proc)}">${escapeHtml(proc)}</span>
      <span class="port-cmd" title="${escapeHtml(cmdLine)}">${escapeHtml(cmdLine)}</span>
      <span class="port-pid" title="PID ${p.pid || ''}">${p.pid || ''}</span>
      <span class="port-row-actions">
        ${canAdopt ? `<button class="btn btn-small btn-secondary" data-act="adoptPort" data-port="${p.port}" title="Adopt as app">${icon('plus', 12)}</button>` : ''}
        <button class="btn btn-small btn-secondary" data-act="openPortInBrowser" data-port="${p.port}" title="Open in browser">${icon('browser', 12)}</button>
        ${exePath ? `<button class="btn btn-small btn-secondary" data-act="openProcessFolder" data-path="${escapeHtml(exePath)}" title="Open folder">${icon('folder', 12)}</button>` : ''}
        <button class="btn btn-small btn-secondary" data-act="copyPort" data-port="${p.port}" title="Copy localhost:${p.port}">${icon('copy', 12)}</button>
        <button class="btn btn-small btn-danger" data-act="killPort" data-port="${p.port}" title="Kill process">${icon('kill', 12)}</button>
      </span>
    </div>`;
}

// Adopt an unregistered running port as a managed app: open the Add App modal
// pre-filled with the port and its running command, so the user can refine the
// start command / working directory and save. Once registered, the port will
// match the app and move up into the Apps section on the next scan.
function adoptPort(portNum) {
  const p = state.ports.find(x => x.port === portNum);
  if (!p) return;
  openAppModal();
  document.getElementById('app-name').value = guessAdoptName(p);
  document.getElementById('app-command').value = p.commandLine || '';
  document.getElementById('app-port').value = p.port;
  showToast('Review the command and set a working directory before saving', 'info');
}

function guessAdoptName(p) {
  const base = String(p.processName || 'app').replace(/\.(exe|app|bin)$/i, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'New app';
}

async function killPort(port) {
  if (!confirm(`Kill process on port ${port}?`)) return;
  const result = await window.portpilot.ports.kill(port);
  if (result.success) {
    showToast(`Killed process on port ${port}`, 'success');
    await scanPorts();
  } else {
    showToast('Failed to kill: ' + result.error, 'error');
  }
}

function copyPort(port) {
  navigator.clipboard.writeText(`localhost:${port}`);
  showToast(`Copied localhost:${port}`, 'success');
}

function copyCmdPath(cmdPath) {
  navigator.clipboard.writeText(cmdPath);
  showToast('Command path copied', 'success');
}

async function fetchAllPortDetails() {
  const promises = state.ports.map(async (p) => {
    if (p.pid && !state.expandedPorts.has(p.port)) {
      try {
        const result = await window.portpilot.ports.getDetails(p.pid, p.port);
        if (result.success) {
          state.expandedPorts.set(p.port, result.details);
        } else {
          state.expandedPorts.set(p.port, { memory: null, uptime: null, connections: null });
        }
      } catch (err) {
        state.expandedPorts.set(p.port, { memory: null, uptime: null, connections: null });
      }
    }
  });
  await Promise.all(promises);
  renderPorts();
}

async function openPortInBrowser(port) {
  const url = `http://localhost:${port}`;
  try {
    await window.portpilot.openExternal(url);
    showToast(`Opened localhost:${port}`, 'success');
  } catch (err) {
    showToast('Failed to open browser', 'error');
  }
}

async function openProcessFolder(exePath) {
  if (!exePath) return;
  try {
    const dir = exePath.substring(0, exePath.lastIndexOf('\\')) || exePath.substring(0, exePath.lastIndexOf('/'));
    if (dir) {
      await window.portpilot.openExternal(`file:///${dir.replace(/\\/g, '/')}`);
      showToast('Opened folder', 'success');
    }
  } catch (err) {
    showToast('Failed to open folder', 'error');
  }
}

async function openAppFolder(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app || !app.cwd) return;
  try {
    await window.portpilot.openExternal(`file:///${app.cwd.replace(/\\/g, '/')}`);
    showToast('Opened folder', 'success');
  } catch (err) {
    showToast('Failed to open folder', 'error');
  }
}

function extractExePath(cmdLine) {
  if (!cmdLine) return null;
  if (cmdLine.startsWith('"')) {
    const endQuote = cmdLine.indexOf('"', 1);
    if (endQuote > 1) return cmdLine.substring(1, endQuote);
  }
  const firstSpace = cmdLine.indexOf(' ');
  if (firstSpace > 0) return cmdLine.substring(0, firstSpace);
  return cmdLine;
}

async function openInBrowser(appId) {
  const detected = state.detectedApps[appId];
  const app = state.apps.find(a => a.id === appId);
  const port = detected?.port || app?.preferredPort;

  if (port) {
    const address = detected?.address || '';
    const isIPv6 = address.startsWith('[');
    const host = isIPv6 ? '[::1]' : '127.0.0.1';
    const url = `http://${host}:${port}`;
    try {
      await window.portpilot.openExternal(url);
      showToast(`Opening ${url}`, 'success');
    } catch (error) {
      showToast(`Failed: ${error.message}`, 'error');
    }
  } else {
    showToast('No port detected for this app', 'error');
  }
}

// ============ App Operations ============
async function loadApps() {
  try {
    const [configResult, groupsResult, runningResult, scanResult, staleResult] = await Promise.all([
      window.portpilot.config.getApps(),
      window.portpilot.config.getGroups(),
      window.portpilot.process.list(),
      window.portpilot.ports.scanWithApps(),
      window.portpilot.worktrees.stale()
    ]);

    if (configResult.success) state.apps = configResult.apps;
    if (staleResult && staleResult.success) state.staleApps = new Set(staleResult.ids);
    if (groupsResult.success) state.groups = groupsResult.groups;
    if (runningResult.success) state.runningApps = runningResult.apps;
    if (scanResult.success) {
      state.ports = scanResult.ports;
      state.detectedApps = scanResult.matches || {};
      state.unknownConflicts = scanResult.unknownConflicts || [];
      if (state.unknownConflicts.length > 0) {
        showUnknownConflictWarnings(state.unknownConflicts);
      }
    }

    renderApps();
    renderPorts();
    updateAppsCount();
    refreshHealth();

    if (state.settings.autoResizeWindow) {
      try {
        await window.portpilot.window.autoResize(state.apps.length);
      } catch (resizeError) {
        console.log('Window auto-resize skipped:', resizeError.message);
      }
    }
  } catch (error) {
    showToast('Failed to load apps: ' + error.message, 'error');
  }
}

// Probe running apps for liveness (only when the window is visible, to stay cheap)
// and re-render if any health state changed. Never blocks loadApps.
async function refreshHealth() {
  if (document.hidden) return;
  const running = state.apps.filter(app => {
    const managed = state.runningApps.find(r => r.id === app.id && r.running);
    return managed || state.detectedApps[app.id];
  });
  const live = new Set(running.map(a => a.id));
  // Drop health for apps no longer running
  let changed = false;
  for (const id of Object.keys(state.health)) {
    if (!live.has(id)) { delete state.health[id]; changed = true; }
  }
  await Promise.all(running.map(async (app) => {
    const detected = state.detectedApps[app.id];
    const port = (detected && detected.port) || app.preferredPort;
    if (!port) return;
    try {
      const res = await window.portpilot.health.check(app.id, port);
      if (res && res.success && res.state && res.state !== 'unknown') {
        if (state.health[app.id] !== res.state) { state.health[app.id] = res.state; changed = true; }
      }
    } catch { /* probe failures are non-fatal */ }
  }));
  if (changed) renderApps();
}

function updateAppsCount() {
  const countBadge = document.getElementById('apps-count');
  const runningCount = state.apps.filter(app => {
    const managedRunning = state.runningApps.find(r => r.id === app.id && r.running);
    const detected = state.detectedApps[app.id];
    return managedRunning || detected;
  }).length;

  if (countBadge) {
    countBadge.textContent = `${state.apps.length} apps - ${runningCount} running`;
  }

  _updateTrayMenu();
}

function _updateTrayMenu() {
  if (!window.portpilot?.tray) return;
  const running = state.apps
    .filter(app => state.runningApps.find(r => r.id === app.id && r.running) || state.detectedApps[app.id])
    .map(app => ({ id: app.id, name: app.name }));
  window.portpilot.tray.update(running).catch(() => {});
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _filterApps(apps) {
  if (!state.globalSearch) return apps;
  const q = state.globalSearch.toLowerCase();
  return apps.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.command.toLowerCase().includes(q) ||
    (a.cwd || '').toLowerCase().includes(q) ||
    (a.preferredPort && String(a.preferredPort).includes(q))
  );
}

function _sortApps(apps) {
  const sorted = [...apps];
  switch (state.appSort) {
    case 'name-asc':  return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc': return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'status': return sorted.sort((a, b) => {
      const aOn = !!(state.runningApps.find(r => r.id === a.id && r.running) || state.detectedApps[a.id]);
      const bOn = !!(state.runningApps.find(r => r.id === b.id && r.running) || state.detectedApps[b.id]);
      return bOn - aOn;
    });
    case 'port': return sorted.sort((a, b) => (a.preferredPort || 99999) - (b.preferredPort || 99999));
    default: return sorted;
  }
}

function renderApps() {
  if (state.apps.length === 0 && state.groups.length === 0) {
    dom.appsList.innerHTML = `<div class="empty-state">
      No apps registered. Click "Add App" to register your first app.
    </div>`;
    return;
  }

  // Branch awareness: apps with a parentId that points at a real app are
  // rendered nested under that parent, not as top-level rows. Build the
  // parent->children map and the top-level list once.
  const appIds = new Set(state.apps.map(a => a.id));
  const isChild = (a) => a.parentId && appIds.has(a.parentId);
  const childrenByParent = {};
  for (const a of state.apps) {
    if (isChild(a)) (childrenByParent[a.parentId] = childrenByParent[a.parentId] || []).push(a);
  }
  const topLevel = state.apps.filter(a => !isChild(a));

  const favorites = _sortApps(_filterApps(topLevel.filter(app => app.isFavorite)));
  const groupedApps = {};
  const ungroupedApps = [];
  const validGroupIds = new Set(state.groups.map(g => g.id));

  for (const app of _sortApps(_filterApps(topLevel.filter(a => !a.isFavorite)))) {
    if (app.group && validGroupIds.has(app.group)) {
      if (!groupedApps[app.group]) groupedApps[app.group] = [];
      groupedApps[app.group].push(app);
    } else {
      ungroupedApps.push(app);
    }
  }

  const totalVisible = favorites.length + ungroupedApps.length + Object.values(groupedApps).reduce((s, a) => s + a.length, 0);
  if (state.globalSearch && totalVisible === 0) {
    dom.appsList.innerHTML = `<div class="empty-state">No apps match "${escapeHtml(state.globalSearch)}"</div>`;
    return;
  }

  let html = '';

  // Favorites
  if (favorites.length > 0) {
    html += `
      <div class="app-section">
        <div class="section-header" data-act="toggleSection" data-section="favorites">
          <span class="section-toggle">${state.favoritesExpanded ? icon('chevron', 10) : '<span style="display:inline-block;transform:rotate(-90deg)">' + icon('chevron', 10) + '</span>'}</span>
          <span class="section-title">${icon('star', 12)} Favorites</span>
          <span class="section-count">${favorites.length}</span>
        </div>
        <div class="section-apps ${state.favoritesExpanded ? '' : 'collapsed'}">
          ${favorites.map(app => renderAppTree(app, childrenByParent)).join('')}
        </div>
      </div>
    `;
  }

  // Custom groups
  for (const group of state.groups) {
    const apps = groupedApps[group.id] || [];
    const isExpanded = group.expanded !== false;
    const groupColor = group.color || 'var(--border-color)';
    html += `
      <div class="app-section" data-group-id="${group.id}" style="border-left: 3px solid ${groupColor}">
        <div class="section-header group-header">
          <span class="section-toggle" data-act="toggleGroup" data-group="${group.id}">${isExpanded ? icon('chevron', 10) : '<span style="display:inline-block;transform:rotate(-90deg)">' + icon('chevron', 10) + '</span>'}</span>
          <span class="group-color-dot" style="background:${groupColor}"></span>
          <span class="section-title" data-act="toggleGroup" data-group="${group.id}">${escapeHtml(group.name)}</span>
          <span class="section-count">${apps.length}</span>
          <div class="section-actions">
            <button class="btn-group-action" data-act="openRenameGroupModal" data-group="${group.id}" title="Rename">${icon('edit', 12)}</button>
            <button class="btn-group-action btn-group-delete" data-act="confirmDeleteGroup" data-group="${group.id}" title="Delete">${icon('kill', 12)}</button>
          </div>
        </div>
        <div class="section-apps ${isExpanded ? '' : 'collapsed'}">
          ${apps.length > 0
            ? apps.map(app => renderAppTree(app, childrenByParent)).join('')
            : '<div class="group-empty">No apps in this group</div>'}
        </div>
      </div>
    `;
  }

  // Ungrouped
  if (ungroupedApps.length > 0 || state.groups.length === 0) {
    html += `
      <div class="app-section">
        <div class="section-header" data-act="toggleSection" data-section="others">
          <span class="section-toggle">${state.otherProjectsExpanded ? icon('chevron', 10) : '<span style="display:inline-block;transform:rotate(-90deg)">' + icon('chevron', 10) + '</span>'}</span>
          <span class="section-title">${icon('folder', 12)} Other Projects</span>
          <span class="section-count">${ungroupedApps.length}</span>
        </div>
        <div class="section-apps ${state.otherProjectsExpanded ? '' : 'collapsed'}">
          ${ungroupedApps.map(app => renderAppTree(app, childrenByParent)).join('')}
        </div>
      </div>
    `;
  }

  dom.appsList.innerHTML = html;
  updateGroupSelects();
}

// Render a top-level app plus any branch/worktree children nested beneath it.
function renderAppTree(app, childrenByParent) {
  const kids = _sortApps(_filterApps(childrenByParent[app.id] || []));
  if (!kids.length) return renderAppCard(app, 0);
  return `<div class="app-tree">
    ${renderAppCard(app, kids.length)}
    <div class="app-branches">${kids.map(k => renderAppCard(k)).join('')}</div>
  </div>`;
}

function renderAppCard(app, branchCount = 0) {
  const isBranch = !!app.parentId;
  const managedRunning = state.runningApps.find(r => r.id === app.id && r.running);
  const detected = state.detectedApps[app.id];
  const isRunning = managedRunning || detected;
  const reqs = detectRequirements(app);
  const starting = state.startingApps[app.id];
  const conflict = state.unknownConflicts.find(c => c.appId === app.id);

  // Status
  const health = state.health[app.id];
  let statusClass = 'stopped';
  let statusTitle = '';
  if (starting) statusClass = 'starting';
  else if (detected || managedRunning) {
    if (health === 'unhealthy') { statusClass = 'error'; statusTitle = 'Running but not responding (health check failed)'; }
    else { statusClass = 'running'; statusTitle = health === 'healthy' ? 'Running and responding' : 'Running'; }
  }
  else if (conflict) statusClass = 'conflict';

  // Port display
  let portHtml = '';
  let ipVersion = '';
  if (detected) {
    const isIPv6 = detected.address?.startsWith('[');
    ipVersion = isIPv6 ? 'v6' : 'v4';
    portHtml = `<span class="app-port-badge">:${detected.port}</span><span class="app-ip-version">${ipVersion}</span>`;
  } else if (app.preferredPort) {
    portHtml = `<span class="app-port-badge">:${app.preferredPort}</span>`;
  }

  // Starting countdown
  let countdownHtml = '';
  if (starting) {
    countdownHtml = `<span class="app-stats">${starting.countdown}s</span>`;
  }

  // Running stats (inline)
  let statsHtml = '';
  if (isRunning && detected) {
    const details = state.expandedPorts.get(detected.port);
    if (details) {
      const parts = [];
      if (details.memory) parts.push(details.memory + ' MB');
      if (details.uptime) {
        const h = Math.floor(details.uptime / 3600);
        const m = Math.floor((details.uptime % 3600) / 60);
        parts.push(h > 0 ? `${h}h ${m}m` : `${m}m`);
      }
      if (detected.pid) parts.push(`PID ${detected.pid}`);
      if (parts.length) statsHtml = `<span class="app-stats">${parts.join(' / ')}</span>`;
    }
  }

  // Badges
  const badges = [];
  if (reqs.docker) {
    const dockerReady = state.dockerRunning;
    badges.push(`<span class="req-badge ${dockerReady ? '' : 'badge-warning'}" title="${dockerReady ? 'Docker running' : 'Click to start Docker'}" ${dockerReady ? '' : 'data-act="startDocker"'}>${icon('docker', 12)}</span>`);
  }
  if (reqs.node) badges.push(`<span class="req-badge" title="Node.js">N</span>`);
  if (reqs.python) badges.push(`<span class="req-badge" title="Python">Py</span>`);
  if (reqs.database) badges.push(`<span class="req-badge" title="Database">DB</span>`);
  if (reqs.autoStart) badges.push(`<span class="req-badge" title="Auto-start">${icon('play', 10)}</span>`);
  if (reqs.remote) badges.push(`<span class="req-badge" title="Remote">${icon('globe', 10)}</span>`);

  const isSelected = state.selectedApps.has(app.id);
  const isActive = state.drawerAppId === app.id;
  const isStale = state.staleApps.has(app.id);

  // Action buttons
  let actionsHtml = '';
  if (conflict) {
    actionsHtml = `
      <button class="btn btn-small btn-secondary" data-act="openPortInBrowser" data-port="${conflict.port}" title="Open port">${icon('browser', 12)}</button>
      <button class="btn btn-small btn-warning" data-act="killConflictingProcess" data-id="${app.id}" title="Kill blocker & free the port">${icon('kill', 12)}</button>
      <button class="btn btn-small btn-secondary" data-act="startOnFreePort" data-id="${app.id}" title="Start on next free port">+</button>
      <button class="btn btn-small btn-success" data-act="startApp" data-id="${app.id}" title="Kill blocker & start">${icon('play', 12)}</button>`;
  } else if (isRunning || starting) {
    actionsHtml = `
      <button class="btn btn-small btn-secondary" data-act="openInBrowser" data-id="${app.id}" title="Open" ${starting ? 'disabled' : ''}>${icon('browser', 12)}</button>
      ${managedRunning ? `<button class="btn btn-small btn-secondary" data-act="viewLogs" data-id="${app.id}" title="View logs">${icon('logs', 12)}</button>` : ''}
      <button class="btn btn-small btn-danger" data-act="stopApp" data-id="${app.id}" title="Stop" ${starting ? 'disabled' : ''}>${icon('stop', 12)}</button>`;
  } else {
    actionsHtml = `<button class="btn btn-small btn-success" data-act="startApp" data-id="${app.id}" title="Start">${icon('play', 12)}</button>`;
  }

  return `
    <div class="app-card ${isSelected ? 'selected' : ''} ${isActive ? 'drawer-open' : ''} ${isBranch ? 'is-branch' : ''} ${isStale ? 'is-stale' : ''}"
         data-id="${app.id}"
         ${isBranch ? `style="--branch-color:${app.color}"` : ''}
         draggable="true"
         tabindex="0"
         role="button"
         aria-haspopup="dialog"
         aria-label="${escapeHtml(app.name)} — press Enter to open details"
         >
      <span class="drag-handle" title="Drag to reorder" aria-hidden="true">${icon('grip', 14)}</span>
      <input type="checkbox" class="app-checkbox"
             ${isSelected ? 'checked' : ''}
             data-change="toggleAppSelection"
             data-id="${app.id}"
             aria-label="Select ${escapeHtml(app.name)}"
             title="Select">
      <span class="status-dot ${statusClass}"${statusTitle ? ` title="${escapeHtml(statusTitle)}"` : ''}></span>
      <div class="app-name-area">
        <button class="btn-star ${app.isFavorite ? 'starred' : ''}"
                data-act="toggleFavorite" data-id="${app.id}"
                title="${app.isFavorite ? 'Unfavorite' : 'Favorite'}">
          ${app.isFavorite ? icon('star', 14) : icon('star-outline', 14)}
        </button>
        <span class="app-name-text">${escapeHtml(app.name)}</span>
        ${app.branch ? `<span class="branch-chip" style="--branch-color:${app.color}" title="Branch / worktree">${icon('branch', 11)}${escapeHtml(app.branch)}</span>` : ''}
        ${branchCount > 0 ? `<span class="branch-count" title="${branchCount} branch${branchCount !== 1 ? 'es' : ''}">${icon('branch', 10)}${branchCount}</span>` : ''}
        ${isStale ? `<span class="stale-badge" title="Worktree folder is gone - safe to remove">stale</span>` : ''}
        ${portHtml}
        ${countdownHtml}
        ${statsHtml}
        ${badges.length > 0 ? `<div class="req-badges">${badges.join('')}</div>` : ''}
      </div>
      <span class="expand-indicator">${icon('chevron', 10)}</span>
      <div class="app-actions-visible">
        ${actionsHtml}
      </div>
      <div class="app-actions">
        ${!isBranch ? `<button class="btn btn-small btn-secondary" data-act="addBranch" data-id="${app.id}" title="Add a branch / worktree">${icon('branch', 12)}</button>` : ''}
        <button class="btn btn-small btn-secondary" data-act="openAppFolder" data-id="${app.id}" title="Open folder">${icon('folder', 12)}</button>
        <button class="btn btn-small btn-secondary" data-act="editApp" data-id="${app.id}" title="Edit">${icon('edit', 12)}</button>
        <button class="btn btn-small btn-secondary" data-act="deleteApp" data-id="${app.id}" title="Delete">${icon('trash', 12)}</button>
      </div>
    </div>
  `;
}

async function startApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;

  if (app.preferredPort) {
    const portCheck = await window.portpilot.ports.check(app.preferredPort);
    if (portCheck.inUse && portCheck.info) {
      const blocker = portCheck.info;
      const blockerName = blocker.processName || 'Unknown process';
      const blockerPid = blocker.pid;

      let blockerAppName = null;
      for (const [id, detectedPort] of Object.entries(state.detectedApps)) {
        if (detectedPort.port === app.preferredPort) {
          const blockerApp = state.apps.find(a => a.id === id);
          if (blockerApp) { blockerAppName = blockerApp.name; break; }
        }
      }

      const message = blockerAppName
        ? `Port ${app.preferredPort} is in use by ${blockerAppName} (${blockerName}, PID ${blockerPid}).\n\nStop ${blockerAppName} and start ${app.name}?`
        : `Port ${app.preferredPort} is in use by ${blockerName} (PID ${blockerPid}).\n\nKill this process and start ${app.name}?`;

      if (!confirm(message)) return;

      showToast(`Stopping process on port ${app.preferredPort}...`, 'info');
      const killResult = await window.portpilot.ports.kill(app.preferredPort);
      if (!killResult.success) {
        showToast(`Failed to kill blocker: ${killResult.error}`, 'error');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  showToast(`Starting ${app.name}...`, 'success');
  const result = await window.portpilot.process.start(app);
  if (result.success) {
    showToast(`${app.name} started (PID: ${result.pid})`, 'success');
    if (app.preferredPort) {
      const delay = detectStartupDelay(app);
      startPortReadinessCheck(appId, app.preferredPort, delay);
    }
  } else {
    showToast(`Failed to start: ${result.error}`, 'error');
  }
  await loadApps();
}

async function stopApp(appId) {
  const result = await window.portpilot.process.stop(appId);
  if (result.success) {
    showToast('App stopped', 'success');
    await loadApps();
    return;
  }

  const app = state.apps.find(a => a.id === appId);
  const detected = state.detectedApps[appId];

  if (detected && detected.port) {
    if (!confirm(`App not managed by PortPilot. Kill process on port ${detected.port}?`)) return;
    const killResult = await window.portpilot.ports.kill(detected.port);
    if (killResult.success) {
      showToast(`Killed process on port ${detected.port}`, 'success');
    } else {
      showToast(`Failed to kill: ${killResult.error}`, 'error');
    }
  } else {
    showToast('Failed to stop: ' + result.error, 'error');
  }
  await loadApps();
}

// ============ Port Conflict Resolution ============
function showUnknownConflictWarnings(conflicts) {
  const toShow = conflicts.slice(0, 3);
  toShow.forEach(conflict => {
    const processName = conflict.occupiedBy.processName || 'Unknown';
    const pid = conflict.occupiedBy.pid;
    showToast(
      `Port ${conflict.port} blocked for ${conflict.appName} by ${processName} (PID ${pid})`,
      'warning'
    );
  });
  if (conflicts.length > 3) {
    showToast(`${conflicts.length - 3} more port conflicts detected`, 'warning');
  }
}

async function killConflictingProcess(appId) {
  const conflict = state.unknownConflicts.find(c => c.appId === appId);
  if (!conflict) { showToast('No conflict found', 'error'); return; }

  const processInfo = conflict.occupiedBy;
  const processName = processInfo.processName || 'Unknown process';
  if (!confirm(`Kill ${processName} (PID ${processInfo.pid}) on port ${conflict.port}?`)) return;

  const result = await window.portpilot.ports.kill(conflict.port);
  if (result.success) {
    showToast(`Killed ${processName} on port ${conflict.port}`, 'success');
    state.unknownConflicts = state.unknownConflicts.filter(c => c.appId !== appId);
    await loadApps();
  } else {
    showToast(`Failed to kill process: ${result.error}`, 'error');
  }
}

// Start a conflicted app on the next free port instead of fighting for its
// preferred one. Non-destructive: overrides PORT for this run only, does not
// change the saved preferredPort.
async function startOnFreePort(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;
  const from = (app.preferredPort || 3000) + 1;
  const res = await window.portpilot.ports.findAvailable(from, from + 50);
  const freePort = res && res.port;
  if (!freePort) { showToast('No free port found nearby', 'error'); return; }

  showToast(`Starting ${app.name} on free port ${freePort}...`, 'success');
  const result = await window.portpilot.process.start({ ...app, preferredPort: freePort });
  if (result.success) {
    showToast(`${app.name} started on ${freePort} (PID ${result.pid})`, 'success');
    startPortReadinessCheck(appId, freePort, detectStartupDelay(app));
  } else {
    showToast(`Failed to start: ${result.error}`, 'error');
  }
  await loadApps();
}

function editApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (app) openAppModal(app);
}

async function deleteApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;
  state.deleteAppId = appId;
  document.getElementById('delete-app-name').textContent = app.name;
  document.getElementById('total-apps-count').textContent = state.apps.length;
  document.getElementById('modal-delete-confirm').classList.remove('hidden');
}

async function confirmDeleteApp() {
  if (!state.deleteAppId) return;
  const result = await window.portpilot.config.deleteApp(state.deleteAppId);
  if (result.success) {
    showToast('App deleted', 'success');
    closeDeleteConfirm();
    await loadApps();
  } else {
    showToast('Failed to delete: ' + result.error, 'error');
  }
}

function closeDeleteConfirm() {
  document.getElementById('modal-delete-confirm').classList.add('hidden');
  state.deleteAppId = null;
}

// ============ Favorites ============
async function toggleFavorite(appId) {
  const result = await window.portpilot.config.toggleFavorite(appId);
  if (result.success) {
    const app = state.apps.find(a => a.id === appId);
    if (app) {
      app.isFavorite = result.app.isFavorite;
      renderApps();
    }
  } else {
    showToast('Failed to toggle favorite: ' + result.error, 'error');
  }
}

async function toggleSection(section) {
  if (section === 'favorites') {
    state.favoritesExpanded = !state.favoritesExpanded;
    await window.portpilot.config.updateSettings({ favoritesExpanded: state.favoritesExpanded });
  } else if (section === 'others') {
    state.otherProjectsExpanded = !state.otherProjectsExpanded;
    await window.portpilot.config.updateSettings({ otherProjectsExpanded: state.otherProjectsExpanded });
  }
  renderApps();
}

async function togglePortGroup(key) {
  if (!(key in state.portGroupExpanded)) return;
  state.portGroupExpanded[key] = !state.portGroupExpanded[key];
  await window.portpilot.config.updateSettings({ portGroupExpanded: state.portGroupExpanded });
  renderPorts();
}

// ============ Groups ============
async function toggleGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  group.expanded = !group.expanded;
  await window.portpilot.config.saveGroup(group);
  renderApps();
}

let _editingGroupId = null;

function openNewGroupModal() {
  _editingGroupId = null;
  document.getElementById('group-modal-title').textContent = 'New Group';
  document.getElementById('group-name-input').value = '';
  renderGroupColorSwatches(null);
  document.getElementById('modal-group').classList.remove('hidden');
  document.getElementById('group-name-input').focus();
}

function openRenameGroupModal(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  _editingGroupId = groupId;
  document.getElementById('group-modal-title').textContent = 'Rename Group';
  document.getElementById('group-name-input').value = group.name;
  renderGroupColorSwatches(group.color || GROUP_COLORS[0]);
  document.getElementById('modal-group').classList.remove('hidden');
  document.getElementById('group-name-input').focus();
}

function closeGroupModal() {
  document.getElementById('modal-group').classList.add('hidden');
  _editingGroupId = null;
}

async function saveGroupModal() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { showToast('Group name is required', 'error'); return; }

  const color = document.getElementById('group-color-input')?.value || GROUP_COLORS[0];
  const groupConfig = { id: _editingGroupId || undefined, name, expanded: true, color };
  const result = await window.portpilot.config.saveGroup(groupConfig);

  if (result.success) {
    if (_editingGroupId) {
      const idx = state.groups.findIndex(g => g.id === _editingGroupId);
      if (idx >= 0) state.groups[idx] = result.group;
    } else {
      state.groups.push(result.group);
    }
    closeGroupModal();
    renderApps();
    showToast(`Group "${name}" ${_editingGroupId ? 'renamed' : 'created'}`, 'success');
  } else {
    showToast('Failed to save group: ' + result.error, 'error');
  }
}

async function confirmDeleteGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  if (!confirm(`Delete group "${group.name}"?\nApps in this group will move to Other Projects.`)) return;

  const result = await window.portpilot.config.deleteGroup(groupId);
  if (result.success) {
    state.groups = state.groups.filter(g => g.id !== groupId);
    state.apps = state.apps.map(app => app.group === groupId ? { ...app, group: null } : app);
    renderApps();
    showToast(`Group "${group.name}" deleted`, 'success');
  } else {
    showToast('Failed to delete group: ' + result.error, 'error');
  }
}

async function moveSelectedToGroup(groupId) {
  if (state.selectedApps.size === 0) return;
  for (const appId of state.selectedApps) {
    const app = state.apps.find(a => a.id === appId);
    if (app) {
      app.group = groupId || null;
      await window.portpilot.config.saveApp(app);
    }
  }
  clearSelection();
  renderApps();
  const groupName = groupId
    ? (state.groups.find(g => g.id === groupId)?.name || 'group')
    : 'Other Projects';
  showToast(`Apps moved to ${groupName}`, 'success');
}

function updateGroupSelects() {
  const selSelect = document.getElementById('selection-group-select');
  if (selSelect) {
    selSelect.innerHTML = '<option value="" disabled selected>Move to Group</option>';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Other Projects (no group)';
    selSelect.appendChild(noneOpt);
    for (const group of state.groups) {
      const opt = document.createElement('option');
      opt.value = group.id;
      opt.textContent = group.name;
      selSelect.appendChild(opt);
    }
  }
}

// ============ App Card Expansion ============
function fmtUptime(sec) {
  if (!sec) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Slide-over detail drawer: opens on row click, shows the full untruncated
// command/cwd plus live stats and safe actions (Start XOR Stop, never both).
function openAppDrawer(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;
  state.drawerAppId = appId;

  const managedRunning = state.runningApps.find(r => r.id === app.id && r.running);
  const detected = state.detectedApps[app.id];
  const isRunning = !!(managedRunning || detected);
  const starting = state.startingApps[app.id];
  const conflict = state.unknownConflicts.find(c => c.appId === app.id);
  const port = detected?.port ?? app.preferredPort;
  const details = detected ? state.expandedPorts.get(detected.port) : null;

  const health = state.health[app.id];
  let statusClass = 'stopped', statusWord = 'Stopped';
  if (starting) { statusClass = 'starting'; statusWord = 'Starting'; }
  else if (isRunning) {
    if (health === 'unhealthy') { statusClass = 'error'; statusWord = 'Not responding'; }
    else { statusClass = 'running'; statusWord = 'Running'; }
  }
  else if (conflict) { statusClass = 'conflict'; statusWord = 'Port blocked'; }
  const healthLabel = { healthy: 'Responding (2xx/3xx)', unhealthy: 'Not responding (error status)', down: 'No response' }[health];

  document.getElementById('app-drawer-status').className = `status-dot ${statusClass}`;
  document.getElementById('app-drawer-title').textContent = app.name;

  const field = (label, value, mono) => value
    ? `<div class="drawer-field"><span class="drawer-field-label">${label}</span><span class="drawer-field-value${mono ? ' mono' : ''}">${escapeHtml(String(value))}</span></div>`
    : '';

  const fields = [
    field('Status', statusWord + (managedRunning && detected?.pid ? ` · PID ${detected.pid}` : '')),
    isRunning ? field('Health', healthLabel || 'Checking...') : '',
    field('Branch', app.branch),
    port ? field('Port', `:${port}${app.fallbackRange ? `  (fallback ${app.fallbackRange[0]}-${app.fallbackRange[1]})` : ''}`, true) : '',
    field('Memory', details?.memory ? details.memory + ' MB' : ''),
    field('Uptime', fmtUptime(details?.uptime)),
    field('Command', app.command, true),
    field('Directory', app.cwd, true),
    field('Info', app.description),
  ].filter(Boolean).join('');

  // Primary action: Start XOR Stop (never both).
  let primary;
  if (conflict) {
    primary = `<button class="btn btn-secondary" data-act="startOnFreePort" data-id="${app.id}">${icon('play', 12)} Start on free port</button>
               <button class="btn btn-success" data-act="startApp" data-id="${app.id}">${icon('kill', 12)} Kill blocker & start</button>`;
  } else if (isRunning || starting) {
    primary = `<button class="btn btn-danger" data-act="stopApp" data-id="${app.id}" ${starting ? 'disabled' : ''}>${icon('stop', 12)} Stop</button>`;
  } else {
    primary = `<button class="btn btn-success" data-act="startApp" data-id="${app.id}">${icon('play', 12)} Start</button>`;
  }

  const secondary = [
    port ? `<button class="btn btn-secondary" data-act="openInBrowser" data-id="${app.id}">${icon('browser', 12)} Open</button>` : '',
    managedRunning ? `<button class="btn btn-secondary" data-act="viewLogs" data-id="${app.id}">${icon('logs', 12)} Logs</button>` : '',
    app.cwd ? `<button class="btn btn-secondary" data-act="openAppFolder" data-id="${app.id}">${icon('folder', 12)} Folder</button>` : '',
    `<button class="btn btn-secondary" data-act="copyCmdPath" data-cmd="${escapeHtml(app.command)}">${icon('copy', 12)} Copy cmd</button>`,
    !app.parentId ? `<button class="btn btn-secondary" data-act="addBranch" data-id="${app.id}">${icon('branch', 12)} Add branch</button>` : '',
    !app.parentId ? `<button class="btn btn-secondary" data-act="detectWorktrees" data-id="${app.id}">${icon('branch', 12)} Add worktrees</button>` : '',
    `<button class="btn btn-secondary" data-act="editApp" data-id="${app.id}">${icon('edit', 12)} Edit</button>`,
    `<button class="btn btn-secondary" data-act="deleteApp" data-id="${app.id}">${icon('trash', 12)} Delete</button>`,
  ].filter(Boolean).join('');

  const stale = state.staleApps.has(app.id);
  const staleBanner = stale
    ? `<div class="drawer-stale">Worktree folder is gone (<span class="mono">${escapeHtml(app.worktreePath || app.cwd || '')}</span>). Safe to remove this entry.
         <button class="btn btn-danger" data-act="deleteApp" data-id="${app.id}">${icon('trash', 12)} Remove entry</button></div>`
    : '';

  document.getElementById('app-drawer-body').innerHTML = `
    ${staleBanner}
    <div class="drawer-actions-primary">${primary}</div>
    <div class="drawer-fields">${fields}</div>
    <div class="drawer-actions">${secondary}</div>`;

  document.getElementById('app-drawer-backdrop').classList.remove('hidden');
  document.getElementById('app-drawer').classList.remove('hidden');
  renderApps(); // re-render to mark the active row
}

function closeAppDrawer() {
  state.drawerAppId = null;
  document.getElementById('app-drawer-backdrop').classList.add('hidden');
  document.getElementById('app-drawer').classList.add('hidden');
  renderApps();
}

// ---- Slice 9: detect a repo's git worktrees and bulk-add them as branches ----
let worktreeCtx = null; // { parent, candidates }

async function detectWorktrees(appId) {
  const res = await window.portpilot.worktrees.detect(appId);
  if (!res.success) { showToast(res.error || 'Could not detect worktrees', 'error'); return; }
  const addable = res.candidates.filter(c => !c.registered);
  if (res.candidates.length === 0) { showToast('No other worktrees found for this repo', 'info'); return; }
  if (addable.length === 0) { showToast('All worktrees of this repo are already added', 'info'); return; }
  worktreeCtx = res;
  openWorktreesModal(res);
}

function openWorktreesModal(ctx) {
  document.getElementById('worktrees-count').textContent = `${ctx.candidates.length} found`;
  const list = document.getElementById('worktrees-list');
  list.innerHTML = ctx.candidates.map((c, i) => {
    const swatch = c.color ? `<span class="wt-swatch" style="background:${c.color}" title="${c.colorSource === 'peacock' ? 'Peacock colour' : 'colour'}"></span>` : '';
    return `
      <label class="discovery-item ${c.registered ? 'wt-registered' : ''}">
        <input type="checkbox" data-wt-index="${i}" ${c.registered ? 'disabled' : 'checked'}>
        ${swatch}
        <span class="wt-branch">${c.branch ? escapeHtml(c.branch) : '(detached)'}</span>
        <span class="wt-path">${escapeHtml(c.path)}</span>
        ${c.registered ? '<span class="wt-badge">already added</span>' : ''}
      </label>`;
  }).join('');
  document.getElementById('modal-worktrees').classList.remove('hidden');
}

function closeWorktreesModal() {
  document.getElementById('modal-worktrees').classList.add('hidden');
  worktreeCtx = null;
}

async function confirmAddWorktrees() {
  if (!worktreeCtx) return;
  const checks = [...document.querySelectorAll('#worktrees-list input[type="checkbox"]:checked')];
  const picked = checks.map(c => worktreeCtx.candidates[Number(c.dataset.wtIndex)]).filter(Boolean);
  if (picked.length === 0) { showToast('Select at least one worktree', 'info'); return; }

  const parent = worktreeCtx.parent;
  let added = 0;
  for (const c of picked) {
    const cfg = {
      name: parent.name,
      command: parent.command || 'npm run dev',
      cwd: c.path,
      parentId: parent.id,
      branch: c.branch || null,
      worktreePath: c.path,
      preferredPort: null,
    };
    if (c.color) { cfg.color = c.color; cfg.colorSource = c.colorSource || 'peacock'; }
    const r = await window.portpilot.config.saveApp(cfg);
    if (r.success) added++;
  }
  closeWorktreesModal();
  await loadApps();
  showToast(`Added ${added} worktree${added !== 1 ? 's' : ''}`, 'success');
}

// Keyboard activation for app cards (Enter/Space toggles details), but only when
// the card itself is focused - never when focus is on a child control.
function handleCardKeydown(event, appId) {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    openAppDrawer(appId);
  }
}

// ============ Drag and Drop ============
let draggedAppId = null;

function handleDragStart(event) {
  const card = event.target.closest('.app-card');
  if (!card) return;
  draggedAppId = card.dataset.id;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedAppId);
}

function handleDragOver(event) {
  if (!event.target.closest('.app-card')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(event) {
  const card = event.target.closest('.app-card');
  if (card) card.classList.add('drag-over');
}

function handleDragLeave(event) {
  const card = event.target.closest('.app-card');
  if (card && !card.contains(event.relatedTarget)) card.classList.remove('drag-over');
}

async function handleDrop(event) {
  const card = event.target.closest('.app-card');
  if (!card) return;
  const targetAppId = card.dataset.id;
  event.stopPropagation();
  event.preventDefault();
  card.classList.remove('drag-over');

  if (draggedAppId === targetAppId) return;

  const draggedApp = state.apps.find(a => a.id === draggedAppId);
  const targetApp = state.apps.find(a => a.id === targetAppId);

  if (draggedApp.isFavorite !== targetApp.isFavorite) {
    showToast('Cannot drag between Favorites and other sections', 'warning');
    return;
  }

  if (!draggedApp.isFavorite && draggedApp.group !== targetApp.group) {
    draggedApp.group = targetApp.group;
    await window.portpilot.config.saveApp(draggedApp);
  }

  const draggedIndex = state.apps.findIndex(a => a.id === draggedAppId);
  const targetIndex = state.apps.findIndex(a => a.id === targetAppId);
  const [removed] = state.apps.splice(draggedIndex, 1);
  state.apps.splice(targetIndex, 0, removed);

  const result = await window.portpilot.config.updateAppsOrder(state.apps.map(a => a.id));
  if (result.success) {
    renderApps();
    showToast('App order saved', 'success');
  } else {
    showToast('Failed to save order: ' + result.error, 'error');
  }
}

function handleDragEnd() {
  document.querySelectorAll('.app-card').forEach(card => {
    card.classList.remove('drag-over');
    card.classList.remove('dragging');
  });
  draggedAppId = null;
}

// ============ Delete All ============
async function deleteAllInstead() {
  closeDeleteConfirm();
  if (state.apps.length === 0) { showToast('No apps to delete', 'info'); return; }

  const result = await window.portpilot.config.deleteAllApps();
  if (result.success) {
    showToast(`Deleted ${result.count} apps`, 'success');
    state.apps = [];
    state.selectedApps.clear();
    renderApps();
    updateAppsCount();
    updateSelectionToolbar();
  } else {
    showToast('Failed to delete apps: ' + result.error, 'error');
  }
}

// ============ Multi-Select ============
function toggleAppSelection(appId) {
  if (state.selectedApps.has(appId)) {
    state.selectedApps.delete(appId);
  } else {
    state.selectedApps.add(appId);
  }
  renderApps();
  updateSelectionToolbar();
}

function clearSelection() {
  state.selectedApps.clear();
  renderApps();
  updateSelectionToolbar();
}

function selectAllApps() {
  state.apps.forEach(app => state.selectedApps.add(app.id));
  renderApps();
  updateSelectionToolbar();
}

async function deleteSelected() {
  if (state.selectedApps.size === 0) return;
  const count = state.selectedApps.size;
  if (!confirm(`Delete ${count} selected app${count !== 1 ? 's' : ''}?`)) return;

  for (const appId of state.selectedApps) {
    await window.portpilot.config.deleteApp(appId);
  }
  state.selectedApps.clear();
  showToast(`Deleted ${count} app${count !== 1 ? 's' : ''}`, 'success');
  await loadApps();
  updateSelectionToolbar();
}

async function favoriteSelected() {
  if (state.selectedApps.size === 0) return;
  const count = state.selectedApps.size;
  for (const appId of state.selectedApps) {
    const app = state.apps.find(a => a.id === appId);
    if (app && !app.isFavorite) await window.portpilot.config.toggleFavorite(appId);
  }
  state.selectedApps.clear();
  showToast(`Marked ${count} as favorites`, 'success');
  await loadApps();
  updateSelectionToolbar();
}

async function unfavoriteSelected() {
  if (state.selectedApps.size === 0) return;
  const count = state.selectedApps.size;
  for (const appId of state.selectedApps) {
    const app = state.apps.find(a => a.id === appId);
    if (app && app.isFavorite) await window.portpilot.config.toggleFavorite(appId);
  }
  state.selectedApps.clear();
  showToast(`Unmarked ${count} from favorites`, 'success');
  await loadApps();
  updateSelectionToolbar();
}

function updateSelectionToolbar() {
  const toolbar = document.getElementById('selection-toolbar');
  const count = document.getElementById('selection-count');
  if (state.selectedApps.size > 0) {
    toolbar.classList.remove('hidden');
    count.textContent = `${state.selectedApps.size} selected`;
  } else {
    toolbar.classList.add('hidden');
  }
}

// ============ Project Discovery ============
async function loadDiscoverySettings() {
  const result = await window.portpilot.discovery.getSettings();
  if (result.success) {
    renderScanPaths(result.settings.scanPaths || []);
    document.getElementById('setting-discovery-autoscan').checked = result.settings.autoScanOnStartup || false;
    document.getElementById('setting-discovery-depth').value = result.settings.maxDepth || 2;
  }
}

function renderScanPaths(scanPaths) {
  const container = document.getElementById('scan-paths-list');
  if (!container) return;
  if (scanPaths.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 8px; font-size: 0.78rem;">No scan paths configured.</div>';
    return;
  }
  container.innerHTML = scanPaths.map(path => `
    <div class="scan-path-item">
      <span class="path-text">${escapeHtml(path)}</span>
      <button class="btn btn-small btn-danger" data-act="removeScanPath" data-path="${escapeHtml(path)}">Remove</button>
    </div>
  `).join('');
}

async function addScanPath() {
  const path = prompt('Enter directory path to scan (e.g., C:\\Projects):');
  if (!path) return;
  const result = await window.portpilot.discovery.addScanPath(path);
  if (result.success) {
    renderScanPaths(result.scanPaths);
    showToast('Scan path added', 'success');
  } else {
    showToast(result.error, 'error');
  }
}

async function removeScanPath(path) {
  const result = await window.portpilot.discovery.removeScanPath(path);
  if (result.success) {
    renderScanPaths(result.scanPaths);
    showToast('Scan path removed', 'success');
  }
}

async function discoverProjects() {
  showToast('Scanning for projects...', 'info');
  const result = await window.portpilot.discovery.scan();
  if (result.success) {
    if (result.projects.length === 0) {
      showToast(`No new projects found (scanned ${result.total} total)`, 'info');
    } else {
      showDiscoveriesModal(result.projects);
    }
  } else {
    showToast(`Discovery failed: ${result.error}`, 'error');
  }
}

function showDiscoveriesModal(projects) {
  const modal = document.getElementById('modal-discoveries');
  const list = document.getElementById('discoveries-list');
  const count = document.getElementById('discoveries-count');

  count.textContent = `${projects.length} found`;
  state.selectedProjects.clear();

  list.innerHTML = projects.map((proj, index) => {
    return `
      <div class="discovery-item" data-index="${index}">
        <input type="checkbox" class="discovery-checkbox"
               data-change="toggleProjectSelection" data-index="${index}"
               title="Select">
        <div class="discovery-content">
          <div class="discovery-header">
            <h4>${escapeHtml(proj.name)}</h4>
            <span class="badge">${proj.type}</span>
            <span class="confidence-badge confidence-${proj.confidence > 0.8 ? 'high' : 'medium'}">
              ${Math.round(proj.confidence * 100)}%
            </span>
          </div>
          <div class="discovery-details">
            <div class="detail-row"><span class="label">Command:</span><code>${escapeHtml(proj.command || 'Not detected')}</code></div>
            <div class="detail-row"><span class="label">Port:</span><code>${proj.port || 'Auto'}</code></div>
            <div class="detail-row"><span class="label">Path:</span><code class="path-text">${escapeHtml(proj.path)}</code></div>
          </div>
          <button class="btn btn-small btn-primary btn-add-discovery" data-act="addDiscoveredProject" data-index="${index}">Add</button>
        </div>
      </div>
    `;
  }).join('');

  window._discoveredProjects = projects;
  modal.classList.remove('hidden');
  updateDiscoverySelectionButtons();
}

async function addDiscoveredProject(index) {
  const project = window._discoveredProjects?.[index];
  if (!project) return;

  const appConfig = {
    name: project.name,
    command: project.command,
    cwd: project.path,
    preferredPort: project.port || null,
    fallbackRange: project.port ? [project.port + 1, project.port + 10] : null,
    env: project.env || {},
    autoStart: false
  };

  const result = await window.portpilot.config.saveApp(appConfig);
  if (result.success) {
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    if (item) {
      item.style.opacity = '0.5';
      const button = item.querySelector('.btn-add-discovery');
      button.textContent = 'Added';
      button.disabled = true;
    }
    showToast(`${project.name} added`, 'success');
    await loadApps();
  }
}

async function addAllDiscoveries() {
  const projects = window._discoveredProjects || [];
  let added = 0;
  for (let i = 0; i < projects.length; i++) {
    const item = document.querySelector(`.discovery-item[data-index="${i}"]`);
    const button = item?.querySelector('.btn-add-discovery');
    if (!button?.disabled) {
      await addDiscoveredProject(i);
      added++;
    }
  }
  showToast(`Added ${added} project${added !== 1 ? 's' : ''}`, 'success');
  state.selectedProjects.clear();
  updateDiscoverySelectionButtons();
  setTimeout(() => {
    document.getElementById('modal-discoveries').classList.add('hidden');
  }, 1500);
}

function toggleProjectSelection(index) {
  if (state.selectedProjects.has(index)) {
    state.selectedProjects.delete(index);
  } else {
    state.selectedProjects.add(index);
  }
  const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
  const checkbox = item?.querySelector('.discovery-checkbox');
  if (item && checkbox) {
    item.classList.toggle('selected', state.selectedProjects.has(index));
    checkbox.checked = state.selectedProjects.has(index);
  }
  updateDiscoverySelectionButtons();
}

function selectAllProjects() {
  const projects = window._discoveredProjects || [];
  projects.forEach((_, index) => {
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    const button = item?.querySelector('.btn-add-discovery');
    if (!button?.disabled) {
      state.selectedProjects.add(index);
      item?.classList.add('selected');
      const checkbox = item?.querySelector('.discovery-checkbox');
      if (checkbox) checkbox.checked = true;
    }
  });
  updateDiscoverySelectionButtons();
}

function clearProjectSelection() {
  state.selectedProjects.forEach(index => {
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    item?.classList.remove('selected');
    const checkbox = item?.querySelector('.discovery-checkbox');
    if (checkbox) checkbox.checked = false;
  });
  state.selectedProjects.clear();
  updateDiscoverySelectionButtons();
}

async function addSelectedProjects() {
  if (state.selectedProjects.size === 0) { showToast('No projects selected', 'info'); return; }
  let added = 0;
  for (const index of Array.from(state.selectedProjects)) {
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    const button = item?.querySelector('.btn-add-discovery');
    if (!button?.disabled) {
      await addDiscoveredProject(index);
      added++;
    }
  }
  state.selectedProjects.clear();
  showToast(`Added ${added} selected project${added !== 1 ? 's' : ''}`, 'success');
  updateDiscoverySelectionButtons();
}

function updateDiscoverySelectionButtons() {
  const selectAllBtn = document.getElementById('btn-select-all-projects');
  const addSelectedBtn = document.getElementById('btn-add-selected-projects');
  const addAllBtn = document.getElementById('btn-add-all-discoveries');

  if (state.selectedProjects.size > 0) {
    if (selectAllBtn) { selectAllBtn.textContent = 'Clear Selection'; selectAllBtn.onclick = clearProjectSelection; }
    if (addSelectedBtn) addSelectedBtn.classList.remove('hidden');
    if (addAllBtn) addAllBtn.classList.add('hidden');
  } else {
    if (selectAllBtn) { selectAllBtn.textContent = 'Select All'; selectAllBtn.onclick = selectAllProjects; }
    if (addSelectedBtn) addSelectedBtn.classList.add('hidden');
    if (addAllBtn) addAllBtn.classList.remove('hidden');
  }
}

// ============ Group Colors ============
const GROUP_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
];

function renderGroupColorSwatches(selected) {
  const container = document.getElementById('group-color-swatches');
  if (!container) return;
  const current = selected || GROUP_COLORS[0];
  container.innerHTML = GROUP_COLORS.map(c => `
    <button type="button"
            class="color-swatch ${c === current ? 'selected' : ''}"
            style="background:${c}"
            data-act="selectGroupColor" data-color="${c}"
            title="${c}"></button>
  `).join('');
  document.getElementById('group-color-input').value = current;
}

function selectGroupColor(color) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  const swatch = document.querySelector(`.color-swatch[title="${color}"]`);
  if (swatch) swatch.classList.add('selected');
  const input = document.getElementById('group-color-input');
  if (input) input.value = color;
}

// ============ Modal ============
function openAppModal(app = null, opts = {}) {
  const branchOf = opts.branchOf || null;        // parent app when adding a branch
  const isBranchEdit = !!app?.parentId;          // editing an existing branch
  const branchMode = !!branchOf || isBranchEdit; // show the Branch field

  document.getElementById('modal-title').textContent =
    app ? (isBranchEdit ? 'Edit Branch' : 'Edit App') : (branchOf ? 'Add Branch' : 'Add App');
  document.getElementById('app-id').value = app?.id || '';
  // Parent linkage: an edit keeps the app's own parent; adding a branch links to branchOf.
  document.getElementById('app-parent-id').value = app?.parentId || branchOf?.id || '';
  document.getElementById('app-branch').value = app?.branch || '';

  // Adding a branch seeds the command from the parent (same `npm run dev`), but
  // leaves cwd/port blank so the user points it at the worktree folder - the
  // distinct cwd is what lets PortPilot detect it separately from the parent.
  // Browse & Auto-detect fills the rest from the chosen worktree directory.
  document.getElementById('app-name').value = app?.name || (branchOf ? branchOf.name : '');
  document.getElementById('app-command').value = app?.command || branchOf?.command || '';
  document.getElementById('app-cwd').value = app?.cwd || '';
  document.getElementById('app-port').value = app?.preferredPort || '';
  document.getElementById('app-fallback').value = app?.fallbackRange
    ? `${app.fallbackRange[0]}-${app.fallbackRange[1]}`
    : (branchOf?.fallbackRange ? `${branchOf.fallbackRange[0]}-${branchOf.fallbackRange[1]}` : '');
  document.getElementById('app-autostart').checked = app?.autoStart || false;
  document.getElementById('app-health-path').value = app?.healthPath || '';

  const branchGroup = document.getElementById('app-branch-group');
  if (branchGroup) branchGroup.classList.toggle('hidden', !branchMode);

  const groupSelect = document.getElementById('app-group');
  groupSelect.innerHTML = '<option value="">Other Projects (no group)</option>';
  for (const group of state.groups) {
    const opt = document.createElement('option');
    opt.value = group.id;
    opt.textContent = group.name;
    if (app?.group === group.id) opt.selected = true;
    groupSelect.appendChild(opt);
  }

  dom.modal.classList.remove('hidden');
  document.getElementById(branchMode ? 'app-branch' : 'app-name').focus();
}

// Open the Add App modal in branch mode, linked to the given parent project.
function addBranch(parentId) {
  const parent = state.apps.find(a => a.id === parentId);
  if (!parent) return;
  openAppModal(null, { branchOf: parent });
  showToast('Point the working directory at the branch/worktree folder', 'info');
}

function closeModal() {
  dom.modal.classList.add('hidden');
  dom.appForm.reset();
}

async function findFreePort() {
  const portInput = document.getElementById('app-port');
  const startPort = parseInt(portInput.value) || 3000;

  try {
    const registeredPorts = new Set(
      state.apps.filter(app => app.preferredPort).map(app => app.preferredPort)
    );

    let candidatePort = startPort;
    let found = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await window.portpilot.ports.findAvailable(candidatePort, candidatePort + 50);
      if (result.success && result.port) {
        if (!registeredPorts.has(result.port)) {
          portInput.value = result.port;
          showToast(`Found free port: ${result.port}`, 'success');
          found = true;
          break;
        } else {
          candidatePort = result.port + 1;
        }
      } else {
        break;
      }
    }

    if (!found) showToast('No free port found', 'error');
  } catch (error) {
    showToast('Error finding free port', 'error');
  }
}

async function browseAndAutoDetect() {
  const btn = document.getElementById('btn-auto-detect');
  btn.disabled = true;
  btn.textContent = 'Detecting...';

  try {
    const browseResult = await window.portpilot.browseDirectory();
    if (!browseResult.success) {
      if (!browseResult.canceled) showToast('Failed to browse directory', 'error');
      return;
    }

    const dirPath = browseResult.path;
    const detectResult = await window.portpilot.discovery.detectProject(dirPath);

    if (!detectResult.success) {
      showToast(detectResult.error || 'No project detected', 'warning');
      return;
    }

    const project = detectResult.project;
    // Use the explicit port if found, else the framework's conventional default.
    const port = project.port || project.suggestedPort || null;
    document.getElementById('app-name').value = project.name || '';
    document.getElementById('app-command').value = project.command || '';
    document.getElementById('app-cwd').value = project.path || dirPath;
    document.getElementById('app-port').value = port || '';

    if (port) {
      document.getElementById('app-fallback').value = `${port + 1}-${port + 10}`;
    }

    const portNote = project.port ? '' : (project.suggestedPort ? ` (default port ${project.suggestedPort})` : '');
    showToast(`Detected ${project.type} project: ${project.name}${portNote}`, 'success');
  } catch (error) {
    showToast('Error detecting project: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Browse & Auto-detect Project';
  }
}

async function handleAppSubmit(e) {
  e.preventDefault();

  const fallbackStr = document.getElementById('app-fallback').value;
  let fallbackRange = null;
  if (fallbackStr) {
    const match = fallbackStr.match(/(\d+)\s*-\s*(\d+)/);
    if (match) fallbackRange = [parseInt(match[1]), parseInt(match[2])];
  }

  const appConfig = {
    id: document.getElementById('app-id').value || undefined,
    name: document.getElementById('app-name').value,
    command: document.getElementById('app-command').value,
    cwd: document.getElementById('app-cwd').value,
    preferredPort: parseInt(document.getElementById('app-port').value) || null,
    fallbackRange,
    autoStart: document.getElementById('app-autostart').checked,
    group: document.getElementById('app-group').value || null,
    parentId: document.getElementById('app-parent-id').value || null,
    branch: document.getElementById('app-branch').value.trim() || null,
    healthPath: document.getElementById('app-health-path').value.trim() || null
  };

  const result = await window.portpilot.config.saveApp(appConfig);
  if (result.success) {
    showToast('App saved', 'success');
    closeModal();
    await loadApps();
  } else {
    showToast('Failed to save: ' + result.error, 'error');
  }
}

// ============ Settings ============
async function loadSettings() {
  const result = await window.portpilot.config.getSettings();
  if (result.success) {
    state.settings = result.settings;
    document.getElementById('setting-autoscan').checked = state.settings.autoScan !== false;
    document.getElementById('setting-interval').value = state.settings.scanInterval / 1000 || 5;
    document.getElementById('setting-devtools').checked = state.settings.openDevTools === true;
    document.getElementById('setting-close-to-tray').checked = state.settings.closeToTray !== false;
    document.getElementById('setting-stop-apps-on-quit').checked = state.settings.stopAppsOnQuit !== false;
    document.getElementById('setting-auto-resize').checked = state.settings.autoResizeWindow === true;
    document.getElementById('setting-open-at-login').checked = state.settings.openAtLogin !== false;
    state.favoritesExpanded = result.settings.favoritesExpanded !== false;
    state.otherProjectsExpanded = result.settings.otherProjectsExpanded !== false;
    const pge = result.settings.portGroupExpanded;
    if (pge && typeof pge === 'object') {
      state.portGroupExpanded = {
        dev: pge.dev !== false,
        other: pge.other !== false,
        system: pge.system === true,
      };
    }
  }
  await loadDiscoverySettings();
}

async function saveSettings() {
  const settings = {
    autoScan: document.getElementById('setting-autoscan').checked,
    scanInterval: parseInt(document.getElementById('setting-interval').value) * 1000,
    openDevTools: document.getElementById('setting-devtools').checked,
    closeToTray: document.getElementById('setting-close-to-tray').checked,
    stopAppsOnQuit: document.getElementById('setting-stop-apps-on-quit').checked,
    autoResizeWindow: document.getElementById('setting-auto-resize').checked,
    openAtLogin: document.getElementById('setting-open-at-login').checked
  };
  await window.portpilot.config.updateSettings(settings);
  state.settings = settings;
  setupAutoScan();   // apply new autoScan / scanInterval immediately
  showToast('Settings saved', 'success');
}

async function exportConfig() {
  const result = await window.portpilot.config.export();
  if (result.success) {
    const blob = new Blob([result.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portpilot-config.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Config exported', 'success');
  }
}

async function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const result = await window.portpilot.config.import(text);
    if (result.success) {
      showToast('Config imported', 'success');
      await loadApps();
    } else {
      showToast('Import failed: ' + result.error, 'error');
    }
  };
  input.click();
}

// ============ Theme ============
const THEME_LABELS = {
  'auto': 'Auto',
  'light': 'Light',
  'tokyonight': 'TokyoNight',
  'nord': 'Nord',
  'dracula': 'Dracula',
  'glass': 'Glass'
};

// Retired themes fall back to the closest surviving one.
const RETIRED_THEMES = {
  'brutalist-dark': 'tokyonight',
  'solarized-light': 'light'
};

let systemThemeQuery = null;

function resolveTheme(choice) {
  if (choice === 'auto') {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'tokyonight';
  }
  return choice;
}

function loadTheme() {
  let saved = localStorage.getItem('portpilot-theme') || 'tokyonight';
  if (RETIRED_THEMES[saved]) saved = RETIRED_THEMES[saved];
  setTheme(saved, false);
}

function setTheme(choice, showNotification = true) {
  if (RETIRED_THEMES[choice]) choice = RETIRED_THEMES[choice];
  state.theme = choice;
  localStorage.setItem('portpilot-theme', choice);
  document.body.setAttribute('data-theme', resolveTheme(choice));

  if (systemThemeQuery) systemThemeQuery.onchange = null;
  if (choice === 'auto' && window.matchMedia) {
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    systemThemeQuery.onchange = () => document.body.setAttribute('data-theme', resolveTheme('auto'));
  }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === choice);
  });

  if (showNotification) {
    showToast(`Theme: ${THEME_LABELS[choice] || choice}`, 'success');
  }
}

// ============ Web Agent (Option C) ============
async function initWebAgentUI() {
  if (!window.portpilot.agent) {
    document.getElementById('web-agent-section')?.classList.add('hidden');
    return;
  }
  try {
    const status = await window.portpilot.agent.status();
    document.getElementById('setting-web-agent').checked = !!status.running;
    updateWebAgentUI(status.running ? status : null);
  } catch { /* leave default */ }
}

function updateWebAgentUI(info) {
  const box = document.getElementById('web-agent-info');
  if (info && info.url) {
    document.getElementById('web-agent-url').textContent = info.url;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

async function toggleWebAgent(e) {
  if (e.target.checked) {
    const result = await window.portpilot.agent.start();
    if (result.success) {
      updateWebAgentUI(result);
      showToast(`Web access on: ${result.url}`, 'success');
    } else {
      e.target.checked = false;
      showToast('Failed to enable web access: ' + result.error, 'error');
    }
  } else {
    await window.portpilot.agent.stop();
    updateWebAgentUI(null);
    showToast('Web access disabled', 'info');
  }
}

// ============ Logs Viewer ============
let _logsAppId = null;
let _logsTimer = null;

async function viewLogs(appId) {
  _logsAppId = appId;
  const app = state.apps.find(a => a.id === appId);
  document.getElementById('logs-app-name').textContent = app ? app.name : 'App';
  document.getElementById('modal-logs').classList.remove('hidden');
  await refreshLogs();
  if (_logsTimer) clearInterval(_logsTimer);
  _logsTimer = setInterval(refreshLogs, 2000);   // stream while running
}

async function refreshLogs() {
  if (!_logsAppId) return;
  const out = document.getElementById('logs-stdout');
  const err = document.getElementById('logs-stderr');
  const errSection = document.getElementById('logs-stderr-section');
  try {
    const result = await window.portpilot.process.logs(_logsAppId);
    if (result.success) {
      const autoscroll = document.getElementById('logs-autoscroll')?.checked !== false;
      out.textContent = result.stdout && result.stdout.trim() ? result.stdout : '(no stdout yet)';
      err.textContent = result.stderr || '';
      errSection.style.display = (result.stderr && result.stderr.trim()) ? '' : 'none';
      if (autoscroll) {
        out.scrollTop = out.scrollHeight;
        err.scrollTop = err.scrollHeight;
      }
    } else {
      out.textContent = 'No logs available - this app was not started by PortPilot, or it has exited.';
      errSection.style.display = 'none';
    }
  } catch (e) {
    out.textContent = 'Failed to read logs: ' + e.message;
  }
}

function closeLogs() {
  document.getElementById('modal-logs').classList.add('hidden');
  if (_logsTimer) { clearInterval(_logsTimer); _logsTimer = null; }
  _logsAppId = null;
}

function copyLogs() {
  const out = document.getElementById('logs-stdout').textContent;
  const err = document.getElementById('logs-stderr').textContent;
  const text = [out, (err && err.trim()) ? '\n--- stderr ---\n' + err : ''].join('');
  navigator.clipboard.writeText(text);
  showToast('Logs copied', 'success');
}

// ============ Utilities ============
function showToast(message, type = 'success') {
  const existing = dom.toastContainer.querySelectorAll('.toast');
  if (existing.length >= 3) existing[0].remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);

  const remove = () => {
    toast.style.opacity = '0';
    setTimeout(() => toast.isConnected && toast.remove(), 200);
  };
  setTimeout(remove, 3000);
}

async function openExternal(url) {
  if (window.portpilot && window.portpilot.openExternal) {
    const result = await window.portpilot.openExternal(url);
    if (!result.success) throw new Error(result.error || 'Unknown error');
  } else {
    window.open(url, '_blank');
  }
}

// ============ Expose Functions ============
window.killPort = killPort;
window.copyPort = copyPort;
window.copyCmdPath = copyCmdPath;
window.startApp = startApp;
window.stopApp = stopApp;
window.killConflictingProcess = killConflictingProcess;
window.openPortInBrowser = openPortInBrowser;
window.openAppFolder = openAppFolder;
window.editApp = editApp;
window.deleteApp = deleteApp;
window.openExternal = openExternal;
window.openInBrowser = openInBrowser;
window.startDocker = startDocker;
window.toggleFavorite = toggleFavorite;
window.toggleSection = toggleSection;
window.toggleAppSelection = toggleAppSelection;
window.selectAllApps = selectAllApps;
window.clearSelection = clearSelection;
window.deleteSelected = deleteSelected;
window.favoriteSelected = favoriteSelected;
window.unfavoriteSelected = unfavoriteSelected;
window.removeScanPath = removeScanPath;
window.addDiscoveredProject = addDiscoveredProject;
window.toggleProjectSelection = toggleProjectSelection;
window.selectAllProjects = selectAllProjects;
window.clearProjectSelection = clearProjectSelection;
window.addSelectedProjects = addSelectedProjects;
window.selectGroupColor = selectGroupColor;
window.openNewGroupModal = openNewGroupModal;
window.openRenameGroupModal = openRenameGroupModal;
window.closeGroupModal = closeGroupModal;
window.saveGroupModal = saveGroupModal;
window.confirmDeleteGroup = confirmDeleteGroup;
window.moveSelectedToGroup = moveSelectedToGroup;
window.openAppDrawer = openAppDrawer;
window.closeAppDrawer = closeAppDrawer;
window.handleCardKeydown = handleCardKeydown;
window.toggleGroup = toggleGroup;
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDragEnter = handleDragEnter;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;
window.handleDragEnd = handleDragEnd;
window.openProcessFolder = openProcessFolder;
window.viewLogs = viewLogs;
window.closeLogs = closeLogs;
window.copyLogs = copyLogs;
window.refreshLogs = refreshLogs;
