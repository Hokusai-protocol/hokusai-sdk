---
'@hokusai/adapter-codex': patch
---

Make the packaged Codex plugin actually installable. The release zip put its
marketplace manifest at the archive root, but Codex only discovers a marketplace
at `.agents/plugins/marketplace.json` — so `codex plugin marketplace add` failed
with "marketplace root does not contain a supported manifest", and no published
Codex plugin could ever be installed. The manifest now ships at the path Codex
reads, and the stray copies at the archive root and inside `plugins/hokusai/`
are gone.

The marketplace is also renamed from `hokusai-local` to `hokusai`, so the install
id is `hokusai@hokusai` rather than leaking a dev-only name into a public
artifact. Note the install command is `codex plugin add hokusai@hokusai`: a bare
`codex plugin add hokusai` is rejected, and the docs said otherwise.
