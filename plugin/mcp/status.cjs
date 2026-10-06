/**
 * PortPilot shared status + classification model.
 *
 * The single source of truth for two questions the redesign depends on:
 *   1. classify(port)  -> which group does this port belong in? (dev / other / system)
 *   2. statusOf(item)  -> what runtime state is this row in, and how do we draw it?
 *
 * Pure, side-effect free, and loadable both as a CommonJS module (main process,
 * agent, tests via require) and as a browser global window.PortPilotStatus (the
 * renderer runs with nodeIntegration:false and cannot require). Keeping the logic
 * here means the desktop renderer, the VS Code extension, and the web portal all
 * agree on grouping and status instead of each re-deriving it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotStatus = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Status model -------------------------------------------------------
  // Six states, shape-differentiated so they survive greyscale, colour-blind
  // vision, and all themes. `token` is the per-theme CSS variable that carries
  // the colour; `shape` is the dot geometry the renderer draws; `ascii` is the
  // fallback for terminals that cannot draw the glyph. `error` is unhealthy but
  // alive; `crashed` is dead after an unexpected exit. The canonical table is
  // docs/ui-redesign/STATUS-VOCABULARY.md (a test keeps the two in step).
  const STATES = {
    running:  { state: 'running',  token: '--status-running',  shape: 'disc',       glyph: '●', ascii: '*', label: 'Running'  },
    stopped:  { state: 'stopped',  token: '--status-stopped',  shape: 'ring',       glyph: '○', ascii: 'o', label: 'Stopped'  },
    starting: { state: 'starting', token: '--status-starting', shape: 'disc-pulse', glyph: '◐', ascii: '~', label: 'Starting' },
    conflict: { state: 'conflict', token: '--status-conflict', shape: 'triangle',   glyph: '▲', ascii: '!', label: 'Conflict' },
    error:    { state: 'error',    token: '--status-error',    shape: 'circle-x',   glyph: '⊗', ascii: 'x', label: 'Error'    },
    crashed:  { state: 'crashed',  token: '--status-crashed',  shape: 'cross',      glyph: '✕', ascii: 'X', label: 'Crashed'  },
  };

  /**
   * Resolve a row's status descriptor.
   * Accepts either an explicit { state: 'running' } or a set of booleans
   * { running, starting, conflict, error, crashed }. Precedence, highest first:
   * crashed > error > conflict > starting > running > stopped.
   */
  function statusOf(item) {
    const it = item || {};
    if (it.state && STATES[it.state]) return STATES[it.state];
    if (it.crashed) return STATES.crashed;
    if (it.error) return STATES.error;
    if (it.conflict) return STATES.conflict;
    if (it.starting) return STATES.starting;
    if (it.running) return STATES.running;
    return STATES.stopped;
  }

  // ---- Group model --------------------------------------------------------
  const GROUPS = {
    dev:    { key: 'dev',    label: 'Dev Servers',      order: 0, defaultCollapsed: false },
    other:  { key: 'other',  label: 'Other User Ports', order: 1, defaultCollapsed: false },
    system: { key: 'system', label: 'System & OS Ports', order: 2, defaultCollapsed: true },
  };
  const GROUP_ORDER = ['dev', 'other', 'system'];

  // ---- Classification -----------------------------------------------------
  // Known OS / kernel-owned processes (lowercased, with and without .exe).
  const SYSTEM_PROCESSES = new Set([
    // Windows
    'system', 'system idle process', 'idle', 'registry',
    'svchost.exe', 'services.exe', 'lsass.exe', 'wininit.exe', 'winlogon.exe',
    'smss.exe', 'csrss.exe', 'spoolsv.exe', 'searchindexer.exe', 'searchhost.exe',
    'dwm.exe', 'taskhostw.exe', 'vmms.exe', 'vmwp.exe', 'vmcompute.exe',
    'wslservice.exe', 'msmpeng.exe',
    // macOS / Linux
    'launchd', 'systemd', 'systemd-resolve', 'systemd-resolved', 'rpcbind',
    'rpc.statd', 'rpc.mountd', 'mdnsresponder', 'cupsd', 'avahi-daemon',
    'dnsmasq', 'smbd', 'nmbd',
  ]);

  // Well-known OS service ports the user should never be invited to kill.
  const SYSTEM_PORTS = new Set([
    135,        // MS RPC endpoint mapper
    137, 138, 139, // NetBIOS
    445,        // SMB
    1900,       // SSDP / UPnP
    2179,       // Hyper-V VMConnect (vmms.exe)
    3702,       // WS-Discovery
    5353,       // mDNS / Bonjour
    5355,       // LLMNR
    5357,       // WSDAPI
    631,        // CUPS / IPP
  ]);

  // Dev runtimes / toolchains. Matched as whole words against process + command.
  const DEV_RUNTIME_TOKENS = [
    'node', 'nodejs', 'deno', 'bun', 'npm', 'npx', 'pnpm', 'yarn', 'nodemon',
    'vite', 'next', 'nuxt', 'astro', 'remix', 'webpack', 'rollup', 'esbuild',
    'parcel', 'turbo', 'ng', 'ember', 'gatsby', 'expo',
    'python', 'python3', 'uvicorn', 'gunicorn', 'hypercorn', 'flask', 'django',
    'fastapi', 'streamlit', 'php', 'artisan', 'ruby', 'rails', 'puma', 'unicorn',
    'dotnet', 'cargo', 'hugo', 'air',
  ];
  const DEV_RUNTIME_RE = new RegExp('\\b(' + DEV_RUNTIME_TOKENS.join('|') + ')\\b');

  // A dev runtime is treated as the user's work when it sits in the usual
  // dev-server port range. Registered apps are dev regardless of range.
  const DEV_RANGE_MIN = 3000;
  const DEV_RANGE_MAX = 9999;

  /**
   * Classify a scanned port into 'dev' | 'other' | 'system'.
   *
   * @param {object} port  { port, processName?, commandLine?, pid?, appId? }
   * @param {object} [opts] { registered?: boolean } - true if this port is
   *        matched to a registered app (overrides everything -> 'dev').
   */
  function classify(port, opts) {
    const p = port || {};
    const o = opts || {};
    const num = Number(p.port);
    const pid = p.pid;
    const proc = String(p.processName || '').toLowerCase().trim();
    const text = (proc + ' ' + String(p.commandLine || '')).toLowerCase();

    // A registered app always wins, whatever it is running on.
    if (o.registered === true || p.appId != null || p.registered === true) return 'dev';

    // OS-owned: by pid, by process name, or by well-known port.
    if (pid === 0 || pid === 4) return 'system';
    if (SYSTEM_PROCESSES.has(proc)) return 'system';
    if (SYSTEM_PORTS.has(num)) return 'system';

    // The user's dev work: a dev runtime in the dev port range.
    if (DEV_RUNTIME_RE.test(text) && num >= DEV_RANGE_MIN && num <= DEV_RANGE_MAX) return 'dev';

    // Everything else the user is running (databases, docker-proxy, unknown).
    return 'other';
  }

  // ---- Provenance ---------------------------------------------------------
  // Who started a running app. Stored per app in portpilot-runtime.json
  // (configFile.recordStart) by whichever surface started it, so every
  // surface shows the same answer. One vocabulary everywhere:
  //   human    -> "you"          (any surface)
  //   claude   -> "claude a3f2"  (short session id; full id in the title)
  //   external -> "external"     (found running, not started by PortPilot)
  const PROVENANCE_KINDS = ['human', 'claude', 'external'];
  const SURFACES = ['desktop', 'web', 'vscode', 'claude-code', 'mcp'];
  const CLAUDE_GLYPH = '✦';

  /** Build a validated startedBy record. Throws on an unknown kind or surface. */
  function makeStartedBy(fields) {
    const f = fields || {};
    if (!PROVENANCE_KINDS.includes(f.kind)) {
      throw new Error('startedBy.kind must be one of: ' + PROVENANCE_KINDS.join(', '));
    }
    if (!SURFACES.includes(f.surface)) {
      throw new Error('startedBy.surface must be one of: ' + SURFACES.join(', '));
    }
    const out = { kind: f.kind, surface: f.surface, at: f.at || new Date().toISOString() };
    if (f.sessionId) out.sessionId = String(f.sessionId).slice(0, 200);
    if (f.label) out.label = String(f.label).slice(0, 100);
    return out;
  }

  /** First 4 alphanumerics of a session id ("a3f2"), or '' if none. */
  function shortSession(id) {
    return id ? String(id).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase() : '';
  }

  /**
   * How to show a startedBy record: { kind, word, glyph, title }. `word` is the
   * text every surface shows; `glyph` is for tight spaces and is only set for
   * Claude (never rely on it alone). No record means "external".
   */
  function provenanceOf(startedBy) {
    const s = startedBy || null;
    if (!s || s.kind === 'external' || !PROVENANCE_KINDS.includes(s.kind)) {
      return { kind: 'external', word: 'external', glyph: '', title: 'Found running - not started by PortPilot' };
    }
    const when = s.at ? ` at ${s.at}` : '';
    if (s.kind === 'human') {
      return { kind: 'human', word: 'you', glyph: '', title: `Started by you from ${s.surface}${when}` };
    }
    const short = shortSession(s.sessionId);
    const session = s.sessionId ? ` (session ${s.sessionId}${s.label ? `, ${s.label}` : ''})` : '';
    return {
      kind: 'claude',
      word: short ? `claude ${short}` : 'claude',
      glyph: CLAUDE_GLYPH,
      title: `Started by Claude${session} via ${s.surface}${when}`,
    };
  }

  return {
    STATES,
    statusOf,
    PROVENANCE_KINDS,
    SURFACES,
    CLAUDE_GLYPH,
    makeStartedBy,
    shortSession,
    provenanceOf,
    GROUPS,
    GROUP_ORDER,
    classify,
    // Exposed for tests and future tuning.
    SYSTEM_PROCESSES,
    SYSTEM_PORTS,
    DEV_RUNTIME_RE,
    DEV_RANGE_MIN,
    DEV_RANGE_MAX,
  };
});
