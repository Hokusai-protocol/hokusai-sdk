# Hokusai SDK

Standalone monorepo scaffold for the public Hokusai SDK. The repository separates reusable core contracts from harness-specific adapters so Claude Code, Codex, Wavemill, and future integrations can share the same foundation without depending on private Wavemill state.

## Package map

- `packages/core`: public client contracts, task/outcome schemas, anonymization helpers, consent/config types, model registry, and correlation storage interfaces.
- `packages/adapter-claude-code`: installable Claude Code plugin surface and routing adapter built on `@hokusai/core`.
- `packages/adapter-codex`: Codex command and manifest stubs built on `@hokusai/core`.
- `packages/adapter-wavemill`: Wavemill reference adapter boundary built on `@hokusai/core` without Wavemill internals.
- `examples/reference-harness`: minimal offline composition template.

## Architecture rules

- `@hokusai/core` must not import adapters or examples.
- Adapters and examples may depend on `@hokusai/core`.
- A fresh clone must build and test without secrets, network services, private registries, or local Wavemill state.

Run `pnpm check:boundaries` to enforce the core dependency direction.

## Documentation

Install `@hokusai/core` for every integration and add an adapter package only for the harness you are targeting. See [SDK Overview](docs/sdk-overview.md) for package install commands and the full public API surface.

- [SDK Overview](docs/sdk-overview.md) - package installation, public interfaces, core vs adapter APIs, schemas, model mapping, and adapter lifecycle
- [Versioning Policy](docs/versioning-policy.md) - semver rules, schema-version relationship, breaking-change taxonomy, and deprecation policy
- [Release Checklist](docs/release-checklist.md) - pre-release gating, conformance tests, fixture updates, and release channels
- [Privacy Model](docs/privacy-model.md) - consent settings, redaction, local data retention
- [Integration Guide](docs/integration-guide.md) - recommended integration flow and adapter reuse
- [Reference Pattern](docs/reference-pattern.md) - the 5-step route/report loop with code examples
- [Payload Schemas](docs/payload-schemas.md) - wire schema reference for route request and outcome report
- [Release Notes](docs/release-notes.md) - version history and release commands

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm check:boundaries
pnpm -r build
pnpm -r test
```

## Release flow

- Independent release: create a changeset that references one package, then run `pnpm version-packages`.
- Coordinated release: create a single changeset touching multiple packages.
- Publish flow: `pnpm release`.

See [docs/integration-guide.md](docs/integration-guide.md), [docs/reference-pattern.md](docs/reference-pattern.md), [docs/privacy-model.md](docs/privacy-model.md), [docs/payload-schemas.md](docs/payload-schemas.md), and [docs/release-notes.md](docs/release-notes.md) for repository-level guidance.
