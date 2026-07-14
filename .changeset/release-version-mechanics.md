---
'@hokusai/core': patch
---

Version the `@hokusai/*` packages together and keep the plugin manifests,
marketplace entry, and `SDK_VERSION` in step with them. Tagging a release
previously aborted the build: `changeset version` only rewrites `package.json`,
so the plugin manifests stayed behind and the release asserted them against the
tag. `SDK_VERSION` was hardcoded in source and stamped stale onto every request
and contribution row.
