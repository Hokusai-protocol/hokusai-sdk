# Versioning Policy

This repository uses semantic versioning for package releases and explicit schema versions for public payloads. SDK consumers should treat both package versions and schema constants as compatibility signals.

## Semantic Versioning Rules

- PATCH: bug fixes, documentation updates, internal refactors, and other non-breaking changes with no public API or schema change.
- MINOR: backward-compatible public additions such as new exports, new optional schema fields, new adapter methods, or new enum values.
- MAJOR: breaking contract changes such as removed exports, renamed required schema fields, removed enum values, changed method signatures, or removed adapter interface methods.

## Package Independence

Packages are versioned independently through Changesets.

- `@hokusai/core` is the stable dependency anchor.
- Adapter packages depend on `@hokusai/core` as `workspace:*` in the monorepo.
- Published adapter releases are expected to track the active `@hokusai/core` major version.
- Coordinated releases should bump every affected package in the same changeset set.

## Schema Version and Package Version Relationship

The canonical schema versions are exported from `@hokusai/core`:

- `TASK_PACKET_SCHEMA_VERSION = "1.1.0"`
- `OUTCOME_REPORT_SCHEMA_VERSION = "1"`

Rules:

- A task-packet or outcome-schema additive change that preserves backward compatibility requires a `@hokusai/core` MINOR bump and an appropriate schema version bump.
- A task-packet or outcome-schema breaking change requires a `@hokusai/core` MAJOR bump and a schema MAJOR bump.
- PATCH package releases must not change either schema constant.
- Runtime validators accept only the exact exported schema version. Callers should use `TASK_PACKET_SCHEMA_VERSION` and `OUTCOME_REPORT_SCHEMA_VERSION` instead of hard-coding literals.

## Breaking Change Taxonomy

### Adapter Contracts

The following are MAJOR changes:

- removing or renaming any method on `HarnessAdapter` or its sub-interfaces
- changing the required shape of adapter request or result types
- removing a public adapter factory such as `createClaudeCodeHarnessAdapter()` or `createCodexHarnessAdapter()`

Adding a new optional adapter capability or helper is a MINOR change.

### Schema Changes

The following are MAJOR changes:

- removing or renaming a schema field
- changing an optional field to required
- changing field meaning incompatibly
- removing an allowed enum value

The following are MINOR changes:

- adding a new optional field
- adding a new allowed enum value
- adding new harness extension keys under a versioned `extensions.data` object

### API Client Behavior

The following are MAJOR changes:

- changing the name or compatibility meaning of `HokusaiApiError`
- changing the name or compatibility meaning of `HokusaiAuthError`
- changing the name or compatibility meaning of `HokusaiValidationError`
- changing the name or compatibility meaning of `HokusaiDispatchError`

Adding a new typed error class, helper export, or optional request behavior is a MINOR change if existing callers continue to work unchanged.

## Deprecation Lifecycle

Deprecations follow a three-step lifecycle:

1. Announce: mark the field, method, or export as deprecated in JSDoc and document the replacement in the same MINOR release.
2. Support: keep the deprecated item available for at least one full MAJOR version after deprecation.
3. Remove: remove the deprecated item only in a MAJOR release and include migration notes in the changeset.

Deprecated schema fields should remain accepted for the supported window whenever that can be done without violating the strict top-level validation model. If compatibility cannot be preserved, the removal is treated as a breaking schema change and requires a MAJOR release.

## Release Channels

### Stable

Stable releases are the default release channel:

- package versions are published via `pnpm release`
- version numbers are computed from Changesets
- GitHub `v*` tags trigger the release workflow that publishes npm packages and the Claude Code/Codex plugin zip assets with checksums and detached signatures

### Pre-release

No pre-release channel is configured today. If a pre-release channel is needed later, use Changesets pre mode with `pnpm changeset pre enter <tag>` and publish under that tag until the release is promoted.

## Consumer Guidance

- Pin package majors when you need long-lived harness integrations.
- Import schema version constants from `@hokusai/core` instead of copying literals.
- Treat adapter majors as contract changes to the harness-specific layer even when the core package major is unchanged.
- Review changesets and release notes before adopting a new MAJOR or schema version.
