# Merge-time feature manifest (HOK-3023)

**Status:** draft, `rr-merge-features/0.3.0`. It becomes frozen at 1.0.0 once the leakage audit passes.

Every arm in the [pre-registered backtest](./rework-risk-preregistration.md) sees the same information: what was knowable when the PR merged. The manifest declares that set, and one validator enforces it.

- **Manifest and validator:** `packages/core/src/rework-risk-features.ts`
- **CLI for other languages:** `hokusai-scan corpus-feature-audit`
- **Shared test cases:** `fixtures/arbiter/rework-risk/leakage-conformance.json`

## The cutoff

Each row has an `as_of`, and each manifest entry declares where its evidence comes from.

| Source | Evidence | How it stops at `as_of` |
| --- | --- | --- |
| `git_diff_base_to_merge` | The diff from `base_sha` to `merge_sha` | Both commits are fixed |
| `git_ancestors_of_base` | Commits reachable from `base_sha` | Reachability; commit dates only set the length of a window |
| `github_events_until_as_of` | Timestamped reviews, label events, renames and edits | Each event is checked against `as_of` |
| `pr_commits_at_merge` | The PR's commits up to its head at merge, plus the landing commit | Commits are fixed by SHA |
| `immutable_pr_fact` | Facts that cannot change after PR creation | They cannot change |
| `harness_contract` | Task-contract data from an instrumented harness | Written before merge |

`github_current_state`, `git_history_after_merge`, `label_store` and `wall_clock` always fail the audit.

**`as_of` differs by merge convention, so each row records its basis:**

- `github_merged_at`: GitHub reported a merge time.
- `landing_commit_time`: GitHub reported none, so the landing commit's timestamp is used. This covers nearly all of pytorch, where 27,487 of 27,523 PRs are mapped by a number in the commit message.

## What is in the set

| Group | Fields | Role |
| --- | --- | --- |
| `feature.shape` | Diff size, tests changed, complexity change | Arm input |
| `feature.history` | Churn, authors and fix-shaped commits on the changed files | Arm input |
| `feature.author` | The author's prior commits; whether the author is a bot | Arm input |
| `feature.agent` | Evidence that an agent tool worked on the PR: whether a marker exists, which tool, and the share of commits marked | Arm input |
| `feature.process` | Reviews by merge; labels, title and body as they were at merge | Arm input |
| `feature.content` | Hashes of the private diff, title and body that content arms read | Arm input |
| `segment.agent` | The exact model a commit names, and where each marker was found | Reported separately |
| `segment.author` | Whether the author is a dependency bot | Reported separately |
| `segment.provenance` | The five instrumented-agent fields | Reported separately; null elsewhere |
| `segment.ci` | CI results finished by merge | Reported separately; 2025Q4 onward only |

`hokusai-scan corpus-feature-audit --print-manifest` prints every field with its source and null meaning.

Left out of v1:

- **`type_errors`, `lint_errors` and locally built `build_ok`:** running each repo's historical tooling isn't practical at corpus scale.
- **`dependency_depth`:** the extractor has no structural index yet.

## Agent markers

`feature.author.is_bot` only says that GitHub reports the author account as a bot. A person who uses Claude Code and opens the PR themselves is not a bot, so agent use is detected separately, by `detectAgentMarkers` in `@hokusai/scan`.

| Evidence | Examples |
| --- | --- |
| Co-author trailer or commit author | `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` |
| Footer or model tag in a commit | `Generated with Claude Code`, a line reading `model: gpt-4o` |
| Footer or session link in the PR body at `as_of` | `Generated with Claude Code`, a Devin session link |
| Head branch prefix | `claude/`, `copilot/`, `cursor/` |
| Bot account | `copilot-swe-agent`, `devin-ai-integration` |

- **These fields mean "agent-marked", not "agent-written".** People remove markers, so false means no marker was seen, never that a person worked alone. One marked commit in a large PR shows assistance, and `marked_commit_share` separates that from a PR that is mostly marked.
- **Agent markers are arm inputs.** They are knowable at merge. A feature also gives every arm the same evidence, including the commit trailers that no content field exposes.
- **The exact model is a segment only.** New model names keep appearing, so the evaluation window would hold names training never saw, and each name also dates the PR. The validator requires any category used as an arm input to have a closed list.
- **Comparing tools or models is not causal.** Teams may give agents different work. A fair comparison uses actual versus predicted rework from a model trained without markers, on development repos, so that it stays outside the frozen gate.
- **Dependency bots are separate.** `is_bot` also covers merge and CI bots. `segment.author.dependency_bot` uses the same login pattern as the corrective label, and supports the separate reporting in pre-registration §2. Dependency and merge bots are not agent markers.

Before the freeze, the audit reviews a sample from development repos by hand and reports the detector's precision, along with marker rate by quarter and how well markers alone predict rework. `fixtures/arbiter/rework-risk/agent-marker-cases.json` tests behaviour only; its cases are written by hand. Undisclosed agent use cannot be measured.

`classifyCommitActor` in the survival labeller is deliberately separate. It sets `undone_by` in versioned labels, so changing it needs a labeller version bump and relabelling.

## Boundary rulings

- **Blast radius:** structure computed from the tree at `merge_sha` is a feature. Anything observed from the fix, including repair-pair `graph_distance`, is a label.
- **Label history:** features never read label tables. A prior-fix count comes from commit subjects among ancestors. A label for an earlier PR may not have been known yet at `as_of`, and reading from label tables would hide that.
- **Review counts:** `feature.process.changes_requested` is any PR's GitHub activity up to `as_of`. `segment.provenance.change_requests` is what an instrumented harness recorded. They are separate fields because only the first exists for every PR.
- **Label-side fields:** repair pairs, cause codes and exclusion codes can only ever be targets (pre-registration §8.5). The `label.*` namespace and the denylist reject them as features.

## Coverage evidence

`scripts/corpus/probe-merge-time-coverage.mjs` sampled 6,448 merged PRs across all 18 repos and 25 months, with no failed queries. `fixtures/arbiter/corpus/hok-3023-merge-time-coverage.json` holds the aggregate counts, measured on 2026-11-09. The sample takes up to 15 PRs per month, from days 10–16, in creation order.

| Quarter | PRs | CI usable at merge | Reviews after merge | Label events after merge | Body edits after merge |
| --- | --: | --: | --: | --: | --: |
| 2024Q3 | 779 | 0% | 102 | 511 | 43 |
| 2024Q4 | 778 | 0% | 81 | 473 | 87 |
| 2025Q1 | 786 | 0% | 118 | 560 | 84 |
| 2025Q2 | 763 | 0% | 77 | 708 | 71 |
| 2025Q3 | 776 | 0% | 46 | 684 | 49 |
| 2025Q4 | 767 | 91% | 73 | 695 | 49 |
| 2026Q1 | 785 | 100% | 77 | 669 | 74 |
| 2026Q2 | 771 | 100% | 45 | 525 | 79 |
| 2026Q3 (July) | 243 | 100% | 22 | 166 | 29 |

"CI usable" means at least one CI result on the PR's head commit finished by merge.

**CI is not an arm input.** The owner's rule was at least 80% coverage in every repo and period, and 93 of 161 repo-quarter cells fall below it. Using CI would also leak time: older rows would be null and the evaluation window (the last 6 months) would be populated, so a model could learn the period from the null. CI remains a recent-window segment. Coverage this sharp looks like a rolling retention limit, in which case the oldest CI data is disappearing and needs capturing soon. That cause isn't confirmed.

**Current PR metadata is not merge-time data.** Post-merge changes vary widely by repo:

- **Labels:** mattermost, cpython, cockroach and kibana average 2.2 to 3.2 post-merge label events per PR.
- **Bodies:** kibana has about 55 post-merge edits per 100 PRs, and ClickHouse about 39.

Labels, titles and bodies must be replayed from their event history.

The pytorch cells cover only the 144 PRs GitHub reports as merged, which is not representative of that repo.

## Slice protection

The evaluation slice stays sealed through this work:

- Features are extracted for all 18 repos, so the run does not reveal the slice.
- Reviewed samples and distribution checks use the development repos only, through the `--exclude-slice` pattern.
- Slice repos report pass or fail only.

The coverage probe above is the one exception. It reports evidence availability per repo and quarter for all 18 repos alike, so it does not reveal which repos are in the slice. It holds no labels, outcomes or PR identifiers.

## Extraction

`hokusai-scan corpus-features` builds the rows, one step at a time per repo:

| Step | Output | Published? |
| --- | --- | --- |
| `--step ci` | CI results on each PR's head commit, from `feature-evidence/ci/` | No, local only |
| `--step evidence` | Timestamped reviews, labels, renames, body versions and commits, in `feature-evidence/evidence/` | No, holds raw text |
| `--step extract` | `features.jsonl.gz` and `features.summary.json` | Yes, derived values and hashes only |
| `--step manifest --out <file>` | The run manifest: file hashes and row counts per repo | Yes |

Capture resumes where it stopped. `extract` reads no network or clock, so it can be repeated from the same evidence.

- **Rows:** every row has all manifest columns, plus `repo`, `pr_number`, `merge_sha`, `base_sha`, `landed_by`, `as_of` and `as_of_basis`. `as_of_basis` is null when no evidence could be captured for the PR.
- **Cutoff in git:** a commit counts only if it landed at or before `base_sha` on the default branch's first-parent line. Commit dates are never read, and 90-day windows use landing time, so a backdated commit cannot enter a window early.
- **Rollup members:** a member's parent is off the first-parent line, so its history stops just before the rollup landed. Earlier members of the same rollup are left out, which can only undercount.
- **Author history:** the author's commits are matched by the email addresses on their own commits in the PR. A squash PR with no commits to read falls back to the landing commit's email.
- **Paths:** file history matches exact paths and does not follow renames.
- **Diff hash:** `feature.content.diff_sha256` hashes the output of `git diff --no-renames --no-ext-diff --no-textconv --no-color --full-index -p <base_sha> <merge_sha>`.
- **CI capture:** only PRs merged from 2025-07-01 are requested, a quarter earlier than the first retained results the probe found. A CI failure means `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE` or `ERROR`; a cancelled run usually means it was superseded.
- **Branch updates:** merge commits from updating a PR's branch don't count toward `marked_commit_share`.

The first full run, at commit b49a1d9, produced 364,743 rows for all 18 repos, with no failed rows and 2 PRs without evidence. `fixtures/arbiter/corpus/hok-3023-feature-run-manifest.json` holds its counts and file hashes, and the rows are in `s3://hokusai-pipeline-data-development/arbiter-corpus/hok-3023/`.

## Using the validator

Dataset assembly and experiment evaluation must run the validator on their feature columns and stop on any error, and must pass every case in the conformance file.

```bash
hokusai-scan corpus-feature-audit --columns columns.json
```

`columns.json` is a JSON array of column names. Pass feature columns only, not row identity or the target. Add `--allow-segments` only when reporting a segment.

| Exit code | Meaning |
| --- | --- |
| 0 | The columns pass |
| 1 | Leakage found; the errors are in the JSON on stdout |
| 2 | Usage or input error |
