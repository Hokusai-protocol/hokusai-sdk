# Codex Adapter

`@hokusai/adapter-codex` exposes the Hokusai adapter surface for Codex-facing integrations built on top of `@hokusai/core`.

## Install

```sh
pnpm add @hokusai/adapter-codex @hokusai/core
```

## Command manifest

`CODEX_COMMAND_MANIFEST` exports four command descriptors for a Codex integration surface:

- `hokusai:run`
- `hokusai:recommend`
- `hokusai:preview`
- `hokusai:outcome`

## Core exports

- `createCodexAdapter()`
- `createCodexModelProvider()`
- `createCodexHarnessAdapter()`
- `buildCodexTaskPacket()`
- `previewCodexTaskPacket()`
- `buildCodexOutcomeReport()`
- `previewCodexOutcomeReport()`
- `requestRecommendation()`
- `previewRoutePayload()`
- `submitOutcome()`

This package currently documents the adapter/library surface. Codex plugin packaging, skills, and MCP tooling are tracked separately and are not yet defined in this branch.

## Privacy and consent

Use the shared [privacy model](../../docs/privacy-model.md) for env-only API key handling, local storage denylist behavior, retention, previews, and the `HOKUSAI_ROUTING_CONSENT` / `HOKUSAI_OUTCOME_OPT_IN` split.
