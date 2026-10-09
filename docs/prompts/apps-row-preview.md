# Apps row page preview (apps-row-preview) Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-apps-row-preview/`. Do not carry context from another session. Model: Sonnet 5.5 at high effort; a fresh opus reviewer pass (given the diff and evidence, not your reasoning) before the PR.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

## The problem

The page thumbnails shipped in 3.5.0 only show on the History tab. On the Apps tab, where people actually look at their running servers, a row says "Running :3300" and nothing about what the page looks like. Macdara wants to see the localhost page next to the row.

## Source of truth (read these BEFORE coding)

1. [src/main/thumbnails.js](src/main/thumbnails.js): offscreen capture, health polling, `setThumb`.
2. [src/renderer/history.js](src/renderer/history.js) `thumbHtml`, thumb cache, `window.portpilot.history.thumbs(ids)`; [src/main/historyIpc.js](src/main/historyIpc.js) `history:thumbs`.
3. [src/core/runHistory.js](src/core/runHistory.js): run records, `page.thumb`, pruning that deletes thumbs.
4. [src/renderer/renderer.js](src/renderer/renderer.js) app row and worktree child row rendering; `rowStateOf`.
5. [src/renderer/styles.css](src/renderer/styles.css) `.hthumb` and the row styles; [docs/demo/demo-seed.js](docs/demo/demo-seed.js), [docs/demo/tools/history-shot.mjs](docs/demo/tools/history-shot.mjs).
6. [docs/claude-integration/PROJECT-PLAN.md](docs/claude-integration/PROJECT-PLAN.md) row #23.

If this brief contradicts those files, the source files win.

## What's in scope

- A small thumbnail on Apps rows (parent and worktree child rows) for a running app, taken from that app's latest open run `page.thumb`. Stopped apps show none, or the last run's thumb dimmed: decide, state it in your rationale, keep rows compact.
- Reuse the existing IPC and cache; no second capture pipeline. Refresh when a new thumb lands.
- Setting to turn row previews off (default on), in the existing Settings panel.
- Works with 150 apps and a few running: lazy request only for visible running rows.
- Demo-seed data and 1440 and 390 screenshots; README line and CHANGELOG `[Unreleased]` entry; plan row #23 status.

## Out of scope (do NOT modify)

- Capture rules (localhost only, 15 s timeout, 480 px JPEG) and pruning caps.
- The History tab layout; run record schema except additive fields.
- `src/core/observe.mjs`; the VS Code extension; new runtime dependencies.

## What "good" looks like

- A running app's row shows its page thumbnail at a small fixed size without making rows taller than today's compact density.
- Rows with no thumb look exactly as they do now (no placeholder noise).
- Nothing flickers on the 3-second refresh; no extra offscreen windows.
- You have read screenshots at 1440 and 390 yourself.

## Required deliverables

1. One-sentence verification plan before coding.
2. Code, tests for any pure logic, `npm test` green.
3. Real Electron run: DOM assertion on the Apps tab plus screenshots at 1440 and 390, read by you.
4. PR with an `## Evidence` section from `pr-evidence.mjs`; opus reviewer findings addressed first.

## Constraints

- One PR, branch `feat/apps-row-preview`. Data-dense UI, British English, no em-dashes, en-dashes or ellipsis characters.
- Merging and publishing are ask-first. Do not bump versions.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. A live, refreshing preview per app is a separate, larger idea: note it, do not build it.

## Why this brief is structured this way

The capture, storage and IPC already exist from #64; the failure mode is building a parallel pipeline or making rows taller. The brief pins reuse and density.