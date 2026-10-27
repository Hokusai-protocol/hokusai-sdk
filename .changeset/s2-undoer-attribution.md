---
'@hokusai/scan': minor
---

Survival labeller 1.4.0: `undone_by` credits the commits that changed the PR's files, not the merge commit that landed them, so merge bots (bors, Prow, merge queues) and whoever pressed merge are no longer the undoer. Agent identities match whole names and known agent emails instead of substrings (a person named Devin or Claude is human). Dependency, CI and merge bots are `automation` and cast no vote. `classifyCommitActor` can now return `'automation'`. Survival, revert and reason codes are unchanged.
