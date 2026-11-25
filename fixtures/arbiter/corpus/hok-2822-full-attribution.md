# Full attribution evidence pass (HOK-2822)

Protocol `1.0.0`, SHA-256 `d90339c9dbf8484406222574003f7dd75edddb970edfa2d01240456e40a9cdac`. Same 18 repositories and fixed window as the baseline audit.
Denominator: 117991 PRs with non-null 30-day labels, merged in [2026-02-02T00:00:00.000Z, 2026-08-01T00:00:00.000Z).

Frozen baseline: **23.91%**. Full agent-or-harness union: **23.91%**, adding **0** distinct PRs.
Macro full-union coverage: **22.73%**. Repositories reaching 60%: **0**.

This measures observable attribution, not the true fraction of agent-written code or detector recall. Unknown remains unknown. No model performance was evaluated.

| Repo                  | Eligible | Baseline | Full union | Added | Coverage | Bot without agent evidence | Unavailable body | Unavailable labels |
| --------------------- | -------: | -------: | ---------: | ----: | -------: | -------------------------: | ---------------: | -----------------: |
| apache/airflow        |     4484 |     1279 |       1279 |     0 |   28.52% |                        272 |                1 |                  0 |
| ClickHouse/ClickHouse |     6911 |     3768 |       3768 |     0 |   54.52% |                        103 |                0 |                  0 |
| cockroachdb/cockroach |     2214 |      888 |        888 |     0 |   40.11% |                          0 |                1 |                  1 |
| discourse/discourse   |     3834 |       50 |         50 |     0 |    1.30% |                        321 |               17 |                  0 |
| django/django         |      431 |        4 |          4 |     0 |    0.93% |                          0 |                1 |                  0 |
| dotnet/runtime        |     3616 |     2140 |       2140 |     0 |   59.18% |                         82 |                7 |                  0 |
| elastic/kibana        |    10901 |     2668 |       2668 |     0 |   24.47% |                        166 |               26 |                  0 |
| getsentry/sentry      |     9998 |     3403 |       3403 |     0 |   34.04% |                        157 |                9 |                  0 |
| grafana/grafana       |     6423 |     1006 |       1006 |     0 |   15.66% |                        313 |                2 |                  0 |
| home-assistant/core   |     8290 |     1539 |       1539 |     0 |   18.56% |                        232 |                0 |                  0 |
| kubernetes/kubernetes |     1781 |       11 |         11 |     0 |    0.62% |                          0 |                0 |                  0 |
| llvm/llvm-project     |    22623 |     1485 |       1485 |     0 |    6.56% |                        127 |               39 |                  0 |
| mattermost/mattermost |     1112 |      428 |        428 |     0 |   38.49% |                         15 |                0 |                  0 |
| PostHog/posthog       |    19402 |     7194 |       7194 |     0 |   37.08% |                        735 |                2 |                  0 |
| python/cpython        |     2490 |      314 |        314 |     0 |   12.61% |                          4 |                2 |                  0 |
| pytorch/pytorch       |     7503 |     1731 |       1731 |     0 |   23.07% |                         29 |                0 |                  0 |
| rust-lang/rust        |     3788 |       15 |         15 |     0 |    0.40% |                          0 |                2 |                  0 |
| vercel/next.js        |     2190 |      286 |        286 |     0 |   13.06% |                          0 |                2 |                  1 |

## Signal contributions

| Signal                    | All identified PRs | Additional PRs beyond baseline |
| ------------------------- | -----------------: | -----------------------------: |
| agent_body                |              12415 |                              0 |
| agent_branch              |               2531 |                              0 |
| agent_commit_or_landing   |              23170 |                              0 |
| bound_executed_route      |                  0 |                              0 |
| declared_harness_metadata |                  0 |                              0 |
| explicit_agent_label      |                  0 |                              0 |
| known_agent_account       |                966 |                              0 |
| owner_mapping             |                  0 |                              0 |

Signals overlap; their counts must not be summed. The union is deduplicated per PR.

Counting every generic bot as an agent would yield 30765 identified PRs (26.07%). **2556** bot-authored PRs have no agent evidence, including 1064 known dependency-bot PRs. They remain separate.

Known harness metadata: 0. Head-bound executed-model metadata: 0. Heuristic exact-model observations: 10778. These are distinct measurements.

Private stratified review packet: **116** PRs. Sampling and populations are recorded locally; independent human precision is **pending**.
No repo-specific owner mappings were supplied. Only explicit generation/authorship/assistance label names count; bare AI/tool-topic labels do not. The policy is fixed in the protocol, not inferred from outcomes.

## Exploratory disclosure extension (post-review)

The fixed review sample exposed missed generic AI declarations, checked disclosure forms and named documentation-agent signatures. Separately declared extension 1.1.0 adds 1124 PRs, for 29333 observed PRs (24.86%).
These rules were selected after the sample review. This sensitivity result is not independent validation, does not change the predeclared v1 union or sample membership, and does not modify frozen training features.

## Gate recommendation

The retained 60%-in-six-repos gate is not met by this evidence. Propose replacing the all-PR attribution percentage as a prerequisite for general-repo reports with: honest measured coverage and unknowns; independently validated attribution precision; and sufficient observed agent sample size for any agent-specific analysis. Keep exact-model reporting and routing gates separate. This is a proposal requiring a program decision, not an adopted threshold change.

The 12 rendered Report v0 receipts and independent human review remain separate acceptance work. HOK-2822 stays In Progress.
