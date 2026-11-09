---
'@hokusai/core': minor
'@hokusai/scan': minor
---

Add the Rework Risk merge-time feature manifest and leakage validator (HOK-3023).

- **Manifest.** `REWORK_RISK_FEATURE_MANIFEST` (`rr-merge-features/0.1.0`, draft) declares every field an arm may use, with its `as_of` source and null meaning. Provenance and CI fields are `segment.*` and cannot be arm inputs.
- **Validator.** `validateFeatureManifest`, `validateFeatureColumns` and `validateEvidenceAsOf` reject post-merge sources, `label.*` fields, denylisted label-side fields and undeclared columns.
- **CLI.** `hokusai-scan corpus-feature-audit` gives other languages the same validator: exit 0 passes, 1 means leakage, 2 means bad input.
