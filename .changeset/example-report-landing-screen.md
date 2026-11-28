---
'@hokusai/scan': patch
---

Example reports: the probe now measures how many PRs the scanner can actually find (the share of PRs whose landing commit carries their number), and selection 0.2.0 screens on it. `example-review` adds a `prs_found` check that fails a scan with fewer PRs than the cell floor. Both catch rebase-merging repos that scan empty.
