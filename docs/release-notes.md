# Release Notes

## Versioning model

- All `@hokusai/*` packages are versioned **together** (`fixed` in `.changeset/config.json`): one tag, one version, across every package and both plugin manifests.
- `pnpm version-packages` runs `changeset version` and then `pnpm sync:versions`, which propagates the version into the plugin manifests, the marketplace entry, and `SDK_VERSION`. Changesets does not touch those, and a stale plugin manifest aborts the release at tag time.
- `@hokusai/core` remains the stable dependency anchor for adapter packages.

## Commands

```sh
pnpm changeset
pnpm changeset status
pnpm version-packages
git tag v0.x.y
git push origin v0.x.y
```

## Releases

### 0.3.0 — unreleased

- **`@hokusai/router` is published for the first time.** The façade existed in the repo but had never been released, so the documented install (`npm install @hokusai/router`) did not resolve.
- **Outcomes are submitted as Model 30 contribution rows.** `@hokusai/router` and the Codex plugin previously posted to the legacy `/outcomes` endpoint, which 404s and which bypasses training and reward attribution entirely. Pass `maxCostUsd` when routing and `actualCostUsd` when reporting: without both, the server files the row as `partial` — telemetry that trains nothing and earns nothing.
- **The Codex plugin is installable.** The release zip shipped its marketplace manifest at the archive root, where Codex cannot see it; it now ships at `.agents/plugins/marketplace.json`. The install id is `hokusai@hokusai`. Skills carry the frontmatter Codex requires, the MCP server is launched the way Codex launches one, and the plugin no longer ships hooks it never registered.
- **`hokusai-doctor` verifies the API key** instead of only checking that the variable is set. An expired key previously produced a green "ready to use" report while every route failed.
- **`@hokusai/router` reads `HOKUSAI_API_KEY` from the environment**, which its README and JSDoc had always promised and never implemented.

## Publishing expectations

- Publishable artifacts come from `packages/*`.
- The example app is private and never published.
- `v*` tags publish public npm packages through Changesets and attach signed Claude Code/Codex plugin release artifacts.
