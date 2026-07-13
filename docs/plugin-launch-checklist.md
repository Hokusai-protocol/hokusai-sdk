# Plugin Launch Smoke Checklist

## Codex plugin quick path

- Download `hokusai-codex-plugin-latest.zip` and its `.sha256` companion from the GitHub release.
- Verify the checksum, unzip the archive, and run `codex plugin marketplace add <unzipped-dir>`.
- Run `codex plugin add hokusai@hokusai` (install id is `<plugin>@<marketplace>`).
- Confirm `codex plugin list` reports `hokusai@hokusai  installed, enabled`.
- Confirm the installed plugin exposes `$hokusai-route`, `$hokusai-report`, `$hokusai-privacy`, and `$hokusai-doctor`.
- Confirm `hokusai_preview_route_payload` works without `HOKUSAI_API_KEY` or consent.
- Confirm routing fails with a structured `E_MISSING_API_KEY` or `E_MISSING_CONSENT` response until the corresponding env var is set.

## Claude Code plugin checklist

Use this checklist to validate the released Claude Code plugin from a fresh environment before launch. It exercises the exact user path from plugin install through routing, local-state inspection, outcome preview, and outcome submission.

## Prerequisites

- Start in a fresh shell on a machine with Claude Code installed.
- Do not clone this repository. This smoke path validates the released plugin zip only.
- Use a temporary working directory so the install and extracted files are isolated:

```sh
mkdir -p /tmp/hokusai-plugin-smoke
cd /tmp/hokusai-plugin-smoke
```

- Use an isolated local state directory so the checklist does not depend on prior Hokusai records:

```sh
export HOKUSAI_CONFIG_DIR="$PWD/.hokusai-config"
mkdir -p "$HOKUSAI_CONFIG_DIR"
```

- Export a test API key supplied out of band. Never commit it:

```sh
export HOKUSAI_API_KEY="<test-api-key>"
```

## Step 1. Download and install the released plugin zip

Download the published release asset and checksum:

```sh
curl -L -o hokusai-claude-code-plugin-latest.zip \
  https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip
curl -L -o hokusai-claude-code-plugin-latest.zip.sha256 \
  https://github.com/Hokusai-protocol/hokusai-sdk/releases/latest/download/hokusai-claude-code-plugin-latest.zip.sha256
sha256sum -c hokusai-claude-code-plugin-latest.zip.sha256
```

Extract and install the plugin:

```sh
unzip hokusai-claude-code-plugin-latest.zip
claude --plugin-dir ./hokusai-claude-code-plugin/plugin
```

Expected result:

- Checksum verification reports `OK`.
- Claude Code installs the plugin without requiring a repo checkout.
- Claude Code shows `/hokusai:route`, `/hokusai:report`, `/hokusai:privacy`, and `/hokusai:doctor` in the slash-command menu.

## Step 2. Configure auth and optional contribution

Configure the API key, then enable outcome contribution only when testing the reporting path:

```sh
export HOKUSAI_API_KEY=<test-key>
hokusai-privacy reporting on
```

Run the canonical post-install verification:

```sh
hokusai-doctor
```

Expected result:

- API key, dry-run route, local state, allowlist, and outcome opt-in checks are reported with pass/fail/warn status.
- Router reachability passes with a valid test key and network access, or reports an actionable auth/network fix.
- The final line is `Ready to use: yes`.

## Step 3. Inspect local state before routing

Confirm the fresh state directory starts empty:

```sh
hokusai-privacy list
```

Expected result:

- No prior routing records are listed.
- This confirms the smoke test is not reusing earlier local Hokusai state.

## Step 4. Route a representative coding task

Inside Claude Code, run the canonical route slash command:

```text
/hokusai:route Refactor the auth middleware to use the new policy engine
```

Some task descriptions may refer to this flow as `/hokusai-route`, but the released Claude Code plugin command path is `/hokusai:route`.

For direct CLI verification outside Claude Code, run:

```sh
hokusai-route --json --task "Refactor the auth middleware to use the new policy engine"
```

Expected result on success:

- The request reaches Hokusai and returns a recommendation rather than a local fallback.
- The JSON or slash-command output includes:
  - an Anthropic `model`
  - `provider`
  - a concise `reason`
  - `correlationId`
  - a `handoff` instruction with `/model <recommended-model>`
- `confidence`, `alternatives`, `requestId`, and `routeId` may also appear.

Expected result on failure:

- Auth failures clearly point to `HOKUSAI_API_KEY`.
- Network failures clearly say Hokusai could not be reached.
- No output invents a recommendation locally when the API call fails.

## Step 5. Inspect local correlation metadata

List recent records and preview the one written by the route:

```sh
hokusai-privacy list
hokusai-privacy preview <correlation-id>
```

Expected result:

- `hokusai-privacy list` shows the new correlation id.
- `hokusai-privacy preview <correlation-id>` shows metadata such as:
  - `correlationId`
  - timestamp
  - recommended model id
  - alternative model ids when present
  - redacted reason preview
  - payload hash
  - local decision status
- The preview does not include raw task text, raw prompts, raw code, or raw terminal logs.

This step proves local correlation metadata is written without raw task data by default.

## Step 6. Complete or simulate the task

Use the returned handoff to switch models in Claude Code if needed:

```text
/model <recommended-model>
```

Then either complete a small task or simulate completion for the smoke path. Record the actual model used so it can be supplied to outcome reporting.

Expected result:

- The recommendation can be followed manually in Claude Code.
- The smoke run captures both the recommended model and the actual model used.

## Step 7. Preview the anonymized outcome report

Preview the report built from the most recent routing decision:

```sh
hokusai-report --preview --json --use-latest --actual-model <actual-model> --accepted --status succeeded
```

Expected result:

- The command returns a JSON preview payload.
- The preview is redacted by default.
- Raw code, raw prompts, terminal logs, and customer data are excluded.
- Any notes field is redacted before preview.
- The payload shape is suitable for submission and includes the expected correlation metadata from the earlier route.

This step proves the outcome report preview is redacted before send.

## Step 8. Submit the outcome report

Submit the same report using the test API key:

```sh
hokusai-report --send --json --use-latest --actual-model <actual-model> --accepted --status succeeded
```

Expected success result:

- The JSON response reports `"submitted": true`.
- The response includes a clear server status.

Expected failure result:

- Invalid auth or reachability problems fail with a clear API or network error.
- The failure output is explicit enough to distinguish auth, consent, and network problems.

This step proves test submission either succeeds or fails with a clear API error.

## Validation Assertions

- No repo clone is required: validated by Step 1 and the fresh temp-directory setup.
- Routing reaches Hokusai and returns an Anthropic recommendation: validated by Step 4.
- Local correlation metadata is written without raw task data by default: validated by Step 5.
- Outcome report preview is redacted: validated by Step 7.
- Test submission succeeds or fails with a clear API error: validated by Step 8.

## Plugin-Context Assumptions To Confirm Before Launch

- The released plugin zip exposes `/hokusai:route`, `/hokusai:report`, `/hokusai:privacy`, and `/hokusai:doctor`.
- The released plugin zip exposes the standalone `hokusai-doctor` binary used by the doctor slash command.
- Setup is environment-variable based. There is no interactive setup wizard in the released plugin.
- The plugin zip must come from a tagged GitHub Release asset. Building from source requires a repo checkout and is out of scope for this smoke test.
- `hokusai-privacy` inspection commands work against local state and do not require an API call.
- A real test `HOKUSAI_API_KEY` must be supplied at runtime and must never be committed.
- The test environment must be able to reach the Hokusai API configured by the released plugin.
