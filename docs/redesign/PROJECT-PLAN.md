# PortPilot UI redesign: brief and plan

> **Baseline note (2026-10-24):** the brief was drafted against a stale local checkout (v3.9.0). `origin/master` is v4.0.4, where the "v4" UI (sidebar shell: Running, Needs attention, Apps, Ports, Browsers, History; `home.js`, `sidebar.js`, `inspector.js`, `styles-v4.css`; ?ui=v3 fallback; web portal pinned to v3) is the default. The screen recording most likely shows v4, which this plan replaces. Reviewer blockers (portal serves `src/renderer`, packaging `files`, `main.js` loadFile, palette `VIEWS`) were re-checked and still hold on v4. Prior v4 design notes: `docs/ui-v4/`, `docs/ui-redesign/`.

Direction chosen 2026-10-24: **A (Night top-bar)**, borrowing B's full-bleed brand gradients for browser profile cards. Mock-ups: `docs/redesign/mockup.html` (A), `mockup-b.html`, screenshots `a1-3.jpg`, `b1-3.jpg`. Comparison: https://claude.ai/artifact/WnmNuWP2E1Nor9D8bFjnDa

## Brief

- **Audience:** Macdara, running 100+ local apps and ~15 Brave profiles; Claude sessions use the same data over MCP.
- **Two jobs on the first screen:** see and open localhost previews; start and sign in to a dedicated browser profile.
- **Home:** two large entry tiles (Localhost, Browsers) with live mini-previews and counts, a Recent strip, one slim warning banner.
- **Top bar:** Home / Localhost / Browsers segmented control, Ctrl+K search (kept), History icon, Settings icon, Add.
- **Views (both galleries):** gallery, compact, list with thumbnail, grouped.
- **Localhost card:** auto-refreshing screenshot, hover live capture, status dot, port, branch, badge for conflicts, Open/Stop on hover. Stopped apps show the last screenshot dimmed.
- **Browser card:** brand hero (auto-fetched logo + og:image, manual override), account chips (labels only, no passwords), health (signed in / expired / signed out via CDP cookie check), lease line with Release.
- **Warnings:** one-line banner plus badge on the card; fixes in a popover. No red blocks.
- **Hidden panel (Settings drawer):** Library (apps + ports, groups, add/edit), port tools, Settings, per-profile Extensions. The current sidebar views Needs attention, Apps, Ports and Running are replaced by banner + badges + the Library.
- **Themes (Macdara, 2026-10-24):** Dark + Light + System, as v4 shipped (graphite + mint tokens from `docs/ui-v4/canvas.html` are the starting point; mock-ups are dark first, Light tokens designed in Wave 1). The six old themes stay retired (v4 decision 2026-10-16).
- **Reuse from v4 (Macdara, 2026-10-24):** the Apps list + docked inspector (preview, logs, share, nested worktrees) becomes the Library panel; the blocked strip's prescriptive fixes (Use :3005, Free the port, Ask Claude) become the slim banner's popover; Ports becomes a tool inside the panel; crash toast, diagnose and the `src/core` logic carry over. This overrides v4's "sidebar as status board" navigation, not its parts.
- **Workspaces/scenes:** a saved set of apps and browser profiles started together via the existing `bulk_start`; stored as a new `scenes` config field.
- **Hover live capture:** at most one capture per card per 10 s, reuse the cached thumbnail otherwise, one capture in flight at a time (`thumbnails.js` captures offscreen once per call).
- **History:** top-bar button opens a full timeline (existing run history kept).
- **Palette:** dark surfaces (#0a0b0f, #12141a, #191c24), one green accent (#6ef2a4); colour comes from thumbnails and brand art only.
- **Stack:** React + Vite + TypeScript in a shared `ui/` package (plain folder, one root `package.json`, no nested workspace) with a host adapter (Electron IPC / HTTP / VS Code postMessage). Core logic, MCP, agent API and plugin behaviour are kept. Extended on purpose: `main.js` (loads the new bundle), `preload.js` and IPC handlers (CDP health, brand-art fetch/cache, account labels, lease release, scenes), a new config field for account labels and scenes, and `src/core/palette.js` `VIEWS` (Home/Localhost/Browsers).
- **Build wiring (Wave 1):** Vite `base: './'` (pages load from `file://` under a strict CSP); dev-only CSP allows `ws:`; `prebuild` runs the Vite build; electron-builder `files` gains the output folder (today only `src/**/*`, `public/**/*`, `package.json`); output goes under `src/` or `files` is extended, whichever packs cleanly.
- **Using `palette.js`:** it is a UMD file that sets `window.PortPilotPalette`; load it with a `<script>` tag or add a thin ESM wrapper, and do not import it as an ES module.
- **VS Code:** keep tree views; replace the status bar tooltip with a Markdown hover listing this workspace's running ports as clickable links. Webview gallery later via the same adapter.

## Verification

Each wave ends with unit tests green, e2e for the screens it adds, and a read screenshot at 1440 and 1120 wide (the desktop window minimum; 390 only applies to the web portal and VS Code webview). Old e2e tests drive old globals and IDs (`state.runningApps`, `#global-search`, `#palette-list`, `data-view`); they keep passing against the old renderer until Wave 3, where each is named as rewritten or retired in that PR (15 e2e files today).

## Waves (one PR per theme)

1. **Shell:** `ui/` package, Vite build and packaging wiring (see Build wiring), host adapter with Electron IPC implementation, top bar, Home tiles, banner, Ctrl+K reusing `src/core/palette.js`. `main.js` loads the new bundle only when `PORTPILOT_NEW_UI=1`; the old renderer stays default until Wave 3.
2. **Localhost gallery:** four view modes, thumbnail refresh and hover capture, card states, History timeline ported.
3. **Browsers:** profile cards, brand art fetch + cache + override, account labels per profile, CDP health check, lease display and release, four view modes. Cutover: new UI becomes default. The old renderer is **not** deleted here: `src/agent/server.js` serves `src/renderer/index.html`, `renderer.js` and `styles.css` to the web portal.
4. **Control panel and extras:** Library, port tools, Settings, extensions, extend the existing tray with a quick-start menu, scenes.
5. **Web portal on the new bundle**, then delete `src/renderer` and its tests. VS Code status-bar hover and webview work is planned in the extension's own repo (source is not in this repo); this repo only exposes the host-adapter contract.

## Open items

- Confirm the status-bar hover Markdown can carry command links in the extension's source (not in this repo; only built `.vsix` files are here).
- Brave profile-art fetch needs the start URL per profile; profiles without one fall back to a letter tile.
- v4's `?ui=v3` fallback and the e2e harness that pins v3 (`docs/ui-v4/PROJECT-PLAN.md` slice 9) must be understood before Wave 3 cutover; the web portal stays pinned to v3 until Wave 5.

## Wave 1 status (2026-10-24)

Shipped in the shell PR: `ui/` (React 19 + Vite 7 + TS), output `src/ui-dist` (gitignored, built by `npm run build:ui`, run automatically before every `electron-builder` script), host adapter with the Electron IPC implementation, top bar, Home tiles with live counts, slim warning banner, Ctrl+K reusing `src/core/palette.js` (new optional `views` input). `PORTPILOT_NEW_UI=1` loads it; a missing build falls back to v4 with a console warning. Check: `npm run test:e2e:ui` (15 checks, real Electron) and `npm run typecheck:ui`.

Known gaps carried to Wave 2: tiles have no live mini-previews or Recent strip yet (dead space below them), History and Settings are disabled placeholders, the banner's Fix opens the palette until the popover exists, and the native title-bar overlay colour is not yet synced to the new theme.

## Wave 2 status (2026-10-24)

Localhost gallery with four modes (gallery, compact, list, grouped; the choice is remembered), filter, card states (running, port held, crashed, stopped with the last screenshot dimmed), Start/Stop/Open on the card, hover live capture (the host throttles to one per app per 10 s and one in flight), a 30 s sweep that refreshes one stale running app at a time, Home tile previews, and the History timeline (day headings, page title, Start again, Open). New IPC: `thumbs:index`, `thumbs:get`, `thumbs:capture` (`src/main/thumbIpc.js`, `src/main/liveThumbs.js`). Check: `npm run test:e2e:ui` (shell 15 + localhost 22 checks).

Carried forward: History has no pin, Re-run or date filters yet (v4 History stays the full tool until the Wave 3 cutover); no Recent strip on Home; the banner popover still opens the palette.

## Wave 3 status (2026-10-24)

Browsers screen and the cutover. Browsers: a card per profile with brand art (the site's og:image, else a touch icon or favicon, shown whole on a name-hashed gradient when small; a letter tile when none), account chips, purpose, a Signed in / Signed out pill for running profiles, a lease line with Release (the browser keeps running), Start/Stop/Edit, the four view modes, a filter that also reads account names, and an edit drawer (port, browser, window, start page, purpose, sites, note, accounts, picture fetch/choose/remove, add, remove with confirm). New IPC in `src/main/browserExtraIpc.js`: `browser:art:*`, `browser:health`, `browser:release`; pure logic in `src/core/browserArt.js` and `browserHealth.js`. Accounts are labels only (platform, username, note; max 10), never passwords.

Decisions worth knowing: art is fetched only from public http(s) hosts (no localhost, IPs or single-label names; redirects re-checked each hop), 8 s timeout, page 1 MB, image 2 MB, PNG/JPEG/WebP/GIF/ICO sniffed from the bytes (SVG refused); a miss is remembered for a day. Sign-in health has three states, in / out / unknown: a running browser has already dropped expired cookies, so "expired" cannot be told from "out". It reads cookie names and expiry from the browser's own CDP `Storage.getCookies` (checked against real headless Brave: set, read, clear), never values.

Cutover: the new UI is the default window (`src/core/uiChoice.js`). Settings > Switch to classic view stores `settings.ui = classic` and reloads; the classic header has Try new view. `PORTPILOT_NEW_UI=0|1` pins one (any other value is ignored). The window falls back to classic when `src/ui-dist` is missing. The e2e harness and the older specs pin `PORTPILOT_NEW_UI=0` and stay on v4 until Wave 5.

Check: `npm run test:e2e:ui` (shell 15, localhost 22, browsers 35 checks, real Electron and real headless Brave) and `npm run test:unit`.

Carried forward: Add App, Settings, port tools, duplicate profile, capture window bounds, per-profile session history and extensions list stay in classic until Wave 4. Light-theme screenshots were read at 390 only; 1440 light was captured but not read. Packaged builds were not opened this wave (`src/ui-dist` is built by the prebuild scripts and `files` includes `src/**/*`).

## Wave 4 status (2026-10-24): core

Library, Ports, Settings, the app drawer and the inspector, so daily use no longer needs the classic view. Library: filterable table with Start/Stop, Star, Details and Edit; the add/edit drawer (folder picker that reads the project and fills name, command and port, a free-port button, group, health path, description, auto-start, reserve port, delete with confirm); a Groups panel (add, rename, delete). Ports: filterable listener table with the owning PortPilot app, Open, Kill behind a second click (system processes are labelled), a blocked-apps strip with "Free :port", Find a free port, Rescan. Settings: window, apps, scanning and history toggles, scan interval and history limits (range-checked), theme (Dark, Light, System; kept in this view's own localStorage key because classic stores palette names), and the classic switch. Inspector: Logs (live while running), Share (local and LAN URL, QR), Diagnose (crashed apps; consent then the read-only Claude run). Reachable from the segmented control (Library, Ports), the Settings menu, and the palette ("Go to Settings").

Fixed on the way: Wave 2's Grouped mode read `app.groupId`, but the stored field is `group`, so every app landed in "All apps" (`groupOf` in `model.ts`).

Check: `npm run test:e2e:ui` (shell 15, localhost 22, browsers 35, wave4 22 checks, real Electron), `npm run typecheck:ui`, `npm run test:unit`. Screenshots read at 1440 and 390 (Library, Ports, Settings); the 390 tables were clipped on the first pass and now fit.

Carried to Wave 5 and later: Scenes (net-new data model), tray quick-start menu fed from the new UI (`tray.update`), web portal on the new bundle, deleting `src/renderer`. Not rebuilt yet from classic: drag reorder, bulk delete, nested worktrees and stale-worktree cleanup, project discovery scan paths, config export/import, docker banner, port reserve toggle on the Ports screen, duplicate profile, capture window bounds, per-profile session history, extensions list, crash "Ask Claude". Packaged build not yet opened.
