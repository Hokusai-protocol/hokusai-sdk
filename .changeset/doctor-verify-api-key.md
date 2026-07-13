---
'@hokusai/core': minor
---

`hokusai-doctor` now verifies the API key is actually accepted, not merely
present. The `api-key` check only proved the variable was set, and
`api-reachability` probes an unauthenticated health path where a 401 means "the
API is up and auth-gated" — so an expired key produced a fully green "ready to
use" report while every route failed.

The new `api-key-accepted` check sends a real authenticated request. It GETs the
route path: auth runs before method dispatch, so a live key comes back 405 and a
dead one comes back 401, verifying the key without creating a routing row or
spending anything. A rejected key now fails the doctor with remediation naming
the stale key.
