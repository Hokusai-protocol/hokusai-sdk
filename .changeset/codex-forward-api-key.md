---
'@hokusai/adapter-codex': patch
---

Forward `HOKUSAI_API_KEY` into the Codex MCP server. Codex starts a stdio MCP
server with a sanitized environment allowlist rather than the parent
environment, so a key the user exported before launching Codex never reached the
server: every route failed with "HOKUSAI_API_KEY is not configured". Name the
variables to forward in `env_vars`, which is Codex's passthrough-by-name
allowlist. The dead `HOKUSAI_ROUTING_CONSENT` variable is no longer forwarded.
