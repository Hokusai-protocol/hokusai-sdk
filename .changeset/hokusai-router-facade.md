---
'@hokusai/router': minor
---

Add `@hokusai/router`, a thin zero-config façade over `@hokusai/core` matching
the homepage sample: `route({ task, context, availableModels, objective })` and
`route.reportOutcome(...)`. The common case no longer constructs a
`HokusaiDispatchBuilder`, consent snapshot, or `InMemoryModelRegistry`; advanced
users can still drop to `@hokusai/core`. Candidate pools are typed and singleton
pools are not hidden — `route()` propagates the core validation error unless the
caller opts into `routingMode: 'non-ranking'`.
