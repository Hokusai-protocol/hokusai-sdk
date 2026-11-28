---
'@hokusai/scan': patch
---

`report --wait-on-rate-limit` waits out GitHub rate limits (up to 2 hours) instead of failing part-way through a long scan. `report` no longer fails on PRs that changed too many files for the REST API (HTTP 422): it fetches them through GraphQL instead.
