# @hokusai/costs

## 0.5.0

Released 2026-10-15.

### Minor Changes

- First published release. Measures cost per task, without network access:
  `measureTask(options, fn)` returns a typed `TaskCostReport`, and
  `createTaskCostTracker` provides explicit
  `record`/`recordUsage`/`summary`/`flush`/`reset`. Includes the pricing
  engine, the Claude Code and Codex session-file adapters, and the opt-in local
  ledger.
- Makes no network calls, reads no `HOKUSAI_API_KEY`, and writes nothing to
  disk by default.

### Dependencies

- Pins `@hokusai/core` to exactly `0.5.0`. If a host also depends on
  `@hokusai/core` directly, it should use the same version.

See the [0.5.0 release notes](https://github.com/Hokusai-protocol/hokusai-sdk/blob/main/docs/release-notes.md#050--2026-10-15).
