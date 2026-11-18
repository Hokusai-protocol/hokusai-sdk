# Phase 2 exit review (HOK-2822)

Review date: 2026-11-18. **Status: In Progress; Phase 2 exit has not passed.**

Both recorded prerequisites are Done: HOK-2819 (Report v0 renderer) and
HOK-2821 (scanner orchestration). HOK-3268's persisted corpus is also complete.
There is no unfinished dependency preventing this investigation. Missing
acceptance evidence remains work owned by HOK-2822.

## Label judgment

**Informative as descriptive history, not degenerate by the program's base-rate
rule.** All 18 external repositories have more than 20 labelled PRs in the
180-day merge-time lookback. At 30 days, S2 non-survival ranges from 17.87%
(Django) to 68.61% (PostHog), rather than more than 97% survival everywhere.
The range spans multiple merge conventions and is not specific to wavemill.
The full-history counts cover 364,743 PRs; the lookback covers 118,250, of which
117,991 have non-null 30-day outcomes. Missing outcomes are not negatives.

This is a base-rate judgment only. S2 includes ordinary follow-up and planned
rewrites. It does not establish a defect label or predictive lift. The separately
pinned research target, `cr-0.2.0`, means reverted or explicitly repaired within
30 days. It must not be confused with S2 non-survival or the old `cr-0.1.0`
corrective rate in HOK-3268's report. HOK-3028 owns the model comparison and its
sealed evaluation slice; this audit fits and scores no model.

The conditional 60/90-day and human-undo-weighted rescue analyses are not triggered
by these base rates. Existing 14/30/60-day outcome counts are retained separately.
This does not retrospectively establish that the original gate was completed
before model work began.

## Attribution judgment

The subsequent [full attribution measurement and gate proposal](./attribution-measurement.md)
completed the historical signal pass on the same cohort: 23.91% primary coverage,
24.86% with a separately disclosed exploratory generic-disclosure extension. The
116-item AI evidence review and independent human review packet are complete;
independent human labels remain pending. The original findings below describe
the initial marker-only audit, not unfinished measurement work.

The audited merge-time agent-marker evidence identifies 28,209 of 117,991
30-day-labelled PRs in the lookback: **23.91% micro coverage, 22.73% macro coverage**.
No repository reaches 60%; the highest is dotnet/runtime at 59.18%.

This is the frozen marker contract's measurement, not a claim that the complete
five-signal agent-or-harness measurement has been performed. No manual attribution
precision result accompanies this audit. Consequently the existing corpus does
**not demonstrate** the retained requirement of 60% observable agent-or-harness
attribution in six qualifying external repos. Generic automation must not be
relabelled as agent work to increase coverage. Unknown marker evidence remains
unknown; it is never converted to human authorship.

Exact-model markers are reported independently as heuristic observations. Tool
families such as Claude/Copilot are not underlying model versions. There is no
new permission to show a model table or make a routing claim without the existing
coverage, sample-size and execution-evidence requirements.

The cohort was predeclared for HOK-3022's label research over a two-year window.
This audit applies a documented 180-day slice ending at its fixed merge-window
end. It is reused evidence, not a newly predeclared agent-heavy acquisition cohort
or a current scan through November. Repositories were not selected or dropped
based on their observed attribution rates.

## Merge-convention judgment

Reuse HOK-3268's [recorded findings](../../fixtures/arbiter/corpus/hok-3022-sanity-notes.json):

- Rust: rollup expansion closed the enumeration gap, but SZZ cannot attribute
  member lines through a shared first-parent rollup. Its P3 contribution remains
  a lower bound.
- Cockroach: 36% of PRs share bors batch commits, with the same SZZ limitation.
  Treat it as batched when discussing that coverage despite its merge-commit label.
- PyTorch: merge-bot trailers and direct-push reverts need the existing corpus
  enumerator; internal-build reverts are events, not automatically public defects.
- Squash repositories still vary with revert culture and off-GitHub bug trackers.
  The convention alone does not explain their base rates.
- Labeller 1.4.0 corrected merge-bot attribution of undoers. This audit verifies
  that exact persisted version; the superseded 1.3.0 actor table is not reused.

The corpus enumerator supports conventions the generic report enumerator has not
been certified to cover. Do not infer universal scanner auto-detection from a
successful corpus analysis. Internal squash-promotion repos still require their
integration branch, rather than promoted main history. Fix or explicitly scope
convention support when producing the remaining reports.

## Evidence and reproduction

- [Generated per-repo/horizon table](../../fixtures/arbiter/corpus/hok-2822-exit-audit.md)
- [Aggregate counts and provenance](../../fixtures/arbiter/corpus/hok-2822-exit-audit.json)
- [Source run manifest](../../fixtures/arbiter/corpus/hok-3022-run-manifest.json),
  run `b7afd6a32f066a72`, observed as of 2026-10-20
- [Audited feature manifest](../../fixtures/arbiter/corpus/hok-3023-feature-run-manifest.json),
  `rr-merge-features/1.0.0`

Run from the SDK root with a local persisted corpus cache:

```sh
node scripts/corpus/phase-two-exit.mjs \
  --cache-dir /path/to/arbiter-corpus \
  --out /tmp/hok-2822-audit
node --test scripts/corpus/phase-two-exit.test.mjs
```

The command checks the cohort digest, then hashes the exact compressed feature
and S2 bytes consumed against the committed manifests and verifies row counts.
It fails on unmatched identities, duplicate PR/horizon rows, missing horizons,
incompatible feature versions and observed outcomes whose horizon has not matured.
It writes only aggregate counts, bounded categories and provenance. Source,
PR text, paths, raw author identities and per-PR records stay out of the output.
No GitHub requests, S3 writes, training, or holdout tuning occur.

The default lookback is `[2026-02-02, 2026-08-01)`; the outcome observation cutoff
is 2026-10-20. These are separate clocks. `--lookback-days` accepts a positive
integer contained in the persisted corpus interval. An audit's successful process
exit means evidence was processed successfully, not that Phase 2 passed.

## Remaining work to close HOK-2822

The initial gap list below is retained for traceability. The full signal pass
has since been executed; its results and the proposed replacement for the 60%
condition are in the linked attribution measurement. Human validation, genuine
report renders and the final program decision are still open.

1. Predeclare the missing acquisition/attribution cohort and merge-time window,
   including multiple agent ecosystems and merge conventions. Reuse persisted
   observations where they match; scan only the gaps. A later selection must be
   disclosed as a new cohort, not presented as the original one.
2. Produce at least 12 validated Report v0 payloads and render them through the
   existing site component, including wavemill/Hokusai internal repos and at
   least 10 public repos in the intended cohort. Record payload hashes, renderer
   revision and successful render receipts. A markdown corpus table is not a v0
   render. Resolve truthful source-version reporting when adapting persisted S2
   v1.1.0 labels to the report contract, which currently fixes its label version
   to 1.0.0; do not silently relabel the inputs.
3. Measure the full attribution union over all eligible PRs, retaining unknowns,
   per-signal evidence, macro/micro coverage and separate exact-model coverage.
   Verify at least six external repos satisfy 60% and n ≥ 20. If the retained
   threshold cannot be met, record a failed gate and propose an explicit program
   decision; do not lower it in the code or retrofit a passing cohort.
4. Prepare an independently sampled attribution audit and obtain actual manual
   labels to calculate precision and its uncertainty. Existing marker hand-review
   anecdotes are not a fresh, denominator-matched gate result.
5. Add the render/attribution receipts to this review and update the Program
   Brief's final exit call. Until then HOK-2822 stays In Progress and the Phase 2
   exit remains unpassed. This review does not clear downstream training gates.
