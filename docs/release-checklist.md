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
- [ ] Run the clean-consumer cost smoke test against the packed tarballs: `pnpm smoke:costs`

## Additional Steps for Schema or API Changes

- [ ] Update `examples/reference-harness/examples/task-packet.example.json` when task packet fields change.
- [ ] Update `examples/reference-harness/examples/outcome-report.example.json` when outcome fields change.
- [ ] Update conformance fixtures in `packages/core/src/conformance.ts` when shared contract behavior changes.
- [ ] Bump `TASK_PACKET_SCHEMA_VERSION` and/or `OUTCOME_REPORT_SCHEMA_VERSION` with the correct semantic meaning.
- [ ] Update [Payload Schemas](payload-schemas.md) and [SDK Overview](sdk-overview.md) to match the new public contract.

## Changeset Process

- [ ] Run `pnpm changeset` and describe the public change.
- [ ] Choose `major`, `minor`, or `patch` according to [Versioning Policy](versioning-policy.md).
- [ ] Run `pnpm version-packages` to apply the release versions. This runs
      `changeset version` and then `pnpm sync:versions`, which propagates the new
      version into the two plugin manifests, the marketplace entry, and
      `SDK_VERSION` — none of which changesets touches.
- [ ] Commit the result, **including the rebundled
      `packages/adapter-claude-code/plugin/dist/index.js`** (`pnpm -r build && pnpm --filter @hokusai/adapter-claude-code bundle:plugin`).
      The marketplace serves that file from `main` HEAD.
- [ ] Confirm `pnpm version-packages` updated each package's `CHANGELOG.md`
      (at minimum `packages/core` and `packages/costs`), and add a
      `Released YYYY-MM-DD.` line under the new `## x.y.z` heading.
- [ ] In [Release Notes](release-notes.md), replace the `— unreleased` heading
      with the release date. If the release adds or changes a contract constant
      (task-cost, schemas), add a **Requires** line and a row in the
      [Versioning Policy](versioning-policy.md) tables.
- [ ] Confirm `pnpm check:versions` passes. It is also enforced in CI on every PR.
- [ ] Ensure repository secrets are configured: `NPM_TOKEN`, `GPG_PRIVATE_KEY`, and `GPG_PASSPHRASE`.
- [ ] Push a `v*` tag **matching the new package version** to publish npm packages
      and plugin artifacts through GitHub Actions.

> All `@hokusai/*` packages are versioned together (`fixed` in
> `.changeset/config.json`), so one tag equals one version across every package
> and both plugin manifests. The release build asserts the manifest against the
> tag and aborts if they differ.

## Claude Code Plugin Release

- [ ] Create and push a matching `v*` tag such as `git tag v0.x.y && git push origin v0.x.y`.
- [ ] Confirm the GitHub Actions release workflow publishes the Claude Code and Codex plugin zips.
- [ ] Verify the GitHub Release includes the expected zip assets, SHA-256 outputs, and detached `.asc` signatures.

## Post-release Verification

- [ ] Confirm `npm view @hokusai/router version`, `npm view @hokusai/core version`, `npm view @hokusai/costs version`, and each adapter package return the published version.
- [ ] Confirm `npm install @hokusai/router @hokusai/core @hokusai/costs @hokusai/adapter-claude-code @hokusai/adapter-codex @hokusai/adapter-wavemill` succeeds in a clean temporary project.
- [ ] Re-run the cost smoke test against the registry: `node scripts/smoke-costs-consumer.mjs --registry <version>` (gates the Wavemill dependency switch, HOK-3075).
- [ ] Reinstall the published packages in `examples/reference-harness` and rerun its tests.
- [ ] Run the [Claude Code Plugin Launch Smoke Checklist](plugin-launch-checklist.md) against the published plugin zip.
- [ ] Update [Release Notes](release-notes.md) with the release summary.
