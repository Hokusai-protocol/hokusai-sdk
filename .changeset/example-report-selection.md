---
'@hokusai/scan': minor
---

Export the example-report selection rule (HOK-3515): `parseExampleManifest`, `decideExample`, `TrainingExclusion` and `hashRepo`. A candidate repo is eligible only if it clears the manifest thresholds and is in no corpus manifest. The single exclusion reason, `in_training_or_holdout`, never says which repos are held out.
