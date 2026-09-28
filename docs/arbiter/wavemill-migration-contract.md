# Wavemill Migration Contract (HOK-2816 follow-up PR)

The checklist for the wavemill-side PR that completes the S4 extraction:
wavemill deletes its copies and consumes `@hokusai/scan`. Merge that PR only
after `@hokusai/scan` is published to npm (it releases with the fixed
`@hokusai/*` version group on the next tag). The SDK-side extraction was
captured against wavemill commit `a2d1cd6bbc6d397d4ac237bf71b729e9ee0bf5ae`
(see `fixtures/arbiter/scan/README.md`).

## Delete (no forks — this is the point)

- [ ] `shared/lib/survival-labeller.ts` + `shared/lib/survival-labeller.test.ts`
- [ ] `shared/lib/candidate-features.ts` + `shared/lib/candidate-features.test.ts`
      (keep the wavemill-adapter parity test case, rewritten against the package)
- [ ] `shared/lib/arbiter-survival-label.ts` + test + `shared/lib/arbiter-survival-label.fixtures.json`
      (import the contract and the fixture pair from `@hokusai/core` instead)
- [ ] `shared/schemas/arbiter-survival-label.schema.json`
      (validate against `@hokusai/core`'s `ARBITER_SURVIVAL_LABEL_V1_JSON_SCHEMA`
      or the published `schemas/` file)
- [ ] `shared/lib/static-features.ts` + test
- [ ] `shared/lib/shell-utils.ts` (import from `@hokusai/scan`)
- [ ] `shared/lib/cross-pr-revert-detector.ts` — **only if** nothing but the
      labeller used it. `detectCrossPrReverts` / `detectSurvivingChangeWarnings`
      had their own consumers at extraction time; if those remain, keep the
      file but replace `parseNameStatusOutput` / `extractPrNumber` /
      `parseRevertAcknowledgements` with imports from `@hokusai/scan`.
- [ ] `tools/backfill-survival.ts`, `tools/extract-candidate-features.ts` —
      replace with thin shells that exec `hokusai-scan label` /
      `hokusai-scan extract`, or import the package API.

## Rewrite

- [ ] `shared/lib/outcome-collectors.ts`: import `extractCandidateFeatures`,
      `collectStaticFeatures`, and `type CandidateFeatureContract` from
      `@hokusai/scan`. The call signature is unchanged
      (`extractCandidateFeatures({ checkoutDir, prNumber, repoDir, baseRef,
      offline, contract, staticFeatures })`), so the evals.jsonl join stays a
      thin adapter — it builds the contract and appends rows, nothing more.
- [ ] The survival-label cron entry: call `hokusai-scan label
      --repo . --integration-branch auto/integration --github-repo <owner/name>
      >> .wavemill/evals/survival-labels.jsonl`. Row order is oldest-merge
      first, identical to the old backfill tool.

## Add

- [ ] `.hokusai-scan.json` — an exact copy of `.wavemill-config.json`'s
      `staticAnalysis` block. Keep `.wavemill-config.json` during the
      transition (the package reads it as a fallback and warns); delete the
      fallback usage once every scanned repo carries the new name.
- [ ] **Adapter parity test (the fourth leg of the identical-output
      triangle):** restore the fixtures from the SDK repo's
      `fixtures/arbiter/scan/` (vendor the three case directories or fetch
      them at test time), run wavemill's adapter path over each restored
      repo, and assert byte equality with
      `survival-labels.expected.jsonl` / `candidate-features.expected.json`.
      Restore procedure and inputs are documented in the fixture README.
- [ ] CI grep guard so the labeller can never silently fork back:

      ```sh
      ! git grep -nE '^(export )?(async )?function (labelMergedPr|extractCandidateFeatures|enumerateMergedPrs|resolveMergedPr|buildSubstrate|analyseForward|collectStaticFeatures)\b' -- shared tools
      ```

## Verify

- [ ] `wavemill`'s own test suite passes with the package.
- [ ] The adapter parity test passes against the published `@hokusai/scan`.
- [ ] One production-shaped smoke run: the cron invocation on the wavemill
      checkout produces rows whose envelopes carry
      `labeller_version 1.0.0` / `normalization_version 1.0.0` and validate
      against the core schema.
