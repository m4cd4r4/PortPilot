# #15 guard-hardening: make the dev-server guard pass when unsure Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-guard-hardening/`. Do not carry context from the session that wrote this.

Plan row: #15 of [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md), Wave 3, Track A. Model routing: **Opus 5.5, high** (the guard blocks the user's own tool calls; a wrong deny or reroute is costly).

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

#16 crash-truth runs in parallel and edits one line of `plugin/hooks/guard-core.mjs` (the crash rule in `appStates`, around L90). If it merged first, rebase onto it; do not touch that rule yourself.

## The problem

The C3 dev-server guard (PR #48) intercepts Bash tool calls that start a dev server. A Wave 2 review, with probes run against the merged code, found it acts on commands it does not understand:

1. **Wrong app started.** `cd api && npm install && npm run dev`: `parseStart` drops the `cd` when a non-cd step precedes the start (`guard-core.mjs` around L165-168), `startDir` falls back to the session cwd, and the guard routes `start_app` for the app registered *there*. `npm install` never runs. On a busy port the same command is wrongly denied. `tests/plugin-mod.test.mjs:127` asserts the current behaviour.
2. **Command silently truncated.** A route replaces the whole Bash call with one `start_app` (`plugin/hooks/register.ts` around L151-169). `npm run dev | tee dev.log` and `... || echo fail` lose the pipe and the fallback.
3. **False collisions.** Only an inline `PORT=` prefix or a flag is read. `export PORT=3005 && npm run dev` is judged against preferredPort; `npm run preview` (vite binds 4173) is denied as "already running on :3000".
4. **Wrong holder named.** Two apps sharing a preferredPort: the deny names the wrong app and the status line counts both as up (`guard-core.mjs` around L246-253, L89).
5. **Failed start reported as success.** The route checks only `ran.deny`; an MCP `isError` from `start_app` may be reported as "PortPilot started X". Unconfirmed: check how the hooks engine surfaces `isError`.
6. **Cwd source.** `startDir` starts from `$.session.cwd()` (`register.ts` around L142). Check whether that follows the Bash tool's persisted cwd after an earlier `cd`. Unconfirmed.

## Source of truth (read these BEFORE coding)

1. [docs/claude-integration/PROJECT-PLAN.md](../claude-integration/PROJECT-PLAN.md): row #15 and row #7.
2. [plugin/hooks/guard-core.mjs](../../plugin/hooks/guard-core.mjs): `parseStart`, `startDir`, `targetPort`, `decide`.
3. [plugin/hooks/register.ts](../../plugin/hooks/register.ts): the `tool.call` hook, the route and the deny.
4. [tests/plugin-mod.test.mjs](../../tests/plugin-mod.test.mjs) and [plugin/hooks/register.test.ts](../../plugin/hooks/register.test.ts).
5. [src/core/conflict.js](../../src/core/conflict.js): the conflict wording the deny uses.

The files win over this brief.

## The rule this row establishes

**When the guard is not certain, it passes.** Deny only when it knows the target app and that its port is held by something else. Route only a bare start with no other steps, pipes, `||` or redirects around it. Everything else passes untouched.

## What's in scope

- `plugin/hooks/guard-core.mjs`, `plugin/hooks/register.ts`, and the built hook output if the plugin commits one (check `npm run build:plugin` and its `--check`).
- Tests for each of the six cases in `tests/plugin-mod.test.mjs` (part of `test:unit`, so CI runs it). Rewrite the L127 assertion. `register.test.ts` needs the `claude` CLI and CI skips it, so keep logic in pure functions that `plugin-mod.test.mjs` can reach.
- The plan row #15 status flip, in the same PR.

## Out of scope (do NOT modify)

- The crash rule in `appStates` (#16 owns it).
- `src/main/*`, the renderer and the VS Code extension.
- The status line format.
- The MCP server tools.

## Required deliverables

1. Every case above has a test that fails before the fix and passes after. Cases 5 and 6: if they prove not to be bugs, write the test that proves it and say so in the PR.
2. `npm run test:unit` and `npm run test:mcp` green; `npm run build:plugin -- --check` (or the repo's equivalent) clean.
3. A live check in a real session with `--plugin-dir plugin`: a busy-port start is denied, a free-port bare start routes, and `cd <sub> && npm install && npm run dev` passes untouched. Do not put `npm run dev -- --port <busy>` in a Bash command in your own session: the user-level dev-server-guard hook blocks it. Use a headless probe as #7 did.
4. `/commit` with the generated evidence section.

## Constraints

- One PR. Branch: `feat/guard-hardening`.
- No new dependencies.
- Never switch branches in the primary checkout `I:/Scratch/PortPilot-2026`.
- **After the PR merges, do NOT run `wt-finish.sh` from inside this worktree.** Report "merged" and stop. The ux-row-state session removed its own worktree that way and left Macdara with a blank window. Cleanup runs from another session.

## Out-of-scope follow-ups

Append to the plan under Wave 3 notes, or to `C:/Users/Hard-Worker/Obsidian/Second-Brain/wiki/backlog/PortPilot.md`. Do not fix inline.