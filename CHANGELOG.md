# Changelog

All notable changes to PortPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.0] - 2026-07-01

### Added
- **Port reservation** - opt in per app to hold its `preferredPort` with a lightweight placeholder socket while the app is stopped, so nothing else can take it. Released the instant the app starts (so the real server can bind) and re-acquired on stop/crash. Toggle in the detail drawer; reserved apps show an `R` badge.
- **Health checks** - running apps are probed on the loopback address and shown as healthy (2xx/3xx), not responding (an amber pulsing dot using the previously-unused error state), or down. Optional per-app health path (default `/`).
- **Conflict resolution** - when an app's preferred port is squatted, resolve it inline: kill the blocker and start, or start on the next free port (without changing the saved port).
- **Framework auto-detect** - Add-App suggests the conventional dev port for Next, Nuxt, Astro, SvelteKit, Gatsby, Remix, Vite, CRA, Vue and Angular when no explicit port is configured.
- **Stack presets** - Start all / Stop all for a whole group in one click.
- **Crash notifications** - an OS notification + in-app toast when a running app exits unexpectedly (deliberate stops stay quiet). New `notifyOnCrash` setting (default on).
- **Share to phone** - copy an app's local or LAN URL, or scan a QR code, to open it on a phone on the same network. QR is generated server-side as a `data:` URL (no external calls). Adds the `qrcode` dependency.
- **Light theme + Auto** - a crisp GitHub-style Light theme and an Auto option that follows the OS light/dark setting and updates live.

### Changed
- Retired the Brutalist Dark and Solarized Light themes; saved preferences migrate automatically (`brutalist-dark` → `tokyonight`, `solarized-light` → `light`).

## [3.2.0] - 2026-07-01

### Added
- **Branch & worktree awareness** - run several git branches/worktrees of one project at once, each on its own port, nested under the parent project and colour-coded to match its VS Code (Peacock) window.
- **Add worktrees** - detect a repo's git worktrees (`git worktree list`) and bulk-add the unregistered ones, reading each one's Peacock colour from `.vscode/settings.json`.
- **`add_worktree` MCP tool + `register-worktree` CLI** - register a worktree under its parent in one call (19 MCP tools total).
- **Detail drawer** - clicking a row opens a slide-over with full command, cwd, PID, uptime and branch, plus Start/Stop/Open/Copy/Add-branch/Remove. Denser rows with hover-revealed actions; ports and requirements as chips.
- **Stale-worktree pruning** - a branch whose folder is gone is flagged `STALE` and one-click removable.
- **VS Code extension parity** - branches nest in the tree; Active Ports grouped into Dev / Other / System with kill gated off system-owned ports.

## [3.1.0] - 2026-06-08

### Added
- **Web portal, hosted from VS Code** - the VS Code extension can now host the web portal itself via `portpilot.webPortal.enabled` (opt-in, off by default). The browser UI runs whenever the editor window is open, with no desktop app: the extension spawns the hardened loopback agent using the editor's own Node and shows a "PP Portal" status-bar item that opens it. Stopping is graceful over an IPC channel (signals are unreliable on Windows), and the agent self-exits if the editor host closes, so it does not orphan.
- **`portpilot.webPortal.stopAppsOnStop`** (opt-in, off by default) - when the portal stops, also stop the dev servers it started.

## [3.0.0] - 2026-06-08

### Added
- **Web Agent (browser access)** - run the full PortPilot UI in a browser with no Electron, via `npm run agent` or the opt-in "Web Access" toggle in Settings. Embedded in the desktop app it runs in-process, sharing the same config and process table, so apps started in the browser and on the desktop are the same.
- **SSE live updates** - external config changes (including MCP edits) push to the browser in real time via `/events`.
- **Auto-port-fallback** - the web agent picks the next free port from 7317 if the default is taken, instead of failing.
- **App log viewer (desktop)** - running apps get a "logs" button that streams captured stdout/stderr.
- **6 new MCP tools** - `get_status`, `check_port`, `bulk_start`, `bulk_stop`, `list_groups`, `move_to_group`.

### Changed
- **Unified config path** across the desktop app, MCP server, VS Code extension, and web agent (shared `core/configPath.js`), so all clients read the same file on every platform.
- **Two-phase running detection** in every client - apps started on a dynamic or non-preferred port are now detected by command-line CWD match, instead of always reading "stopped".
- **Honest MCP start/detection** - `start_app` polls for the port before reporting success; `bulk_start` runs concurrently.
- Dropped `wmic` (deprecated/removed on recent Windows 11) for PowerShell/CIM plus a single batched `tasklist` lookup.
- Window auto-resize is now opt-in (Settings), default off.

### Fixed
- **Config data loss** - editing or starring an MCP-added app no longer drops fields like `description` and `startupDelay` (`saveApp` now merges onto the existing record).
- **Locale-independent `killPort`** in the MCP server and VS Code extension (the "LISTENING" match failed on non-English Windows).
- **VS Code extension running detection** - the apps tree and "PP: N running" counter now use the same two-phase matcher as the desktop app, so an app on a non-preferred port shows its live port and running state.
- Live auto-scan (desktop) now honours the `autoScan`/`scanInterval` settings instead of scanning only once at startup.

### Security
- **Hardened loopback web agent** - binds `127.0.0.1` only, per-session 256-bit token (constant-time check), Host-header allowlist (DNS-rebinding defence), Origin allowlist + locked CORS, preflight-forcing custom header, 1 MB body cap, path-traversal guard, and `agent.json` written `chmod 600`. Full threat model in `SECURITY.md`.
- **Strict CSP** - removed `script-src 'unsafe-inline'` by converting the inline handlers to delegated `data-act` listeners, closing the main XSS to code-execution vector.

## [2.0.0] - 2026-04-14

### Added
- **Single-Pane Layout** - Removed 4-tab system, unified apps and ports in one scrollable view
- **Settings Slide-out Panel** - Right-edge panel with backdrop blur replaces Settings tab
- **SVG Icon System** - 21 inline SVG icons replace all emoji (play, stop, browser, folder, trash, edit, star, gear, search, plus, close, more, plug, copy, refresh, grip, chevron, docker, kill, home, globe)
- **Glassmorphism Cards** - `rgba(255,255,255,0.03)` background with `backdrop-filter: blur(12px)`
- **Glass Theme** - 7th theme with extra transparency
- **Global Search** - Header search bar filters both apps and ports simultaneously
- **MCP v2.0** - Rewritten with McpServer high-level API and Zod schemas on SDK 1.29.0
- **6 New MCP Tools** - `get_status`, `check_port`, `bulk_start`, `bulk_stop`, `list_groups`, `move_to_group`
- **VS Code Status Bar** - "PP: N running" counter with click-to-refresh
- **VS Code Groups** - Apps grouped under collapsible folder nodes in tree view
- **VS Code Full CRUD** - Add, edit, delete apps, change ports, toggle favourites from sidebar

### Removed
- Knowledge tab (13 help sections moved to GitHub docs)
- Quick Add modal (normal Add App modal is sufficient)
- Header subtitle "Localhost Port Manager"
- 4-tab navigation system (replaced by single-pane)

### Changed
- App cards redesigned: status dot + drag handle + name + port (cyan mono) + star + actions
- Running apps show memory, uptime, PID inline on cards
- Codebase reduced 28%: 5,148 to 3,706 lines across renderer files
- MCP SDK updated from 0.5.0 to 1.29.0

## [1.4.0] - 2026-01-06

### Added
- **🔍 Project Auto-Discovery** - Automatically scan directories to discover development projects
  - User-configurable scan paths in Settings → Project Discovery
  - Smart detection for Node.js, Docker, Python, and Static sites
  - Extracts project metadata (name, command, port) automatically
  - Confidence scoring (95% match, 85% match, etc.)
  - Modal UI shows discovered projects with "Add" or "Add All" options
  - Filters out already-registered apps to avoid duplicates
  - Supports scan depth configuration (1-5 levels)
  - Caches results for 5 minutes for performance

- **🔍 Browse & Auto-detect Project** - One-click project setup from any directory
  - New button in Add App modal to browse and auto-detect projects
  - **Recursive subdirectory scanning** (up to 2 levels deep)
  - Automatically finds projects in parent folders (e.g., select `C:\Scratch\Project` finds `manual-build/` inside)
  - Smart sorting: prefers high-confidence matches and shallower paths
  - Ignores build folders (node_modules, .git, .next, dist, etc.)
  - Auto-fills all form fields (name, command, working directory, port)

- **📦 Package Manager Detection** - Auto-detect now uses the correct package manager
  - Detects `pnpm`, `yarn`, or `npm` from `packageManager` field or lock files
  - Generates proper commands: `pnpm run dev`, `yarn dev`, `npm run dev`
  - **No more "command not found" errors** from raw script extraction
  - Works with Turborepo, monorepos, and multi-package projects

- **⚠️ Unknown Port Conflict Warnings** - Know when unknown processes block your app ports
  - Toast notifications when registered app ports are occupied by unknown processes
  - Shows process name and PID for blocked ports
  - "⚠️ Port Blocked" status badge on affected app cards
  - **🌐 Globe button** to preview what's running on the blocked port
  - **Kill Blocker button** to terminate the blocking process
  - Warnings limited to 3 at a time to avoid spam

- **⭐ Favorites System** - Star your most-used apps for quick access
  - Star (⭐/☆) button on each app card
  - Apps organised into collapsible sections:
    - **⭐ Favorites** - Starred apps at the top
    - **📁 Other Projects** - Non-starred apps below
  - Section collapse state persists across app restarts
  - Smooth expand/collapse animations
  - Click section headers to toggle visibility

- **🗑 Delete All** - Bulk delete all apps with one click
  - "Delete All" button in My Apps toolbar
  - Strong confirmation modal with app count
  - Warns that action cannot be undone
  - Reminds user to export config first
  - Clears all apps in one operation

### Improved
- **Port Matching Algorithm** - Much more accurate detection of running apps
  - **Two-phase matching** with stricter validation:
    - Phase 1: High-confidence CWD (working directory) matches
    - Phase 2: Requires CWD match OR strong app name keywords in command/process
  - **Keyword extraction** from app names (e.g., "AzurePrep" → ["azure", "prep"])
  - **No more false positives** - apps only match if there's strong evidence
  - Tracks unknown conflicts separately from confident matches

- **Port Detection** - Only uses explicit configuration, no more framework defaults
  - Removed hard-coded framework defaults (no more "everything gets port 3000")
  - Checks package.json scripts for `--port` or `PORT=` flags
  - Checks vite.config.js/ts for explicit port configuration
  - Checks .env/.env.local for PORT environment variable
  - Returns `null` if no explicit port found (user assigns manually or uses Find Free)
  - StaticSiteDetector no longer hard-codes port 8080

- **Find Free Port** - Avoids ports already registered to other apps
  - Now checks both system availability AND registered app ports
  - Loops through candidates to find truly unique ports
  - Prevents duplicate port assignments when multiple apps need ports

- **My Apps Tab**
  - App cards now support favoriting with instant visual feedback
  - Port conflict warnings with globe and kill buttons
  - Better organisation with expandable/collapsible sections
  - Section headers show app count (e.g., "⭐ Favorites • 3 apps")
  - Improved toolbar layout with grouped action buttons

- **Settings Tab**
  - New "Project Discovery" section with scan path management
  - Visual list of configured scan paths with remove buttons
  - Empty state messaging when no scan paths configured
  - Max scan depth configuration (1-5 levels)
  - Auto-scan on startup option (disabled by default)

### Technical
- Created `projectScanner.js` with intelligent detector classes:
  - `NodeDetector` - Detects package.json, extracts scripts and port with package manager awareness
  - `DockerDetector` - Parses docker-compose.yml for services and ports
  - `PythonDetector` - Identifies FastAPI, Flask, Django projects
  - `StaticSiteDetector` - Finds standalone HTML sites
- Enhanced `matchPortsToApps()` with two-phase algorithm and keyword extraction
- Added `detectProject()` function with recursive subdirectory scanning (maxDepth: 2)
- Added `shell:browseDirectory` and `discovery:detectProject` IPC handlers
- Added `unknownConflicts` tracking to port matching results
- Added `isFavorite` field to app config schema
- Added favorites section state to settings (favoritesExpanded, otherProjectsExpanded)
- Refactored `renderApps()` to support section-based rendering
- Added `showUnknownConflictWarnings()`, `killConflictingProcess()`, `openPortInBrowser()` functions
- Added `browseAndAutoDetect()` function for one-click project setup
- Enhanced `findFreePort()` to check registered app ports
- 315+ lines of new CSS for modals, sections, badges, animations, and conflict warnings

### Files Changed
- **New**: `src/main/projectScanner.js` - Project detection engine (423 lines)
- **Modified**: `src/main/ipcHandlers.js` - Enhanced port matching, added browse/detect handlers
- **Modified**: `src/main/preload.js` - Added browseDirectory() and detectProject() APIs
- **Modified**: `src/renderer/renderer.js` - Conflict detection, auto-detect UI, enhanced findFreePort()
- **Modified**: `src/renderer/index.html` - Browse & Auto-detect button
- **Modified**: `src/renderer/styles.css` - Conflict warnings, auto-detect button styling
- **Modified**: `package.json` - Version bump to 1.4.0

## [1.3.0] - 2026-01-05

### Added
- **DevTools Setting** - Toggle to open DevTools on startup (dev mode only)
- **Process Cleanup** - Automatic cleanup after failed app starts (no more ghost "already running" errors)
- **Port Conflict Detection** - Pre-flight check and resolution dialog for port conflicts
- **Smart Startup Delay** - Visual countdown display when starting apps
- **Refresh Button** - Manual refresh for app status in My Apps tab
- **App Configuration Editing** - Add and delete apps via UI
- **Screenshot Automation** - `npm run screenshots` command for UI documentation
- **Test Infrastructure** - Test servers for 100% comprehensive test coverage

### Improved
- **Port Cards**
  - Increased padding from 8px/12px to 12px/16px for better breathing room
  - Port numbers enlarged from 1.25rem to 1.5rem for faster scanning
  - Labels (PROCESS, PID, COMMAND) now use text-secondary with 75% opacity (2x more readable)
  - Long command paths now use ellipsis truncation instead of awkward breaks
- **My Apps Tab**
  - STOPPED status badges now clearly visible (text-secondary with 80% opacity)
  - App metadata (command + port) improved visibility (text-secondary with 85% opacity)
  - App count badge ("11 apps • 5 running") larger and more prominent
- **Typography**
  - Better font weight hierarchy throughout
  - Consistent opacity levels for secondary text (75-85%)
  - Improved contrast across all themes

### Fixed
- AzurePrep monorepo configuration (npm run web instead of npm start)
- Process manager cleanup to prevent zombie process entries

### Testing
- 100% test coverage on core functionality (11/11 tests)
- 100% test coverage on v1.3.0 features (9/9 tests)
- Total: 20/20 tests passing

## [1.2.0] - 2025-12-XX

### Fixed
- Port kill functionality (critical fix)
- Port kill test now passing (11/11 comprehensive tests)

### Added
- Test for port kill functionality

## [1.1.0] - 2025-12-XX

### Added
- Initial comprehensive E2E test suite
- 11 core functionality tests covering:
  - Window and UI initialization
  - Port scanning and detection
  - Port filtering
  - Port card display
  - Copy to clipboard
  - Tab navigation
  - Settings access

### Features
- User guide and documentation
- Organized script structure
- Improved port matching logic

## [1.0.0] - 2025-12-XX

### Added
- Initial release
- Port scanning for localhost apps
- App management (start/stop)
- Multiple theme support (TokyoNight, Brutalist Dark/Light, Nord, Dracula, Solarized)
- System tray integration
- Auto-scan functionality
- Configurable scan interval
- Add/edit/delete app configurations

---

## Release Schedule

- **v2.0.0** - April 14, 2026 (Current)
- **v1.7.0** - March 25, 2026
- **v1.6.2** - March 21, 2026
- **v1.5.0** - January 10, 2026
- **v1.4.0** - January 6, 2026
- **v1.3.0** - January 5, 2026
- **v1.2.0** - December 2025
- **v1.1.0** - December 2025
- **v1.0.0** - December 2025

## Upgrade Guide

### From v1.2.0 to v1.3.0

No breaking changes. Config file will be automatically updated with new settings:
- `openDevTools` setting added (defaults to `false`)

All existing configurations remain compatible.

---

**Note**: For detailed testing information, see [TESTING_SUMMARY.md](TESTING_SUMMARY.md)
