# Claude Code Adapter

`@hokusai/adapter-claude-code` keeps local model discovery available by default and requires explicit configuration before any routing or outcome submission can occur.

## Configuration

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

## Privacy posture

- Local discovery and setup help work without network calls.
- Routing requires both `HOKUSAI_API_KEY` and `HOKUSAI_ROUTING_CONSENT=true`.
- Outcome submission requires the routing gate plus `HOKUSAI_OUTCOME_OPT_IN=true`.
- The plugin config store never persists `apiKey`.
- Model recommendations are limited to Anthropic models in the configured allowlist.

## Commands

- `hokusai.run`: dispatch a task once auth and routing consent are configured.
- `hokusai.doctor`: report auth, consent, API reachability, and allowlist status without printing the raw API key.
