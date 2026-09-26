# @hokusai/scan golden parity fixtures (HOK-2816)

Captured from the PRE-EXTRACTION wavemill labeller/extractor so the extracted
package can be proven byte-identical to what wavemill emitted.

- **Source wavemill commit:** `a2d1cd6bbc6d397d4ac237bf71b729e9ee0bf5ae`
- **Pinned clock (`--as-of`):** `2026-03-12T00:00:00Z`
- **Capture command:** `node scripts/capture-scan-golden.mjs --wavemill <wavemill checkout at that SHA>`

Each case directory contains:

| File | Contents |
| --- | --- |
| `repo.bundle` | `git bundle --all` of a deterministic synthetic fixture repo |
| `inputs.json` | The exact scan inputs (repo identity, branch, PR, base ref, as-of) |
| `survival-labels.expected.jsonl` | Labeller output: one JSON row per (PR, horizon), PRs oldest-first |
| `candidate-features.expected.json` | Extractor output: canonical sorted-key JSON |

To restore a fixture repo without any remote state:

```sh
git init -b _restore work && git -C work fetch <case>/repo.bundle 'refs/heads/*:refs/heads/*'
git -C work checkout <inputs.json .checkout_ref>
```

The equivalent standalone CLI invocations (see `packages/scan/src/cli.test.ts`):

```sh
hokusai-scan label --repo work --integration-branch integ \
  --github-repo <inputs.json .github_repo> --as-of <inputs.json .as_of> --offline --out -
hokusai-scan extract --repo work --pr <inputs.json .pr_number> \
  --base-ref <inputs.json .base_ref> --offline --out -
```

**Never re-capture to make a failing test pass.** A mismatch during a port is
a bug in the port; diff the port against the wavemill source at the SHA above.
Re-capture only in a PR that deliberately changes labeller behaviour and bumps
`SURVIVAL_LABELLER_VERSION` / `SURVIVAL_NORMALIZATION_VERSION`.
