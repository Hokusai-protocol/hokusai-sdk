# Phase 2 exit evidence audit (HOK-2822)

Source run: `b7afd6a32f066a72`. S2 observation cutoff: 2026-10-20T00:00:00.000Z.
Merge-time lookback: [2026-02-02T00:00:00.000Z, 2026-08-01T00:00:00.000Z), 180 days.
This retrospective slice of the predeclared corpus is reused evidence, not a newly predeclared attribution cohort or a live scan.

**Label call:** nondegenerate_base_rates. **Phase 2 exit:** NOT PASSED.
Nondegenerate base rates establish variation, not predictive lift or defect validity. No model was fitted or evaluated by this audit.

## S2 outcome rates by repo and horizon

Rates use labelled PRs only; missing labels are counted separately. S2 non-survival includes ordinary follow-up and is not the corrective event target.

| Repo                  | Convention        |   H |   PRs | Labelled | Missing | Survived | Follow-up | Rewritten | Reverted |
| --------------------- | ----------------- | --: | ----: | -------: | ------: | -------: | --------: | --------: | -------: |
| apache/airflow        | squash            |  14 |  4498 |     4484 |      14 |   44.27% |    50.29% |     5.33% |    0.11% |
| apache/airflow        | squash            |  30 |  4498 |     4484 |      14 |   35.70% |    55.98% |     8.23% |    0.09% |
| apache/airflow        | squash            |  60 |  4498 |     4484 |      14 |   29.42% |    59.03% |    11.49% |    0.07% |
| ClickHouse/ClickHouse | merge_commit      |  14 |  6924 |     6911 |      13 |   58.21% |    38.65% |     2.89% |    0.25% |
| ClickHouse/ClickHouse | merge_commit      |  30 |  6924 |     6911 |      13 |   48.76% |    46.62% |     4.43% |    0.19% |
| ClickHouse/ClickHouse | merge_commit      |  60 |  6924 |     6911 |      13 |   37.87% |    55.12% |     6.84% |    0.17% |
| cockroachdb/cockroach | merge_commit      |  14 |  2221 |     2214 |       7 |   62.65% |    34.33% |     2.66% |    0.36% |
| cockroachdb/cockroach | merge_commit      |  30 |  2221 |     2214 |       7 |   54.11% |    41.51% |     4.11% |    0.27% |
| cockroachdb/cockroach | merge_commit      |  60 |  2221 |     2214 |       7 |   48.64% |    45.75% |     5.37% |    0.23% |
| discourse/discourse   | squash            |  14 |  3837 |     3834 |       3 |   74.26% |    21.39% |     4.20% |    0.16% |
| discourse/discourse   | squash            |  30 |  3837 |     3834 |       3 |   64.21% |    28.77% |     6.96% |    0.05% |
| discourse/discourse   | squash            |  60 |  3837 |     3834 |       3 |   55.24% |    35.50% |     9.26% |    0.00% |
| django/django         | rebase_or_mixed   |  14 |   432 |      431 |       1 |   86.77% |    12.76% |     0.46% |    0.00% |
| django/django         | rebase_or_mixed   |  30 |   432 |      431 |       1 |   82.13% |    17.17% |     0.70% |    0.00% |
| django/django         | rebase_or_mixed   |  60 |   432 |      431 |       1 |   78.42% |    19.26% |     2.32% |    0.00% |
| dotnet/runtime        | squash            |  14 |  3623 |     3616 |       7 |   60.09% |    36.70% |     2.90% |    0.30% |
| dotnet/runtime        | squash            |  30 |  3623 |     3616 |       7 |   52.85% |    42.31% |     4.54% |    0.30% |
| dotnet/runtime        | squash            |  60 |  3623 |     3616 |       7 |   47.43% |    45.74% |     6.55% |    0.28% |
| elastic/kibana        | squash            |  14 | 10911 |    10902 |       9 |   48.60% |    46.93% |     4.25% |    0.23% |
| elastic/kibana        | squash            |  30 | 10911 |    10901 |      10 |   37.96% |    53.80% |     8.02% |    0.22% |
| elastic/kibana        | squash            |  60 | 10911 |    10901 |      10 |   29.34% |    57.68% |    12.82% |    0.16% |
| getsentry/sentry      | squash            |  14 | 10010 |     9998 |      12 |   57.07% |    36.90% |     5.87% |    0.16% |
| getsentry/sentry      | squash            |  30 | 10010 |     9998 |      12 |   47.33% |    43.28% |     9.28% |    0.11% |
| getsentry/sentry      | squash            |  60 | 10010 |     9998 |      12 |   38.59% |    46.56% |    14.78% |    0.07% |
| grafana/grafana       | squash            |  14 |  6432 |     6423 |       9 |   58.27% |    36.93% |     4.62% |    0.17% |
| grafana/grafana       | squash            |  30 |  6432 |     6423 |       9 |   48.26% |    44.47% |     7.19% |    0.08% |
| grafana/grafana       | squash            |  60 |  6432 |     6423 |       9 |   38.27% |    50.24% |    11.40% |    0.09% |
| home-assistant/core   | squash            |  14 |  8304 |     8290 |      14 |   69.31% |    23.16% |     7.44% |    0.08% |
| home-assistant/core   | squash            |  30 |  8304 |     8290 |      14 |   60.18% |    29.57% |    10.19% |    0.06% |
| home-assistant/core   | squash            |  60 |  8304 |     8290 |      14 |   49.81% |    37.44% |    12.70% |    0.05% |
| kubernetes/kubernetes | merge_commit      |  14 |  1785 |     1781 |       4 |   63.00% |    34.19% |     2.70% |    0.11% |
| kubernetes/kubernetes | merge_commit      |  30 |  1785 |     1781 |       4 |   56.49% |    39.75% |     3.65% |    0.11% |
| kubernetes/kubernetes | merge_commit      |  60 |  1785 |     1781 |       4 |   48.46% |    46.43% |     5.00% |    0.11% |
| llvm/llvm-project     | squash            |  14 | 22716 |    22623 |      93 |   65.26% |    30.58% |     3.71% |    0.46% |
| llvm/llvm-project     | squash            |  30 | 22716 |    22623 |      93 |   58.06% |    36.63% |     4.97% |    0.34% |
| llvm/llvm-project     | squash            |  60 | 22716 |    22623 |      93 |   50.11% |    42.76% |     6.91% |    0.22% |
| mattermost/mattermost | squash            |  14 |  1113 |     1112 |       1 |   60.88% |    36.51% |     2.61% |    0.00% |
| mattermost/mattermost | squash            |  30 |  1113 |     1112 |       1 |   52.43% |    42.99% |     4.59% |    0.00% |
| mattermost/mattermost | squash            |  60 |  1113 |     1112 |       1 |   41.91% |    50.09% |     8.00% |    0.00% |
| PostHog/posthog       | squash            |  14 | 19441 |    19402 |      39 |   41.54% |    50.55% |     7.81% |    0.10% |
| PostHog/posthog       | squash            |  30 | 19441 |    19402 |      39 |   31.39% |    56.19% |    12.33% |    0.09% |
| PostHog/posthog       | squash            |  60 | 19441 |    19402 |      39 |   23.24% |    57.24% |    19.39% |    0.13% |
| python/cpython        | squash            |  14 |  2495 |     2490 |       5 |   63.69% |    32.17% |     4.02% |    0.12% |
| python/cpython        | squash            |  30 |  2495 |     2490 |       5 |   53.61% |    41.00% |     5.26% |    0.12% |
| python/cpython        | squash            |  60 |  2495 |     2490 |       5 |   50.68% |    43.53% |     5.70% |    0.08% |
| pytorch/pytorch       | merge_bot_trailer |  14 |  7518 |     7503 |      15 |   63.37% |    29.20% |     6.80% |    0.63% |
| pytorch/pytorch       | merge_bot_trailer |  30 |  7518 |     7503 |      15 |   55.75% |    36.32% |     7.60% |    0.33% |
| pytorch/pytorch       | merge_bot_trailer |  60 |  7518 |     7503 |      15 |   47.53% |    42.98% |     9.29% |    0.20% |
| rust-lang/rust        | rollup            |  14 |  3795 |     3788 |       7 |   62.51% |    34.64% |     2.69% |    0.16% |
| rust-lang/rust        | rollup            |  30 |  3795 |     3788 |       7 |   53.33% |    42.11% |     4.49% |    0.08% |
| rust-lang/rust        | rollup            |  60 |  3795 |     3788 |       7 |   43.37% |    49.95% |     6.55% |    0.13% |
| vercel/next.js        | squash            |  14 |  2195 |     2190 |       5 |   50.91% |    42.05% |     6.85% |    0.18% |
| vercel/next.js        | squash            |  30 |  2195 |     2190 |       5 |   42.97% |    48.04% |     8.81% |    0.18% |
| vercel/next.js        | squash            |  60 |  2195 |     2190 |       5 |   35.66% |    51.46% |    12.69% |    0.18% |

## Attribution evidence in the same lookback

Denominator: 30-day labelled PRs; at least 20 per qualifying repo. Unknown is not human. Exact-model markers are heuristic observations, not first-party execution evidence.
This uses the audited merge-time marker columns. It does not include a new full five-signal attribution run, owner label mappings, or manual precision validation.

| Repo                  | Eligible | Agent marked | Unknown | Marker coverage | Heuristic exact-model coverage |
| --------------------- | -------: | -----------: | ------: | --------------: | -----------------------------: |
| apache/airflow        |     4484 |         1279 |    3205 |          28.52% |                          2.68% |
| ClickHouse/ClickHouse |     6911 |         3768 |    3143 |          54.52% |                         46.62% |
| cockroachdb/cockroach |     2214 |          888 |    1326 |          40.11% |                         10.30% |
| discourse/discourse   |     3834 |           50 |    3784 |           1.30% |                          1.07% |
| django/django         |      431 |            4 |     427 |           0.93% |                          0.00% |
| dotnet/runtime        |     3616 |         2140 |    1476 |          59.18% |                          0.17% |
| elastic/kibana        |    10901 |         2668 |    8233 |          24.47% |                          8.47% |
| getsentry/sentry      |     9998 |         3403 |    6595 |          34.04% |                         14.85% |
| grafana/grafana       |     6423 |         1006 |    5417 |          15.66% |                         10.98% |
| home-assistant/core   |     8290 |         1539 |    6751 |          18.56% |                          9.16% |
| kubernetes/kubernetes |     1781 |           11 |    1770 |           0.62% |                          0.06% |
| llvm/llvm-project     |    22623 |         1485 |   21138 |           6.56% |                          1.26% |
| mattermost/mattermost |     1112 |          428 |     684 |          38.49% |                          9.17% |
| PostHog/posthog       |    19402 |         7194 |   12208 |          37.08% |                         12.72% |
| python/cpython        |     2490 |          314 |    2176 |          12.61% |                         11.33% |
| pytorch/pytorch       |     7503 |         1731 |    5772 |          23.07% |                          1.61% |
| rust-lang/rust        |     3788 |           15 |    3773 |           0.40% |                          0.08% |
| vercel/next.js        |     2190 |          286 |    1904 |          13.06% |                          1.28% |

Macro agent-marker coverage: **22.73%**. Micro: **23.91%**. Repos reaching 60%: **0** (six required for the full attribution gate).

## Outstanding acceptance evidence

- At least 12 genuine Report v0 payloads rendered through the existing site renderer, with render receipts. This table is not those reports.
- Wavemill/Hokusai internal reports, and an explicitly predeclared external attribution cohort spanning agent ecosystems and conventions.
- Full agent-or-harness signal coverage and precision from a manually validated sample; do not lower the 60% threshold or select a successful sample after inspecting outcomes.
- Exact-model coverage remains separate; model comparisons and routing claims stay suppressed without sufficient coverage and evidence.

The full-history counts are preserved in the JSON audit, separately from the 180-day slice. Existing HOK-3268 convention findings remain applicable; the generic scanner is not certified for every corpus enumerator convention by this audit.
