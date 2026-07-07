---
"@hokusai/adapter-claude-code": patch
"@hokusai/adapter-codex": patch
---

Fix plugin load failure caused by duplicate hooks file reference. Remove the redundant `hooks` field from plugin manifests, as `hooks/hooks.json` is auto-loaded by convention. This resolves the "Duplicate hooks file detected" error reported by `/hokusai:doctor`.
