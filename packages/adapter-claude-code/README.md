# Claude Code Adapter

For the harness-agnostic integration pattern that this plugin implements, see [docs/reference-pattern.md](../../docs/reference-pattern.md). This README covers Claude Code-specific behavior layered on top of that shared route/report pattern.

`@hokusai/adapter-claude-code` includes an installable Claude Code plugin surface for Hokusai task routing and opt-in outcome reporting.

## Install from the marketplace

Use the repository marketplace as the default install path:

```sh
/plugin marketplace add Hokusai-protocol/hokusai-sdk
/plugin install hokusai@hokusai
/reload-plugins
```

The intended eventual public path is the Claude Code community marketplace. Until that listing is accepted, use the repository marketplace as the normal self-hosted install path.

If you host a standalone marketplace catalog, install from its `marketplace.json` URL:

```sh
/plugin marketplace add https://.../marketplace.json
/plugin install hokusai@hokusai
/reload-plugins
```

## Manual install / release smoke test

Use the release zip flow when you want to verify the published artifact directly:

```sh
curl -L -o hokusai-claude-code-plugin-latest.zip \
  https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip
curl -L -o hokusai-claude-code-plugin-latest.zip.sha256 \
  https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip.sha256
sha256sum -c hokusai-claude-code-plugin-latest.zip.sha256
unzip hokusai-claude-code-plugin-latest.zip
claude --plugin-dir ./hokusai-claude-code-plugin/plugin
```

## Install the plugin from source

This path is for local development after building the package and the self-contained plugin bundle:

```sh
pnpm -r build
pnpm --filter @hokusai/adapter-claude-code bundle:plugin
claude --plugin-dir /path/to/repo/packages/adapter-claude-code/plugin
```

After install, Claude Code should show `/hokusai:route`, `/hokusai:report`, and `/hokusai:privacy` in the slash-command menu. The task description may also refer to these as `/hokusai-route`, `/hokusai-report`, and `/hokusai-privacy`, but the `hokusai:*` paths are the canonical Claude Code command paths.

## Configure auth and contribution consent

Use environment variables or a local config file loaded through `loadClaudeCodePluginConfig()`:

- `HOKUSAI_API_KEY`: Hokusai API key. Required for routing and reachability checks.
- `HOKUSAI_OUTCOME_OPT_IN`: Separate explicit opt-in for outcome submission. Defaults to off.
- `HOKUSAI_MODEL_ALLOWLIST`: Comma-separated Anthropic model ids or aliases.

Verify the install after setting auth:

```sh
export HOKUSAI_API_KEY=hk_live_your_key_here
hokusai-doctor
```

The doctor checks API-key presence, router reachability when network mode is available, dry-run route validation, outcome-reporting opt-in state, local state writability, and the model allowlist. It ends with `Ready to use: yes` only when blocking setup checks pass.

Library example:

```ts
import {
  createClaudeCodeDoctor,
  createClaudeCodeModelProvider,
  loadClaudeCodePluginConfig,
} from '@hokusai/adapter-claude-code';

const config = await loadClaudeCodePluginConfig({
  env: process.env,
});

const doctor = createClaudeCodeDoctor({ config });
const result = await doctor.run();
console.log(result.rendered);

const models = createClaudeCodeModelProvider({
  allowlist: config.modelAllowlist,
});
```

## Route a task

```text
/hokusai:route refactor the auth middleware to use the new policy engine
```

The command sends a normalized, redacted Hokusai task packet after auth is configured. Routing consent is provided by installing the Claude Code plugin unless explicitly overridden. On success it returns the recommended Anthropic model, concise reasoning, confidence, and alternatives when the API provides them.

The route output also includes:

- a local `correlationId` / routing decision id for later outcome reporting
- a manual Claude Code handoff instruction, exposed as a copyable `/model <anthropic-model-id>` command
- the API `requestId` and `routeId` when the router returns them

If Claude Code is already on the recommended model, Hokusai reports that no switch is needed instead of inventing a programmatic handoff.

To inspect stored local routing metadata after a route, use:

```sh
hokusai-privacy list
hokusai-privacy preview <correlation-id>
```

If you want a stored redacted debug preview of the routed task packet, opt in before routing:

```sh
export HOKUSAI_DEBUG=1
hokusai-privacy preview <correlation-id> --debug
```

## Preview and submit an outcome report

To preview and optionally submit an anonymized outcome report for a prior routing decision, first opt in from Claude Code:

```text
/hokusai:privacy reporting on
```

Then send a report against a stored route:

```text
/hokusai:report --use-latest --recommended-model claude-sonnet-4-6 --actual-model claude-sonnet-4-6 --accepted --status succeeded --rating 4
```

The report command previews the exact anonymized payload first, then only submits after explicit approval. `hokusai-report --send` requires outcome contribution to be enabled through `/hokusai:privacy reporting on` or `HOKUSAI_OUTCOME_OPT_IN=true`.

Use the privacy command to inspect local contribution state:

```text
/hokusai:privacy list
/hokusai:privacy preview <correlation-id>
/hokusai:privacy audit
```

The plugin also ships `hokusai-outcome-hook`, wired through post-run hooks. When a run appears successful, tests pass, a PR is merged, or an issue closes, the hook prompts:

```text
Looks like this task succeeded - contribute this outcome to improve routing?
```

The prompt uses the latest Hokusai route, assumes the recommendation was accepted, and opens the normal `/hokusai:report` preview flow. Without `HOKUSAI_OUTCOME_OPT_IN=true`, it prints opt-in remediation instead of a report command.

## Decline a recommendation

If the user chooses a different model, record that signal locally with the correlation id:

```sh
hokusai-route --decline --correlation-id <correlation-id> --reason "prefer faster model"
```

Decline reasons are redacted and length-capped before local persistence. The adapter stores routing-decision metadata in the existing local correlation record so later outcome reporting can link back to the recommendation without storing raw task text by default.

## Failure behavior

- Missing `HOKUSAI_API_KEY`: `Hokusai routing needs an API key. Set HOKUSAI_API_KEY and re-run.`
- Missing `HOKUSAI_OUTCOME_OPT_IN=true`: outcome preview/send refuses with an explicit opt-in remediation.
- Network failure: `Could not reach Hokusai (...)`. Retry after checking connectivity, then inspect local state with `hokusai-privacy audit` and `hokusai-privacy reporting status`.
- Unsupported recommendation: prints the unsupported model id and suggested Anthropic fallbacks.
- Empty input: prompts for a task description example.

## Privacy posture

- Local discovery and setup help work without network calls.
- Routing requires `HOKUSAI_API_KEY`.
- Outcome preview and submission require `HOKUSAI_OUTCOME_OPT_IN=true`.
- Model recommendations are limited to Anthropic models in the configured allowlist.
- Shared storage, preview, retention, and consent rules are documented in [docs/privacy-model.md](../../docs/privacy-model.md).

## Data & Privacy

- Local state lives under `~/.claude/hokusai/` by default, or `HOKUSAI_CONFIG_DIR` when overridden.
- Use the shared [privacy model](../../docs/privacy-model.md) for the exact denylist, retention policy, and preview guarantees.
- Claude Code-specific inspection and cleanup commands are:

```sh
hokusai-privacy list
hokusai-privacy preview <correlation-id>
hokusai-privacy audit
hokusai-privacy clear --all --yes
hokusai-privacy reporting off
hokusai-privacy reporting status
```

For one-shell overrides, use `HOKUSAI_OUTCOME_OPT_IN=false`.
