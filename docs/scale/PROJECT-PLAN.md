# Scale and noise - Project Plan

Goal: make the desktop app work for someone with well over a hundred registered apps and a dozen or more browser profiles. An audit on 2026-11-11 ran the master build against a copy of a real config (167 apps, 18 profiles, no groups) and found that the problems at that size are noise and list length, not visual style.

Guiding constraint: **every PR is checked against a copy of a large real config as well as the three-app fixtures.** The fixtures hid all of the findings below.

Out of scope: a rewrite in another language or framework (rejected: the JS core is shared by the desktop app, the VS Code extension and the MCP server), and new VS Code extension features.

## Audit findings (2026-11-11)

| # | Finding | Evidence |
|---|---|---|
| A1 | A stopped app whose port is in use is shown as "blocked", sorted above running apps, and counted on the Alerts badge. With 39 of 167 apps sharing 18 ports, the badge read 7 with nothing wrong. | Apps Rows, real-config copy |
| A2 | 167 apps in one alphabetical list, 105 of them stopped, none grouped. Names cluster by project (25, 16, 14, 14, 10...). | Apps Rows |
| A3 | Apps Cards view: most cards are a near-blank screenshot or a large letter. Tiles has the same blanks, smaller. | Apps Cards, Apps Tiles |
| A4 | Home: three tile sizes; one running tile in a full-width box; 3 browser tiles for 4 open profiles; blank tiles in Recently used; a running app repeated in Recently used. | Home at 1440 and 390 |
| A5 | Home says "1 of 127 apps" while Apps says 167. Not traced. | Home, Apps |
| A6 | Home flashes "Welcome to PortPilot" with a clipped button while loading, even when apps exist. | Home at launch |
| A7 | `tests/redesign-shell.e2e.js` fails on master twice in a row: "timed out waiting for popover names the port". CI does not run e2e specs. | Local run, 2026-11-11 |
| A8 | The UI re-fetches every 5 s and the thumbnail poller ticks every 2 s; the app used about 2% of one core over 37 hours. Not checked whether these pause when the window is hidden. | `ui/src/App.tsx`, `src/main/thumbnails.js`, process CPU time |
| A9 | Ports: every row has a Kill button, including system services. | Ports |

## Decisions (2026-11-11)

| Topic | Decision |
|---|---|
| Blocked warnings | Warn only at Start. A stopped app stays "stopped"; the Alerts badge counts crashes and failed starts only. |
| Grouping | Automatic, by project folder: apps in the same repo or its worktrees share a group. A wrong guess can be moved by hand. |
| Stale apps | Apps not run in 30 days fold under a "Show older" line. Nothing is deleted; search still finds them; running one brings it back. |
| Apps Cards view | Removed from Apps. Browsers keeps Rows, Tiles and Cards. |
| Home | Reworked last, chosen from live previews. |

## Status table

| # | Slug | Scope | Status |
|---|------|-------|--------|
| 1 | quiet-alerts | A1, A7. Stopped apps are never "blocked"; Start reports a taken port; Alerts badge counts crashes and failed starts. Diagnose and fix the popover spec. | done, PR #221 (EVIDENCE-LOG F110-F115) |
| 2 | apps-by-project | A2. Group by project folder; fold apps not run in 30 days. | todo |
| 3 | drop-apps-cards | A3. Remove Cards from Apps; migrate a saved "cards" preference to Tiles. | todo |
| 4 | home-rework | A4, A5, A6. One tile size, no blanks, no duplicates, counts that agree with Apps. Picked from live previews. | todo |
| 5 | idle-polling | A8, A9. Measure first; pause polling when the window is hidden if it does not already. Dim or separate system ports. | todo (measure first) |

One PR per row, merged in order. Each PR adds its findings to `docs/testing/EVIDENCE-LOG.md` and its line to `CHANGELOG.md` under Unreleased.

## Checks for every PR

- `npm run test:unit` and the redesign e2e specs pass (run one at a time; they use real ports).
- Screens read at 1440 and 390 wide, with the fixtures and with a copy of a large real config.
- Screenshots of a real config are never committed: this repo is public.
- No version bump and no release inside these PRs.
