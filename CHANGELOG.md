# Changelog

All notable changes to PortPilot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.0] - 2026-10-25

### Added
- **A new default interface.** PortPilot opens on a redesigned view built with React: a top bar with Home, Apps, Browsers, Ports and a More menu (Library views, Scenes, History), and Settings beside it. The older view is gone from the desktop app; the web portal still serves it.
- **Home.** Running apps as four-across preview tiles: click a tile to open the app, the three dots open its Details, a stop button sits bottom-right, and the name, port and start time show over a dimmed preview that brightens on hover (the app you used last, with a Start tile, when nothing runs), your browser profiles as pictures, and Recently used with a Start button on anything stopped or crashed. Running apps that have no picture get one captured from their page. A first run says what to do instead of showing empty cards.
- **Apps.** Every app as a card with a live preview of its page, as Rows or Cards, grouped or flat, with a fixed number of cards across for each window width. An app whose port another program holds is marked Port held. **Manage** switches the same screen to the editing table (Star, Start or Stop, Details, Edit, Groups, Add app, auto-detect).
- **Browsers screen.** Named browser profiles as cards with the site's own picture, port, mode and purpose; Start, Stop, Edit and history from one place. **Set up sign-ins** opens Brave's Sync or Import passwords page in the profile; PortPilot never reads saved passwords.
- **VS Code extension 4.0.6 (unreleased).** Browsers sits second in the sidebar, and a Browser Previews view is opt-in per profile.
- **Scenes.** Save a set of apps and browser profiles and start them together. Stop only stops what the scene started. Save what is running turns the current state into a scene.
- **Command palette.** `Ctrl+K` from anywhere: start, stop or open an app, free a port, or jump to an app's history.
- **Ports and Settings.** An app drawer with auto-detect, an inspector with Diagnose for crashed apps and a QR code for the LAN URL, a ports table with Kill, Open and Find a free port, and the settings in one place with a Dark, Light or System theme.
- **Blocked ports on the Alerts bell.** A count on the bell (sidebar and top bar) opens a list naming each app and what holds its port; Fix opens Ports. No banner over any screen.
- **Browser profiles remember when they were last used,** and Home orders them by it.

### Changed
- README and website lead with the new interface, with new screenshots taken over fictional demo apps (`docs/demo/fictional`).
- Plugin and MCP server versions move to 5.0.0 with the app. The 26 MCP tools are unchanged.

### Fixed
- The PortPilot icon is stamped into `PortPilot.exe`, so the installer, the portable build and the taskbar show it.

## [4.0.4] - 2026-10-18

### Added
- **Claude Code plugin: `status_line` option.** On by default, so nothing changes unless you turn it off. Off, the plugin draws no status line; the start guard, crash band, inbox and MCP tools work as before. Set it on the install screen or in `/config`.

### Fixed
- **MCP server: an app's own port wins over a fuzzy name match.** Two apps whose paths shared a word could swap ports, so one read as stopped. Matching now checks the folder in the command line, then `preferredPort`, then keywords.

## [4.0.3] - 2026-10-17

### Fixed
- **Diagnose now reaches apps that die at launch.** An app that exits within the start window (a missing module or config, a bad command) used to give a one-line "Failed to start" toast with no Diagnose button. It now raises the same crash toast as any crash, with Restart, Logs, Diagnose and Ask Claude, and the row reads Crashed.
- **Diagnose answers are formatted.** Code blocks and `inline code` render as code instead of showing raw backticks and fences.

## [4.0.2] - 2026-10-16

### Added
- **Diagnose, inside the app.** The crash toast has a Diagnose button that runs a read-only Claude Code session on the crashed app and shows the cause, the evidence and the fix in a panel, with Cancel. It uses your own installed Claude Code and its sign-in (or `ANTHROPIC_API_KEY`), so PortPilot never handles a credential. Claude can only read files (Read, Grep, Glob); keys and passwords in the crash output are masked before it is sent, and the first use asks for your consent. No Claude Code installed or not signed in shows a clear message. Ask Claude (hand the crash to a live session) is unchanged.

### Fixed
- **start_app checks the port the command pins.** A command with `--port 3007` (or `-p 3007`) is verified on 3007 even when the app's preferred port says 3002, so a healthy start is no longer reported as "port never came up".

## [4.0.1] - 2026-10-16

### Fixed
- **Running home at scale.** With more than 8 ready apps the page-preview tiles become quiet one-line rows, so 51 apps no longer fill the screen with big green Start buttons.
- **Sidebar logo** is the real PortPilot porthole mark, not a placeholder.
- **Empty groups** are dimmed and no longer show a "No apps in this group" line.

## [4.0.0] - 2026-10-16

### Changed
- **New look: graphite and mint, with a left sidebar.** Running, Needs attention, Apps, Ports, Browsers and History are sections in a sidebar (a bottom bar at phone width) with live counts and a health dot. The Running home puts what needs you first: a blocked strip with the fix on the button (Use :3008 instead, Stop solaisoft and start), then crashed apps, then page-preview tiles for what is up.
- **Apps and Ports.** Apps are grouped with worktrees nested, and an inspector docks beside the list. Ports lists every listener with its owning app, split into dev, other and system, with a second click to kill.
- **Browsers and History** are ledger rows: one line per profile or run, mode switch in mint, filters on one line at phone width.
- **Settings and dialogs** are one card. **Theme is Auto, Light or Dark.** The six older themes are retired; a saved older theme reads as Auto and is not overwritten.
- The crash toast and the Ctrl+K palette take the new colours with no behaviour change.
- README and website screenshots and demos show the new UI.

### Notes
- **Back to the old UI for one release:** open the app with `?ui=v3` (web) or set `portpilot-ui` to `v3` in local storage. `?ui=v4` returns. The switch is removed in the next release.
- The web portal stays on the old layout for now. The VS Code extension has no UI change.
- Ask Claude on a crashed app row (outside the crash toast) is not in the new UI yet.

## [3.9.1] - 2026-10-15

### Added
- **+ Add profile in the VS Code Browsers view.** A + in the view title adds a browser profile (name, port pre-filled with the next free one, optional purpose); **Remove** is in the profile menu and asks first. A running profile must be stopped first, and a removed profile's folder and sign-ins stay on disk. The desktop Browsers tab button now reads **+ Add profile**.

### Fixed
- The Windows exe carried the default Electron icon, so the installed app, its shortcuts and the taskbar showed it. The build now embeds the PortPilot logo.

## [3.9.0] - 2026-10-15

### Added
- **Now running strip.** The home screen opens on a strip of cards, one per running or detected server: a 16:9 page preview, name, port, branch, a Claude mark when a Claude session owns it, uptime, and Open, Details and Stop. A server with no preview says "No preview yet", "IPv6 only" or "Previews are off". At 390 px the strip is a swipe row.
- **Home hierarchy.** The strip comes first, then an "Other apps" list, then one collapsed "Everything listening" row.
- **Home layout setting.** **Settings > Home layout** chooses Preview strip (the default) or Classic list. A saved choice always wins, so only fresh settings move to the strip.
- **Ctrl+K command palette** (desktop app only; the web portal omits it). Start, stop or open an app, show History for an app, free a port (a second Enter confirms), start or stop a browser profile, go to a tab, scan, or add an app.
- **The header is the title bar on Windows.** No menu band and no OS title bar. F12, Ctrl+Shift+I, F11 and Ctrl+=, Ctrl+-, Ctrl+0 still work; Ctrl+R stays Scan.

### Changed
- History and Browsers rows use the card radius and elevation of the active theme.
- Detected and claimed chips match the chip on the strip cards.
- Port rows have five fixed action slots; the ghost buttons show on hover or keyboard focus.

### Fixed
- Copy and Kill on a port row were cut off at 390 px.
- The web portal returned 404 for `core/nowStrip.js`.

## [3.8.2] - 2026-10-14

### Added
- **A browser profile can say what it is for.** New optional fields `purpose` (a short phrase) and `sites` (hostnames) on a browser profile, edited in the Browsers tab and shown in the row. `start_browser` takes `for` (free text or a URL) and starts the profile whose sites, name, purpose, note or start URL fit; `list_browser_profiles` takes `for` as a ranked filter. `NO_MATCH` names the profiles that exist and tells Claude to ask you; `AMBIGUOUS` lists the candidates when the top two are close; neither starts anything. PortPilot has no built-in knowledge of any site: it matches only the words and hostnames you gave the profile.
- **Claude is told about your profiles at the start of a conversation.** The plugin adds a short note (one line per profile: name, port, mode, purpose, sites; at most 25 profiles and 2 KB; no folder paths, URL queries or long notes) so "access Google Search Console" routes through `start_browser` `for` with no port chosen. Nothing is added with no profiles, and an unreadable config adds nothing.
- **A saved window and keep in front for headed profiles.** An optional `window` (left, top, width, height, keep in front) in the edit form, with **Capture current position**, which reads the running browser's real window. A headed start applies it and reports `window: { requested, actual, applied }`; keep in front also raises the page on every start or reuse, and on Windows makes the window always-on-top (best effort; other systems get position, size and bring-to-front only).

### Changed
- `start_browser` with `name: "any"` is documented as a throwaway browser with no logins, never for a task tied to a site, and the `IN_USE` advice no longer points a site task at it.

## [3.8.1] - 2026-10-14

### Fixed

- A detected server started as `node server.js`, `python app.py`, `python -m pkg` or `php -S` (a relative script, so no folder on its command line) now gets its project folder: the first of a live Claude session's folder (and its git root / parents), a registered app's folder, or a recent run's folder that actually holds the file. Two folders that cannot be told apart leave it unknown. The run is named after the folder and can be started again.

## [3.8.0] - 2026-10-13

### Added
- **Every localhost dev server is tracked.** The desktop app scans every 10 s and records any server on this machine, whoever started it (a terminal, Claude, an editor), in the History tab with a page preview, as a run marked `detected`. A server must answer HTTP on two scans in a row to count and its port must be gone for two scans to close it; a server that restarts within 60 s keeps its run. Browsers, editors, agents, MCP servers, language servers, Node inspector ports, databases and PortPilot itself are never recorded. A server a registered app owns is left to that app while PortPilot started it; one started outside PortPilot (an agent, a terminal) is recorded under the registered app, so its row, History entry and preview line up. A detected server with no project folder is labelled by its page title once it has one, instead of its raw command. Turn it off under **Settings > Run history > Track every localhost server**.
- **Start again.** A closed detected run with a known start command and a project folder that still exists gets a **Start again** button: it registers (or reuses) an app for the folder on the same port, starts it like any other app and opens the page once it answers. The registration step is `src/core/runApp.js`, shared with the VS Code extension.

- **Browser history.** Every browser profile start and stop is recorded in `history/browser-runs.json` (500 entries by default) with who did it and the tabs that were open: sampled about every 30 s while the browser runs, and once more at stop. Only the URL and title are stored, and secrets are hidden first: userinfo is dropped and the value of any query or fragment parameter named like a secret (token, key, code, auth, session, password and similar) becomes `***`. The Browsers tab has a **History** expander under each profile with an **Open again** button that starts the profile and opens its pages (http and https only, at most 20). New MCP tool `browser_history` (profile, since, limit; the same route on the web agent), 26 tools in all.
- **Tested in.** A dev-server run a browser profile had a tab on (`localhost:<port>` or `127.0.0.1:<port>`) is stamped `testedIn: [{ profile, at }]`, and its History row reads `tested in <profile>`. Best effort, from the same sampling.
- **Browser profile leases.** A profile started by a Claude session is leased to it while its heartbeat is live. Another session that names itself gets `IN_USE` from `start_browser` and `stop_browser` (the owner, when it started, and what to do next) instead of silently sharing the browser; `list_browser_profiles` shows `leasedTo` and `free`; `start_browser` with `name: "any"` picks a free profile (or returns the one the session holds). `takeover:true` overrides after telling the user. A caller with no session id (the desktop app) is never refused, and a lease whose owner has gone quiet is free.

### Changed
- Run history keeps 1000 runs by default (was 500) so a week of auto-tracked dev servers stays browsable. The 150 MB cap is unchanged; thumbnails are about 20-40 KB each.

## [3.7.0] - 2026-10-13

### Added
- **Browsers tab.** Named browser profiles for automated sessions (Chromium family: Chrome, Edge, Brave, Chromium, Opera, Vivaldi). A profile is a name, a debug port, a browser, a mode (headed, offscreen, headless), a start URL and a note. Start, stop, change mode, edit, Duplicate (settings and extensions only; cookies and passwords are never copied), Extensions list, Remove (the folder stays on disk). A port held by another process reads "Port held" and names the holder; PortPilot never kills it. Each profile keeps its own folder, so sign-ins stay separate.
- **Five MCP tools for browser profiles**, 25 tools in all: `list_browser_profiles`, `list_browsers`, `start_browser`, `stop_browser`, `set_browser_mode`. The same tools are served as `POST /api/browser/<tool>` on the web agent, with an advisory marker for who holds a profile (it never blocks).
- **Hover a row preview to enlarge it.** The 32 x 18 px page preview on running Apps rows now opens a 256 x 144 px popover on hover or keyboard focus. Row height never changes; Escape closes it; **Show page previews on running apps** turns both off.
- **End-to-end checks and a scenarios list.** `npm run test:e2e` drives the real desktop app against a throwaway config; `docs/SCENARIOS.md` lists what each recurring check proves.

### Fixed
- The VS Code extension and the MCP server no longer show an app as Running because a browser, an editor or Claude holds a port and its command line mentions the project. Found on a real machine: a Brave debug port read as "Solaisoft Running", `Code.exe` as "SSF Site".
- A crash ends the "Starting" countdown. An app that exits before opening its port read "Starting" for about 13 s after the crash toast; it now reads "Crashed exit N" at once, and a Restart shows "Starting" for the new run.
- The web portal no longer shows History and Browsers tabs it cannot serve, and its console is clean on load.
- At 390 px wide the header search box is on its own row and its placeholder is readable.
- An app PortPilot started with a relative command (`node server.js --port N`, `npm start`) is no longer reported as blocked by its own server.

## [3.6.0] - 2026-10-10

### Added
- **Page previews on the Apps tab.** A running app's row (parent and worktree rows) shows a 32 x 18 px thumbnail of its page, taken from the thumbnail PortPilot already captured for its open run. It reuses the History tab's capture and IPC, opens no extra window and does not make rows taller. Stopped apps show none, and rows without a thumbnail look as before. Hidden at phone width. **Settings > Show page previews on running apps** turns it off.

### Documentation
- README "Ways to use PortPilot": one paragraph and image each for the desktop app, web portal, VS Code extension and Claude Code. Images come from the committed scripts in `docs/demo/tools/` (`desktop-shots.mjs`, `web-shot.mjs`, `claude-shots.mjs`) on the fictional demo seed.

## [3.5.0] - 2026-10-09

### Added
- **Run history.** Every start, stop and crash writes a local run record. A dirty tree, untracked files included, is snapshotted to `refs/portpilot/runs/<id>` through a temporary index, so the real index and branches never move. Runs are pruned at 500 runs or 150 MB; pinned runs (at most 50) never prune. History is best-effort: a failure never fails a start, stop or crash record.
- **`find_run` MCP tool (tool 20).** Claude looks up a past run by app, branch, SHA, file or date and gets the literal steps to get that version back.
- **Observe, don't take over (dev-server guard).** A certain dev-server start in an unregistered directory runs as typed. If a port appears within 2 minutes, the guard asks Claude once to register it through `add_app` (`registeredBy: observed`, idempotent by directory). Observed apps are guarded against busy ports but never routed. `settings.autoRegister` turns it off.
- **History tab in the desktop app.** Lists every recorded run with a page thumbnail, state word, branch, SHA and dirty-file count. Search by app, branch, file or SHA; filter by app, branch, date range or dirty only; Open URL is enabled only while that run is up; Copy SHA; Pin. The footer shows run count and size against the cap.
- **Re-run this version.** Recreates a run's commit and uncommitted files in a sibling worktree (`<repo>-run-<id>`), installs from the lockfile, registers it under the original app and starts it on a free port (`--port N` is rewritten, otherwise `PORT` is set). The new run records `rerunOf`. It refuses by name when the repo is gone, the snapshot was pruned or the run had no git state.
- **Page thumbnails.** A hidden offscreen window renders each live run's page once and stores a 480 px JPEG. It never leaves localhost and never stays open.
- **Weekly orphan sweep** removes thumbnails and `refs/portpilot/runs/*` refs whose run no longer exists.

### Changed
- **`start_app` and `bulk_start` leave an app alone when its port is already listening**, so a second call cannot record a run for a process Claude never launched.

## [3.4.0] - 2026-10-07

### Added
- **Claude Code plugin.** `plugin/` ships a bundled PortPilot MCP server (no `npm install`), a `portpilot` skill, and a mod with a status line (`⚓ 3 up · :3000 web`, worst state first) and a dev-server guard: a Bash command that would start a dev server on a busy port is denied with "reuse :3000", and a clean start is routed through PortPilot. When the guard cannot tell what a command does, it lets it run.
- **Crash alerts.** A crashed app raises a sticky toast with Restart, Logs and Ask Claude. Ask Claude appears only when the Claude Code session that started the app is live, and hands it the crash with the stderr tail. In that session the plugin shows a crash band with Restart, Logs and Fix it. Repeat crashes group into one toast.
- **Row state on every app.** Each row says what state the app is in, why, for how long and who started it (`● Running 2h · claude`). Crashed apps read `✕ Crashed · exit 1` instead of looking stopped. The VS Code tree and status bar use the same states.
- **Who started each app.** Starts are stamped with `startedBy`: you or a Claude Code session, and from which surface. Every surface reads the same record.

### Changed
- **Port conflicts are a labelled strip on the row**, with Use free port, Kill & start and Show process, in place of the old `confirm()` dialogs. Kill asks for a second click.

### Fixed
- **Port-conflict toasts no longer repeat.** Auto-scan toasted every standing conflict every few seconds, stacking toasts over the Dev Servers buttons. A conflict is now announced once; the row strip carries it after that.
- **Crashed means crashed everywhere.** Stopping an app by port, or quitting PortPilot, no longer marks it as crashed.
- **Moving an app between groups** no longer overwrites changes made elsewhere since the app list loaded.
- **App names no longer vanish at phone width.**
- **Windows:** removed `wmic` fallbacks; `wmic` is gone from recent Windows 11.
- **MCP server:** all 9 npm audit advisories patched.
- **Config changes from different tools no longer overwrite each other.** The desktop app, web agent, MCP server and VS Code extension all write `portpilot-config.json`. Each used to read it, change it in memory and write the whole file back, so two writers at once dropped one change. The VS Code extension held its copy open across edit prompts, which made this likely. Every write now takes a lock file, re-reads the file and replaces it atomically (temp file + rename), so a crash mid-write can no longer leave a truncated config. An unparseable config is copied to `.corrupt-<time>` before anything overwrites it.

## [3.3.2] - 2026-10-06

### Fixed
- **The desktop app's MCP server starts from an installed build.** Release builds bundled `mcp-server/index.js` without its `node_modules` (electron-builder only warned), so the MCP server the app runs on `127.0.0.1:8788` could not load its SDK. Builds now install those dependencies, and a packaged-build smoke test blocks any release where the bundled server fails to start. This also means the 3.3.1 Host/Origin fix now reaches installed users.

### Changed
- **Electron 27 -> 44.** Electron 27 is out of support. No behaviour changes are intended.
- CI now runs the unit and MCP tests and an unpacked package build on Windows and Linux for every pull request.

## [3.3.1] - 2026-10-05

### Security
- **MCP HTTP mode refuses DNS rebinding and cross-origin calls.** While the desktop app runs it serves the MCP server on `127.0.0.1:8788`, which checked neither `Host` nor `Origin`. A web page could rebind a hostname to loopback and call `add_app` + `start_app` to run any command. It now applies the same Host/Origin allowlists as the web agent; MCP clients such as Claude Code are unaffected. Update if you run the desktop app.

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
