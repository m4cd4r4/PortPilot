# PortPilot - Claude Code integration + UX plan

Goal: make PortPilot the place where both you and Claude Code sessions start, see and stop dev servers. That means a Claude Code plugin with a mod (live status line, dev-server guard, `/ports` pane), and a UI that says on every row what state an app is in, why, and who started it. Guiding constraint: one status model (`src/core/status.js`) feeds every surface (desktop, web portal, VS Code, Claude Code), so no surface invents its own vocabulary.

Inputs: the 2026-10-05 audit (summary under "Baseline" below) and [`docs/ux-research/2026-10-05-ux-recommendations.md`](../ux-research/2026-10-05-ux-recommendations.md) (UX items are cited by its IDs: A1-A10, B1-B4, C1-C4, D1-D5). The earlier redesign plan is [`docs/ui-redesign/PROJECT-PLAN.md`](../ui-redesign/PROJECT-PLAN.md); this plan does not reopen it.

## Baseline (2026-10-05)

- v3.3.0. Four clients share `portpilot-config.json`: Electron app, web agent (7317), MCP server (19 tools, stdio, or HTTP on 8788 while the app runs), VS Code extension.
- Claude Code integration is the MCP server plus the `register-worktree` CLI. There is no plugin, skill, hook or mod.
- Fixed: MCP HTTP mode had no Host/Origin check (DNS rebinding could reach `add_app` + `start_app`). Merged in PR #30, **not yet released**.
- Debt: Electron 27 (17 majors behind, out of support); no CI; tests limited to `test:unit` (status) and `test:mcp`; config writes have no lock; `vscode-extension/runtime/` is a hand copy of `src/`; `.vsix` binaries committed.

## Status table

| # | Slug | Scope | Status | Wave | Effort |
|---|------|-------|--------|------|--------|
| 0 | mcp-http-origin-guard | Host/Origin allowlist on MCP HTTP mode + `tests/mcp-http-guard.test.mjs` | merged (PR #30) | 0 | done |
| 1 | release-3-3-1 | Version bump, changelog, build, GitHub release carrying the #30 fix. Publishing is ask-first | merged (PR #32, v3.3.1 published 2026-10-05) | 1 | done |
| 2 | electron-upgrade | Electron 27 -> current stable; fix breakage; `npm test` (Playwright-Electron) green | merged (PR #33, 27.3.11 -> 44.5.1) | 1 | done |
| 3 | ci-baseline | GitHub Actions: `test:unit` + `test:mcp` on push/PR (Windows + Linux); Electron suite under xvfb if cheap (deferred: replaced by an unpacked package + bundled-MCP smoke on both OSes) | merged (PR #34; also fixes release builds shipping without mcp-server deps) | 1 | done |
| 4 | config-atomic-write | Write config via tmp + rename with a lock file, shared by app, agent, MCP; a test with two concurrent writers | merged (PR #36) | 1 | S |
| 5 | status-provenance | D1 + D3: `startedBy {kind, surface, sessionId?, at}` in `src/core/status.js`, MCP `start_app` stamps `claude`; canonical status vocabulary table. No UI | merged (PR #37) | 1 | M |
| 6 | plugin-scaffold | `plugin/` + root `marketplace.json` (clear-resume layout; neither exists yet): bundled stdio MCP (single-file build, no `npm install`; esbuild via `npm run build:plugin`, output committed to `plugin/mcp/`; #34 turned out to ship node_modules, not a bundle), a `portpilot` skill ("start servers through PortPilot, never bare Bash"), `claude plugin eval` cases | merged (PR #47) | 2 | M |
| 7 | mod-status-guard | Mod in the plugin: C1 status line (`⚓ 3 up · :3000 web`, worst state first, `✦` on Claude-started apps); C3 dev-server guard on `tool.call` Bash (busy port -> deny with "reuse :3000"; free -> route through `start_app`); `claude plugin test` coverage. Reads the runtime sidecar `recordStart` writes (`src/core/configFile.js` L183: `startedBy`, `pid`, `port` per app) and confirms liveness by port, so it works while the app is closed. Imports the conflict decision tree from `src/core/conflict.js` (#9) | merged (PR #48) | 2 | M |
| 8 | ux-row-state | A1 state cell on every row (shape + word + reason + uptime + provenance, e.g. `● Running 2h · claude`); B1 status-aware VS Code tree items; B3 status bar item. First surface to render `startedBy` (nothing reads it today). `crashed` is one exposed flag away: `processManager.js` keeps the entry after exit with `exitCode`, `announced` and `userStopped` (L84-93) but `getRunningApps` (L220) returns no crash flag, so a crashed app reads as stopped. Expose `crashed` there and render `✕ Crashed · exit 1` | merged ([#49](https://github.com/m4cd4r4/PortPilot/pull/49)) | 2 | S-M |
| 9 | ux-conflict-strip | Extract the conflict decision tree from the renderer (`showUnknownConflictWarnings` renderer.js:1209, `killConflictingProcess` :1224) into `src/core/conflict.js` with a unit test, then A2 labelled conflict strip replacing the four port-kill `confirm()` calls (renderer.js:651, 1157, 1195, 1230). The two delete confirms (:1424 group, :1825 bulk) are out of scope. Lands before #7 so the guard imports the module instead of re-deriving it | merged (PR #46) | 2 | S-M |
| 10 | crash-alerts | Crash toasts with Restart / Logs / Ask Claude (A4, desktop) and Fix it (C4, Claude Code band). **Re-scoped 2026-10-07: no MCP channel.** The plugin mod hands the crash to the session with `$.prompt.submit` (mods API v2.1.289), so it needs no allowlist and no `--dangerously-load-development-channels` launch. Slices: (1) the crash stamp keeps `startedBy`, port and `errorTail`; MCP-started apps log to `<configDir>/logs/<appId>.log`, so they have a stderr tail too; (2) C4 band in the owning session: Restart / Logs / Fix it; (3) a session heartbeat and inbox under `<configDir>`, so the desktop app or another session can address a session (`Send to b71c`); (4) A4 sticky desktop toast, with Ask Claude shown only when the target session is live, and repeat-crash grouping. An inbox request carries only `{appId, at}`: the mod builds the prompt from its own sidecar read and fences the stderr as untrusted output | merged ([#54](https://github.com/m4cd4r4/PortPilot/pull/54)) | 3 | L |
| 11 | command-palette-pane | D2 one command registry; A3 Ctrl+K palette; C2 `/ports` mod pane (terminal and desktop only: mod `e.surface` is `terminal` or `desktop`, so the VS Code side is #17) | later | 3 | M-L |
| 12 | drawer-timeline | A5 drawer re-hierarchy; A10 activity timeline (who did what, when) | later | 3 | M |
| 13 | directory-submission | Submit the plugin to the Anthropic plugin directory (as clear-resume was); README install path. Depends on #15: do not publish a guard that reroutes or wrongly denies the user's commands | later | 3 | S |
| 14 | repo-hygiene | Drop committed `.vsix`; generate `vscode-extension/runtime/` at build; fix stale MCP tool counts in README | merged (PR #44). On inspection, `.vsix` was already untracked and `runtime/` already generated by `copy-runtime.js` (both gitignored in `vscode-extension/.gitignore`); README counts already matched the 19 registered tools. Only stale count left: landing page `docs/index.html` said 18 | 1 | S |
| 15 | guard-hardening | Wave 2 review findings on the C3 guard (`plugin/hooks/guard-core.mjs`, `register.ts`). (1) When the start directory is uncertain (a non-cd step before the start, L165-168), `pass`; never fall back to the session cwd. Rewrite the test at `tests/plugin-mod.test.mjs:127` that asserts the current behaviour. (2) Route only a bare start; any pipe, `\|\|`, `&&` step or redirect around it -> `pass` or `deny` with the reason, never a silent `start_app` that drops the rest. (3) Read `export PORT=` / `set PORT=`; treat a start whose bound port is unknown (e.g. `npm run preview`) as `pass`, not a collision on preferredPort. (4) Shared preferredPort: name the holder by the sidecar pid, not by preferredPort. (5) Report a `start_app` `isError` as a failure. (6) Check that `$.session.cwd()` follows the Bash tool's persisted cwd. Tests for every case in `test:unit`, so CI runs them (`register.test.ts` needs the `claude` CLI and CI skips it) | merged | 3 | M |
| 16 | crash-truth | Wave 2 review findings on `crashed`. (1) A kill by port (`killByPort`, conflict strip "Stop & start", Ports-list Kill, MCP `stop_app`) on a PortPilot-started app must set `userStopped`: the tracked pid is the shell's (`exec` with a shell, processManager.js:180), so `info.pid === safePid` never matches. (2) `cleanupAllProcesses` (processManager.js:271) calls `recordStop`. (3) The status line's crash rule (`guard-core.mjs:90`: sidecar entry + port not listening) reads the explicit `crashed` stamp instead, so a still-compiling app or one stopped by an app quit is not `✕`. One rule in `src/core/status.js`, used by every surface. Tests for each case | merged | 3 | S-M |
| 17 | vscode-ports-view | C2 for VS Code: the `/ports` pane's content (state, provenance, conflicts, actions) as a PortPilot VS Code extension view, because mod UI does not render in the VS Code extension. Reuses the B1 tree from #8 where it can | later | 3 | M |
| 18 | crash-channel-push | MCP channel push of crash + stderr tail into the session that started the app | superseded by #10 (mod `$.prompt.submit` reaches the session without a channel) | 4 | - |
| - | groups-patch-app | Off-plan fix: move-to-group / drag-to-group patch the fresh config via `config:patchApp` instead of saving a stale copy; `tests/patch-app.test.cjs` | merged (PR #40) | - | S |
| - | release-drafts | Off-plan: `release.yml` creates DRAFT releases with `fail_on_unmatched_files` (action-gh-release v2). Untested end to end until the next tag push | merged (PR #41) | - | S |
| - | mobile-app-names | Off-plan fix: app names no longer render 0px wide at phone width (`styles.css`, `max-width: 600px` query) | merged (PR #42) | - | S |

Status vocabulary: `later` / `materialised` / `merged (PR #N)` / `superseded`.

## Wave structure

- **Wave 1 (foundation, parallel-safe):** #1, #2, #3, #4, #5, #14. #5 is the only one later waves depend on, because the status line, guard, row state and timeline all render `startedBy`. #4 lands before #6 because the plugin adds more config writers. #2 and #14 both touch `package.json`/build config: run them one after the other, not in parallel.
- **Wave 1 complete (2026-10-06).** All six rows merged (PRs #32-#34, #36, #37, #44).
- **Wave 2 (first visible wins), re-planned 2026-10-06 at the Wave 1 gate:** two parallel tracks.
  - Track A (Claude Code): #6, then #7.
  - Track B (app UI): #9, then #8.
  - #9 owns `src/core/conflict.js`, and #7 imports it. This settles the old "whichever lands first" rule: Track B has no plugin dependency, so #9 lands first.
  - Run #8 after #9 because both edit the app row in `renderer.js`.
  - What the gate review changed: #8 now carries the first `startedBy` rendering, plus the `crashed` row state (crash detection already exists, so #8 only exposes it); #10 shrinks to the toast actions and the Claude Code push. #7 reads the runtime sidecar so it works while the app is closed.
  - UI verification needs `docs/demo/demo-seed.js` extended with a Claude-started app and a port conflict before #8/#9 screenshots.
- **Wave 2 complete (2026-10-06).** #6-#9 merged (PRs #46-#49).
- **Wave 3, re-planned 2026-10-06 at the Wave 2 gate:**
  - What the gate review found: #46 and #47 are sound. #48's guard can start the wrong app, drop the rest of a command, or wrongly deny on a busy preferredPort. #49 records a crash when the user kills an app by port, and the status line keeps its own crash rule that disagrees with every other surface. Those became #15 and #16, and they go first.
  - What the open questions settled: mod UI renders on `terminal` and `desktop` only (mods reference, v2.1.289), so C2 for VS Code is its own row (#17). MCP channels are a research preview with a plugin allowlist, so the crash push left #10 for #18, Wave 4.
  - Order. Track A (Claude Code): #15, then #13, then #11. Track B (app UI): #16, then #10, then #12. #17 after #11 settles the pane's content. #16 and #15 can run in parallel: #16 touches `processManager.js`, `status.js` and the one crash-rule line in `guard-core.mjs`, so #15 rebases onto #16 if both are open.
  - **#16 follow-ups (not fixed in #51, fold into later rows or the Wave 3 gate):**
    - `vscode-extension/src/appsTreeProvider.ts:66` has its own crash rule (stamp only, no starting window) and does not call `status.runtimeStateOf`. Same drift #16 removed from the status line.
    - An MCP-started app that never binds reads crashed after 60s, because only the 60s window can flag it.
    - The `process:kill` IPC (raw pid) still cannot match the shell pid; only kills by port are covered.
    - The 1500ms settle in the `onAppCrash` handler in `src/main/main.js` is a heuristic.
    - #15 rebases onto #16 in `plugin/hooks/guard-core.mjs`; #16 touched only the import line, `appStates` and `statusLine`.
- **Wave 4 (guess until Wave 3 lands):** none yet; #18 was superseded by #10's mod route. Re-plan at the gate.

Per the wave-gate rule, Wave N+1 scope is a guess until Wave N lands; re-plan at each gate.

## Verification per slice

- Logic: a test that fails before the change (`npm run test:mcp` / `test:unit` / `claude plugin test plugin/`).
- UI: the fake-seeded demo (`docs/demo/demo-seed.js`) extended with a crashed app, a Claude-started app and a port conflict; screenshots at 1440 and 390, read before reporting.
- Mod: hot-reload in a live session, then `claude plugin validate` + `claude plugin test`.

## Model routing

Default for all work: **Sonnet 5.5 on medium**. Flip up only for the rows below, then flip back.

| Work | Model / effort | Why |
|---|---|---|
| Wave 1: electron-upgrade | **Opus 5.5, high** | 17 majors of breaking changes; failures show up at runtime, not compile time |
| Wave 2: mod-status-guard | **Opus 5.5, high** | new mod API and a guard that blocks the user's own tool calls; a wrong deny is costly |
| Wave 2: plugin-scaffold | **Opus 5.5, medium** | packaging + directory requirements are new ground |
| Wave 3: guard-hardening | **Opus 5.5, high** | same guard, same cost of a wrong deny or reroute |
| Wave-boundary review of each diff | **Opus 5.5, medium** | writer/reviewer separation; fresh context, never the session that wrote it |
| Everything else | **Sonnet 5.5, medium** | centre-of-distribution, fully constrained by this plan |

## What this plan does NOT cover

- macOS builds, code signing, notarisation.
- Rewriting the disabled legacy specs (v1.3/v1.7/groups).
- A new brand palette or theme (D5: colour stays reserved for status; existing themes unchanged).
- Replacing Claude Code's own background tasks or Monitor: PortPilot covers what persists across sessions and what the human sees.
- Production deploys of the landing page (GitHub Pages builds on push).
