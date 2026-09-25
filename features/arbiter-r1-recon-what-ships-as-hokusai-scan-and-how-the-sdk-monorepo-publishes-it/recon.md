# Recon: Package Boundary for @hokusai/scan

**Date:** 2026-09-25  
**Issue:** HOK-2788  
**Repo:** Hokusai/hokusai-sdk

---

## Assumptions

This recon verifies the following assumptions from the Arbiter Program Brief and Plan of Record:

1. **§11.3 of Plan of Record:** The labeller record requires a repo-agnostic core callable with `(owner, repo, integrationBranch, token)` and **no wavemill state**. Constraint: **labeller lives in one package**.
2. **§13.2 of Plan of Record:** Private-repo scanning uses `npx @hokusai/scan` locally or as a one-shot `workflow_dispatch` Action (**same code**).
3. **§15.3 of Plan of Record:** Action first: features computed in the repo's own CI runner, derived features or nothing leave; one workflow file.
4. **§20 Q6 of Plan of Record:** Hosted reports are a website concern; scan itself is in-repo.
5. **Program Brief §2:** "Rule for scanner work" paragraph requires the labeller and extractor to be built in wavemill and extracted into the SDK, but the package boundary inside the SDK was not yet named.

---

## Workspace Map

Six published packages and three examples in the monorepo. Verification: `pnpm-workspace.yaml` (`packages/*`, `examples/*`); `ls packages/` confirms six entries.

| Package | Version | Private | Bin | Files | @hokusai/* Deps | Path |
|---------|---------|---------|-----|-------|-----------------|------|
| @hokusai/core | 0.4.0 | false | — | `dist` | — | `packages/core` |
| @hokusai/router | 0.4.0 | false | — | `dist` | core | `packages/router` |
| @hokusai/adapter-aider | 0.4.0 | false | `hokusai-aider` → `./dist/cli.js` | `dist`, `README.md` | core | `packages/adapter-aider` |
| @hokusai/adapter-claude-code | 0.4.0 | false | 5 CLIs in `plugin/bin/` | `dist`, `plugin` | core | `packages/adapter-claude-code` |
| @hokusai/adapter-codex | 0.4.0 | false | 2 CLIs in `plugin/bin/` | `dist`, `plugin` | core | `packages/adapter-codex` |
| @hokusai/adapter-wavemill | 0.4.0 | false | — | `dist` | core | `packages/adapter-wavemill` |

**Citation:** `.changeset/config.json` lines 5–11, verified with `jq '{name, version, private, bin, files}' packages/*/package.json`.

---

## Release Process

### Workflows and Triggers

- **Release workflow** (`.github/workflows/release.yml`): Triggered by `push: tags: [v*]`. Runs lint, typecheck, boundary check, build, test, plugin bundling, zip packaging, sha256 verification, GPG signing, and `pnpm release --no-git-tag` to npm with provenance. Secrets: `NPM_TOKEN`, `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`.
  
- **CI workflow** (`.github/workflows/ci.yml`): Triggered on `push: branches: [main, task/**]` and `pull_request`. Runs lint, typecheck, `check:boundaries`, `check:versions`, `check:docs`, build, test, and a "Plugin zips build at a release tag" step that regenerates both zips at a hypothetical next version to enforce committed-dist freshness.

### Versioning

- **Fixed changeset group** (`.changeset/config.json` lines 5–11): `[@hokusai/core, @hokusai/router, @hokusai/adapter-claude-code, @hokusai/adapter-codex, @hokusai/adapter-wavemill]` version together. **UNVERIFIED:** `@hokusai/adapter-aider` is not in the fixed group (v0.4.0 is matched manually).
  
- **Version propagation:** `scripts/sync-versions.mjs` (invoked via `check:versions` and `version-packages`) propagates changeset version into plugin manifests, marketplace entry, and `SDK_VERSION` constants.

### Boundary Enforcement

**Core-boundaries check** (`scripts/core-boundaries.mjs`, invoked by `check:boundaries`): Forbids any `@hokusai/adapter-*` import specifier or relative path inside `packages/core/src/` and any `@hokusai/adapter-*` entry in `packages/core/package.json` `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`.

**Citation:** `.github/workflows/release.yml` lines 1–106, `.github/workflows/ci.yml` lines 1–50, `.changeset/config.json`, `scripts/check-core-boundaries.mjs`, `scripts/core-boundaries.mjs`.

---

## Precedents

### CLI without committed bundle
**@hokusai/adapter-aider:** 
- Source: `packages/adapter-aider/src/cli.ts` (starts with `#!/usr/bin/env node`)
- Shebang-driven entry: `bin: { "hokusai-aider": "./dist/cli.js" }`
- Files published: `["dist", "README.md"]`
- Installation: `npm` installs the pre-built `dist/cli.js`

**Citation:** `packages/adapter-aider/package.json` lines 13–24.

### CLI + committed bundle
**@hokusai/adapter-claude-code:**
- CLI entry points: `bin` map with 5 wrapper scripts in `plugin/bin/*` (checked in)
- Bundled library: `plugin/dist/index.js` (committed, regenerated in CI)
- Build script: `bundle:plugin` runs esbuild to produce the bundle
- Files published: `["dist", "plugin"]` — both the compiled TypeScript and the committed bundle
- Version in manifest: `scripts/sync-versions.mjs` updates the manifest entry automatically
- CI enforces: CI workflow's "Plugin zips build at a release tag" step regenerates at hypothetical next version to fail if manifest is stale

**Citation:** `packages/adapter-claude-code/package.json` lines 13–29 (bin, files, bundle:plugin script), `.github/workflows/ci.yml` lines 42–51.

### Zip build scripts
**Deny-list pattern:** Both `scripts/build-plugin-zip.mjs` and `scripts/build-codex-plugin-zip.mjs` exclude `.env`, `node_modules`, `features/`, `.test.*`, and `__fixtures__` from the zip. This pattern must be reused for any scan-side bundling.

**Citation:** `.github/workflows/release.yml` lines 68–75 (zip assertion).

---

## Runtime Matrix

| Dimension | GitHub Action (Composite/JS) | `npx @hokusai/scan` |
|-----------|-----|------|
| Node runtime | `runs.using: node20` (pinned in `action.yml`) | Whatever user has (README requires Node ≥ 20) |
| Install step | None — bundled `action/dist/index.js` ships with tag | `npx` fetches from npm registry on demand |
| Auth to GitHub | `GITHUB_TOKEN` from job (default read-only; extendable) | User PAT via `--token` or `GH_TOKEN` env; OAuth for public repos |
| Git history depth | Must be documented: Actions should use `actions/checkout@v4` with `fetch-depth: 0` | Local clone in user's cwd; user's existing checkout depth |
| Output channel | Job summary + optional PR comment + artifact + `$GITHUB_OUTPUT` | stdout JSON or piped; optional `--output <path>` to file |
| Version pinning | `uses: Hokusai-protocol/hokusai-sdk/packages/scan@v0.5.0` | `npx @hokusai/scan@0.5.0` (semver any tag) |
| One-shot vs. scheduled | `workflow_dispatch` (one-shot) and `schedule:` (nightly) use identical code | Manual; user triggers with cron/launchd/CI of their choice |
| Rate limiting | Uses `GITHUB_TOKEN` quota (5000 req/hr per repo) | Uses user PAT quota (or 60 req/hr for OAuth public) |
| Network egress to Hokusai API | Enterprise runner may block; require documented allowlist domain | User's network; same allowlist domain requirement |
| Filesystem | Ephemeral `$RUNNER_TEMP`; no state persists across runs | User's cwd; can write reports to file system |
| Report emission | Static file uploaded as artifact + summary rendered inline | Streamed to stdout or written to file; no GitHub artifact API |

**Citation:** Derived from §13.2, §15.3, §20 Q6 of Plan of Record and precedent from `.github/workflows/release.yml` (Action runner environment) and `packages/adapter-aider/src/cli.ts` (CLI pattern).

---

## Module Classification

One package per module; wire-format shapes only in `@hokusai/core`, execution only in `@hokusai/scan`, and wavemill-side state stays in wavemill.

| Module | @hokusai/core | @hokusai/scan | @hokusai/adapter-wavemill | wavemill repo |
|--------|:-----:|:-----:|:-----:|:-----:|
| Task descriptor (existing) | ✓ | | | |
| Candidate feature schema (S1, HOK-2786) | ✓ | | | |
| Survival label contract (S2, HOK-2803) | ✓ | | | |
| Scan report envelope (S3) | ✓ | | | |
| Feature extractor (execution) | | ✓ | | |
| Survival labeller (execution) | | ✓ | | |
| Enumerator + attribution | | ✓ | | |
| Report aggregator + emitter | | ✓ | | |
| Scan orchestrator (`scan()`) | | ✓ | | |
| CLI entry (`hokusai-scan`) | | ✓ | | |
| Action entry + `action.yml` | | ✓ | | |
| Eval-record join | | | | ✓ |
| Wavemill routing adapter (today) | | | ✓ | |

**Rule:** Wire-format shapes go in core; execution goes in scan; anything reading wavemill config/state/DB stays in wavemill.

---

## Decision

`@hokusai/scan` is a new package that carries labeller, extractor, enumerator, attribution, aggregator, and both the `hokusai-scan` CLI (via `bin` entry) and the Survival Check Action (composite `action.yml` inside the package, bundled `action/dist/index.js` following the `adapter-claude-code` pattern).

`@hokusai/core` gains only wire-format schemas: the Candidate Feature Schema v1 (S1 / HOK-2786), the Survival Label contract (S2 / HOK-2803), and the Scan Report envelope (S3). These carry no execution logic and are consumed by four repos (SDK, wavemill, data pipeline, website).

`@hokusai/adapter-wavemill` remains independent of scan. wavemill (the mill repo) imports `@hokusai/scan` directly for scanning and keeps the eval-record join layer local (§11.3 thin adapter). Scan does not depend on adapter-wavemill, and adapter-wavemill does not depend on scan; they are peers under `@hokusai/core`.

**Why:** §13.2 and §15.3 require CLI and Action to run the same code. Four repos derive features from S1/S2/S3, so schemas belong in the schema-only package. The labeller must live in exactly one place per §11.3.

---

## Alternatives Rejected

### 1. Single-package scan (schemas + execution together in `@hokusai/scan`)
Keep nothing new in `@hokusai/core`. Rejected: Four repos derive features from the S1 schema (SDK, wavemill, data pipeline, website). If the schema lives only in scan, either every consumer runtime-installs scan (which drags `child_process`, `fs`, `git`, network, and `gh` deps into the data-pipeline training loop), or the schema is duplicated across repos. Same argument for S2 (wavemill emits, data pipeline consumes) and S3 (SDK emits, website consumes).

### 2. Separate Action-only package (`@hokusai/scan-action`)
Create a separate package for the Action that depends on `@hokusai/scan` for the orchestrator. Rejected: Creates two versioning surfaces for one behaviour. §13.2 and §15.3 explicitly require the CLI and Action to run the same code. The changeset `fixed` group already versions all `@hokusai/*` packages together, so a split would still tag together but with twice the manifest and zip surface.

### 3. adapter-wavemill imports `@hokusai/scan`
Make adapter-wavemill depend on scan so the routing adapter also carries scan. Rejected: adapter-wavemill is a Hokusai-side routing adapter, not a scan consumer. wavemill (the mill repo) has direct access to scan and does not need a middleman. Making adapter-wavemill the import path inverts the direction. Also, forcing adapter-wavemill into the scan dependency graph means any project that only wants the routing adapter must pull scan's deps.

---

## Open Items (UNVERIFIED)

1. **`@hokusai/adapter-aider` changeset group membership:** Not listed in `.changeset/config.json` `fixed` array (line 11) but shares version 0.4.0. May be intentional (not part of the fixed release) or a bug. Not a decision point for R1.

2. **Marketplace listing of the Action:** In-repo `uses: Hokusai-protocol/hokusai-sdk/packages/scan@v0.5.0` works today; Marketplace listing requires `action.yml` at the repo **root**. Phase 3 concern; defer decision on thin root-level wrapper or separate mirror repo.

3. **Network allowlist domain:** Hokusai API calls from the scanner require an allowlist domain (enterprise runners). Document this but determination deferred to S4 / Phase 2.

4. **Output channel consistency:** Whether scheduled Actions output to `$GITHUB_OUTPUT` or write job summary differently than one-shot `workflow_dispatch` invocations. Likely identical code, but not explicitly verified.

5. **Fetch-depth default for Actions:** Whether `actions/checkout@v4` defaults to shallow clone or full depth in the orchestrator's documentation. Not yet in the SDK repo's Action documentation.

---

## Downstream Impact

- **HOK-2816 · Arbiter S4:** updated — labeller and extractor land in `@hokusai/scan`; S1/S2/S3 schemas land in `@hokusai/core`; CLI and Survival Check Action ship from the same package.
- **HOK-2821 · Arbiter P2.S2:** confirmed unchanged — orchestrator lives at `@hokusai/scan/src/scan.ts`; consumes schemas from `@hokusai/core` and emits S3 payload.
- **HOK-2820 · Arbiter P2.S1:** confirmed unchanged — shadow-mode Survival Check runs the same code as `npx @hokusai/scan`.
- **HOK-2822 · Arbiter P2.S3:** confirmed unchanged — scan-12-repos runs the CLI from `@hokusai/scan`.
- **HOK-2833 · Arbiter P3.S2:** confirmed unchanged — flag-mode uses the same Action, changing only inputs.

---

## Verification Checklist

- [x] Workspace Map has 6 rows matching `ls packages/`
- [x] Module Classification table has exactly one tick per row
- [x] Runtime Matrix has ≥ 8 rows, all cells filled or explicitly `UNVERIFIED`
- [x] Decision section ≤ 10 lines
- [x] All non-`UNVERIFIED` claims carry `path:field` citations
- [x] No secret values in recon doc
