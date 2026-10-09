# Run history PR B2 (run-history-view) Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-run-history-view/`. Do not carry context from another session. Model: Sonnet 5.5 at high effort for the build; a fresh opus reviewer pass (given the diff and evidence, not your reasoning) is required before the PR.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

Other PRs may have merged since scaffold time. Resolve conflicts now.

## The problem

PR A (#61) and PR B1 (#62) record every run with a git snapshot and expose `find_run` over MCP, but the desktop app shows none of it. A person cannot see what they ran last Tuesday, open the page it served, or get that exact version running again without the MCP tool.

## Source of truth (read these BEFORE coding)

1. [docs/run-history/DESIGN.md](docs/run-history/DESIGN.md), section "PR B2" (thumbnail capture, History view layout, "Re-run this version" steps 1-5, the moved-to-B2 weekly orphan sweep).
2. [src/core/runHistory.js](src/core/runHistory.js): run record shape, snapshot refs, pruning, `rerunOf`, pins.
3. [src/main/healthCheck.js](src/main/healthCheck.js) and [src/main/ipcHandlers.js](src/main/ipcHandlers.js): `probe(port)` and the IPC surface to extend.
4. [src/renderer/renderer.js](src/renderer/renderer.js), [src/renderer/index.html](src/renderer/index.html), [src/renderer/styles.css](src/renderer/styles.css): sidebar tabs, `rowStateOf` state words, compact data-dense rows.
5. [docs/demo/demo-seed.js](docs/demo/demo-seed.js) and [docs/demo/tools/shot.mjs](docs/demo/tools/shot.mjs): how demo data and screenshots are produced.
6. [docs/claude-integration/PROJECT-PLAN.md](docs/claude-integration/PROJECT-PLAN.md) row #21.

If this brief contradicts those files, the source files win.

## What's in scope

- Offscreen thumbnail capture in the main process (per DESIGN.md), storing JPEGs under `history/thumbs/` and patching `page.thumb` and `page.title` on the run.
- A "History" sidebar tab: search, App/Branch/From/To filters, Dirty-only, cards with thumb, state word, Open URL (enabled only while that run's app is running on that port), Re-run this version, Copy SHA, Pin; footer with run count and size against the cap.
- "Re-run this version" main-process flow: sibling worktree path, detached worktree at snapshot commit, `reset --mixed`, lockfile install with progress in the row, register via the `add_worktree` logic, free port from the reserver (`--port N` rewritten, else `PORT`), start with `rerunOf`.
- The weekly sweep removing orphan thumbs and refs whose run is gone.
- IPC handlers, preload bridge, unit tests for the pure parts (filtering, port rewrite, lockfile detection, sweep).
- Demo-seed runs and 1440 and 390 screenshots under `docs/demo/screenshots/`.
- Plan row #21 status, README and CHANGELOG entry.

## Out of scope (do NOT modify)

- `src/core/observe.mjs` parser / `cmdSafe` (PR A took 9 review rounds).
- Run record schema fields written by B1, except additive fields B2 needs (document them in DESIGN.md).
- VS Code extension (plan row #22), command palette (#11), drawer timeline (#12).
- Any new runtime dependency.

## What "good" looks like

- Open the History tab with seeded data: dense rows, thumbs where present, placeholder where not, all state words correct.
- Re-run on a run with a snapshot reproduces the original commit with the dirty files uncommitted, on a free port, and the new run record carries `rerunOf`.
- Re-run refuses clearly (names which: repo gone, or ref pruned).
- Thumbnail capture never navigates off localhost and never leaves a hidden window open.
- Looks right at 1440 and 390; you have read both screenshots yourself.

## Required deliverables

1. State your verification plan (one sentence) before coding.
2. Code within the in-scope list, with tests passing (`npm test`).
3. Real Electron run: load the History tab, assert on the DOM, then screenshot at 1440 and 390 and read them.
4. A real Re-run executed end to end against a throwaway repo.
5. PR with an `## Evidence` section from `pr-evidence.mjs`; opus reviewer pass findings addressed first.

## Suggested workflow

1. Rebase, read the source-of-truth files, state the verification plan.
2. Build in vertical slices: thumbnail capture, then History tab read-only, then Pin and filters, then Re-run, then the sweep, then demo-seed and screenshots.
3. Run `/design-review` on the History tab before the PR.

## Constraints

- One PR. Branch `feat/run-history-view`.
- Data-dense compact rows, not card-heavy whitespace.
- British English; no em-dashes, en-dashes or ellipsis characters.
- Merging and publishing are ask-first.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md` or the backlog at `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/`. Do not fix inline.

## Why this brief is structured this way

B1 and PR A both shipped through long review loops; slicing vertically and requiring a real Re-run against a throwaway repo catches the git-worktree and install edge cases that unit tests miss.