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
| F10 | 2026-11-06 | Add app drawer: every 5 s refresh pulled focus back to Name, so text typed in another field landed in Name. The journey saved an app called `shop52068` (its port typed into Name). Same pattern in the browser and scene drawers. | day-one journey: outside check of the config file, then a focus check (click Port, wait 6.5 s, read the focused field: before the fix `My app`, after `3000`) | real | journey-wave1 PR |
| F11 | 2026-11-06 | Drawer fields found by label matched two inputs: each label also holds its button's text (Browse, Free). | Playwright strict-mode error in the day-one journey | test bug | journey-wave1 PR (fields found by placeholder) |
| F12 | 2026-11-06 | Two journey checks failed while the screen was right: Rows view has no `.badge` (it says `Port held by node` in the row), and the sidebar and narrow top bar each carry a `.bell-count`. | Reading the `05-port-held` screenshot against the failed checks | test bug | journey-wave1 PR |
| F13 | 2026-11-06 | Since #207 marked test servers `--portpilot-test`, the app under test ignored them too, so no e2e could check that a terminal-started server is detected. | Planning the day-one journey's detection step | test bug | journey-wave1 PR (marker counts only on ports a test names via `PORTPILOT_DETECT_ONLY_PORTS`; an installed PortPilot never sets it) |
| F14 | 2026-11-06 | A crash is forgotten after a relaunch: blog crashed (exit 3) in the evening and read `stopped` next morning. History still has the crash. A crash also raises no alert (the bell counts port conflicts only). | day-one journey, `07-next-morning` and `03-crashed` screenshots | real | open (product question, Wave 2 gate) |
| F15 | 2026-11-06 | At 390 px the History filter placeholder is cut mid-word (`Filter runs by app, branch, p`). | day-one journey, `04-detected-in-history-390` screenshot | real | open (cosmetic) |
| F16 | 2026-11-06 | Resolution of F14, decided by the developer: the crash toast is back (`<app> crashed`, `:port · exit N`, last output lines, Restart / Logs / Dismiss, no Ask Claude); a crash stays on the card and in the bell across a relaunch until the app starts again or is dismissed from the bell; the bell counts crashes. Before: `07-next-morning` read `stopped`, bell empty after the crash. After: `crashed`, `Exited with code 3`, bell 1; Dismiss in the bell clears the runtime stamp. | day-one journey, same steps before (20:37 run) and after (21:36 run) | real | crash-toast PR |
| F17 | 2026-11-06 | F8 narrowed: the crash toast scenarios now run in the day-one journey; "Re-run this version" is retired (the v5 UI has no such button), so its SCENARIOS row is removed. The other F8 rows still point at missing specs. | Rewriting the SCENARIOS rows for the crash-toast PR | real | crash-toast PR (part of F8) |
| F18 | 2026-11-06 | The day-one journey stopped at step 2 with `page.screenshot: Timeout 30000ms exceeded`; that step runs before the code under change. The next run passed 63/63 on the same code. | day-one journey | flake | open (watch) |
| F19 | 2026-11-06 | Grouped Rows view: the header reads `All apps 2` but lists only blog; shop sits under a separate `Stopped 1` section. The count includes an app shown elsewhere. | day-one journey, `07-next-morning` screenshots at 1440 and 390 | real | open (cosmetic, product question) |
| F20 | 2026-11-06 | Resolution of a gap in F16: a crash stamp more than 7 days old no longer shows as `crashed`; the card reads `stopped` and the bell counts only the fresh crash (1). Decided by the developer. | day-one journey seeds an 8-day-old stamp for shop after quit; `07-next-morning` reads `stopped` | real | crash-stamp-age PR |

## Runs

| Date | Build | What ran | Result | Wall time | Note |
|---|---|---|---|---|---|
| 2026-11-06 | branch of #205 (source) | 9 redesign specs + browser IPC unit | all pass after rerunning 1 flake (F6); per-spec totals not kept | not recorded | first full pass with the Browsers history view |
| 2026-11-06 | b958a6a, packaged (`win-unpacked`) | history-browsers, localhost, browsers, tiles | 106/106 | not recorded | packaged build before install |
| 2026-11-06 | b958a6a installed; specs from #207 branch | localhost, scenes, shell, browsers, web-portal-tabs | 115/115; real `runs.json` +0 runs | not recorded | outside check for F1/F2 |
| 2026-11-06 20:23 | source bf20baf + journey-wave1 | day-one journey | stopped at step 2 (F11) | 9.1 s | first run |
| 2026-11-06 20:24 | same | day-one journey | stopped at step 3: app saved as `shop52068` (F10) | 35.7 s | |
| 2026-11-06 20:25 | same, before the drawer fix | day-one journey with the focus check | focus check FAIL (`My app`) | not recorded | before measurement for F10 |
| 2026-11-06 20:27 | same, drawer fix | day-one journey | 40/42 (F12) | 85.7 s | after measurement for F10: focus check PASS (`3000`) |
| 2026-11-06 20:29 | same | day-one journey | 43/43; real `runs.json` +0 of ours | 48.0 s | first clean pass; screenshots read at 1440 and 390 |
| 2026-11-06 20:30 | same | day-one journey x2 | 43/43, 43/43 | 59.1 s, 53.0 s | stability |
| 2026-11-06 20:32 | same | `npm run test:e2e:ui` (9 suites) | 197/197 | 4 min 27 s | after the drawer fix |
| 2026-11-06 20:37 | same | day-one journey (+ start command check) | 44/44; real `runs.json` +0 of ours | 45.7 s | |
| 2026-11-06 21:36 | source d1f1854 + crash-toast | day-one journey with the crash toast steps | 62/62; real `runs.json` +0 of ours | 94.3 s | after measurement for F14/F16; screenshots read at 1440 and 390 |
| 2026-11-06 21:37 | same | `npm run test:e2e:ui` (9 suites) | 197/197 | about 4.5 min | before the review fixes |
| 2026-11-06 21:48 | same + review fixes (outside stop, restart and dismiss races, restart errors, Logs fallback) | day-one journey | 62/62 | 86.5 s | screenshots read at 1440 and 390 |
| 2026-11-06 21:50 | same | `npm run test:e2e:ui` | stopped in `redesign-shell` at the alerts popover check (F6 again); the 8 later suites did not run | 36 s | |
| 2026-11-06 21:52 | same | `redesign-shell` x3, then the other 8 suites one by one | 22/22 x3; 175/175 (197 in all) | 223 s for the 8 | F6 is a flake: same build, three clean reruns |
| 2026-11-06 22:14 | c78e736 + crash-stamp-age | day-one journey with an 8-day-old crash stamp | 63/63; real `runs.json` +0 of ours | 94.2 s | previous attempt stopped at step 2 (F18); screenshots read at 1440 and 390 |

## Cleanups done on real data

| Date | What | Backup | Before | After |
|---|---|---|---|---|
| 2026-11-06 | Removed junk test runs (F1, F2) from the developer's real `runs.json`, with consent | `runs.json.bak-2026-11-06` | 1000 runs | 634 runs (366 removed, 33 of them still marked open) |
