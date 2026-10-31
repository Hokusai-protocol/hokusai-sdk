# @hokusai/scan

## 0.6.0

### Minor Changes

- a04a1a9: Add the versioned Arbiter report payload, scanner-owned suppression, and report aggregation and orchestration APIs.
- b654ba6: Add the HOK-3269 calibration taxonomy to `@hokusai/core` (verdicts, cause codes, human exclusion codes) and three `hokusai-scan` commands: `corpus-calibration-sample` draws a stratified, seeded sample from the persisted corpus outputs with the evaluation slice excluded; `corpus-calibration-evidence` gathers each item's diffs, candidate fixes and related later PRs plus a blank human-audit sheet; `corpus-calibration-score` reports precision, recall, Cohen's kappa and cause distribution for two model labellers and a human audit, and decides whether the model labels stand in.
- d7f0791: Add `corpus-corrective` (HOK-3267): P1 revert and P2 repair-reference fix detection for enumerated corpus repos. It writes corrective-rework candidates, repair pairs and corrective rows next to each repo's S2 labels.
- 21695b0: Add `hokusai-scan corpus-report` (HOK-3268): per repo × horizon corrective rates with Wilson CIs, proxy contributions, rejection rates, sanity flags (rate outside 0.5–25%) and the rate spread per merge convention (informational), computed once from the persisted corpus outputs, plus a run manifest that hashes every input file.
- 4469876: Corrective-rework schema 1.1.0 adds a `revert_reason` evidence kind (`REVERT_REASON_CLASSES`). `corpus-corrective` adds P3 (SZZ blame of bug fixes) and P4 (closed regression issues), and fetches the labels and types of closed issues.
- 3cac824: Survival labeller 1.3.0: `linked_issue_or_pr` counts only cross-references from an issue or PR in the same repo, by a non-bot author, and not a PR into another branch. Mirror repos, CI/perf bots and backports no longer mark a PR as followed up.

  Labelling is faster on large repos: each horizon now finds where the PR's files went with a diff scoped to those files, and runs the whole-repo rename scan only when one of them was deleted. Labels are unchanged.

- b849f17: Survival labeller 1.4.0: `undone_by` credits the commits that changed the PR's files, not the merge commit that landed them, so merge bots (bors, Prow, merge queues) and whoever pressed merge are no longer the undoer. Agent identities match whole names and known agent emails instead of substrings (a person named Devin or Claude is human). Dependency, CI and merge bots are `automation` and cast no vote. `classifyCommitActor` can now return `'automation'`. Survival, revert and reason codes are unchanged.
- 7196ec7: S2 survival label v1.1.0: add `envelope.integration_mode` (`promotion` | `direct`) and admit `integration_branch: main` only in `direct` mode, so repos that merge PRs straight into `main` can be labelled. v1.0.0 rows stay valid, and shadow outcome logs holding them remain readable. The scanner gains `--integration-mode` and labeller version 1.1.0.

### Patch Changes

- Updated dependencies [a04a1a9]
- Updated dependencies [b654ba6]
- Updated dependencies [4469876]
- Updated dependencies [fd95e1f]
- Updated dependencies [7196ec7]
- Updated dependencies [ffc4199]
  - @hokusai/core@0.6.0
