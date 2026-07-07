# Codex Adapter

`@hokusai/adapter-codex` exposes the Hokusai adapter surface for Codex-facing integrations built on top of `@hokusai/core`.

## Install

```sh
pnpm add @hokusai/adapter-codex @hokusai/core
```

For the installable Codex plugin, verify setup after configuring auth and routing consent:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
export HOKUSAI_ROUTING_CONSENT=true
```

```text
$hokusai-doctor
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
- `promptOutcomeContributionWithCodex()`

The installable Codex plugin bundles skills, MCP tooling, and optional outcome prompt hooks. Use `$hokusai-doctor` as the final quickstart verification step before routing tasks. After likely successful work, `hokusai-codex-outcome-hook` can prompt the user to run `$hokusai-report` against the latest route; it does not submit without `HOKUSAI_OUTCOME_OPT_IN=true` and explicit approval in the report flow.

## Privacy and consent

Use the shared [privacy model](../../docs/privacy-model.md) for env-only API key handling, local storage denylist behavior, retention, previews, and the `HOKUSAI_ROUTING_CONSENT` / `HOKUSAI_OUTCOME_OPT_IN` split.
