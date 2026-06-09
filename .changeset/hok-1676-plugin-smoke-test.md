---
'@hokusai/adapter-claude-code': patch
---

Add CI smoke test workflow for plugin artifact validation

Adds a path-filtered GitHub Actions workflow that builds the Claude Code
plugin zip on PRs touching plugin commands, manifests, shared Hokusai client
code, anonymization code, outcome-reporting code, or release packaging, and
validates the packaged artifact by extracting the zip and asserting that
hokusai-route, hokusai-report, and hokusai-privacy load and produce expected
setup guidance. An optional live-API job is gated on a dedicated secret and
skips safely for fork PRs.
