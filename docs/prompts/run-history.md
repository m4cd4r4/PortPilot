# PortPilot run history + auto-register Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-run-history/`. Don't carry context from the current session.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

## The problem

Macdara (2026-10-08) wants every localhost run to go through PortPilot, and wants to find a page or mockup he ran days ago by searching PortPilot instead of the repo. Two gaps today:

1. **Unregistered projects are invisible.** The Claude Code guard (`plugin/hooks/guard-core.mjs`, `decide()` L394-435) only routes a bare start of a *registered* app's own command on its own port. Every other certain start returns `pass` and runs untracked.
2. **Nothing about a run survives it.** `portpilot-runtime.json` holds current `startedBy` and the latest crash stamp per app. Once a server stops there is no record of the URL, branch, commit or what the page looked like.

## Source of truth (read these BEFORE designing/coding)

1. [plugin/hooks/guard-core.mjs](plugin/hooks/guard-core.mjs): `decide()`, `registeredApps`, `appInDir`, `targetPort`.
2. [src/main/processManager.js](src/main/processManager.js): start/stop lifecycle, `recordStop`, crash stamps.
3. [src/core/status.js](src/core/status.js) and [src/core/configFile.js](src/core/configFile.js): the runtime sidecar and config read/write shared by every surface.
4. [mcp-server/index.js](mcp-server/index.js): the 19 MCP tools; a new tool goes here.
5. [docs/claude-integration/PROJECT-PLAN.md](docs/claude-integration/PROJECT-PLAN.md): add rows for this work; check rows #11, #12 (drawer timeline, A10 activity timeline overlaps run history) and #17.

If anything in this brief contradicts those files, the source files win.

## What's in scope

**A. Auto-register.** On a *certain* dev-server start in a directory no registered app owns, register the project (name from `package.json` / folder, command, port, cwd) and then route it as today. Must never block or rewrite a command the guard is unsure about: uncertain stays `pass`. Opt-out setting.

**B. Run history.** On every start PortPilot manages, append a run record: app id, cwd, branch, commit SHA, a dirty-tree snapshot (stash-style object or patch, so an uncommitted mockup can be reproduced), port, URL, `startedBy`, start and stop time, exit code. On first healthy response, save a screenshot of the root URL as a thumbnail.
- Storage under `<configDir>` (local only), with a retention cap (count and bytes) and pruning.
- Desktop: a searchable History view (app, branch, date, free text), thumbnails, "Open URL" (if still running) and **"Re-run this version"**: check out the SHA into a worktree, apply the snapshot, start it on a free port.
- MCP: a tool such as `find_run` so Claude can answer "the mockup I ran on Monday" and return the record plus re-run instructions.

## Out of scope (do NOT modify)

- Release workflow, version numbers, the VS Code extension (follow-up row), the landing page.
- The guard's uncertain-command handling and the deny paths for busy ports.

## What "good" looks like

- Starting an unknown project from Claude Code registers it once and shows ✦ in the status line; nothing breaks for commands the guard cannot parse.
- Days later, searching History for "checkout" finds the run with its thumbnail, branch and SHA; "Re-run this version" brings that exact page back, including uncommitted changes captured at start.
- History never leaves the machine and stays under its cap.

## Required deliverables

1. Plain-text design (record schema, snapshot method, screenshot method, retention) before code. Use `/pre-build`. Plan this as at least 2 PRs (A, then B), with a PROJECT-PLAN row each.
2. Unit tests in `test:unit` for auto-register decisions (including uncertain -> pass), record write/prune, snapshot round-trip.
3. Screenshots at desktop width of the History view, using `docs/demo/demo-seed.js` data only. Never screenshot the real app (real project names).

## Constraints

- Branch: `feat/run-history`. Smaller PRs over one large one.
- Screenshots of pages must not need a new heavy dependency if Electron's own `capturePage`/offscreen window can do it.
- British English in UI copy; no em/en dashes or ellipsis characters.

## Out-of-scope follow-ups (capture, don't build)

Append to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/portpilot.md`. Known one already there: the keyword-fallback matcher false positives.

## Why this brief is structured this way

The guard was hardened (#15) so it never silently changes a command; auto-register must keep that guarantee. Re-running an old version depends on the snapshot, because a SHA alone loses uncommitted mockups.