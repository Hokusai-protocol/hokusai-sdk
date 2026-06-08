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
pnpm release
```

## Publishing expectations

- Publishable artifacts come from `packages/*`.
- The example app is private and never published.
- CI validates install, lint, typecheck, boundary checks, build, and tests only.
