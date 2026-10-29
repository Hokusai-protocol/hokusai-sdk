# Fix-attributed rework label (public excerpt, DRAFT)

**Not for publication yet.**

- **Review.** This excerpt is reviewed against the Positioning guidance before it goes out.
- **Wording.** It says "fix-attributed rework" rather than "corrective" until HOK-3020 (R7) validates the target.
- **Internal source.** The internal definition is [corrective-rework-label.md](corrective-rework-label.md).

## What the label means

The label asks whether a merged pull request was followed, within 30 days, by unplanned work that repaired a defect it introduced. Results are also reported at 14 and 60 days.

The following don't count:

- planned follow-ups
- changed requirements
- unrelated edits to the same lines
- refactors
- reverts made for reasons other than a defect

## How it is detected

Four signals, all taken from public repository history:

| Signal | What it looks for |
| --- | --- |
| Revert | A later change reverts the PR, wholly or partly. |
| Repair reference | A later change cites the PR and is marked as a fix. |
| Blame on a bug fix (SZZ) | A later change closes a bug issue, and the lines it repairs were introduced by the PR. |
| Regression issue | A regression or incident issue links the PR to its fix. |

Candidate links that fail a check are kept and recorded with a reason, so false positives can be measured. The reasons are:

- backport
- revert of a revert
- dependency bot
- fix too large to attribute
- planned iteration
- requirement change
- unrelated edit
- refactor
- non-defect revert
- linkage error

## Corpus

- **Repos.** 18 large public repositories, listed with their selection criteria in `fixtures/arbiter/corpus/hok-3022-cohort.json`.
- **Base rates.** Each repo's rate at each horizon is in `fixtures/arbiter/corpus/hok-3022-report.md`.

## Validation

People labelled a stratified sample of PRs from repositories outside the evaluation set. The sample covered every signal, rejected links, and PRs with no signal at all, and part of it was labelled twice to measure agreement.

_Precision, recall and agreement are added here when calibration completes._

## What stays private

- the evaluation slice, until its result is published
- the calibration sample and its labels
- the model's decision thresholds
