# Article notes: testing like a user when there are no users

Working material for a research article on the user-journey testing in [PROJECT-PLAN.md](PROJECT-PLAN.md). Not the article. Every fact here traces to [EVIDENCE-LOG.md](EVIDENCE-LOG.md).

## Purpose and reader

- **Purpose:** show, with evidence, a method for finding the defects real users would find, in a product that has none yet.
- **Reader:** engineering leads and founders hiring for quality or developer tooling; developers who ship solo. They have seen "we have 95% coverage" and know it predicts little.
- **What the reader should leave with:** a method they can copy (persistent world, scripted events, outside checks, an evidence log), and the specific bugs it caught that unit and screen tests missed.

## Working thesis

Tests that start fresh, check one screen and quit pass while the product misbehaves for a person using it over days. The defects live in what carries over: history that accumulates, a folder that was guessed once, a browser closed while the app was down. Testing that plays a person's week, and checks results from outside the app, finds them.

To be tested by the journeys, not assumed: the article reports what the journeys found, including if that is little.

## Candidate structure

1. The problem: no users, but a product that lives across days and restarts.
2. The first find came by accident (F1): 315 of 1000 history entries were the test suite's own servers. How one wrong guess fed itself for three weeks.
3. Why the existing suite missed it: each test is a fresh, short visit. Baseline numbers (PROJECT-PLAN, "Where testing stands").
4. The method: persistent world, events library, outside checks, screenshots read by a person, the evidence log.
5. The journeys and what each found (filled from the log as Waves 1-3 land).
6. What it cost: build time, run time, flake rate.
7. What it still cannot see (a real person's confusion; covered later by real-session tiers).

## Claims and the evidence each needs

| Claim | Evidence | Status |
|---|---|---|
| Short-visit tests missed a self-feeding history bug for 3 weeks | F1 dates (2026-10-14 to 2026-11-06), count 315/1000 | have |
| Outside checks catch what the app reports as fine | F2: +2 runs per pass seen only in the real `runs.json` | have |
| Screenshots catch what DOM checks pass | F4: 390 px overflow with all checks green | have |
| Journeys find defects the old suite did not | F10 (focus pulled from the field being typed in, on every 5 s refresh: no short visit sat in a drawer that long), F14, F15 | started (3 from Wave 1) |
| The method is affordable | wall time per journey, flake rate over N runs | needed (Wave 3) |
| A failed check is not a finding until the screen is read | F12: 2 failures, screen correct (test bugs) | have |

## Editorial rules for the draft

- Facts only; every percentage carries its N ("315 of 1000", not "a third").
- No metaphor standing in for a number. No em or en dashes, no ellipses in published text.
- First person, plain voice: draft with `/voice`, then a `/humanizer` pass.
- Show the failure before the fix; show a check's code next to what it caught.
- Report flakes and test bugs (F3, F5, F6) honestly; they are part of the method's cost.

## Privacy scrub before anything is published

- No real browser profile names, client names, client sites or personal paths. Journeys use neutral names (`shop`, `blog`).
- Screenshots come from throwaway worlds only, never the developer's real install.
- Paths in quotes are generalised (`%TEMP%/.../zz-demo-2`), not the full machine path.

## Assets to collect as we go

| Asset | Source | Status |
|---|---|---|
| History > Browsers at 1440 and 390, before/after the overflow fix | redesign-history-browsers screenshots | have (local, regenerate for publication) |
| `runs.json` before/after counts for F1 | EVIDENCE-LOG cleanup table | have |
| A journey timeline diagram (days x events x checks) | to draw from PROJECT-PLAN | needed |
| One journey's step log (JSONL) excerpt | `test-results/journeys/day-one-*/journey.jsonl` (local, gitignored; regenerate for publication) | have |
| F10 before/after: the saved name `shop52068`, the focus check reading `My app` then `3000` | EVIDENCE-LOG runs 20:24 to 20:27 | have |
