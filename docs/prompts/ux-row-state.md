# #8 ux-row-state: state cell on every row, crashed state, VS Code status Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-ux-row-state/`. Do not carry context from the session that wrote this.

Plan row: #8 of [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md), Wave 2, Track B. Model routing: **Sonnet 5.5, medium** (the "Everything else" row).

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

Resolve any conflicts now. #9 (conflict strip, PR #46) already edited the app row in `src/renderer/renderer.js`, so build on top of it, not around it.

## The problem

An app row in PortPilot does not say what state the app is in, why, for how long, or who started it. `startedBy` provenance is recorded (Wave 1, #5) but nothing renders it. A crashed app reads as stopped: `src/main/processManager.js` keeps the entry after exit with `exitCode`, `announced` and `userStopped` (exit handler around L84-93), but `getRunningApps()` (around L220) returns no crash flag, so the renderer cannot tell a crash from a clean stop. The VS Code extension tree shows the same flat picture and there is no status bar summary.

## Source of truth (read these BEFORE designing or coding)

1. [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md): row #8, the Wave 2 notes, "Verification per slice", and D5 (colour stays reserved for status).
2. [src/main/processManager.js](../../src/main/processManager.js): the exit handler and `getRunningApps()`.
3. [src/core/status.js](../../src/core/status.js): `provenanceOf(startedBy)`, the single helper for the provenance label. Use it; do not re-derive.
4. [src/renderer/renderer.js](../../src/renderer/renderer.js): the app row markup, including #9's conflict strip.
5. [docs/demo/demo-seed.js](../demo/demo-seed.js): the mock `window.portpilot` used for screenshots.
6. [vscode-extension/src/appsTreeProvider.ts](../../vscode-extension/src/appsTreeProvider.ts), `portsTreeProvider.ts` and `extension.ts`.

If anything here contradicts those files, **the files win**.

## What's in scope

- `src/main/processManager.js`: expose a `crashed` flag from `getRunningApps()`. It is true when the process exited, had announced, and the user did not stop it. Reuse the condition the exit handler already uses for `emitCrash`.
- Any IPC or preload pass-through needed for the flag to reach the renderer.
- `src/core/status.js` (or a new pure helper beside it): a pure function mapping an app record to `{ shape, word, reason, uptime, provenance }`. That keeps the logic unit-testable.
- `src/renderer/renderer.js` plus its stylesheet: the A1 state cell on every app row, e.g. `● Running 2h · claude`, `○ Stopped`, `✕ Crashed · exit 1`.
- `vscode-extension/src/appsTreeProvider.ts`: B1, status-aware tree items (icon plus description from the same state vocabulary).
- `vscode-extension/src/extension.ts`: B3, a status bar item summarising running and crashed counts; clicking it focuses the PortPilot view.
- `docs/demo/demo-seed.js`: add a crashed app (with exitCode) and a Claude-started app (`startedBy` resolving to `claude`). A port conflict already exists; keep it.
- `tests/`: a unit test for the new pure helper and the `crashed` derivation, wired into `test:unit` in `package.json`.
- The plan row #8 status flip, in the same PR.

## Out of scope (do NOT modify)

- `src/core/conflict.js` and the conflict-strip behaviour (#9, merged).
- The plugin, the mod and the MCP server under `plugin/` and `src/mcp*` (Track A).
- Toast actions and the Claude Code push (#10), and the timeline.
- Themes and the palette: D5 says colour is for status only, so the cell uses the existing status colours.
- Restart-on-crash or any auto-recovery. This row only *shows* the crash.

## What "good" looks like

- Every app row carries one state cell: shape, word, reason, uptime, provenance. It stays readable without colour, because shape and word carry the meaning.
- A crashed app shows `✕ Crashed · exit <code>` and never reads as stopped. A user-stopped app reads `Stopped`.
- Provenance appears only when known (`· claude`, `· you`), via `provenanceOf`.
- Uptime is compact (`45s`, `12m`, `2h`, `3d`) and only shown while running.
- The VS Code tree and status bar use the same words as the app.
- The cell fits the row at 390px without wrapping the app name off-screen.

## Required deliverables

1. A short design note in the PR body: the state vocabulary table (state -> shape -> word -> reason) before code.
2. The code change scoped to the in-scope list.
3. `npm run test:unit` green, including the new test, which fails before the change.
4. The VS Code extension compiles (`npm run compile` or the existing build script in `vscode-extension/`).
5. Screenshots of the seeded demo at **1440 and 390**, read by you before reporting, attached to the PR. Show a running Claude-started row, a crashed row and the conflict row.
6. The PR flips row #8 in the plan to `merged (PR #N)` after merge, or `materialised` with the PR link before.

## Suggested workflow

1. Rebase. Read the source-of-truth files.
2. Write the state vocabulary table first and check it against D5.
3. TDD the pure helper and `crashed` (use `/tdd`).
4. Wire the renderer, then extend the demo seed, then screenshot.
5. B1 and B3 in the extension last.
6. `/commit` to open the PR with the generated evidence section. A fresh-context Opus 5.5 medium review of the diff is the wave-boundary step, per the routing table.

## Constraints

- One PR. Branch: `feat/ux-row-state`.
- No new dependencies.
- Do not put `npm run dev -- --port <busy>` in a Bash command: the user-level dev-server-guard blocks it.
- Never switch branches in the primary checkout at `I:/Scratch/PortPilot-2026`.

## Out-of-scope follow-ups (capture, don't build)

Append them to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/PortPilot.md`, or add a plan note under Wave 3. Do not fix them inline.

## Why this brief is structured this way

The Wave 1 gate review found the crash data already exists and `startedBy` is recorded but unread, so this row exposes and renders existing state. It does not build new tracking. The scope keeps it off #9's conflict code and Track A's plugin files, so the two tracks do not collide.