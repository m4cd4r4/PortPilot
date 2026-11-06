# User journeys - Project Plan

Goal: test PortPilot the way a real person uses it, over several days, restarts and overlapping events, with no real users to watch. Each journey keeps one config folder across app launches, plays a script of events (servers start and crash, a stranger takes a port, Claude sessions lease browsers, PortPilot quits and comes back) and checks every step from outside the app: files on disk, ports, Brave's own debug port, the rendered screen.

Guiding constraint: **a check reads the outcome, never the app's own word for it.** A green row in the UI is not proof a server answers; the port answering is.

Second constraint: every run is recorded in [EVIDENCE-LOG.md](EVIDENCE-LOG.md). This work doubles as a published case study ([ARTICLE-NOTES.md](ARTICLE-NOTES.md)), so the log is the source for every number in it.

Scope chosen 2026-11-06: desktop app + MCP (Claude sessions simulated by MCP calls and heartbeat files). Runs on every PR (short journeys) and before every version bump (full week, installed exe).

## Where testing stands (2026-11-06 baseline)

| Fact | Evidence |
|---|---|
| 10 e2e specs, each one short visit: fresh config, one screen, quit | `tests/*.e2e.js` |
| CI runs no e2e at all: unit, MCP and a packaging smoke only | `.github/workflows/ci.yml` |
| `npm run test:e2e:ui` skips 2 of the 9 redesign specs (`redesign-tiles`, `redesign-history-browsers`) | `package.json` |
| 7 specs named in `docs/SCENARIOS.md` no longer exist (retired with the v3 UI) | `desktop-detect`, `desktop-apps`, `desktop-preview`, `browsers-ui`, `browsers-history`, `browsers-purpose`, `history-ui` |
| No spec relaunches the app against the same data | none |
| The v5 UI has no crash toast, Ask Claude or Re-run this version (v3 had all three) | `ui/src` - decided: toast back, the other two retired (see Decisions) |

## Status table

| # | Slug | Scope | Status | Wave |
|---|------|-------|--------|------|
| 0 | journeys-plan | This plan, evidence log, article notes; add the 2 skipped specs to `test:e2e:ui` | merged (PR #208) | 0 |
| 1 | journey-kit | `tests/journeys/kit.js`: persistent world, relaunch, events library (below), outside-checks, screenshot checkpoints, JSONL step log | materialised | 1 |
| 2 | journey-day-one | Journey A, day 1: fresh install, add apps, start, crash, detected terminal server, stranger on a port | materialised (`npm run test:journeys`, 62 checks with the crash toast, ~95 s) | 1 |
| 3 | journey-restarts | Journey A, days 2-3: quit with servers and browsers up, close a browser outside PortPilot, relaunch; runs adopted or closed, nothing duplicated, prefs kept | materialised (`node tests/journeys/restarts.journey.js`, 75 checks, ~145 s; open defects kept as KNOWN OPEN notes, F42-F46) | 2 |
| 4 | journey-claude-sessions | Journey B: two simulated Claude sessions via MCP: `start_browser` for a site, `IN_USE`, stale heartbeat, `start_app` stamped `claude <id>`, browser history "started by claude" | materialised (`node tests/journeys/claude-sessions.journey.js`, 66 checks, ~175 s) | 2 |
| 5 | journey-long-haul | Journey C: aged history (seeded 1000+ runs, 2 weeks), caps, filters, Open again, Scenes, 390 px | materialised (`node tests/journeys/long-haul.journey.js`, 66 checks, ~90 s; `npm run test:journeys` now runs all four journeys in turn) | 2 |
| 6 | journeys-ci | Short journeys on every PR (Windows runner); full set as a pre-release gate against the installed exe; SCENARIOS.md rows point at real files | later | 3 |

Status vocabulary: `later` / `materialised` / `merged (PR #N)` / `superseded`.

## Wave structure

- **Wave 0:** this plan and the records. Lands first so every later run is logged from its first result.
- **Wave 1:** the kit and the first journey together: the kit is shaped by one real journey, not designed in the abstract.
- **Wave 2:** restarts, Claude sessions, long haul. Independent of each other once the kit exists; can run in parallel worktrees.
- **Wave 3:** CI wiring and the release gate. Re-scope after Wave 2: how long the journeys take decides what runs per PR.

Per the wave-gate rule, Wave N+1 scope is a guess until Wave N lands - re-plan at each gate.

## The events library (Wave 1)

Each event changes the world the way a person or another program would, never through a test-only door into the app.

| Event | How |
|---|---|
| `launch()` / `quit()` / `relaunch()` | Playwright Electron against the same config folder; `quit` can be clean or a hard kill |
| `startServer(name, opts)` | A real `node` server in a project folder, from a "terminal" (not PortPilot), marked `--portpilot-test` |
| `crash(app)` | The app's server exits non-zero after N seconds |
| `holdPort(port)` | A stranger process takes a port |
| `claudeSession(id)` | Heartbeat file in `sessions/`, plus MCP calls over the desktop's HTTP endpoint |
| `closeBrowserOutside(profile)` | Close Brave through its own debug port while PortPilot watches, or while it is down |
| `ageHistory(days)` | Shift timestamps in `runs.json` / `browser-runs.json` between launches (no fake clock in the app) |
| `resize(w)` / `screenshot(name)` | 1440 and 390 checkpoints, read by a person before a journey is called passing |

## Checks, per step

| Kind | Reads |
|---|---|
| Files | `portpilot-config.json`, `history/runs.json`, `history/browser-runs.json`, `sessions/`, claims |
| Ports | the app's port answers HTTP; a stopped app's port is free |
| Browser | Brave's `/json` and `/json/version` on the profile's debug port |
| Screen | DOM text and state attributes; screenshots at checkpoints |
| Leakage | the developer's real `%APPDATA%/portpilot/history/runs.json` gains no runs during a journey |

## Model routing

Default for all work: **Opus 5.5 on medium**.

| Work | Model / effort | Why |
|---|---|---|
| Wave 1: journey-kit | **Opus 5.5, high** | every later journey inherits its shape; relaunch and cleanup bugs here look like app bugs |
| Wave-boundary review of each diff | **Sonnet 5.5, medium** | writer/reviewer separation; fresh context |
| Everything else | **Opus 5.5, medium** | fully constrained by this plan |

## Decisions (2026-11-06, Macdara)

- CI e2e runs on Windows only. The full week against the installed exe is the pre-release gate.
- Ask Claude (the v3 crash-toast button) is retired as redundant; its SCENARIOS row is removed.
- Version bump to 5.1.0 (desktop + plugin) waits until after the journeys and an in-app check. Publishing is ask-first every time.
- The crash toast comes back in the v5 UI (Restart / Logs / Dismiss, no Ask Claude). A crash stays on the card and in the alerts bell across relaunches until the app starts again or is dismissed from the bell; the bell counts crashes. History "Re-run this version" is retired with its SCENARIOS row. (F14, F16; crash-toast PR)

## Open questions (ask at the Wave 2 gate)

None open. Wave 2 journeys (rows 3-5) may start in parallel worktrees.

## What Wave 1 taught the kit

- Find drawer fields by placeholder, not label: labels hold their buttons' text (F11).
- A failed check is not a finding until the screenshot is read (F12: two failures, screen correct).
- Test servers stay marked; the app under test counts them only on the ports the journey names (F13).

## What Wave 2 taught the kit

- One HTTP request per MCP call, no kept-alive agent: a reused socket dies on the server's keep-alive timer (F25).
- Electron helpers outlive the main process by seconds: teardown checks journey ports at once, world processes after a timed grace (F26).
- A guard that protects real data throws; a recorded check that lets the run continue is no guard (F29).
- Journeys run one at a time on one machine: parallel runs produced the only unexplained stops (F27).

## What this plan does NOT cover

- A real `claude` session in a pty (later tier; MCP calls stand in for it here).
- The VS Code extension and the web portal.
- Performance and load beyond the history caps.
- Writing the article itself: [ARTICLE-NOTES.md](ARTICLE-NOTES.md) collects material; drafting is a separate task.
