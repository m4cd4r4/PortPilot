# #16 crash-truth: crashed means crashed, on every surface Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-crash-truth/`. Do not carry context from the session that wrote this.

Plan row: #16 of [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md), Wave 3, Track B. Model routing: **Sonnet 5.5, medium**.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

#15 guard-hardening runs in parallel in `plugin/hooks/`. You touch only the crash rule there; if #15 merged first, rebase onto it.

## The problem

PR #49 made `crashed` visible on every surface (row cell, VS Code tree, status bar). A Wave 2 review found it reports crashes that did not happen:

1. **A deliberate kill reads as a crash.** Apps are spawned with `exec(...)` through a shell, so the tracked pid is the shell's. `killByPort` kills the process holding the port (node.exe), and the `info.pid === safePid` check in `killProcess` (`src/main/processManager.js` around L180) never matches. `userStopped` stays false, so the shell's exit passes `isCrashed`. Triggers: the conflict strip's "Stop X & start", Kill on a managed port in the Ports list, and MCP `stop_app` on a desktop-started app. Result: an OS "exited unexpectedly" notification, `recordCrash` in the sidecar, `✕ Crashed · exit 1` on the row, and a red VS Code status bar.
2. **App quit leaves ghosts.** `cleanupAllProcesses` (around L271) never calls `recordStop`, so the sidecar keeps every app that was running.
3. **The status line has its own crash rule.** `appStates` in `plugin/hooks/guard-core.mjs` (around L90) calls an app crashed when it has a sidecar entry and its port is not listening. It ignores the explicit `crashed` stamp. With (2), every app shows `✕` after the desktop app quits. A Next app still compiling after the start stamp (about 500 ms after spawn, `src/main/ipcHandlers.js` around L457) also shows `✕`. That breaks the plan's guiding rule: one status model in `src/core/status.js` feeds every surface.

## Source of truth (read these BEFORE coding)

1. [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md): the goal line (one status model), rows #8 and #16.
2. [src/main/processManager.js](../../src/main/processManager.js): `isCrashed`, `stopApp`, `killProcess`, `killByPort`, `cleanupAllProcesses`.
3. [src/core/configFile.js](../../src/core/configFile.js): `recordStart`, `recordStop`, `recordCrash` and the runtime sidecar.
4. [src/core/status.js](../../src/core/status.js): `rowStateOf` and the status vocabulary.
5. [plugin/hooks/guard-core.mjs](../../plugin/hooks/guard-core.mjs): `appStates`, plus how the plugin bundles core (`plugin/hooks/lib/core.mjs` and `plugin/mcp/status.cjs` are built copies; regenerate with `npm run build:plugin`, never hand-edit).

The files win over this brief.

## What's in scope

- `src/main/processManager.js`: a kill by port or pid on a tracked app sets `userStopped` on that app, matched by app id and port, since the pid is the shell's. `cleanupAllProcesses` calls `recordStop`.
- `src/core/status.js`: one exported crash rule that reads the explicit `crashed` stamp; `starting` vs `crashed` handled for an app that is stamped but not yet listening.
- `plugin/hooks/guard-core.mjs`: `appStates` uses that rule. This is the only line you change in `plugin/hooks/`. Then rebuild the plugin copies.
- Tests in `test:unit` for: a port kill sets userStopped, app quit records stop, a still-starting app is not crashed, a real crash still is.
- The plan row #16 status flip, in the same PR.

## Out of scope (do NOT modify)

- The guard's parse/route/deny logic (#15).
- Crash toasts and their actions (#10, next in this track).
- Row cell layout or wording from #8.

## Required deliverables

1. Tests that fail before the fix and pass after; `npm run test:unit` and `npm run test:mcp` green; plugin bundle `--check` clean.
2. A manual check in the desktop app: start an app, kill it from the Ports list. The row reads `Stopped`, there is no OS notification, and the sidecar has no crash entry. Then kill the node process externally: the row reads `✕ Crashed`.
3. Screenshots at 1440 and 390 of the seeded demo if any row output changed, read before reporting.
4. `/commit` with the generated evidence section.

## Constraints

- One PR. Branch: `fix/crash-truth`.
- No new dependencies.
- Never switch branches in the primary checkout `I:/Scratch/PortPilot-2026`.
- **After the PR merges, do NOT run `wt-finish.sh` from inside this worktree.** Report "merged" and stop. The ux-row-state session removed its own worktree that way and left Macdara with a blank window. Cleanup runs from another session.

## Out-of-scope follow-ups

Append to the plan under Wave 3 notes, or to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/PortPilot.md`. Do not fix inline.