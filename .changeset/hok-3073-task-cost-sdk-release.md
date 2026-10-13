---
'@hokusai/costs': minor
---

Release the drop-in task cost SDK (HOK-3073): new `measureTask` and
`createTaskCostTracker` APIs on the package root, returning a camelCase
`TaskCostReport` (`totalUsd`, `byModel`, `byHarness`, `usage`, `source`,
`pricing`, `coverage`, `diagnostics`).

- **Offline, no credentials**: measurement never reads `HOKUSAI_API_KEY`,
  never touches the network, and never imports `@hokusai/router`. Routing
  and contribution remain optional and separate.
- **Automatic capture** requires supported usage sources: Claude Code or
  Codex session files (`harness` + `sessionFile`) or already-normalized
  usage records (`events`). Otherwise record usage manually via the tracker;
  a task that captured nothing reports `coverage: 'none'`, never throws.
- `totalUsd` sums each record's resolved cost (provider-reported, else
  estimated) and is a documented lower bound under partial coverage.
- The tarball now ships `README.md` and a verified runnable example
  (`examples/task-cost-offline.mjs` + sanitized fixture); `pnpm smoke:costs`
  verifies the packed tarball in a fresh consumer under a no-network guard.
- **Compatibility**: feed `cost.totalUsd` to `@hokusai/core`'s
  `resolveActualCostUsd` as `explicitActualCostUsd`; bucket it into
  `OutcomeReport.costBucket` (exact figures go in `extensions`).
- **Rollback**: revert to the previous published version; the new API is
  additive and no existing export changed behavior.

Note: the changesets `fixed` group bumps `@hokusai/core`, `@hokusai/router`,
`@hokusai/costs`, the adapters, and `@hokusai/scan` together (0.4.0 → 0.5.0);
this is expected.
