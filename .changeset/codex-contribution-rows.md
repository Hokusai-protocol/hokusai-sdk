---
'@hokusai/core': minor
'@hokusai/adapter-codex': minor
---

Codex now contributes. Its outcomes were posted to the legacy `/outcomes`
endpoint — a path that 404s, and that `docs/reference-pattern.md` forbids for new
integrations because it bypasses training and reward attribution entirely. Codex
could not switch to contribution rows because it never captured what one needs:
its route persisted no `inference_log_id` and no route context, and the profile
hook was not even given the route response.

`executeRouteCommand` now builds the route context once and passes it, with the
route's inference log id, to `storeCorrelationMetadata` — so any harness on the
shared command path can later build an attributable row. `submitOutcomeCommand`
submits a contribution row instead of a legacy outcome, and fails loudly rather
than sending a row the server cannot score.

The Codex route and report tools take `maxCostUsd` and `actualCostUsd`. Both are
needed for a `training_eligible` row: the server scores the cost against the
budget, and a row missing either is filed as `partial` — telemetry that trains
nothing and earns nothing.
