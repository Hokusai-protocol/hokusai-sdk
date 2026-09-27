---
"@hokusai/scan": minor
"@hokusai/core": minor
---

Arbiter shadow mode (HOK-2820): silent scheduled scoring of merged PRs.

- `@hokusai/core`: `arbiter_shadow_score/v1`, `arbiter_shadow_outcome/v1` and
  `arbiter_shadow_state/v1` wire contracts with validators that reject raw
  content (diffs, messages, titles, author emails, file paths) at any depth.
- `@hokusai/scan`: `shadow-score`, `shadow-backfill` and `shadow-report`
  commands (library, CLI and Action), an incremental
  `last_seen_merge_sha` cursor with a bounded bootstrap fallback, the
  deterministic `baseline-v0` scorer, append-only JSONL storage for a
  dedicated `arbiter-shadow` data branch, and a static guard test that locks
  the never-visible/never-gating workflow properties in place. Shadow
  commands always exit 0 and emit nothing visible on any PR.
