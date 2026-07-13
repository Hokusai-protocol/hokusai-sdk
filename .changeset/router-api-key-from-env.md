---
'@hokusai/router': patch
---

`createRouter()` and the zero-config `route` singleton now read
`HOKUSAI_API_KEY` from the environment when no `apiKey` option is passed. The
package documented this behaviour in its README and JSDoc but never implemented
it, so the advertised quickstart — export the key, `import { route }`, call it —
threw `HokusaiAuthError` without issuing a request. An explicit `apiKey` still
wins, and a blank environment variable is ignored rather than sent as an empty
bearer token.
