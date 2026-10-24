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
