---
'@hokusai/core': minor
---

Add the Arbiter corrective-rework contract (HOK-3267, definition `cr-0.1.0`): candidate, repair-pair and corrective records in one versioned schema (`arbiter-corrective-rework.schema.json`, `ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA`). Rejected candidates keep a typed exclusion code; each accepted candidate has a repair pair with file sets, line survival, test delta and review metadata; `deriveCorrectiveLabel()` derives the per-horizon corrective boolean from accepted repair pairs and links it to its S2 label by `base_label_hash`. Records carry no raw content.
