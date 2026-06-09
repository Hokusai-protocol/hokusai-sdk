---
'@hokusai/adapter-claude-code': minor
---

Add tag-triggered release workflow that packages the Claude Code plugin

Adds a GitHub Actions release workflow triggered by `v*` tags that bundles
the Claude Code adapter with `@hokusai/core` inlined via esbuild, stages the
plugin manifest, commands, bin launchers, README, and a minimal package.json
into a self-contained zip, asserts no dev-only or secret paths are included,
attaches versioned and latest-alias zip assets plus SHA-256 checksums to the
GitHub Release, and documents the stable download URL in the adapter README.
