# Hokusai shadow-mode survival report

- generated_at: 2026-09-26T00:00:00.000Z
- horizon: 30 days
- shadow rule: `placeholder-untested-risky-change/v1` — flag when risk_level is medium or high, requires_tests is true, and tests_changed is false (placeholder rule, no trained model yet)
- inputs read: 14
- shadow mode (Arbiter §15.4 step 1): nothing in this report is surfaced on any PR

## golden/alpha

- PRs seen: 8 (labelled at 30d: 8)
- outcomes at 30d: survived 2, followup 1, substantially_rewritten 2, reverted 2, missing 1
- 30-day survival rate: 28.6% (2/7 known outcomes)
- would-be flags: 4 flagged, 2 not flagged, 2 unknown (placeholder rule, no trained model yet)
- would-be flag rate: 66.7% (4/6 decided)
- would-be precision: 66.7% (TP 2, FP 1; placeholder rule, no trained model yet)

## golden/bravo

- PRs seen: 4 (labelled at 30d: 4)
- outcomes at 30d: survived 3, followup 0, substantially_rewritten 0, reverted 1, missing 0
- 30-day survival rate: 75.0% (3/4 known outcomes)
- would-be flags: 2 flagged, 1 not flagged, 1 unknown (placeholder rule, no trained model yet)
- would-be flag rate: 66.7% (2/3 decided)
- would-be precision: suppressed — 1 reworked PR(s) at 30d, fewer than the 5 required to quote precision honestly (TP 1, FP 1; placeholder rule, no trained model yet)
