# Browser profiles, slice 2 (surfaces) Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-browser-profiles-surfaces/`. Don't carry context from the current session.

## First action: rebase before doing anything else

This worktree was created from `origin/master` at scaffold time. Other PRs may have merged since, so **before reading anything else or writing code**, run:

```bash
git fetch origin master --quiet
git rebase origin/master
```

Resolve any conflicts now. Slice 1 (PR #79, merge commit d26f9cb) must already be in your history; if `src/core/browserRun.js` is missing, stop and say so.

## The problem

Slice 1 shipped the browser-profile core (store, detection, start/stop/status, port reservation warning) with only a CLI. Macdara wants Claude, and sometimes a local LLM, to start and use named debug browsers through PortPilot. A model must never pick a port itself: it asks for a profile by name and PortPilot supplies the port and the CDP URL. Local LLMs may not speak MCP, so there must also be a plain HTTP way in. Reserving a port per profile is already done (warn only); this slice makes it reachable.

## Source of truth (read these BEFORE coding)

1. `docs/claude-integration/PROJECT-PLAN.md`, row 26 (scope and slices). If this brief contradicts it, the plan wins.
2. The merged slice 1 files: `src/core/browserProfiles.js`, `browserRun.js`, `browserDetect.js`, `browserCdp.js`, and `scripts/browser-profiles.js`. Their error codes (`PORT_HELD`, `NOT_OURS`, `NOT_VERIFIED`, `BROWSER_NOT_FOUND`, `START_TIMEOUT`, `ProfileError` codes) are the contract the surfaces expose.
3. `mcp-server/index.js` and `tests/mcp-*.test.mjs`: how tools are registered, how the server loads core copies, how guard and provenance work.
4. `src/agent/server.js`: the token-protected HTTP agent (Host, Origin and token checks, API route pattern).
5. `scripts/build-plugin.mjs` and `docs/CLAUDE-TODO.md` ("Share one run filter"): how core files reach the MCP server and plugin bundle as `.cjs` copies.
6. `src/core/configFile.js` (`recordStart`, the `portpilot-runtime.json` sidecar): the model for the claim marker.

## What's in scope

- **MCP tools** (small surface, plain names): `list_browser_profiles`, `list_browsers`, `start_browser`, `stop_browser`, `set_browser_mode`. `start_browser` and status return `{ name, port, cdpUrl, state, warning? }` so a model never chooses a port.
- **HTTP endpoints** on the web agent for harnesses without MCP, same token and Host/Origin protection as the existing routes, same result shapes.
- **Advisory claim marker**: who started or holds a profile (a Claude session id, or an agent name a caller supplies), stored beside the config in the runtime sidecar style, shown in status. Advisory only: it never blocks a start or stop.
- **Packaging fix**: the MCP server and plugin bundle must load the browser core modules (`browserProfiles`, `browserRun`, `browserDetect`, `browserCdp`, plus what they require) the same way they load `configFile`/`status`/`runHistory`. Add a test that fails if the bundle is missing one.
- Tests for each surface, using temp config dirs and the slice 1 fake-spawner pattern. Add them to `npm run test:mcp` or `test:unit` as fits.

## Out of scope (do NOT modify)

- Desktop renderer panel, web portal UI, VS Code view (slice 4 and later).
- Run history integration (slice 3).
- `src/core/observe.mjs` (9 review rounds, leave alone).
- Firefox and Safari.
- Behaviour of the slice 1 safety rules: never kill a process that is not this profile's own browser. Surfaces call the core; they do not bypass it.

## What "good" looks like

- A model calls `start_browser { name }` and gets back a port and CDP URL it can use, or a one-sentence error that names the holder of a blocked port.
- Error messages are written for weaker local models: plain sentence, the code, and the one action to take.
- The same call over HTTP returns the same shape as over MCP.
- A second caller sees who claimed the profile, and is still allowed to proceed.
- The packaged MCP server and plugin bundle start and answer the new tools (extend `tests/packaged-mcp-smoke.cjs` if it fits).

## Required deliverables

1. A short design note in the PR description before code is judged: tool names and result shape, HTTP routes, where the claim marker lives, how the bundle gets the new modules.
2. The code and tests above.
3. Verification: tests pass in CI on Ubuntu and Windows, plus one real round trip with Brave on Windows through the MCP tool and through HTTP: start, status, stop on a throwaway port such as 9390 using a throwaway `--config`. Show the output.
4. Opus reviewer pass (a separate agent given the diff and evidence, not your reasoning) before the PR opens.
5. PR with an `## Evidence` section from `pr-evidence.mjs`.

## Suggested workflow

1. Read the source-of-truth files, then write the design note.
2. `/tdd` where a test runner exists: one failing test, then code.
3. Build the packaging fix first (nothing else can be tested through MCP without it), then MCP tools, then HTTP, then the claim marker.

## Constraints

- One PR. Branch: `feat/browser-profiles-surfaces`. Model: Sonnet 5.5 high.
- Never drive or close Macdara's running profiles (9226, 9228, 9240 are up and signed in) or touch ports 9222-9240; use a throwaway port and profile dir only.
- Browser automation here is Brave (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`), never Chrome or Edge, per his rules.
- Do not commit anything from his `pool.json` (descriptions contain client names).
- Keep the tool count small: every extra tool costs a local model accuracy.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. Do not fix inline. Already known: a cached port-holder lookup for polling, the config restore dropping `browserProfiles`, offscreen on macOS and Wayland.

## Why this brief is structured this way

Surfaces are where a wrong default hurts: a tool that lets a model choose ports, or an HTTP route that bypasses the ownership check, undoes the slice 1 safety work. The brief points every surface back at the slice 1 error contract and keeps the claim marker advisory so two agents are warned, never deadlocked.