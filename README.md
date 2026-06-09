# Hokusai for Claude Code

Hokusai is a task router and outcome-learning protocol for coding harnesses. The fastest way to try it today is the Claude Code plugin: install the plugin, opt in to routing, route a task, and optionally opt in to outcome reporting later.

## Quickstart

1. Install the latest Claude Code plugin from GitHub Releases.

```sh
curl -L -o hokusai-claude-code-plugin-latest.zip https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip && \
curl -L -o hokusai-claude-code-plugin-latest.zip.sha256 https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip.sha256 && \
sha256sum -c hokusai-claude-code-plugin-latest.zip.sha256 && \
unzip hokusai-claude-code-plugin-latest.zip && \
claude --plugin-dir ./hokusai-claude-code-plugin/plugin
```

2. Set your API key. Override the API base URL only if you were given a non-default endpoint.

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
# Optional:
export HOKUSAI_API_BASE_URL=https://api.hokusai.app
```

3. Opt in to routing and check that the plugin is installed.

```sh
export HOKUSAI_ROUTING_CONSENT=true
```

```text
/hokusai:privacy reporting status
```

4. Route a task in Claude Code.

```text
/hokusai:route refactor the auth middleware to use the new policy engine
```

Hokusai returns a recommended model, a short reason, confidence when available, alternatives when available, and a local `correlationId` you can reuse for outcome reporting.

5. Optionally opt in to outcome reporting and preview a report before sending it.

```sh
export HOKUSAI_OUTCOME_OPT_IN=true
```

```text
/hokusai:report --use-latest --recommended-model claude-sonnet-4-6 --actual-model claude-sonnet-4-6 --accepted --status succeeded --rating 4
```

`/hokusai:report` previews the anonymized payload first and only submits after explicit approval.

## What Gets Sent

`/hokusai:route` sends a normalized, redacted task packet plus routing metadata. The packet includes:

- `schemaVersion`
- `userIntent`
- `taskFamily`
- `reasoningDepth`
- Optional `repositoryScale`
- Optional `languageSignals`
- Optional `frameworkSignals`
- Optional `availableTools`
- Optional `constraints`
- Optional `modelConstraints`
- Optional `providerConstraints`

The wire request also includes redacted consent, model, correlation, and redaction metadata. See [docs/payload-schemas.md](docs/payload-schemas.md).

`/hokusai:report` may send an anonymized outcome report when you explicitly opt in. That report includes:

- `schemaVersion`
- `correlationId`
- `recommendedModel`
- `actualModel`
- `recommendationAccepted`
- `completionStatus`
- Optional `userRating`
- `latencyBucket`
- `costBucket`
- `tokenBucket`
- Optional `build`
- Optional `test`
- Optional redacted `notes`
- Optional versioned `extensions`

See [docs/payload-schemas.md](docs/payload-schemas.md) and [docs/privacy-model.md](docs/privacy-model.md) for the full schema and redaction model.

## Privacy And Consent

Routing is off by default. Outcome reporting is also off by default, and it stays off unless you separately opt in with `HOKUSAI_OUTCOME_OPT_IN=true` or `hokusai-privacy reporting on`.

- Routing requires both `HOKUSAI_API_KEY` and `HOKUSAI_ROUTING_CONSENT=true`.
- Outcome reporting requires routing consent plus `HOKUSAI_OUTCOME_OPT_IN=true`.
- Raw task text, raw code, raw prompts, terminal logs, and customer data are excluded from stored local records by default.
- The plugin config store never persists `HOKUSAI_API_KEY`.

Use the privacy CLI to inspect what Hokusai has stored locally:

```sh
hokusai-privacy list
hokusai-privacy preview <correlation-id>
hokusai-privacy audit
hokusai-privacy reporting status
```

If you want a stored redacted debug preview of a routed task packet, opt in before routing:

```sh
export HOKUSAI_DEBUG=1
```

Then inspect the stored preview after routing:

```sh
hokusai-privacy preview <correlation-id> --debug
```

For integrators embedding the adapter directly, `previewTaskPayload()` and `createClaudeCodeDoctor()` are available in `@hokusai/adapter-claude-code`.

## Troubleshooting

- Missing API key: set `HOKUSAI_API_KEY` and re-run the command.
- Missing routing consent: run `export HOKUSAI_ROUTING_CONSENT=true`.
- Missing outcome opt-in: run `export HOKUSAI_OUTCOME_OPT_IN=true` or `hokusai-privacy reporting on`.
- No local routing decision for reporting: pass `--correlation-id <id>` or route a task first, then retry with `--use-latest`.
- Network failure: check connectivity to `HOKUSAI_API_BASE_URL`, then retry.
- Need local state details: run `hokusai-privacy list`, `hokusai-privacy preview <correlation-id>`, and `hokusai-privacy audit`.
- Need persistent reporting status: run `hokusai-privacy reporting status`.
- Unsupported recommendation: review the suggested Anthropic fallbacks in the route output and retry with an allowlisted model.

## Contributing

Contributor setup is separate from plugin installation. To work on this repo from source:

```sh
pnpm install
pnpm lint
pnpm -r typecheck
pnpm check:boundaries
pnpm -r build
pnpm -r test
```

For a source-based Claude Code install, see [packages/adapter-claude-code/README.md](packages/adapter-claude-code/README.md).

## Package Map

- `packages/core`: shared contracts, schemas, consent/config helpers, redaction, and correlation storage interfaces
- `packages/adapter-claude-code`: Claude Code plugin and routing adapter
- `packages/adapter-codex`: Codex adapter stubs
- `packages/adapter-wavemill`: Wavemill reference adapter boundary
- `examples/reference-harness`: minimal offline composition template

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
- [packages/adapter-claude-code/README.md](packages/adapter-claude-code/README.md) - Claude Code adapter package reference
- [examples/reference-harness/README.md](examples/reference-harness/README.md) - minimal offline harness composition example
