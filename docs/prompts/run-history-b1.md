# Run history B1: run records Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-run-history-b1/`. Don't carry context from the current session.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

If there are conflicts, resolve them now. The brief was written against master at 3e9cd55 (PR #61, run history PR A, merged 2026-10-08).

## The problem

PortPilot forgets every run once an app stops. Nobody can answer "which version of the mockup was running on Monday" or get it back. PR B1 adds a local record of every start, stop and crash, a git snapshot of the tree as it was when it started (uncommitted and untracked files included), pruning, and an MCP tool `find_run` so Claude can look runs up. The desktop History view, thumbnails and the Re-run button are PR B2 and are not part of this work.

## Source of truth (read these BEFORE designing/coding)

1. [docs/run-history/DESIGN.md](docs/run-history/DESIGN.md), section "PR B1: run records": module, hook points, storage, record schema, snapshot mechanism and guards, retention, `find_run` signature. Build what it says.
2. [src/core/configFile.js](src/core/configFile.js): `recordStart`, `recordStop`, `recordCrash` and `updateJson` (lock + atomic rename). Every surface (desktop, web agent, MCP server, VS Code via `copy-runtime.js`) goes through these.
3. [mcp-server/index.js](mcp-server/index.js): how existing tools are declared, validated and tested; `find_run` becomes tool 20.
4. [docs/claude-integration/PROJECT-PLAN.md](docs/claude-integration/PROJECT-PLAN.md): row #20 `run-history-core`.
5. [tests/mcp-worktree.test.mjs](tests/mcp-worktree.test.mjs) and the `test:unit` / `test:mcp` scripts in [package.json](package.json): test style to follow.

If anything in this brief contradicts those source files, **the source files win**.

## Decisions already made by Macdara (2026-10-08)

Record these as answered in DESIGN.md "Open questions for Macdara" in this PR.

- **Q3 snapshot refs:** yes. Write `refs/portpilot/runs/<id>` into each project's own repo, with a per-repo opt-out that falls back to "no snapshot".
- **Q4:** `find_run` only. No `rerun_run` tool; `find_run` returns the literal `rerun.steps`.
- **Q5 retention:** 500 runs / 150 MB, pinning with at most 50 pins. Both caps editable in Settings (the setting keys; the Settings UI control is fine to add if it is a small change, otherwise note it for B2).

## What's in scope

- New `src/core/runHistory.js` with zero dependencies: `openRun`, `closeRun`, snapshot, pruning, query.
- One best-effort call each in `recordStart` / `recordStop` / `recordCrash`. A failure in run history never fails a start, stop or crash record.
- Storage `<configDir>/history/runs.json` via `updateJson`.
- MCP tool `find_run` in `mcp-server/index.js`, then `npm run build:plugin` so `plugin/mcp/portpilot-mcp.mjs` matches.
- Tests. Settings keys for the caps and the opt-out.
- PROJECT-PLAN: row #19 to merged (PR #61), row #20 to "PR open" with the PR link.

## Out of scope (do NOT modify)

- PR B2: History tab, thumbnails (`thumbs/` can stay empty; pruning must still handle the folder), Re-run UI.
- PR A code: `plugin/hooks/observe.mjs` and `cmdSafe` / `startRefusal` in `mcp-server/index.js`. They went through nine review rounds.
- Release workflow, version numbers.

## What "good" looks like

- Start an app from any surface and `runs.json` gains a record at once; git state (`sha`, branch, dirty flag, snapshot ref) is patched in afterwards. The start never waits on git.
- Starting an app that already has an open run closes the earlier run as `endedBy: 'unknown'`.
- A dirty tree, including a new untracked file, produces a snapshot ref that restores the exact files. A clean tree stores no snapshot. Untracked files over 20 MB in total, a capture over 10 s, or an unborn HEAD skip the snapshot with a reason and still record the run.
- Snapshot capture never touches the user's real index, working tree or branches (temporary `GIT_INDEX_FILE`).
- Pruning keeps both caps, never drops a pinned run, and deletes dropped refs outside the lock.
- `find_run` filters and ranks as DESIGN.md says (default limit 5, max 20) and returns `running` plus `rerun.steps`.

## Required deliverables

1. A short plan before code: the record shape as implemented, and anything in DESIGN.md you had to change, with the reason.
2. The code change and tests. Unit tests at minimum for: open/close/crash, unknown-close of an earlier open run, pruning by count and by bytes, pins survive pruning, dirty-tree snapshot including an untracked file (restore and compare), clean tree stores no snapshot, the too-large skip, unborn HEAD, opt-out, and a broken git that still lets the start succeed.
3. Green: `npm run test:unit`, `npm run test:mcp`, `node tests/plugin-mod.test.mjs`, `claude plugin test plugin`, `claude plugin validate plugin`.
4. A fresh opus reviewer pass on the diff (writer/reviewer rule: give it the diff and the requirements, not your reasoning). Fix anything MEDIUM or above, then rerun step 3.
5. One PR with an `## Evidence` section and a review-history list in the body.

## Suggested workflow

1. Rebase. Read the source-of-truth files.
2. Write the plan (deliverable 1).
3. Test-first for `runHistory.js` using temp git repos (`/tdd`): records, snapshot, pruning, query.
4. Wire the hooks into `configFile.js`, then `find_run`, then rebuild the plugin bundle.
5. Live check with an isolated APPDATA (PR A used `pp-live2`): start and stop a demo app on a scratch repo with an uncommitted file; confirm the record, the ref, and a restore into a temp worktree.
6. Reviewer, fix, PR.

## Constraints

- One PR. Branch: `feat/run-history-b1`.
- Never run against Macdara's real PortPilot config or real project repos; use temp dirs and an isolated APPDATA.
- No new runtime dependencies.
- Bash tool halves doubled backslashes: write scripts with backslashes via the Write tool. Files may be CRLF.
- Ask Macdara before merging.

## Out-of-scope follow-ups (capture, don't build)

Append to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/portpilot.md`.

## Why this brief is structured this way

DESIGN.md already holds the full spec, so this brief points at it, adds the three decisions it was waiting on, and fences off PR A's parser, which the review rounds kept finding edge cases in.