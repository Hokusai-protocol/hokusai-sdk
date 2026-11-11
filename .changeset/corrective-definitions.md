---
'@hokusai/core': minor
'@hokusai/scan': minor
---

Corrective-rework definitions are now a table (HOK-3269).

- **Core.** `CORRECTIVE_REWORK_DEFINITIONS` lists every definition by version, and `admittedProxiesFor` returns the proxies one admits. `deriveCorrectiveLabel` reads the admitted proxies from the envelope's `definition_version` and throws on a version it does not know. Adds `cr-0.2.0`: reverts and repair references only. `cr-0.1.0` stays the default.
- **Scan.** `hokusai-scan corpus-corrective-derive --definition <cr-x.y.z>` writes `corrective.<definition>.jsonl.gz` from the repair pairs `corpus-corrective` already wrote, without re-running detection.
