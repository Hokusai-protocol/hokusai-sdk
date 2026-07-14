# Codex Adapter

`@hokusai/adapter-codex` exposes the Hokusai adapter surface for Codex-facing integrations built on top of `@hokusai/core`.

## Install

```sh
pnpm add @hokusai/adapter-codex @hokusai/core
```

For the installable Codex plugin, verify setup after configuring auth:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
```

```text
$hokusai-doctor
```

## The user surface is skills, not slash commands

Inside Codex, the plugin is driven by skills:

- `$hokusai-route` — get a routing recommendation
- `$hokusai-report` — preview and contribute the outcome of the latest route
- `$hokusai-privacy` — show consent, retention, and stored state
- `$hokusai-doctor` — diagnose setup problems

`CODEX_COMMAND_MANIFEST` (`hokusai:run`, `hokusai:recommend`, `hokusai:preview`,
`hokusai:outcome`) is a **library-level** descriptor list for embedders building
their own Codex surface. It is not what a plugin user types.

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
- `promptOutcomeContributionWithCodex()`

The installable Codex plugin bundles skills and an MCP stdio server. It ships **no hooks**: Codex discovers `hooks/hooks.json` by convention and trust-gates it at install, so the MVP never asks you to trust one. Use `$hokusai-doctor` as the final quickstart verification step before routing tasks, and `$hokusai-report` to contribute an outcome — it does not submit without `HOKUSAI_OUTCOME_OPT_IN=true` and explicit approval in the report flow.

## Privacy and consent

Use the shared [privacy model](../../docs/privacy-model.md) for env-only API key handling, local storage denylist behavior, retention, previews, and the `HOKUSAI_OUTCOME_OPT_IN` outcome submission opt-in.
