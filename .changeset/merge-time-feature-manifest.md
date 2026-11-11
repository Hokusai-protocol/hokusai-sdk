---
'@hokusai/core': minor
'@hokusai/scan': minor
---

Add the Rework Risk merge-time feature manifest and leakage validator (HOK-3023).

- **Manifest.** `REWORK_RISK_FEATURE_MANIFEST` (`rr-merge-features/0.4.0`, draft) declares every field an arm may use, with its `as_of` source and null meaning. Provenance and CI fields are `segment.*` and cannot be arm inputs.
- **Validator.** `validateFeatureManifest`, `validateFeatureColumns` and `validateEvidenceAsOf` reject post-merge sources, `label.*` fields, denylisted label-side fields and undeclared columns.
- **Agent markers.** `feature.agent.*` gives every arm the evidence that an agent tool worked on a PR, including one opened under a person's account. `segment.agent.exact_model` and `segment.author.dependency_bot` are reported separately.
- **Attribution.** `attributePullRequest` now recognizes Claude and Copilot co-author trailers, agent footers, `Assisted-by` trailers and authorship statements ("Authored by Claude Code") in commits and PR bodies, an organization's own agent accounts such as `acme-claude-bot`, and `claude/`, `copilot/`, `cursor/`, `devin/`, `gemini/` and `openhands/` branches. It no longer calls a PR agent-written because a commit names a model or has a bot co-author such as dependabot. Agent coverage in scan reports will change as a result.
- **Extraction.** `hokusai-scan corpus-features` captures timestamped evidence and builds one row per PR with a pure, offline extractor. Timeline events are captured in their own step, because GitHub silently truncates them in large batches.
- **Audit.** `hokusai-scan corpus-feature-replay` replays sampled development-repo PRs with git and evidence cut at the merge, and with fabricated post-merge activity, and requires byte-identical rows.
- **CLI.** `hokusai-scan corpus-feature-audit` gives other languages the same validator: exit 0 passes, 1 means leakage, 2 means bad input.
