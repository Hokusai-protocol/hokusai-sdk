---
'@hokusai/core': minor
'@hokusai/scan': minor
---

S2 survival label v1.1.0: add `envelope.integration_mode` (`promotion` | `direct`) and admit `integration_branch: main` only in `direct` mode, so repos that merge PRs straight into `main` can be labelled. v1.0.0 rows stay valid, and shadow outcome logs holding them remain readable. The scanner gains `--integration-mode` and labeller version 1.1.0.
