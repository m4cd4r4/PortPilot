# Evidence log

The record behind every claim about PortPilot's testing. Append-only: correct a wrong entry with a new dated entry, never by editing the old one. Times are AWST (UTC+8).

Every number published about this work (see [ARTICLE-NOTES.md](ARTICLE-NOTES.md)) must trace to a row here.

## How to add an entry

- **Findings:** one row per defect or gap, found by any test, review or accident. `Found by` names the check that saw it. `Real?` is `real`, `flake` or `test bug`. `Fixed in` is a PR number or `open`.
- **Runs:** one row per journey or suite run that is worth citing: date, build (commit or installed version), what ran, checks passed/failed, wall time.
- **Before/after numbers** need the measurement both times, by the same check.

## Findings

| # | Date | Finding | Found by | Real? | Fixed in |
|---|---|---|---|---|---|
| F1 | 2026-11-06 | 315 of 1000 runs in a real install's history were test servers, all filed under one leftover temp folder (`.../zz-demo-2`). A relative `node server.js` was matched to recent run folders; one wrong match kept that folder recent, so every later test server matched it too (first 2026-10-14, last 2026-11-06). | Reading the real `runs.json` while checking a handover note | real | #206 |
| F2 | 2026-11-06 | With #206 installed, each e2e pass still added 2 runs (`node -e ... 'held'`, the harness's port blocker). | Outside check: real `runs.json` count before and after an e2e pass | real | #207 |
| F3 | 2026-11-06 | First fix for F2 broke 3 suites: `node -e <code> --flag` exits with `bad option`, so the port was never held. | The 3 suites' own checks (bell count, blocked tile) | test bug | #207 (uses `-- --flag`) |
| F4 | 2026-11-06 | History rows overflowed at 390 px: the page scrolled sideways and the Open again button sat on the text. Letter tiles were clipped at row height. | Reading the 390 and 1440 screenshots (all DOM checks had passed) | real | #205 |
| F5 | 2026-11-06 | A filter field received a stray `-` mid-test: real keystrokes from the desktop reached the focused test window. | A failing check, then the screenshot showing the `-` | test bug | #205 (blur after clearing) |
| F6 | 2026-11-06 | The alerts popover check failed once, passed on rerun; code untouched by the change under test. | `redesign-shell` | flake | open (watch) |
| F7 | 2026-11-06 | `npm run test:e2e:ui` skipped 2 of 9 redesign specs, so they never ran outside a manual run. | Reading `package.json` while planning | real | docs/journeys-plan PR |
| F8 | 2026-11-06 | 7 specs named in `docs/SCENARIOS.md` no longer exist; their scenarios (auto-detection, crash toast, re-run, browser lease) have no e2e. | Checking every spec name in SCENARIOS.md against `tests/` | real | open (Waves 1-3) |
| F9 | 2026-11-06 | CI runs no e2e: unit, MCP and a packaging smoke only. | Reading `.github/workflows/ci.yml` | real | open (Wave 3) |

## Runs

| Date | Build | What ran | Result | Wall time | Note |
|---|---|---|---|---|---|
| 2026-11-06 | branch of #205 (source) | 9 redesign specs + browser IPC unit | all pass after rerunning 1 flake (F6); per-spec totals not kept | not recorded | first full pass with the Browsers history view |
| 2026-11-06 | b958a6a, packaged (`win-unpacked`) | history-browsers, localhost, browsers, tiles | 106/106 | not recorded | packaged build before install |
| 2026-11-06 | b958a6a installed; specs from #207 branch | localhost, scenes, shell, browsers, web-portal-tabs | 115/115; real `runs.json` +0 runs | not recorded | outside check for F1/F2 |

## Cleanups done on real data

| Date | What | Backup | Before | After |
|---|---|---|---|---|
| 2026-11-06 | Removed junk test runs (F1, F2) from the developer's real `runs.json`, with consent | `runs.json.bak-2026-11-06` | 1000 runs | 634 runs (366 removed, 33 of them still marked open) |
