# Claude Code Adapter

`@hokusai/adapter-claude-code` now includes an installable Claude Code plugin surface for Hokusai task routing.

## Install the plugin

Build the package first so the plugin bin can import `dist/`:

```sh
pnpm -r build
claude --plugin-dir /path/to/repo/packages/adapter-claude-code/plugin
```

After install, Claude Code should show `/hokusai:route` in the slash-command menu. The task description may also refer to this as `/hokusai-route`, but `/hokusai:route` is the canonical Claude Code command path.

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

## Failure behavior

- Missing `HOKUSAI_API_KEY`: `Hokusai routing needs an API key. Set HOKUSAI_API_KEY and re-run.`
- Missing `HOKUSAI_ROUTING_CONSENT=true`: `Routing consent is required. Run export HOKUSAI_ROUTING_CONSENT=true to opt in.`
- Network failure: `Could not reach Hokusai (...)`. Retry after checking connectivity, or use `/hokusai:doctor`.
- Unsupported recommendation: prints the unsupported model id and suggested Anthropic fallbacks.
- Empty input: prompts for a task description example.

## Privacy posture

- Local discovery and setup help work without network calls.
- Routing requires both `HOKUSAI_API_KEY` and `HOKUSAI_ROUTING_CONSENT=true`.
- Outcome submission requires the routing gate plus `HOKUSAI_OUTCOME_OPT_IN=true`.
- The plugin config store never persists `apiKey`.
- Model recommendations are limited to Anthropic models in the configured allowlist.
