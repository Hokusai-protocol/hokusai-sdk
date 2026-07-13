---
'@hokusai/adapter-codex': patch
---

Expose the Codex MCP tools to the session, and stop shipping hooks.

`.mcp.json` declared its server at the top level, used an `env_vars` array, and
pointed `command` at `${PLUGIN_ROOT}/bin/hokusai-codex-mcp`. Codex reads servers
from an `mcpServers` map, has no `env_vars` key, and performs no variable
substitution — so the plugin installed, `codex mcp list` showed the server, and
yet `hokusai_route` never reached the model's tool list. The skill fired, could
not find its tool, and fell back to hand-spawning the binary and hand-writing
JSON-RPC: precisely the "do not invent a recommendation locally" failure the
skill exists to prevent. Declare the server under `mcpServers` with the
plugin-relative command real Codex plugins use.

Drop `plugin/hooks/`. Codex auto-discovers `hooks/hooks.json` by convention no
matter what the manifest declares and trust-gates it at install, so users were
prompted to trust two hooks that could never fire (their commands had the same
unsubstituted `${PLUGIN_ROOT}`). Design decision D3 already said the MVP ships
no hooks.
