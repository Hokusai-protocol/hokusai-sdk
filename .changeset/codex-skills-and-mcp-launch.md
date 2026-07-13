---
'@hokusai/adapter-codex': patch
---

Load the Codex skills, and launch the MCP server from the plugin root.

Codex rejects any `SKILL.md` without YAML frontmatter carrying `name` and
`description` — all four skills were skipped at startup ("Skipped loading 4
skill(s) due to invalid SKILL.md files"), so the plugin installed but exposed
nothing. Add the frontmatter Codex requires.

The MCP server also failed to start ("No such file or directory"): a bare
`./bin/hokusai-codex-mcp` command is resolved against the session's working
directory, not the plugin root. Launch it the way working Codex plugins do —
`command: node`, `args: ["./bin/hokusai-codex-mcp"]`, `cwd: "."`.
