# Release Notes

## Versioning model

- Packages are versioned independently.
- Coordinated releases are created by adding a changeset that references multiple packages.
- `@hokusai/core` remains the stable dependency anchor for adapter packages.

## Commands

```sh
pnpm changeset
pnpm changeset status
pnpm version-packages
git tag v0.x.y
git push origin v0.x.y
```

## Publishing expectations

- Publishable artifacts come from `packages/*`.
- The example app is private and never published.
- `v*` tags publish public npm packages through Changesets and attach signed Claude Code/Codex plugin release artifacts.
