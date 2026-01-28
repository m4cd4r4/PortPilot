/**
 * PortPilot Renderer - UI Logic
 * Handles all user interactions and state management
 */

// ============ State ============
const state = {
  ports: [],
  apps: [],
  runningApps: [],
  detectedApps: {},  // Map of appId -> detected port info
  unknownConflicts: [],  // Array of port conflicts with unknown processes
  startingApps: {},  // Map of appId -> { countdown, interval, port }
  settings: {},
  filter: '',
  theme: 'tokyonight',
  dockerRunning: false,  // Track Docker Desktop status
  favoritesExpanded: true,  // Favorites section collapse state
  otherProjectsExpanded: true,  // Other projects section collapse state
  deleteAppId: null,  // Track app being deleted for confirmation modal
  selectedApps: new Set(),  // Multi-select for apps
  selectedProjects: new Set(),  // Multi-select for discovered projects
  expandedApps: new Set(),  // Track which app cards are expanded (v1.6: 1-line compact mode)
  expandedPorts: new Map()  // Track which port cards are expanded (Map: port -> details)
};

// ============ Requirement Detection ============
/**
 * Detect app requirements based on command and cwd
 * @param {Object} app - App configuration
 * @returns {Object} Requirements object with boolean flags
 */
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

/**
 * Detect startup delay based on app type
 * @param {Object} app - App configuration
 * @returns {number} Delay in seconds
 */
function detectStartupDelay(app) {
  // Check if user configured a custom delay
  if (app.startupDelay && app.startupDelay > 0) {
    return app.startupDelay;
  }

  const cmd = (app.command || '').toLowerCase();

  // Docker containers take longer
  if (cmd.includes('docker') || cmd.includes('compose')) {
    return 20;
  }

  // Node/npm/pnpm projects
  if (cmd.includes('npm') || cmd.includes('pnpm') || cmd.includes('yarn') || cmd.includes('node') || cmd.includes('bun')) {
    return 10;
  }

  // Python projects
  if (cmd.includes('python') || cmd.includes('uvicorn') || cmd.includes('flask') || cmd.includes('django')) {
    return 5;
  }

  // Default fallback
  return 8;
}

/**
 * Poll port to check if it's actually responding
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if port is listening
 */
async function checkPortReady(port) {
  try {
    const result = await window.portpilot.ports.check(port);
    return result.inUse && result.info;
  } catch {
    return false;
  }
}

/**
 * Start countdown timer with port polling
 * @param {string} appId - App ID
 * @param {number} port - Port to poll
 * @param {number} maxDelay - Maximum delay in seconds
 */
function startPortReadinessCheck(appId, port, maxDelay) {
  let elapsed = 0;

  state.startingApps[appId] = {
    countdown: maxDelay,
    port,
    interval: setInterval(async () => {
      elapsed++;
      const remaining = maxDelay - elapsed;

      // Check if port is ready
      const ready = await checkPortReady(port);

      if (ready || remaining <= 0) {
        // Port is ready or timeout reached
        clearInterval(state.startingApps[appId].interval);
        delete state.startingApps[appId];
        await loadApps(); // Refresh to show final state
      } else {
        // Update countdown
        state.startingApps[appId].countdown = remaining;
        renderApps(); // Just update the UI, don't reload
      }
    }, 1000)
  };
}

/**
 * Check if Docker Desktop is running
 */
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

/**
 * Start Docker Desktop
 */
async function startDocker() {
  showToast('Starting Docker Desktop...', 'success');
  try {
    const result = await window.portpilot.docker.start();
    if (result.success) {
      showToast('Docker Desktop starting - please wait...', 'success');
      // Poll for Docker to be ready
      pollDockerReady();
    } else {
      showToast('Failed to start Docker: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Failed to start Docker: ' + error.message, 'error');
  }
}

/**
 * Poll Docker status until ready
 */
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
  portFilter: document.getElementById('port-filter'),
  portCount: document.getElementById('port-count'),
  modal: document.getElementById('modal-app'),
  appForm: document.getElementById('app-form'),
  toastContainer: document.getElementById('toast-container')
};

// ============ Initialization ============
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadTheme();
  await loadSettings();

  // Check Docker status in background (don't await - non-blocking)
  checkDockerStatus();

  await loadApps();

  if (state.settings.autoScan) {
    await scanPorts();
  }

  // Listen for tray scan trigger
  window.portpilot.on('trigger-scan', scanPorts);

  // Listen for external config changes (e.g., from MCP)
  window.portpilot.on('config-changed', async (data) => {
    console.log('[Renderer] Config changed externally, refreshing apps list...');
    await loadApps();
    showToast('Apps list updated (external change detected)', 'info');
  });
});

// ============ Event Listeners ============
function setupEventListeners() {
  // Header buttons
  document.getElementById('btn-scan').addEventListener('click', scanPorts);
  document.getElementById('btn-add-app').addEventListener('click', () => openAppModal());
  document.getElementById('btn-refresh-apps').addEventListener('click', refreshApps);

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Filter
  dom.portFilter.addEventListener('input', (e) => {
    state.filter = e.target.value.toLowerCase();
    renderPorts();
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-find-port').addEventListener('click', findFreePort);
  document.getElementById('btn-auto-detect').addEventListener('click', browseAndAutoDetect);
  dom.appForm.addEventListener('submit', handleAppSubmit);

  // Settings
  document.getElementById('setting-autoscan').addEventListener('change', saveSettings);
  document.getElementById('setting-interval').addEventListener('change', saveSettings);
  document.getElementById('setting-devtools').addEventListener('change', saveSettings);
  document.getElementById('setting-close-to-tray').addEventListener('change', saveSettings);
  document.getElementById('setting-stop-apps-on-quit').addEventListener('change', saveSettings);
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

  // Theme selector
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Knowledge carousel navigation
  document.querySelectorAll('.knowledge-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;

      // Update active button
      document.querySelectorAll('.knowledge-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update active section
      document.querySelectorAll('.knowledge-section').forEach(s => s.classList.remove('active'));
      document.querySelector(`.knowledge-section[data-section="${section}"]`).classList.add('active');
    });
  });

  // Close modal on backdrop click
  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) closeModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      // Allow Escape to close modals even when in input
      if (e.key === 'Escape') {
        closeModal();
        closeDeleteConfirm();
        document.getElementById('modal-discoveries').classList.add('hidden');
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          scanPorts();
          break;
        case 'n':
          e.preventDefault();
          openAppModal();
          break;
        case '1':
          e.preventDefault();
          switchTab('ports');
          break;
        case '2':
          e.preventDefault();
          switchTab('apps');
          break;
        case '3':
          e.preventDefault();
          switchTab('knowledge');
          break;
        case '4':
          e.preventDefault();
          switchTab('settings');
          break;
      }
    } else if (e.key === 'Escape') {
      closeModal();
      closeDeleteConfirm();
      document.getElementById('modal-discoveries').classList.add('hidden');
    }
  });
}

// ============ Tab Navigation ============
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Refresh data when switching tabs
  if (tabId === 'ports') scanPorts();
  if (tabId === 'apps') loadApps();
}

// ============ Port Operations ============
async function scanPorts() {
  const btn = document.getElementById('btn-scan');
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> Scanning...';

  try {
    const result = await window.portpilot.ports.scan();
    if (result.success) {
      state.ports = result.ports.sort((a, b) => a.port - b.port);
      renderPorts();
      showToast(`Found ${state.ports.length} active ports`, 'success');

      // Auto-fetch details for all ports
      fetchAllPortDetails();
    } else {
      showToast('Failed to scan ports: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Scan error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="icon">🔄</span> Scan Ports';
  }
}

function renderPorts() {
  const filtered = state.ports.filter(p => {
    if (!state.filter) return true;
    const searchStr = `${p.port} ${p.processName || ''} ${p.commandLine || ''}`.toLowerCase();
    return searchStr.includes(state.filter);
  });

  dom.portCount.textContent = `${filtered.length} port${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    dom.portsList.innerHTML = `<div class="empty-state">
      ${state.ports.length === 0 ? 'No active ports found. Click "Scan Ports" to refresh.' : 'No ports match your filter.'}
    </div>`;
    return;
  }

  dom.portsList.innerHTML = filtered.map(p => {
    // Determine bind type and IP version from address
    const addr = p.address || '';
    const isIPv6 = addr.includes('[');
    const isLocalOnly = addr.includes('127.0.0.1') || addr.includes('[::1]');
    const bindIcon = isLocalOnly ? '🏠' : '🌐';
    const bindTitle = isLocalOnly ? 'Localhost only (127.0.0.1)' : 'All interfaces (0.0.0.0) - Network accessible';
    const ipVersion = isIPv6 ? 'v6' : 'v4';

    // Extract executable path from command line for "Open folder" button
    const cmdLine = p.commandLine || '';
    const exePath = extractExePath(cmdLine);

    // Get cached details
    const details = state.expandedPorts.get(p.port);

    // Format uptime
    const formatUptime = (seconds) => {
      if (!seconds) return '';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (hours > 0) return `${hours}h ${minutes}m`;
      if (minutes > 0) return `${minutes}m`;
      return `${seconds}s`;
    };

    return `
    <div class="port-card" data-port="${p.port}">
      <div class="port-card-header">
        <span class="port-number">:${p.port}</span>
        <span class="port-bind" title="${bindTitle}">${bindIcon}</span>
        <span class="port-ip">${ipVersion}</span>
        <span class="port-process">${escapeHtml(p.processName || 'Unknown')}</span>
        ${details ? `
        <span class="port-stat" title="Memory usage">${details.memory ? details.memory + ' MB' : 'N/A'}</span>
        <span class="port-stat" title="Uptime">${formatUptime(details.uptime) || 'N/A'}</span>
        <span class="port-stat" title="Active connections">${details.connections !== null ? details.connections + ' conn' : 'N/A'}</span>
        ` : '<span class="port-stat-loading">⏳</span>'}
        <span class="port-pid">${p.pid || ''}</span>
        ${cmdLine ? `
        <span class="port-cmd-icon" onclick="event.stopPropagation()" title="Command path">
          CMD
          <div class="cmd-tooltip">
            <div class="cmd-tooltip-header">
              <span class="cmd-tooltip-title">Full Command Path</span>
              <button class="cmd-copy-btn" onclick="copyCmdPath('${escapeHtml(cmdLine.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')">
                Copy
              </button>
            </div>
            <div class="cmd-tooltip-path">${escapeHtml(cmdLine)}</div>
          </div>
        </span>` : ''}
        <div class="port-actions" onclick="event.stopPropagation()">
          <button class="btn btn-small btn-secondary" onclick="openPortInBrowser(${p.port})" title="Open in browser">🌐</button>
          ${exePath ? `<button class="btn btn-small btn-secondary" onclick="openProcessFolder('${escapeHtml(exePath.replace(/\\/g, '\\\\'))}')" title="Open folder">📂</button>` : ''}
          <button class="btn btn-small btn-secondary" onclick="copyPort(${p.port})" title="Copy localhost:${p.port}">📋</button>
          <button class="btn btn-small btn-danger" onclick="killPort(${p.port})" title="Kill process">✕</button>
        </div>
      </div>
    </div>
  `}).join('');
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
  showToast('Command path copied to clipboard', 'success');
}

// Toggle port card expansion (for long commands only)
function togglePortExpansion(port, pid) {
  if (state.expandedPorts.has(port)) {
    state.expandedPorts.delete(port);
  } else {
    state.expandedPorts.set(port, {});
  }
  renderPorts();
}

// Auto-fetch details for all ports
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

// Open port in browser
async function openPortInBrowser(port) {
  const url = `http://localhost:${port}`;
  try {
    await window.portpilot.openExternal(url);
    showToast(`Opened localhost:${port}`, 'success');
  } catch (err) {
    showToast('Failed to open browser', 'error');
  }
}

// Open folder containing executable
async function openProcessFolder(exePath) {
  if (!exePath) return;
  try {
    // Get directory from path
    const dir = exePath.substring(0, exePath.lastIndexOf('\\')) || exePath.substring(0, exePath.lastIndexOf('/'));
    if (dir) {
      await window.portpilot.openExternal(`file:///${dir.replace(/\\/g, '/')}`);
      showToast('Opened folder', 'success');
    }
  } catch (err) {
    showToast('Failed to open folder', 'error');
  }
}

// Open app working directory
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

// Extract executable path from command line
function extractExePath(cmdLine) {
  if (!cmdLine) return null;

  // Handle quoted paths: "C:\Program Files\app.exe" args
  if (cmdLine.startsWith('"')) {
    const endQuote = cmdLine.indexOf('"', 1);
    if (endQuote > 1) {
      return cmdLine.substring(1, endQuote);
    }
  }

  // Handle unquoted paths: C:\app.exe args
  const firstSpace = cmdLine.indexOf(' ');
  if (firstSpace > 0) {
    return cmdLine.substring(0, firstSpace);
  }

  // No spaces - entire string is the path
  return cmdLine;
}

async function openInBrowser(appId) {
  const detected = state.detectedApps[appId];
  const app = state.apps.find(a => a.id === appId);
  const port = detected?.port || app?.preferredPort;

  if (port) {
    // Use correct host based on binding address
    // IPv6 bindings ([::1] or [::]) use [::1], IPv4 (0.0.0.0 or 127.0.0.1) use 127.0.0.1
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
    const [configResult, runningResult, scanResult] = await Promise.all([
      window.portpilot.config.getApps(),
      window.portpilot.process.list(),
      window.portpilot.ports.scanWithApps()
    ]);

    if (configResult.success) state.apps = configResult.apps;
    if (runningResult.success) state.runningApps = runningResult.apps;
    if (scanResult.success) {
      state.ports = scanResult.ports;
      state.detectedApps = scanResult.matches || {};
      state.unknownConflicts = scanResult.unknownConflicts || [];

      // Show warnings for unknown port conflicts
      if (state.unknownConflicts.length > 0) {
        showUnknownConflictWarnings(state.unknownConflicts);
      }
    }

    renderApps();
    updateAppsCount();

    // v1.6: Auto-resize window based on app count
    try {
      await window.portpilot.window.autoResize(state.apps.length);
    } catch (resizeError) {
      // Silent fail - window resize is not critical
      console.log('Window auto-resize skipped:', resizeError.message);
    }
  } catch (error) {
    showToast('Failed to load apps: ' + error.message, 'error');
  }
}

async function refreshApps() {
  const btn = document.getElementById('btn-refresh-apps');
  btn.disabled = true;
  btn.innerHTML = '⏳ Refreshing...';

  try {
    await loadApps();
    showToast('Apps refreshed', 'success');
  } catch (error) {
    showToast('Failed to refresh: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 Refresh';
  }
}

function updateAppsCount() {
  const countBadge = document.getElementById('apps-count');
  if (countBadge) {
    const runningCount = state.apps.filter(app => {
      const managedRunning = state.runningApps.find(r => r.id === app.id && r.running);
      const detected = state.detectedApps[app.id];
      return managedRunning || detected;
    }).length;

    countBadge.textContent = `${state.apps.length} apps • ${runningCount} running`;
  }
}

function renderApps() {
  if (state.apps.length === 0) {
    dom.appsList.innerHTML = `<div class="empty-state">
      No apps registered. Click "Add App" to register your first app.
    </div>`;
    return;
  }

  // Separate favorites and non-favorites
  const favorites = state.apps.filter(app => app.isFavorite);
  const others = state.apps.filter(app => !app.isFavorite);

  let html = '';

  // Favorites Section (only if favorites exist)
  if (favorites.length > 0) {
    html += `
      <div class="app-section">
        <div class="section-header" onclick="toggleSection('favorites')">
          <span class="section-toggle">${state.favoritesExpanded ? '▼' : '▶'}</span>
          <span class="section-title">⭐ Favorites</span>
          <span class="section-count">${favorites.length} app${favorites.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="section-apps ${state.favoritesExpanded ? '' : 'collapsed'}">
          ${favorites.map(app => renderAppCard(app)).join('')}
        </div>
      </div>
    `;
  }

  // Other Projects Section
  if (others.length > 0) {
    html += `
      <div class="app-section">
        <div class="section-header" onclick="toggleSection('others')">
          <span class="section-toggle">${state.otherProjectsExpanded ? '▼' : '▶'}</span>
          <span class="section-title">📁 Other Projects</span>
          <span class="section-count">${others.length} app${others.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="section-apps ${state.otherProjectsExpanded ? '' : 'collapsed'}">
          ${others.map(app => renderAppCard(app)).join('')}
        </div>
      </div>
    `;
  }

  dom.appsList.innerHTML = html;
}

function renderAppCard(app) {
  // Check if app is running via PortPilot's process manager
  const managedRunning = state.runningApps.find(r => r.id === app.id && r.running);
  // Check if app is detected running externally via port scan
  const detected = state.detectedApps[app.id];
  const isRunning = managedRunning || detected;

  // Detect requirements
  const reqs = detectRequirements(app);

  // Determine port display with IPv4/IPv6 indicator
  let portDisplay = '';
  let ipVersion = '';
  if (detected) {
    const isIPv6 = detected.address?.startsWith('[');
    ipVersion = isIPv6 ? 'v6' : 'v4';
    portDisplay = ` • <span class="detected-port" title="Detected on ${detected.address}">:${detected.port} ✓</span>`;
  } else if (app.preferredPort) {
    portDisplay = ` • Port ${app.preferredPort}`;
  }

  // Check if app is starting (countdown active)
  const starting = state.startingApps[app.id];

  // Check for unknown port conflict
  const conflict = state.unknownConflicts.find(c => c.appId === app.id);

  // Status text with IPv4/IPv6 indicator and countdown
  let statusText = '○ Stopped';
  let statusClass = 'status-stopped';
  if (starting) {
    statusText = `● Starting... ${starting.countdown}s`;
    statusClass = 'status-starting';
  } else if (detected) {
    statusText = `● Running :${detected.port} <span class="ip-version">${ipVersion}</span>`;
    statusClass = 'status-running';
  } else if (managedRunning) {
    statusText = '● Running';
    statusClass = 'status-running';
  } else if (conflict) {
    statusText = `⚠️ Port ${conflict.port} Blocked`;
    statusClass = 'status-conflict';
  }

  // Build requirement badges
  const badges = [];
  if (reqs.docker) {
    const dockerReady = state.dockerRunning;
    const dockerClass = dockerReady ? 'badge-ready' : 'badge-warning';
    const dockerTitle = dockerReady ? 'Docker is running' : 'Docker Desktop not running - click to start';
    const dockerClick = dockerReady ? '' : `onclick="startDocker()"`;
    badges.push(`<span class="req-badge docker ${dockerClass}" title="${dockerTitle}" ${dockerClick}>🐳</span>`);
  }
  if (reqs.node) badges.push(`<span class="req-badge node" title="Node.js app">📦</span>`);
  if (reqs.python) badges.push(`<span class="req-badge python" title="Python app">🐍</span>`);
  if (reqs.database) badges.push(`<span class="req-badge database" title="Uses database">🗄️</span>`);
  if (reqs.autoStart) badges.push(`<span class="req-badge autostart" title="Auto-start enabled">⚡</span>`);
  if (reqs.remote) badges.push(`<span class="req-badge remote" title="Remote/VPS app">🌐</span>`);

  const badgesHtml = badges.length > 0 ? `<div class="req-badges">${badges.join('')}</div>` : '';

  const isSelected = state.selectedApps.has(app.id);
  const isExpanded = state.expandedApps.has(app.id);

  return `
    <div class="app-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : 'compact'}"
         data-id="${app.id}"
         data-favorite="${app.isFavorite ? 'true' : 'false'}"
         draggable="true"
         ondragstart="handleDragStart(event, '${app.id}')"
         ondragover="handleDragOver(event)"
         ondragenter="handleDragEnter(event)"
         ondragleave="handleDragLeave(event)"
         ondrop="handleDrop(event, '${app.id}')"
         ondragend="handleDragEnd(event)"
         onclick="if (event.target.closest('.app-checkbox, .btn-star, .app-actions, .drag-handle, button')) return; toggleAppExpansion('${app.id}')">
      <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
      <input type="checkbox" class="app-checkbox"
             ${isSelected ? 'checked' : ''}
             onchange="event.stopPropagation(); toggleAppSelection('${app.id}')"
             title="Select for bulk actions">
      <div class="app-info">
        <div class="app-name">
          <span class="app-color" style="background: ${app.color}"></span>
          <button class="btn-star ${app.isFavorite ? 'starred' : ''}"
                  onclick="event.stopPropagation(); toggleFavorite('${app.id}')"
                  title="${app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${app.isFavorite ? '⭐' : '☆'}
          </button>
          ${escapeHtml(app.name)}
          ${portDisplay}
          <span class="expand-indicator">${isExpanded ? '▼' : '▶'}</span>
        </div>
        <div class="app-meta">
          <code>${escapeHtml(app.command)}</code>
          ${badgesHtml}
        </div>
      </div>
      <span class="app-status ${statusClass}">
        ${statusText}
      </span>
      <div class="app-actions">
        ${conflict
          ? `<button class="btn btn-small btn-secondary" onclick="openPortInBrowser(${conflict.port})" title="Open http://localhost:${conflict.port} to see what's running">🌐</button>
             <button class="btn btn-small btn-warning" onclick="killConflictingProcess('${app.id}')" title="Kill process occupying port ${conflict.port} (PID ${conflict.occupiedBy.pid})">Kill Blocker</button>
             <button class="btn btn-small btn-success" onclick="startApp('${app.id}')" title="Start app">▶</button>`
          : isRunning || starting
            ? `<button class="btn btn-small btn-secondary" onclick="openInBrowser('${app.id}')" title="${starting ? 'Waiting for app to be ready...' : 'Open in browser'}" ${starting ? 'disabled' : ''}>🌐</button>
               <button class="btn btn-small btn-danger" onclick="stopApp('${app.id}')" title="Stop app" ${starting ? 'disabled' : ''}>■</button>`
            : `<button class="btn btn-small btn-success" onclick="startApp('${app.id}')" title="Start app">▶</button>`
        }
        <button class="btn btn-small btn-secondary" onclick="openAppFolder('${app.id}')" title="Open working directory">📂</button>
        <button class="btn btn-small btn-secondary" onclick="editApp('${app.id}')">Edit</button>
        <button class="btn btn-small btn-secondary" onclick="deleteApp('${app.id}')">🗑</button>
      </div>
    </div>
  `;
}

async function startApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;

  // PRE-FLIGHT CHECK: If app has a preferred port, check if it's in use
  if (app.preferredPort) {
    const portCheck = await window.portpilot.ports.check(app.preferredPort);

    if (portCheck.inUse && portCheck.info) {
      const blocker = portCheck.info;
      const blockerName = blocker.processName || 'Unknown process';
      const blockerPid = blocker.pid;

      // Check if blocker is a registered app
      let blockerAppName = null;
      for (const [appId, detectedPort] of Object.entries(state.detectedApps)) {
        if (detectedPort.port === app.preferredPort) {
          const blockerApp = state.apps.find(a => a.id === appId);
          if (blockerApp) {
            blockerAppName = blockerApp.name;
            break;
          }
        }
      }

      // Show conflict dialog
      const message = blockerAppName
        ? `Port ${app.preferredPort} is in use by ${blockerAppName} (${blockerName}, PID ${blockerPid}).\n\nStop ${blockerAppName} and start ${app.name}?`
        : `Port ${app.preferredPort} is in use by ${blockerName} (PID ${blockerPid}).\n\nKill this process and start ${app.name}?`;

      if (!confirm(message)) {
        return; // User cancelled
      }

      // Kill the blocker
      showToast(`Stopping process on port ${app.preferredPort}...`, 'info');
      const killResult = await window.portpilot.ports.kill(app.preferredPort);

      if (!killResult.success) {
        showToast(`Failed to kill blocker: ${killResult.error}`, 'error');
        return;
      }

      // Wait a moment for port to be released
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Start the app
  showToast(`Starting ${app.name}...`, 'success');

  const result = await window.portpilot.process.start(app);
  if (result.success) {
    showToast(`${app.name} started (PID: ${result.pid})`, 'success');

    // Start port readiness check if app has a preferred port
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
  // First try normal stop (for PortPilot-managed apps)
  const result = await window.portpilot.process.stop(appId);

  if (result.success) {
    showToast('App stopped', 'success');
    await loadApps();
    return;
  }

  // If that fails, check if app has a detected port and kill by port instead
  const app = state.apps.find(a => a.id === appId);
  const detected = state.detectedApps[appId];

  if (detected && detected.port) {
    if (!confirm(`App not managed by PortPilot. Kill process on port ${detected.port}?`)) {
      return;
    }

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
  // Show toast for each conflict (limit to 3 to avoid spam)
  const toShow = conflicts.slice(0, 3);
  toShow.forEach(conflict => {
    const processName = conflict.occupiedBy.processName || 'Unknown';
    const pid = conflict.occupiedBy.pid;
    showToast(
      `⚠️ Port ${conflict.port} blocked for ${conflict.appName} by ${processName} (PID ${pid})`,
      'warning'
    );
  });

  if (conflicts.length > 3) {
    showToast(`⚠️ ${conflicts.length - 3} more port conflicts detected`, 'warning');
  }
}

async function killConflictingProcess(appId) {
  const conflict = state.unknownConflicts.find(c => c.appId === appId);
  if (!conflict) {
    showToast('No conflict found', 'error');
    return;
  }

  const processInfo = conflict.occupiedBy;
  const processName = processInfo.processName || 'Unknown process';
  const message = `Kill ${processName} (PID ${processInfo.pid}) on port ${conflict.port}?`;

  if (!confirm(message)) return;

  const result = await window.portpilot.ports.kill(conflict.port);
  if (result.success) {
    showToast(`Killed ${processName} on port ${conflict.port}`, 'success');
    // Clear conflict from state
    state.unknownConflicts = state.unknownConflicts.filter(c => c.appId !== appId);
    // Refresh to update UI
    await loadApps();
  } else {
    showToast(`Failed to kill process: ${result.error}`, 'error');
  }
}

function openPortInBrowser(port) {
  const url = `http://localhost:${port}`;
  window.portpilot.shell.openExternal(url);
  showToast(`Opening http://localhost:${port}`, 'info');
}

function editApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (app) openAppModal(app);
}

async function deleteApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;

  // Open confirmation modal
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
      renderApps(); // Re-render to move to correct section
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

// ============ App Card Expansion (v1.6: 1-line compact mode) ============
function toggleAppExpansion(appId) {
  if (state.expandedApps.has(appId)) {
    state.expandedApps.delete(appId);
  } else {
    state.expandedApps.add(appId);
  }
  renderApps();
}

function expandAllApps() {
  state.apps.forEach(app => state.expandedApps.add(app.id));
  renderApps();
}

function collapseAllApps() {
  state.expandedApps.clear();
  renderApps();
}

// ============ Drag and Drop Reordering ============
let draggedAppId = null;

function handleDragStart(event, appId) {
  draggedAppId = appId;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/html', event.currentTarget.innerHTML);
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(event) {
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

async function handleDrop(event, targetAppId) {
  event.stopPropagation();
  event.preventDefault();

  event.currentTarget.classList.remove('drag-over');

  if (draggedAppId === targetAppId) return;

  const draggedApp = state.apps.find(a => a.id === draggedAppId);
  const targetApp = state.apps.find(a => a.id === targetAppId);

  // Only allow reordering within same section (favorites vs non-favorites)
  if (draggedApp.isFavorite !== targetApp.isFavorite) {
    showToast('Cannot move between Favorites and Other Projects sections', 'warning');
    return;
  }

  // Reorder apps array
  const draggedIndex = state.apps.findIndex(a => a.id === draggedAppId);
  const targetIndex = state.apps.findIndex(a => a.id === targetAppId);

  const [removed] = state.apps.splice(draggedIndex, 1);
  state.apps.splice(targetIndex, 0, removed);

  // Save new order to config
  const result = await window.portpilot.config.updateAppsOrder(state.apps.map(a => a.id));

  if (result.success) {
    renderApps();
    showToast('App order saved', 'success');
  } else {
    showToast('Failed to save order: ' + result.error, 'error');
  }
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');

  // Remove drag-over class from all cards
  document.querySelectorAll('.app-card').forEach(card => {
    card.classList.remove('drag-over');
  });

  draggedAppId = null;
}

// ============ Delete All ============
async function deleteAllInstead() {
  // Close delete confirmation and delete all apps
  closeDeleteConfirm();

  if (state.apps.length === 0) {
    showToast('No apps to delete', 'info');
    return;
  }

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

// ============ Multi-Select for Apps ============
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

  // Delete each selected app
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

  for (const appId of state.selectedApps) {
    const app = state.apps.find(a => a.id === appId);
    if (app && !app.isFavorite) {
      await window.portpilot.config.toggleFavorite(appId);
    }
  }

  state.selectedApps.clear();
  showToast(`Marked ${state.selectedApps.size} as favorites`, 'success');
  await loadApps();
  updateSelectionToolbar();
}

async function unfavoriteSelected() {
  if (state.selectedApps.size === 0) return;

  for (const appId of state.selectedApps) {
    const app = state.apps.find(a => a.id === appId);
    if (app && app.isFavorite) {
      await window.portpilot.config.toggleFavorite(appId);
    }
  }

  state.selectedApps.clear();
  showToast(`Unmarked ${state.selectedApps.size} from favorites`, 'success');
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
    container.innerHTML = '<div class="empty-state" style="padding: 10px; font-size: 0.85rem;">No scan paths configured. Click "Add Path" to get started.</div>';
    return;
  }

  container.innerHTML = scanPaths.map(path => `
    <div class="scan-path-item">
      <span class="path-text">${escapeHtml(path)}</span>
      <button class="btn btn-small btn-danger" onclick="removeScanPath('${escapeHtml(path).replace(/'/g, "\\'")}')">Remove</button>
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

  // Reset selected projects
  state.selectedProjects.clear();

  list.innerHTML = projects.map((proj, index) => {
    const isSelected = state.selectedProjects.has(index);
    return `
      <div class="discovery-item ${isSelected ? 'selected' : ''}" data-index="${index}">
        <input type="checkbox" class="discovery-checkbox"
               ${isSelected ? 'checked' : ''}
               onchange="toggleProjectSelection(${index})"
               title="Select for bulk import">
        <div class="discovery-content">
          <div class="discovery-header">
            <h4>${escapeHtml(proj.name)}</h4>
            <span class="badge badge-${proj.type.toLowerCase().replace(/\s+/g, '-')}">${proj.type}</span>
            <span class="confidence-badge confidence-${proj.confidence > 0.8 ? 'high' : 'medium'}">
              ${Math.round(proj.confidence * 100)}% match
            </span>
          </div>
          <div class="discovery-details">
            <div class="detail-row">
              <span class="label">Command:</span>
              <code>${escapeHtml(proj.command || 'Not detected')}</code>
            </div>
            <div class="detail-row">
              <span class="label">Port:</span>
              <code>${proj.port || 'Auto-detect'}</code>
            </div>
            <div class="detail-row">
              <span class="label">Path:</span>
              <code class="path-text">${escapeHtml(proj.path)}</code>
            </div>
          </div>
          <button class="btn btn-small btn-primary btn-add-discovery" onclick="addDiscoveredProject(${index})">
            Add
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Store projects in a temporary variable for access in onclick handlers
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
    // Mark as added in UI
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    if (item) {
      item.style.opacity = '0.5';
      const button = item.querySelector('.btn-add-discovery');
      button.textContent = 'Added ✓';
      button.disabled = true;
    }
    showToast(`${project.name} added to apps`, 'success');
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

// ============ Multi-Select for Discovered Projects ============
function toggleProjectSelection(index) {
  if (state.selectedProjects.has(index)) {
    state.selectedProjects.delete(index);
  } else {
    state.selectedProjects.add(index);
  }

  // Update checkbox and item visual
  const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
  const checkbox = item?.querySelector('.discovery-checkbox');

  if (item && checkbox) {
    if (state.selectedProjects.has(index)) {
      item.classList.add('selected');
      checkbox.checked = true;
    } else {
      item.classList.remove('selected');
      checkbox.checked = false;
    }
  }

  updateDiscoverySelectionButtons();
}

function selectAllProjects() {
  const projects = window._discoveredProjects || [];
  projects.forEach((_, index) => {
    const item = document.querySelector(`.discovery-item[data-index="${index}"]`);
    const button = item?.querySelector('.btn-add-discovery');

    // Only select projects that haven't been added yet
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
  if (state.selectedProjects.size === 0) {
    showToast('No projects selected', 'info');
    return;
  }

  const selectedIndexes = Array.from(state.selectedProjects);
  let added = 0;

  for (const index of selectedIndexes) {
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
    if (selectAllBtn) selectAllBtn.textContent = 'Clear Selection';
    if (selectAllBtn) selectAllBtn.onclick = clearProjectSelection;
    if (addSelectedBtn) addSelectedBtn.classList.remove('hidden');
    if (addAllBtn) addAllBtn.classList.add('hidden');
  } else {
    if (selectAllBtn) selectAllBtn.textContent = 'Select All';
    if (selectAllBtn) selectAllBtn.onclick = selectAllProjects;
    if (addSelectedBtn) addSelectedBtn.classList.add('hidden');
    if (addAllBtn) addAllBtn.classList.remove('hidden');
  }
}

// ============ Modal ============
function openAppModal(app = null) {
  document.getElementById('modal-title').textContent = app ? 'Edit App' : 'Add App';
  document.getElementById('app-id').value = app?.id || '';
  document.getElementById('app-name').value = app?.name || '';
  document.getElementById('app-command').value = app?.command || '';
  document.getElementById('app-cwd').value = app?.cwd || '';
  document.getElementById('app-port').value = app?.preferredPort || '';
  document.getElementById('app-fallback').value = app?.fallbackRange ? 
    `${app.fallbackRange[0]}-${app.fallbackRange[1]}` : '';
  document.getElementById('app-autostart').checked = app?.autoStart || false;
  
  dom.modal.classList.remove('hidden');
  document.getElementById('app-name').focus();
}

function closeModal() {
  dom.modal.classList.add('hidden');
  dom.appForm.reset();
}

async function findFreePort() {
  const portInput = document.getElementById('app-port');
  const startPort = parseInt(portInput.value) || 3000;

  try {
    // Get all registered apps' preferred ports to avoid conflicts
    const registeredPorts = new Set(
      state.apps
        .filter(app => app.preferredPort)
        .map(app => app.preferredPort)
    );

    // Find a port that's both system-available AND not registered to another app
    let candidatePort = startPort;
    let found = false;

    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await window.portpilot.ports.findAvailable(candidatePort, candidatePort + 50);

      if (result.success && result.port) {
        // Check if this port is already registered to another app
        if (!registeredPorts.has(result.port)) {
          portInput.value = result.port;
          showToast(`Found free port: ${result.port}`, 'success');
          found = true;
          break;
        } else {
          // Port is available on system but registered to another app, try next
          candidatePort = result.port + 1;
        }
      } else {
        break; // No more available ports in range
      }
    }

    if (!found) {
      showToast('No free port found (all ports in use or registered)', 'error');
    }
  } catch (error) {
    showToast('Error finding free port', 'error');
  }
}

async function browseAndAutoDetect() {
  const btn = document.getElementById('btn-auto-detect');
  btn.disabled = true;
  btn.textContent = '🔍 Detecting...';

  try {
    // Browse for directory
    const browseResult = await window.portpilot.browseDirectory();

    if (!browseResult.success) {
      if (!browseResult.canceled) {
        showToast('Failed to browse directory', 'error');
      }
      return;
    }

    const dirPath = browseResult.path;

    // Detect project in selected directory
    const detectResult = await window.portpilot.discovery.detectProject(dirPath);

    if (!detectResult.success) {
      showToast(detectResult.error || 'No project detected in this directory', 'warning');
      return;
    }

    const project = detectResult.project;

    // Auto-fill form fields
    document.getElementById('app-name').value = project.name || '';
    document.getElementById('app-command').value = project.command || '';
    document.getElementById('app-cwd').value = project.path || dirPath;
    document.getElementById('app-port').value = project.port || '';

    // Set fallback range if port detected
    if (project.port) {
      document.getElementById('app-fallback').value = `${project.port + 1}-${project.port + 10}`;
    }

    showToast(`✓ Detected ${project.type} project: ${project.name}`, 'success');
  } catch (error) {
    showToast('Error detecting project: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Browse & Auto-detect Project';
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
    autoStart: document.getElementById('app-autostart').checked
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

    // Restore favorites section state
    state.favoritesExpanded = result.settings.favoritesExpanded !== false;
    state.otherProjectsExpanded = result.settings.otherProjectsExpanded !== false;
  }

  // Load discovery settings
  await loadDiscoverySettings();
}

async function saveSettings() {
  const settings = {
    autoScan: document.getElementById('setting-autoscan').checked,
    scanInterval: parseInt(document.getElementById('setting-interval').value) * 1000,
    openDevTools: document.getElementById('setting-devtools').checked,
    closeToTray: document.getElementById('setting-close-to-tray').checked,
    stopAppsOnQuit: document.getElementById('setting-stop-apps-on-quit').checked
  };

  await window.portpilot.config.updateSettings(settings);
  state.settings = settings;
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
function loadTheme() {
  const savedTheme = localStorage.getItem('portpilot-theme') || 'tokyonight';
  setTheme(savedTheme, false);
}

function setTheme(themeName, showNotification = true) {
  state.theme = themeName;
  document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('portpilot-theme', themeName);

  // Update active button
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });

  if (showNotification) {
    const themeLabels = {
      'tokyonight': 'TokyoNight',
      'brutalist-dark': 'Brutalist Dark',
      'nord': 'Nord',
      'dracula': 'Dracula',
      'solarized-light': 'Solarized Light'
    };
    showToast(`Theme: ${themeLabels[themeName] || themeName}`, 'success');
  }
}

// ============ Utilities ============
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function truncate(str, len) {
  if (!str || str.length <= len) return str;
  return str.slice(0, len) + '...';
}

// ============ External Links ============
async function openExternal(url) {
  // Use Electron's shell to open URLs in default browser
  if (window.portpilot && window.portpilot.openExternal) {
    const result = await window.portpilot.openExternal(url);
    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }
  } else {
    // Fallback for development/testing
    window.open(url, '_blank');
  }
}

// Expose functions for onclick handlers
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
