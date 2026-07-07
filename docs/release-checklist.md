# Release Checklist

Use this checklist before publishing SDK package or adapter changes.

## Pre-release Gating

- [ ] Run the full test suite: `pnpm -r test`
- [ ] Run adapter tests for `@hokusai/adapter-claude-code`: `pnpm --filter @hokusai/adapter-claude-code test`
- [ ] Run adapter tests for `@hokusai/adapter-codex`: `pnpm --filter @hokusai/adapter-codex test`
- [ ] Run adapter tests for `@hokusai/adapter-wavemill`: `pnpm --filter @hokusai/adapter-wavemill test`
- [ ] Confirm each adapter's `conformance.test.ts` passes as part of those adapter test runs.
- [ ] Verify example fixtures still validate through the reference harness tests: `pnpm --filter reference-harness test`
- [ ] Run lint: `pnpm lint`
- [ ] Run type-checking: `pnpm typecheck`
- [ ] Run boundary checks: `pnpm check:boundaries`
- [ ] Build all packages: `pnpm -r build`

## Additional Steps for Schema or API Changes

- [ ] Update `examples/reference-harness/examples/task-packet.example.json` when task packet fields change.
- [ ] Update `examples/reference-harness/examples/outcome-report.example.json` when outcome fields change.
- [ ] Update conformance fixtures in `packages/core/src/conformance.ts` when shared contract behavior changes.
- [ ] Bump `TASK_PACKET_SCHEMA_VERSION` and/or `OUTCOME_REPORT_SCHEMA_VERSION` with the correct semantic meaning.
- [ ] Update [Payload Schemas](payload-schemas.md) and [SDK Overview](sdk-overview.md) to match the new public contract.

## Changeset Process

- [ ] Run `pnpm changeset` and describe the public change.
- [ ] Choose `major`, `minor`, or `patch` according to [Versioning Policy](versioning-policy.md).
- [ ] Run `pnpm version-packages` to apply the release versions.
- [ ] Ensure repository secrets are configured: `NPM_TOKEN`, `GPG_PRIVATE_KEY`, and `GPG_PASSPHRASE`.
- [ ] Push a matching `v*` tag to publish npm packages and plugin artifacts through GitHub Actions.

## Claude Code Plugin Release

- [ ] Create and push a matching `v*` tag such as `git tag v0.x.y && git push origin v0.x.y`.
- [ ] Confirm the GitHub Actions release workflow publishes the Claude Code and Codex plugin zips.
- [ ] Verify the GitHub Release includes the expected zip assets, SHA-256 outputs, and detached `.asc` signatures.

## Post-release Verification

- [ ] Confirm `npm view @hokusai/core version` and each adapter package return the published version.
- [ ] Confirm `npm install @hokusai/core @hokusai/adapter-claude-code @hokusai/adapter-codex @hokusai/adapter-wavemill` succeeds in a clean temporary project.
- [ ] Reinstall the published packages in `examples/reference-harness` and rerun its tests.
- [ ] Run the [Claude Code Plugin Launch Smoke Checklist](plugin-launch-checklist.md) against the published plugin zip.
- [ ] Update [Release Notes](release-notes.md) with the release summary.
