# Arbiter report content contract (`arbiter_report/v1`)

**Canonical schema SHA-256:** `d4e141fd08c2febf59491c15a9fa05ba53aa0c6f27c4ea128dc33386ae0b12c3`

## Fields

The closed envelope contains `schema_version`, `data_origin`, `repo`, `scan`,
`policy`, `coverage`, `prs`, `aggregates`, `retrospective`, `cost`,
`model_provenance`, and `eligibility`. All fields are required; the last three
analytic sections may be null. Unknown fields fail validation at every depth.

`repo` holds GitHub host, owner, and name. The owner matches
`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; the name matches
`^[A-Za-z0-9._-]{1,100}$` except `.` and `..`. Case is preserved for display.
Consumers join hosted report access metadata on `(lower(owner), lower(name))`.
Visibility is site-owned in the `ArbiterReport.visibility` database row
(HOK-3215); the content payload carries no visibility, shareability, or user
access field. The parser's local/hosted mode does not authorize access.

`scan` records scanner version, the integration branch, pinned `as_of` and
`scanned_at` clocks, lookback and merge window, a strictly ascending subset of
14/30/60-day horizons, and the S1/S2 contract versions. `coverage` is always
descriptive and remains visible when every aggregate is suppressed. It counts
enumerated and eligible PRs, labels and missing reasons per horizon, and the
agent, harness, and exact-model attribution breakdown. Unknown agent identity
is never inferred to mean human authorship.

Each `prs` row has a PR number and merge time, the three attribution
dimensions with confidence and method, all 33 S1 `CandidateFeaturesV1`
fields, one privacy-safe S2 label projection per declared horizon, optional
cost observations, and an optional out-of-sample prediction. The label
projection retains `canonicalHash(fullLabel)` for Tier-2b dispute joins and
omits line paths, commit SHAs, and the PR URL.

`aggregates` contains survival by horizon, feature-bucket risk ratios,
survival by exact model, survival by harness, and cost-adjusted survival by
exact model. Every cell carries its basis, n, value, 95% CI, suppression flag,
and reasons. The v1 bucket vocabulary is `tests_changed: true|false`,
`files_touched_bucket: 1|2_5|6_15|16_plus`, and `loc_touched: q1|q2|q3|q4`.
The `feature` field names are from S1 only. A future S1/S2 wire change requires
a new report version rather than silently changing v1.

## Enums and invariants

Attribution methods are `first_party_route_metadata`, `bot_author`,
`branch_prefix`, `co_authored_by_trailer`, `pr_label`, `commit_signature`, and
`owner_config`. Suppression reasons are `n_below_floor`,
`agent_coverage_below_floor`, `harness_coverage_below_floor`,
`exact_model_coverage_below_floor`, `harness_only_evidence`,
`cost_coverage_below_floor`, `reworked_below_floor`, `no_model_provenance`, and
`horizon_not_mature`. S2 supplies the outcome and missing-reason vocabularies;
task-cost supplies cost source and coverage vocabularies.

Both SDK and site enforce these named invariant codes:
`suppressed_cell_has_value`, `shown_cell_missing_value`, `ci_out_of_order`,
`section_status_mismatch`, `prediction_without_provenance`,
`descriptive_section_with_prediction_cell`, `cta_without_exact_model`,
`model_table_ineligible_but_shown`, `cost_adjusted_needs_actual_cost`,
`coverage_sum_mismatch`, `horizon_not_declared`, `horizons_not_ascending`,
`feature_bucket_mismatch`, `labels_horizon_mismatch`,
`label_outcome_inconsistent`, and structural `cost_sum_forbidden`.

## Suppression and basis

The scanner's `applyReportSuppression` is the sole owner of n floors,
attribution floors, actual cost coverage, and eligibility. It writes section
and cell suppression state. A renderer reads that state, so local private and
hosted URL renders show identical suppression. A suppressed cell has null
value and CI and at least one reason; a shown cell has a value and no reason.
The site's `buildReportViewModel` renders coverage and the emitted state and
does not recompute thresholds. A sparse report can say “Not enough history
yet” while still displaying its coverage.

Every reported statistic identifies `descriptive` repo history or an
`out_of_sample_prediction`; prediction fields require `model_provenance` with
head, training corpus, split method, and split date. `data_origin: fixture`
is test/dev-only and is rejected for hosted rendering without an explicit
test flag. Illustrative fixture numbers must never appear on a live report.

## Cost and privacy

Actual provider-reported and local estimated dollar figures are separate.
The estimate has its own pricing revision and timestamp and is never summed
with actual cost or called realized savings. Coverage, priced and unknown PR
counts, unpriced models, and suppression reasons travel with the cost fields.
The scanner permits a cost-adjusted exact-model view only with first-party
executed-model evidence, comparable actual-cost coverage, and enough PRs.
Harness-only attribution yields a harness-labelled descriptive table and no
model-routing CTA.

Only bounded derived fields cross this boundary. The JSON Schema closes
every object and constrains all strings; SDK and site tests inject forbidden
source, diff, path, prompt, author, and SHA keys at multiple depths. The S2
projection omits `line_ranges`, envelope SHAs, and `prUrl`. The shared S5
default-deny fixture should be adopted after HOK-2787 merges.

## Versioning and vendoring

The SDK's `@hokusai/core` module and JSON Schema are canonical. `@hokusai/scan`
produces four deterministic fixtures through suppression: full, sparse,
harness-only, and prediction, plus named invalid fixtures. The site vendors
their exact bytes and provenance hashes. SDK `check:arbiter-report`, site
`arbiter:contract:check`, and tests in both repos fail on drift. Consumers must
accept a new `arbiter_report/vN` before the scanner emits it. The pipeline
store (HOK-3217) must validate report content with the core validator before
storage; the site proxies the stored content.
