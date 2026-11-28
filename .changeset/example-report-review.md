---
'@hokusai/scan': minor
---

Add the example-report batch and review commands (HOK-3515). `example-batch` scans, re-scans and reviews every eligible repo in a manifest batch, resumably and within GitHub rate limits. `example-review` runs the automated honesty checks on one report: real data, not a training repo, out-of-sample provenance, threshold consistency, suppression re-applied, re-scan reproduces, and the positioning vocabulary rules on the rendered page. Report payloads now record the real package version through `SCAN_VERSION`, kept in sync by `pnpm sync:versions`; it was hard-coded to 0.4.0.

`example-batch --no-rescan` runs one scan per repo, for dry runs that measure yield and cost. Each scan has a 4-hour timeout, so a hung clone can't stall an unattended batch.
