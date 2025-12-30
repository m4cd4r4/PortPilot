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
  settings: {},
  filter: '',
  theme: 'tokyonight',
  dockerRunning: false  // Track Docker Desktop status
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
    node: cmd.includes('npm') || cmd.includes('pnpm') || cmd.includes('yarn') || cmd.includes('node'),
    python: cmd.includes('python') || cmd.includes('uvicorn') || cmd.includes('flask') || cmd.includes('django'),
    database: cmd.includes('postgres') || cmd.includes('mysql') || cmd.includes('redis') || cmd.includes('mongo'),
    autoStart: app.autoStart || false,
    remote: cwd.includes('ssh') || cwd.includes('@') || app.remote || false
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
});

// ============ Event Listeners ============
function setupEventListeners() {
  // Header buttons
  document.getElementById('btn-scan').addEventListener('click', scanPorts);
  document.getElementById('btn-add-app').addEventListener('click', () => openAppModal());

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
  dom.appForm.addEventListener('submit', handleAppSubmit);

  // Settings
  document.getElementById('setting-autoscan').addEventListener('change', saveSettings);
  document.getElementById('setting-interval').addEventListener('change', saveSettings);
  document.getElementById('btn-export').addEventListener('click', exportConfig);
  document.getElementById('btn-import').addEventListener('click', importConfig);

  // Theme selector
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Close modal on backdrop click
  dom.modal.addEventListener('click', (e) => {
    if (e.target === dom.modal) closeModal();
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

  dom.portsList.innerHTML = filtered.map(p => `
    <div class="port-card" data-port="${p.port}">
      <div class="port-header">
        <span class="port-number">:${p.port}</span>
        <div class="port-actions">
          <button class="btn btn-small btn-secondary" onclick="copyPort(${p.port})" title="Copy">📋</button>
          <button class="btn btn-small btn-danger" onclick="killPort(${p.port})" title="Kill">✕</button>
        </div>
      </div>
      <div class="port-info">
        <div class="port-info-row">
          <span class="label">Process:</span>
          <span class="value">${escapeHtml(p.processName || 'Unknown')}</span>
        </div>
        <div class="port-info-row">
          <span class="label">PID:</span>
          <span class="value">${p.pid || 'N/A'}</span>
        </div>
        ${p.commandLine ? `
        <div class="port-info-row">
          <span class="label">Command:</span>
          <span class="value">${escapeHtml(truncate(p.commandLine, 60))}</span>
        </div>` : ''}
      </div>
    </div>
  `).join('');
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

async function openInBrowser(appId) {
  const detected = state.detectedApps[appId];
  const app = state.apps.find(a => a.id === appId);
  const port = detected?.port || app?.preferredPort;

  if (port) {
    // Use correct host based on binding address
    // IPv6 bindings ([::1] or [::]) use localhost, IPv4 (0.0.0.0 or 127.0.0.1) use 127.0.0.1
    const address = detected?.address || '';
    const isIPv6 = address.startsWith('[');
    const host = isIPv6 ? 'localhost' : '127.0.0.1';
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
    }

    renderApps();
  } catch (error) {
    showToast('Failed to load apps: ' + error.message, 'error');
  }
}

function renderApps() {
  if (state.apps.length === 0) {
    dom.appsList.innerHTML = `<div class="empty-state">
      No apps registered. Click "Add App" to register your first app.
    </div>`;
    return;
  }

  dom.appsList.innerHTML = state.apps.map(app => {
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

    // Status text with IPv4/IPv6 indicator
    let statusText = '○ Stopped';
    let statusClass = 'status-stopped';
    if (detected) {
      statusText = `● Running :${detected.port} <span class="ip-version">${ipVersion}</span>`;
      statusClass = 'status-running';
    } else if (managedRunning) {
      statusText = '● Running';
      statusClass = 'status-running';
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

    return `
      <div class="app-card" data-id="${app.id}">
        <div class="app-info">
          <div class="app-name">
            <span class="app-color" style="background: ${app.color}"></span>
            ${escapeHtml(app.name)}
            ${badgesHtml}
          </div>
          <div class="app-meta">
            <code>${escapeHtml(app.command)}</code>
            ${portDisplay}
          </div>
        </div>
        <span class="app-status ${statusClass}">
          ${statusText}
        </span>
        <div class="app-actions">
          ${isRunning
            ? `<button class="btn btn-small btn-secondary" onclick="openInBrowser('${app.id}')" title="Open in browser">🌐</button>
               <button class="btn btn-small btn-danger" onclick="stopApp('${app.id}')">Stop</button>`
            : `<button class="btn btn-small btn-primary" onclick="startApp('${app.id}')">Start</button>`
          }
          <button class="btn btn-small btn-secondary" onclick="editApp('${app.id}')">Edit</button>
          <button class="btn btn-small btn-secondary" onclick="deleteApp('${app.id}')">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

async function startApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app) return;

  showToast(`Starting ${app.name}...`, 'success');
  
  const result = await window.portpilot.process.start(app);
  if (result.success) {
    showToast(`${app.name} started (PID: ${result.pid})`, 'success');
  } else {
    showToast(`Failed to start: ${result.error}`, 'error');
  }
  
  await loadApps();
}

async function stopApp(appId) {
  const result = await window.portpilot.process.stop(appId);
  if (result.success) {
    showToast('App stopped', 'success');
  } else {
    showToast('Failed to stop: ' + result.error, 'error');
  }
  await loadApps();
}

function editApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (app) openAppModal(app);
}

async function deleteApp(appId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app || !confirm(`Delete "${app.name}"?`)) return;

  const result = await window.portpilot.config.deleteApp(appId);
  if (result.success) {
    showToast('App deleted', 'success');
    await loadApps();
  } else {
    showToast('Failed to delete: ' + result.error, 'error');
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
  }
}

async function saveSettings() {
  const settings = {
    autoScan: document.getElementById('setting-autoscan').checked,
    scanInterval: parseInt(document.getElementById('setting-interval').value) * 1000
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
      'brutalist-light': 'Brutalist Light',
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
window.startApp = startApp;
window.stopApp = stopApp;
window.editApp = editApp;
window.deleteApp = deleteApp;
window.openExternal = openExternal;
window.openInBrowser = openInBrowser;
