# VS Code row preview Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-vscode-row-preview/`. Don't carry context from the current session.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

Do this before reading anything else. Other PRs may have merged since scaffold time.

## The problem

PortPilot 3.6.0 (desktop) shows a 32 x 18 px page thumbnail on running app rows (plan row #23, PR #69). The VS Code extension (3.4.0, `vscode-extension/`) has no thumbnail code, so Macdara cannot see previews of his running localhost pages in VS Code. This is plan row #25 in `docs/claude-integration/PROJECT-PLAN.md`.

## Source of truth (read these first)

1. `docs/claude-integration/PROJECT-PLAN.md`, rows #21, #23, #25
2. `vscode-extension/src/appsTreeProvider.ts` and `vscode-extension/src/treeModel.ts` (the Apps tree)
3. The desktop row-thumbnail rule from PR #69: find it with `git show 83dbd14 --stat` (a `rowThumbs` module plus the `history:rowThumbs` IPC). Rule: the newest open run per app, shown only when the app has a runtime record and the live port matches the open run's port.
4. `src/core/runHistory.js` and `src/core/runView.js` (run records and `page.thumb`)
5. `vscode-extension/src/config.ts` (how the extension reads PortPilot's config and runtime files)

If anything here contradicts those files, the files win.

## In scope

- The extension's Apps tree: a thumbnail on running app items.
- Reading run records and thumbnails from the same on-disk store the desktop writes.
- Extension tests for the new rule.

## Out of scope (do NOT modify)

- `src/core/observe.mjs` (9 review rounds, leave alone).
- The desktop renderer, the web portal, the MCP server.
- Extension version: it stays 3.4.0 in this PR. The release and publish are a separate ask-first step.

## What "good" looks like

- A running app with a recorded page thumbnail shows it in the VS Code tree. Stopped apps and apps without a thumbnail look exactly as before.
- No new network access; thumbnails never leave localhost.
- A setting turns previews off (mirror the desktop's "Show page previews on running apps").

## Required deliverables

1. **Spike first, report before building:** can a `TreeItem` show a 32 x 18 image (an `iconPath` URI to the thumbnail file, or a data URI) or does it need a hover `MarkdownString` image? State the result in one paragraph, then build the variant that works. Fallback: a hover card.
2. Code change scoped to the in-scope list, with tests.
3. Verification: build passes, tests pass, and a screenshot of the tree in a real VS Code window. Read the screenshot yourself.

## Suggested workflow

1. Read the source-of-truth files.
2. Do the spike and report.
3. Build, test, screenshot.
4. Opus reviewer pass (separate agent, given the diff and evidence, not your reasoning) before the PR.
5. PR with an `## Evidence` section from `pr-evidence.mjs`.

## Constraints

- One PR. Branch: `feat/vscode-row-preview`. Model: Sonnet 5.5 high.
- To screenshot, run the extension in a throwaway Extension Development Host: a throwaway `--user-data-dir` AND `CLAUDE_CONFIG_DIR=<tmp>\claude-config`, say you are launching one, and never sign in inside it. An EDH launch kills every open VS Code window unless these are set, per `~/.claude/rules/dev-environment.md`.
- Windows: the VS Code window should show real PortPilot data, so use the demo seed or a throwaway config, never Macdara's real app list.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. Do not fix inline.

## Why this brief is structured this way

The desktop feature (#69) took the same shape: spike, build, look at a screenshot. Capturing a bad assumption early (can a TreeItem hold an image?) costs minutes; discovering it after building costs the PR.