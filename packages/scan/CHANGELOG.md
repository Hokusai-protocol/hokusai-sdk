# @hokusai/scan

## 0.9.0

Released 2026-11-17.

### Minor Changes

- 3f531c9: Add auditor checks for the HOK-3269 calibration: `corpus-calibration-gold` mixes hidden known-answer rows into the blank human-audit sheet, `corpus-calibration-screen` writes and grades the auditor screening test, and `corpus-calibration-score` removes hidden rows before estimating and reports whether the audit passed.
- db0dc6e: Corrective-rework definitions are now a table (HOK-3269).
  - **Core.** `CORRECTIVE_REWORK_DEFINITIONS` lists every definition by version, and `admittedProxiesFor` returns the proxies one admits. `deriveCorrectiveLabel` reads the admitted proxies from the envelope's `definition_version` and throws on a version it does not know. Adds `cr-0.2.0`: reverts and repair references only. `cr-0.1.0` stays the default.
  - **Scan.** `hokusai-scan corpus-corrective-derive --definition <cr-x.y.z>` writes `corrective.<definition>.jsonl.gz` from the repair pairs `corpus-corrective` already wrote, without re-running detection.

- 50f0c6d: Adds `cr-0.3.0`, the defect-repair definition: repair references and regression issues only. It is reported alongside the Rework Risk target and never gates. Calibration scoring shows it as `defect_repair`, a report-only variant that the pick rules skip, so frozen plans pick as before. `corpus-calibration-sample` gains `--exclude-sample <sample.json>` (repeatable), which leaves an earlier sample's PRs out of a new draw and records that sample's SHA-256.
- 7d0b8f1: Add the Rework Risk merge-time feature manifest and leakage validator (HOK-3023).
  - **Manifest.** `REWORK_RISK_FEATURE_MANIFEST` (`rr-merge-features/1.0.0`, frozen by the leakage audit) declares every field an arm may use, with its `as_of` source and null meaning. Provenance and CI fields are `segment.*` and cannot be arm inputs.
  - **Validator.** `validateFeatureManifest`, `validateFeatureColumns` and `validateEvidenceAsOf` reject post-merge sources, `label.*` fields, denylisted label-side fields and undeclared columns.
  - **Agent markers.** `feature.agent.*` gives every arm the evidence that an agent tool worked on a PR, including one opened under a person's account. `segment.agent.exact_model` and `segment.author.dependency_bot` are reported separately.
  - **Attribution.** `attributePullRequest` now recognizes Claude and Copilot co-author trailers, agent footers, `Assisted-by` trailers and authorship statements ("Authored by Claude Code") in commits and PR bodies, an organization's own agent accounts such as `acme-claude-bot`, and `claude/`, `copilot/`, `cursor/`, `devin/`, `gemini/` and `openhands/` branches. It no longer calls a PR agent-written because a commit names a model or has a bot co-author such as dependabot. Agent coverage in scan reports will change as a result.
  - **Extraction.** `hokusai-scan corpus-features` captures timestamped evidence and builds one row per PR with a pure, offline extractor. Timeline events are captured in their own step, because GitHub silently truncates them in large batches.
  - **Audit.** `hokusai-scan corpus-feature-replay` replays sampled development-repo PRs with git and evidence cut at the merge, and with fabricated post-merge activity, and requires byte-identical rows.
  - **CLI.** `hokusai-scan corpus-feature-audit` gives other languages the same validator: exit 0 passes, 1 means leakage, 2 means bad input.

### Patch Changes

- Updated dependencies [db0dc6e]
- Updated dependencies [50f0c6d]
- Updated dependencies [7d0b8f1]
- Updated dependencies [54bb506]
- Updated dependencies [40a018d]
  - @hokusai/core@0.9.0

## 0.8.0

Released 2026-11-05.

### Patch Changes

- Updated dependencies [feac07a]
  - @hokusai/core@0.8.0

## 0.7.0

Released 2026-11-02.

### Patch Changes

- Updated dependencies [aa05c98]
- Updated dependencies [219ffc5]
  - @hokusai/core@0.7.0

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
