# Browser profiles, slice 1 (core) Brief

Open this in a **fresh Claude Code session** in `I:/Scratch/PortPilot-2026-browser-profiles-core/`. Don't carry context from the current session.

## First action: rebase before doing anything else

```bash
git fetch origin master --quiet
git rebase origin/master
```

Do this before reading anything else. Other PRs may have merged since scaffold time.

## The problem

Macdara runs automated browsers on dedicated debug ports (9222-9230, 9240), one profile per project, so parallel Claude sessions do not collide. Today this is a personal CLI (`~/.claude/tools/brave-pool/brave-pool.mjs`) plus a personal `pool.json`: there is no view of what is up, no history, and it only works for him. Plan row 26 (`docs/claude-integration/PROJECT-PLAN.md`) moves it into PortPilot so any user gets it. This brief is **slice 1 of 4: the core only**, with no UI and no MCP tools yet.

## Source of truth (read these first)

1. `docs/claude-integration/PROJECT-PLAN.md`, row 26 (scope, slices, open questions). If this brief contradicts it, the plan wins.
2. `~/.claude/tools/brave-pool/brave-pool.mjs` (the working launcher: CDP probes, modes headed / offscreen / headless, up / down / status) and `~/.claude/browser-profiles/pool.json` (the profile shape to import). Read, do not depend on them at runtime.
3. `src/core/configFile.js` (locked read-modify-write) and `src/core/status.js` (how the app tracks listening ports and conflicts).
4. `src/core/runHistory.js` (pattern for best-effort local records; slice 3 will use it).
5. `src/core/conflict.js` (how a port-conflict warning is shaped; reuse for the reservation warning).

## In scope

- `src/core/browserProfiles.js` (new): profile store in the PortPilot config (name, port, browser, mode, url, note), validation (port range, unique port and name, a dedicated user-data-dir per profile under PortPilot's userData dir).
- Browser detection (Chromium family: Chrome, Edge, Brave, Chromium, Opera, Vivaldi) on Windows, macOS and Linux, returning installed executable paths.
- start / stop / status per profile: launch with `--remote-debugging-port`, `--user-data-dir`, the mode flags (headed; offscreen = window placed off-screen; headless = `--headless=new`), verify the port answers over CDP `/json/version`, stop by PID.
- One-time import from a `pool.json` path (a function and a CLI flag; never read automatically).
- Reservation check: a profile's port held by a different process yields a warning object (warn only, nothing is killed or blocked).
- Unit tests with a fake spawner and a fake CDP endpoint.

## Out of scope (do NOT modify)

- Desktop renderer, web portal, MCP server, VS Code extension: slices 2 and 4.
- Run history integration: slice 3.
- `src/core/observe.mjs` (9 review rounds, leave alone).
- Firefox and Safari (see the plan row).

## What "good" looks like

- With no `pool.json` present, the core works from an empty profile list on all three OSes.
- Importing Macdara's `pool.json` yields 10 profiles with the same ports and modes.
- Starting a profile whose port is already held by another process fails by name and reports the holder; it never kills it.
- Every profile uses its own dedicated user-data-dir (Chrome refuses a debug port on its default profile folder).

## Required deliverables

1. A one-paragraph design note in the PR description before code is judged: data shape, where the user-data-dirs live, how offscreen is implemented per OS.
2. The code and tests above.
3. Verification: tests pass in CI on Ubuntu and Windows, plus one real start / status / stop of a throwaway profile with Brave on Windows (a throwaway port such as 9390, never 9222-9240). Show the output.

## Suggested workflow

1. Read the source-of-truth files, then write the design note.
2. `/tdd` where a test runner exists: failing test, then code.
3. Opus reviewer pass (a separate agent given the diff and evidence, not your reasoning) before the PR.
4. PR with an `## Evidence` section from `pr-evidence.mjs`.

## Constraints

- One PR. Branch: `feat/browser-profiles-core`. Model: Sonnet 5.5 high.
- Never drive or close Macdara's running profiles (9226, 9228, 9240 are up and signed in); use throwaway ports and profile dirs only.
- Browser automation here is Brave (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`), never Chrome or Edge, per his rules.
- Do not commit anything from `pool.json` (descriptions contain client names); test fixtures use invented names.

## Out-of-scope follow-ups (capture, don't build)

Append to `docs/CLAUDE-TODO.md`. Do not fix inline.

## Why this brief is structured this way

The feature is large (L). Slicing it as core first keeps the first PR reviewable and testable without UI, and the import-not-depend rule stops PortPilot from inheriting a layout only one person has.