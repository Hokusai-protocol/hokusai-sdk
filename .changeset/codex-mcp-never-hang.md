---
'@hokusai/adapter-codex': patch
---

Always answer a Codex MCP request, even when the call fails. `executeRouteCommand`
rethrows every `HokusaiApiError`, and the MCP server's top-level handler logged
the throw to stderr without emitting a JSON-RPC response — so the request was
never answered and Codex blocked until its 300-second tool timeout. A rejected
API key was indistinguishable from a hang.

Unhandled errors now come back as tool errors carrying the request id, and an
HTTP 401/403 is reported as `E_INVALID_API_KEY` ("Hokusai rejected the API key")
rather than a generic failure, so an expired key says so in under a second.
