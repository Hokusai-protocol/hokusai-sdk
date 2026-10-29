# Corpus sanity report

Run `b7afd6a32f066a72`, as-of 2026-10-20. Corrective rate = true / (true + false), 95% Wilson CI. Proxy columns count corrective rows each proxy supports (rows can have several). "P1+P2" is the rate from reverts and repair references alone; "SZZ≥3" requires SZZ links to blame at least 3 lines. Rejected = share of candidates (lag ≤ horizon) the labeller rejected.

| Repo | Convention | H | PRs | S2 survived | Corrective | 95% CI | P1+P2 | SZZ≥3 | revert | repair_ref | szz | regr_issue | Rejected | linkage_error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| django/django | rebase_or_mixed | 14 | 1632 | 87.8% | 0.7% | 0.4–1.3 | 0.7% | 0.7% | 5 | 7 | 0 | 0 | 0.0% | 0 |
| django/django | rebase_or_mixed | 30 | 1632 | 83.9% | 0.8% | 0.5–1.4 | 0.8% | 0.8% | 6 | 7 | 0 | 0 | 0.0% | 0 |
| django/django | rebase_or_mixed | 60 | 1632 | 79.6% | 1.1% | 0.7–1.7 | 1.1% | 1.1% | 6 | 11 | 0 | 0 | 0.0% | 0 |
| llvm/llvm-project | squash | 14 | 74034 | 65.0% | 4.3% | 4.2–4.5 | 4.0% | 4.2% | 2351 | 643 | 291 | 27 | 7.2% | 0 |
| llvm/llvm-project | squash | 30 | 74034 | 58.1% | 4.8% | 4.6–4.9 | 4.2% | 4.5% | 2417 | 727 | 453 | 40 | 7.3% | 0 |
| llvm/llvm-project | squash | 60 | 74034 | 51.2% | 5.2% | 5.0–5.3 | 4.3% | 4.7% | 2437 | 795 | 691 | 60 | 7.3% | 0 |
| pytorch/pytorch | merge_bot_trailer | 14 | 27523 | 62.9% | 9.9% | 9.6–10.3 | 9.8% | 9.9% | 2582 | 142 | 15 | 16 | 8.9% | 0 |
| pytorch/pytorch | merge_bot_trailer | 30 | 27523 | 55.1% | 10.1% | 9.8–10.5 | 10.0% | 10.1% | 2604 | 174 | 30 | 21 | 8.8% | 0 |
| pytorch/pytorch | merge_bot_trailer | 60 | 27523 | 47.2% | 10.3% | 10.0–10.7 | 10.2% | 10.3% | 2612 | 209 | 52 | 30 | 8.7% | 0 |
| cockroachdb/cockroach | merge_commit | 14 | 10799 | 49.3% | 2.3% | 2.0–2.5 | 0.8% | 1.7% | 31 | 60 | 161 | 1 | 20.4% | 0 |
| cockroachdb/cockroach | merge_commit | 30 | 10799 | 40.5% | 3.3% | 3.0–3.7 | 1.1% | 2.5% | 36 | 81 | 250 | 1 | 21.7% | 0 |
| cockroachdb/cockroach | merge_commit | 60 | 10799 | 34.2% | 4.5% | 4.1–4.9 | 1.2% | 3.2% | 38 | 90 | 371 | 1 | 20.5% | 0 |
| ClickHouse/ClickHouse | merge_commit | 14 | 17159 | 63.7% | 3.2% | 3.0–3.5 | 2.7% | 2.9% | 273 | 193 | 113 | 0 | 13.0% | 0 |
| ClickHouse/ClickHouse | merge_commit | 30 | 17159 | 54.9% | 4.5% | 4.2–4.8 | 3.5% | 3.9% | 297 | 302 | 213 | 0 | 11.2% | 0 |
| ClickHouse/ClickHouse | merge_commit | 60 | 17159 | 45.4% | 6.0% | 5.6–6.3 | 4.1% | 5.0% | 305 | 413 | 389 | 0 | 10.4% | 0 |
| discourse/discourse | squash | 14 | 12167 | 67.0% | 1.3% | 1.1–1.6 | 1.3% | 1.3% | 120 | 44 | 0 | 0 | 3.5% | 0 |
| discourse/discourse | squash | 30 | 12167 | 57.9% | 1.4% | 1.2–1.7 | 1.4% | 1.4% | 121 | 54 | 0 | 0 | 3.8% | 0 |
| discourse/discourse | squash | 60 | 12167 | 49.6% | 1.5% | 1.3–1.8 | 1.5% | 1.5% | 125 | 62 | 0 | 0 | 3.5% | 0 |
| getsentry/sentry | squash | 14 | 36263 | 57.5% | 1.8% | 1.6–1.9 | 1.7% | 1.7% | 534 | 77 | 32 | 0 | 1.2% | 0 |
| getsentry/sentry | squash | 30 | 36263 | 48.6% | 1.9% | 1.7–2.0 | 1.7% | 1.8% | 536 | 90 | 62 | 0 | 1.3% | 0 |
| getsentry/sentry | squash | 60 | 36263 | 40.4% | 2.0% | 1.8–2.1 | 1.8% | 1.8% | 540 | 95 | 94 | 0 | 1.5% | 0 |
| elastic/kibana | squash | 14 | 29870 | 52.2% | 2.8% | 2.6–3.0 | 1.3% | 2.1% | 106 | 293 | 496 | 14 | 11.3% | 0 |
| elastic/kibana | squash | 30 | 29870 | 41.7% | 4.5% | 4.3–4.7 | 1.8% | 3.2% | 114 | 424 | 888 | 21 | 12.7% | 0 |
| elastic/kibana | squash | 60 | 29870 | 32.7% | 6.4% | 6.1–6.6 | 2.2% | 4.3% | 121 | 536 | 1373 | 28 | 16.3% | 0 |
| grafana/grafana | squash | 14 | 19613 | 60.0% | 1.7% | 1.6–1.9 | 1.1% | 1.3% | 113 | 99 | 137 | 2 | 7.7% | 0 |
| grafana/grafana | squash | 30 | 19613 | 50.5% | 2.4% | 2.2–2.6 | 1.3% | 1.8% | 123 | 134 | 233 | 4 | 7.1% | 0 |
| grafana/grafana | squash | 60 | 19613 | 41.2% | 3.2% | 2.9–3.4 | 1.5% | 2.2% | 135 | 160 | 348 | 9 | 7.0% | 0 |
| PostHog/posthog | squash | 14 | 35981 | 45.9% | 1.5% | 1.3–1.6 | 1.2% | 1.3% | 276 | 159 | 102 | 0 | 8.7% | 0 |
| PostHog/posthog | squash | 30 | 35981 | 36.2% | 1.7% | 1.6–1.9 | 1.3% | 1.5% | 279 | 180 | 174 | 0 | 9.9% | 0 |
| PostHog/posthog | squash | 60 | 35981 | 27.7% | 2.0% | 1.9–2.2 | 1.3% | 1.6% | 279 | 202 | 267 | 0 | 11.3% | 0 |
| home-assistant/core | squash | 14 | 28652 | 70.1% | 0.8% | 0.7–0.9 | 0.6% | 0.7% | 83 | 79 | 70 | 0 | 3.7% | 0 |
| home-assistant/core | squash | 30 | 28652 | 61.9% | 1.0% | 0.9–1.1 | 0.6% | 0.9% | 92 | 93 | 108 | 0 | 3.2% | 0 |
| home-assistant/core | squash | 60 | 28652 | 53.7% | 1.2% | 1.1–1.3 | 0.7% | 1.0% | 98 | 98 | 143 | 0 | 5.1% | 0 |
| vercel/next.js | squash | 14 | 10228 | 50.7% | 2.7% | 2.4–3.1 | 1.8% | 2.2% | 116 | 64 | 106 | 0 | 16.3% | 0 |
| vercel/next.js | squash | 30 | 10228 | 43.8% | 3.4% | 3.1–3.8 | 1.9% | 2.6% | 119 | 77 | 166 | 0 | 19.7% | 0 |
| vercel/next.js | squash | 60 | 10228 | 37.4% | 4.2% | 3.8–4.6 | 2.1% | 3.0% | 125 | 89 | 231 | 0 | 21.3% | 0 |
| kubernetes/kubernetes | merge_commit | 14 | 6187 | 68.5% | 2.3% | 2.0–2.7 | 1.8% | 2.1% | 32 | 81 | 35 | 3 | 1.3% | 0 |
| kubernetes/kubernetes | merge_commit | 30 | 6187 | 61.9% | 2.9% | 2.5–3.3 | 2.1% | 2.5% | 36 | 95 | 52 | 3 | 1.5% | 0 |
| kubernetes/kubernetes | merge_commit | 60 | 6187 | 53.4% | 3.8% | 3.3–4.3 | 2.4% | 3.0% | 38 | 110 | 93 | 3 | 3.0% | 0 |
| dotnet/runtime | squash | 14 | 11129 | 62.3% | 2.6% | 2.4–3.0 | 2.5% | 2.6% | 94 | 191 | 12 | 2 | 5.3% | 0 |
| dotnet/runtime | squash | 30 | 11129 | 55.4% | 3.3% | 3.0–3.6 | 3.1% | 3.2% | 112 | 235 | 22 | 9 | 5.1% | 0 |
| dotnet/runtime | squash | 60 | 11129 | 50.4% | 3.7% | 3.4–4.1 | 3.4% | 3.6% | 118 | 266 | 36 | 10 | 6.3% | 0 |
| rust-lang/rust | rollup | 14 | 15184 | 65.9% | 1.8% | 1.6–2.0 | 1.0% | 1.5% | 42 | 111 | 117 | 57 | 7.1% | 0 |
| rust-lang/rust | rollup | 30 | 15184 | 55.6% | 2.7% | 2.4–2.9 | 1.4% | 2.2% | 49 | 157 | 183 | 90 | 9.5% | 0 |
| rust-lang/rust | rollup | 60 | 15184 | 45.6% | 3.4% | 3.1–3.7 | 1.6% | 2.8% | 55 | 194 | 248 | 124 | 10.8% | 0 |
| python/cpython | squash | 14 | 9454 | 65.5% | 1.1% | 0.9–1.3 | 0.9% | 1.0% | 64 | 19 | 23 | 0 | 13.8% | 0 |
| python/cpython | squash | 30 | 9454 | 54.1% | 1.3% | 1.1–1.6 | 1.0% | 1.1% | 69 | 25 | 31 | 0 | 13.7% | 0 |
| python/cpython | squash | 60 | 9454 | 48.7% | 1.7% | 1.4–1.9 | 1.0% | 1.2% | 73 | 26 | 58 | 0 | 12.1% | 0 |
| apache/airflow | squash | 14 | 15205 | 47.8% | 2.6% | 2.4–2.9 | 1.3% | 1.8% | 109 | 81 | 219 | 0 | 5.8% | 0 |
| apache/airflow | squash | 30 | 15205 | 36.9% | 3.9% | 3.6–4.2 | 1.5% | 2.4% | 117 | 113 | 378 | 0 | 7.5% | 0 |
| apache/airflow | squash | 60 | 15205 | 30.1% | 5.3% | 5.0–5.7 | 1.7% | 3.1% | 122 | 140 | 585 | 0 | 8.1% | 0 |
| mattermost/mattermost | squash | 14 | 3663 | 75.2% | 0.7% | 0.4–1.0 | 0.7% | 0.7% | 9 | 15 | 0 | 0 | 2.2% | 0 |
| mattermost/mattermost | squash | 30 | 3663 | 66.6% | 1.0% | 0.7–1.4 | 1.0% | 1.0% | 15 | 21 | 0 | 0 | 1.2% | 0 |
| mattermost/mattermost | squash | 60 | 3663 | 56.8% | 1.3% | 1.0–1.7 | 1.3% | 1.3% | 20 | 27 | 0 | 0 | 0.9% | 0 |

## Sanity flags

None.

## Spread by merge convention (30d, informational)

| Convention | Repos | Lowest | Highest | P1+P2 range |
|---|---|---|---|---|
| merge_bot_trailer | 1 | 10.1% (pytorch/pytorch) | 10.1% (pytorch/pytorch) | 10.0%–10.0% |
| merge_commit | 3 | 2.9% (kubernetes/kubernetes) | 4.5% (ClickHouse/ClickHouse) | 1.1%–3.5% |
| rebase_or_mixed | 1 | 0.8% (django/django) | 0.8% (django/django) | 0.8%–0.8% |
| rollup | 1 | 2.7% (rust-lang/rust) | 2.7% (rust-lang/rust) | 1.4%–1.4% |
| squash | 12 | 1.0% (mattermost/mattermost) | 4.8% (llvm/llvm-project) | 0.6%–4.2% |

## Merge-convention findings

- **squash** (mattermost/mattermost, llvm/llvm-project): Squash merging doesn't decide which proxies can fire; two repo practices do. (1) Revert culture: llvm reverts post-commit buildbot breakage first and asks later, so 2,417 of its 30-day corrective rows rest on reverts, against 15 for mattermost; P1+P2 alone already span 0.6% to 4.2%. (2) Where bugs are tracked: P3 and P4 need a fix that closes a GitHub bug issue, and mattermost and discourse close none (their trackers are off GitHub), so both get zero P3/P4 rows. Every squash repo is inside the 0.5% to 25% band. The spread is kept: it reflects process differences the model should see, not a labelling fault.
- **rollup** (rust-lang/rust): 84% of PRs (12,689 of 15,184) land inside a rollup merge. git blame --first-parent attributes their lines to the rollup, which several PRs share, so they can never be SZZ originals. rust's P3 contribution covers only the 16% landed individually and is a lower bound; P1/P2/P4 are unaffected.
- **merge_commit** (cockroachdb/cockroach): 36% of PRs (3,866 of 10,799) land in bors batches that share one merge commit, so, as with rust rollups, SZZ can't attribute lines to them. The cohort expected 'batched' and observed 'merge_commit'; treat cockroach as batched for SZZ coverage.
- **merge_bot_trailer** (pytorch/pytorch): The merge bot records revert reasons, and reverts support 2,604 of pytorch's 2,780 30-day corrective rows. 974 of its accepted reverts are classed internal_build (Meta-internal breakage); excluding that class at calibration takes the 60-day rate from 10.3% to 7.7%.
- **any**: SZZ contributes most where projects link fixes to GitHub bug issues (kibana, airflow, grafana, next.js, cockroach). 41% to 65% of SZZ links rest on 2 or fewer blamed lines; the SZZ≥3 column shows the rate if calibration (HOK-3269) sets that minimum.
