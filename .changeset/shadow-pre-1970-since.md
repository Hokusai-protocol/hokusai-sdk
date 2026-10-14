---
'@hokusai/scan': patch
---

Shadow discovery no longer passes a pre-1970 `--since` to `git log`. git
cannot parse such a date and silently matched no commits, so a
`--bootstrap-days` window reaching past the epoch scored nothing.
