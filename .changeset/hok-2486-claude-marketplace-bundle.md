---
'@hokusai/adapter-claude-code': patch
---

Fix the Claude Code marketplace plugin packaging so repository installs include
the bundled runtime under `plugin/dist/index.js`, allowing all launcher shims
to run correctly when only the `plugin/` subtree is installed.
