// src/action-entry.ts
import { appendFileSync } from "node:fs";

// src/action-io.ts
import { isAbsolute, join } from "node:path";
function readActionInput(env, name) {
  const raw = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : void 0;
}
function actionFlagIsTrue(value) {
  return value !== void 0 && /^(true|1|yes)$/i.test(value);
}
function isShadowMode(mode) {
  return mode === "shadow-score" || mode === "shadow-backfill" || mode === "shadow-report";
}
function buildShadowActionArgv(env) {
  const mode = env.input("mode") ?? "";
  const argv = [mode];
  argv.push("--repo", env.input("repo-path") ?? env.workspace ?? ".");
  const dataDir = env.input("data-dir");
  if (dataDir !== void 0) argv.push("--data-dir", dataDir);
  const githubRepo = env.input("github-repo");
  if (githubRepo !== void 0) argv.push("--github-repo", githubRepo);
  const integrationBranch = env.input("integration-branch");
  if (integrationBranch !== void 0) argv.push("--integration-branch", integrationBranch);
  for (const flag of ["threshold", "bootstrap-days", "max-prs", "horizon-days", "window-days"]) {
    const value = env.input(flag);
    if (value !== void 0) argv.push(`--${flag}`, value);
  }
  return { argv };
}
function buildActionArgv(env) {
  const mode = env.input("mode") ?? "";
  const argv = [mode];
  if (mode === "report") {
    const githubRepo2 = env.input("github-repo");
    if (githubRepo2 !== void 0) argv.push(githubRepo2);
    const repoPath = env.input("repo-path") ?? env.workspace;
    if (repoPath !== void 0) argv.push("--repo", repoPath);
    for (const flag of ["integration-branch", "lookback-days", "max-prs", "horizons", "attribution-config", "state-dir", "as-of"]) {
      const value = env.input(flag);
      if (value !== void 0) argv.push(`--${flag}`, value);
    }
    if (env.input("state-dir") === void 0) argv.push("--no-state");
    if (actionFlagIsTrue(env.input("offline"))) argv.push("--offline");
    const requestedOut2 = env.input("output-path") ?? "hokusai-report.json";
    const outputPath2 = isAbsolute(requestedOut2) ? requestedOut2 : join(env.runnerTemp ?? ".", requestedOut2);
    argv.push("--out", outputPath2);
    return { argv, outputPath: outputPath2 };
  }
  const repo = env.input("repo-path") ?? env.workspace ?? ".";
  argv.push("--repo", repo);
  const integrationBranch = env.input("integration-branch");
  if (integrationBranch !== void 0) argv.push("--integration-branch", integrationBranch);
  const prNumber = env.input("pr-number");
  if (prNumber !== void 0) argv.push("--pr", prNumber);
  const prUrl = env.input("pr-url");
  if (prUrl !== void 0) argv.push("--pr-url", prUrl);
  const githubRepo = env.input("github-repo");
  if (githubRepo !== void 0) argv.push("--github-repo", githubRepo);
  const asOf = env.input("as-of");
  if (asOf !== void 0) argv.push("--as-of", asOf);
  const horizons = env.input("horizons");
  if (horizons !== void 0) argv.push("--horizons", horizons);
  const baseRef = env.input("base-ref");
  if (baseRef !== void 0) argv.push("--base-ref", baseRef);
  if (actionFlagIsTrue(env.input("no-links"))) argv.push("--no-links");
  if (actionFlagIsTrue(env.input("offline"))) argv.push("--offline");
  if (actionFlagIsTrue(env.input("debug"))) argv.push("--debug");
  const requestedOut = env.input("output-path") ?? "hokusai-scan-output.jsonl";
  const outputPath = isAbsolute(requestedOut) ? requestedOut : join(env.runnerTemp ?? ".", requestedOut);
  argv.push("--out", outputPath);
  return { argv, outputPath };
}

// src/cli-core.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, statSync as statSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname, resolve as resolve5 } from "node:path";
import { parseArgs as parseArgs3 } from "node:util";

// src/candidate-features.ts
import { statSync as statSync2 } from "node:fs";
import { resolve as resolve2 } from "node:path";

// ../core/src/outcome.ts
var OUTCOME_REPORT_KEYS = [
  "schemaVersion",
  "correlationId",
  "recommendedModel",
  "actualModel",
  "recommendationAccepted",
  "completionStatus",
  "userRating",
  "latencyBucket",
  "costBucket",
  "tokenBucket",
  "build",
  "test",
  "notes",
  "extensions"
];
var BUILD_SUMMARY_KEYS = [
  "status",
  "failures"
];
var TEST_SUMMARY_KEYS = [
  "status",
  "failures"
];
var OUTCOME_EXTENSION_KEYS = [
  "version",
  "data"
];
var OUTCOME_REPORT_KEY_SET = new Set(OUTCOME_REPORT_KEYS);
var BUILD_SUMMARY_KEY_SET = new Set(BUILD_SUMMARY_KEYS);
var TEST_SUMMARY_KEY_SET = new Set(TEST_SUMMARY_KEYS);
var OUTCOME_EXTENSION_KEY_SET = new Set(OUTCOME_EXTENSION_KEYS);

// ../core/src/model-registry.ts
var ANTHROPIC_MODELS = [
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    family: "claude",
    aliases: ["opus", "claude-opus", "anthropic/claude-opus-4.8"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    family: "claude",
    aliases: ["sonnet", "claude-sonnet", "anthropic/claude-sonnet-4.6"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true,
    default: true
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5-20251001",
    family: "claude",
    aliases: ["haiku", "claude-haiku"],
    capabilities: ["streaming", "tool-use"],
    available: true
  }
];
var OPENROUTER_PRIORITY_MODELS = [
  {
    provider: "deepseek",
    id: "deepseek-r1",
    family: "deepseek",
    aliases: ["deepseek/deepseek-r1"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "deepseek",
    id: "deepseek-v3",
    family: "deepseek",
    aliases: ["deepseek/deepseek-chat-v3"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "deepseek",
    id: "deepseek-coder-v2",
    family: "deepseek",
    aliases: ["deepseek/deepseek-coder-v2-instruct"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "qwen",
    id: "qwen-2.5-coder-32b",
    family: "qwen",
    aliases: ["qwen/qwen-2.5-coder-32b-instruct", "qwen2.5-coder-32b"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "qwen",
    id: "qwen-3-coder",
    family: "qwen",
    aliases: ["qwen/qwen3-coder"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "qwen",
    id: "qwen-3-235b",
    family: "qwen",
    aliases: ["qwen/qwen3-235b-a22b-instruct"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "qwen",
    id: "qwen-2.5-72b",
    family: "qwen",
    aliases: ["qwen/qwen-2.5-72b-instruct"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "moonshotai",
    id: "kimi-k2",
    family: "kimi",
    aliases: ["moonshotai/kimi-k2"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "moonshotai",
    id: "kimi-k2.7-code",
    family: "kimi",
    aliases: ["moonshotai/kimi-k2.7-code"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "moonshotai",
    id: "kimi-k2-thinking",
    family: "kimi",
    aliases: ["moonshotai/kimi-k2-thinking"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "z-ai",
    id: "glm-5.2",
    family: "glm",
    aliases: ["z-ai/glm-5.2"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "google",
    id: "gemini-2.5-pro",
    family: "gemini",
    aliases: ["google/gemini-2.5-pro"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "google",
    id: "gemini-2.5-flash",
    family: "gemini",
    aliases: ["google/gemini-2.5-flash"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "google",
    id: "gemini-2.0-flash",
    family: "gemini",
    aliases: ["google/gemini-2.0-flash-001"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "meta",
    id: "llama-3.3-70b",
    family: "llama",
    aliases: ["meta-llama/llama-3.3-70b-instruct"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "meta",
    id: "llama-4-maverick",
    family: "llama",
    aliases: ["meta-llama/llama-4-maverick"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "meta",
    id: "llama-4-scout",
    family: "llama",
    aliases: ["meta-llama/llama-4-scout"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "mistralai",
    id: "mistral-large-2",
    family: "mistral",
    aliases: ["mistralai/mistral-large-2411"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "mistralai",
    id: "mistral-medium-3",
    family: "mistral",
    aliases: ["mistralai/mistral-medium-3"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "mistralai",
    id: "devstral-small",
    family: "mistral",
    aliases: ["mistralai/devstral-small"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "mistralai",
    id: "devstral-medium",
    family: "mistral",
    aliases: ["mistralai/devstral-medium"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "x-ai",
    id: "grok-code-fast",
    family: "grok",
    aliases: ["x-ai/grok-code-fast-1"],
    capabilities: ["tool-use"],
    available: true
  }
];
var PRIORITY_MODELS = [
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    family: "claude",
    aliases: ["anthropic/claude-opus-4.8"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-opus-4-7",
    family: "claude",
    aliases: ["anthropic/claude-opus-4.7"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    family: "claude",
    aliases: ["anthropic/claude-sonnet-5"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    family: "claude",
    aliases: ["anthropic/claude-sonnet-4.6"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5",
    family: "claude",
    aliases: ["anthropic/claude-haiku-4.5"],
    capabilities: ["streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-fable-5",
    family: "claude",
    aliases: ["anthropic/claude-fable-5"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "openai",
    id: "gpt-5.5",
    family: "gpt",
    aliases: ["openai/gpt-5.5"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "openai",
    id: "gpt-5",
    family: "gpt",
    aliases: ["openai/gpt-5"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "openai",
    id: "gpt-5-mini",
    family: "gpt",
    aliases: ["openai/gpt-5-mini"],
    capabilities: ["reasoning", "tool-use"],
    available: true
  },
  {
    provider: "openai",
    id: "gpt-4.1",
    family: "gpt",
    aliases: ["openai/gpt-4.1"],
    capabilities: ["tool-use"],
    available: true
  },
  {
    provider: "openai",
    id: "o3-mini",
    family: "gpt",
    aliases: ["openai/o3-mini"],
    capabilities: ["reasoning", "tool-use"],
    available: false
  },
  ...OPENROUTER_PRIORITY_MODELS
];

// ../core/src/config.ts
var DEFAULT_ALLOWLIST = ANTHROPIC_MODELS.map((model) => model.id);

// ../core/src/task-packet.ts
var TASK_PACKET_KEYS = [
  "schemaVersion",
  "userIntent",
  "taskFamily",
  "reasoningDepth",
  "repositoryScale",
  "languageSignals",
  "frameworkSignals",
  "availableTools",
  "constraints",
  "modelConstraints",
  "providerConstraints"
];
var TASK_PACKET_KEY_SET = new Set(TASK_PACKET_KEYS);

// ../core/src/task-signals.ts
var LANGUAGE_BY_EXTENSION = {
  c: "C",
  cc: "C++",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  go: "Go",
  h: "C/C++ Headers",
  hpp: "C/C++ Headers",
  html: "HTML",
  java: "Java",
  js: "JavaScript",
  jsx: "JavaScript",
  kt: "Kotlin",
  kts: "Kotlin",
  md: "Markdown",
  mjs: "JavaScript",
  php: "PHP",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  sh: "Shell",
  sql: "SQL",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TypeScript",
  yaml: "YAML",
  yml: "YAML"
};
var FAMILY_KEYWORDS = [
  {
    family: "migration",
    patterns: [/\bmigrat(?:e|ion|ing)\b/i, /\balembic\b/i, /\bbackfill\b/i]
  },
  {
    family: "infra",
    patterns: [/\binfra(?:structure)?\b/i, /\bci\b/i, /\bdeploy(?:ment)?\b/i, /\bterraform\b/i]
  },
  {
    family: "docs",
    patterns: [/\bdocs?\b/i, /\breadme\b/i, /\bdocumentation\b/i]
  },
  {
    family: "test",
    patterns: [/\btests?\b/i, /\bvitest\b/i, /\bjest\b/i, /\bcypress\b/i]
  },
  {
    family: "refactor",
    patterns: [/\brefactor\b/i, /\brename\b/i, /\brestructure\b/i, /\bcleanup\b/i]
  },
  {
    family: "feature",
    patterns: [/\bfeature\b/i, /\bimplement\b/i, /\badd support\b/i, /\bsupport\b/i, /\benable\b/i]
  },
  {
    family: "bug",
    patterns: [
      /\bbug\b/i,
      /\bregression\b/i,
      /\bbroken\b/i,
      /\bfailing\b/i,
      /\bfix(?:e[sd])?\b.{0,24}\b(?:bug|regression|failure|crash|timeout)\b/i
    ]
  }
];
var INVESTIGATION_PATTERNS = [/\binvestigat(?:e|ion)\b/i, /\banaly[sz]e\b/i, /\bdebug\b/i];
var DEEP_REASONING_PATTERNS = [
  /\binvestigat(?:e|ion)\b/i,
  /\banaly[sz]e\b/i,
  /\bdeep(?:ly)?\b/i,
  /\broot cause\b/i,
  /\bcompare\b/i
];
function normalizeText(text) {
  return text.trim().toLowerCase();
}
function classifyTaskFamily(input) {
  const haystack = [input.text, ...input.hints ?? []].join("\n");
  const matches = /* @__PURE__ */ new Set();
  for (const entry of FAMILY_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      matches.add(entry.family === "bug" ? "bugfix" : entry.family);
    }
  }
  if (matches.size > 1) {
    return "mixed";
  }
  if (matches.size === 1) {
    return [...matches][0];
  }
  if (INVESTIGATION_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return "investigation";
  }
  return "chore";
}
function inferReasoningDepth(input) {
  if (input.reasoningDepth) {
    return input.reasoningDepth;
  }
  const normalized2 = normalizeText(input.text);
  if (normalized2.length > 0 && normalized2.length < 40) {
    return "shallow";
  }
  if (DEEP_REASONING_PATTERNS.some((pattern) => pattern.test(normalized2))) {
    return "deep";
  }
  return "standard";
}
function bucketRepositoryScale(fileCount) {
  if (typeof fileCount !== "number" || !Number.isFinite(fileCount) || fileCount < 0) {
    return void 0;
  }
  if (fileCount < 100) {
    return "small";
  }
  if (fileCount < 1e3) {
    return "medium";
  }
  if (fileCount < 1e4) {
    return "large";
  }
  return "xlarge";
}
function summarizeLanguageSignals(extensionCounts) {
  const languages = /* @__PURE__ */ new Set();
  for (const [extension, count] of Object.entries(extensionCounts)) {
    if (typeof count !== "number" || count <= 0) {
      continue;
    }
    const normalized2 = extension.replace(/^\./, "").toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[normalized2];
    if (language) {
      languages.add(language);
    }
  }
  return [...languages].sort((left, right) => left.localeCompare(right));
}

// ../core/src/contribution/descriptor-types.ts
var HOKUSAI_TASK_TYPES = [
  "bugfix",
  "feature",
  "refactor",
  "infra",
  "tests",
  "migration",
  "docs",
  "unknown"
];
var HOKUSAI_LANGUAGES = [
  "python",
  "typescript",
  "javascript",
  "go",
  "rust",
  "java",
  "bash",
  "multi",
  "unknown"
];
var HOKUSAI_DOMAINS = [
  "backend",
  "frontend",
  "fullstack",
  "devops",
  "data",
  "ml",
  "mobile",
  "unknown"
];
var HOKUSAI_REPO_SIZE_BUCKETS = [
  "small",
  "medium",
  "large",
  "xlarge"
];
var HOKUSAI_FILES_TOUCHED_BUCKETS = [
  "1",
  "2_5",
  "6_15",
  "16_plus"
];
var HOKUSAI_DESCRIPTION_LENGTH_BUCKETS = [
  "short",
  "medium",
  "long"
];
var HOKUSAI_RISK_LEVELS = ["low", "medium", "high"];

// ../core/src/candidate-features.ts
var CANDIDATE_FEATURES_SCHEMA_VERSION = "candidate_features/v1";
var CANDIDATE_FEATURE_DEFINITIONS = Object.freeze({
  // Shape — checkout/PR diff measurements.
  files_touched: {
    group: "shape",
    kind: "integer",
    minimum: 0,
    description: "Number of files changed by the candidate.",
    nullMeaning: "The candidate diff could not be enumerated.",
    source: "Wavemill DifficultySignals.filesTouched."
  },
  lines_added: {
    group: "shape",
    kind: "integer",
    minimum: 0,
    description: "Number of added lines in the candidate diff.",
    nullMeaning: "Directional diff statistics were unavailable.",
    source: "PR additions or git numstat additions."
  },
  lines_deleted: {
    group: "shape",
    kind: "integer",
    minimum: 0,
    description: "Number of deleted lines in the candidate diff.",
    nullMeaning: "Directional diff statistics were unavailable.",
    source: "PR deletions or git numstat deletions."
  },
  loc_touched: {
    group: "shape",
    kind: "integer",
    minimum: 0,
    description: "Total added plus deleted lines in the candidate diff.",
    nullMeaning: "The candidate diff could not be measured.",
    source: "Wavemill DifficultySignals.locTouched."
  },
  dependency_depth: {
    group: "shape",
    kind: "integer",
    minimum: 0,
    description: "Maximum dependency-graph depth reached by changed modules.",
    nullMeaning: "No supported dependency graph could be derived.",
    source: "Wavemill DifficultySignals.dependencyDepth."
  },
  module_hotspot_score: {
    group: "shape",
    kind: "number",
    minimum: 0,
    maximum: 100,
    description: "Repository-history hotspot score for changed modules.",
    nullMeaning: "Sufficient repository history was unavailable.",
    source: "Wavemill DifficultySignals.moduleHotspotScore."
  },
  diff_uncertain: {
    group: "shape",
    kind: "boolean",
    description: "Whether diff parsing produced internally suspicious measurements.",
    nullMeaning: "No diff analysis was attempted.",
    source: "Wavemill DifficultySignals.diffUncertain."
  },
  // Static — tool results, never inferred from tool absence.
  type_errors: {
    group: "static",
    kind: "integer",
    minimum: 0,
    description: "Type-check errors reported for the candidate.",
    nullMeaning: "No supported type checker completed successfully.",
    source: "HOK-2806 static collector; legacy typecheckPassed is not an error count."
  },
  lint_errors: {
    group: "static",
    kind: "integer",
    minimum: 0,
    description: "Lint errors reported for the candidate.",
    nullMeaning: "No supported linter completed successfully.",
    source: "HOK-2806 static collector; legacy lintDelta is not an error count."
  },
  build_ok: {
    group: "static",
    kind: "boolean",
    description: "Whether the configured build completed successfully.",
    nullMeaning: "No build ran to a terminal result or collection failed.",
    source: "Wavemill CI/build checks; CiOutcome.ran must be true."
  },
  complexity_delta: {
    group: "static",
    kind: "number",
    description: "Candidate-minus-base change in the configured code-complexity metric.",
    nullMeaning: "No supported complexity analyzer completed on both revisions.",
    source: "HOK-2806 static collector."
  },
  // Test — test-diff and execution facts.
  tests_changed: {
    group: "test",
    kind: "boolean",
    description: "Whether the candidate adds or modifies test files.",
    nullMeaning: "Test files could not be classified from the diff.",
    source: "Wavemill TestsOutcome.added (which detects additions or modifications)."
  },
  test_pass_rate: {
    group: "test",
    kind: "number",
    minimum: 0,
    maximum: 1,
    description: "Fraction of executed tests that passed.",
    nullMeaning: "No supported test result completed with a measurable rate.",
    source: "Wavemill TestsOutcome.passRate."
  },
  test_runtime_seconds: {
    group: "test",
    kind: "number",
    minimum: 0,
    description: "Elapsed seconds for the candidate test execution.",
    nullMeaning: "Test runtime was not reported.",
    source: "Wavemill TestsOutcome.durationSeconds."
  },
  // Intent — exactly the established HokusaiTaskDescriptor vocabulary.
  task_type: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_TASK_TYPES,
    description: "Coarse category of the requested change.",
    nullMeaning: "No task category could be derived without guessing.",
    source: "SDK deriveTaskDescriptor and Wavemill TaskDescriptor.signals."
  },
  language: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_LANGUAGES,
    description: "Dominant implementation language category.",
    nullMeaning: "No supported dominant language could be derived.",
    source: "SDK deriveTaskDescriptor and repository language signals."
  },
  domain: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_DOMAINS,
    description: "Coarse product or engineering domain category.",
    nullMeaning: "No domain evidence was available; do not default to backend.",
    source: "Wavemill TaskDescriptor.signals.learned.domain."
  },
  complexity: {
    group: "intent",
    kind: "number",
    minimum: 0,
    maximum: 10,
    description: "Normalized estimated task complexity on the Hokusai 0\u201310 scale.",
    nullMeaning: "Complexity could not be derived without a fallback.",
    source: "SDK deriveTaskDescriptor and normalized Wavemill complexity."
  },
  repo_size_bucket: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_REPO_SIZE_BUCKETS,
    description: "Bucketed repository size.",
    nullMeaning: "Repository size could not be measured.",
    source: "SDK bucketRepositoryScale from repository file count."
  },
  files_touched_bucket: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_FILES_TOUCHED_BUCKETS,
    description: "Bucketed number of files changed by the candidate.",
    nullMeaning: "The candidate diff could not be enumerated.",
    source: "Existing HokusaiTaskDescriptor projection."
  },
  description_length_bucket: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_DESCRIPTION_LENGTH_BUCKETS,
    description: "Bucketed length of the locally inspected task description.",
    nullMeaning: "No task description was available to classify locally.",
    source: "Existing HokusaiTaskDescriptor projection."
  },
  is_greenfield: {
    group: "intent",
    kind: "boolean",
    description: "Whether the task creates a new subsystem rather than changing one.",
    nullMeaning: "The change kind could not be classified.",
    source: "Wavemill HeuristicSignals.is_greenfield."
  },
  is_migration: {
    group: "intent",
    kind: "boolean",
    description: "Whether the task includes a schema or data migration.",
    nullMeaning: "Migration intent could not be classified.",
    source: "Wavemill HeuristicSignals.has_migration."
  },
  requires_tests: {
    group: "intent",
    kind: "boolean",
    description: "Whether the task intent requires test work.",
    nullMeaning: "Test intent could not be classified.",
    source: "Wavemill HeuristicSignals.has_tests and task contract."
  },
  cross_service: {
    group: "intent",
    kind: "boolean",
    description: "Whether the task spans multiple services or repositories.",
    nullMeaning: "Service scope could not be classified.",
    source: "Wavemill HeuristicSignals.cross_service."
  },
  ui_heavy: {
    group: "intent",
    kind: "boolean",
    description: "Whether UI work is a substantial part of the task.",
    nullMeaning: "UI intent could not be classified.",
    source: "Wavemill HeuristicSignals.has_ui."
  },
  risk_level: {
    group: "intent",
    kind: "enum",
    values: HOKUSAI_RISK_LEVELS,
    description: "Coarse locally derived implementation-risk category.",
    nullMeaning: "Risk could not be classified from bounded derived signals.",
    source: "Existing HokusaiTaskDescriptor risk projection."
  },
  // Provenance — bounded pre-arbitration process facts, never identity.
  touched_out_of_scope_files: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of changed files outside the authoritative task scope.",
    nullMeaning: "No task scope authority existed or the scope guard errored.",
    source: "Wavemill ReviewScopeGuardResult.outOfScopePaths length."
  },
  human_intervention_count: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of recorded human interventions before arbitration.",
    nullMeaning: "Intervention collection was unavailable.",
    source: "Wavemill interventionCount/interventions."
  },
  review_rounds: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of distinct pre-arbitration human review rounds.",
    nullMeaning: "Review history was unavailable.",
    source: "Wavemill ReviewOutcome.rounds."
  },
  change_requests: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of pre-arbitration change-request reviews.",
    nullMeaning: "Review history was unavailable.",
    source: "Wavemill ReviewOutcome.changeRequests."
  },
  self_review_iterations: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of recorded automated self-review repair iterations.",
    nullMeaning: "Self-review iteration telemetry was unavailable.",
    source: "Wavemill ReviewOutcome.selfReviewIterations."
  },
  agent_iterations: {
    group: "provenance",
    kind: "integer",
    minimum: 0,
    description: "Number of recorded implementation iterations before arbitration.",
    nullMeaning: "Implementation iteration telemetry was unavailable.",
    source: "Wavemill ReworkOutcome.agentIterations."
  }
});
function fieldsForGroup(group) {
  return Object.freeze(
    Object.entries(CANDIDATE_FEATURE_DEFINITIONS).filter(([, definition]) => definition.group === group).map(([name]) => name)
  );
}
var CANDIDATE_FEATURE_SHAPE_FIELDS = fieldsForGroup("shape");
var CANDIDATE_FEATURE_STATIC_FIELDS = fieldsForGroup("static");
var CANDIDATE_FEATURE_TEST_FIELDS = fieldsForGroup("test");
var CANDIDATE_FEATURE_INTENT_FIELDS = fieldsForGroup("intent");
var CANDIDATE_FEATURE_PROVENANCE_FIELDS = fieldsForGroup("provenance");
var CANDIDATE_FEATURE_FIELDS = Object.freeze(
  Object.keys(CANDIDATE_FEATURE_DEFINITIONS)
);
function definitionJsonSchema(definition, nullable2) {
  let valueSchema;
  if (definition.kind === "enum") {
    valueSchema = { type: "string", enum: [...definition.values] };
  } else if (definition.kind === "boolean") {
    valueSchema = { type: "boolean" };
  } else {
    valueSchema = { type: definition.kind };
    if (definition.minimum !== void 0) {
      valueSchema.minimum = definition.minimum;
    }
    if (definition.maximum !== void 0) {
      valueSchema.maximum = definition.maximum;
    }
  }
  valueSchema.description = `${definition.description} Null means: ${definition.nullMeaning}`;
  return nullable2 ? { anyOf: [valueSchema, { type: "null" }] } : valueSchema;
}
var CANDIDATE_FEATURES_V1_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.hokus.ai/candidate_features/v1.json",
  title: "Hokusai candidate_features/v1",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", ...CANDIDATE_FEATURE_FIELDS],
  properties: {
    schema_version: {
      type: "string",
      const: CANDIDATE_FEATURES_SCHEMA_VERSION
    },
    ...Object.fromEntries(
      CANDIDATE_FEATURE_FIELDS.map((name) => [
        name,
        definitionJsonSchema(CANDIDATE_FEATURE_DEFINITIONS[name], true)
      ])
    )
  }
});
var CANDIDATE_FEATURE_FIELD_SET = new Set(CANDIDATE_FEATURE_FIELDS);
var CANDIDATE_FEATURE_WIRE_FIELD_SET = /* @__PURE__ */ new Set([
  "schema_version",
  ...CANDIDATE_FEATURE_FIELDS
]);
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function fieldError(path2, message, code) {
  return { path: path2, message, code };
}
function validateFeatureValue(name, value) {
  if (value === null) {
    return void 0;
  }
  const definition = CANDIDATE_FEATURE_DEFINITIONS[name];
  if (definition.kind === "boolean") {
    return typeof value === "boolean" ? void 0 : fieldError(name, "Expected a boolean or null.", "invalid_type");
  }
  if (definition.kind === "enum") {
    if (typeof value !== "string") {
      return fieldError(
        name,
        "Expected a string enum value or null.",
        "invalid_type"
      );
    }
    return definition.values.includes(value) ? void 0 : fieldError(
      name,
      `Expected one of: ${definition.values.join(", ")}.`,
      "invalid_value"
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fieldError(
      name,
      "Expected a finite number or null.",
      "invalid_type"
    );
  }
  if (definition.kind === "integer" && !Number.isInteger(value)) {
    return fieldError(name, "Expected an integer or null.", "invalid_type");
  }
  if (definition.minimum !== void 0 && value < definition.minimum) {
    return fieldError(
      name,
      `Expected a value greater than or equal to ${definition.minimum}.`,
      "invalid_value"
    );
  }
  if (definition.maximum !== void 0 && value > definition.maximum) {
    return fieldError(
      name,
      `Expected a value less than or equal to ${definition.maximum}.`,
      "invalid_value"
    );
  }
  return void 0;
}
function validateCandidateFeaturesV1(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        fieldError(
          "$",
          "Candidate features must be a plain object.",
          "invalid_type"
        )
      ]
    };
  }
  const errors = [];
  for (const key of Object.keys(input)) {
    if (!CANDIDATE_FEATURE_WIRE_FIELD_SET.has(key)) {
      errors.push(
        fieldError(key, `Unknown candidate feature "${key}".`, "invalid_value")
      );
    }
  }
  if (!("schema_version" in input)) {
    errors.push(fieldError("schema_version", "Field is required.", "required"));
  } else if (input.schema_version !== CANDIDATE_FEATURES_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        "schema_version",
        `Expected "${CANDIDATE_FEATURES_SCHEMA_VERSION}".`,
        typeof input.schema_version === "string" ? "invalid_value" : "invalid_type"
      )
    );
  }
  for (const name of CANDIDATE_FEATURE_FIELDS) {
    if (!(name in input)) {
      errors.push(fieldError(name, "Field is required.", "required"));
      continue;
    }
    const error = validateFeatureValue(name, input[name]);
    if (error) {
      errors.push(error);
    }
  }
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}
var CandidateFeaturesBuildError = class extends Error {
  errors;
  constructor(errors) {
    super(
      `Cannot build ${CANDIDATE_FEATURES_SCHEMA_VERSION}: ${errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`
    );
    this.name = "CandidateFeaturesBuildError";
    this.errors = errors;
  }
};
function finalizeCandidateFeaturesV1(...projections) {
  const candidate = {
    schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION
  };
  for (const name of CANDIDATE_FEATURE_FIELDS) {
    candidate[name] = null;
  }
  for (const projection of projections) {
    if (projection === void 0) {
      continue;
    }
    if (!isPlainObject(projection)) {
      throw new CandidateFeaturesBuildError([
        fieldError("$", "Projection must be a plain object.", "invalid_type")
      ]);
    }
    for (const [name, value] of Object.entries(projection)) {
      if (!CANDIDATE_FEATURE_FIELD_SET.has(name)) {
        throw new CandidateFeaturesBuildError([
          fieldError(
            name,
            `Unknown candidate feature "${name}".`,
            "invalid_value"
          )
        ]);
      }
      candidate[name] = value;
    }
  }
  const result = validateCandidateFeaturesV1(candidate);
  if (!result.ok) {
    throw new CandidateFeaturesBuildError(result.errors);
  }
  return result.value;
}
function candidateFeatureValueJsonSchema(name, nullable2 = true) {
  return definitionJsonSchema(CANDIDATE_FEATURE_DEFINITIONS[name], nullable2);
}

// ../core/src/arbiter-survival-label.ts
import { createHash } from "node:crypto";
var ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION = "1.0.0";
var SUBSTANTIAL_REWRITE_THRESHOLD = 0.5;
var HORIZONS = [14, 30, 60];
var REASON_CODES = [
  // positive-signal codes
  "exact_revert",
  "line_range_followup",
  "linked_issue_or_pr",
  "pre_merge_human_edit",
  "task_redispatch",
  "substantial_rewrite",
  // negative-signal / non-event
  "no_evidence",
  // missing / ineligible causes
  "unmerged_pr",
  "missing_horizon",
  "insufficient_history",
  "insufficient_line_range_substrate",
  "inaccessible_history",
  "ambiguous_change"
];
var MISSING_REASON_CODES = [
  "unmerged_pr",
  "missing_horizon",
  "insufficient_history",
  "insufficient_line_range_substrate",
  "inaccessible_history",
  "ambiguous_change"
];
function deriveReportOutcome(inputs, threshold = SUBSTANTIAL_REWRITE_THRESHOLD) {
  const { survived, survival_ratio, reverted, followup } = inputs;
  if (survived === null || survival_ratio === null || reverted === null || followup === null) {
    return null;
  }
  if (reverted) return "reverted";
  if (survival_ratio < threshold) return "substantially_rewritten";
  if (followup) return "followup";
  return "survived";
}
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sorted2 = {};
    for (const key of Object.keys(value).sort()) {
      sorted2[key] = canonicalize(value[key]);
    }
    return sorted2;
  }
  return value;
}
function canonicalSerialize(label2) {
  return JSON.stringify(canonicalize(label2));
}
function canonicalHash(label2) {
  return createHash("sha256").update(canonicalSerialize(label2), "utf-8").digest("hex");
}
function buildArbiterSurvivalLabel(input) {
  const report_outcome = deriveReportOutcome(
    {
      survived: input.outcome.survived,
      survival_ratio: input.outcome.survival_ratio,
      reverted: input.outcome.reverted,
      followup: input.outcome.followup
    },
    input.substantialRewriteThreshold
  );
  const label2 = {
    schema_version: "1.0.0",
    prUrl: input.prUrl,
    horizon_days: input.horizon_days,
    label_provenance: input.label_provenance,
    line_ranges: input.line_ranges,
    outcome: { ...input.outcome, report_outcome },
    envelope: {
      ...input.envelope,
      schema_version: ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION
    }
  };
  if (input.owner_correction !== void 0) {
    label2.owner_correction = input.owner_correction;
  }
  return label2;
}

// ../core/src/arbiter-survival-label-schema.ts
var ARBITER_SURVIVAL_LABEL_V1_JSON_SCHEMA = Object.freeze(
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "arbiter-survival-label.schema.json",
    "title": "ArbiterSurvivalLabelV1",
    "description": "Arbiter S2 survival label: one label per merged PR per elapsed horizon (14/30/60 days), aggregated over normalized PR line ranges walked on the integration branch (never main blame). Producer: the wavemill survival labeller. Consumer: Hokusai/hokusai-data-pipeline training ingest. Contract doc: docs/arbiter/survival-label-contract.md. Any change requires a schema_version bump coordinated with the pipeline.",
    "type": "object",
    "required": [
      "schema_version",
      "prUrl",
      "horizon_days",
      "label_provenance",
      "line_ranges",
      "outcome",
      "envelope"
    ],
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "const": "1.0.0",
        "description": "Contract version of this label object. Must equal envelope.schema_version (asserted by the contract test)."
      },
      "prUrl": {
        "type": "string",
        "pattern": "^https?://\\S+$",
        "description": "Stable PR URL; the join key with eval and training corpora. Repo-agnostic: any host that assigns URLs to PRs (GitHub/GitLab/Gitea/Bitbucket)."
      },
      "horizon_days": {
        "enum": [
          14,
          30,
          60
        ],
        "description": "Elapsed forward window after merge_sha. One label object per (prUrl, horizon_days)."
      },
      "label_provenance": {
        "enum": [
          "harvested",
          "owner_corrected"
        ],
        "description": "harvested = automatic label; owner_corrected = Tier-2b correction (weighted heavier downstream; weight ratio pinned in the pipeline, not here)."
      },
      "line_ranges": {
        "type": "array",
        "description": "Normalized-then-anchored PR-changed line ranges: the denominator and matching substrate. Whitespace-only hunks stripped, formatter/linter-only lines stripped, rename tracking applied. May be empty only for missing/ineligible labels (e.g. insufficient_line_range_substrate).",
        "items": {
          "$ref": "#/$defs/lineRange"
        }
      },
      "outcome": {
        "$ref": "#/$defs/survivalOutcome"
      },
      "envelope": {
        "$ref": "#/$defs/reproducibilityEnvelope"
      },
      "owner_correction": {
        "$ref": "#/$defs/ownerCorrection"
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "label_provenance": {
              "const": "owner_corrected"
            }
          },
          "required": [
            "label_provenance"
          ]
        },
        "then": {
          "required": [
            "owner_correction"
          ]
        },
        "else": {
          "not": {
            "required": [
              "owner_correction"
            ]
          }
        }
      }
    ],
    "$defs": {
      "gitSha": {
        "type": "string",
        "pattern": "^([0-9a-f]{40}|[0-9a-f]{64})$",
        "description": "Full git object id, lowercase hex (40 chars for SHA-1 repos, 64 for SHA-256 repos)."
      },
      "sha256Hex": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$",
        "description": "Lowercase hex SHA-256 digest."
      },
      "isoUtcTimestamp": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$",
        "description": "ISO-8601 UTC timestamp with trailing Z."
      },
      "semver": {
        "type": "string",
        "pattern": "^\\d+\\.\\d+\\.\\d+$",
        "description": "Semantic version string, e.g. 1.0.0."
      },
      "reasonCode": {
        "enum": [
          "exact_revert",
          "line_range_followup",
          "linked_issue_or_pr",
          "pre_merge_human_edit",
          "task_redispatch",
          "substantial_rewrite",
          "no_evidence",
          "unmerged_pr",
          "missing_horizon",
          "insufficient_history",
          "insufficient_line_range_substrate",
          "inaccessible_history",
          "ambiguous_change"
        ],
        "description": "Typed reason code explaining the outcome. No free-form reason strings."
      },
      "missingReasonCode": {
        "enum": [
          "unmerged_pr",
          "missing_horizon",
          "insufficient_history",
          "insufficient_line_range_substrate",
          "inaccessible_history",
          "ambiguous_change"
        ],
        "description": "Reason codes valid for a missing/ineligible label (report_outcome=null)."
      },
      "lineRangeAnchor": {
        "type": "object",
        "required": [
          "start",
          "end",
          "sha"
        ],
        "additionalProperties": false,
        "properties": {
          "start": {
            "type": "integer",
            "minimum": 1,
            "description": "1-based inclusive start line."
          },
          "end": {
            "type": "integer",
            "minimum": 1,
            "description": "1-based inclusive end line; end >= start."
          },
          "sha": {
            "$ref": "#/$defs/gitSha",
            "description": "Commit the coordinates are anchored to, so a consumer can re-check the substrate byte-exactly."
          }
        }
      },
      "lineRange": {
        "type": "object",
        "required": [
          "path",
          "old",
          "new"
        ],
        "additionalProperties": false,
        "properties": {
          "path": {
            "type": "string",
            "minLength": 1,
            "description": "Repo-relative path using / separators. For renames, the post-change path; rename tracking is applied at normalization time."
          },
          "old": {
            "oneOf": [
              {
                "$ref": "#/$defs/lineRangeAnchor"
              },
              {
                "type": "null"
              }
            ],
            "description": "Pre-change coordinates anchored at the labelled PR's base for this file (pr_head_sha's parent lineage). Null for pure additions."
          },
          "new": {
            "oneOf": [
              {
                "$ref": "#/$defs/lineRangeAnchor"
              },
              {
                "type": "null"
              }
            ],
            "description": "Post-change coordinates anchored at pr_head_sha. Null for pure deletions."
          }
        },
        "not": {
          "type": "object",
          "properties": {
            "old": {
              "type": "null"
            },
            "new": {
              "type": "null"
            }
          },
          "required": [
            "old",
            "new"
          ],
          "description": "old and new must not both be null: an empty range carries no substrate."
        }
      },
      "survivalOutcome": {
        "type": "object",
        "required": [
          "survived",
          "survival_ratio",
          "reverted",
          "undone_by",
          "followup",
          "report_outcome",
          "reason_codes"
        ],
        "additionalProperties": false,
        "properties": {
          "survived": {
            "type": [
              "boolean",
              "null"
            ],
            "description": "true = no exact revert and no qualifying follow-up affected the normalized PR line ranges inside the horizon; false = ranges were exactly reverted or required qualifying follow-up; null = missing/ineligible."
          },
          "survival_ratio": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "maximum": 1,
            "description": "Line-weighted fraction of normalized PR-changed lines still present in the horizon terminal tree. Null for missing/ineligible."
          },
          "reverted": {
            "type": [
              "boolean",
              "null"
            ],
            "description": "true only for exact/high-precision restoration of pre-change lines over the PR ranges. Null for missing/ineligible."
          },
          "undone_by": {
            "enum": [
              "human",
              "agent",
              null
            ],
            "description": "Attributable dominant undoer for the undo event affecting the labelled ranges. Null for no undo, formatter-only churn, ambiguous/mixed attribution, or missing labels. Human undo is weighted heavily downstream; agent self-undo lightly."
          },
          "followup": {
            "type": [
              "boolean",
              "null"
            ],
            "description": "true for qualifying line-range amendment, later PR/issue reference, same-task redispatch, or pre-merge human edit that materially undoes/replaces the candidate ranges before merge. Null for missing/ineligible."
          },
          "report_outcome": {
            "enum": [
              "survived",
              "followup",
              "substantially_rewritten",
              "reverted",
              null
            ],
            "description": "Deterministic mutually exclusive derived field. Precedence: null (any component null) > reverted > substantially_rewritten (survival_ratio < versioned threshold) > followup > survived."
          },
          "reason_codes": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/reasonCode"
            },
            "description": "Non-empty typed explanation of the outcome. Missing labels carry exactly one missing-reason code."
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "report_outcome": {
                  "const": null
                }
              },
              "required": [
                "report_outcome"
              ]
            },
            "then": {
              "properties": {
                "survived": {
                  "type": "null"
                },
                "survival_ratio": {
                  "type": "null"
                },
                "reverted": {
                  "type": "null"
                },
                "undone_by": {
                  "type": "null"
                },
                "followup": {
                  "type": "null"
                },
                "reason_codes": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 1,
                  "items": {
                    "$ref": "#/$defs/missingReasonCode"
                  }
                }
              }
            },
            "else": {
              "properties": {
                "survived": {
                  "type": "boolean"
                },
                "survival_ratio": {
                  "type": "number"
                },
                "reverted": {
                  "type": "boolean"
                },
                "followup": {
                  "type": "boolean"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "report_outcome": {
                  "const": "reverted"
                }
              },
              "required": [
                "report_outcome"
              ]
            },
            "then": {
              "properties": {
                "reverted": {
                  "const": true
                },
                "reason_codes": {
                  "contains": {
                    "const": "exact_revert"
                  }
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "report_outcome": {
                  "const": "substantially_rewritten"
                }
              },
              "required": [
                "report_outcome"
              ]
            },
            "then": {
              "properties": {
                "reverted": {
                  "const": false
                },
                "reason_codes": {
                  "contains": {
                    "const": "substantial_rewrite"
                  }
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "report_outcome": {
                  "const": "followup"
                }
              },
              "required": [
                "report_outcome"
              ]
            },
            "then": {
              "properties": {
                "reverted": {
                  "const": false
                },
                "followup": {
                  "const": true
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "report_outcome": {
                  "const": "survived"
                }
              },
              "required": [
                "report_outcome"
              ]
            },
            "then": {
              "properties": {
                "survived": {
                  "const": true
                },
                "reverted": {
                  "const": false
                },
                "followup": {
                  "const": false
                }
              }
            }
          }
        ]
      },
      "reproducibilityEnvelope": {
        "type": "object",
        "required": [
          "schema_version",
          "labeller_version",
          "normalization_version",
          "pr_head_sha",
          "merge_sha",
          "horizon_terminal_sha",
          "integration_branch",
          "computed_at"
        ],
        "additionalProperties": false,
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/semver",
            "description": "Contract version at emit time. Must equal the top-level schema_version."
          },
          "labeller_version": {
            "$ref": "#/$defs/semver",
            "description": "Semver of the labeller code that produced this label."
          },
          "normalization_version": {
            "$ref": "#/$defs/semver",
            "description": "Semver of the whitespace/rename/formatter normalizer and its threshold table (including the substantial-rewrite threshold)."
          },
          "pr_head_sha": {
            "$ref": "#/$defs/gitSha",
            "description": "Head commit of the labelled PR branch."
          },
          "merge_sha": {
            "$ref": "#/$defs/gitSha",
            "description": "Integration-branch merge commit for this PR. Never a main-branch squash commit."
          },
          "horizon_terminal_sha": {
            "$ref": "#/$defs/gitSha",
            "description": "Tip of integration_branch at (merge_sha committer time + horizon_days), resolved deterministically from the git graph."
          },
          "integration_branch": {
            "type": "string",
            "minLength": 1,
            "not": {
              "const": "main"
            },
            "description": "Branch the labeller walked, e.g. auto/integration. 'main' is rejected in v1.0.0: squash-promotion rewrites the SHA lineage the labeller needs."
          },
          "computed_at": {
            "$ref": "#/$defs/isoUtcTimestamp",
            "description": "When the labeller computed this label. Latest computed_at per (prUrl, horizon_days) wins in queries."
          }
        }
      },
      "ownerCorrection": {
        "type": "object",
        "required": [
          "supersedes",
          "correction"
        ],
        "additionalProperties": false,
        "description": "Tier-2b owner correction. The harvested record is never mutated in place; a correction is an additional row that supersedes it by hash.",
        "properties": {
          "supersedes": {
            "type": "object",
            "required": [
              "schema_version",
              "computed_at",
              "label_hash"
            ],
            "additionalProperties": false,
            "properties": {
              "schema_version": {
                "$ref": "#/$defs/semver",
                "description": "schema_version of the superseded label."
              },
              "computed_at": {
                "$ref": "#/$defs/isoUtcTimestamp",
                "description": "envelope.computed_at of the superseded label."
              },
              "label_hash": {
                "$ref": "#/$defs/sha256Hex",
                "description": "SHA-256 of the canonical-JSON serialization of the superseded label (see canonicalHash in shared/lib/arbiter-survival-label.ts). Lets the pipeline find and invalidate/downweight a previously-trained-on row."
              }
            }
          },
          "correction": {
            "type": "object",
            "required": [
              "reason_code",
              "corrected_by",
              "corrected_at",
              "previous_report_outcome"
            ],
            "additionalProperties": false,
            "properties": {
              "reason_code": {
                "oneOf": [
                  {
                    "$ref": "#/$defs/reasonCode"
                  },
                  {
                    "const": "owner_dispute"
                  }
                ],
                "description": "Why the owner corrected the label. owner_dispute covers disputes not expressible as a labeller reason code."
              },
              "corrected_by": {
                "type": "string",
                "minLength": 1,
                "description": "Identity of the human owner; opaque to this schema."
              },
              "corrected_at": {
                "$ref": "#/$defs/isoUtcTimestamp",
                "description": "When the correction was made."
              },
              "previous_report_outcome": {
                "enum": [
                  "survived",
                  "followup",
                  "substantially_rewritten",
                  "reverted",
                  null
                ],
                "description": "report_outcome of the superseded label, so the pipeline can compute the delta for an already-trained-on row."
              },
              "note": {
                "type": "string",
                "description": "Optional free-form owner note. Advisory only; never parsed by training."
              }
            }
          }
        }
      }
    }
  }
);

// ../core/src/task-cost/enums.ts
var TASK_COST_FIELD_AVAILABILITIES = [
  "available",
  "partial",
  "unavailable",
  "known_zero"
];
var TASK_COST_COVERAGES = [
  "complete",
  "partial",
  "unavailable",
  "known_zero"
];
var TASK_COST_SOURCES = [
  "provider_reported",
  "local_estimate",
  "mixed",
  "none"
];
var TASK_COST_EVENT_SOURCES = ["provider_reported", "local_estimate", "none"];
var TASK_COST_BASES = ["per_token_api", "subscription", "unknown"];
var TASK_COST_JOIN_CONFIDENCES = [
  "branch_worktree",
  "timestamp_window",
  "unattributed"
];
var TASK_COST_HARNESSES = [
  "claude-code",
  "codex",
  "native",
  "pi",
  "wavemill",
  "unknown"
];
var TASK_COST_USAGE_KINDS = ["delta", "cumulative"];
var TASK_COST_PRICING_SOURCES = [
  "local_estimate",
  "openrouter_api",
  "mixed",
  "none"
];
var TASK_COST_PRICE_TABLES = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "override",
  "external"
];
var TASK_COST_DIAGNOSTIC_CODES = [
  /** reducer: an event lacks input/output token counts. */
  "missing_token_usage",
  /** adapter: source usage was unparseable, negative, or non-finite. */
  "invalid_token_usage",
  /** reducer: usage was complete enough to price but no price was applied. */
  "unpriced_model",
  /** reducer: summary coverage is `partial`. */
  "mixed_coverage",
  /** reducer: at least one event was resolved from a provider-reported charge. */
  "provider_reported_cost",
  /** adapter: no price table was available at all. */
  "no_pricing_data",
  /** reducer: events exist but none produced a cost. */
  "no_priced_sessions",
  /** reducer: events were priced against more than one pricing revision. */
  "stale_pricing_revision",
  /** reducer: an event repeating a prior `event_id` was ignored. */
  "replay_dropped",
  /** reducer: a cumulative snapshot regressed and its delta was clamped. */
  "cumulative_backward_jump",
  /** reducer: subscription-basis events carry no actual charge. */
  "subscription_basis_no_charge"
];

// ../core/src/arbiter-report.ts
var ARBITER_REPORT_SCHEMA_VERSION = "arbiter_report/v1";
var REPORT_SUPPRESSION_REASONS = [
  "n_below_floor",
  "agent_coverage_below_floor",
  "harness_coverage_below_floor",
  "exact_model_coverage_below_floor",
  "harness_only_evidence",
  "cost_coverage_below_floor",
  "reworked_below_floor",
  "no_model_provenance",
  "horizon_not_mature"
];
var REPORT_ATTRIBUTION_METHODS = [
  "first_party_route_metadata",
  "bot_author",
  "branch_prefix",
  "co_authored_by_trailer",
  "pr_label",
  "commit_signature",
  "owner_config"
];
var REPORT_FEATURE_BUCKETS = Object.freeze({
  tests_changed: ["true", "false"],
  files_touched_bucket: ["1", "2_5", "6_15", "16_plus"],
  loc_touched: ["q1", "q2", "q3", "q4"]
});
var REPORT_FORBIDDEN_KEYS = [
  "title",
  "body",
  "diff",
  "patch",
  "source_code",
  "file_contents",
  "path",
  "paths",
  "files",
  "commit_message",
  "author",
  "author_email",
  "author_name",
  "prompt",
  "raw*",
  "line_ranges",
  "prUrl",
  "sha",
  "merge_sha",
  "pr_head_sha"
];
function projectSurvivalLabel(label2) {
  return {
    horizon_days: label2.horizon_days,
    label_provenance: label2.label_provenance,
    outcome: { ...label2.outcome },
    label_hash: canonicalHash(label2)
  };
}
var str = (pattern) => ({ type: "string", pattern });
var en = (values) => ({ enum: [...values] });
var num = (minimum = 0, maximum) => ({
  type: "number",
  minimum,
  ...maximum === void 0 ? {} : { maximum }
});
var int = (minimum = 0, maximum) => ({
  type: "integer",
  minimum,
  ...maximum === void 0 ? {} : { maximum }
});
var nullable = (schema) => ({
  anyOf: [schema, { type: "null" }]
});
var arr = (items, maxItems) => ({
  type: "array",
  items,
  ...maxItems === void 0 ? {} : { maxItems }
});
var obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties
});
var ref = (name) => ({ $ref: `#/$defs/${name}` });
var id = str("^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$");
var modelId = str("^[a-z0-9][a-z0-9._:/@-]{0,119}$");
var timestamp = str(
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"
);
var date = str("^\\d{4}-\\d{2}-\\d{2}$");
var semver = str("^\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?$");
var reasons = arr(en(REPORT_SUPPRESSION_REASONS));
var basis = en(["descriptive", "out_of_sample_prediction"]);
var cell = obj({
  basis,
  n: int(),
  value: nullable(num(-1e15, 1e15)),
  ci: nullable(
    obj({
      low: num(-1e15, 1e15),
      high: num(-1e15, 1e15),
      level: { const: 0.95 }
    })
  ),
  suppressed: { type: "boolean" },
  suppression_reasons: reasons
});
var section = (row) => obj({
  basis,
  status: en(["shown", "suppressed"]),
  suppression_reasons: reasons,
  rows: arr(row)
});
var horizon = en(HORIZONS);
var label = obj({
  horizon_days: horizon,
  label_provenance: en(["harvested", "owner_corrected"]),
  outcome: obj({
    survived: nullable({ type: "boolean" }),
    survival_ratio: nullable(num(0, 1)),
    reverted: nullable({ type: "boolean" }),
    undone_by: nullable(en(["human", "agent"])),
    followup: nullable({ type: "boolean" }),
    report_outcome: nullable(
      en(["survived", "followup", "substantially_rewritten", "reverted"])
    ),
    reason_codes: arr(en(REASON_CODES))
  }),
  label_hash: str("^[0-9a-f]{64}$")
});
var methods = arr(en(REPORT_ATTRIBUTION_METHODS));
var dimension = en(["agent", "harness", "exact_model"]);
var costCoverage = en(TASK_COST_COVERAGES);
var costSource = en(TASK_COST_SOURCES);
var featureSchema = { ...CANDIDATE_FEATURES_V1_JSON_SCHEMA };
delete featureSchema.$schema;
delete featureSchema.$id;
var ARBITER_REPORT_V1_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.hokus.ai/arbiter_report/v1.json",
  title: "Hokusai arbiter_report/v1",
  ...obj({
    schema_version: { const: ARBITER_REPORT_SCHEMA_VERSION },
    data_origin: en(["scan", "fixture"]),
    repo: obj({
      host: { const: "github" },
      owner: str("^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$"),
      name: { ...str("^[A-Za-z0-9._-]{1,100}$"), not: { enum: [".", ".."] } }
    }),
    scan: obj({
      scanned_at: timestamp,
      as_of: timestamp,
      scanner: obj({ package: { const: "@hokusai/scan" }, version: semver }),
      integration_branch: str("^[A-Za-z0-9._/-]{1,200}$"),
      lookback_days: int(1, 3650),
      window: obj({ merged_from: timestamp, merged_to: timestamp }),
      horizons_days: { ...arr(horizon, 3), minItems: 1, uniqueItems: true },
      contracts: obj({
        candidate_features: { const: "candidate_features/v1" },
        survival_label: { const: "1.0.0" },
        labeller_version: semver,
        normalization_version: semver
      })
    }),
    policy: obj({
      policy_version: semver,
      min_cell_n: int(1),
      min_agent_coverage: num(0, 1),
      min_harness_coverage: num(0, 1),
      min_exact_model_coverage: num(0, 1),
      min_cost_coverage: num(0, 1),
      min_reworked_for_retrospective: int(),
      ci_method: en(["wilson", "katz_log"]),
      ci_level: { const: 0.95 }
    }),
    coverage: obj({
      basis: { const: "descriptive" },
      prs_enumerated: int(),
      prs_eligible: int(),
      labels_by_horizon: arr(
        obj({
          horizon_days: horizon,
          labelled: int(),
          missing: arr(obj({ reason: en(MISSING_REASON_CODES), count: int() }))
        })
      ),
      attribution: obj({
        agent: obj({
          identified_agent: int(),
          identified_human_signal: int(),
          unknown: int(),
          rate: num(0, 1)
        }),
        harness: obj({ identified: int(), unknown: int(), rate: num(0, 1) }),
        exact_model: obj({
          identified: int(),
          unknown: int(),
          rate: num(0, 1)
        }),
        methods: arr(
          obj({
            dimension,
            method: en(REPORT_ATTRIBUTION_METHODS),
            count: int()
          })
        )
      })
    }),
    prs: arr(
      obj({
        pr_number: int(1),
        merged_at: timestamp,
        attribution: obj({
          agent: obj({
            status: en(["agent", "not_agent_signal", "unknown"]),
            confidence: nullable(num(0, 1)),
            methods
          }),
          harness: obj({
            id: nullable(id),
            confidence: nullable(num(0, 1)),
            methods
          }),
          exact_model: obj({
            id: nullable(modelId),
            confidence: nullable(num(0, 1)),
            methods,
            evidence: nullable(en(["first_party_executed", "heuristic"]))
          })
        }),
        features: ref("candidateFeatures"),
        labels: arr(label, 3),
        cost: nullable(
          obj({
            actual_usd: nullable(num()),
            estimated_usd: nullable(num()),
            cost_source: costSource,
            coverage: costCoverage,
            pricing_revision: nullable(id)
          })
        ),
        prediction: nullable(
          obj({
            basis: { const: "out_of_sample_prediction" },
            score: num(0, 1),
            flagged: { type: "boolean" }
          })
        )
      }),
      2e4
    ),
    aggregates: obj({
      survival_by_horizon: section(
        obj({
          horizon_days: horizon,
          outcome: en([
            "survived",
            "followup",
            "substantially_rewritten",
            "reverted"
          ]),
          cell
        })
      ),
      risk_ratios: section(
        obj({
          horizon_days: horizon,
          feature: en(Object.keys(REPORT_FEATURE_BUCKETS)),
          bucket: en([
            ...REPORT_FEATURE_BUCKETS.tests_changed,
            ...REPORT_FEATURE_BUCKETS.files_touched_bucket,
            ...REPORT_FEATURE_BUCKETS.loc_touched
          ]),
          rework_rate: cell,
          baseline_rate: cell,
          ratio: cell
        })
      ),
      survival_by_model: section(
        obj({ horizon_days: horizon, model_id: modelId, cell })
      ),
      survival_by_harness: section(
        obj({ horizon_days: horizon, harness_id: id, cell })
      ),
      cost_adjusted_survival_by_model: section(
        obj({
          horizon_days: horizon,
          model_id: modelId,
          cost_basis: { const: "actual" },
          cell
        })
      )
    }),
    retrospective: nullable(
      obj({
        basis: { const: "out_of_sample_prediction" },
        horizon_days: horizon,
        threshold: num(0, 1),
        calibration: en(["portable", "repo_calibrated"]),
        n_reworked: int(),
        precision: cell,
        recall: cell,
        flagged_share: cell,
        suppressed: { type: "boolean" },
        suppression_reasons: reasons
      })
    ),
    cost: nullable(
      obj({
        actual: obj({
          basis: { const: "descriptive" },
          total_usd: nullable(num()),
          cost_source: { const: "provider_reported" },
          coverage: costCoverage,
          prs_priced: int(),
          prs_unknown: int(),
          suppressed: { type: "boolean" },
          suppression_reasons: reasons
        }),
        estimated: obj({
          basis: { const: "descriptive" },
          kind: { const: "estimate" },
          total_usd: nullable(num()),
          cost_source: { const: "local_estimate" },
          pricing_revision: nullable(id),
          pricing_timestamp: nullable(timestamp),
          coverage: costCoverage,
          prs_priced: int(),
          prs_unknown: int(),
          unpriced_models: int(),
          suppressed: { type: "boolean" },
          suppression_reasons: reasons
        })
      })
    ),
    model_provenance: nullable(
      obj({
        head_id: id,
        head_version: semver,
        trained_on: id,
        training_repo_count: int(),
        split: en(["time_split", "leave_repo_out"]),
        split_date: date,
        repo_in_training_set: { type: "boolean" },
        trained_at: timestamp
      })
    ),
    eligibility: obj({
      exact_model_table: { type: "boolean" },
      harness_table: { type: "boolean" },
      cost_adjusted_by_model: { type: "boolean" },
      retrospective: { type: "boolean" },
      model_routing_cta: { type: "boolean" },
      reasons
    })
  }),
  $defs: { candidateFeatures: featureSchema }
});
function structural(schema, value, path2, errors, root) {
  const fail2 = (code, message) => errors.push({ path: path2 || "$", code, message });
  if ("$ref" in schema) {
    const name = String(schema.$ref).split("/").at(-1);
    structural(
      root.$defs[name],
      value,
      path2,
      errors,
      root
    );
    return;
  }
  if ("anyOf" in schema) {
    if (!schema.anyOf.some((s) => {
      const e = [];
      structural(s, value, path2, e, root);
      return e.length === 0;
    }))
      fail2("invalid_type", "No allowed shape matched.");
    return;
  }
  if ("const" in schema && value !== schema.const)
    fail2("invalid_value", "Unexpected constant.");
  if ("enum" in schema && !schema.enum.includes(value))
    fail2("invalid_value", "Unexpected enum value.");
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail2("invalid_type", "Expected object.");
      return;
    }
    const object = value, props = schema.properties;
    for (const key of Object.keys(object))
      if (!(key in props))
        errors.push({
          path: path2 ? `${path2}.${key}` : key,
          code: "invalid_value",
          message: "Unknown key."
        });
    for (const key of schema.required)
      if (!(key in object))
        errors.push({
          path: path2 ? `${path2}.${key}` : key,
          code: "required",
          message: "Field is required."
        });
    for (const [key, s] of Object.entries(props))
      if (key in object)
        structural(s, object[key], path2 ? `${path2}.${key}` : key, errors, root);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      fail2("invalid_type", "Expected array.");
      return;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      fail2("invalid_value", "Too many items.");
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      fail2("invalid_value", "Too few items.");
    if (schema.uniqueItems === true && new Set(value).size !== value.length)
      fail2("invalid_value", "Duplicate items.");
    value.forEach(
      (v, i) => structural(schema.items, v, `${path2}[${i}]`, errors, root)
    );
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      fail2("invalid_type", "Expected string.");
      return;
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      fail2("invalid_value", "String does not match pattern.");
    if (schema.not && schema.not.enum.includes(value))
      fail2("invalid_value", "Reserved value.");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || schema.type === "integer" && !Number.isInteger(value)) {
      fail2("invalid_type", "Expected finite number.");
      return;
    }
    if (typeof schema.minimum === "number" && value < schema.minimum || typeof schema.maximum === "number" && value > schema.maximum)
      fail2("invalid_value", "Number out of bounds.");
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    fail2("invalid_type", "Expected boolean.");
  else if (schema.type === "null" && value !== null)
    fail2("invalid_type", "Expected null.");
}
function invariant(report) {
  const errors = [];
  const add = (code, path2) => errors.push({ code: "invalid_value", path: path2, message: code });
  if (report.scan.horizons_days.some(
    (horizon2, index) => index > 0 && horizon2 <= report.scan.horizons_days[index - 1]
  ))
    add("horizons_not_ascending", "scan.horizons_days");
  const checkCell = (c, path2, basis2) => {
    if (c.suppressed && (c.value !== null || c.ci !== null || !c.suppression_reasons.length))
      add("suppressed_cell_has_value", path2);
    if (!c.suppressed && (c.value === null || c.suppression_reasons.length))
      add("shown_cell_missing_value", path2);
    if (c.ci && c.value !== null && !(c.ci.low <= c.value && c.value <= c.ci.high))
      add("ci_out_of_order", path2);
    if (basis2 && c.basis !== basis2)
      add("descriptive_section_with_prediction_cell", path2);
    if (c.basis === "out_of_sample_prediction" && !report.model_provenance)
      add("prediction_without_provenance", path2);
  };
  const sections = report.aggregates;
  for (const [name, s] of Object.entries(sections)) {
    if (s.basis === "out_of_sample_prediction" && !report.model_provenance)
      add("prediction_without_provenance", `aggregates.${name}`);
    if (s.status === "suppressed" && !s.suppression_reasons.length)
      add("section_status_mismatch", `aggregates.${name}`);
    s.rows.forEach((row, i) => {
      for (const [k, v] of Object.entries(row))
        if (k === "cell" || k.endsWith("_rate") || k === "ratio") {
          const c = v;
          checkCell(c, `aggregates.${name}.rows[${i}].${k}`, s.basis);
          if (s.status === "suppressed" && !c.suppressed)
            add(
              "section_status_mismatch",
              `aggregates.${name}.rows[${i}].${k}`
            );
        }
      if (typeof row.horizon_days === "number" && !report.scan.horizons_days.includes(row.horizon_days))
        add(
          "horizon_not_declared",
          `aggregates.${name}.rows[${i}].horizon_days`
        );
    });
  }
  report.aggregates.risk_ratios.rows.forEach((row, index) => {
    const allowed = REPORT_FEATURE_BUCKETS[row.feature];
    if (!allowed || !allowed.includes(row.bucket))
      add(
        "feature_bucket_mismatch",
        `aggregates.risk_ratios.rows[${index}].bucket`
      );
  });
  if (report.eligibility.model_routing_cta && !report.eligibility.exact_model_table)
    add("cta_without_exact_model", "eligibility.model_routing_cta");
  for (const [flag, name] of [
    ["exact_model_table", "survival_by_model"],
    ["harness_table", "survival_by_harness"],
    ["cost_adjusted_by_model", "cost_adjusted_survival_by_model"]
  ])
    if (!report.eligibility[flag] && report.aggregates[name].status === "shown")
      add("model_table_ineligible_but_shown", `aggregates.${name}`);
  if (report.eligibility.cost_adjusted_by_model && (!report.cost || report.cost.actual.suppressed))
    add(
      "cost_adjusted_needs_actual_cost",
      "eligibility.cost_adjusted_by_model"
    );
  if (report.prs.length !== report.coverage.prs_enumerated || report.coverage.attribution.agent.identified_agent + report.coverage.attribution.agent.identified_human_signal + report.coverage.attribution.agent.unknown !== report.coverage.prs_enumerated || report.coverage.attribution.harness.identified + report.coverage.attribution.harness.unknown !== report.coverage.prs_enumerated || report.coverage.attribution.exact_model.identified + report.coverage.attribution.exact_model.unknown !== report.coverage.prs_enumerated)
    add("coverage_sum_mismatch", "coverage");
  report.prs.forEach((pr, i) => {
    if (pr.prediction && !report.model_provenance)
      add("prediction_without_provenance", `prs[${i}].prediction`);
    if (pr.labels.length !== report.scan.horizons_days.length || new Set(pr.labels.map((l) => l.horizon_days)).size !== report.scan.horizons_days.length || pr.labels.some((l) => !report.scan.horizons_days.includes(l.horizon_days)))
      add("labels_horizon_mismatch", `prs[${i}].labels`);
    pr.labels.forEach((l, j) => {
      if (!report.scan.horizons_days.includes(l.horizon_days))
        add("horizon_not_declared", `prs[${i}].labels[${j}].horizon_days`);
      if (l.outcome.report_outcome !== deriveReportOutcome(l.outcome))
        add(
          "label_outcome_inconsistent",
          `prs[${i}].labels[${j}].outcome.report_outcome`
        );
    });
  });
  if (report.retrospective) {
    if (!report.model_provenance)
      add("prediction_without_provenance", "retrospective");
    for (const k of ["precision", "recall", "flagged_share"])
      checkCell(
        report.retrospective[k],
        `retrospective.${k}`,
        report.retrospective.basis
      );
    if (!report.eligibility.retrospective && !report.retrospective.suppressed)
      add("model_table_ineligible_but_shown", "retrospective");
  }
  return errors;
}
function validateArbiterReportV1(input) {
  try {
    const errors = [];
    structural(
      ARBITER_REPORT_V1_JSON_SCHEMA,
      input,
      "",
      errors,
      ARBITER_REPORT_V1_JSON_SCHEMA
    );
    if (errors.length) return { ok: false, errors };
    const report = input;
    return errors.push(...invariant(report)), errors.length ? { ok: false, errors } : { ok: true, value: report };
  } catch {
    return {
      ok: false,
      errors: [
        { path: "$", code: "invalid_value", message: "Malformed report." }
      ]
    };
  }
}

// ../core/src/arbiter-shadow-record.ts
var ARBITER_SHADOW_SCORE_SCHEMA_VERSION = "arbiter_shadow_score/v1";
var ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION = "arbiter_shadow_outcome/v1";
var ARBITER_SHADOW_STATE_SCHEMA_VERSION = "arbiter_shadow_state/v1";
var ARBITER_SHADOW_RUN_STATUSES = ["ok", "partial", "error"];
var ARBITER_SHADOW_ERROR_CODES = [
  "INVALID_ARG",
  "NOT_A_GIT_REPO",
  "SHALLOW_CLONE",
  "DATA_DIR_UNWRITABLE",
  "STATE_CORRUPT",
  "CURSOR_RESET",
  "EXTRACT_FAILED",
  "LABEL_FAILED",
  "INVALID_ROW",
  "INTERNAL"
];
var ARBITER_SHADOW_FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  // Core raw-content names
  "rawTaskText",
  "rawCode",
  "rawLog",
  "prompt",
  "rawPrompt",
  "rawContent",
  // Additional forbidden keys for shadow mode
  "diff",
  "patch",
  "body",
  "title",
  "commit_message",
  "author_email",
  "author_name",
  "line_ranges",
  "path"
]);
function fieldError2(path2, message, code) {
  return { path: path2, message, code };
}
function isPlainObject2(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function findForbiddenKeys(obj2, path2 = "$") {
  const errors = [];
  if (!isPlainObject2(obj2)) {
    return errors;
  }
  for (const [key, value] of Object.entries(obj2)) {
    if (ARBITER_SHADOW_FORBIDDEN_KEYS.has(key)) {
      errors.push(fieldError2(path2 === "$" ? key : `${path2}.${key}`, `Forbidden key.`, "invalid_value"));
    }
    if (isPlainObject2(value)) {
      errors.push(...findForbiddenKeys(value, path2 === "$" ? key : `${path2}.${key}`));
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isPlainObject2(item)) {
          errors.push(...findForbiddenKeys(item, `${path2 === "$" ? key : `${path2}.${key}`}[${i}]`));
        }
      }
    }
  }
  return errors;
}
function validateShadowScoreRow(input) {
  const errors = [];
  if (!isPlainObject2(input)) {
    return {
      ok: false,
      errors: [fieldError2("$", "Score row must be a plain object.", "invalid_type")]
    };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "repo",
    "pr_number",
    "merge_sha",
    "merged_at",
    "scored_at",
    "scorer_id",
    "scorer_version",
    "score",
    "threshold",
    "would_flag",
    "features"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError2(key, `Unknown field.`, "invalid_value"));
    }
  }
  if (!("schema_version" in input)) {
    errors.push(fieldError2("schema_version", "Field is required.", "required"));
  } else if (input.schema_version !== ARBITER_SHADOW_SCORE_SCHEMA_VERSION) {
    errors.push(
      fieldError2(
        "schema_version",
        `Expected "${ARBITER_SHADOW_SCORE_SCHEMA_VERSION}".`,
        typeof input.schema_version === "string" ? "invalid_value" : "invalid_type"
      )
    );
  }
  if (!("repo" in input)) {
    errors.push(fieldError2("repo", "Field is required.", "required"));
  } else if (typeof input.repo !== "string" || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError2("repo", 'Must be "owner/name".', "invalid_value"));
  }
  if (!("pr_number" in input)) {
    errors.push(fieldError2("pr_number", "Field is required.", "required"));
  } else if (input.pr_number !== null && typeof input.pr_number === "number") {
    if (!Number.isInteger(input.pr_number) || input.pr_number <= 0) {
      errors.push(fieldError2("pr_number", "Must be an integer > 0 or null.", "invalid_value"));
    }
  } else if (input.pr_number !== null) {
    errors.push(fieldError2("pr_number", "Must be an integer > 0 or null.", "invalid_value"));
  }
  if (!("merge_sha" in input)) {
    errors.push(fieldError2("merge_sha", "Field is required.", "required"));
  } else if (typeof input.merge_sha !== "string" || !/^[0-9a-f]{40}$/.test(input.merge_sha)) {
    errors.push(fieldError2("merge_sha", "Must be 40 lowercase hex characters.", "invalid_value"));
  }
  if (!("merged_at" in input)) {
    errors.push(fieldError2("merged_at", "Field is required.", "required"));
  } else if (typeof input.merged_at === "string" && Number.isNaN(Date.parse(input.merged_at))) {
    errors.push(fieldError2("merged_at", "Must be valid ISO 8601 date.", "invalid_value"));
  } else if (typeof input.merged_at !== "string") {
    errors.push(fieldError2("merged_at", "Must be valid ISO 8601 date.", "invalid_value"));
  }
  if (!("scored_at" in input)) {
    errors.push(fieldError2("scored_at", "Field is required.", "required"));
  } else if (typeof input.scored_at === "string" && Number.isNaN(Date.parse(input.scored_at))) {
    errors.push(fieldError2("scored_at", "Must be valid ISO 8601 date.", "invalid_value"));
  } else if (typeof input.scored_at !== "string") {
    errors.push(fieldError2("scored_at", "Must be valid ISO 8601 date.", "invalid_value"));
  }
  if (!("scorer_id" in input)) {
    errors.push(fieldError2("scorer_id", "Field is required.", "required"));
  } else if (typeof input.scorer_id !== "string" || input.scorer_id === "") {
    errors.push(fieldError2("scorer_id", "Must be a non-empty string.", "invalid_value"));
  }
  if (!("scorer_version" in input)) {
    errors.push(fieldError2("scorer_version", "Field is required.", "required"));
  } else if (typeof input.scorer_version !== "string" || input.scorer_version === "") {
    errors.push(fieldError2("scorer_version", "Must be a non-empty string.", "invalid_value"));
  }
  if (!("score" in input)) {
    errors.push(fieldError2("score", "Field is required.", "required"));
  } else if (typeof input.score !== "number" || !Number.isFinite(input.score) || input.score < 0 || input.score > 1) {
    errors.push(fieldError2("score", "Must be a finite number in [0, 1].", "invalid_value"));
  }
  if (!("threshold" in input)) {
    errors.push(fieldError2("threshold", "Field is required.", "required"));
  } else if (typeof input.threshold !== "number" || !Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 1) {
    errors.push(fieldError2("threshold", "Must be a finite number in [0, 1].", "invalid_value"));
  }
  if (!("would_flag" in input)) {
    errors.push(fieldError2("would_flag", "Field is required.", "required"));
  } else if (typeof input.would_flag !== "boolean") {
    errors.push(fieldError2("would_flag", "Must be a boolean.", "invalid_value"));
  } else if ("score" in input && "threshold" in input && typeof input.score === "number" && typeof input.threshold === "number" && Number.isFinite(input.score) && Number.isFinite(input.threshold)) {
    const expectedFlag = input.score < input.threshold;
    if (input.would_flag !== expectedFlag) {
      errors.push(
        fieldError2(
          "would_flag",
          `Must be ${expectedFlag} (score ${input.score.toFixed(3)} < threshold ${input.threshold.toFixed(3)}).`,
          "invalid_value"
        )
      );
    }
  }
  if (!("features" in input)) {
    errors.push(fieldError2("features", "Field is required.", "required"));
  } else {
    const featResult = validateCandidateFeaturesV1(input.features);
    if (!featResult.ok) {
      errors.push(...featResult.errors.map((e) => ({ ...e, path: `features.${e.path}` })));
    }
  }
  errors.push(...findForbiddenKeys(input));
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}
function validateShadowOutcomeRow(input) {
  const errors = [];
  if (!isPlainObject2(input)) {
    return {
      ok: false,
      errors: [fieldError2("$", "Outcome row must be a plain object.", "invalid_type")]
    };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "repo",
    "pr_number",
    "merge_sha",
    "horizon_days",
    "labelled_at",
    "survived",
    "label"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError2(key, `Unknown field.`, "invalid_value"));
    }
  }
  if (!("schema_version" in input)) {
    errors.push(fieldError2("schema_version", "Field is required.", "required"));
  } else if (input.schema_version !== ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION) {
    errors.push(
      fieldError2(
        "schema_version",
        `Expected "${ARBITER_SHADOW_OUTCOME_SCHEMA_VERSION}".`,
        typeof input.schema_version === "string" ? "invalid_value" : "invalid_type"
      )
    );
  }
  if (!("repo" in input)) {
    errors.push(fieldError2("repo", "Field is required.", "required"));
  } else if (typeof input.repo !== "string" || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError2("repo", 'Must be "owner/name".', "invalid_value"));
  }
  if (!("pr_number" in input)) {
    errors.push(fieldError2("pr_number", "Field is required.", "required"));
  } else if (input.pr_number !== null && typeof input.pr_number === "number") {
    if (!Number.isInteger(input.pr_number) || input.pr_number <= 0) {
      errors.push(fieldError2("pr_number", "Must be an integer > 0 or null.", "invalid_value"));
    }
  } else if (input.pr_number !== null) {
    errors.push(fieldError2("pr_number", "Must be an integer > 0 or null.", "invalid_value"));
  }
  if (!("merge_sha" in input)) {
    errors.push(fieldError2("merge_sha", "Field is required.", "required"));
  } else if (typeof input.merge_sha !== "string" || !/^[0-9a-f]{40}$/.test(input.merge_sha)) {
    errors.push(fieldError2("merge_sha", "Must be 40 lowercase hex characters.", "invalid_value"));
  }
  if (!("horizon_days" in input)) {
    errors.push(fieldError2("horizon_days", "Field is required.", "required"));
  } else if (!HORIZONS.includes(input.horizon_days)) {
    errors.push(fieldError2("horizon_days", `Must be one of ${HORIZONS.join(", ")}.`, "invalid_value"));
  }
  if (!("labelled_at" in input)) {
    errors.push(fieldError2("labelled_at", "Field is required.", "required"));
  } else if (typeof input.labelled_at === "string" && Number.isNaN(Date.parse(input.labelled_at))) {
    errors.push(fieldError2("labelled_at", "Must be valid ISO 8601 date.", "invalid_value"));
  } else if (typeof input.labelled_at !== "string") {
    errors.push(fieldError2("labelled_at", "Must be valid ISO 8601 date.", "invalid_value"));
  }
  if (!("survived" in input)) {
    errors.push(fieldError2("survived", "Field is required.", "required"));
  } else if (typeof input.survived !== "boolean" && input.survived !== null) {
    errors.push(fieldError2("survived", "Must be a boolean or null.", "invalid_value"));
  }
  if (!("label" in input)) {
    errors.push(fieldError2("label", "Field is required.", "required"));
  } else if (isPlainObject2(input.label)) {
    if (input.label.schema_version !== ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION) {
      errors.push(
        fieldError2(
          "label.schema_version",
          `Expected "${ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION}".`,
          "invalid_value"
        )
      );
    }
    if (input.label.horizon_days !== input.horizon_days) {
      errors.push(fieldError2("label.horizon_days", "Must match row horizon_days.", "invalid_value"));
    }
    if (isPlainObject2(input.label.envelope)) {
      if (input.label.envelope.merge_sha !== input.merge_sha) {
        errors.push(fieldError2("label.envelope.merge_sha", "Must match row merge_sha.", "invalid_value"));
      }
    }
    if (isPlainObject2(input.label.outcome)) {
      if (input.label.outcome.survived !== input.survived) {
        errors.push(fieldError2("label.outcome.survived", "Must match row survived.", "invalid_value"));
      }
      if (!Array.isArray(input.label.outcome.reason_codes) || input.label.outcome.reason_codes.length === 0) {
        errors.push(fieldError2("label.outcome.reason_codes", "Must be a non-empty array.", "invalid_value"));
      }
    }
  } else {
    errors.push(fieldError2("label", "Must be an object.", "invalid_type"));
  }
  errors.push(...findForbiddenKeys(input));
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}
function validateShadowState(input) {
  const errors = [];
  if (!isPlainObject2(input)) {
    return {
      ok: false,
      errors: [fieldError2("$", "State must be a plain object.", "invalid_type")]
    };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "repo",
    "last_seen_merge_sha",
    "last_run_at",
    "last_run_status",
    "last_error_code",
    "scorer_id",
    "scorer_version"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      errors.push(fieldError2(key, `Unknown field.`, "invalid_value"));
    }
  }
  if (!("schema_version" in input)) {
    errors.push(fieldError2("schema_version", "Field is required.", "required"));
  } else if (input.schema_version !== ARBITER_SHADOW_STATE_SCHEMA_VERSION) {
    errors.push(
      fieldError2(
        "schema_version",
        `Expected "${ARBITER_SHADOW_STATE_SCHEMA_VERSION}".`,
        typeof input.schema_version === "string" ? "invalid_value" : "invalid_type"
      )
    );
  }
  if (!("repo" in input)) {
    errors.push(fieldError2("repo", "Field is required.", "required"));
  } else if (typeof input.repo !== "string" || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.repo)) {
    errors.push(fieldError2("repo", 'Must be "owner/name".', "invalid_value"));
  }
  if (!("last_seen_merge_sha" in input)) {
    errors.push(fieldError2("last_seen_merge_sha", "Field is required.", "required"));
  } else if (input.last_seen_merge_sha !== null) {
    if (typeof input.last_seen_merge_sha !== "string" || !/^[0-9a-f]{40}$/.test(input.last_seen_merge_sha)) {
      errors.push(fieldError2("last_seen_merge_sha", "Must be 40 lowercase hex or null.", "invalid_value"));
    }
  }
  if (!("last_run_at" in input)) {
    errors.push(fieldError2("last_run_at", "Field is required.", "required"));
  } else if (input.last_run_at !== null) {
    if (typeof input.last_run_at !== "string" || Number.isNaN(Date.parse(input.last_run_at))) {
      errors.push(fieldError2("last_run_at", "Must be valid ISO 8601 date or null.", "invalid_value"));
    }
  }
  if (!("last_run_status" in input)) {
    errors.push(fieldError2("last_run_status", "Field is required.", "required"));
  } else if (typeof input.last_run_status === "string" && !ARBITER_SHADOW_RUN_STATUSES.includes(input.last_run_status)) {
    errors.push(fieldError2("last_run_status", `Must be one of ${ARBITER_SHADOW_RUN_STATUSES.join(", ")}.`, "invalid_value"));
  } else if (typeof input.last_run_status !== "string") {
    errors.push(fieldError2("last_run_status", `Must be one of ${ARBITER_SHADOW_RUN_STATUSES.join(", ")}.`, "invalid_value"));
  }
  if (!("last_error_code" in input)) {
    errors.push(fieldError2("last_error_code", "Field is required.", "required"));
  } else if (input.last_error_code !== null && typeof input.last_error_code === "string") {
    if (!ARBITER_SHADOW_ERROR_CODES.includes(input.last_error_code)) {
      errors.push(
        fieldError2(
          "last_error_code",
          `Must be one of ${ARBITER_SHADOW_ERROR_CODES.join(", ")} or null.`,
          "invalid_value"
        )
      );
    }
  } else if (input.last_error_code !== null) {
    errors.push(
      fieldError2(
        "last_error_code",
        `Must be one of ${ARBITER_SHADOW_ERROR_CODES.join(", ")} or null.`,
        "invalid_value"
      )
    );
  }
  if (!("scorer_id" in input)) {
    errors.push(fieldError2("scorer_id", "Field is required.", "required"));
  } else if (typeof input.scorer_id !== "string" || input.scorer_id === "") {
    errors.push(fieldError2("scorer_id", "Must be a non-empty string.", "invalid_value"));
  }
  if (!("scorer_version" in input)) {
    errors.push(fieldError2("scorer_version", "Field is required.", "required"));
  } else if (typeof input.scorer_version !== "string" || input.scorer_version === "") {
    errors.push(fieldError2("scorer_version", "Must be a non-empty string.", "invalid_value"));
  }
  return errors.length === 0 ? { ok: true, value: input } : { ok: false, errors };
}
function initialShadowState(repo, scorerId, scorerVersion) {
  return {
    schema_version: ARBITER_SHADOW_STATE_SCHEMA_VERSION,
    repo,
    last_seen_merge_sha: null,
    last_run_at: null,
    last_run_status: "ok",
    last_error_code: null,
    scorer_id: scorerId,
    scorer_version: scorerVersion
  };
}

// ../core/src/task-descriptor-schema.ts
var HOKUSAI_TASK_DESCRIPTOR_V1_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.hokus.ai/hokusai_task_descriptor.v1.json",
  title: "Hokusai task descriptor v1",
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    CANDIDATE_FEATURE_INTENT_FIELDS.map((name) => [
      name,
      candidateFeatureValueJsonSchema(name, false)
    ])
  )
});

// ../core/src/task-descriptor.ts
var REASONING_DEPTH_COMPLEXITY = {
  shallow: 3,
  standard: 5,
  deep: 8
};
var COMPLEXITY_ALIASES = {
  low: 3,
  small: 3,
  medium: 5,
  moderate: 5,
  high: 8,
  large: 8,
  very_high: 10,
  ...REASONING_DEPTH_COMPLEXITY
};
function normalizeComplexity(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : void 0;
  }
  if (typeof value !== "string") {
    return void 0;
  }
  const normalized2 = value.trim().toLowerCase();
  if (normalized2.length === 0) {
    return void 0;
  }
  const alias = COMPLEXITY_ALIASES[normalized2];
  if (alias !== void 0) {
    return alias;
  }
  const parsed = Number(normalized2);
  return Number.isFinite(parsed) ? parsed : void 0;
}
var HOKUSAI_LANGUAGE_BY_LABEL = {
  python: "python",
  typescript: "typescript",
  javascript: "javascript",
  go: "go",
  rust: "rust",
  java: "java",
  shell: "bash",
  bash: "bash"
};
function normalizeHokusaiLanguage(label2) {
  if (typeof label2 !== "string") {
    return "unknown";
  }
  return HOKUSAI_LANGUAGE_BY_LABEL[label2.trim().toLowerCase()] ?? "unknown";
}
var TASK_FAMILY_TO_HOKUSAI_TYPE = {
  bugfix: "bugfix",
  feature: "feature",
  migration: "migration",
  refactor: "refactor",
  test: "tests",
  docs: "docs",
  infra: "infra",
  chore: "infra",
  mixed: "unknown",
  investigation: "unknown"
};
function dominantLanguage(extensionCounts) {
  let bestExtension;
  let bestCount = 0;
  for (const [extension, count] of Object.entries(extensionCounts)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    if (count > bestCount || count === bestCount && (bestExtension === void 0 || extension < bestExtension)) {
      bestExtension = extension;
      bestCount = count;
    }
  }
  if (bestExtension === void 0) {
    return void 0;
  }
  return summarizeLanguageSignals({ [bestExtension]: bestCount })[0];
}
function deriveTaskDescriptor(input) {
  const derived = {};
  const taskText = input.taskText?.trim();
  if (taskText && taskText.length > 0) {
    derived.task_type = TASK_FAMILY_TO_HOKUSAI_TYPE[classifyTaskFamily({ text: taskText })];
    derived.complexity = REASONING_DEPTH_COMPLEXITY[inferReasoningDepth({ text: taskText })];
  }
  const repoSizeBucket = bucketRepositoryScale(
    input.repositorySignals?.fileCount
  );
  if (repoSizeBucket) {
    derived.repo_size_bucket = repoSizeBucket;
  }
  const extensionCounts = input.repositorySignals?.extensionCounts;
  if (extensionCounts) {
    const dominant = dominantLanguage(extensionCounts);
    if (dominant) {
      derived.language = normalizeHokusaiLanguage(dominant);
    }
  }
  return derived;
}

// ../core/src/pricing.ts
var ANTHROPIC_MODEL_PRICING = {
  "claude-fable-5": { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  "claude-opus-4-8": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  "claude-opus-4-7": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  "claude-opus-4-6": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  "claude-sonnet-5": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-sonnet-4-6": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-haiku-4-5": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 }
};
var OPENAI_MODEL_PRICING = {
  "gpt-5.5": { inputPerMTokUsd: 5, outputPerMTokUsd: 30 },
  "gpt-5": { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  "gpt-5-mini": { inputPerMTokUsd: 0.25, outputPerMTokUsd: 2 },
  "gpt-5-codex": { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  "codex-mini-latest": { inputPerMTokUsd: 1.5, outputPerMTokUsd: 6 },
  "gpt-4o": { inputPerMTokUsd: 2.5, outputPerMTokUsd: 10 },
  "gpt-4o-mini": { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6 },
  "gpt-4.1": { inputPerMTokUsd: 2, outputPerMTokUsd: 8 },
  "gpt-4.1-mini": { inputPerMTokUsd: 0.4, outputPerMTokUsd: 1.6 },
  "gpt-4-turbo": { inputPerMTokUsd: 10, outputPerMTokUsd: 30 },
  o1: { inputPerMTokUsd: 15, outputPerMTokUsd: 60 },
  "o1-mini": { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
  o3: { inputPerMTokUsd: 2, outputPerMTokUsd: 8 },
  "o3-mini": { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 },
  "o4-mini": { inputPerMTokUsd: 1.1, outputPerMTokUsd: 4.4 }
};
var GOOGLE_MODEL_PRICING = {
  "gemini-2.5-pro": { inputPerMTokUsd: 1.25, outputPerMTokUsd: 10 },
  "gemini-2.5-flash": { inputPerMTokUsd: 0.3, outputPerMTokUsd: 2.5 },
  "gemini-2.0-flash": { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.4 },
  "gemini-2.0-flash-001": { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.4 }
};
var MODEL_PRICING = {
  ...ANTHROPIC_MODEL_PRICING,
  ...OPENAI_MODEL_PRICING,
  ...GOOGLE_MODEL_PRICING
};
var MODEL_PRICING_AS_OF = "2026-07-15";

// ../core/src/session-usage.ts
var DEFAULT_SIDECAR_FRESHNESS_MS = 24 * 60 * 60 * 1e3;

// ../core/src/fixtures/arbiter-survival-label.ts
var SHA_PR_HEAD = "a".repeat(40);
var SHA_BASE = "b".repeat(40);
var SHA_MERGE = "c".repeat(40);
var SHA_TERMINAL = "d".repeat(40);
function survivalLabelFixtureLineRanges() {
  return [
    {
      path: "src/module.ts",
      old: { start: 10, end: 24, sha: SHA_BASE },
      new: { start: 10, end: 30, sha: SHA_PR_HEAD }
    },
    {
      path: "src/new-file.ts",
      old: null,
      new: { start: 1, end: 42, sha: SHA_PR_HEAD }
    }
  ];
}
var harvestedSurvivalLabelFixture = buildArbiterSurvivalLabel({
  prUrl: "https://github.com/example-org/example-repo/pull/123",
  horizon_days: 30,
  label_provenance: "harvested",
  line_ranges: survivalLabelFixtureLineRanges(),
  outcome: {
    survived: true,
    survival_ratio: 1,
    reverted: false,
    undone_by: null,
    followup: false,
    reason_codes: ["no_evidence"]
  },
  envelope: {
    labeller_version: "0.1.0",
    normalization_version: "1.0.0",
    pr_head_sha: SHA_PR_HEAD,
    merge_sha: SHA_MERGE,
    horizon_terminal_sha: SHA_TERMINAL,
    integration_branch: "auto/integration",
    computed_at: "2026-09-08T00:00:00Z"
  }
});
var ownerCorrectedSurvivalLabelFixture = buildArbiterSurvivalLabel({
  prUrl: "https://github.com/example-org/example-repo/pull/123",
  horizon_days: 30,
  label_provenance: "owner_corrected",
  line_ranges: survivalLabelFixtureLineRanges(),
  outcome: {
    survived: false,
    survival_ratio: 0.6,
    reverted: false,
    undone_by: "human",
    followup: true,
    reason_codes: ["line_range_followup"]
  },
  envelope: {
    labeller_version: "0.1.0",
    normalization_version: "1.0.0",
    pr_head_sha: SHA_PR_HEAD,
    merge_sha: SHA_MERGE,
    horizon_terminal_sha: SHA_TERMINAL,
    integration_branch: "auto/integration",
    computed_at: "2026-09-09T12:00:00Z"
  },
  owner_correction: {
    supersedes: {
      schema_version: "1.0.0",
      computed_at: "2026-09-08T00:00:00Z",
      label_hash: canonicalHash(harvestedSurvivalLabelFixture)
    },
    correction: {
      reason_code: "owner_dispute",
      corrected_by: "owner:example",
      corrected_at: "2026-09-09T12:00:00Z",
      previous_report_outcome: "survived",
      note: "Follow-up PR #130 rewrote the labelled ranges; the harvested label missed it."
    }
  }
});

// ../core/src/fixtures/candidate-features.ts
var completeCandidateFeaturesV1Fixture = finalizeCandidateFeaturesV1({
  files_touched: 4,
  lines_added: 80,
  lines_deleted: 12,
  loc_touched: 92,
  dependency_depth: 2,
  module_hotspot_score: 37.5,
  diff_uncertain: false,
  type_errors: 0,
  lint_errors: 0,
  build_ok: true,
  complexity_delta: -1.25,
  tests_changed: true,
  test_pass_rate: 1,
  test_runtime_seconds: 12.4,
  task_type: "feature",
  language: "typescript",
  domain: "backend",
  complexity: 5,
  repo_size_bucket: "medium",
  files_touched_bucket: "2_5",
  description_length_bucket: "medium",
  is_greenfield: false,
  is_migration: false,
  requires_tests: true,
  cross_service: false,
  ui_heavy: false,
  risk_level: "medium",
  touched_out_of_scope_files: 0,
  human_intervention_count: 0,
  review_rounds: 1,
  change_requests: 0,
  self_review_iterations: 1,
  agent_iterations: 3
});
var sparseCandidateFeaturesV1Fixture = finalizeCandidateFeaturesV1({
  files_touched: 1,
  lines_added: 0,
  lines_deleted: 0,
  loc_touched: 0,
  diff_uncertain: true
});
var observedZeroCandidateFeaturesV1Fixture = finalizeCandidateFeaturesV1({
  files_touched: 0,
  lines_added: 0,
  lines_deleted: 0,
  loc_touched: 0,
  diff_uncertain: false,
  type_errors: 0,
  lint_errors: 0,
  build_ok: false,
  complexity_delta: 0,
  tests_changed: false,
  test_pass_rate: 0,
  test_runtime_seconds: 0,
  touched_out_of_scope_files: 0,
  human_intervention_count: 0,
  review_rounds: 0,
  change_requests: 0,
  self_review_iterations: 0,
  agent_iterations: 0
});

// ../core/src/task-cost/schema-version.ts
var TASK_COST_EVENT_SCHEMA_VERSION = "task_cost_event/v1";
var TASK_COST_SUMMARY_SCHEMA_VERSION = "task_cost_summary/v1";
var TASK_COST_LEDGER_SCHEMA_VERSION = "task_cost_ledger/v1";
var PROVIDER_CONTRACT_VERSIONS = Object.freeze({
  "claude-code": "claude-code/1",
  codex: "codex/2",
  native: "native/1",
  pi: "pi/1"
});

// ../core/src/task-cost/token-usage.ts
var TASK_COST_TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens"
];
function deriveUsageAvailability(usage) {
  const values = TASK_COST_TOKEN_FIELDS.map((field) => usage[field]);
  if (values.every((value) => value === null)) return "unavailable";
  if (values.some((value) => value === null)) return "partial";
  return values.every((value) => value === 0) ? "known_zero" : "available";
}

// ../core/src/task-cost/validators.ts
var TaskCostValidationError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "TaskCostValidationError";
    this.code = code;
  }
};
var TASK_COST_FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  // Shared with contribution rows.
  "prompt",
  "messages",
  "tasktext",
  "rawinput",
  "evalrecord",
  "originalprompt",
  "description",
  "issuebody",
  // Transcript / content.
  "transcript",
  "content",
  "text",
  "prompthash",
  // Filesystem and repository locations.
  "path",
  "filepath",
  "cwd",
  "directory",
  "dir",
  "repo",
  "repository",
  "workspace",
  "worktree",
  "branch",
  // Credentials and identity.
  "token",
  "apikey",
  "secret",
  "password",
  "credentials",
  "authorization",
  "email",
  "accountid",
  "userid",
  "username",
  "hostname"
]);
function normalizeKey(key) {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}
function assertNoForbiddenKeys(value, path2 = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, [...path2, String(index)]);
    }
    return;
  }
  if (!isPlainObject3(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (TASK_COST_FORBIDDEN_KEYS.has(normalizeKey(key))) {
      throw new TaskCostValidationError(
        "forbidden_field",
        `Forbidden field at ${[...path2, key].join(".")}`
      );
    }
    assertNoForbiddenKeys(child, [...path2, key]);
  }
}
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
var VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
var PROVIDER_CONTRACT_PATTERN = /^[a-z][a-z0-9-]{0,31}\/[0-9]{1,4}$/;
var TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;
function isPlainObject3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function fail(message, code = "schema_validation_failed") {
  throw new TaskCostValidationError(code, message);
}
function requireObject(value, label2) {
  if (!isPlainObject3(value)) fail(`${label2} must be an object`);
  return value;
}
function requireEnum(value, allowed, label2) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label2} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function requireId(value, label2) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${label2} must be an identifier matching ${ID_PATTERN}`);
  }
  return value;
}
function optionalId(value, label2) {
  return value === void 0 ? void 0 : requireId(value, label2);
}
function requirePattern(value, pattern, label2) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label2} must match ${pattern}`);
  }
  return value;
}
function requireModel(value, label2) {
  const model = requirePattern(value, MODEL_PATTERN, label2);
  if (model.includes("..") || model.includes("//")) {
    fail(`${label2} must not contain path-like sequences`);
  }
  return model;
}
function requireTimestamp(value, label2) {
  if (typeof value !== "string") fail(`${label2} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) fail(`${label2} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number);
  const date2 = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips = date2.getUTCFullYear() === year && date2.getUTCMonth() === month - 1 && date2.getUTCDate() === day && date2.getUTCHours() === hour && date2.getUTCMinutes() === minute && date2.getUTCSeconds() === second;
  if (!roundTrips) fail(`${label2} is not a real calendar time`, "invalid_timestamp");
  return value;
}
function requireBoolean(value, label2) {
  if (typeof value !== "boolean") fail(`${label2} must be a boolean`);
  return value;
}
function requireCount(value, label2) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`${label2} must be a non-negative integer`, "usage_out_of_range");
  }
  return value;
}
function requireNullableCount(value, label2) {
  return value === null ? null : requireCount(value, label2);
}
function requireNullableUsd(value, label2) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label2} must be null or a finite non-negative number`, "usage_out_of_range");
  }
  return value;
}
function requireDiagnostics(value, label2) {
  if (!Array.isArray(value)) fail(`${label2} must be an array`);
  for (const [index, code] of value.entries()) {
    requireEnum(code, TASK_COST_DIAGNOSTIC_CODES, `${label2}[${index}]`);
  }
}
function requireStringArray(value, label2, item) {
  if (!Array.isArray(value)) fail(`${label2} must be an array`);
  return value.map((entry, index) => item(entry, `${label2}[${index}]`));
}
function requireTokenUsage(value, label2) {
  const record = requireObject(value, label2);
  const usage = {};
  for (const field of TASK_COST_TOKEN_FIELDS) {
    if (!(field in record)) fail(`${label2}.${field} is required (use null for missing)`);
    usage[field] = requireNullableCount(record[field], `${label2}.${field}`);
  }
  return usage;
}
function checkSchemaVersion(record, expected, label2) {
  const version = record.schema_version;
  if (typeof version !== "string") fail(`${label2}.schema_version is required`);
  if (version !== expected) {
    fail(`${label2}.schema_version "${version}" is not supported (expected ${expected})`, "unknown_schema_version");
  }
}
function validateTaskCostEventV1(value) {
  const record = requireObject(value, "event");
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_EVENT_SCHEMA_VERSION, "event");
  const eventId2 = requireId(record.event_id, "event.event_id");
  requireId(record.task_id, "event.task_id");
  requireId(record.session_id, "event.session_id");
  requireId(record.turn_id, "event.turn_id");
  requireCount(record.sequence, "event.sequence");
  optionalId(record.parent_event_id, "event.parent_event_id");
  if (record.is_subagent !== void 0) requireBoolean(record.is_subagent, "event.is_subagent");
  const replayOf = optionalId(record.replay_of_event_id, "event.replay_of_event_id");
  if (replayOf === eventId2) fail("event.replay_of_event_id must not reference the event itself");
  requireEnum(record.harness, TASK_COST_HARNESSES, "event.harness");
  if (record.harness_version !== void 0) {
    requirePattern(record.harness_version, VERSION_PATTERN, "event.harness_version");
  }
  requirePattern(record.provider_contract_version, PROVIDER_CONTRACT_PATTERN, "event.provider_contract_version");
  requireModel(record.observed_model, "event.observed_model");
  requireEnum(record.usage_kind, TASK_COST_USAGE_KINDS, "event.usage_kind");
  const usage = requireTokenUsage(record.usage, "event.usage");
  const usageCoverage = requireEnum(record.usage_coverage, TASK_COST_FIELD_AVAILABILITIES, "event.usage_coverage");
  const derivedCoverage = deriveUsageAvailability(usage);
  if (usageCoverage !== derivedCoverage) {
    fail(`event.usage_coverage is "${usageCoverage}" but usage implies "${derivedCoverage}"`);
  }
  const actual = requireNullableUsd(record.actual_cost_usd, "event.actual_cost_usd");
  const estimated = requireNullableUsd(record.estimated_cost_usd, "event.estimated_cost_usd");
  const costSource2 = requireEnum(record.cost_source, TASK_COST_EVENT_SOURCES, "event.cost_source");
  const expectedSource = actual !== null ? "provider_reported" : estimated !== null ? "local_estimate" : "none";
  if (costSource2 !== expectedSource) {
    fail(`event.cost_source is "${costSource2}" but the cost fields imply "${expectedSource}"`);
  }
  const basis2 = requireEnum(record.cost_basis, TASK_COST_BASES, "event.cost_basis");
  if (basis2 === "subscription" && actual !== null) {
    fail('event.actual_cost_usd must be null when cost_basis is "subscription"');
  }
  const pricingSource = requireEnum(record.pricing_source, TASK_COST_PRICING_SOURCES, "event.pricing_source");
  if (pricingSource === "mixed") fail('event.pricing_source "mixed" is only legal on summaries');
  if (pricingSource === "none" !== (estimated === null)) {
    fail('event.pricing_source must be "none" exactly when estimated_cost_usd is null');
  }
  if (record.pricing_revision !== void 0) {
    requirePattern(record.pricing_revision, VERSION_PATTERN, "event.pricing_revision");
  }
  if (record.price_table !== void 0) {
    requireEnum(record.price_table, TASK_COST_PRICE_TABLES, "event.price_table");
  }
  requireTimestamp(record.observed_at, "event.observed_at");
  if (record.diagnostics !== void 0) requireDiagnostics(record.diagnostics, "event.diagnostics");
}
function validateTaskCostSummaryV1(value) {
  const record = requireObject(value, "summary");
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_SUMMARY_SCHEMA_VERSION, "summary");
  requireId(record.task_id, "summary.task_id");
  requireStringArray(record.session_ids, "summary.session_ids", requireId);
  optionalId(record.root_session_id, "summary.root_session_id");
  requireEnum(record.harness, TASK_COST_HARNESSES, "summary.harness");
  if (record.harness_version !== void 0) {
    requirePattern(record.harness_version, VERSION_PATTERN, "summary.harness_version");
  }
  requirePattern(record.provider_contract_version, PROVIDER_CONTRACT_PATTERN, "summary.provider_contract_version");
  requireStringArray(record.models, "summary.models", requireModel);
  if (!Array.isArray(record.model_segments)) fail("summary.model_segments must be an array");
  for (const [index, entry] of record.model_segments.entries()) {
    const label2 = `summary.model_segments[${index}]`;
    const segment = requireObject(entry, label2);
    requireModel(segment.model, `${label2}.model`);
    requireCount(segment.turn_count, `${label2}.turn_count`);
    requireTokenUsage(segment.usage, `${label2}.usage`);
    requireNullableUsd(segment.actual_cost_usd, `${label2}.actual_cost_usd`);
    requireNullableUsd(segment.estimated_cost_usd, `${label2}.estimated_cost_usd`);
    requireEnum(segment.cost_source, TASK_COST_SOURCES, `${label2}.cost_source`);
  }
  requireCount(record.turn_count, "summary.turn_count");
  requireBoolean(record.turns_truncated, "summary.turns_truncated");
  requireTokenUsage(record.usage, "summary.usage");
  requireNullableUsd(record.actual_cost_usd, "summary.actual_cost_usd");
  requireNullableUsd(record.estimated_cost_usd, "summary.estimated_cost_usd");
  requireNullableUsd(record.total_cost_usd, "summary.total_cost_usd");
  requireEnum(record.cost_source, TASK_COST_SOURCES, "summary.cost_source");
  requireEnum(record.cost_basis, TASK_COST_BASES, "summary.cost_basis");
  requireEnum(record.coverage, TASK_COST_COVERAGES, "summary.coverage");
  const availability = requireObject(record.field_availability, "summary.field_availability");
  for (const key of ["usage", "actual_cost", "estimated_cost", "pricing"]) {
    requireEnum(availability[key], TASK_COST_FIELD_AVAILABILITIES, `summary.field_availability.${key}`);
  }
  if (record.pricing_revision !== void 0) {
    requirePattern(record.pricing_revision, VERSION_PATTERN, "summary.pricing_revision");
  }
  if (record.pricing_timestamp !== void 0) requireTimestamp(record.pricing_timestamp, "summary.pricing_timestamp");
  requireEnum(record.pricing_source, TASK_COST_PRICING_SOURCES, "summary.pricing_source");
  requireEnum(record.join_confidence, TASK_COST_JOIN_CONFIDENCES, "summary.join_confidence");
  requireTimestamp(record.collected_at, "summary.collected_at");
  const eventCount = requireCount(record.event_count, "summary.event_count");
  const eventIds = requireStringArray(record.event_ids, "summary.event_ids", requireId);
  if (eventIds.length !== eventCount) fail("summary.event_count must equal event_ids.length");
  requireDiagnostics(record.diagnostics, "summary.diagnostics");
}
function validateTaskCostLedgerV1(value) {
  const record = requireObject(value, "ledger");
  assertNoForbiddenKeys(record);
  checkSchemaVersion(record, TASK_COST_LEDGER_SCHEMA_VERSION, "ledger");
  const harness2 = requireEnum(record.harness, TASK_COST_HARNESSES, "ledger.harness");
  if (record.harness_version !== void 0) {
    requirePattern(record.harness_version, VERSION_PATTERN, "ledger.harness_version");
  }
  const providerContract = requirePattern(
    record.provider_contract_version,
    PROVIDER_CONTRACT_PATTERN,
    "ledger.provider_contract_version"
  );
  const sessionId = requireId(record.session_id, "ledger.session_id");
  const taskIds = requireStringArray(record.task_ids, "ledger.task_ids", requireId);
  requireTimestamp(record.opened_at, "ledger.opened_at");
  if (record.closed_at !== void 0) requireTimestamp(record.closed_at, "ledger.closed_at");
  requireBoolean(record.truncated, "ledger.truncated");
  const eventCount = requireCount(record.event_count, "ledger.event_count");
  if (!Array.isArray(record.events)) fail("ledger.events must be an array");
  if (record.events.length !== eventCount) fail("ledger.event_count must equal events.length");
  const seenTaskIds = /* @__PURE__ */ new Set();
  for (const [index, event17] of record.events.entries()) {
    validateTaskCostEventV1(event17);
    const label2 = `ledger.events[${index}]`;
    if (event17.session_id !== sessionId) fail(`${label2}.session_id must match ledger.session_id`);
    if (event17.harness !== harness2) fail(`${label2}.harness must match ledger.harness`);
    if (event17.provider_contract_version !== providerContract) {
      fail(`${label2}.provider_contract_version must match ledger.provider_contract_version`);
    }
    seenTaskIds.add(event17.task_id);
  }
  const expected = [...seenTaskIds].sort();
  if (taskIds.length !== expected.length || taskIds.some((id2, index) => id2 !== expected[index])) {
    fail("ledger.task_ids must be the sorted, de-duplicated task_ids of its events");
  }
}
function makeGuard(validate) {
  return (value) => {
    try {
      validate(value);
      return true;
    } catch (error) {
      if (error instanceof TaskCostValidationError) return false;
      throw error;
    }
  };
}
var isTaskCostEventV1 = makeGuard(validateTaskCostEventV1);
var isTaskCostSummaryV1 = makeGuard(validateTaskCostSummaryV1);
var isTaskCostLedgerV1 = makeGuard(validateTaskCostLedgerV1);

// ../core/src/fixtures/task-cost/builders.ts
var FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
var FIXTURE_TASK_ID = "task-0001";
var FIXTURE_SESSION_ID = "session-0001";
var FIXTURE_PRICING_REVISION = MODEL_PRICING_AS_OF;
function isoAt(offsetSeconds) {
  return new Date(FIXTURE_EPOCH_MS + offsetSeconds * 1e3).toISOString().replace(".000Z", "Z");
}
function pad(n, width = 4) {
  return String(n).padStart(width, "0");
}
function tokens(input, output, cacheRead, cacheWrite, reasoning) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning
  };
}
function eventId(n) {
  return `01900000-0000-7000-8000-${pad(n, 12)}`;
}
function defaultTable(model) {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google";
  return "openai";
}
function eventFactory(profile17) {
  return (spec) => {
    const actual = spec.actual ?? null;
    const estimated = spec.estimated ?? null;
    return {
      schema_version: TASK_COST_EVENT_SCHEMA_VERSION,
      event_id: eventId(spec.n),
      task_id: spec.task ?? FIXTURE_TASK_ID,
      session_id: spec.session ?? FIXTURE_SESSION_ID,
      turn_id: spec.turn ?? `turn-${pad(spec.n)}`,
      sequence: spec.sequence ?? spec.n,
      ...spec.parent !== void 0 ? { parent_event_id: spec.parent } : {},
      ...spec.isSubagent !== void 0 ? { is_subagent: spec.isSubagent } : {},
      ...spec.replayOf !== void 0 ? { replay_of_event_id: spec.replayOf } : {},
      harness: profile17.harness,
      ...profile17.harnessVersion !== void 0 ? { harness_version: profile17.harnessVersion } : {},
      provider_contract_version: profile17.providerContractVersion,
      observed_model: spec.model,
      usage_kind: spec.kind ?? "delta",
      usage: spec.usage,
      usage_coverage: deriveUsageAvailability(spec.usage),
      actual_cost_usd: actual,
      estimated_cost_usd: estimated,
      cost_source: actual !== null ? "provider_reported" : estimated !== null ? "local_estimate" : "none",
      cost_basis: spec.basis ?? "per_token_api",
      pricing_source: estimated !== null ? spec.pricingSource ?? "local_estimate" : "none",
      ...estimated !== null ? {
        pricing_revision: FIXTURE_PRICING_REVISION,
        price_table: spec.table ?? defaultTable(spec.model)
      } : {},
      observed_at: isoAt(spec.atSeconds ?? spec.n * 60),
      ...spec.diagnostics !== void 0 ? { diagnostics: spec.diagnostics } : {}
    };
  };
}
function ledgerFor(profile17, events17, sessionId = FIXTURE_SESSION_ID) {
  const first = events17[0];
  const last = events17[events17.length - 1];
  if (!first || !last) throw new Error("ledgerFor requires at least one event");
  return {
    schema_version: TASK_COST_LEDGER_SCHEMA_VERSION,
    harness: profile17.harness,
    ...profile17.harnessVersion !== void 0 ? { harness_version: profile17.harnessVersion } : {},
    provider_contract_version: profile17.providerContractVersion,
    session_id: sessionId,
    task_ids: [...new Set(events17.map((event17) => event17.task_id))].sort(),
    opened_at: first.observed_at,
    closed_at: last.observed_at,
    truncated: false,
    event_count: events17.length,
    events: [...events17]
  };
}

// ../core/src/fixtures/task-cost/claude-code-cache-tiers.ts
var profile = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event = eventFactory(profile);
var events = [
  // 1000 in, 8000 cache write, 500 out
  event({ n: 1, model: "claude-opus-4-8", usage: tokens(1e3, 500, 0, 8e3, 0), estimated: 0.0675 }),
  // 200 in, 8000 cache read, 600 out
  event({ n: 2, model: "claude-opus-4-8", usage: tokens(200, 600, 8e3, 0, 0), estimated: 0.02 }),
  // 300 in, 8000 cache read, 1000 cache write, 400 out
  event({ n: 3, model: "claude-opus-4-8", usage: tokens(300, 400, 8e3, 1e3, 0), estimated: 0.02175 })
];
var claudeCodeCacheTiersFixture = {
  name: "claude-code-cache-tiers",
  description: "Cache writes (1.25x) and reads (0.1x) tallied separately and priced per tier.",
  events,
  ledger: ledgerFor(profile, events),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-opus-4-8"],
      model_segments: [
        {
          model: "claude-opus-4-8",
          turn_count: 3,
          usage: tokens(1500, 1500, 16e3, 9e3, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.10925,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(1500, 1500, 16e3, 9e3, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.10925,
      total_cost_usd: 0.10925,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:03:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:03:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/claude-code-cumulative-snapshot.ts
var profile2 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event2 = eventFactory(profile2);
var events2 = [
  event2({ n: 1, kind: "cumulative", model: "claude-sonnet-5", usage: tokens(1e3, 500, 0, 0, 0), actual: 0.0108, estimated: 0.0105 }),
  event2({ n: 2, kind: "cumulative", model: "claude-sonnet-5", usage: tokens(2500, 1300, 0, 0, 0), actual: 0.0275, estimated: 0.027 }),
  event2({ n: 3, kind: "cumulative", model: "claude-sonnet-5", usage: tokens(2400, 1500, 0, 0, 0), actual: 0.027, estimated: 0.0297 }),
  event2({ n: 4, kind: "cumulative", model: "claude-sonnet-5", usage: tokens(3e3, 1800, 0, 0, 0), actual: 0.033, estimated: 0.036 })
];
var claudeCodeCumulativeSnapshotFixture = {
  name: "claude-code-cumulative-snapshot",
  description: "Cumulative snapshots are differenced; a backward jump is clamped to zero and flagged.",
  events: events2,
  ledger: ledgerFor(profile2, events2),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 4,
          usage: tokens(3100, 1800, 0, 0, 0),
          actual_cost_usd: 0.0335,
          estimated_cost_usd: 0.036,
          cost_source: "provider_reported"
        }
      ],
      turn_count: 4,
      turns_truncated: false,
      usage: tokens(3100, 1800, 0, 0, 0),
      actual_cost_usd: 0.0335,
      estimated_cost_usd: 0.036,
      total_cost_usd: 0.0335,
      cost_source: "provider_reported",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "available",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:04:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:04:00Z",
      event_count: 4,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003",
        "01900000-0000-7000-8000-000000000004"
      ],
      diagnostics: ["provider_reported_cost", "cumulative_backward_jump"]
    }
  ]
};

// ../core/src/fixtures/task-cost/claude-code-model-switch.ts
var profile3 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event3 = eventFactory(profile3);
var events3 = [
  event3({ n: 1, model: "claude-opus-4-8", usage: tokens(3e3, 1200, 0, 0, 0), estimated: 0.045 }),
  event3({ n: 2, model: "claude-opus-4-8", usage: tokens(2e3, 800, 0, 0, 0), estimated: 0.03 }),
  event3({ n: 3, model: "claude-sonnet-5", usage: tokens(4e3, 1500, 0, 0, 0), estimated: 0.0345 }),
  event3({ n: 4, model: "claude-sonnet-5", usage: tokens(1e3, 400, 0, 0, 0), estimated: 9e-3 })
];
var claudeCodeModelSwitchFixture = {
  name: "claude-code-model-switch",
  description: "Mid-task Opus -> Sonnet switch; model_segments preserve the switch structure.",
  events: events3,
  ledger: ledgerFor(profile3, events3),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-opus-4-8", "claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-opus-4-8",
          turn_count: 2,
          usage: tokens(5e3, 2e3, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.075,
          cost_source: "local_estimate"
        },
        {
          model: "claude-sonnet-5",
          turn_count: 2,
          usage: tokens(5e3, 1900, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0435,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 4,
      turns_truncated: false,
      usage: tokens(1e4, 3900, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.1185,
      total_cost_usd: 0.1185,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:04:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:04:00Z",
      event_count: 4,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003",
        "01900000-0000-7000-8000-000000000004"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/claude-code-retry.ts
var profile4 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event4 = eventFactory(profile4);
var events4 = [
  event4({ n: 1, model: "claude-sonnet-5", usage: tokens(1e3, 500, 0, 0, 0), estimated: 0.0105 }),
  event4({ n: 2, model: "claude-sonnet-5", usage: tokens(2e3, 900, 0, 0, 0), estimated: 0.0195 }),
  event4({
    n: 3,
    turn: "turn-0002",
    model: "claude-sonnet-5",
    usage: tokens(2e3, 1100, 0, 0, 0),
    estimated: 0.0225,
    replayOf: eventId(2)
  }),
  event4({ n: 4, model: "claude-sonnet-5", usage: tokens(800, 300, 0, 0, 0), estimated: 69e-4 })
];
var claudeCodeRetryFixture = {
  name: "claude-code-retry",
  description: "A retried turn supersedes its first attempt; the superseded usage and cost are not counted.",
  events: events4,
  ledger: ledgerFor(profile4, events4),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 3,
          usage: tokens(3800, 1900, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0399,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(3800, 1900, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0399,
      total_cost_usd: 0.0399,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:04:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:04:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000003",
        "01900000-0000-7000-8000-000000000004"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/claude-code-simple.ts
var profile5 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event5 = eventFactory(profile5);
var events5 = [
  event5({ n: 1, model: "claude-sonnet-5", usage: tokens(1e3, 500, 0, 0, 0), actual: 0.0108, estimated: 0.0105 }),
  event5({ n: 2, model: "claude-sonnet-5", usage: tokens(2e3, 1e3, 0, 0, 0), actual: 0.0215, estimated: 0.021 }),
  event5({ n: 3, model: "claude-sonnet-5", usage: tokens(1500, 800, 0, 0, 0), actual: 0.0166, estimated: 0.0165 })
];
var claudeCodeSimpleFixture = {
  name: "claude-code-simple",
  description: "Happy path: one model, delta events, provider-reported cost wins over the estimate.",
  events: events5,
  ledger: ledgerFor(profile5, events5),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 3,
          usage: tokens(4500, 2300, 0, 0, 0),
          actual_cost_usd: 0.0489,
          estimated_cost_usd: 0.048,
          cost_source: "provider_reported"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(4500, 2300, 0, 0, 0),
      actual_cost_usd: 0.0489,
      estimated_cost_usd: 0.048,
      total_cost_usd: 0.0489,
      cost_source: "provider_reported",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "available",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:03:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:03:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003"
      ],
      diagnostics: ["provider_reported_cost"]
    }
  ]
};

// ../core/src/fixtures/task-cost/claude-code-subscription.ts
var profile6 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event6 = eventFactory(profile6);
var events6 = [
  event6({ n: 1, model: "claude-sonnet-5", basis: "subscription", usage: tokens(5e3, 2e3, 0, 0, 0), estimated: 0.045 }),
  event6({ n: 2, model: "claude-sonnet-5", basis: "subscription", usage: tokens(3e3, 1500, 0, 0, 0), estimated: 0.0315 })
];
var claudeCodeSubscriptionFixture = {
  name: "claude-code-subscription",
  description: "Subscription cost basis: no actual charge exists; the estimate is token-equivalent only.",
  events: events6,
  ledger: ledgerFor(profile6, events6),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 2,
          usage: tokens(8e3, 3500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0765,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(8e3, 3500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0765,
      total_cost_usd: 0.0765,
      cost_source: "local_estimate",
      cost_basis: "subscription",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: ["subscription_basis_no_charge"]
    }
  ]
};

// ../core/src/fixtures/task-cost/codex-provider-override.ts
var profile7 = {
  harness: "codex",
  providerContractVersion: "codex/2",
  harnessVersion: "0.50.0"
};
var event7 = eventFactory(profile7);
var events7 = [
  event7({ n: 1, model: "gpt-5", usage: tokens(1e3, 500, 0, 0, 0), actual: 61e-4, estimated: 625e-5, pricingSource: "openrouter_api", table: "openrouter" }),
  event7({ n: 2, model: "gpt-5", usage: tokens(2e3, 800, 0, 0, 0), actual: 0.0102, estimated: 0.0105, pricingSource: "openrouter_api", table: "openrouter" })
];
var codexProviderOverrideFixture = {
  name: "codex-provider-override",
  description: "A provider-reported charge supersedes the local/OpenRouter estimate as the resolved cost.",
  events: events7,
  ledger: ledgerFor(profile7, events7),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/2",
      models: ["gpt-5"],
      model_segments: [
        {
          model: "gpt-5",
          turn_count: 2,
          usage: tokens(3e3, 1300, 0, 0, 0),
          actual_cost_usd: 0.0163,
          estimated_cost_usd: 0.01675,
          cost_source: "provider_reported"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3e3, 1300, 0, 0, 0),
      actual_cost_usd: 0.0163,
      estimated_cost_usd: 0.01675,
      total_cost_usd: 0.0163,
      cost_source: "provider_reported",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "available",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "openrouter_api",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: ["provider_reported_cost"]
    }
  ]
};

// ../core/src/fixtures/task-cost/codex-real-cache.ts
var profile8 = {
  harness: "codex",
  providerContractVersion: "codex/2",
  harnessVersion: "0.50.0"
};
var event8 = eventFactory(profile8);
var events8 = [
  event8({
    n: 1,
    model: "gpt-5-codex",
    usage: tokens(133579, 8343, 2844672, 0, 545),
    estimated: 0.605988
  })
];
var codexRealCacheFixture = {
  name: "codex-real-cache",
  description: "Sanitized real `token_count` with cache-heavy input; disjoint buckets per codex/2 (HOK-3104).",
  events: events8,
  ledger: ledgerFor(profile8, events8),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/2",
      models: ["gpt-5-codex"],
      model_segments: [
        {
          model: "gpt-5-codex",
          turn_count: 1,
          usage: tokens(133579, 8343, 2844672, 0, 545),
          actual_cost_usd: null,
          estimated_cost_usd: 0.605988,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 1,
      turns_truncated: false,
      usage: tokens(133579, 8343, 2844672, 0, 545),
      actual_cost_usd: null,
      estimated_cost_usd: 0.605988,
      total_cost_usd: 0.605988,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:01:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:01:00Z",
      event_count: 1,
      event_ids: ["01900000-0000-7000-8000-000000000001"],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/codex-simple.ts
var profile9 = {
  harness: "codex",
  providerContractVersion: "codex/2",
  harnessVersion: "0.50.0"
};
var event9 = eventFactory(profile9);
var events9 = [
  event9({ n: 1, model: "gpt-5-codex", usage: tokens(2e3, 600, 0, 0, 150), estimated: 85e-4 }),
  event9({ n: 2, model: "gpt-5-codex", usage: tokens(3e3, 900, 0, 0, 300), estimated: 0.01275 })
];
var codexSimpleFixture = {
  name: "codex-simple",
  description: "OpenAI-priced happy path; Codex reports no charge, so the estimate stands.",
  events: events9,
  ledger: ledgerFor(profile9, events9),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/2",
      models: ["gpt-5-codex"],
      model_segments: [
        {
          model: "gpt-5-codex",
          turn_count: 2,
          usage: tokens(5e3, 1500, 0, 0, 450),
          actual_cost_usd: null,
          estimated_cost_usd: 0.02125,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(5e3, 1500, 0, 0, 450),
      actual_cost_usd: null,
      estimated_cost_usd: 0.02125,
      total_cost_usd: 0.02125,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/codex-unknown-pricing.ts
var profile10 = {
  harness: "codex",
  providerContractVersion: "codex/2",
  harnessVersion: "0.50.0"
};
var event10 = eventFactory(profile10);
var events10 = [
  event10({ n: 1, model: "gpt-5", usage: tokens(1e3, 400, 0, 0, 0), estimated: 525e-5 }),
  event10({ n: 2, model: "codex-unlisted-model", usage: tokens(2e3, 700, 0, 0, 0) })
];
var codexUnknownPricingFixture = {
  name: "codex-unknown-pricing",
  description: "A model missing from the price table yields a null cost, partial coverage, and no total.",
  events: events10,
  ledger: ledgerFor(profile10, events10),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/2",
      models: ["gpt-5", "codex-unlisted-model"],
      model_segments: [
        {
          model: "gpt-5",
          turn_count: 1,
          usage: tokens(1e3, 400, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 525e-5,
          cost_source: "local_estimate"
        },
        {
          model: "codex-unlisted-model",
          turn_count: 1,
          usage: tokens(2e3, 700, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: null,
          cost_source: "none"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3e3, 1100, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 525e-5,
      total_cost_usd: null,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "partial",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "partial",
        pricing: "partial"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: ["unpriced_model", "mixed_coverage"]
    }
  ]
};

// ../core/src/fixtures/task-cost/concurrent-tasks.ts
var profile11 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event11 = eventFactory(profile11);
var events11 = [
  event11({ n: 1, task: "task-0001", model: "claude-sonnet-5", usage: tokens(1e3, 400, 0, 0, 0), estimated: 9e-3 }),
  event11({ n: 2, task: "task-0002", model: "claude-sonnet-5", usage: tokens(4e3, 1e3, 0, 0, 0), estimated: 0.027 }),
  event11({ n: 3, task: "task-0001", model: "claude-sonnet-5", usage: tokens(2e3, 600, 0, 0, 0), estimated: 0.015 }),
  event11({ n: 4, task: "task-0002", model: "claude-sonnet-5", usage: tokens(1500, 500, 0, 0, 0), estimated: 0.012 }),
  event11({ n: 5, task: "task-0001", model: "claude-sonnet-5", usage: tokens(500, 200, 0, 0, 0), estimated: 45e-4 }),
  event11({ n: 6, task: "task-0002", model: "claude-sonnet-5", usage: tokens(800, 300, 0, 0, 0), estimated: 69e-4 })
];
var concurrentTasksFixture = {
  name: "concurrent-tasks",
  description: "One session, two interleaved tasks: one ledger, two disjoint summaries.",
  events: events11,
  ledger: ledgerFor(profile11, events11),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 3,
          usage: tokens(3500, 1200, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0285,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(3500, 1200, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0285,
      total_cost_usd: 0.0285,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:05:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:05:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000003",
        "01900000-0000-7000-8000-000000000005"
      ],
      diagnostics: []
    },
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0002",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 3,
          usage: tokens(6300, 1800, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.0459,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6300, 1800, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.0459,
      total_cost_usd: 0.0459,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:06:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:06:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000004",
        "01900000-0000-7000-8000-000000000006"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/mixed-model.ts
var profile12 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event12 = eventFactory(profile12);
var events12 = [
  event12({ n: 1, model: "claude-sonnet-5", usage: tokens(2e3, 1e3, 0, 0, 0), actual: 0.0212, estimated: 0.021 }),
  event12({ n: 2, model: "claude-sonnet-5", usage: tokens(1e3, 200, 0, 0, 0), actual: 61e-4, estimated: 6e-3 }),
  event12({ n: 3, model: "gpt-5", usage: tokens(3e3, 1e3, 0, 0, 0), estimated: 0.01375 })
];
var mixedModelFixture = {
  name: "mixed-model",
  description: "Anthropic (charged) then OpenAI (estimated) turns: cost_source mixed, two model segments.",
  events: events12,
  ledger: ledgerFor(profile12, events12),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-sonnet-5", "gpt-5"],
      model_segments: [
        {
          model: "claude-sonnet-5",
          turn_count: 2,
          usage: tokens(3e3, 1200, 0, 0, 0),
          actual_cost_usd: 0.0273,
          estimated_cost_usd: 0.027,
          cost_source: "provider_reported"
        },
        {
          model: "gpt-5",
          turn_count: 1,
          usage: tokens(3e3, 1e3, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.01375,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6e3, 2200, 0, 0, 0),
      actual_cost_usd: 0.0273,
      estimated_cost_usd: 0.04075,
      total_cost_usd: 0.04105,
      cost_source: "mixed",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "partial",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:03:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:03:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003"
      ],
      diagnostics: ["provider_reported_cost"]
    }
  ]
};

// ../core/src/fixtures/task-cost/native-simple.ts
var profile13 = {
  harness: "native",
  providerContractVersion: "native/1",
  harnessVersion: "1.0.0"
};
var event13 = eventFactory(profile13);
var events13 = [
  event13({ n: 1, model: "claude-haiku-4-5", usage: tokens(1200, 300, 0, 0, 0), estimated: 27e-4 }),
  event13({ n: 2, model: "claude-haiku-4-5", usage: tokens(0, 0, 0, 0, 0), estimated: 0 })
];
var nativeSimpleFixture = {
  name: "native-simple",
  description: "Native harness: known-zero counters and a known-zero turn stay distinct from missing.",
  events: events13,
  ledger: ledgerFor(profile13, events13),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "native",
      harness_version: "1.0.0",
      provider_contract_version: "native/1",
      models: ["claude-haiku-4-5"],
      model_segments: [
        {
          model: "claude-haiku-4-5",
          turn_count: 2,
          usage: tokens(1200, 300, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 27e-4,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(1200, 300, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 27e-4,
      total_cost_usd: 27e-4,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/partial-usage.ts
var profile14 = {
  harness: "codex",
  providerContractVersion: "codex/2",
  harnessVersion: "0.50.0"
};
var event14 = eventFactory(profile14);
var events14 = [
  event14({ n: 1, model: "gpt-5", usage: tokens(1e3, null, 0, 0, null) }),
  event14({ n: 2, model: "gpt-5", usage: tokens(2e3, 500, 0, 0, 0), estimated: 75e-4 })
];
var partialUsageFixture = {
  name: "partial-usage",
  description: "Missing (null) output tokens stay null, mark usage partial, and block pricing for that turn.",
  events: events14,
  ledger: ledgerFor(profile14, events14),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/2",
      models: ["gpt-5"],
      model_segments: [
        {
          model: "gpt-5",
          turn_count: 2,
          usage: tokens(3e3, 500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 75e-4,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(3e3, 500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 75e-4,
      total_cost_usd: null,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "partial",
      field_availability: {
        usage: "partial",
        actual_cost: "unavailable",
        estimated_cost: "partial",
        pricing: "partial"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: ["missing_token_usage", "mixed_coverage"]
    }
  ]
};

// ../core/src/fixtures/task-cost/pi-simple.ts
var profile15 = {
  harness: "pi",
  providerContractVersion: "pi/1",
  harnessVersion: "0.9.0"
};
var event15 = eventFactory(profile15);
var events15 = [
  event15({ n: 1, model: "gemini-2.5-flash", usage: tokens(1e4, 2e3, 0, 0, 0), estimated: 8e-3 }),
  event15({
    n: 2,
    model: "gemini-2.5-flash",
    usage: tokens(6e3, 1500, 0, 0, 0),
    estimated: 555e-5,
    parent: eventId(1),
    isSubagent: true
  })
];
var piSimpleFixture = {
  name: "pi-simple",
  description: "Pi harness contract (pi/1) with a nested subagent turn.",
  events: events15,
  ledger: ledgerFor(profile15, events15),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "pi",
      harness_version: "0.9.0",
      provider_contract_version: "pi/1",
      models: ["gemini-2.5-flash"],
      model_segments: [
        {
          model: "gemini-2.5-flash",
          turn_count: 2,
          usage: tokens(16e3, 3500, 0, 0, 0),
          actual_cost_usd: null,
          estimated_cost_usd: 0.01355,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(16e3, 3500, 0, 0, 0),
      actual_cost_usd: null,
      estimated_cost_usd: 0.01355,
      total_cost_usd: 0.01355,
      cost_source: "local_estimate",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "unavailable",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:02:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:02:00Z",
      event_count: 2,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ],
      diagnostics: []
    }
  ]
};

// ../core/src/fixtures/task-cost/wavemill-parity.ts
var profile16 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event16 = eventFactory(profile16);
var events16 = [
  event16({ n: 1, model: "claude-opus-4-8", usage: tokens(2500, 900, 12e3, 3e3, 200), actual: 0.0601, estimated: 0.05975 }),
  event16({ n: 2, model: "claude-opus-4-8", usage: tokens(1200, 700, 15e3, 0, 100), actual: 0.0312, estimated: 0.031 }),
  event16({ n: 3, model: "claude-sonnet-4-6", usage: tokens(3e3, 1e3, 2e4, 500, 0), actual: 0.032, estimated: 0.031875 })
];
var wavemillParityFixture = {
  name: "wavemill-parity",
  description: "Multi-model, cache-tier session with provider-reported cost; matches a real Wavemill golden.",
  events: events16,
  ledger: ledgerFor(profile16, events16),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "claude-code",
      harness_version: "2.1.0",
      provider_contract_version: "claude-code/1",
      models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      model_segments: [
        {
          model: "claude-opus-4-8",
          turn_count: 2,
          usage: tokens(3700, 1600, 27e3, 3e3, 300),
          actual_cost_usd: 0.0913,
          estimated_cost_usd: 0.09075,
          cost_source: "provider_reported"
        },
        {
          model: "claude-sonnet-4-6",
          turn_count: 1,
          usage: tokens(3e3, 1e3, 2e4, 500, 0),
          actual_cost_usd: 0.032,
          estimated_cost_usd: 0.031875,
          cost_source: "provider_reported"
        }
      ],
      turn_count: 3,
      turns_truncated: false,
      usage: tokens(6700, 2600, 47e3, 3500, 300),
      actual_cost_usd: 0.1233,
      estimated_cost_usd: 0.122625,
      total_cost_usd: 0.1233,
      cost_source: "provider_reported",
      cost_basis: "per_token_api",
      coverage: "complete",
      field_availability: {
        usage: "available",
        actual_cost: "available",
        estimated_cost: "available",
        pricing: "available"
      },
      pricing_revision: "2026-07-15",
      pricing_timestamp: "2026-01-01T00:03:00Z",
      pricing_source: "local_estimate",
      join_confidence: "unattributed",
      collected_at: "2026-01-01T00:03:00Z",
      event_count: 3,
      event_ids: [
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002",
        "01900000-0000-7000-8000-000000000003"
      ],
      diagnostics: ["provider_reported_cost"]
    }
  ]
};

// ../core/src/contribution/schema.ts
var HARNESS_OUTCOME_ROW_FIELDS = Object.freeze([
  "schema_version",
  "task_descriptor",
  "allowed_models",
  "selected_models",
  "budget_usd",
  "actual_cost_usd",
  "wall_clock_seconds",
  "completion_result",
  "success_under_budget",
  "inference_log_id",
  "harness",
  "task_id",
  "observed_at",
  "harness_metadata"
]);

// ../core/src/plugin-commands/cli.ts
var CLI_EXIT_CODES = {
  OK: 0,
  AUTH_REQUIRED: 2,
  CONSENT_REQUIRED: 3,
  NETWORK_ERROR: 4,
  UNSUPPORTED_MODEL: 5,
  EMPTY_TASK: 6,
  UNKNOWN_ERROR: 1
};

// ../core/src/plugin-commands/report-cli.ts
var REPORT_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7
};

// ../core/src/plugin-commands/privacy-cli.ts
var PRIVACY_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7,
  PRIVACY_USAGE_ERROR: 8
};

// src/static-features.ts
import { readFileSync, existsSync, statSync } from "node:fs";
import { join as join2, resolve } from "node:path";

// src/shell-utils.ts
import { execFileSync, execSync } from "node:child_process";
function commandOutputToString(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString();
  return "";
}
function execArgvCommand(file, args, options) {
  try {
    const stdout = execFileSync(file, [...args], {
      ...options,
      shell: false
    });
    return { stdout: commandOutputToString(stdout), stderr: "", exitCode: 0, failed: false };
  } catch (error) {
    const commandError = error;
    const failed = commandError.code === "ENOENT";
    return {
      stdout: commandOutputToString(commandError.stdout),
      stderr: commandOutputToString(commandError.stderr),
      exitCode: typeof commandError.status === "number" ? commandError.status : -1,
      failed
    };
  }
}

// src/static-features.ts
var SCAN_CONFIG_FILENAME = ".hokusai-scan.json";
var LEGACY_SCAN_CONFIG_FILENAME = ".wavemill-config.json";
var COMPLEXITY_METRIC_ID = "wavemill-cyclomatic/v1";
var COMPLEXITY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".sh",
  ".bash"
]);
var DEFAULT_TIMEOUTS_MS = {
  typecheck: 18e4,
  lint: 12e4,
  build: 3e5,
  complexity: 6e4
};
function parseStaticAnalysisConfig(configPath) {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed?.staticAnalysis ?? {};
  } catch {
    return {};
  }
}
function readCommittedStaticAnalysisConfig(checkoutDir, onDiagnostic) {
  const primaryPath = join2(checkoutDir, SCAN_CONFIG_FILENAME);
  if (existsSync(primaryPath)) {
    return parseStaticAnalysisConfig(primaryPath);
  }
  const legacyPath = join2(checkoutDir, LEGACY_SCAN_CONFIG_FILENAME);
  if (existsSync(legacyPath)) {
    (onDiagnostic ?? defaultDiagnostic)(
      `using legacy ${LEGACY_SCAN_CONFIG_FILENAME}; rename it to ${SCAN_CONFIG_FILENAME} (same contents) in the target repo`
    );
    return parseStaticAnalysisConfig(legacyPath);
  }
  return {};
}
function defaultDiagnostic(message) {
  process.stderr.write(`warn: ${message}
`);
}
function countTscErrors(output) {
  if (!output) return 0;
  const matches = output.match(/\berror TS\d+/g);
  return matches ? matches.length : 0;
}
function sumEslintErrors(jsonText) {
  if (!jsonText) return null;
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  let total = 0;
  for (const entry of parsed) {
    if (entry && typeof entry === "object" && "errorCount" in entry) {
      const value = entry.errorCount;
      if (typeof value === "number" && Number.isFinite(value)) total += value;
    }
  }
  return total;
}
function fileComplexity(source, extension) {
  if (!COMPLEXITY_EXTENSIONS.has(extension)) return null;
  const stripped = stripCommentsAndStrings(source, extension);
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\belif\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bwhen\b/g,
    /\bcatch\b/g,
    /\bexcept\b/g,
    /\brescue\b/g,
    /\?[^:]/g,
    // ternary "?" heuristically (not preceded by string context due to stripping)
    /&&/g,
    /\|\|/g
  ];
  let branches = 0;
  for (const pattern of patterns) {
    const matches = stripped.match(pattern);
    if (matches) branches += matches.length;
  }
  return 1 + branches;
}
function stripCommentsAndStrings(source, extension) {
  const hashComment = /* @__PURE__ */ new Set([".py", ".rb", ".sh", ".bash"]);
  const isHash = hashComment.has(extension);
  const chars = source.split("");
  const out = [];
  let i = 0;
  const N = chars.length;
  while (i < N) {
    const c = chars[i];
    const next = i + 1 < N ? chars[i + 1] : "";
    if (!isHash && c === "/" && next === "/") {
      while (i < N && chars[i] !== "\n") i++;
      continue;
    }
    if (isHash && c === "#") {
      while (i < N && chars[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < N && !(chars[i] === "*" && chars[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      if (extension === ".py" && chars[i + 1] === c && chars[i + 2] === c) {
        i += 3;
        while (i < N && !(chars[i] === c && chars[i + 1] === c && chars[i + 2] === c)) {
          i++;
        }
        i += 3;
        continue;
      }
      const quote = c;
      i++;
      while (i < N && chars[i] !== quote) {
        if (chars[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}
function collectTypeErrors(checkoutDir, config, timeoutMs) {
  if (config.typecheckCommand) {
    const result2 = runShellCommand(config.typecheckCommand, checkoutDir, timeoutMs);
    if (result2 === null) return null;
    const combined = `${result2.stdout}
${result2.stderr}`;
    if (result2.failed || result2.exitCode < 0) return null;
    return countTscErrors(combined);
  }
  const staticConfig = join2(checkoutDir, "tsconfig.static.json");
  const rootConfig = join2(checkoutDir, "tsconfig.json");
  const project = existsSync(staticConfig) ? "tsconfig.static.json" : existsSync(rootConfig) ? "tsconfig.json" : null;
  if (!project) return null;
  const result = execArgvCommand(
    "npx",
    ["--no-install", "tsc", "--noEmit", "-p", project],
    { cwd: checkoutDir, timeout: timeoutMs, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.failed || result.exitCode < 0) return null;
  return countTscErrors(`${result.stdout}
${result.stderr}`);
}
function collectLintErrors(checkoutDir, config, timeoutMs) {
  if (config.lintCommand) {
    const result2 = runShellCommand(config.lintCommand, checkoutDir, timeoutMs);
    if (result2 === null) return null;
    if (result2.failed || result2.exitCode < 0) return null;
    return sumEslintErrors(result2.stdout);
  }
  const eslintConfigs = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    ".eslintrc"
  ];
  const hasConfig = eslintConfigs.some((name) => existsSync(join2(checkoutDir, name)));
  if (!hasConfig) return null;
  const result = execArgvCommand(
    "npx",
    ["--no-install", "eslint", ".", "--format", "json"],
    { cwd: checkoutDir, timeout: timeoutMs, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.failed || result.exitCode < 0) return null;
  return sumEslintErrors(result.stdout);
}
function collectBuildOk(checkoutDir, config, timeoutMs, ciEvidence) {
  if (config.buildCommand) {
    const result = runShellCommand(config.buildCommand, checkoutDir, timeoutMs);
    if (result === null) return { value: null, evidence: null };
    if (result.failed || result.exitCode < 0) return { value: null, evidence: null };
    return { value: result.exitCode === 0, evidence: "local-build" };
  }
  const pkgPath = join2(checkoutDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.build) {
        const result = execArgvCommand(
          "npm",
          ["run", "build", "--silent"],
          { cwd: checkoutDir, timeout: timeoutMs, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
        );
        if (result.failed || result.exitCode < 0) return { value: null, evidence: null };
        return { value: result.exitCode === 0, evidence: "local-build" };
      }
    } catch {
    }
  }
  if (ciEvidence) {
    const evidence = ciEvidence();
    if (evidence) return { value: evidence.value, evidence: evidence.provenance };
  }
  return { value: null, evidence: null };
}
function collectCiBuildEvidence(prNumber, repoDir) {
  const result = execArgvCommand(
    "gh",
    ["pr", "checks", prNumber, "--json", "name,state,bucket"],
    { cwd: repoDir, timeout: 3e4, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.failed || result.exitCode < 0 || !result.stdout.trim()) return null;
  let checks;
  try {
    checks = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(checks) || checks.length === 0) return null;
  const buildCheck = checks.find((c) => /build|compile/i.test(c.name));
  if (buildCheck) {
    const conclusion = bucketToBool(buildCheck.bucket);
    if (conclusion === null) return null;
    return { value: conclusion, provenance: "ci-build-check" };
  }
  const conclusions = checks.map((c) => bucketToBool(c.bucket));
  if (conclusions.some((c) => c === null)) return null;
  if (conclusions.length === 0) return null;
  return {
    value: conclusions.every((c) => c === true),
    provenance: "ci-pipeline"
  };
}
function bucketToBool(bucket) {
  switch (bucket) {
    case "pass":
      return true;
    case "fail":
      return false;
    case "skipping":
      return null;
    case "cancel":
      return false;
    case "pending":
      return null;
    default:
      return null;
  }
}
function collectComplexityDelta(checkoutDir, baseRef, timeoutMs) {
  const mergeBase = runGit(checkoutDir, ["merge-base", baseRef, "HEAD"], timeoutMs);
  if (!mergeBase) return null;
  const nameStatus = runGit(
    checkoutDir,
    ["diff", "--name-status", "--find-renames", `${mergeBase}...HEAD`],
    timeoutMs
  );
  if (nameStatus === null) return null;
  if (!nameStatus.trim()) return 0;
  const changes = parseNameStatus(nameStatus);
  let baseTotal = 0;
  let headTotal = 0;
  let anyMeasured = false;
  for (const change of changes) {
    const ext = getExtension(change.headPath || change.basePath || "");
    if (!COMPLEXITY_EXTENSIONS.has(ext)) continue;
    if (change.basePath && change.status !== "A") {
      const baseSource = runGit(
        checkoutDir,
        ["show", `${mergeBase}:${change.basePath}`],
        timeoutMs,
        { allowFailure: true }
      );
      if (baseSource !== null) {
        const c = fileComplexity(baseSource, ext);
        if (c !== null) {
          baseTotal += c;
          anyMeasured = true;
        }
      }
    }
    if (change.headPath && change.status !== "D") {
      const absPath = join2(checkoutDir, change.headPath);
      try {
        const stat = statSync(absPath);
        if (stat.isFile()) {
          const headSource = readFileSync(absPath, "utf-8");
          const c = fileComplexity(headSource, ext);
          if (c !== null) {
            headTotal += c;
            anyMeasured = true;
          }
        }
      } catch {
      }
    }
  }
  if (!anyMeasured) return 0;
  return headTotal - baseTotal;
}
function parseNameStatus(output) {
  const results = [];
  const lines = output.split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    const parts = line.split("	");
    if (parts.length < 2) continue;
    const rawStatus = parts[0];
    const status = rawStatus.charAt(0);
    if (status === "R" || status === "C") {
      results.push({
        status: "R",
        basePath: parts[1] ?? null,
        headPath: parts[2] ?? null
      });
    } else if (status === "A") {
      results.push({ status: "A", basePath: null, headPath: parts[1] ?? null });
    } else if (status === "D") {
      results.push({ status: "D", basePath: parts[1] ?? null, headPath: null });
    } else if (status === "M" || status === "T") {
      results.push({ status: "M", basePath: parts[1] ?? null, headPath: parts[1] ?? null });
    }
  }
  return results;
}
function getExtension(path2) {
  const lastSlash = path2.lastIndexOf("/");
  const base = lastSlash >= 0 ? path2.slice(lastSlash + 1) : path2;
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return base.slice(lastDot).toLowerCase();
}
function runShellCommand(command, cwd, timeoutMs) {
  const result = execArgvCommand(
    "/bin/sh",
    ["-c", command],
    { cwd, timeout: timeoutMs, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  return result;
}
function runGit(cwd, args, timeoutMs, options = {}) {
  const result = execArgvCommand(
    "git",
    args,
    { cwd, timeout: timeoutMs, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.failed) return null;
  if (result.exitCode !== 0 && !options.allowFailure) return null;
  if (result.exitCode !== 0 && options.allowFailure) return null;
  return result.stdout.trimEnd();
}
function collectStaticFeatures(options) {
  const checkoutDir = resolve(options.checkoutDir);
  const config = options.configPath ? parseStaticAnalysisConfig(resolve(options.configPath)) : readCommittedStaticAnalysisConfig(checkoutDir, options.onDiagnostic);
  const committedTypecheck = config.timeoutSeconds?.typecheck;
  const committedLint = config.timeoutSeconds?.lint;
  const committedBuild = config.timeoutSeconds?.build;
  const committedComplexity = config.timeoutSeconds?.complexity;
  const typecheckMs = options.timeouts?.typecheck ?? (committedTypecheck ? committedTypecheck * 1e3 : DEFAULT_TIMEOUTS_MS.typecheck);
  const lintMs = options.timeouts?.lint ?? (committedLint ? committedLint * 1e3 : DEFAULT_TIMEOUTS_MS.lint);
  const buildMs = options.timeouts?.build ?? (committedBuild ? committedBuild * 1e3 : DEFAULT_TIMEOUTS_MS.build);
  const complexityMs = options.timeouts?.complexity ?? (committedComplexity ? committedComplexity * 1e3 : DEFAULT_TIMEOUTS_MS.complexity);
  const type_errors = safelyCollect(() => collectTypeErrors(checkoutDir, config, typecheckMs));
  const lint_errors = safelyCollect(() => collectLintErrors(checkoutDir, config, lintMs));
  const ciEvidence = !options.offline && options.prNumber ? () => collectCiBuildEvidence(options.prNumber, options.repoDir ?? checkoutDir) : null;
  const build = safelyCollectObject(
    () => collectBuildOk(checkoutDir, config, buildMs, ciEvidence),
    { value: null, evidence: null }
  );
  const baseRef = options.baseRef ?? tryFallbackBaseRef(checkoutDir, complexityMs) ?? "HEAD^";
  const complexity_delta = safelyCollect(
    () => collectComplexityDelta(checkoutDir, baseRef, complexityMs)
  );
  return {
    type_errors,
    lint_errors,
    build_ok: build.value,
    complexity_delta,
    build_evidence: build.evidence,
    complexity_metric: complexity_delta === null ? null : COMPLEXITY_METRIC_ID
  };
}
function tryFallbackBaseRef(checkoutDir, timeoutMs) {
  for (const candidate of ["origin/main", "main", "origin/HEAD"]) {
    const output = runGit(
      checkoutDir,
      ["rev-parse", "--verify", candidate],
      timeoutMs,
      { allowFailure: true }
    );
    if (output) return candidate;
  }
  return null;
}
function safelyCollect(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
function safelyCollectObject(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// src/candidate-features.ts
var TASK_TYPES = new Set(HOKUSAI_TASK_TYPES);
var LANGUAGES = new Set(HOKUSAI_LANGUAGES);
var DOMAINS = new Set(HOKUSAI_DOMAINS);
var REPO_SIZE_BUCKETS = new Set(HOKUSAI_REPO_SIZE_BUCKETS);
var FILES_TOUCHED_BUCKETS = new Set(HOKUSAI_FILES_TOUCHED_BUCKETS);
var DESCRIPTION_LENGTH_BUCKETS = new Set(
  HOKUSAI_DESCRIPTION_LENGTH_BUCKETS
);
var RISK_LEVELS = new Set(HOKUSAI_RISK_LEVELS);
var TEST_FILE_PATTERN = /(^|\/)(__tests__|tests?)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/i;
function extractCandidateFeatures(options) {
  const checkoutDir = resolve2(options.checkoutDir);
  const repoDir = resolve2(options.repoDir ?? checkoutDir);
  const prNumber = String(options.prNumber);
  const prEvidence = options.offline ? null : safe(() => fetchPullRequestEvidence(prNumber, repoDir), null);
  const baseRef = resolveBaseRef(checkoutDir, prEvidence?.baseRefName, options.baseRef);
  const diffStats = safe(() => collectDiffStats(checkoutDir, baseRef), null);
  const staticFeatures = options.staticFeatures ?? collectStaticFeatures({
    checkoutDir,
    prNumber,
    repoDir,
    ...baseRef ? { baseRef } : {},
    offline: options.offline,
    configPath: options.configPath,
    onDiagnostic: options.onDiagnostic
  });
  const reviewEvidence = options.offline ? null : safe(() => collectReviewEvidence(prNumber, repoDir), null);
  const candidate = {
    schema_version: CANDIDATE_FEATURES_SCHEMA_VERSION,
    files_touched: diffStats?.filesTouched ?? null,
    lines_added: diffStats?.linesAdded ?? null,
    lines_deleted: diffStats?.linesDeleted ?? null,
    loc_touched: diffStats?.locTouched ?? null,
    dependency_depth: null,
    module_hotspot_score: null,
    diff_uncertain: diffStats?.diffUncertain ?? null,
    type_errors: staticFeatures.type_errors,
    lint_errors: staticFeatures.lint_errors,
    build_ok: staticFeatures.build_ok,
    complexity_delta: staticFeatures.complexity_delta,
    tests_changed: diffStats ? diffStats.changedFiles.some(isTestFile) : null,
    test_pass_rate: options.offline ? null : safe(() => collectTestPassRate(prNumber, repoDir), null),
    test_runtime_seconds: null,
    ...nullIntent(),
    touched_out_of_scope_files: collectTouchedOutOfScopeFiles(diffStats, options.contract),
    human_intervention_count: normalizeNonNegativeInteger(options.contract?.provenance?.human_intervention_count),
    review_rounds: normalizeNonNegativeInteger(
      options.contract?.provenance?.review_rounds ?? reviewEvidence?.reviewRounds
    ),
    change_requests: normalizeNonNegativeInteger(
      options.contract?.provenance?.change_requests ?? reviewEvidence?.changeRequests
    ),
    self_review_iterations: normalizeNonNegativeInteger(options.contract?.provenance?.self_review_iterations),
    agent_iterations: normalizeNonNegativeInteger(options.contract?.provenance?.agent_iterations)
  };
  const intent = deriveIntent(options.contract, diffStats);
  Object.assign(candidate, intent);
  const issues = validateCandidateFeatures(candidate);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ");
    throw new Error(`candidate_features/v1 validation failed: ${details}`);
  }
  return candidate;
}
function validateCandidateFeatures(value) {
  const result = validateCandidateFeaturesV1(value);
  if (result.ok) return [];
  return result.errors.map((error) => ({ field: error.path, message: error.message }));
}
function collectDiffStats(checkoutDir, baseRef) {
  if (!baseRef || !isExistingDir(checkoutDir)) return null;
  const mergeBase = runGit2(checkoutDir, ["merge-base", baseRef, "HEAD"]);
  if (!mergeBase) return null;
  const numstat = runGit2(checkoutDir, ["diff", "--numstat", "--find-renames", `${mergeBase}...HEAD`]);
  const names = runGit2(checkoutDir, ["diff", "--name-only", "--find-renames", `${mergeBase}...HEAD`]);
  if (numstat === null || names === null) return null;
  const changedFiles = names.split("\n").map((line) => line.trim()).filter(Boolean).sort();
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, deleted] = line.split("	");
    linesAdded += parseNumstatCount(added);
    linesDeleted += parseNumstatCount(deleted);
  }
  return {
    changedFiles,
    filesTouched: changedFiles.length,
    linesAdded,
    linesDeleted,
    locTouched: linesAdded + linesDeleted,
    diffUncertain: changedFiles.length > 0 && numstat.trim().length === 0
  };
}
function parseNumstatCount(value) {
  if (!value || value === "-") return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
function resolveBaseRef(checkoutDir, prBaseRefName, explicitBaseRef) {
  const candidates = [
    explicitBaseRef,
    prBaseRefName ? `origin/${prBaseRefName}` : void 0,
    prBaseRefName,
    "origin/main",
    "main",
    "origin/HEAD",
    "HEAD^"
  ].filter((candidate) => Boolean(candidate));
  for (const candidate of candidates) {
    const resolved = runGit2(checkoutDir, ["rev-parse", "--verify", candidate], { allowFailure: true });
    if (resolved) return candidate;
  }
  return null;
}
function fetchPullRequestEvidence(prNumber, repoDir) {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    "gh",
    ["pr", "view", prNumber, "--json", "baseRefName"],
    { cwd: repoDir, timeout: 15e3, encoding: "utf-8" }
  );
  if (result.failed || result.exitCode !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return typeof parsed.baseRefName === "string" && parsed.baseRefName.length > 0 ? { baseRefName: parsed.baseRefName } : null;
  } catch {
    return null;
  }
}
function collectTestPassRate(prNumber, repoDir) {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    "gh",
    ["pr", "checks", prNumber, "--json", "name,state,bucket"],
    { cwd: repoDir, timeout: 15e3, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.failed || result.exitCode < 0 || !result.stdout.trim()) return null;
  let checks;
  try {
    checks = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(checks)) return null;
  const testChecks = checks.filter((check) => /test|spec|jest|vitest|pytest/i.test(check.name ?? ""));
  if (testChecks.length === 0) return null;
  let passed = 0;
  let scored = 0;
  for (const check of testChecks) {
    if (check.bucket === "pass") {
      passed += 1;
      scored += 1;
    } else if (check.bucket === "fail") {
      scored += 1;
    }
  }
  if (scored === 0) return null;
  return passed / scored;
}
function collectReviewEvidence(prNumber, repoDir) {
  if (!/^\d+$/.test(prNumber) || !isExistingDir(repoDir)) return null;
  const result = execArgvCommand(
    "gh",
    ["pr", "view", prNumber, "--json", "reviews"],
    { cwd: repoDir, timeout: 15e3, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.failed || result.exitCode !== 0 || !result.stdout.trim()) return null;
  let reviews;
  try {
    const parsed = JSON.parse(result.stdout);
    reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
  } catch {
    return null;
  }
  if (reviews.length === 0) return { reviewRounds: 0, changeRequests: 0 };
  const roundHours = /* @__PURE__ */ new Set();
  let changeRequests = 0;
  for (const review of reviews) {
    if (typeof review.submittedAt === "string") {
      const time = new Date(review.submittedAt).getTime();
      if (Number.isFinite(time)) roundHours.add(Math.floor(time / (1e3 * 60 * 60)));
    }
    if ((review.state ?? "").toUpperCase() === "CHANGES_REQUESTED") {
      changeRequests += 1;
    }
  }
  return { reviewRounds: roundHours.size, changeRequests };
}
function deriveIntent(contract, diffStats) {
  if (!contract) return nullIntent();
  const descriptor = deriveTaskDescriptor({
    taskText: contract.taskText,
    repositorySignals: contract.repositorySignals
  });
  const intent = nullIntent();
  intent.task_type = normalizeTaskType(contract.intent?.task_type ?? descriptor.task_type);
  intent.language = normalizeLanguage(contract.intent?.language ?? descriptor.language);
  intent.domain = normalizeDomain(contract.intent?.domain);
  intent.complexity = normalizeComplexityValue(contract.intent?.complexity ?? descriptor.complexity);
  intent.repo_size_bucket = normalizeRepoSizeBucket(contract.intent?.repo_size_bucket ?? descriptor.repo_size_bucket);
  intent.files_touched_bucket = normalizeFilesTouchedBucket(
    contract.intent?.files_touched_bucket ?? bucketFilesTouched(diffStats?.filesTouched)
  );
  intent.description_length_bucket = normalizeDescriptionLengthBucket(
    contract.intent?.description_length_bucket ?? bucketDescription(contract.taskText)
  );
  intent.is_greenfield = normalizeBoolean(contract.intent?.is_greenfield);
  intent.is_migration = normalizeBoolean(contract.intent?.is_migration);
  intent.requires_tests = normalizeBoolean(contract.intent?.requires_tests);
  intent.cross_service = normalizeBoolean(contract.intent?.cross_service);
  intent.ui_heavy = normalizeBoolean(contract.intent?.ui_heavy);
  intent.risk_level = normalizeRiskLevel(contract.intent?.risk_level);
  return intent;
}
function nullIntent() {
  return {
    task_type: null,
    language: null,
    domain: null,
    complexity: null,
    repo_size_bucket: null,
    files_touched_bucket: null,
    description_length_bucket: null,
    is_greenfield: null,
    is_migration: null,
    requires_tests: null,
    cross_service: null,
    ui_heavy: null,
    risk_level: null
  };
}
function collectTouchedOutOfScopeFiles(diffStats, contract) {
  if (!diffStats || !contract?.scope) return null;
  const allowedFiles = new Set((contract.scope.allowedFiles ?? []).map(normalizeRepoPath).filter(Boolean));
  const allowedPrefixes = (contract.scope.allowedPrefixes ?? []).map(normalizeRepoPath).filter((path2) => Boolean(path2)).map((path2) => path2.endsWith("/") ? path2 : `${path2}/`);
  if (allowedFiles.size === 0 && allowedPrefixes.length === 0) return null;
  let outOfScope = 0;
  for (const file of diffStats.changedFiles) {
    const normalized2 = normalizeRepoPath(file);
    if (!normalized2) {
      outOfScope += 1;
      continue;
    }
    const allowed = allowedFiles.has(normalized2) || allowedPrefixes.some((prefix) => normalized2.startsWith(prefix));
    if (!allowed) outOfScope += 1;
  }
  return outOfScope;
}
function normalizeRepoPath(path2) {
  const normalized2 = path2.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized2 || normalized2 === "." || normalized2.startsWith("../") || normalized2.includes("/../")) {
    return null;
  }
  return normalized2;
}
function isTestFile(path2) {
  return TEST_FILE_PATTERN.test(path2);
}
function normalizeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}
function normalizeTaskType(value) {
  if (value === "test") return "tests";
  return typeof value === "string" && TASK_TYPES.has(value) ? value : null;
}
function normalizeLanguage(value) {
  return typeof value === "string" && LANGUAGES.has(value) ? value : null;
}
function normalizeDomain(value) {
  if (value === "full-stack") return "fullstack";
  if (value === "infrastructure" || value === "devtools") return "devops";
  if (value === "data-pipeline") return "data";
  return typeof value === "string" && DOMAINS.has(value) ? value : null;
}
function normalizeComplexityValue(value) {
  const normalized2 = normalizeComplexity(
    typeof value === "string" || typeof value === "number" ? value : void 0
  );
  if (typeof normalized2 !== "number" || !Number.isFinite(normalized2)) return null;
  return Math.max(0, Math.min(10, normalized2));
}
function normalizeRepoSizeBucket(value) {
  return typeof value === "string" && REPO_SIZE_BUCKETS.has(value) ? value : null;
}
function normalizeFilesTouchedBucket(value) {
  return typeof value === "string" && FILES_TOUCHED_BUCKETS.has(value) ? value : null;
}
function normalizeDescriptionLengthBucket(value) {
  return typeof value === "string" && DESCRIPTION_LENGTH_BUCKETS.has(value) ? value : null;
}
function normalizeRiskLevel(value) {
  return typeof value === "string" && RISK_LEVELS.has(value) ? value : null;
}
function bucketFilesTouched(count) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  if (count <= 15) return "6_15";
  return "16_plus";
}
function bucketDescription(taskText) {
  const trimmed = taskText?.trim();
  if (!trimmed) return null;
  const tokens2 = Math.ceil(trimmed.length / 4);
  if (tokens2 < 50) return "short";
  if (tokens2 < 200) return "medium";
  return "long";
}
function isExistingDir(path2) {
  try {
    return statSync2(path2).isDirectory();
  } catch {
    return false;
  }
}
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
function runGit2(cwd, args, options = {}) {
  const result = execArgvCommand(
    "git",
    args,
    { cwd, timeout: 3e4, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.failed) return null;
  if (result.exitCode !== 0 && !options.allowFailure) return null;
  if (result.exitCode !== 0 && options.allowFailure) return null;
  return result.stdout.trimEnd();
}

// src/diff-parsing.ts
function parseNameStatusOutput(output) {
  if (!output.trim()) {
    return [];
  }
  return output.trim().split(/\r?\n/).map((line) => {
    const [statusToken, firstPath = "", secondPath = ""] = line.split("	");
    const status = statusToken?.trim() ?? "";
    const normalizedStatus = status[0] ?? "";
    const path2 = normalizedStatus === "R" || normalizedStatus === "C" ? secondPath : firstPath;
    return {
      status: normalizedStatus,
      path: path2,
      previousPath: normalizedStatus === "R" || normalizedStatus === "C" ? firstPath : void 0
    };
  }).filter((entry) => entry.status && entry.path);
}
function extractPrNumber(subject) {
  const match = subject.match(/merge pull request #(\d+)\b/i) ?? subject.match(/\(#(\d+)\)\s*$/i);
  if (!match) {
    return null;
  }
  const prNumber = Number(match[1]);
  return Number.isInteger(prNumber) ? prNumber : null;
}

// src/survival-labeller.ts
var SURVIVAL_LABELLER_VERSION = "1.0.0";
var SURVIVAL_NORMALIZATION_VERSION = "1.0.0";
var DAY_SECONDS = 86400;
var GIT_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;
function assertIntegrationBranch(target) {
  if (target.integrationBranch === "main") {
    throw new Error(
      'survival-labeller: integrationBranch "main" is rejected (v1.0.0 contract): squash promotion rewrites the SHA lineage the labeller needs'
    );
  }
}
function enumerateMergedPrs(target, deps, options = {}) {
  assertIntegrationBranch(target);
  const maxCount = options.maxCount ?? 1e3;
  const result = deps.runGit([
    "log",
    "--first-parent",
    `--max-count=${maxCount}`,
    "--pretty=format:%H%x09%P%x09%ct%x09%s",
    target.integrationBranch
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`survival-labeller: cannot walk ${target.integrationBranch}: ${result.stderr.trim()}`);
  }
  const refs = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [sha, parentsText = "", epochText = "", ...subjectParts] = line.split("	");
    const subject = subjectParts.join("	").trim();
    const parents = parentsText.trim().split(/\s+/).filter(Boolean);
    const mergedAtEpoch = Number(epochText);
    if (!sha || parents.length === 0 || !Number.isFinite(mergedAtEpoch)) continue;
    const prNumber = extractPrNumber(subject);
    if (prNumber === null) continue;
    refs.push({
      prNumber,
      prUrl: `https://github.com/${target.owner}/${target.repo}/pull/${prNumber}`,
      mergeSha: sha,
      parentSha: parents[0],
      headSha: parents.length >= 2 ? parents[1] : sha,
      mergedAtEpoch,
      subject
    });
  }
  return refs;
}
function resolveMergedPr(target, deps, prUrl, options = {}) {
  assertIntegrationBranch(target);
  const numberMatch = prUrl.match(/\/pull\/(\d+)\b/);
  const prNumber = numberMatch ? Number(numberMatch[1]) : null;
  if (prNumber !== null) {
    const enumerated = enumerateMergedPrs(target, deps, { maxCount: options.searchLimit ?? 5e3 });
    const match = enumerated.find((ref2) => ref2.prNumber === prNumber);
    if (match) return { ...match, prUrl };
  }
  const metadata = deps.github.getPrMetadata(prUrl);
  if (!metadata) {
    return { prUrl, reason: "inaccessible_history", detail: "PR metadata unavailable" };
  }
  if (!metadata.mergedAt || !metadata.mergeCommitSha) {
    return { prUrl, reason: "unmerged_pr", detail: `PR state ${metadata.state || "unknown"} has no merge commit` };
  }
  const ancestor = deps.runGit([
    "merge-base",
    "--is-ancestor",
    metadata.mergeCommitSha,
    target.integrationBranch
  ]);
  if (ancestor.exitCode !== 0) {
    return {
      prUrl,
      reason: "inaccessible_history",
      detail: `merge commit ${metadata.mergeCommitSha} is not on ${target.integrationBranch}`
    };
  }
  const info = deps.runGit(["log", "-1", "--pretty=format:%H%x09%P%x09%ct%x09%s", metadata.mergeCommitSha]);
  const [sha, parentsText = "", epochText = "", ...subjectParts] = info.stdout.split("	");
  const parents = parentsText.trim().split(/\s+/).filter(Boolean);
  if (info.exitCode !== 0 || !sha || parents.length === 0) {
    return { prUrl, reason: "inaccessible_history", detail: "cannot read merge commit" };
  }
  return {
    prNumber: metadata.number,
    prUrl,
    mergeSha: sha,
    parentSha: parents[0],
    headSha: metadata.headSha ?? (parents.length >= 2 ? parents[1] : sha),
    mergedAtEpoch: Number(epochText),
    subject: subjectParts.join("	").trim() || metadata.title
  };
}
function isSkippedPr(value) {
  return value.reason !== void 0;
}
function stripDiffPathPrefix(raw) {
  const trimmed = raw.replace(/\t.*$/, "").trim();
  if (trimmed === "/dev/null") return null;
  return trimmed.replace(/^[ab]\//, "");
}
function parseZeroContextDiff(diffText) {
  const entries = [];
  let current = null;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = { oldPath: null, newPath: null, hunks: [] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("--- ")) {
      current.oldPath = stripDiffPathPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.newPath = stripDiffPathPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.oldPath = line.slice("rename from ".length).trim();
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.newPath = line.slice("rename to ".length).trim();
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      const oldStart = Number(hunk[1]);
      const oldCount = hunk[2] === void 0 ? 1 : Number(hunk[2]);
      const newStart = Number(hunk[3]);
      const newCount = hunk[4] === void 0 ? 1 : Number(hunk[4]);
      current.hunks.push({
        old: oldCount > 0 ? { start: oldStart, end: oldStart + oldCount - 1 } : null,
        new: newCount > 0 ? { start: newStart, end: newStart + newCount - 1 } : null
      });
    }
  }
  return entries.filter((entry) => entry.oldPath !== null || entry.newPath !== null);
}
function rangeLineCount(range) {
  return range.end - range.start + 1;
}
function countCoveredLines(range, covered) {
  let count = 0;
  for (const cover of covered) {
    const start = Math.max(range.start, cover.start);
    const end = Math.min(range.end, cover.end);
    if (end >= start) count += end - start + 1;
  }
  return count;
}
var WHITESPACE_DIFF_ARGS = ["-U0", "-w", "--ignore-blank-lines", "--find-renames", "--no-color"];
function buildSubstrate(deps, pr) {
  const result = deps.runGit(["diff", ...WHITESPACE_DIFF_ARGS, pr.parentSha, pr.mergeSha]);
  if (result.exitCode !== 0) return null;
  const files = [];
  for (const entry of parseZeroContextDiff(result.stdout)) {
    if (entry.hunks.length === 0) continue;
    const path2 = entry.newPath ?? entry.oldPath;
    if (!path2) continue;
    files.push({ path: path2, oldPath: entry.oldPath ?? path2, hunks: entry.hunks });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const lineRanges = [];
  let totalLines = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      lineRanges.push({
        path: file.path,
        old: hunk.old ? { start: hunk.old.start, end: hunk.old.end, sha: pr.parentSha } : null,
        new: hunk.new ? { start: hunk.new.start, end: hunk.new.end, sha: pr.mergeSha } : null
      });
      totalLines += hunk.new ? rangeLineCount(hunk.new) : hunk.old ? rangeLineCount(hunk.old) : 0;
    }
  }
  return { files, lineRanges, totalLines };
}
function blobAt(deps, sha, path2) {
  const result = deps.runGit(["rev-parse", "-q", "--verify", `${sha}:${path2}`]);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}
function analyseForward(deps, pr, substrate, terminalSha) {
  const nameStatus = deps.runGit(["diff", "--name-status", "--find-renames", pr.mergeSha, terminalSha]);
  if (nameStatus.exitCode !== 0) return null;
  const fate = /* @__PURE__ */ new Map();
  for (const entry of parseNameStatusOutput(nameStatus.stdout)) {
    fate.set(entry.previousPath ?? entry.path, { status: entry.status, newPath: entry.path });
  }
  const substratePathspec = /* @__PURE__ */ new Set();
  for (const file of substrate.files) {
    substratePathspec.add(file.path);
    const mapped = fate.get(file.path);
    if (mapped && mapped.status !== "D") substratePathspec.add(mapped.newPath);
  }
  const unified = deps.runGit([
    "diff",
    ...WHITESPACE_DIFF_ARGS,
    pr.mergeSha,
    terminalSha,
    "--",
    ...[...substratePathspec].sort()
  ]);
  if (unified.exitCode !== 0) return null;
  const forwardByOldPath = /* @__PURE__ */ new Map();
  for (const entry of parseZeroContextDiff(unified.stdout)) {
    const key = entry.oldPath ?? entry.newPath;
    if (!key) continue;
    const ranges = forwardByOldPath.get(key) ?? [];
    for (const hunk of entry.hunks) {
      if (hunk.old) ranges.push(hunk.old);
    }
    forwardByOldPath.set(key, ranges);
  }
  let survivingLines = 0;
  let rangeFollowup = false;
  let allFilesReverted = substrate.files.length > 0;
  const touchedPaths = /* @__PURE__ */ new Set();
  for (const file of substrate.files) {
    const fileFate = fate.get(file.path);
    const mappedPath = fileFate?.status === "D" ? null : fileFate?.newPath ?? file.path;
    const parentBlob = blobAt(deps, pr.parentSha, file.oldPath);
    const mergeBlob = blobAt(deps, pr.mergeSha, file.path);
    const terminalBlob = mappedPath ? blobAt(deps, terminalSha, mappedPath) : null;
    const fileReverted = parentBlob !== mergeBlob && terminalBlob === parentBlob;
    if (!fileReverted) allFilesReverted = false;
    touchedPaths.add(file.path);
    if (mappedPath && mappedPath !== file.path) touchedPaths.add(mappedPath);
    const covered = forwardByOldPath.get(file.path) ?? [];
    const fileDeleted = mappedPath === null;
    for (const hunk of file.hunks) {
      if (hunk.new) {
        const total = rangeLineCount(hunk.new);
        const undone = fileDeleted ? total : countCoveredLines(hunk.new, covered);
        survivingLines += total - undone;
        if (undone > 0) rangeFollowup = true;
      } else if (hunk.old) {
        const total = rangeLineCount(hunk.old);
        if (fileReverted) {
          rangeFollowup = true;
        } else {
          survivingLines += total;
        }
      }
    }
  }
  return {
    survivingLines,
    totalLines: substrate.totalLines,
    reverted: allFilesReverted,
    rangeFollowup,
    touchedPaths: [...touchedPaths].sort()
  };
}
var AGENT_ACTOR_PATTERN = /\[bot\]|claude|codex|copilot|devin|aider|anthropic|openai/i;
var AGENT_TRAILER_PATTERN = /co-authored-by:.*(claude|codex|copilot|devin|\[bot\])/i;
function classifyCommitActor(commit) {
  if (AGENT_ACTOR_PATTERN.test(`${commit.authorName} ${commit.authorEmail}`)) return "agent";
  if (AGENT_TRAILER_PATTERN.test(commit.body)) return "agent";
  return "human";
}
function attributeUndoers(deps, pr, terminalSha, touchedPaths, extraVotes) {
  const votes = new Set(extraVotes);
  if (touchedPaths.length > 0) {
    const result = deps.runGit([
      "log",
      "--first-parent",
      "--pretty=format:%H%x1f%an%x1f%ae%x1f%B%x1e",
      `${pr.mergeSha}..${terminalSha}`,
      "--",
      ...touchedPaths
    ]);
    if (result.exitCode === 0) {
      for (const record of result.stdout.split("")) {
        if (!record.trim()) continue;
        const [, authorName = "", authorEmail = "", body = ""] = record.split("");
        votes.add(classifyCommitActor({ authorName, authorEmail, body }));
      }
    }
  }
  if (votes.size === 1) return [...votes][0];
  return null;
}
var ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
function extractIssueKeys(text) {
  return new Set(text.match(ISSUE_KEY_PATTERN) ?? []);
}
var REASON_CODE_ORDER = [
  "exact_revert",
  "line_range_followup",
  "linked_issue_or_pr",
  "pre_merge_human_edit",
  "task_redispatch",
  "substantial_rewrite",
  "no_evidence"
];
function missingLabel(pr, target, deps, horizon2, reason, options = {}) {
  return buildArbiterSurvivalLabel({
    prUrl: pr.prUrl,
    horizon_days: horizon2,
    label_provenance: "harvested",
    line_ranges: options.lineRanges ?? [],
    outcome: {
      survived: null,
      survival_ratio: null,
      reverted: null,
      undone_by: null,
      followup: null,
      reason_codes: [reason]
    },
    envelope: {
      labeller_version: SURVIVAL_LABELLER_VERSION,
      normalization_version: SURVIVAL_NORMALIZATION_VERSION,
      pr_head_sha: pr.headSha,
      merge_sha: pr.mergeSha,
      horizon_terminal_sha: options.terminalSha ?? pr.mergeSha,
      integration_branch: target.integrationBranch,
      computed_at: deps.now().toISOString()
    }
  });
}
function resolveHorizonTerminal(deps, target, cutoffEpoch) {
  const cutoffIso = new Date(cutoffEpoch * 1e3).toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = deps.runGit([
    "log",
    "--first-parent",
    "--max-count=1",
    `--until=${cutoffIso}`,
    "--pretty=format:%H",
    target.integrationBranch
  ]);
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}
function labelMergedPr(target, deps, pr, options = {}) {
  assertIntegrationBranch(target);
  const horizons = options.horizons ?? HORIZONS;
  const nowEpoch = Math.floor(deps.now().getTime() / 1e3);
  const substrate = buildSubstrate(deps, pr);
  let crossReferences = null;
  const linkedReferencesAt = (cutoffEpoch) => {
    if (options.includeLinkedReferences === false) return false;
    if (crossReferences === null) {
      try {
        crossReferences = deps.github.listCrossReferences(pr.prNumber);
      } catch (error) {
        deps.onDiagnostic?.(`cross-reference lookup failed for #${pr.prNumber}: ${String(error)}`);
        crossReferences = [];
      }
    }
    return crossReferences.some(
      (ref2) => ref2.createdAtEpoch > pr.mergedAtEpoch && ref2.createdAtEpoch <= cutoffEpoch
    );
  };
  const issueKeys = extractIssueKeys(pr.subject);
  const redispatchAt = (cutoffEpoch) => {
    if (issueKeys.size === 0 || !options.allMergedPrs) return false;
    return options.allMergedPrs.some(
      (other) => other.mergeSha !== pr.mergeSha && other.mergedAtEpoch > pr.mergedAtEpoch && other.mergedAtEpoch <= cutoffEpoch && [...extractIssueKeys(other.subject)].some((key) => issueKeys.has(key))
    );
  };
  const labels = [];
  for (const horizon2 of horizons) {
    const cutoffEpoch = pr.mergedAtEpoch + horizon2 * DAY_SECONDS;
    if (cutoffEpoch > nowEpoch) {
      labels.push(missingLabel(pr, target, deps, horizon2, "missing_horizon", {
        lineRanges: substrate?.lineRanges
      }));
      continue;
    }
    if (!substrate) {
      labels.push(missingLabel(pr, target, deps, horizon2, "inaccessible_history"));
      continue;
    }
    if (substrate.totalLines === 0) {
      labels.push(missingLabel(pr, target, deps, horizon2, "insufficient_line_range_substrate"));
      continue;
    }
    const terminalSha = resolveHorizonTerminal(deps, target, cutoffEpoch);
    if (!terminalSha) {
      labels.push(missingLabel(pr, target, deps, horizon2, "inaccessible_history", {
        lineRanges: substrate.lineRanges
      }));
      continue;
    }
    const analysis = analyseForward(deps, pr, substrate, terminalSha);
    if (!analysis) {
      labels.push(missingLabel(pr, target, deps, horizon2, "inaccessible_history", {
        terminalSha,
        lineRanges: substrate.lineRanges
      }));
      continue;
    }
    const survivalRatio = analysis.totalLines === 0 ? 1 : analysis.survivingLines / analysis.totalLines;
    const linked = linkedReferencesAt(cutoffEpoch);
    const redispatched = redispatchAt(cutoffEpoch);
    const preMergeHumanEdit = options.preMergeHumanEdit === true;
    const followup = analysis.rangeFollowup || linked || redispatched || preMergeHumanEdit;
    const survived = !(analysis.reverted || followup);
    const undoneBy = analysis.rangeFollowup || analysis.reverted || preMergeHumanEdit ? attributeUndoers(
      deps,
      pr,
      terminalSha,
      analysis.rangeFollowup || analysis.reverted ? analysis.touchedPaths : [],
      preMergeHumanEdit ? ["human"] : []
    ) : null;
    const codes = /* @__PURE__ */ new Set();
    if (analysis.reverted) codes.add("exact_revert");
    if (analysis.rangeFollowup) codes.add("line_range_followup");
    if (linked) codes.add("linked_issue_or_pr");
    if (preMergeHumanEdit) codes.add("pre_merge_human_edit");
    if (redispatched) codes.add("task_redispatch");
    if (!analysis.reverted && survivalRatio < SUBSTANTIAL_REWRITE_THRESHOLD) {
      codes.add("substantial_rewrite");
    }
    if (codes.size === 0) codes.add("no_evidence");
    labels.push(buildArbiterSurvivalLabel({
      prUrl: pr.prUrl,
      horizon_days: horizon2,
      label_provenance: "harvested",
      line_ranges: substrate.lineRanges,
      outcome: {
        survived,
        survival_ratio: survivalRatio,
        reverted: analysis.reverted,
        undone_by: undoneBy,
        followup,
        reason_codes: REASON_CODE_ORDER.filter((code) => codes.has(code))
      },
      envelope: {
        labeller_version: SURVIVAL_LABELLER_VERSION,
        normalization_version: SURVIVAL_NORMALIZATION_VERSION,
        pr_head_sha: pr.headSha,
        merge_sha: pr.mergeSha,
        horizon_terminal_sha: terminalSha,
        integration_branch: target.integrationBranch,
        computed_at: deps.now().toISOString()
      }
    }));
  }
  return labels;
}
function summarizeLabels(repo, labels) {
  const horizons = {};
  for (const label2 of labels) {
    const key = String(label2.horizon_days);
    const bucket = horizons[key] ?? {
      rows: 0,
      missing: 0,
      survived: 0,
      followup: 0,
      substantially_rewritten: 0,
      reverted: 0,
      survival_rate: null
    };
    bucket.rows += 1;
    const outcome = label2.outcome.report_outcome;
    if (outcome === null) bucket.missing += 1;
    else bucket[outcome] += 1;
    horizons[key] = bucket;
  }
  for (const bucket of Object.values(horizons)) {
    const labelled2 = bucket.rows - bucket.missing;
    bucket.survival_rate = labelled2 > 0 ? bucket.survived / labelled2 : null;
  }
  return { repo, totalRows: labels.length, horizons };
}

// src/contract.ts
var LABELS_MAJOR = ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION.split(".")[0];
var SCAN_CONTRACT = Object.freeze({
  candidateFeatures: CANDIDATE_FEATURES_SCHEMA_VERSION,
  labels: `arbiter_survival_label/v${LABELS_MAJOR}`,
  labellerVersion: SURVIVAL_LABELLER_VERSION,
  normalizationVersion: SURVIVAL_NORMALIZATION_VERSION
});
function scanContractVersion() {
  return `${SCAN_CONTRACT.candidateFeatures}:${SCAN_CONTRACT.labels}`;
}

// src/default-deps.ts
var ScanUpstreamError = class extends Error {
  name = "ScanUpstreamError";
};
function classifyUpstreamFailure(result) {
  const stderr = result.stderr;
  if (result.failed) {
    return "gh executable not found; install GitHub CLI or run with --offline";
  }
  if (/HTTP 401|authentication|not logged in|GH_TOKEN|GITHUB_TOKEN/i.test(stderr)) {
    return "GitHub authentication failed";
  }
  if (/rate limit/i.test(stderr)) {
    const reset = stderr.match(/resets? at ([0-9TZ:.+-]+)/i);
    return reset ? `GitHub rate limit exceeded; resets at ${reset[1]}` : "GitHub rate limit exceeded";
  }
  if (/HTTP 403/i.test(stderr)) {
    return "GitHub authorization failed (HTTP 403)";
  }
  if (/HTTP 404|could not resolve|no pull requests found|not found/i.test(stderr)) {
    return "GitHub resource not found";
  }
  if (result.exitCode === -1 || /timed? ?out|ETIMEDOUT/i.test(stderr)) {
    return "GitHub request timed out";
  }
  return `GitHub request failed (gh exit ${result.exitCode})`;
}
function createDefaultDeps(target, options = {}) {
  const env = target.token ? { ...process.env, GH_TOKEN: target.token } : process.env;
  const strict = options.strictUpstream === true;
  const runGit3 = (args) => execArgvCommand("git", ["-C", target.repoDir, ...args], {
    env,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER
  });
  const runGh = (args) => execArgvCommand("gh", [...args], { env, cwd: target.repoDir });
  const github = {
    getPrMetadata(prUrl) {
      const result = runGh([
        "pr",
        "view",
        prUrl,
        "--json",
        "number,title,state,mergedAt,mergeCommit,headRefOid"
      ]);
      if (result.exitCode !== 0) {
        if (strict) throw new ScanUpstreamError(classifyUpstreamFailure(result));
        return null;
      }
      try {
        const parsed = JSON.parse(result.stdout);
        if (typeof parsed.number !== "number") return null;
        return {
          number: parsed.number,
          title: parsed.title ?? "",
          state: parsed.state ?? "",
          mergedAt: parsed.mergedAt ?? null,
          mergeCommitSha: parsed.mergeCommit?.oid ?? null,
          headSha: parsed.headRefOid ?? null
        };
      } catch {
        return null;
      }
    },
    listCrossReferences(prNumber) {
      const result = runGh([
        "api",
        `repos/${target.owner}/${target.repo}/issues/${prNumber}/timeline?per_page=100`,
        "-H",
        "Accept: application/vnd.github+json"
      ]);
      if (result.exitCode !== 0) {
        return [];
      }
      try {
        const events17 = JSON.parse(result.stdout);
        return events17.filter((event17) => event17.event === "cross-referenced" && event17.created_at).map((event17) => ({
          createdAtEpoch: Math.floor(Date.parse(event17.created_at) / 1e3),
          url: event17.source?.issue?.html_url ?? ""
        })).filter((ref2) => Number.isFinite(ref2.createdAtEpoch));
      } catch {
        return [];
      }
    }
  };
  return { runGit: runGit3, github, now: options.now ?? (() => /* @__PURE__ */ new Date()) };
}
function createOfflineGitHubClient() {
  return {
    getPrMetadata: () => null,
    listCrossReferences: () => []
  };
}
function createDefaultScanGitHubClient(owner, repo, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  const api = (path2) => {
    const result = execArgvCommand("gh", ["api", path2], { env });
    if (result.exitCode !== 0) {
      if (/HTTP 404|Not Found/i.test(result.stderr)) return null;
      throw new ScanUpstreamError(classifyUpstreamFailure(result));
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new ScanUpstreamError(`Invalid GitHub response for ${path2.split("?")[0]}`);
    }
  };
  const root = `repos/${owner}/${repo}`;
  return {
    getRepo() {
      const data = api(root);
      if (!data) throw new ScanUpstreamError("GitHub repository not found");
      return { defaultBranch: data.default_branch, private: data.private };
    },
    getPullRequest(number) {
      const data = api(`${root}/pulls/${number}`);
      if (!data || !data.merged_at) return null;
      return { number: data.number, title: data.title, body: data.body, authorLogin: data.user?.login ?? null, authorType: data.user?.type ?? null, headRef: data.head?.ref ?? null, headSha: data.head?.sha ?? "", labels: (data.labels ?? []).map((label2) => label2.name), mergedAt: data.merged_at };
    },
    listPullCommits(number) {
      const messages = [];
      for (let page = 1; page <= 100; page++) {
        const data = api(`${root}/pulls/${number}/commits?per_page=100&page=${page}`);
        if (!data) return messages;
        messages.push(...data.map((item) => item.commit.message));
        if (data.length < 100) break;
      }
      return messages;
    },
    getCheckConclusion(sha) {
      const data = api(`${root}/commits/${sha}/check-runs?per_page=100`);
      if (!data) return null;
      const conclusions = data.check_runs.map((run) => run.conclusion);
      if (conclusions.includes("failure")) return "failure";
      if (conclusions.includes("success")) return "success";
      if (conclusions.includes("neutral")) return "neutral";
      return "none";
    }
  };
}
function createOfflineScanGitHubClient() {
  return { getRepo: () => ({ defaultBranch: "master", private: false }), getPullRequest: () => null, listPullCommits: () => [], getCheckConclusion: () => null };
}

// src/inputs.ts
var ScanInputError = class extends Error {
  name = "ScanInputError";
};
function validateRepoDir(value) {
  if (!value || !value.trim()) {
    throw new ScanInputError("--repo is required");
  }
  return value;
}
function validateIntegrationBranch(value) {
  if (!value || !value.trim()) {
    throw new ScanInputError("--integration-branch is required");
  }
  if (value === "main") {
    throw new ScanInputError("integration branch main is rejected (v1.0.0 contract)");
  }
  return value;
}
function validatePrNumber(value) {
  if (value === void 0 || value === "") {
    throw new ScanInputError("--pr is required");
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || !/^\d+$/.test(String(value).trim())) {
    throw new ScanInputError("--pr must be a positive integer");
  }
  return parsed;
}
function validateGithubRepo(value) {
  if (value === void 0 || value === "") return void 0;
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    throw new ScanInputError("--github-repo must be in owner/name form");
  }
  return { owner: match[1], repo: match[2] };
}
function validatePrUrl(value) {
  if (value === void 0 || value === "") return void 0;
  if (!/^https?:\/\/\S+\/pull\/\d+\b/.test(value)) {
    throw new ScanInputError("--pr-url must be a full PR URL (https://\u2026/pull/<n>)");
  }
  return value;
}
function validateAsOf(value) {
  if (value === void 0 || value === "") return void 0;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/.test(value)) {
    throw new ScanInputError("--as-of must be an ISO-8601 timestamp (e.g., 2026-03-01 or 2026-03-01T00:00:00Z)");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ScanInputError("--as-of must be an ISO-8601 timestamp");
  }
  return parsed;
}
function validateHorizons(value) {
  if (value === void 0 || value === "") return [...HORIZONS];
  const parsed = value.split(",").map((part) => Number(part.trim()));
  const invalid = parsed.filter((entry) => !HORIZONS.includes(entry));
  if (invalid.length > 0) {
    throw new ScanInputError(
      `invalid horizons ${invalid.join(", ")}: allowed values are ${HORIZONS.join(", ")}`
    );
  }
  return parsed;
}
function validateMaxPrs(value) {
  if (value === void 0 || value === "") return 1e3;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ScanInputError("--max-prs must be a positive integer");
  }
  return parsed;
}
function validateTokenEnvName(value) {
  if (value === void 0 || value === "") return "GITHUB_TOKEN";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ScanInputError("--token-env must name an environment variable");
  }
  return value;
}

// src/serialize.ts
function serializeCandidateFeatures(features) {
  return `${JSON.stringify(features, collectKeysSorted(features), 2)}
`;
}
function collectKeysSorted(value) {
  const keys = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        keys.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  return [...keys].sort();
}
function serializeSurvivalLabels(labels) {
  if (labels.length === 0) return "";
  return labels.map((label2) => `${JSON.stringify(label2)}
`).join("");
}
function sortMergedPrsForEmission(prs) {
  return [...prs].sort((a, b) => a.mergedAtEpoch - b.mergedAtEpoch || a.prNumber - b.prNumber);
}

// src/shadow/cli.ts
import { existsSync as existsSync3, statSync as statSync3 } from "node:fs";
import { resolve as resolve3 } from "node:path";
import { parseArgs } from "node:util";

// src/shadow/errors.ts
var ShadowError = class extends Error {
  code;
  constructor(code, message) {
    super(message || code);
    this.name = "ShadowError";
    this.code = code;
  }
};

// src/shadow/scorer.ts
var BASELINE_V0_WEIGHTS = Object.freeze({
  baseZ: 2,
  locPenalty: 0.35,
  locSaturation: 2e3,
  filePenalty: 0.25,
  fileSaturation: 50,
  testBonus: 0.4,
  uncertainPenalty: 0.5,
  typeErrorPenalty: 0.3,
  typeErrorSaturation: 20,
  lintErrorPenalty: 0.3,
  lintErrorSaturation: 50,
  buildFailPenalty: 0.6,
  complexityDeltaPenalty: 0.2,
  complexityDeltaSaturation: 50,
  changeRequestsPenalty: 0.15,
  changeRequestsSaturation: 5,
  reviewRoundsPenalty: 0.05,
  reviewRoundsSaturation: 10
});
var NULL_STATIC_FEATURES = Object.freeze({
  type_errors: null,
  lint_errors: null,
  build_ok: null,
  complexity_delta: null,
  build_evidence: null,
  complexity_metric: null
});
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}
var BASELINE_V0 = Object.freeze({
  id: "baseline-v0",
  version: "0.1.0",
  score(features) {
    const w = BASELINE_V0_WEIGHTS;
    let z = w.baseZ;
    const locTouched = features.loc_touched ?? 0;
    z -= w.locPenalty * Math.log2(1 + locTouched) / Math.log2(1 + w.locSaturation) * 4;
    const filesTouched = features.files_touched ?? 0;
    z -= w.filePenalty * Math.min(filesTouched, w.fileSaturation) / w.fileSaturation * 4;
    if (features.tests_changed) {
      z += w.testBonus;
    }
    if (features.diff_uncertain) {
      z -= w.uncertainPenalty;
    }
    const typeErrors = features.type_errors ?? 0;
    z -= w.typeErrorPenalty * Math.min(typeErrors, w.typeErrorSaturation) / w.typeErrorSaturation;
    const lintErrors = features.lint_errors ?? 0;
    z -= w.lintErrorPenalty * Math.min(lintErrors, w.lintErrorSaturation) / w.lintErrorSaturation;
    if (features.build_ok === false) {
      z -= w.buildFailPenalty;
    }
    const complexityDelta = features.complexity_delta ?? 0;
    z -= w.complexityDeltaPenalty * clamp(complexityDelta, 0, w.complexityDeltaSaturation) / w.complexityDeltaSaturation;
    const changeRequests = features.change_requests ?? 0;
    z -= w.changeRequestsPenalty * Math.min(changeRequests, w.changeRequestsSaturation);
    const reviewRounds = features.review_rounds ?? 0;
    z -= w.reviewRoundsPenalty * Math.min(reviewRounds, w.reviewRoundsSaturation);
    const rawScore = logistic(z);
    const clamped = clamp(rawScore, 0, 1);
    return round6(clamped);
  }
});

// src/shadow/score.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join4 } from "node:path";

// src/shadow/discover.ts
var EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function isAncestor(runGit3, sha, ref2) {
  try {
    const result = runGit3(["merge-base", "--is-ancestor", sha, ref2]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
function discoverMerges(opts) {
  const { runGit: runGit3, ref: ref2, cursor, bootstrapDays, now, maxPrs } = opts;
  const merges = [];
  let cursorReset = false;
  let useBootstrapWindow = cursor === null;
  if (cursor !== null && !isAncestor(runGit3, cursor, ref2)) {
    cursorReset = true;
    useBootstrapWindow = true;
  }
  const cutoffEpoch = Math.floor(now().getTime() / 1e3) - bootstrapDays * 86400;
  const format = "%H%x09%P%x09%ct%x09%s";
  const sinceArgs = cutoffEpoch > 0 ? [`--since=${new Date(cutoffEpoch * 1e3).toISOString()}`] : [];
  const args = useBootstrapWindow ? ["log", "--first-parent", "--reverse", `--pretty=format:${format}`, ...sinceArgs, ref2] : ["log", "--first-parent", "--reverse", `--pretty=format:${format}`, `${cursor}..${ref2}`];
  const result = runGit3(args);
  if (result.exitCode !== 0) {
    throw new ShadowError("NOT_A_GIT_REPO");
  }
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [mergeSha, parentsText = "", epochText = "", ...subjectParts] = line.split("	");
    if (!mergeSha || !/^[0-9a-f]{40}$/.test(mergeSha)) continue;
    const mergedAtEpoch = Number.parseInt(epochText, 10);
    if (!Number.isFinite(mergedAtEpoch)) continue;
    if (useBootstrapWindow && mergedAtEpoch < cutoffEpoch) continue;
    const parents = parentsText.trim().split(/\s+/).filter(Boolean);
    const parentSha = parents[0] ?? EMPTY_TREE_SHA;
    const subject = subjectParts.join("	");
    const prNumber = extractPrNumber(subject);
    merges.push({ mergeSha, parentSha, mergedAtEpoch, prNumber });
    if (merges.length >= maxPrs) break;
  }
  return { merges, cursorReset };
}

// src/shadow/store.ts
import * as fs from "node:fs";
import * as path from "node:path";
function ensureWritableDataDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    const probe = path.join(dir, `.probe-${process.pid}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch {
    throw new ShadowError("DATA_DIR_UNWRITABLE");
  }
}
function writeFileAtomic(file, content) {
  const tempFile = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  let fd = null;
  try {
    fd = fs.openSync(tempFile, "w");
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
    try {
      fs.unlinkSync(tempFile);
    } catch {
    }
    throw error;
  }
}
function readJsonl(file, validate) {
  const rows = [];
  let malformed = 0;
  if (!fs.existsSync(file)) {
    return { rows, malformed };
  }
  try {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const result = validate(parsed);
        if (result.ok && result.value) {
          rows.push(result.value);
        } else {
          malformed++;
        }
      } catch {
        malformed++;
      }
    }
  } catch {
  }
  return { rows, malformed };
}
function appendJsonl(file, rows, validate) {
  for (const row of rows) {
    const result = validate(row);
    if (!result.ok) {
      throw new ShadowError("INVALID_ROW");
    }
  }
  if (rows.length === 0) {
    return;
  }
  let existingContent = "";
  if (fs.existsSync(file)) {
    existingContent = fs.readFileSync(file, "utf-8");
  }
  const newLines = rows.map((row) => JSON.stringify(row));
  const trimmed = existingContent.length > 0 && !existingContent.endsWith("\n") ? `${existingContent}
` : existingContent;
  const newContent = `${trimmed}${newLines.join("\n")}
`;
  writeFileAtomic(file, newContent);
}
function readState(dir, repo, scorerId, scorerVersion) {
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) {
    return {
      state: initialShadowState(repo, scorerId, scorerVersion),
      corrupt: false
    };
  }
  try {
    const content = fs.readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(content);
    const result = validateShadowState(parsed);
    if (result.ok) {
      return { state: result.value, corrupt: false };
    } else {
      return {
        state: {
          ...initialShadowState(repo, scorerId, scorerVersion),
          last_run_status: "error",
          last_error_code: "STATE_CORRUPT"
        },
        corrupt: true
      };
    }
  } catch {
    return {
      state: {
        ...initialShadowState(repo, scorerId, scorerVersion),
        last_run_status: "error",
        last_error_code: "STATE_CORRUPT"
      },
      corrupt: true
    };
  }
}
function writeState(dir, state) {
  const stateFile = path.join(dir, "state.json");
  const result = validateShadowState(state);
  if (!result.ok) {
    throw new ShadowError("INVALID_ROW");
  }
  writeFileAtomic(stateFile, JSON.stringify(state, null, 2));
}
function writeReport(dir, date2, serialized) {
  const reportsDir = path.join(dir, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  writeFileAtomic(path.join(reportsDir, `${date2}.json`), serialized);
}

// src/shadow/score.ts
function defaultMakeGitRunner(dir) {
  return (args) => execArgvCommand("git", ["-C", dir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER });
}
function runShadowScore(opts) {
  const {
    dataDir,
    repo,
    integrationBranch,
    threshold,
    bootstrapDays,
    maxPrs,
    runGit: runGit3,
    now,
    log,
    scorer = BASELINE_V0,
    makeGitRunner: makeGitRunner2 = defaultMakeGitRunner,
    extract = extractCandidateFeatures
  } = opts;
  ensureWritableDataDir(dataDir);
  const { state: oldState, corrupt } = readState(dataDir, repo, scorer.id, scorer.version);
  const cursorBefore = oldState.last_seen_merge_sha;
  const scoresFile = join4(dataDir, "scores.jsonl");
  const existing = readJsonl(scoresFile, validateShadowScoreRow);
  const existingMergeShas = new Set(existing.rows.map((r) => r.merge_sha));
  let cursorAfter = cursorBefore;
  let scored = 0;
  let skipped = 0;
  let status = "ok";
  let lastError = null;
  let cursorReset = false;
  try {
    const discovered = discoverMerges({
      runGit: runGit3,
      ref: integrationBranch,
      cursor: cursorBefore,
      bootstrapDays,
      now,
      maxPrs
    });
    cursorReset = discovered.cursorReset;
    const rows = [];
    if (discovered.merges.length > 0) {
      runGit3(["worktree", "prune"]);
      const worktreeDir = mkdtempSync(join4(tmpdir(), "hokusai-shadow-"));
      const added = runGit3([
        "worktree",
        "add",
        "--detach",
        "--no-checkout",
        "--force",
        worktreeDir
      ]);
      if (added.exitCode !== 0) {
        throw new ShadowError("EXTRACT_FAILED");
      }
      const runWorktreeGit = makeGitRunner2(worktreeDir);
      try {
        for (const merge of discovered.merges) {
          if (existingMergeShas.has(merge.mergeSha)) {
            skipped++;
            cursorAfter = merge.mergeSha;
            continue;
          }
          try {
            const moved = runWorktreeGit(["update-ref", "--no-deref", "HEAD", merge.mergeSha]);
            if (moved.exitCode !== 0) {
              throw new ShadowError("EXTRACT_FAILED");
            }
            const features = extract({
              checkoutDir: worktreeDir,
              // The extractor stringifies this; offline mode never sends it
              // anywhere. Non-PR merges fall back to the SHA.
              prNumber: merge.prNumber ?? merge.mergeSha,
              baseRef: merge.parentSha,
              offline: true,
              staticFeatures: NULL_STATIC_FEATURES
            });
            const score = scorer.score(features);
            const row = {
              schema_version: "arbiter_shadow_score/v1",
              repo,
              pr_number: merge.prNumber,
              merge_sha: merge.mergeSha,
              merged_at: new Date(merge.mergedAtEpoch * 1e3).toISOString(),
              scored_at: now().toISOString(),
              scorer_id: scorer.id,
              scorer_version: scorer.version,
              score,
              threshold,
              would_flag: score < threshold,
              features
            };
            const validation = validateShadowScoreRow(row);
            if (!validation.ok) {
              log(`SHADOW_SKIP pr=${merge.prNumber ?? "none"} code=INVALID_ROW`);
              skipped++;
              status = "partial";
              cursorAfter = merge.mergeSha;
              continue;
            }
            rows.push(row);
            scored++;
            cursorAfter = merge.mergeSha;
          } catch {
            log(`SHADOW_SKIP pr=${merge.prNumber ?? "none"} code=EXTRACT_FAILED`);
            skipped++;
            status = "partial";
            cursorAfter = merge.mergeSha;
          }
        }
        if (rows.length > 0) {
          try {
            appendJsonl(scoresFile, rows, validateShadowScoreRow);
          } catch (error) {
            cursorAfter = cursorBefore;
            scored = 0;
            throw error;
          }
        }
      } finally {
        runGit3(["worktree", "remove", "--force", worktreeDir]);
        rmSync(worktreeDir, { recursive: true, force: true });
        runGit3(["worktree", "prune"]);
      }
    }
  } catch (error) {
    lastError = error instanceof ShadowError ? error.code : "INTERNAL";
    status = "error";
  }
  const newState = {
    schema_version: "arbiter_shadow_state/v1",
    repo,
    last_seen_merge_sha: cursorAfter,
    last_run_at: now().toISOString(),
    last_run_status: status,
    last_error_code: corrupt ? "STATE_CORRUPT" : cursorReset ? "CURSOR_RESET" : lastError,
    scorer_id: scorer.id,
    scorer_version: scorer.version
  };
  try {
    writeState(dataDir, newState);
  } catch {
  }
  return {
    scored,
    skipped,
    cursor_before: cursorBefore,
    cursor_after: cursorAfter,
    status
  };
}

// src/shadow/backfill.ts
import { join as join5 } from "node:path";
function runShadowBackfill(opts) {
  const {
    dataDir,
    horizonDays,
    target,
    deps,
    now,
    log,
    maxCount = 1e4,
    enumerate = enumerateMergedPrs,
    label: label2 = labelMergedPr
  } = opts;
  ensureWritableDataDir(dataDir);
  const scoresFile = join5(dataDir, "scores.jsonl");
  const outcomesFile = join5(dataDir, "outcomes.jsonl");
  const scoresResult = readJsonl(scoresFile, validateShadowScoreRow);
  const outcomesResult = readJsonl(outcomesFile, validateShadowOutcomeRow);
  const existingOutcomes = new Set(
    outcomesResult.rows.map((r) => `${r.repo}:${r.merge_sha}:${r.horizon_days}`)
  );
  const nowEpoch = Math.floor(now().getTime() / 1e3);
  const horizonSeconds = horizonDays * 86400;
  const candidates = [];
  let pending = 0;
  let unlabellable = 0;
  for (const score of scoresResult.rows) {
    if (existingOutcomes.has(`${score.repo}:${score.merge_sha}:${horizonDays}`)) continue;
    const mergedAtEpoch = Math.floor(new Date(score.merged_at).getTime() / 1e3);
    if (mergedAtEpoch + horizonSeconds > nowEpoch) {
      pending++;
      continue;
    }
    if (score.pr_number === null) {
      unlabellable++;
      continue;
    }
    candidates.push(score);
  }
  const rows = [];
  let labelled2 = 0;
  let skipped = 0;
  if (candidates.length > 0) {
    const allMergedPrs = enumerate(target, deps, { maxCount });
    const byMergeSha = new Map(allMergedPrs.map((p) => [p.mergeSha, p]));
    for (const score of candidates) {
      try {
        const prRef = byMergeSha.get(score.merge_sha);
        if (!prRef) {
          log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
          skipped++;
          continue;
        }
        const labelResults = label2(target, deps, prRef, {
          horizons: [horizonDays],
          allMergedPrs,
          includeLinkedReferences: false
        });
        const result = labelResults[0];
        if (!result) {
          pending++;
          continue;
        }
        if (result.outcome.reason_codes.includes("missing_horizon")) {
          pending++;
          continue;
        }
        const outcome = {
          schema_version: "arbiter_shadow_outcome/v1",
          repo: score.repo,
          pr_number: score.pr_number,
          merge_sha: score.merge_sha,
          horizon_days: horizonDays,
          labelled_at: now().toISOString(),
          survived: result.outcome.survived,
          label: {
            schema_version: result.schema_version,
            prUrl: result.prUrl,
            horizon_days: result.horizon_days,
            label_provenance: result.label_provenance,
            outcome: result.outcome,
            envelope: result.envelope
          }
        };
        const validation = validateShadowOutcomeRow(outcome);
        if (!validation.ok) {
          log(`SHADOW_SKIP pr=${score.pr_number} code=INVALID_ROW`);
          skipped++;
          continue;
        }
        rows.push(outcome);
        labelled2++;
      } catch {
        log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
        skipped++;
      }
    }
    if (rows.length > 0) {
      appendJsonl(outcomesFile, rows, validateShadowOutcomeRow);
    }
  }
  return { labelled: labelled2, pending, skipped, unlabellable };
}

// src/shadow/report.ts
import { join as join6 } from "node:path";
function ratio(n, d) {
  return d === 0 ? null : round4(n / d);
}
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}
var SWEEP_THRESHOLDS = Array.from({ length: 19 }, (_, i) => round4((i + 1) * 0.05));
function metricsAtThreshold({ scores, outcomeFor }, threshold) {
  let flagged = 0;
  let flaggedMatured = 0;
  let flaggedNotSurvived = 0;
  let flaggedSurvived = 0;
  let survived = 0;
  for (const score of scores) {
    const isFlagged = score.score < threshold;
    if (isFlagged) flagged++;
    const outcome = outcomeFor(score);
    if (!outcome || outcome.survived === null) continue;
    if (outcome.survived) survived++;
    if (isFlagged) {
      flaggedMatured++;
      if (outcome.survived) flaggedSurvived++;
      else flaggedNotSurvived++;
    }
  }
  return { flagged, flaggedMatured, flaggedNotSurvived, flaggedSurvived, survived };
}
function computeShadowReport(scores, outcomes, opts) {
  const { windowDays, horizonDays, now, thresholds = SWEEP_THRESHOLDS } = opts;
  const nowTime = now();
  const cutoff = new Date(nowTime.getTime() - windowDays * 86400 * 1e3);
  const windowScores = scores.filter((s) => new Date(s.merged_at) >= cutoff);
  const outcomesByKey = /* @__PURE__ */ new Map();
  for (const o of outcomes) {
    if (o.horizon_days === horizonDays) {
      outcomesByKey.set(`${o.repo}:${o.merge_sha}`, o);
    }
  }
  const outcomeFor = (score) => outcomesByKey.get(`${score.repo}:${score.merge_sha}`);
  const repoScores = /* @__PURE__ */ new Map();
  for (const s of windowScores) {
    const list = repoScores.get(s.repo);
    if (list) list.push(s);
    else repoScores.set(s.repo, [s]);
  }
  const repos = [];
  for (const [repo, scored] of repoScores.entries()) {
    const inputs = { scores: scored, outcomeFor };
    const n_scored = scored.length;
    let n_matured = 0;
    let n_unlabelled = 0;
    for (const score of scored) {
      const outcome = outcomeFor(score);
      if (!outcome) continue;
      if (outcome.survived === null) n_unlabelled++;
      else n_matured++;
    }
    const lastScore = scored[scored.length - 1];
    const mainThreshold = lastScore ? lastScore.threshold : 0.5;
    const main2 = metricsAtThreshold(inputs, mainThreshold);
    const scorerCounts = /* @__PURE__ */ new Map();
    for (const score of scored) {
      const key = `${score.scorer_id}\0${score.scorer_version}`;
      scorerCounts.set(key, (scorerCounts.get(key) ?? 0) + 1);
    }
    let topScorerKey = "";
    let topScorerCount = -1;
    for (const [key, count] of scorerCounts.entries()) {
      if (count > topScorerCount) {
        topScorerKey = key;
        topScorerCount = count;
      }
    }
    const [topScorerId = "unknown", topScorerVersion = "unknown"] = topScorerKey.split("\0");
    const threshold_sweep = thresholds.map((t) => {
      const m = metricsAtThreshold(inputs, t);
      return {
        threshold: round4(t),
        would_flag_count: m.flagged,
        would_flag_rate: ratio(m.flagged, n_scored),
        precision: ratio(m.flaggedNotSurvived, m.flaggedMatured),
        false_positive_rate: ratio(m.flaggedSurvived, m.survived)
      };
    });
    repos.push({
      repo,
      n_scored,
      n_matured,
      n_unlabelled,
      n_flagged: main2.flagged,
      would_flag_rate: ratio(main2.flagged, n_scored),
      precision: ratio(main2.flaggedNotSurvived, main2.flaggedMatured),
      false_positive_rate: ratio(main2.flaggedSurvived, main2.survived),
      base_survival_rate: ratio(main2.survived, n_matured),
      scorer_id: topScorerId,
      scorer_version: topScorerVersion,
      scorer_mixed: scorerCounts.size > 1,
      threshold_sweep
    });
  }
  return {
    schema_version: "arbiter_shadow_report/v1",
    generated_at: nowTime.toISOString(),
    window_days: windowDays,
    horizon_days: horizonDays,
    malformed_lines: { scores: 0, outcomes: 0 },
    repos: repos.sort((a, b) => a.repo.localeCompare(b.repo))
  };
}
function runShadowReport(opts) {
  const { dataDir, windowDays, horizonDays, now, log } = opts;
  ensureWritableDataDir(dataDir);
  const scoresResult = readJsonl(join6(dataDir, "scores.jsonl"), validateShadowScoreRow);
  const outcomesResult = readJsonl(join6(dataDir, "outcomes.jsonl"), validateShadowOutcomeRow);
  const report = computeShadowReport(scoresResult.rows, outcomesResult.rows, {
    windowDays,
    horizonDays,
    now
  });
  report.malformed_lines.scores = scoresResult.malformed;
  report.malformed_lines.outcomes = outcomesResult.malformed;
  const serialized = JSON.stringify(report, null, 2);
  const date2 = now().toISOString().slice(0, 10);
  writeReport(dataDir, date2, serialized);
  log(serialized);
  return report;
}

// src/shadow/cli.ts
var SHADOW_COMMANDS = ["shadow-score", "shadow-backfill", "shadow-report"];
function isShadowCommand(command) {
  return SHADOW_COMMANDS.includes(command);
}
var SHADOW_OPTION_SPEC = {
  "data-dir": { type: "string" },
  "repo": { type: "string" },
  "github-repo": { type: "string" },
  "integration-branch": { type: "string" },
  "threshold": { type: "string" },
  "bootstrap-days": { type: "string" },
  "max-prs": { type: "string" },
  "horizon-days": { type: "string" },
  "window-days": { type: "string" }
};
function parseBoundedFloat(raw, fallback, min, max) {
  if (raw === void 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ShadowError("INVALID_ARG");
  }
  return value;
}
function parsePositiveInt(raw, fallback) {
  if (raw === void 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ShadowError("INVALID_ARG");
  }
  return value;
}
function parseHorizon(raw) {
  const value = raw === void 0 ? 30 : Number(raw);
  const horizon2 = HORIZONS.find((h) => h === value);
  if (horizon2 === void 0) {
    throw new ShadowError("INVALID_ARG");
  }
  return horizon2;
}
function makeGitRunner(dir) {
  return (args) => execArgvCommand("git", ["-C", dir, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER });
}
function checkRepoPreconditions(repoDir, runGit3) {
  if (!existsSync3(repoDir) || !statSync3(repoDir).isDirectory()) {
    throw new ShadowError("NOT_A_GIT_REPO");
  }
  const inside = runGit3(["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    throw new ShadowError("NOT_A_GIT_REPO");
  }
  const shallow = runGit3(["rev-parse", "--is-shallow-repository"]);
  if (shallow.stdout.trim() === "true") {
    throw new ShadowError("SHALLOW_CLONE");
  }
}
function detectGithubRepo(runGit3) {
  const result = runGit3(["remote", "get-url", "origin"]);
  if (result.exitCode !== 0) return null;
  const match = result.stdout.trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
function runShadowCli(command, args, io) {
  const log = io.log;
  const now = io.now ?? (() => /* @__PURE__ */ new Date());
  try {
    if (!isShadowCommand(command)) {
      throw new ShadowError("INVALID_ARG");
    }
    let values;
    try {
      ({ values } = parseArgs({
        args: [...args],
        options: SHADOW_OPTION_SPEC,
        strict: true,
        allowPositionals: false
      }));
    } catch {
      throw new ShadowError("INVALID_ARG");
    }
    const dataDir = values["data-dir"];
    if (!dataDir) {
      throw new ShadowError("INVALID_ARG");
    }
    const threshold = parseBoundedFloat(values["threshold"], 0.5, 0, 1);
    const bootstrapDays = parsePositiveInt(values["bootstrap-days"], 30);
    const maxPrs = parsePositiveInt(values["max-prs"], 200);
    const horizonDays = parseHorizon(values["horizon-days"]);
    const windowDays = parsePositiveInt(values["window-days"], 30);
    if (command === "shadow-report") {
      runShadowReport({ dataDir, windowDays, horizonDays, now, log });
      return { exitCode: 0 };
    }
    const repoDir = resolve3(io.cwd, values["repo"] ?? ".");
    const runGit3 = makeGitRunner(repoDir);
    checkRepoPreconditions(repoDir, runGit3);
    let githubRepo;
    try {
      githubRepo = validateGithubRepo(values["github-repo"]) ?? null;
    } catch {
      throw new ShadowError("INVALID_ARG");
    }
    githubRepo = githubRepo ?? detectGithubRepo(runGit3);
    if (!githubRepo) {
      throw new ShadowError("INVALID_ARG");
    }
    const repoSlug = `${githubRepo.owner}/${githubRepo.repo}`;
    const integrationBranch = values["integration-branch"];
    if (!integrationBranch || integrationBranch === "main") {
      throw new ShadowError("INVALID_ARG");
    }
    if (command === "shadow-score") {
      const result = runShadowScore({
        dataDir,
        repo: repoSlug,
        integrationBranch,
        threshold,
        bootstrapDays,
        maxPrs,
        runGit: runGit3,
        now,
        log,
        scorer: BASELINE_V0
      });
      log(`SHADOW_OK scored=${result.scored} skipped=${result.skipped} status=${result.status}`);
    } else {
      const target = {
        owner: githubRepo.owner,
        repo: githubRepo.repo,
        integrationBranch,
        repoDir
      };
      const deps = createDefaultDeps(target, { now });
      deps.github = createOfflineGitHubClient();
      const result = runShadowBackfill({ dataDir, horizonDays, target, deps, now, log });
      log(
        `SHADOW_OK labelled=${result.labelled} pending=${result.pending} skipped=${result.skipped} unlabellable=${result.unlabellable}`
      );
    }
    return { exitCode: 0 };
  } catch (error) {
    const code = error instanceof ShadowError ? error.code : "INTERNAL";
    log(`SHADOW_ERROR code=${code}`);
    return { exitCode: 0 };
  }
}

// src/report-cli.ts
import { existsSync as existsSync5, mkdtempSync as mkdtempSync3, readFileSync as readFileSync4, rmSync as rmSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join9, resolve as resolve4 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

// src/orchestrate/integration-branch.ts
function resolveIntegrationBranch(input) {
  if (input.explicit) {
    if (input.explicit === "main") throw new ScanInputError("integration branch resolves to main; S2 v1.0.0 rejects main");
    return input.explicit;
  }
  if (input.defaultBranch !== "main") return input.defaultBranch;
  const candidates = input.recentFirstParentSubjects.slice(0, 200).flatMap((subject) => {
    const match = subject.match(/(?:Merge pull request #|\(#)(\d+)/);
    return match ? [input.headRefLookup(Number(match[1]))] : [];
  });
  const counts = /* @__PURE__ */ new Map();
  for (const ref2 of candidates) if (ref2) counts.set(ref2, (counts.get(ref2) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] / candidates.length >= 0.6 && best[0] !== "main" && input.remoteBranchExists(best[0])) return best[0];
  throw new ScanInputError("integration branch resolves to main; S2 v1.0.0 rejects main. Pass --integration-branch <ref> or wait for S2 v1.1.0 (advisory main).");
}

// src/orchestrate/scan-report.ts
import { mkdtempSync as mkdtempSync2, rmSync as rmSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join8 } from "node:path";

// src/attribution/metadata-block.ts
var BLOCK_REGEX = /<!-- wavemill-meta\n([\s\S]*?)\n-->/g;
function extractMetadataBlock(body) {
  let block = null;
  for (const match of body.matchAll(BLOCK_REGEX)) block = match[1] ?? "";
  return { block, bodyWithoutBlock: block === null ? body : body.replace(BLOCK_REGEX, "").trim() };
}

// src/attribution/engine.ts
var ATTRIBUTION_SIGNALS = Object.freeze([
  "botAuthor",
  "coAuthoredBy",
  "branchPrefix",
  "label",
  "commitSignature",
  "wavemillMeta",
  "executedRoute"
]);
var TIER_RANK = { verified: 3, strong: 2, weak: 1 };
var SIGNAL_TIER = {
  botAuthor: "strong",
  coAuthoredBy: "strong",
  branchPrefix: "weak",
  label: "weak",
  commitSignature: "strong",
  wavemillMeta: "strong"
};
function harness(def) {
  return def;
}
var HARNESS_REGISTRY = Object.freeze([
  harness({
    id: "github-copilot",
    displayName: "GitHub Copilot",
    botLogins: ["copilot", "copilot-swe-agent", "copilot-swe-agent[bot]", "github-copilot[bot]"],
    coAuthorFragments: ["copilot"],
    branchPrefixes: ["copilot/", "copilot-"],
    labelNames: ["copilot", "github copilot", "copilot-swe-agent"],
    commitSignatureFragments: [
      "generated with github copilot",
      "generated by github copilot",
      "copilot-swe-agent"
    ]
  }),
  harness({
    id: "claude-code",
    displayName: "Claude Code",
    botLogins: ["claude", "claude[bot]", "anthropic-code-agent[bot]"],
    coAuthorFragments: ["claude", "anthropic"],
    branchPrefixes: ["claude/", "claude-"],
    labelNames: ["claude", "claude code"],
    commitSignatureFragments: ["generated with claude code", "generated by claude code"]
  }),
  harness({
    id: "codex",
    displayName: "OpenAI Codex",
    botLogins: ["codex[bot]", "openai-codex[bot]"],
    coAuthorFragments: ["codex", "openai"],
    branchPrefixes: ["codex/", "codex-"],
    labelNames: ["codex", "openai codex"],
    commitSignatureFragments: [
      "generated with openai codex",
      "generated by openai codex",
      "generated by codex",
      "generated with codex"
    ]
  }),
  harness({
    id: "cursor",
    displayName: "Cursor",
    botLogins: ["cursor[bot]"],
    coAuthorFragments: ["cursor"],
    branchPrefixes: ["cursor/", "cursor-"],
    labelNames: ["cursor"],
    commitSignatureFragments: []
  }),
  harness({
    id: "aider",
    displayName: "Aider",
    botLogins: [],
    coAuthorFragments: ["aider"],
    branchPrefixes: ["aider/", "aider-"],
    labelNames: ["aider"],
    commitSignatureFragments: ["written by aider", "generated by aider"]
  }),
  harness({
    id: "devin",
    displayName: "Devin",
    botLogins: ["devin-ai-integration[bot]", "devin-ai[bot]"],
    coAuthorFragments: ["devin"],
    branchPrefixes: ["devin/", "devin-"],
    labelNames: ["devin"],
    commitSignatureFragments: ["devin ai"]
  }),
  harness({
    id: "openhands",
    displayName: "OpenHands",
    botLogins: ["openhands-agent[bot]"],
    coAuthorFragments: ["openhands"],
    branchPrefixes: ["openhands/", "openhands-"],
    labelNames: ["openhands"],
    commitSignatureFragments: ["openhands agent"]
  }),
  harness({
    id: "sweep",
    displayName: "Sweep AI",
    botLogins: ["sweep-ai[bot]"],
    coAuthorFragments: ["sweep ai"],
    branchPrefixes: [],
    labelNames: ["sweep ai"],
    commitSignatureFragments: ["sweep ai"]
  }),
  harness({
    id: "codegen",
    displayName: "Codegen",
    botLogins: ["codegen-sh[bot]"],
    coAuthorFragments: ["codegen"],
    branchPrefixes: [],
    labelNames: ["codegen"],
    commitSignatureFragments: ["codegen ai"]
  }),
  harness({
    id: "swe-agent",
    displayName: "SWE-agent",
    botLogins: [],
    coAuthorFragments: ["swe-agent"],
    branchPrefixes: ["swe-agent/", "swe-agent-"],
    labelNames: [],
    commitSignatureFragments: []
  }),
  harness({
    id: "wavemill",
    displayName: "wavemill",
    // wavemill PRs are opened from the operator's account; identification comes
    // from the first-party wavemillMeta / executedRoute signals, not heuristics.
    botLogins: [],
    coAuthorFragments: [],
    branchPrefixes: [],
    labelNames: [],
    commitSignatureFragments: []
  })
]);
var GENERIC_AGENT_SIGNATURES = Object.freeze({
  branchPrefixes: Object.freeze(["ai-agent/", "agent/"]),
  labelNames: Object.freeze([
    "ai-generated",
    "ai generated",
    "ai-agent",
    "ai agent",
    "agent-authored",
    "agent authored"
  ])
});
var MODEL_SIGNATURES = Object.freeze([
  { fragment: "claude-fable-5", modelId: "claude-fable-5" },
  { fragment: "claude fable 5", modelId: "claude-fable-5" },
  { fragment: "claude-opus-4-8", modelId: "claude-opus-4-8" },
  { fragment: "claude opus 4.8", modelId: "claude-opus-4-8" },
  { fragment: "claude-sonnet-5", modelId: "claude-sonnet-5" },
  { fragment: "claude sonnet 5", modelId: "claude-sonnet-5" },
  { fragment: "claude-haiku-4-5", modelId: "claude-haiku-4-5-20251001" },
  { fragment: "claude haiku 4.5", modelId: "claude-haiku-4-5-20251001" },
  { fragment: "gpt-5.6-sol", modelId: "gpt-5.6-sol" },
  { fragment: "gpt-5.6", modelId: "gpt-5.6-sol" },
  { fragment: "gpt-5.5", modelId: "gpt-5.5" }
]);
var DEFAULT_ATTRIBUTION_CONFIG = Object.freeze({
  coverageFloorPercent: 60,
  minEligiblePrs: 20,
  extraBotLogins: [],
  extraBranchPrefixes: [],
  extraCoAuthorFragments: [],
  extraLabelNames: [],
  extraCommitSignatureFragments: [],
  extraHarnesses: [],
  extraModelSignatures: [],
  disabledSignals: []
});
var AttributionConfigError = class extends Error {
  field;
  constructor(field, message) {
    super(`Invalid attribution config at "${field}": ${message}`);
    this.name = "AttributionConfigError";
    this.field = field;
  }
};
var CONFIG_ARRAY_KEYS = [
  "extraBotLogins",
  "extraBranchPrefixes",
  "extraCoAuthorFragments",
  "extraLabelNames",
  "extraCommitSignatureFragments"
];
var CONFIG_KEYS = /* @__PURE__ */ new Set([
  "coverageFloorPercent",
  "minEligiblePrs",
  ...CONFIG_ARRAY_KEYS,
  "extraHarnesses",
  "extraModelSignatures",
  "disabledSignals"
]);
function isPlainObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new AttributionConfigError(field, "expected an array of non-empty strings");
  }
  return value.map((item) => item.trim());
}
function parseHarnessDefinition(value, field) {
  if (!isPlainObject4(value)) {
    throw new AttributionConfigError(field, "expected a harness definition object");
  }
  const allowed = /* @__PURE__ */ new Set([
    "id",
    "displayName",
    "botLogins",
    "coAuthorFragments",
    "branchPrefixes",
    "labelNames",
    "commitSignatureFragments"
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new AttributionConfigError(`${field}.${key}`, "unknown harness definition key");
    }
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new AttributionConfigError(`${field}.id`, "expected a non-empty string");
  }
  const id2 = value.id.trim();
  if (value.displayName !== void 0 && typeof value.displayName !== "string") {
    throw new AttributionConfigError(`${field}.displayName`, "expected a string");
  }
  const list = (key) => value[key] === void 0 ? [] : parseStringArray(value[key], `${field}.${key}`);
  return {
    id: id2,
    displayName: typeof value.displayName === "string" ? value.displayName : id2,
    botLogins: list("botLogins"),
    coAuthorFragments: list("coAuthorFragments"),
    branchPrefixes: list("branchPrefixes"),
    labelNames: list("labelNames"),
    commitSignatureFragments: list("commitSignatureFragments")
  };
}
function parseModelSignature(value, field) {
  if (!isPlainObject4(value)) {
    throw new AttributionConfigError(field, "expected a { fragment, modelId } object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "fragment" && key !== "modelId") {
      throw new AttributionConfigError(`${field}.${key}`, "unknown model signature key");
    }
  }
  if (typeof value.fragment !== "string" || !value.fragment.trim()) {
    throw new AttributionConfigError(`${field}.fragment`, "expected a non-empty string");
  }
  if (typeof value.modelId !== "string" || !value.modelId.trim()) {
    throw new AttributionConfigError(`${field}.modelId`, "expected a non-empty string");
  }
  return { fragment: value.fragment.trim().toLocaleLowerCase(), modelId: value.modelId.trim() };
}
function parseConfigLayer(value, fieldPrefix) {
  if (!isPlainObject4(value)) {
    throw new AttributionConfigError(fieldPrefix || "(root)", "expected an object");
  }
  const layer = {};
  const path2 = (key) => fieldPrefix ? `${fieldPrefix}.${key}` : key;
  for (const [key, raw] of Object.entries(value)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new AttributionConfigError(path2(key), "unknown config key");
    }
    if (key === "coverageFloorPercent") {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
        throw new AttributionConfigError(path2(key), "expected a number from 0 to 100");
      }
      layer.coverageFloorPercent = raw;
    } else if (key === "minEligiblePrs") {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        throw new AttributionConfigError(path2(key), "expected a non-negative integer");
      }
      layer.minEligiblePrs = raw;
    } else if (CONFIG_ARRAY_KEYS.includes(key)) {
      layer[key] = parseStringArray(raw, path2(key));
    } else if (key === "extraHarnesses") {
      if (!Array.isArray(raw)) {
        throw new AttributionConfigError(path2(key), "expected an array");
      }
      layer.extraHarnesses = raw.map(
        (item, index) => parseHarnessDefinition(item, `${path2(key)}[${index}]`)
      );
    } else if (key === "extraModelSignatures") {
      if (!Array.isArray(raw)) {
        throw new AttributionConfigError(path2(key), "expected an array");
      }
      layer.extraModelSignatures = raw.map(
        (item, index) => parseModelSignature(item, `${path2(key)}[${index}]`)
      );
    } else if (key === "disabledSignals") {
      const signals = parseStringArray(raw, path2(key));
      for (const signal of signals) {
        if (!ATTRIBUTION_SIGNALS.includes(signal)) {
          throw new AttributionConfigError(
            path2(key),
            `unknown signal "${signal}" (expected one of: ${ATTRIBUTION_SIGNALS.join(", ")})`
          );
        }
      }
      layer.disabledSignals = signals;
    }
  }
  return layer;
}
function mergeConfigLayer(base, layer) {
  const dedupe = (items) => [...new Set(items)];
  return {
    coverageFloorPercent: layer.coverageFloorPercent ?? base.coverageFloorPercent,
    minEligiblePrs: layer.minEligiblePrs ?? base.minEligiblePrs,
    extraBotLogins: dedupe([...base.extraBotLogins, ...layer.extraBotLogins ?? []]),
    extraBranchPrefixes: dedupe([...base.extraBranchPrefixes, ...layer.extraBranchPrefixes ?? []]),
    extraCoAuthorFragments: dedupe([
      ...base.extraCoAuthorFragments,
      ...layer.extraCoAuthorFragments ?? []
    ]),
    extraLabelNames: dedupe([...base.extraLabelNames, ...layer.extraLabelNames ?? []]),
    extraCommitSignatureFragments: dedupe([
      ...base.extraCommitSignatureFragments,
      ...layer.extraCommitSignatureFragments ?? []
    ]),
    extraHarnesses: [...base.extraHarnesses, ...layer.extraHarnesses ?? []],
    extraModelSignatures: [...base.extraModelSignatures, ...layer.extraModelSignatures ?? []],
    disabledSignals: dedupe([...base.disabledSignals, ...layer.disabledSignals ?? []])
  };
}
function resolveAttributionConfig(raw, repo) {
  if (raw === void 0 || raw === null) {
    return { ...DEFAULT_ATTRIBUTION_CONFIG };
  }
  if (!isPlainObject4(raw)) {
    throw new AttributionConfigError("(root)", "expected a JSON object");
  }
  const { repos, ...fileLevel } = raw;
  if (repos !== void 0 && !isPlainObject4(repos)) {
    throw new AttributionConfigError("repos", 'expected an object keyed by "owner/name"');
  }
  let config = mergeConfigLayer(DEFAULT_ATTRIBUTION_CONFIG, parseConfigLayer(fileLevel, ""));
  const repoLayers = /* @__PURE__ */ new Map();
  if (isPlainObject4(repos)) {
    for (const [slug, section3] of Object.entries(repos)) {
      repoLayers.set(slug, parseConfigLayer(section3, `repos.${slug}`));
    }
  }
  if (repo !== void 0) {
    const layer = repoLayers.get(repo);
    if (layer) {
      config = mergeConfigLayer(config, layer);
    }
  }
  return config;
}
var ROUTE_ROLES = ["planner", "coder", "reviewer"];
var SUPPORTED_ROUTE_SCHEMAS = /* @__PURE__ */ new Set(["1", "2"]);
var ROUTE_DECISION_MIN_SCHEMA = 2;
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function extractRouteDecision(raw, routeSchema, diagnostics) {
  if (routeSchema === null || !/^\d+$/.test(routeSchema) || Number(routeSchema) < ROUTE_DECISION_MIN_SCHEMA) {
    diagnostics.push(
      `route-decision-schema-mismatch: route_decision requires route_schema >= ${ROUTE_DECISION_MIN_SCHEMA} (got ${routeSchema ?? "none"}); ignored`
    );
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    diagnostics.push("malformed-route-decision: route_decision is not valid single-line JSON; ignored");
    return null;
  }
  if (!isPlainObject4(payload)) {
    diagnostics.push("malformed-route-decision: route_decision is not a JSON object; ignored");
    return null;
  }
  const decisionId = optionalString(payload.decision_id);
  const source = optionalString(payload.source);
  if (!decisionId || !source) {
    diagnostics.push("malformed-route-decision: route_decision lacks decision_id or source; ignored");
    return null;
  }
  const recommended = {};
  if (isPlainObject4(payload.recommended)) {
    for (const role of ROUTE_ROLES) {
      const model = optionalString(payload.recommended[role]);
      if (model) recommended[role] = model;
    }
  }
  const traceId = optionalString(payload.trace_id);
  const fallbackReason = optionalString(payload.fallback_reason);
  const supersedes = optionalString(payload.supersedes);
  return {
    decisionId,
    ...traceId ? { traceId } : {},
    source,
    ...fallbackReason ? { fallbackReason } : {},
    policyVersion: optionalString(payload.policy_version) ?? null,
    recommended,
    decidedAt: optionalString(payload.decided_at) ?? null,
    ...supersedes ? { supersedes } : {}
  };
}
function extractExecutedRoute(block) {
  const diagnostics = [];
  let routeSchema = null;
  let executedRouteRaw = null;
  let routeDecisionRaw = null;
  for (const line of block.split("\n")) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const [, field, value] = match;
    if (field === "route_schema") {
      routeSchema = value.trim();
    } else if (field === "executed_route") {
      executedRouteRaw = value.trim();
    } else if (field === "route_decision") {
      routeDecisionRaw = value.trim();
    }
  }
  const decision = routeDecisionRaw === null ? null : extractRouteDecision(routeDecisionRaw, routeSchema, diagnostics);
  if (executedRouteRaw === null) {
    return { route: null, decision, diagnostics };
  }
  if (routeSchema === null) {
    diagnostics.push("executed-route-missing-schema: executed_route present without route_schema; ignored");
    return { route: null, decision, diagnostics };
  }
  if (!SUPPORTED_ROUTE_SCHEMAS.has(routeSchema)) {
    diagnostics.push(`unsupported-route-schema: route_schema "${routeSchema}"; executed_route ignored`);
    return { route: null, decision, diagnostics };
  }
  let payload;
  try {
    payload = JSON.parse(executedRouteRaw);
  } catch {
    diagnostics.push("malformed-executed-route: executed_route is not valid single-line JSON; ignored");
    return { route: null, decision, diagnostics };
  }
  if (!isPlainObject4(payload)) {
    diagnostics.push("malformed-executed-route: executed_route is not a JSON object; ignored");
    return { route: null, decision, diagnostics };
  }
  const headShaRaw = payload.head_sha ?? payload.headSha ?? payload.head;
  const roles = {};
  for (const role of ROUTE_ROLES) {
    const entry = payload[role];
    if (!isPlainObject4(entry) || typeof entry.status !== "string") continue;
    const model = entry.model ?? entry.resolved_model ?? entry.resolvedModel;
    roles[role] = {
      status: entry.status,
      model: typeof model === "string" && model.trim() ? model.trim() : null
    };
  }
  return {
    route: {
      headSha: typeof headShaRaw === "string" && headShaRaw.trim() ? headShaRaw.trim() : null,
      roles,
      raw: executedRouteRaw
    },
    decision,
    diagnostics
  };
}
function normalized(value) {
  return value.toLocaleLowerCase().trim();
}
function extractCoAuthorTrailers(message) {
  const trailers = [];
  for (const line of message.split(/\r?\n/)) {
    const match = line.match(/^Co-authored-by:\s*(.+)$/i);
    if (match) {
      trailers.push(match[1].trim());
    }
  }
  return trailers;
}
var EvidenceCollector = class {
  byKey = /* @__PURE__ */ new Map();
  add(evidence) {
    const key = `${evidence.signal}|${evidence.harnessId ?? ""}|${evidence.modelId ?? ""}`;
    const existing = this.byKey.get(key);
    if (!existing || TIER_RANK[evidence.tier] > TIER_RANK[existing.tier]) {
      this.byKey.set(key, evidence);
    }
  }
  all() {
    return [...this.byKey.values()];
  }
};
function resolveIdentity(dimension2, evidence, diagnostics) {
  const key = dimension2 === "harness" ? "harnessId" : "modelId";
  const pointing = evidence.filter((item) => item[key] !== void 0);
  if (pointing.length === 0) {
    return { status: "unknown", evidence: [] };
  }
  const best = /* @__PURE__ */ new Map();
  for (const item of pointing) {
    const value = item[key];
    const existing = best.get(value);
    if (!existing || TIER_RANK[item.tier] > TIER_RANK[existing.tier]) {
      best.set(value, { value, tier: item.tier });
    }
  }
  const topRank = Math.max(...[...best.values()].map((candidate) => TIER_RANK[candidate.tier]));
  const winners = [...best.values()].filter((candidate) => TIER_RANK[candidate.tier] === topRank);
  if (winners.length > 1) {
    const values = winners.map((candidate) => candidate.value).sort().join(" vs ");
    diagnostics.push(`conflicting-${dimension2}-evidence: ${values} at tier ${winners[0].tier}`);
    return { status: "unknown", evidence: pointing };
  }
  return {
    status: "identified",
    value: winners[0].value,
    confidence: winners[0].tier,
    evidence: pointing
  };
}
function attributePullRequest(pr, config = DEFAULT_ATTRIBUTION_CONFIG) {
  const collector = new EvidenceCollector();
  const diagnostics = [];
  const enabled = (signal) => !config.disabledSignals.includes(signal);
  const harnesses = [...HARNESS_REGISTRY, ...config.extraHarnesses];
  const modelSignatures = [...MODEL_SIGNATURES, ...config.extraModelSignatures];
  let routeDecision = null;
  if (pr.body) {
    const { block } = extractMetadataBlock(pr.body);
    if (block !== null) {
      if (enabled("wavemillMeta")) {
        collector.add({
          signal: "wavemillMeta",
          value: "wavemill-meta",
          rule: "wavemill-meta-block-present",
          tier: SIGNAL_TIER.wavemillMeta,
          harnessId: "wavemill"
        });
      }
      if (enabled("executedRoute")) {
        const { route, decision, diagnostics: routeDiagnostics } = extractExecutedRoute(block);
        diagnostics.push(...routeDiagnostics);
        routeDecision = decision;
        if (route) {
          if (route.headSha && pr.headSha && route.headSha !== pr.headSha) {
            diagnostics.push(
              `stale-route-head: executed_route head ${route.headSha} != PR head ${pr.headSha}; route discarded`
            );
          } else {
            const executedRoles = ROUTE_ROLES.filter(
              (role) => route.roles[role]?.status === "executed"
            );
            if (executedRoles.length === 0) {
              diagnostics.push(
                'executed-route-no-executed-roles: no role has status "executed"; route not credited'
              );
            } else {
              const coder = route.roles.coder;
              const coderModel = coder?.status === "executed" && coder.model ? coder.model : void 0;
              collector.add({
                signal: "executedRoute",
                value: route.raw,
                rule: `executed-route:roles=${executedRoles.join(",")}`,
                tier: "verified",
                harnessId: "wavemill",
                ...coderModel ? { modelId: coderModel } : {}
              });
            }
          }
        }
      }
    }
  }
  if (enabled("botAuthor") && pr.authorLogin) {
    const login = normalized(pr.authorLogin);
    const strippedBotLogin = normalized(pr.authorType ?? "") === "bot" ? login.replace(/\[bot\]$/, "") : null;
    const matchesLogin = (candidates) => candidates.find(
      (candidate) => candidate === login || strippedBotLogin !== null && candidate === strippedBotLogin
    );
    for (const entry of harnesses) {
      const matched = matchesLogin(entry.botLogins.map(normalized));
      if (matched) {
        collector.add({
          signal: "botAuthor",
          value: pr.authorLogin,
          rule: `bot-login:${matched}`,
          tier: SIGNAL_TIER.botAuthor,
          harnessId: entry.id
        });
      }
    }
    const extraMatch = matchesLogin(config.extraBotLogins.map(normalized));
    if (extraMatch) {
      collector.add({
        signal: "botAuthor",
        value: pr.authorLogin,
        rule: `bot-login:${extraMatch}`,
        tier: SIGNAL_TIER.botAuthor
      });
    }
  }
  if (enabled("coAuthoredBy")) {
    for (const message of pr.commitMessages) {
      for (const trailer of extractCoAuthorTrailers(message)) {
        const trailerText = normalized(trailer);
        for (const entry of harnesses) {
          const matched = entry.coAuthorFragments.find(
            (fragment) => trailerText.includes(normalized(fragment))
          );
          if (matched) {
            collector.add({
              signal: "coAuthoredBy",
              value: trailer,
              rule: `co-author-fragment:${normalized(matched)}`,
              tier: SIGNAL_TIER.coAuthoredBy,
              harnessId: entry.id
            });
          }
        }
        const extraMatched = config.extraCoAuthorFragments.find(
          (fragment) => trailerText.includes(normalized(fragment))
        );
        if (extraMatched) {
          collector.add({
            signal: "coAuthoredBy",
            value: trailer,
            rule: `co-author-fragment:${normalized(extraMatched)}`,
            tier: SIGNAL_TIER.coAuthoredBy
          });
        }
        for (const signature of modelSignatures) {
          if (trailerText.includes(signature.fragment)) {
            collector.add({
              signal: "coAuthoredBy",
              value: trailer,
              rule: `model-fragment:${signature.fragment}`,
              tier: "strong",
              modelId: signature.modelId
            });
          }
        }
      }
    }
  }
  if (enabled("branchPrefix") && pr.headRef) {
    const headRef = normalized(pr.headRef);
    for (const entry of harnesses) {
      const matched = entry.branchPrefixes.find((prefix) => headRef.startsWith(normalized(prefix)));
      if (matched) {
        collector.add({
          signal: "branchPrefix",
          value: pr.headRef,
          rule: `branch-prefix:${normalized(matched)}`,
          tier: SIGNAL_TIER.branchPrefix,
          harnessId: entry.id
        });
      }
    }
    const generic = [...GENERIC_AGENT_SIGNATURES.branchPrefixes, ...config.extraBranchPrefixes].find(
      (prefix) => headRef.startsWith(normalized(prefix))
    );
    if (generic) {
      collector.add({
        signal: "branchPrefix",
        value: pr.headRef,
        rule: `branch-prefix:${normalized(generic)}`,
        tier: SIGNAL_TIER.branchPrefix
      });
    }
  }
  if (enabled("label")) {
    for (const label2 of pr.labels) {
      const labelName = normalized(label2);
      for (const entry of harnesses) {
        const matched = entry.labelNames.find((candidate) => labelName === normalized(candidate));
        if (matched) {
          collector.add({
            signal: "label",
            value: label2,
            rule: `label:${normalized(matched)}`,
            tier: SIGNAL_TIER.label,
            harnessId: entry.id
          });
        }
      }
      const generic = [...GENERIC_AGENT_SIGNATURES.labelNames, ...config.extraLabelNames].find(
        (candidate) => labelName === normalized(candidate)
      );
      if (generic) {
        collector.add({
          signal: "label",
          value: label2,
          rule: `label:${normalized(generic)}`,
          tier: SIGNAL_TIER.label
        });
      }
    }
  }
  if (enabled("commitSignature")) {
    for (const message of pr.commitMessages) {
      const messageText = normalized(message);
      for (const entry of harnesses) {
        const matched = entry.commitSignatureFragments.find(
          (fragment) => messageText.includes(normalized(fragment))
        );
        if (matched) {
          collector.add({
            signal: "commitSignature",
            value: normalized(matched),
            rule: `commit-signature:${normalized(matched)}`,
            tier: SIGNAL_TIER.commitSignature,
            harnessId: entry.id
          });
        }
      }
      const extraMatched = config.extraCommitSignatureFragments.find(
        (fragment) => messageText.includes(normalized(fragment))
      );
      if (extraMatched) {
        collector.add({
          signal: "commitSignature",
          value: normalized(extraMatched),
          rule: `commit-signature:${normalized(extraMatched)}`,
          tier: SIGNAL_TIER.commitSignature
        });
      }
      for (const signature of modelSignatures) {
        if (messageText.includes(signature.fragment)) {
          collector.add({
            signal: "commitSignature",
            value: signature.fragment,
            rule: `model-fragment:${signature.fragment}`,
            tier: "weak",
            modelId: signature.modelId
          });
        }
      }
    }
  }
  const evidence = collector.all();
  const signals = [...new Set(evidence.map((item) => item.signal))];
  const agentTier = evidence.reduce(
    (bestTier, item) => bestTier === void 0 || TIER_RANK[item.tier] > TIER_RANK[bestTier] ? item.tier : bestTier,
    void 0
  );
  return {
    number: pr.number,
    mergedAt: pr.mergedAt,
    signals,
    agent: evidence.length > 0 ? { status: "agent", ...agentTier ? { confidence: agentTier } : {}, evidence } : { status: "unknown", evidence: [] },
    harness: resolveIdentity("harness", evidence, diagnostics),
    model: resolveIdentity("model", evidence, diagnostics),
    ...routeDecision ? { routeDecision } : {},
    diagnostics
  };
}

// src/attribution/index.ts
var TIER = { verified: 1, strong: 0.8, weak: 0.5 };
var SIGNAL_METHOD = {
  executedRoute: "first_party_route_metadata",
  wavemillMeta: "first_party_route_metadata",
  botAuthor: "bot_author",
  coAuthoredBy: "co_authored_by_trailer",
  branchPrefix: "branch_prefix",
  label: "pr_label",
  commitSignature: "commit_signature"
};
function ownerRules(config) {
  return [
    ...config.extraBotLogins,
    ...config.extraBranchPrefixes,
    ...config.extraCoAuthorFragments,
    ...config.extraLabelNames,
    ...config.extraCommitSignatureFragments,
    ...config.extraHarnesses.flatMap((h) => [...h.botLogins, ...h.branchPrefixes, ...h.coAuthorFragments, ...h.labelNames, ...h.commitSignatureFragments]),
    ...config.extraModelSignatures.map((m) => m.fragment)
  ].map((value) => value.toLowerCase());
}
function methods2(evidence, config) {
  const extra = config ? ownerRules(config) : [];
  return [...new Set(evidence.map((item) => {
    const rule = item.rule.toLowerCase();
    return extra.some((fragment) => fragment && rule.endsWith(fragment)) ? "owner_config" : SIGNAL_METHOD[item.signal];
  }))].sort();
}
function toReportAttribution(value, config) {
  return {
    agent: { status: value.agent.status, confidence: value.agent.confidence ? TIER[value.agent.confidence] : null, methods: methods2(value.agent.evidence, config) },
    harness: { id: value.harness.status === "identified" ? value.harness.value ?? null : null, confidence: value.harness.confidence ? TIER[value.harness.confidence] : null, methods: methods2(value.harness.evidence, config) },
    exact_model: { id: value.model.status === "identified" ? value.model.value ?? null : null, confidence: value.model.confidence ? TIER[value.model.confidence] : null, methods: methods2(value.model.evidence, config), evidence: value.model.status !== "identified" ? null : value.model.evidence.some((item) => item.signal === "executedRoute" && item.modelId === value.model.value && item.tier === "verified") ? "first_party_executed" : "heuristic" }
  };
}

// src/report/suppression.ts
var DEFAULT_REPORT_POLICY = Object.freeze({
  policy_version: "1.0.0",
  min_cell_n: 20,
  min_agent_coverage: 0.6,
  min_harness_coverage: 0.6,
  min_exact_model_coverage: 0.6,
  min_cost_coverage: 0.6,
  min_reworked_for_retrospective: 20,
  ci_method: "wilson",
  ci_level: 0.95
});
var ArbiterReportBuildError = class extends Error {
  constructor(errors) {
    super(
      `Cannot build arbiter_report/v1: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
    );
    this.errors = errors;
    this.name = "ArbiterReportBuildError";
  }
  errors;
};
var ordered = (reasons2) => REPORT_SUPPRESSION_REASONS.filter((r) => reasons2.includes(r));
function hide(cell3, reasons2) {
  cell3.suppressed = true;
  cell3.value = null;
  cell3.ci = null;
  cell3.suppression_reasons = ordered([...cell3.suppression_reasons, ...reasons2]);
}
function rowsCells(row) {
  return Object.entries(row).filter(
    ([key]) => key === "cell" || key === "ratio" || key.endsWith("_rate")
  ).map(([, value]) => value);
}
function applyReportSuppression(draft, policy = DEFAULT_REPORT_POLICY) {
  const report = structuredClone(draft);
  report.policy = structuredClone(policy);
  const executed = report.prs.filter(
    (pr) => pr.attribution.exact_model.evidence === "first_party_executed"
  );
  const executedRate = executed.length / Math.max(1, report.coverage.prs_enumerated);
  const exact = report.coverage.attribution.exact_model.rate >= policy.min_exact_model_coverage && executedRate >= policy.min_exact_model_coverage;
  const harness2 = report.coverage.attribution.harness.rate >= policy.min_harness_coverage;
  const comparablePriced = executed.filter(
    (pr) => pr.cost?.actual_usd !== null && pr.cost?.actual_usd !== void 0
  ).length;
  const priced = Math.min(
    report.cost?.actual.prs_priced ?? 0,
    comparablePriced
  );
  const actualCoverage = priced / Math.max(1, executed.length);
  const actual = !!report.cost && !report.cost.actual.suppressed && priced >= policy.min_cell_n && actualCoverage >= policy.min_cost_coverage;
  const eligibility = report.eligibility;
  eligibility.exact_model_table = exact;
  eligibility.harness_table = harness2;
  eligibility.cost_adjusted_by_model = exact && actual;
  eligibility.retrospective = !!report.model_provenance && !!report.retrospective && report.retrospective.n_reworked >= policy.min_reworked_for_retrospective;
  const modelReasons = exact ? [] : harness2 ? ["exact_model_coverage_below_floor", "harness_only_evidence"] : ["exact_model_coverage_below_floor"];
  const harnessReasons = harness2 ? [] : ["harness_coverage_below_floor"];
  const costReasons = exact ? actual ? [] : ["cost_coverage_below_floor"] : modelReasons;
  const sectionReasons = {
    survival_by_horizon: [],
    risk_ratios: [],
    survival_by_model: modelReasons,
    survival_by_harness: harnessReasons,
    cost_adjusted_survival_by_model: costReasons
  };
  for (const [name, section3] of Object.entries(report.aggregates)) {
    const reason = sectionReasons[name];
    for (const row of section3.rows)
      for (const cell3 of rowsCells(row)) {
        if (cell3.n < policy.min_cell_n) hide(cell3, ["n_below_floor"]);
        if (reason.length) hide(cell3, reason);
      }
    const cells = section3.rows.flatMap(
      rowsCells
    );
    if (reason.length || !cells.length || cells.every((c) => c.suppressed)) {
      section3.status = "suppressed";
      section3.suppression_reasons = ordered([
        ...section3.suppression_reasons,
        ...reason,
        ...cells.flatMap((c) => c.suppression_reasons),
        ...!cells.length ? ["n_below_floor"] : []
      ]);
    } else {
      section3.status = "shown";
      section3.suppression_reasons = [];
    }
  }
  eligibility.cost_adjusted_by_model = eligibility.cost_adjusted_by_model && report.aggregates.cost_adjusted_survival_by_model.rows.some(
    (row) => !row.cell.suppressed
  );
  eligibility.model_routing_cta = exact && report.aggregates.survival_by_model.rows.some((r) => !r.cell.suppressed);
  eligibility.reasons = ordered([
    ...modelReasons,
    ...harnessReasons,
    ...costReasons,
    ...report.coverage.attribution.agent.rate < policy.min_agent_coverage ? ["agent_coverage_below_floor"] : []
  ]);
  if (report.retrospective) {
    const reasons2 = [];
    if (!report.model_provenance) reasons2.push("no_model_provenance");
    if (report.retrospective.n_reworked < policy.min_reworked_for_retrospective)
      reasons2.push("reworked_below_floor");
    for (const [name, cell3] of Object.entries({
      precision: report.retrospective.precision,
      recall: report.retrospective.recall,
      flagged_share: report.retrospective.flagged_share
    })) {
      if (cell3.n < policy.min_cell_n) hide(cell3, ["n_below_floor"]);
      if (name !== "flagged_share" && cell3.n < policy.min_reworked_for_retrospective)
        hide(cell3, ["reworked_below_floor"]);
      if (reasons2.length) hide(cell3, reasons2);
    }
    report.retrospective.suppressed = !eligibility.retrospective || [
      report.retrospective.precision,
      report.retrospective.recall,
      report.retrospective.flagged_share
    ].every((c) => c.suppressed);
    report.retrospective.suppression_reasons = report.retrospective.suppressed ? ordered([
      ...reasons2,
      ...report.retrospective.precision.suppression_reasons
    ]) : [];
  }
  if (report.cost) {
    for (const part of [report.cost.actual, report.cost.estimated])
      if (part.prs_priced < policy.min_cell_n) {
        part.total_usd = null;
        part.suppressed = true;
        part.suppression_reasons = ordered([
          ...part.suppression_reasons,
          "n_below_floor"
        ]);
      }
  }
  const valid = validateArbiterReportV1(report);
  if (!valid.ok) throw new ArbiterReportBuildError(valid.errors);
  return valid.value;
}

// src/report/stats.ts
var Z = 1.959963984540054;
var round42 = (n) => Math.round(n * 1e4) / 1e4;
function wilsonInterval(k, n) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) throw new RangeError("Invalid binomial counts");
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + Z * Z / n;
  const center = (p + Z * Z / (2 * n)) / denominator;
  const radius = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / denominator;
  return { low: round42(Math.max(0, center - radius)), high: round42(Math.min(1, center + radius)) };
}
function katzLogRatioInterval(k1, n1, k2, n2) {
  if (![k1, n1, k2, n2].every(Number.isInteger) || n1 < 0 || n2 < 0 || k1 < 0 || k2 < 0 || k1 > n1 || k2 > n2) throw new RangeError("Invalid risk counts");
  if (n1 === 0 || n2 === 0) return null;
  const correction = [k1, n1 - k1, k2, n2 - k2].some((n) => n === 0) ? 0.5 : 0;
  const a = k1 + correction;
  const b = n1 + 2 * correction;
  const c = k2 + correction;
  const d = n2 + 2 * correction;
  const ratio2 = a / b / (c / d);
  const se = Math.sqrt(1 / a - 1 / b + 1 / c - 1 / d);
  return { ratio: round42(ratio2), low: round42(Math.min(ratio2, Math.exp(Math.log(ratio2) - Z * se))), high: round42(Math.max(ratio2, Math.exp(Math.log(ratio2) + Z * se))) };
}
function nearestRankQuartiles(values) {
  if (values.length === 0) return null;
  const sorted2 = [...values].sort((a, b) => a - b);
  if (sorted2.some((v) => !Number.isFinite(v))) throw new RangeError("Non-finite quartile value");
  return [0.25, 0.5, 0.75].map((p) => sorted2[Math.ceil(sorted2.length * p) - 1]);
}
function quartileOf(value, cuts) {
  return value <= cuts[0] ? "q1" : value <= cuts[1] ? "q2" : value <= cuts[2] ? "q3" : "q4";
}

// src/report/aggregate.ts
var section2 = (rows) => ({ basis: "descriptive", status: "shown", suppression_reasons: [], rows });
var round43 = (value) => Math.round(value * 1e4) / 1e4;
var cell2 = (k, n) => {
  const ci = wilsonInterval(k, n);
  return { basis: "descriptive", n, value: n ? round43(k / n) : 0, ci: ci && { ...ci, level: 0.95 }, suppressed: false, suppression_reasons: [] };
};
var reworked = (row, h) => {
  const outcome = row.labels.find((label2) => label2.horizon_days === h)?.outcome.report_outcome;
  return outcome === "followup" || outcome === "substantially_rewritten" || outcome === "reverted";
};
var labelled = (row, h) => row.labels.find((label2) => label2.horizon_days === h)?.outcome.report_outcome != null;
function buildAggregates(rows, horizons) {
  const survival = [];
  const risks = [];
  const models = [];
  const harnesses = [];
  const outcomes = ["survived", "followup", "substantially_rewritten", "reverted"];
  for (const h of horizons) {
    const eligible = rows.filter((r) => labelled(r, h));
    for (const outcome of outcomes) survival.push({ horizon_days: h, outcome, cell: cell2(eligible.filter((r) => r.labels.find((l) => l.horizon_days === h)?.outcome.report_outcome === outcome).length, eligible.length) });
    const cuts = nearestRankQuartiles(eligible.map((r) => r.features.loc_touched).filter((v) => v !== null));
    for (const [feature, buckets] of Object.entries(REPORT_FEATURE_BUCKETS)) {
      const bucketOf = (r) => {
        if (feature === "tests_changed") return r.features.tests_changed === null ? null : String(r.features.tests_changed);
        if (feature === "files_touched_bucket") {
          if (r.features.files_touched_bucket !== null) return r.features.files_touched_bucket;
          const count = r.features.files_touched;
          return count === null ? null : count <= 1 ? "1" : count <= 5 ? "2_5" : count <= 15 ? "6_15" : "16_plus";
        }
        return r.features.loc_touched === null || !cuts ? null : quartileOf(r.features.loc_touched, cuts);
      };
      const known = eligible.filter((r) => bucketOf(r) !== null);
      for (const bucket of buckets) {
        const inside = known.filter((r) => bucketOf(r) === bucket);
        const outside = known.filter((r) => bucketOf(r) !== bucket);
        const k1 = inside.filter((r) => reworked(r, h)).length;
        const k2 = outside.filter((r) => reworked(r, h)).length;
        const ratio2 = katzLogRatioInterval(k1, inside.length, k2, outside.length);
        risks.push({ horizon_days: h, feature, bucket, rework_rate: cell2(k1, inside.length), baseline_rate: cell2(k2, outside.length), ratio: { basis: "descriptive", n: Math.min(inside.length, outside.length), value: ratio2?.ratio ?? 0, ci: ratio2 && { low: ratio2.low, high: ratio2.high, level: 0.95 }, suppressed: false, suppression_reasons: [] } });
      }
    }
    for (const id2 of [...new Set(eligible.map((r) => r.attribution.exact_model.id).filter((v) => v !== null))].sort()) {
      const group = eligible.filter((r) => r.attribution.exact_model.id === id2);
      models.push({ horizon_days: h, model_id: id2, cell: cell2(group.filter((r) => !reworked(r, h)).length, group.length) });
    }
    for (const id2 of [...new Set(eligible.map((r) => r.attribution.harness.id).filter((v) => v !== null))].sort()) {
      const group = eligible.filter((r) => r.attribution.harness.id === id2);
      harnesses.push({ horizon_days: h, harness_id: id2, cell: cell2(group.filter((r) => !reworked(r, h)).length, group.length) });
    }
  }
  return { survival_by_horizon: section2(survival), risk_ratios: section2(risks), survival_by_model: section2(models), survival_by_harness: section2(harnesses), cost_adjusted_survival_by_model: section2([]) };
}
function buildCoverage(rows, horizons) {
  const n = rows.length;
  const counts = (predicate) => {
    const identified = rows.filter(predicate).length;
    return { identified, unknown: n - identified, rate: n ? round43(identified / n) : 0 };
  };
  const agent = counts((r) => r.attribution.agent.status === "agent");
  const methods3 = /* @__PURE__ */ new Map();
  for (const row of rows) for (const dimension2 of ["agent", "harness", "exact_model"])
    for (const method of new Set(row.attribution[dimension2].methods)) methods3.set(`${dimension2}:${method}`, (methods3.get(`${dimension2}:${method}`) ?? 0) + 1);
  return {
    basis: "descriptive",
    prs_enumerated: n,
    prs_eligible: rows.filter((r) => horizons.some((h) => labelled(r, h))).length,
    labels_by_horizon: horizons.map((h) => {
      const present = rows.filter((r) => labelled(r, h)).length;
      const missing = /* @__PURE__ */ new Map();
      for (const row of rows) if (!labelled(row, h)) for (const reason of row.labels.find((l) => l.horizon_days === h)?.outcome.reason_codes ?? ["missing_horizon"]) missing.set(reason, (missing.get(reason) ?? 0) + 1);
      return { horizon_days: h, labelled: present, missing: [...missing].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })) };
    }),
    attribution: { agent: { identified_agent: agent.identified, identified_human_signal: 0, unknown: agent.unknown, rate: agent.rate }, harness: counts((r) => r.attribution.harness.id !== null), exact_model: counts((r) => r.attribution.exact_model.id !== null), methods: [...methods3].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => {
      const [dimension2, method] = key.split(":");
      return { dimension: dimension2, method, count };
    }) }
  };
}

// src/report/build.ts
function buildReportDraft(input) {
  const rows = [...input.rows].sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return {
    schema_version: ARBITER_REPORT_SCHEMA_VERSION,
    data_origin: "scan",
    repo: { host: "github", owner: input.owner, name: input.repo },
    scan: {
      scanned_at: input.asOf.toISOString(),
      as_of: input.asOf.toISOString(),
      scanner: { package: "@hokusai/scan", version: input.scannerVersion },
      integration_branch: input.integrationBranch,
      lookback_days: input.lookbackDays,
      window: { merged_from: input.mergedFrom.toISOString(), merged_to: input.asOf.toISOString() },
      horizons_days: [...input.horizons],
      contracts: { candidate_features: "candidate_features/v1", survival_label: "1.0.0", labeller_version: SURVIVAL_LABELLER_VERSION, normalization_version: SURVIVAL_NORMALIZATION_VERSION }
    },
    policy: structuredClone(DEFAULT_REPORT_POLICY),
    coverage: buildCoverage(rows, input.horizons),
    prs: rows,
    aggregates: buildAggregates(rows, input.horizons),
    retrospective: null,
    cost: null,
    model_provenance: null,
    eligibility: { exact_model_table: false, harness_table: false, cost_adjusted_by_model: false, retrospective: false, model_routing_cta: false, reasons: [] }
  };
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}
function emitReport(draft, policy = DEFAULT_REPORT_POLICY) {
  const report = applyReportSuppression(draft, policy);
  return { report, json: `${JSON.stringify(sorted(report), null, 2)}
` };
}

// src/orchestrate/enumerate.ts
function enumerateWindow(input) {
  const { runGit: runGit3, branch } = input;
  const cursorReset = !!input.cursor && !isAncestor(runGit3, input.cursor, branch);
  const cursor = cursorReset ? null : input.cursor;
  const tipResult = runGit3(["rev-parse", branch]);
  if (tipResult.exitCode !== 0) throw new Error(`Cannot resolve integration branch: ${branch}`);
  const tip = tipResult.stdout.trim();
  const since = input.from.getTime() > 0 ? [`--since=${input.from.toISOString()}`] : [];
  const args = ["log", "--first-parent", "--reverse", "--pretty=format:%H%x09%P%x09%ct%x09%s", ...cursor ? [] : since, ...cursor ? [`${cursor}..${branch}`] : [branch]];
  const result = runGit3(args);
  if (result.exitCode !== 0) throw new Error(`Cannot enumerate integration branch: ${branch}`);
  const merges = [];
  let skipped = 0;
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const [mergeSha, parentText = "", epochText = "", ...subjectParts] = line.split("	");
    if (!mergeSha || !/^[0-9a-f]{40}$/.test(mergeSha)) continue;
    const mergedAtEpoch = Number(epochText);
    if (!Number.isInteger(mergedAtEpoch) || mergedAtEpoch * 1e3 < input.from.getTime() || mergedAtEpoch * 1e3 > input.asOf.getTime()) continue;
    const subject = subjectParts.join("	");
    const prNumber = extractPrNumber(subject);
    if (prNumber === null) {
      skipped++;
      continue;
    }
    const parents = parentText.split(" ").filter(Boolean);
    merges.push({ prNumber, mergeSha, parentSha: parents[0] ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904", headSha: parents[1] ?? mergeSha, mergedAtEpoch, subject, prUrl: `https://github.com/${input.owner}/${input.repo}/pull/${prNumber}` });
  }
  return { merges, cursorReset, skipped, tip };
}

// src/orchestrate/state.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join7 } from "node:path";
function configHash(value) {
  return createHash2("sha256").update(JSON.stringify(value)).digest("hex");
}
function readScanState(dir, expected, runGit3) {
  if (!existsSync4(join7(dir, "state.json")) || !existsSync4(join7(dir, "prs.jsonl"))) return null;
  try {
    const state = JSON.parse(readFileSync3(join7(dir, "state.json"), "utf8"));
    if (state.state_version !== 1 || !Object.entries(expected).every(([key, value]) => state[key] === value) || !/^[0-9a-f]{40}$/.test(state.last_seen_merge_sha) || !isAncestor(runGit3, state.last_seen_merge_sha, expected.integration_branch)) return null;
    const prs = readFileSync3(join7(dir, "prs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (!prs.every((entry) => /^[0-9a-f]{40}$/.test(entry.merge_sha) && typeof entry.row?.pr_number === "number")) return null;
    return { state, prs };
  } catch {
    return null;
  }
}
function writeScanState(dir, state, prs) {
  mkdirSync2(dir, { recursive: true });
  const write = (name, content) => {
    const temp = join7(dir, `${name}.tmp-${randomUUID()}`);
    writeFileSync2(temp, content, { mode: 384 });
    renameSync2(temp, join7(dir, name));
  };
  write("prs.jsonl", prs.map((entry) => JSON.stringify(entry)).join("\n") + (prs.length ? "\n" : ""));
  write("state.json", `${JSON.stringify(state)}
`);
}

// src/orchestrate/scan-report.ts
var iso = (epoch) => new Date(epoch * 1e3).toISOString();
function runReportScan(target, deps, opts) {
  const asOf = deps.now();
  const lookback = Math.min(opts.lookbackDays ?? 180, opts.maxLookbackDays ?? 730);
  if (!Number.isInteger(lookback) || lookback < 1) throw new RangeError("lookbackDays must be positive");
  if (lookback !== (opts.lookbackDays ?? 180)) deps.onDiagnostic?.(`warn: lookback clamped to ${lookback} days`);
  const from = new Date(asOf.getTime() - lookback * 864e5);
  const horizons = opts.horizons ?? [14, 30, 60];
  const maxPrs = opts.maxPrs ?? 500;
  const expected = { scanner_version: opts.scannerVersion, labeller_version: SURVIVAL_LABELLER_VERSION, normalization_version: SURVIVAL_NORMALIZATION_VERSION, config_hash: configHash({ horizons, attributionConfig: opts.attributionConfig ?? {}, staticAnalysis: opts.staticAnalysis ?? "off" }), integration_branch: target.integrationBranch };
  const cache = opts.stateDir ? readScanState(opts.stateDir, expected, deps.runGit) : null;
  const discovered = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, owner: target.owner, repo: target.repo, from, asOf, cursor: cache?.state.last_seen_merge_sha ?? null });
  const cached = cache && !discovered.cursorReset ? cache.prs.filter((entry) => new Date(entry.row.merged_at).getTime() >= from.getTime()) : [];
  const bySha = new Map(cached.map((entry) => [entry.merge_sha, entry]));
  for (const merge of discovered.merges) if (!bySha.has(merge.mergeSha)) bySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, row: null });
  const mergeEpoch = new Map(discovered.merges.map((merge) => [merge.mergeSha, merge.mergedAtEpoch]));
  const selected = [...bySha.values()].sort((a, b) => (a.row ? new Date(a.row.merged_at).getTime() / 1e3 : mergeEpoch.get(a.merge_sha) ?? 0) - (b.row ? new Date(b.row.merged_at).getTime() / 1e3 : mergeEpoch.get(b.merge_sha) ?? 0)).slice(-maxPrs).map((entry) => entry.merge_sha);
  if (bySha.size > maxPrs) deps.onDiagnostic?.(`warn: PR cap applied (${maxPrs})`);
  const selectedSet = new Set(selected);
  const merges = discovered.merges.filter((merge) => selectedSet.has(merge.mergeSha));
  const fullMerged = enumerateMergedPrs({ ...target }, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now }, { maxCount: 1e5 });
  const refBySha = new Map(fullMerged.map((ref2) => [ref2.mergeSha, ref2]));
  const worktree = mkdtempSync2(join8(tmpdir2(), "hokusai-report-"));
  const git = deps.makeGitRunner?.(worktree) ?? ((args) => execArgvCommand("git", ["-C", worktree, ...args], { maxBuffer: GIT_OUTPUT_MAX_BUFFER, stdio: "pipe" }));
  const worktreeResult = deps.runGit(["worktree", "add", "--detach", "--no-checkout", worktree, target.integrationBranch]);
  if (worktreeResult.exitCode !== 0) {
    rmSync2(worktree, { recursive: true, force: true });
    throw new Error(`Cannot create report worktree: ${worktreeResult.stderr}`);
  }
  let reused = 0, added = 0, relabelled = 0, failed = 0;
  try {
    const newlyLabelled = /* @__PURE__ */ new Set();
    for (const merge of merges) {
      const ref2 = refBySha.get(merge.mergeSha) ?? merge;
      const existing = bySha.get(merge.mergeSha);
      if (existing?.row) {
        reused++;
        continue;
      }
      try {
        const pr = deps.github.getPullRequest(ref2.prNumber) ?? (opts.offline ? { number: ref2.prNumber, title: "", body: null, authorLogin: null, authorType: null, headRef: null, headSha: ref2.headSha, labels: [], mergedAt: iso(ref2.mergedAtEpoch) } : null);
        if (!pr) {
          deps.onDiagnostic?.(`warn: PR #${ref2.prNumber} unavailable`);
          bySha.delete(merge.mergeSha);
          continue;
        }
        const messages = opts.offline ? [deps.runGit(["show", "-s", "--format=%B", ref2.mergeSha]).stdout] : deps.github.listPullCommits(ref2.prNumber);
        deps.github.getCheckConclusion(pr.headSha);
        const update = git(["update-ref", "--no-deref", "HEAD", ref2.mergeSha]);
        if (update.exitCode !== 0) throw new Error(`Cannot select merge ${ref2.mergeSha}`);
        const checkout = git(["checkout", "-f"]);
        if (checkout.exitCode !== 0) throw new Error(`Cannot checkout merge ${ref2.mergeSha}`);
        const features = (deps.extract ?? extractCandidateFeatures)({ checkoutDir: worktree, prNumber: ref2.prNumber, baseRef: ref2.parentSha, offline: true, staticFeatures: opts.staticAnalysis === "committed" ? void 0 : NULL_STATIC_FEATURES, contract: { taskText: `${pr.title}

${pr.body ?? ""}`.slice(0, 1e5) } });
        const labels = (deps.label ?? labelMergedPr)(target, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now, onDiagnostic: deps.onDiagnostic }, ref2, { horizons, allMergedPrs: fullMerged }).map(projectSurvivalLabel);
        bySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, row: { pr_number: ref2.prNumber, merged_at: iso(ref2.mergedAtEpoch), attribution: toReportAttribution(attributePullRequest({ number: ref2.prNumber, authorLogin: pr.authorLogin, authorType: pr.authorType, headRef: pr.headRef, labels: pr.labels, mergedAt: pr.mergedAt, commitMessages: messages, body: pr.body, headSha: pr.headSha }, opts.attributionConfig), opts.attributionConfig), features, labels, cost: null, prediction: null } });
        added++;
        newlyLabelled.add(ref2.mergeSha);
      } catch (error) {
        if (error instanceof ScanUpstreamError) throw error;
        failed++;
        bySha.delete(merge.mergeSha);
        deps.onDiagnostic?.(`error: PR #${ref2.prNumber} could not be extracted or labelled`);
      }
    }
    for (const [sha, entry] of bySha) {
      if (!selectedSet.has(sha) || !entry.row || newlyLabelled.has(sha)) continue;
      const ref2 = refBySha.get(sha);
      if (!ref2) continue;
      const immature = entry.row.labels.filter((label2) => label2.outcome.report_outcome === null || ref2.mergedAtEpoch * 1e3 + label2.horizon_days * 864e5 > asOf.getTime());
      if (immature.length === 0) continue;
      try {
        const fresh = (deps.label ?? labelMergedPr)(target, { runGit: deps.runGit, github: deps.labellerGithub, now: deps.now, onDiagnostic: deps.onDiagnostic }, ref2, { horizons: immature.map((label2) => label2.horizon_days), allMergedPrs: fullMerged }).map(projectSurvivalLabel);
        const updated = new Map(entry.row.labels.map((label2) => [label2.horizon_days, label2]));
        for (const label2 of fresh) updated.set(label2.horizon_days, label2);
        entry.row.labels = horizons.map((h) => updated.get(h));
        relabelled += fresh.length;
      } catch (error) {
        if (error instanceof ScanUpstreamError) throw error;
        failed++;
        bySha.delete(sha);
        deps.onDiagnostic?.(`error: PR #${ref2.prNumber} could not be relabelled`);
      }
    }
  } finally {
    deps.runGit(["worktree", "remove", "--force", worktree]);
    rmSync2(worktree, { recursive: true, force: true });
  }
  const finalEntries = [...bySha.values()].filter((entry) => selectedSet.has(entry.merge_sha) && entry.row);
  const mergedFrom = finalEntries.length ? new Date(Math.min(...finalEntries.map((entry) => new Date(entry.row.merged_at).getTime()))) : from;
  const { report, json } = emitReport(buildReportDraft({ owner: target.owner, repo: target.repo, integrationBranch: target.integrationBranch, asOf, lookbackDays: lookback, mergedFrom, horizons, rows: finalEntries.map((entry) => entry.row), scannerVersion: opts.scannerVersion }), opts.policy);
  const lastSeen = discovered.merges.at(-1)?.mergeSha ?? cache?.state.last_seen_merge_sha;
  if (opts.stateDir && lastSeen && failed === 0) writeScanState(opts.stateDir, { state_version: 1, ...expected, last_seen_merge_sha: lastSeen }, finalEntries);
  deps.onDiagnostic?.(`info: scanned ${finalEntries.length} PRs; failed ${failed}`);
  return { report, json, stats: { reused, added, relabelled, skipped: discovered.skipped } };
}

// src/report/contribute.ts
function checkKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(checkKeys);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (REPORT_FORBIDDEN_KEYS.some((forbidden) => forbidden === "raw*" ? key.startsWith("raw") : key === forbidden)) throw new Error(`Contribution contains forbidden key: ${key}`);
    checkKeys(child);
  }
}
function buildContributionPayload(report) {
  const valid = validateArbiterReportV1(report);
  if (!valid.ok) throw new Error("Contribution report does not satisfy arbiter_report/v1");
  if (report.data_origin !== "scan") throw new Error("Only scan-origin reports can be contributed");
  checkKeys(report);
  const sort = (value) => Array.isArray(value) ? value.map(sort) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : value;
  return `${JSON.stringify(sort(report), null, 2)}
`;
}

// src/report-cli.ts
var TARGET = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
function validateGithubTarget(raw) {
  const match = raw.match(TARGET);
  if (!match || !match[1] || !match[2] || [".", ".."].includes(match[2])) throw new ScanInputError("expected a GitHub owner/repo or https://github.com/owner/repo");
  return { owner: match[1], repo: match[2] };
}
var positive = (raw, name, fallback) => {
  if (raw === void 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ScanInputError(`${name} must be a positive integer`);
  return value;
};
function reportSummary(report) {
  const cells = Object.values(report.aggregates).flatMap((section3) => section3.rows.flatMap((row) => Object.entries(row).filter(([key]) => key === "cell" || key === "ratio" || key.endsWith("_rate")).map(([, value]) => value)));
  const suppressed = cells.filter((cell3) => cell3.suppressed);
  const reasons2 = new Set(suppressed.flatMap((cell3) => cell3.suppression_reasons));
  const attribution = report.coverage.attribution;
  return [
    `coverage: agent ${attribution.agent.rate}, harness ${attribution.harness.rate}, exact model ${attribution.exact_model.rate}`,
    `suppression: ${suppressed.length} cells, ${reasons2.size} reasons`
  ];
}
function runReportCli(args, world) {
  const parseReportArgs = () => parseArgs2({ args: [...args], options: {
    repo: { type: "string" },
    "integration-branch": { type: "string" },
    "lookback-days": { type: "string" },
    "max-prs": { type: "string" },
    horizons: { type: "string" },
    "state-dir": { type: "string" },
    "no-state": { type: "boolean" },
    "attribution-config": { type: "string" },
    "static-analysis": { type: "string" },
    "as-of": { type: "string" },
    "token-env": { type: "string" },
    offline: { type: "boolean" },
    out: { type: "string" },
    debug: { type: "boolean" },
    help: { type: "boolean" },
    contribute: { type: "boolean" },
    "dry-run": { type: "boolean" },
    "api-key-env": { type: "string" }
  }, allowPositionals: true, strict: true });
  let parsed;
  try {
    parsed = parseReportArgs();
  } catch (error) {
    throw new ScanInputError(error.message);
  }
  if (parsed.positionals.length !== 1) throw new ScanInputError("report requires one GitHub owner/repo or URL");
  const { owner, repo } = validateGithubTarget(parsed.positionals[0]);
  const values = parsed.values;
  const tokenName = validateTokenEnvName(values["token-env"]);
  const token = world.env[tokenName];
  const github = values.offline ? createOfflineScanGitHubClient() : createDefaultScanGitHubClient(owner, repo, token);
  let repoDir = values.repo ? resolve4(values.repo) : "";
  let temporary = null;
  try {
    if (!repoDir) {
      temporary = mkdtempSync3(join9(tmpdir3(), "hokusai-report-clone-"));
      repoDir = join9(temporary, "repo");
      if (values.offline) throw new ScanInputError("--offline requires --repo");
      const clone = token ? execArgvCommand("gh", ["repo", "clone", `${owner}/${repo}`, repoDir, "--", "--no-tags"], { env: { ...world.env, GH_TOKEN: token }, stdio: "pipe" }) : execArgvCommand("git", ["clone", "--no-tags", `https://github.com/${owner}/${repo}.git`, repoDir], { stdio: "pipe" });
      if (clone.exitCode !== 0) throw new ScanUpstreamError("GitHub clone failed");
    }
    if (!existsSync5(repoDir)) throw new ScanInputError("--repo path does not exist");
    const defaultBranch = values["integration-branch"] ?? github.getRepo().defaultBranch;
    const runGit3 = (argv) => execArgvCommand("git", ["-C", repoDir, ...argv], { stdio: "pipe" });
    const historyRef = runGit3(["show-ref", "--verify", `refs/heads/${defaultBranch}`]).exitCode === 0 ? defaultBranch : `origin/${defaultBranch}`;
    const history = runGit3(["log", "--first-parent", "--max-count=200", "--pretty=format:%s", historyRef]);
    if (history.exitCode !== 0) throw new ScanInputError(`cannot read default branch ${defaultBranch}`);
    const integrationBranch = resolveIntegrationBranch({
      ...values["integration-branch"] ? { explicit: values["integration-branch"] } : {},
      defaultBranch,
      recentFirstParentSubjects: history.stdout.split("\n"),
      headRefLookup: (number) => github.getPullRequest(number)?.headRef ?? null,
      remoteBranchExists: (ref2) => runGit3(["show-ref", "--verify", `refs/remotes/origin/${ref2}`]).exitCode === 0 || runGit3(["show-ref", "--verify", `refs/heads/${ref2}`]).exitCode === 0
    });
    const local = runGit3(["show-ref", "--verify", `refs/heads/${integrationBranch}`]);
    if (local.exitCode !== 0) {
      const remote = runGit3(["show-ref", "--verify", `refs/remotes/origin/${integrationBranch}`]);
      if (remote.exitCode !== 0) throw new ScanInputError(`integration branch ${integrationBranch} is not available locally`);
      const track = runGit3(["branch", "--track", integrationBranch, `origin/${integrationBranch}`]);
      if (track.exitCode !== 0) throw new ScanInputError(`cannot track integration branch ${integrationBranch}`);
    }
    const target = { owner, repo, repoDir, integrationBranch };
    const deps = world.depsFactory?.(target) ?? (() => {
      const base = createDefaultDeps({ ...target, token }, { strictUpstream: true, ...values["as-of"] ? { now: () => validateAsOf(values["as-of"]) } : {} });
      return { runGit: runGit3, labellerGithub: values.offline ? createOfflineGitHubClient() : base.github, github, now: base.now, onDiagnostic: world.diagnostic };
    })();
    let config;
    if (values["attribution-config"]) {
      try {
        config = resolveAttributionConfig(JSON.parse(readFileSync4(resolve4(values["attribution-config"]), "utf8")), `${owner}/${repo}`);
      } catch (error) {
        if (error instanceof AttributionConfigError) throw new ScanInputError(error.message);
        throw new ScanInputError("invalid --attribution-config JSON file");
      }
    }
    const staticAnalysis = values["static-analysis"] ?? "off";
    if (staticAnalysis !== "off" && staticAnalysis !== "committed") throw new ScanInputError("--static-analysis must be off or committed");
    const lookbackDays = positive(values["lookback-days"], "--lookback-days", 180);
    if (lookbackDays > 3650) throw new ScanInputError("--lookback-days must be at most 3650");
    const maxPrs = positive(values["max-prs"], "--max-prs", 500);
    const gitDir = runGit3(["rev-parse", "--absolute-git-dir"]);
    if (gitDir.exitCode !== 0) throw new ScanInputError("--repo is not a git worktree");
    const stateDir = values["no-state"] ? void 0 : values["state-dir"] ? resolve4(values["state-dir"]) : join9(gitDir.stdout.trim(), "hokusai-scan", `${owner}__${repo}`);
    const result = runReportScan(target, deps, { scannerVersion: "0.4.0", lookbackDays, maxPrs, horizons: validateHorizons(values.horizons), staticAnalysis, ...stateDir ? { stateDir } : {}, offline: values.offline === true, ...config ? { attributionConfig: config } : {} });
    let output = result.json;
    if (values.contribute) {
      output = buildContributionPayload(result.report);
      if (!values["dry-run"]) {
        const keyEnv = values["api-key-env"] ?? "HOKUSAI_API_KEY";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) throw new ScanInputError("--api-key-env must name an environment variable");
        const apiKey = world.env[keyEnv];
        if (!apiKey) throw new ScanInputError(`missing API key in ${keyEnv}`);
        if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new ScanInputError("API key contains invalid characters");
        const baseUrl = world.env.HOKUSAI_BASE_URL ?? "https://api.hokus.ai";
        const payloadDir = mkdtempSync3(join9(tmpdir3(), "hokusai-contribution-"));
        try {
          const bodyFile = join9(payloadDir, "body.json");
          writeFileSync3(bodyFile, output, { mode: 384 });
          const escaped = apiKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          const curlConfig = `header = "Authorization: Bearer ${escaped}"
header = "Content-Type: application/json"
`;
          const response = execArgvCommand("curl", ["--silent", "--show-error", "--output", "/dev/null", "--write-out", "%{http_code}", "--config", "-", "--data-binary", `@${bodyFile}`, `${baseUrl.replace(/\/$/, "")}/api/v1/arbiter/reports`], { input: curlConfig });
          const status = Number(response.stdout.trim());
          if (response.exitCode !== 0 || status < 200 || status >= 300) throw new ScanUpstreamError(`Report contribution failed (HTTP ${status || "unknown"})`);
        } finally {
          rmSync3(payloadDir, { recursive: true, force: true });
        }
      }
    }
    return { output, rows: result.report.prs.length, out: values.out ?? "-", summary: [`contract arbiter_report/v1`, `PRs ${result.report.prs.length}`, ...reportSummary(result.report), `incremental: reused ${result.stats.reused}, new ${result.stats.added}, relabelled ${result.stats.relabelled}`] };
  } finally {
    if (temporary) rmSync3(temporary, { recursive: true, force: true });
  }
}

// src/cli-core.ts
var EXIT_OK = 0;
var EXIT_INTERNAL = 1;
var EXIT_INVALID_INPUT = 2;
var EXIT_UPSTREAM = 3;
var USAGE = `usage: hokusai-scan <label|extract|scan|report> [options]

label    --repo <path> --integration-branch <name> [--github-repo <owner/name>]
         [--pr-url <url>] [--horizons 14,30,60] [--max-prs <n>] [--as-of <iso>]
         [--no-links] [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
extract  --repo <path> --pr <n> [--base-ref <ref>] [--config-path <path>]
         [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
scan     --repo <path> --integration-branch <name> --pr <n> [common options]
report   <owner/repo|https://github.com/owner/repo> [--repo <path>]
         [--integration-branch <name>] [--lookback-days 180] [--max-prs 500]
         [--horizons 14,30,60] [--state-dir <path>] [--attribution-config <json>]
         [--static-analysis off|committed] [--contribute [--dry-run]]
         [--api-key-env HOKUSAI_API_KEY] [--out <path|->]

shadow-score     --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--threshold 0.5]
                 [--bootstrap-days 30] [--max-prs 200]
shadow-backfill  --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--horizon-days 30]
shadow-report    --data-dir <path> [--window-days 30] [--horizon-days 30]
                 (shadow commands always exit 0 and print SHADOW_* lines)
`;
var OPTION_SPEC = {
  "repo": { type: "string" },
  "integration-branch": { type: "string" },
  "github-repo": { type: "string" },
  "pr": { type: "string" },
  "pr-url": { type: "string" },
  "base-ref": { type: "string" },
  "config-path": { type: "string" },
  "horizons": { type: "string" },
  "max-prs": { type: "string" },
  "as-of": { type: "string" },
  "token-env": { type: "string" },
  "out": { type: "string" },
  "no-links": { type: "boolean" },
  "offline": { type: "boolean" },
  "debug": { type: "boolean" },
  "help": { type: "boolean" }
};
function makeDiagnostics(context) {
  const redact2 = (text) => context.token ? text.split(context.token).join("***") : text;
  return {
    info: (message) => context.io.writeStderr(`info: ${redact2(message)}
`),
    warn: (message) => context.io.writeStderr(`warn: ${redact2(message)}
`),
    error: (message) => context.io.writeStderr(`error: ${redact2(message)}
`)
  };
}
function runScanCli(argv, io) {
  const context = { io, debug: false, token: void 0, summaryLines: [] };
  const diag = makeDiagnostics(context);
  try {
    const [command, ...rest] = argv;
    if (command === void 0 || command === "--help" || command === "help") {
      io.writeStderr(USAGE);
      return { exitCode: command === void 0 ? EXIT_INVALID_INPUT : EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (command === "report") {
      if (rest.includes("--help")) {
        io.writeStderr(USAGE);
        return { exitCode: EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
      }
      const result = runReportCli(rest, { env: io.env, diagnostic: (line) => io.writeStderr(`${line}
`), depsFactory: io.reportDepsFactory });
      let outputPath2 = null;
      if (result.out === "-") io.writeStdout(result.output);
      else {
        outputPath2 = resolve5(result.out);
        mkdirSync3(dirname(outputPath2), { recursive: true });
        writeFileSync4(outputPath2, result.output);
      }
      for (const line of result.summary) diag.info(line);
      return { exitCode: EXIT_OK, rowCount: result.rows, outputPath: outputPath2, summaryLines: result.summary };
    }
    if (command.startsWith("shadow-")) {
      const result = runShadowCli(command, rest, {
        log: (line) => io.writeStdout(`${line}
`),
        cwd: process.cwd()
      });
      return { exitCode: result.exitCode, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (command !== "label" && command !== "extract" && command !== "scan") {
      throw new ScanInputError(`unknown subcommand ${command}; expected label, extract, or scan`);
    }
    let values;
    try {
      ({ values } = parseArgs3({ args: [...rest], options: OPTION_SPEC, strict: true, allowPositionals: false }));
    } catch (error) {
      throw new ScanInputError(error.message);
    }
    if (values.help === true) {
      io.writeStderr(USAGE);
      return { exitCode: EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    context.debug = values.debug === true;
    const tokenEnvName = validateTokenEnvName(values["token-env"]);
    context.token = io.env[tokenEnvName];
    const repoDir = resolveRepoDir(values.repo);
    const offline = values.offline === true;
    const asOf = validateAsOf(values["as-of"]);
    const outSpec = values.out ?? "-";
    let output;
    let rowCount;
    if (command === "label") {
      ({ output, rowCount } = runLabel(context, {
        repoDir,
        offline,
        asOf,
        integrationBranch: validateIntegrationBranch(values["integration-branch"]),
        githubRepo: validateGithubRepo(values["github-repo"]),
        prUrl: validatePrUrl(values["pr-url"]),
        horizons: validateHorizons(values.horizons),
        maxPrs: validateMaxPrs(values["max-prs"]),
        includeLinkedReferences: values["no-links"] === true || offline ? false : void 0
      }));
    } else if (command === "extract") {
      ({ output, rowCount } = runExtract(context, {
        repoDir,
        offline,
        prNumber: validatePrNumber(values.pr),
        baseRef: values["base-ref"],
        configPath: values["config-path"]
      }));
    } else {
      ({ output, rowCount } = runCombinedScan(context, {
        repoDir,
        offline,
        asOf,
        integrationBranch: validateIntegrationBranch(values["integration-branch"]),
        githubRepo: validateGithubRepo(values["github-repo"]),
        prNumber: validatePrNumber(values.pr),
        baseRef: values["base-ref"],
        configPath: values["config-path"],
        horizons: validateHorizons(values.horizons),
        maxPrs: validateMaxPrs(values["max-prs"]),
        includeLinkedReferences: values["no-links"] === true || offline ? false : void 0
      }));
    }
    let outputPath = null;
    if (outSpec === "-") {
      io.writeStdout(output);
    } else {
      outputPath = resolve5(outSpec);
      mkdirSync3(dirname(outputPath), { recursive: true });
      writeFileSync4(outputPath, output);
    }
    context.summaryLines.unshift(`contract ${scanContractVersion()}`, `rows ${rowCount}`);
    return { exitCode: EXIT_OK, rowCount, outputPath, summaryLines: context.summaryLines };
  } catch (error) {
    if (error instanceof ScanInputError) {
      diag.error(error.message);
      return { exitCode: EXIT_INVALID_INPUT, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (error instanceof ScanUpstreamError) {
      diag.error(error.message);
      return { exitCode: EXIT_UPSTREAM, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    diag.error(`unexpected: ${error.message}`);
    if (context.debug && error.stack) {
      for (const line of error.stack.split("\n")) {
        diag.error(line);
      }
    }
    return { exitCode: EXIT_INTERNAL, rowCount: 0, outputPath: null, summaryLines: [] };
  }
}
function resolveRepoDir(raw) {
  const repoDir = resolve5(validateRepoDir(raw));
  if (!existsSync6(repoDir) || !statSync4(repoDir).isDirectory()) {
    throw new ScanInputError("--repo path does not exist");
  }
  const inside = execArgvCommand("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.toString().trim() !== "true") {
    throw new ScanInputError("--repo is not a git working tree");
  }
  const shallow = execArgvCommand("git", ["-C", repoDir, "rev-parse", "--is-shallow-repository"]);
  if (shallow.stdout.toString().trim() === "true") {
    throw new ScanInputError("repository is a shallow clone; checkout with fetch-depth: 0");
  }
  return repoDir;
}
function detectGithubRepo2(repoDir) {
  const result = execArgvCommand("git", ["-C", repoDir, "remote", "get-url", "origin"]);
  if (result.exitCode !== 0) return null;
  const match = result.stdout.toString().trim().match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
function requireGithubRepo(context, repoDir, explicit) {
  if (explicit) return explicit;
  const detected = detectGithubRepo2(repoDir);
  if (!detected) {
    throw new ScanInputError("cannot detect owner/name from the origin remote; pass --github-repo");
  }
  makeDiagnostics(context).info(
    `github repo detected from origin remote: ${detected.owner}/${detected.repo}`
  );
  return detected;
}
function buildLabellerWorld(context, params) {
  const diag = makeDiagnostics(context);
  const githubRepo = requireGithubRepo(context, params.repoDir, params.githubRepo);
  const target = {
    owner: githubRepo.owner,
    repo: githubRepo.repo,
    integrationBranch: params.integrationBranch,
    repoDir: params.repoDir,
    ...context.token !== void 0 ? { token: context.token } : {}
  };
  const asOf = params.asOf;
  const deps = createDefaultDeps(target, {
    strictUpstream: true,
    ...asOf ? { now: () => asOf } : {}
  });
  if (params.offline) {
    deps.github = createOfflineGitHubClient();
  }
  deps.onDiagnostic = (message) => diag.warn(message);
  return { target, deps };
}
function collectLabels(context, params, prFilter) {
  const diag = makeDiagnostics(context);
  const { target, deps } = buildLabellerWorld(context, params);
  const allMergedPrs = enumerateMergedPrs(target, deps, { maxCount: params.maxPrs });
  let prs;
  if (params.prUrl !== void 0) {
    const resolved = resolveMergedPr(target, deps, params.prUrl, { searchLimit: params.maxPrs });
    if (isSkippedPr(resolved)) {
      if (resolved.reason === "unmerged_pr") {
        throw new ScanInputError(`${resolved.prUrl}: ${resolved.detail}`);
      }
      throw new ScanInputError(`${resolved.prUrl}: inaccessible history (${resolved.detail})`);
    }
    prs = [resolved];
  } else {
    prs = sortMergedPrsForEmission(allMergedPrs);
    if (prFilter) prs = prs.filter(prFilter);
  }
  const labels = [];
  for (const pr of prs) {
    try {
      labels.push(...labelMergedPr(target, deps, pr, {
        horizons: params.horizons,
        allMergedPrs,
        ...params.includeLinkedReferences === void 0 ? {} : { includeLinkedReferences: params.includeLinkedReferences }
      }));
    } catch (error) {
      if (error instanceof ScanUpstreamError) throw error;
      diag.error(`failed to label ${pr.prUrl}: ${String(error)}`);
    }
  }
  const summary = summarizeLabels(`${target.owner}/${target.repo}`, labels);
  diag.info(`summary ${JSON.stringify(summary)}`);
  for (const [horizon2, bucket] of Object.entries(summary.horizons)) {
    context.summaryLines.push(
      `${horizon2}d: ${bucket.rows} rows, ${bucket.missing} missing, survival_rate ${bucket.survival_rate ?? "n/a"}`
    );
  }
  return labels;
}
function runLabel(context, params) {
  const labels = collectLabels(context, params);
  return { output: serializeSurvivalLabels(labels), rowCount: labels.length };
}
function runExtract(context, params) {
  const diag = makeDiagnostics(context);
  const features = extractCandidateFeatures({
    checkoutDir: params.repoDir,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    offline: params.offline,
    configPath: params.configPath,
    onDiagnostic: (message) => diag.warn(message)
  });
  return { output: serializeCandidateFeatures(features), rowCount: 1 };
}
function runCombinedScan(context, params) {
  const labels = collectLabels(
    context,
    { ...params, prUrl: void 0 },
    (pr) => pr.prNumber === params.prNumber
  );
  if (labels.length === 0) {
    throw new ScanInputError(
      `PR #${params.prNumber} not found on ${params.integrationBranch} within --max-prs ${params.maxPrs}`
    );
  }
  const features = extractCandidateFeatures({
    checkoutDir: params.repoDir,
    prNumber: params.prNumber,
    baseRef: params.baseRef,
    offline: params.offline,
    configPath: params.configPath,
    onDiagnostic: (message) => makeDiagnostics(context).warn(message)
  });
  const combined = {
    scan_contract: SCAN_CONTRACT,
    candidate_features: features,
    survival_labels: labels
  };
  return { output: `${JSON.stringify(combined, null, 2)}
`, rowCount: labels.length };
}

// src/action-entry.ts
function writeGithubKeyValue(file, key, value) {
  if (!file) return;
  appendFileSync(file, `${key}=${value}
`);
}
function main() {
  const actionEnv = {
    input: (name) => readActionInput(process.env, name),
    runnerTemp: process.env.RUNNER_TEMP,
    workspace: process.env.GITHUB_WORKSPACE
  };
  if (isShadowMode(actionEnv.input("mode"))) {
    const { argv: argv2 } = buildShadowActionArgv(actionEnv);
    runScanCli(argv2, {
      writeStdout: (text) => process.stdout.write(text),
      writeStderr: (text) => process.stderr.write(text),
      env: { ...process.env }
    });
    return 0;
  }
  const { argv, outputPath } = buildActionArgv(actionEnv);
  const env = { ...process.env };
  const token = readActionInput(process.env, "token");
  if (token !== void 0) env.GITHUB_TOKEN = token;
  const result = runScanCli(argv, {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
    env
  });
  if (result.exitCode === 0) {
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, "output-path", result.outputPath ?? outputPath);
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, "contract-version", actionEnv.input("mode") === "report" ? "arbiter_report/v1" : scanContractVersion());
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, "row-count", String(result.rowCount));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = [
        "### hokusai-scan",
        "",
        ...result.summaryLines.map((line) => `- ${line}`),
        ""
      ].join("\n");
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}
`);
    }
  }
  return result.exitCode;
}
process.exitCode = main();
