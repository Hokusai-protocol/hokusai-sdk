---
'@hokusai/core': minor
'@hokusai/adapter-claude-code': minor
---

Add plugin-aware doctor command with structured check results

Extends core diagnostics with seven checks (node runtime, API key, routing consent,
outcome consent, model allowlist, state-dir writability, API reachability) and adds
a /hokusai-doctor command handler in the Claude Code adapter that renders actionable
setup output with exact next steps. Non-network mode is the default; API reachability
only runs when routing consent is granted and a transport is provided.
