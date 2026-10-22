---
'@hokusai/scan': minor
---

Survival labeller 1.3.0: `linked_issue_or_pr` counts only cross-references from an issue or PR in the same repo, by a non-bot author, and not a PR into another branch. Mirror repos, CI/perf bots and backports no longer mark a PR as followed up.

Labelling is faster on large repos: each horizon now finds where the PR's files went with a diff scoped to those files, and runs the whole-repo rename scan only when one of them was deleted. Labels are unchanged.
