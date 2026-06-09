# Claude Code Adapter

`@hokusai/adapter-claude-code` now includes an installable Claude Code plugin surface for Hokusai task routing.

## Install the plugin

Build the package first so the plugin bin can import `dist/`:

```sh
pnpm -r build
claude --plugin-dir /path/to/repo/packages/adapter-claude-code/plugin
```

After install, Claude Code should show `/hokusai:route`, `/hokusai:report`, and `/hokusai:privacy` in the slash-command menu. The task description may also refer to these as `/hokusai-route`, `/hokusai-report`, and `/hokusai-privacy`, but the `hokusai:*` paths are the canonical Claude Code command paths.

## Configure auth and consent

Use environment variables or a local config file loaded through `loadClaudeCodePluginConfig()`:

- `HOKUSAI_API_KEY`: Hokusai API key. Required for routing and reachability checks.
- `HOKUSAI_API_BASE_URL`: Optional API base URL. Defaults to `https://api.hokusai.app`.
- `HOKUSAI_ROUTING_CONSENT`: Explicit opt-in for routing. Truthy values are `true`, `1`, and `yes`.
- `HOKUSAI_OUTCOME_OPT_IN`: Separate explicit opt-in for outcome submission.
- `HOKUSAI_MODEL_ALLOWLIST`: Comma-separated Anthropic model ids or aliases.

Example:

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

## Use the command

```text
/hokusai:route refactor the auth middleware to use the new policy engine
```

The command sends a normalized Hokusai task packet only after both auth and routing consent are configured. On success it returns the recommended Anthropic model, concise reasoning, confidence, and alternatives when the API provides them.

The route output also includes:

- a local `correlationId` / routing decision id for later outcome reporting
- a manual Claude Code handoff instruction, exposed as a copyable `/model <anthropic-model-id>` command
- the API `requestId` and `routeId` when the router returns them

If Claude Code is already on the recommended model, Hokusai reports that no switch is needed instead of inventing a programmatic handoff.

To preview and optionally submit an anonymized outcome report for a prior routing decision:

```text
/hokusai:report --use-latest --recommended-model claude-sonnet-4-6 --actual-model claude-sonnet-4-6 --accepted --status succeeded --rating 4
```

The report command previews the exact anonymized payload first, then only submits after explicit approval. `hokusai-report --send` requires the same routing consent plus `HOKUSAI_OUTCOME_OPT_IN=true`.

## Decline a recommendation

If the user chooses a different model, record that signal locally with the correlation id:

```sh
hokusai-route --decline --correlation-id <correlation-id> --reason "prefer faster model"
```

Decline reasons are redacted and length-capped before local persistence. The adapter stores routing-decision metadata in the existing local correlation record so later outcome reporting can link back to the recommendation without storing raw task text by default.

## Failure behavior

- Missing `HOKUSAI_API_KEY`: `Hokusai routing needs an API key. Set HOKUSAI_API_KEY and re-run.`
- Missing `HOKUSAI_ROUTING_CONSENT=true`: `Routing consent is required. Run export HOKUSAI_ROUTING_CONSENT=true to opt in.`
- Missing `HOKUSAI_OUTCOME_OPT_IN=true`: outcome preview/send refuses with an explicit opt-in remediation.
- Network failure: `Could not reach Hokusai (...)`. Retry after checking connectivity, or use `/hokusai:doctor`.
- Unsupported recommendation: prints the unsupported model id and suggested Anthropic fallbacks.
- Empty input: prompts for a task description example.

## Privacy posture

- Local discovery and setup help work without network calls.
- Routing requires both `HOKUSAI_API_KEY` and `HOKUSAI_ROUTING_CONSENT=true`.
- Outcome preview and submission require routing consent plus `HOKUSAI_OUTCOME_OPT_IN=true`.
- Outcome previews and submissions exclude raw code, raw prompts, terminal logs, and customer data by default.
- Outcome notes are redacted before preview and before submission.
- The plugin config store never persists `apiKey`.
- Model recommendations are limited to Anthropic models in the configured allowlist.

## Data & Privacy

- Local state lives under `~/.claude/hokusai/` by default, or `HOKUSAI_CONFIG_DIR` when overridden.
- Stored routing records include correlation ids, timestamps, model recommendation metadata, payload hashes, short redacted reason previews, and local decision status.
- Stored audit entries include `kind`, `status`, `timestamp`, `correlationId`, and any redacted error string.
- Default retention is 7 days with a bounded record count. Override with a positive integer in `HOKUSAI_RETENTION_DAYS`.
- Raw task text, raw code, raw logs, and raw prompts are never stored locally. `RawPayloadRejectedError` enforces that at write time.
- `HOKUSAI_DEBUG=1` opt-in stores one extra field: a truncated redacted preview of the routed payload. The original raw text still never touches disk.

Inspect local state:

```sh
hokusai-privacy list
hokusai-privacy preview <correlation-id>
hokusai-privacy audit
```

Clear local state:

```sh
hokusai-privacy clear --all --yes
```

Disable outcome reporting persistently:

```sh
hokusai-privacy reporting off
```

For one-shell overrides, use `HOKUSAI_OUTCOME_OPT_IN=false`.
