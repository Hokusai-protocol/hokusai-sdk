# Attribution protocol 1.2.0 measurement (HOK-2822)

Protocol `1.2.0`, SHA-256 `fc4eb061e029e6f3cc134e52eef6d8cd857e69f044468b1a99db622b6f1c6a2a`. Same cohort, window and denominator as protocol 1.0.0: 117991 PRs.

Frozen v1 union: **28209** (23.91%). Protocol 1.2.0 union: **29557** (25.05%), adding **1348** PRs.
Macro 1.2.0 coverage: **23.60%**. Repositories reaching 60%: **0**. Repositories with at least 20 identified agent PRs: **15** of 18.

These are observable-evidence counts. The added rules were derived from the v1 review sample; their precision and the remaining miss rate are unmeasured until the fresh sample returns. Frozen feature rows and training inputs are unchanged.

| Repo                  | Eligible | v1 union | 1.2.0 union | Added | 1.2.0 coverage | Inherited-upstream positives |
| --------------------- | -------: | -------: | ----------: | ----: | -------------: | ---------------------------: |
| apache/airflow        |     4484 |     1279 |        1745 |   466 |         38.92% |                            0 |
| ClickHouse/ClickHouse |     6911 |     3768 |        3775 |     7 |         54.62% |                            0 |
| cockroachdb/cockroach |     2214 |      888 |         888 |     0 |         40.11% |                            0 |
| discourse/discourse   |     3834 |       50 |          50 |     0 |          1.30% |                            0 |
| django/django         |      431 |        4 |           4 |     0 |          0.93% |                            0 |
| dotnet/runtime        |     3616 |     2140 |        2140 |     0 |         59.18% |                            8 |
| elastic/kibana        |    10901 |     2668 |        2668 |     0 |         24.47% |                            0 |
| getsentry/sentry      |     9998 |     3403 |        3489 |    86 |         34.90% |                            0 |
| grafana/grafana       |     6423 |     1006 |        1006 |     0 |         15.66% |                            0 |
| home-assistant/core   |     8290 |     1539 |        1539 |     0 |         18.56% |                            0 |
| kubernetes/kubernetes |     1781 |       11 |          14 |     3 |          0.79% |                            0 |
| llvm/llvm-project     |    22623 |     1485 |        1612 |   127 |          7.13% |                            0 |
| mattermost/mattermost |     1112 |      428 |         428 |     0 |         38.49% |                            0 |
| PostHog/posthog       |    19402 |     7194 |        7841 |   647 |         40.41% |                            0 |
| python/cpython        |     2490 |      314 |         314 |     0 |         12.61% |                            0 |
| pytorch/pytorch       |     7503 |     1731 |        1743 |    12 |         23.23% |                            0 |
| rust-lang/rust        |     3788 |       15 |          15 |     0 |          0.40% |                           10 |
| vercel/next.js        |     2190 |      286 |         286 |     0 |         13.06% |                            0 |

## Added PRs by rule

| Rule                          | PRs added beyond v1 |
| ----------------------------- | ------------------: |
| ai_codemod_subject            |                  12 |
| checked_airflow_ai_disclosure |                 466 |
| explicit_agent_authored       |                 604 |
| explicit_ai_generated_change  |                   4 |
| explicit_named_agent_creator  |                  50 |
| owner_mapping                 |                 213 |

A PR can match more than one rule; the union is deduplicated per PR.

Positives with an inherited-upstream scope: **18**. They stay in the union and are flagged, because their markers describe upstream work.

## Fresh review sample

| Stratum                    | Population after excluding the v1 sample | Sampled |
| -------------------------- | ---------------------------------------: | ------: |
| added_body_disclosure      |                                     1119 |      30 |
| added_ai_codemod           |                                       10 |      10 |
| bot_without_agent_evidence |                                     2234 |      40 |
| unmarked                   |                                    86147 |     300 |

**380** PRs, drawn with seed `hok-2822-attribution-review-v2`. The packet and unfilled sheet are private; independent labels are **pending**.
