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
  if (mode === "report") {
    for (const [input, flag] of [["lookback-days", "--lookback-days"], ["report-max-prs", "--max-prs"], ["state-dir", "--state-dir"], ["attribution-config", "--attribution-config"]]) {
      const value = env.input(input);
      if (value !== void 0) argv.push(flag, value);
    }
    if (env.input("state-dir") === void 0) argv.push("--no-state");
  }
  if (actionFlagIsTrue(env.input("no-links"))) argv.push("--no-links");
  if (actionFlagIsTrue(env.input("offline"))) argv.push("--offline");
  if (actionFlagIsTrue(env.input("debug"))) argv.push("--debug");
  const requestedOut = env.input("output-path") ?? (mode === "report" ? "arbiter-report.json" : "hokusai-scan-output.jsonl");
  const outputPath = isAbsolute(requestedOut) ? requestedOut : join(env.runnerTemp ?? ".", requestedOut);
  argv.push("--out", outputPath);
  return { argv, outputPath };
}

// src/cli-core.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, mkdtempSync as mkdtempSync3, readFileSync as readFileSync5, rmSync as rmSync4, statSync as statSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname3, join as join10, resolve as resolve5 } from "node:path";
import { tmpdir as tmpdir3 } from "node:os";
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
  const normalized = normalizeText(input.text);
  if (normalized.length > 0 && normalized.length < 40) {
    return "shallow";
  }
  if (DEEP_REASONING_PATTERNS.some((pattern) => pattern.test(normalized))) {
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
    const normalized = extension.replace(/^\./, "").toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[normalized];
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
function fieldError(path4, message, code) {
  return { path: path4, message, code };
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
var ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION = "1.1.0";
var ARBITER_SURVIVAL_LABEL_SCHEMA_VERSIONS = ["1.0.0", "1.1.0"];
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
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
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
    schema_version: ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
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
    "description": "Arbiter S2 survival label: one label per merged PR per elapsed horizon (14/30/60 days), aggregated over normalized PR line ranges walked on the integration branch (never main blame in squash-promotion repos; v1.1.0 admits main for direct-merge repos). Producer: the wavemill survival labeller. Consumer: Hokusai/hokusai-data-pipeline training ingest. Contract doc: docs/arbiter/survival-label-contract.md. Any change requires a schema_version bump coordinated with the pipeline.",
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
        "enum": [
          "1.0.0",
          "1.1.0"
        ],
        "description": "Contract version of this label object. Must equal envelope.schema_version (asserted by the contract test). 1.0.0 rows stay valid; 1.1.0 adds envelope.integration_mode."
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
      },
      {
        "if": {
          "properties": {
            "schema_version": {
              "const": "1.0.0"
            }
          },
          "required": [
            "schema_version"
          ]
        },
        "then": {
          "properties": {
            "envelope": {
              "properties": {
                "integration_mode": false,
                "integration_branch": {
                  "not": {
                    "const": "main"
                  }
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "schema_version": {
              "const": "1.1.0"
            }
          },
          "required": [
            "schema_version"
          ]
        },
        "then": {
          "properties": {
            "envelope": {
              "required": [
                "integration_mode"
              ],
              "if": {
                "properties": {
                  "integration_branch": {
                    "const": "main"
                  }
                },
                "required": [
                  "integration_branch"
                ]
              },
              "then": {
                "properties": {
                  "integration_mode": {
                    "const": "direct"
                  }
                }
              }
            }
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
            "description": "Branch the labeller walked, e.g. auto/integration or an OSS default branch. 'main' is rejected in v1.0.0 and admitted in v1.1.0 only with integration_mode 'direct': squash promotion rewrites the SHA lineage the labeller needs, direct merge does not."
          },
          "integration_mode": {
            "enum": [
              "promotion",
              "direct"
            ],
            "description": "v1.1.0+. 'promotion': integration_branch is later squash-promoted to another branch (wavemill auto/integration -> main). 'direct': PRs merge straight into integration_branch, so its lineage is the final history (most OSS repos)."
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

// ../core/src/arbiter-corrective-rework.ts
import { createHash as createHash2 } from "node:crypto";
var ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION = "1.1.0";
var CORRECTIVE_REWORK_DEFINITION_VERSION = "cr-0.1.0";
var PROXY_CONFIDENCE = Object.freeze({
  revert: "high",
  repair_reference: "high",
  szz: "medium",
  regression_issue: "medium",
  abnormal_churn: "low"
});
var ADMITTED_PROXIES = ["revert", "repair_reference", "szz", "regression_issue"];
var CORRECTIVE_REASON_CODES = [...ADMITTED_PROXIES, "no_accepted_fix", "base_label_missing"];
function correctiveCandidateId(original, fix, proxy) {
  return createHash2("sha256").update([original.pr_url, fix.pr_url ?? fix.sha, proxy].join("\0"), "utf-8").digest("hex");
}
var CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
function deriveCorrectiveLabel(input) {
  const envelope = { ...input.envelope, schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION };
  const base = {
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    record_type: "corrective",
    prUrl: input.prUrl,
    horizon_days: input.horizon_days,
    label_provenance: "harvested",
    base_label_hash: input.base_label_hash
  };
  if (!input.base_label_present) {
    return { ...base, corrective: null, confidence: null, reason_codes: ["base_label_missing"], repair_pair_ids: [], envelope };
  }
  const horizonSeconds = input.horizon_days * 86400;
  const admitted = new Set(ADMITTED_PROXIES);
  const within = input.repair_pairs.filter(
    (p) => p.original.pr_url === input.prUrl && admitted.has(p.proxy) && p.lag_seconds > 0 && p.lag_seconds <= horizonSeconds
  );
  if (within.length === 0) {
    return { ...base, corrective: false, confidence: null, reason_codes: ["no_accepted_fix"], repair_pair_ids: [], envelope };
  }
  const confidence = within.reduce(
    (best, p) => CONFIDENCE_RANK[p.confidence] > CONFIDENCE_RANK[best] ? p.confidence : best,
    "low"
  );
  const proxies = new Set(within.map((p) => p.proxy));
  return {
    ...base,
    corrective: true,
    confidence,
    reason_codes: ADMITTED_PROXIES.filter((p) => proxies.has(p)),
    repair_pair_ids: [...new Set(within.map((p) => p.candidate_id))].sort(),
    envelope
  };
}

// ../core/src/arbiter-corrective-rework-schema.ts
var ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA = Object.freeze(
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "arbiter-corrective-rework.schema.json",
    "title": "ArbiterCorrectiveReworkRecordV1",
    "description": "Arbiter corrective-rework records (HOK-3267). One schema, three record types discriminated by record_type: candidate (every proposed fix->original link, accepted or rejected with an exclusion code), repair_pair (one per accepted candidate: the pair and its delta), corrective (one per prUrl x horizon_days, derived from accepted repair pairs and linked to its S2 survival label by base_label_hash). Carries no raw content: typed codes, URLs, SHAs, repo paths and counts only. Producer: the @hokusai/scan corrective labeller. Contract doc: docs/arbiter/corrective-rework-contract.md. Any change requires a schema_version bump.",
    "oneOf": [
      {
        "$ref": "#/$defs/candidate"
      },
      {
        "$ref": "#/$defs/repairPair"
      },
      {
        "$ref": "#/$defs/corrective"
      }
    ],
    "$defs": {
      "gitSha": {
        "type": "string",
        "pattern": "^([0-9a-f]{40}|[0-9a-f]{64})$",
        "description": "Full git object id (40 hex for SHA-1 repos, 64 for SHA-256 repos)."
      },
      "sha256Hex": {
        "type": "string",
        "pattern": "^[0-9a-f]{64}$"
      },
      "utcTimestamp": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$"
      },
      "url": {
        "type": "string",
        "pattern": "^https?://\\S+$"
      },
      "schemaVersion": {
        "enum": [
          "1.1.0"
        ],
        "description": "Contract version. Must equal envelope.schema_version."
      },
      "proxy": {
        "enum": [
          "revert",
          "repair_reference",
          "szz",
          "regression_issue",
          "abnormal_churn"
        ],
        "description": "Fix-event proxy, in precision order (P1-P5)."
      },
      "confidence": {
        "enum": [
          "high",
          "medium",
          "low"
        ]
      },
      "exclusionCode": {
        "enum": [
          "planned_iteration",
          "requirement_change",
          "unrelated_edit",
          "refactor",
          "revert_non_defect",
          "linkage_error",
          "backport",
          "revert_of_revert",
          "dependency_bot",
          "fix_too_large",
          "proxy_disabled"
        ],
        "description": "Why a candidate was rejected. The first six are the shared human taxonomy (HOK-3048); the rest are applied automatically."
      },
      "evidence": {
        "type": "object",
        "required": [
          "kind",
          "ref",
          "count"
        ],
        "additionalProperties": false,
        "properties": {
          "kind": {
            "enum": [
              "revert_message",
              "reverts_pr_reference",
              "cites_original_pr",
              "cites_original_sha",
              "fix_label",
              "fix_title_prefix",
              "regression_in_marker",
              "closes_issue_citing_original",
              "closes_bug_issue",
              "blamed_lines",
              "regression_issue_label",
              "revert_reason"
            ]
          },
          "ref": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 512,
            "description": "URL, SHA, label name or revert-reason class. Never free text."
          },
          "count": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          }
        }
      },
      "original": {
        "type": "object",
        "required": [
          "pr_url",
          "merge_sha",
          "merged_at"
        ],
        "additionalProperties": false,
        "properties": {
          "pr_url": {
            "$ref": "#/$defs/url"
          },
          "merge_sha": {
            "$ref": "#/$defs/gitSha"
          },
          "merged_at": {
            "$ref": "#/$defs/utcTimestamp"
          }
        }
      },
      "fix": {
        "type": "object",
        "required": [
          "pr_url",
          "sha",
          "merged_at"
        ],
        "additionalProperties": false,
        "properties": {
          "pr_url": {
            "oneOf": [
              {
                "$ref": "#/$defs/url"
              },
              {
                "type": "null"
              }
            ]
          },
          "sha": {
            "$ref": "#/$defs/gitSha"
          },
          "merged_at": {
            "$ref": "#/$defs/utcTimestamp"
          }
        }
      },
      "envelope": {
        "type": "object",
        "required": [
          "schema_version",
          "definition_version",
          "labeller_version",
          "integration_branch",
          "as_of",
          "computed_at"
        ],
        "additionalProperties": false,
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "definition_version": {
            "type": "string",
            "pattern": "^cr-\\d+\\.\\d+\\.\\d+$"
          },
          "labeller_version": {
            "type": "string",
            "pattern": "^\\d+\\.\\d+\\.\\d+$"
          },
          "integration_branch": {
            "type": "string",
            "minLength": 1
          },
          "as_of": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "computed_at": {
            "$ref": "#/$defs/utcTimestamp"
          }
        }
      },
      "pathList": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "uniqueItems": true
      },
      "candidate": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "candidate_id",
          "original",
          "fix",
          "lag_seconds",
          "proxy",
          "confidence",
          "evidence",
          "status",
          "exclusion_code",
          "envelope"
        ],
        "additionalProperties": false,
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "candidate"
          },
          "candidate_id": {
            "$ref": "#/$defs/sha256Hex"
          },
          "original": {
            "$ref": "#/$defs/original"
          },
          "fix": {
            "$ref": "#/$defs/fix"
          },
          "lag_seconds": {
            "type": "integer",
            "minimum": 1
          },
          "proxy": {
            "$ref": "#/$defs/proxy"
          },
          "confidence": {
            "$ref": "#/$defs/confidence"
          },
          "evidence": {
            "type": "array",
            "minItems": 1,
            "items": {
              "$ref": "#/$defs/evidence"
            }
          },
          "status": {
            "enum": [
              "accepted",
              "rejected"
            ]
          },
          "exclusion_code": {
            "oneOf": [
              {
                "$ref": "#/$defs/exclusionCode"
              },
              {
                "type": "null"
              }
            ]
          },
          "envelope": {
            "$ref": "#/$defs/envelope"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "status": {
                  "const": "accepted"
                }
              }
            },
            "then": {
              "properties": {
                "exclusion_code": {
                  "type": "null"
                }
              }
            },
            "else": {
              "properties": {
                "exclusion_code": {
                  "$ref": "#/$defs/exclusionCode"
                }
              }
            }
          }
        ]
      },
      "repairPair": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "candidate_id",
          "original",
          "fix",
          "lag_seconds",
          "proxy",
          "confidence",
          "files",
          "line_survival",
          "fix_tests",
          "original_review",
          "graph_distance",
          "envelope"
        ],
        "additionalProperties": false,
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "repair_pair"
          },
          "candidate_id": {
            "$ref": "#/$defs/sha256Hex"
          },
          "original": {
            "$ref": "#/$defs/original"
          },
          "fix": {
            "$ref": "#/$defs/fix"
          },
          "lag_seconds": {
            "type": "integer",
            "minimum": 1
          },
          "proxy": {
            "$ref": "#/$defs/proxy"
          },
          "confidence": {
            "$ref": "#/$defs/confidence"
          },
          "files": {
            "type": "object",
            "required": [
              "original",
              "fix",
              "fix_only",
              "original_only",
              "fix_preexisting"
            ],
            "additionalProperties": false,
            "properties": {
              "original": {
                "$ref": "#/$defs/pathList"
              },
              "fix": {
                "$ref": "#/$defs/pathList"
              },
              "fix_only": {
                "$ref": "#/$defs/pathList"
              },
              "original_only": {
                "$ref": "#/$defs/pathList"
              },
              "fix_preexisting": {
                "$ref": "#/$defs/pathList"
              }
            }
          },
          "line_survival": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "maximum": 1,
            "description": "Fraction of the original's added lines still present in the fix's parent tree; null when unmeasurable."
          },
          "fix_tests": {
            "type": "object",
            "required": [
              "added",
              "modified",
              "deleted"
            ],
            "additionalProperties": false,
            "properties": {
              "added": {
                "type": "integer",
                "minimum": 0
              },
              "modified": {
                "type": "integer",
                "minimum": 0
              },
              "deleted": {
                "type": "integer",
                "minimum": 0
              }
            }
          },
          "original_review": {
            "type": "object",
            "required": [
              "reviewed",
              "review_count",
              "reviewer_count",
              "first_review_latency_seconds"
            ],
            "additionalProperties": false,
            "description": "Review metadata on the original. Null fields mean not collected, never none.",
            "properties": {
              "reviewed": {
                "type": [
                  "boolean",
                  "null"
                ]
              },
              "review_count": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 0
              },
              "reviewer_count": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 0
              },
              "first_review_latency_seconds": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 0
              }
            }
          },
          "graph_distance": {
            "type": [
              "number",
              "null"
            ],
            "minimum": 0,
            "description": "Null until backfilled from a structural index."
          },
          "envelope": {
            "$ref": "#/$defs/envelope"
          }
        }
      },
      "corrective": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "prUrl",
          "horizon_days",
          "label_provenance",
          "base_label_hash",
          "corrective",
          "confidence",
          "reason_codes",
          "repair_pair_ids",
          "envelope"
        ],
        "additionalProperties": false,
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "corrective"
          },
          "prUrl": {
            "$ref": "#/$defs/url"
          },
          "horizon_days": {
            "enum": [
              14,
              30,
              60
            ]
          },
          "label_provenance": {
            "enum": [
              "harvested",
              "owner_corrected"
            ]
          },
          "base_label_hash": {
            "$ref": "#/$defs/sha256Hex",
            "description": "S2 canonicalHash of the survival label this row derives from."
          },
          "corrective": {
            "type": [
              "boolean",
              "null"
            ]
          },
          "confidence": {
            "oneOf": [
              {
                "$ref": "#/$defs/confidence"
              },
              {
                "type": "null"
              }
            ]
          },
          "reason_codes": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": true,
            "items": {
              "enum": [
                "revert",
                "repair_reference",
                "szz",
                "regression_issue",
                "no_accepted_fix",
                "base_label_missing"
              ]
            }
          },
          "repair_pair_ids": {
            "type": "array",
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/sha256Hex"
            }
          },
          "envelope": {
            "$ref": "#/$defs/envelope"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "corrective": {
                  "const": true
                }
              }
            },
            "then": {
              "properties": {
                "confidence": {
                  "$ref": "#/$defs/confidence"
                },
                "repair_pair_ids": {
                  "minItems": 1
                },
                "reason_codes": {
                  "items": {
                    "enum": [
                      "revert",
                      "repair_reference",
                      "szz",
                      "regression_issue"
                    ]
                  }
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "corrective": {
                  "const": false
                }
              }
            },
            "then": {
              "properties": {
                "confidence": {
                  "type": "null"
                },
                "repair_pair_ids": {
                  "maxItems": 0
                },
                "reason_codes": {
                  "const": [
                    "no_accepted_fix"
                  ]
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "corrective": {
                  "type": "null"
                }
              }
            },
            "then": {
              "properties": {
                "confidence": {
                  "type": "null"
                },
                "repair_pair_ids": {
                  "maxItems": 0
                },
                "reason_codes": {
                  "const": [
                    "base_label_missing"
                  ]
                }
              }
            }
          }
        ]
      }
    }
  }
);

// ../core/src/arbiter-calibration-label.ts
var CALIBRATION_VERDICTS = ["yes", "no", "unclear"];
var CAUSE_CODES = [
  "missing_context",
  "blast_radius",
  "test_gap",
  "plan_error",
  "local_generation_error",
  "dependency_drift",
  "review_gap",
  "not_rework",
  "unclear"
];
var HUMAN_EXCLUSION_CODES = [
  "planned_iteration",
  "requirement_change",
  "unrelated_edit",
  "refactor",
  "revert_non_defect",
  "linkage_error"
];

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
function structural(schema, value, path4, errors, root) {
  const fail2 = (code, message) => errors.push({ path: path4 || "$", code, message });
  if ("$ref" in schema) {
    const name = String(schema.$ref).split("/").at(-1);
    structural(
      root.$defs[name],
      value,
      path4,
      errors,
      root
    );
    return;
  }
  if ("anyOf" in schema) {
    if (!schema.anyOf.some((s) => {
      const e = [];
      structural(s, value, path4, e, root);
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
    const object2 = value, props = schema.properties;
    for (const key of Object.keys(object2))
      if (!(key in props))
        errors.push({
          path: path4 ? `${path4}.${key}` : key,
          code: "invalid_value",
          message: "Unknown key."
        });
    for (const key of schema.required)
      if (!(key in object2))
        errors.push({
          path: path4 ? `${path4}.${key}` : key,
          code: "required",
          message: "Field is required."
        });
    for (const [key, s] of Object.entries(props))
      if (key in object2)
        structural(s, object2[key], path4 ? `${path4}.${key}` : key, errors, root);
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
      (v, i) => structural(schema.items, v, `${path4}[${i}]`, errors, root)
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
  const add = (code, path4) => errors.push({ code: "invalid_value", path: path4, message: code });
  if (report.scan.horizons_days.some(
    (horizon2, index) => index > 0 && horizon2 <= report.scan.horizons_days[index - 1]
  ))
    add("horizons_not_ascending", "scan.horizons_days");
  const checkCell = (c, path4, basis2) => {
    if (c.suppressed && (c.value !== null || c.ci !== null || !c.suppression_reasons.length))
      add("suppressed_cell_has_value", path4);
    if (!c.suppressed && (c.value === null || c.suppression_reasons.length))
      add("shown_cell_missing_value", path4);
    if (c.ci && c.value !== null && !(c.ci.low <= c.value && c.value <= c.ci.high))
      add("ci_out_of_order", path4);
    if (basis2 && c.basis !== basis2)
      add("descriptive_section_with_prediction_cell", path4);
    if (c.basis === "out_of_sample_prediction" && !report.model_provenance)
      add("prediction_without_provenance", path4);
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
function fieldError2(path4, message, code) {
  return { path: path4, message, code };
}
function isPlainObject2(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function findForbiddenKeys(obj2, path4 = "$") {
  const errors = [];
  if (!isPlainObject2(obj2)) {
    return errors;
  }
  for (const [key, value] of Object.entries(obj2)) {
    if (ARBITER_SHADOW_FORBIDDEN_KEYS.has(key)) {
      errors.push(fieldError2(path4 === "$" ? key : `${path4}.${key}`, `Forbidden key.`, "invalid_value"));
    }
    if (isPlainObject2(value)) {
      errors.push(...findForbiddenKeys(value, path4 === "$" ? key : `${path4}.${key}`));
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isPlainObject2(item)) {
          errors.push(...findForbiddenKeys(item, `${path4 === "$" ? key : `${path4}.${key}`}[${i}]`));
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
    if (!ARBITER_SURVIVAL_LABEL_SCHEMA_VERSIONS.includes(input.label.schema_version)) {
      errors.push(
        fieldError2(
          "label.schema_version",
          `Expected one of ${ARBITER_SURVIVAL_LABEL_SCHEMA_VERSIONS.map((v) => `"${v}"`).join(", ")}.`,
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
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return void 0;
  }
  const alias = COMPLEXITY_ALIASES[normalized];
  if (alias !== void 0) {
    return alias;
  }
  const parsed = Number(normalized);
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
    integration_mode: "promotion",
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
    integration_mode: "promotion",
    computed_at: "2026-09-09T12:00:00Z"
  },
  owner_correction: {
    supersedes: {
      schema_version: ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION,
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

// ../core/src/fixtures/arbiter-corrective-rework.ts
var ENVELOPE = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  definition_version: CORRECTIVE_REWORK_DEFINITION_VERSION,
  labeller_version: "1.0.0",
  integration_branch: "auto/integration",
  as_of: "2026-10-20T00:00:00Z",
  computed_at: "2026-10-28T00:00:00Z"
};
var ORIGINAL = {
  pr_url: harvestedSurvivalLabelFixture.prUrl,
  merge_sha: harvestedSurvivalLabelFixture.envelope.merge_sha,
  merged_at: "2026-09-01T00:00:00Z"
};
var FIX = {
  pr_url: "https://github.com/example-org/example-repo/pull/131",
  sha: "e".repeat(40),
  merged_at: "2026-09-04T00:00:00Z"
};
var BACKPORT = {
  pr_url: "https://github.com/example-org/example-repo/pull/140",
  sha: "f".repeat(40),
  merged_at: "2026-09-06T00:00:00Z"
};
var acceptedCorrectiveCandidateFixture = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: "candidate",
  candidate_id: correctiveCandidateId(ORIGINAL, FIX, "repair_reference"),
  original: ORIGINAL,
  fix: FIX,
  lag_seconds: 3 * 86400,
  proxy: "repair_reference",
  confidence: "high",
  evidence: [
    { kind: "cites_original_pr", ref: ORIGINAL.pr_url, count: null },
    { kind: "regression_in_marker", ref: null, count: null }
  ],
  status: "accepted",
  exclusion_code: null,
  envelope: ENVELOPE
};
var rejectedCorrectiveCandidateFixture = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: "candidate",
  candidate_id: correctiveCandidateId(ORIGINAL, BACKPORT, "revert"),
  original: ORIGINAL,
  fix: BACKPORT,
  lag_seconds: 5 * 86400,
  proxy: "revert",
  confidence: "high",
  evidence: [{ kind: "revert_message", ref: ORIGINAL.merge_sha, count: null }],
  status: "rejected",
  exclusion_code: "backport",
  envelope: ENVELOPE
};
var repairPairFixture = {
  schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  record_type: "repair_pair",
  candidate_id: acceptedCorrectiveCandidateFixture.candidate_id,
  original: ORIGINAL,
  fix: FIX,
  lag_seconds: 3 * 86400,
  proxy: "repair_reference",
  confidence: "high",
  files: {
    original: ["src/module.ts", "src/new-module.ts"],
    fix: ["src/caller.ts", "src/module.ts", "test/module.test.ts"],
    fix_only: ["src/caller.ts", "test/module.test.ts"],
    original_only: ["src/new-module.ts"],
    fix_preexisting: ["src/caller.ts", "src/module.ts"]
  },
  line_survival: 0.8,
  fix_tests: { added: 1, modified: 0, deleted: 0 },
  original_review: { reviewed: true, review_count: 2, reviewer_count: 1, first_review_latency_seconds: 3600 },
  graph_distance: null,
  envelope: ENVELOPE
};
var DERIVE_BASE = {
  prUrl: ORIGINAL.pr_url,
  base_label_hash: canonicalHash(harvestedSurvivalLabelFixture),
  repair_pairs: [repairPairFixture],
  envelope: {
    definition_version: ENVELOPE.definition_version,
    labeller_version: ENVELOPE.labeller_version,
    integration_branch: ENVELOPE.integration_branch,
    as_of: ENVELOPE.as_of,
    computed_at: ENVELOPE.computed_at
  }
};
var correctiveTrueFixture = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 14,
  base_label_present: true
});
var correctiveFalseFixture = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 30,
  base_label_present: true,
  repair_pairs: []
});
var correctiveMissingFixture = deriveCorrectiveLabel({
  ...DERIVE_BASE,
  horizon_days: 60,
  base_label_present: false
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
function assertNoForbiddenKeys(value, path4 = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, [...path4, String(index)]);
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
        `Forbidden field at ${[...path4, key].join(".")}`
      );
    }
    assertNoForbiddenKeys(child, [...path4, key]);
  }
}
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
var VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
var PROVIDER_CONTRACT_PATTERN = /^[a-z][a-z0-9-]{0,31}\/[0-9]{1,4}$/;
var MINTED_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25})$/;
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
function requireMintedId(value, label2) {
  if (typeof value !== "string" || !MINTED_ID_PATTERN.test(value)) {
    fail(`${label2} must be a minted UUID or ULID, not a derived value`);
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
  if (record.run_id !== void 0) requireMintedId(record.run_id, "event.run_id");
  if (record.stage_attempt_id !== void 0) {
    if (record.run_id === void 0) fail("event.stage_attempt_id requires event.run_id");
    requireMintedId(record.stage_attempt_id, "event.stage_attempt_id");
  }
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
  const harness = requireEnum(record.harness, TASK_COST_HARNESSES, "ledger.harness");
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
    if (event17.harness !== harness) fail(`${label2}.harness must match ledger.harness`);
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

// ../core/src/task-cost/attempt-schema.ts
var TASK_ATTEMPT_V1_JSON_SCHEMA = Object.freeze(
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "task-attempt.v1.schema.json",
    "title": "TaskAttemptLogEntryV1",
    "description": "Attempt identity for the task-cost contract (task_attempt/v1, contract 1.1.0, HOK-3372). One schema, four record types discriminated by record_type: attempt (the launch of a minted pair, arm, run or stage attempt), control (a write that changes execution state; accepted only for the current, unsettled attempt), evidence (a write that describes an attempt; always accepted against its own identity) and derived (a result computed from evidence versions). IDs are minted UUIDs or ULIDs, never derived. Single-record shape only: currency, settlement and edge targets are reducer rules (reduceTaskAttemptLog). Rules: packages/core/src/task-cost/attempt-identity.md. Readers ignore unknown fields.",
    "oneOf": [
      {
        "$ref": "#/$defs/attempt"
      },
      {
        "$ref": "#/$defs/control"
      },
      {
        "$ref": "#/$defs/evidence"
      },
      {
        "$ref": "#/$defs/derived"
      }
    ],
    "$defs": {
      "schemaVersion": {
        "const": "task_attempt/v1"
      },
      "mintedId": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25})$",
        "description": "Lowercase RFC 9562 UUID (v7 recommended) or ULID, minted before the launch. Never computed from a head, timestamp or session."
      },
      "identifier": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      },
      "utcTimestamp": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$"
      },
      "gitSha": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
      },
      "evidenceKind": {
        "enum": [
          "executed_model",
          "session_resolution",
          "cost",
          "review_findings",
          "check_run",
          "code_identity"
        ]
      },
      "evidenceVersion": {
        "type": "integer",
        "minimum": 1
      },
      "codeIdentity": {
        "type": "object",
        "description": "The code an attempt saw. Associated with the attempt, never part of its identity.",
        "properties": {
          "head_sha": {
            "$ref": "#/$defs/gitSha"
          },
          "base_sha": {
            "$ref": "#/$defs/gitSha"
          },
          "change_id": {
            "type": "string",
            "pattern": "^[a-z0-9-]{1,16}:[0-9a-f]{16,128}$"
          }
        }
      },
      "sessionRef": {
        "type": "object",
        "required": [
          "harness",
          "session_id"
        ],
        "properties": {
          "harness": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,31}$"
          },
          "session_id": {
            "$ref": "#/$defs/identifier"
          },
          "resolves": {
            "type": "string",
            "pattern": "^pending:[A-Za-z0-9._-]{1,120}$"
          }
        },
        "if": {
          "required": [
            "resolves"
          ]
        },
        "then": {
          "properties": {
            "session_id": {
              "not": {
                "pattern": "^pending:"
              }
            }
          }
        }
      },
      "sessionRefs": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/sessionRef"
        }
      },
      "attemptRef": {
        "type": "object",
        "description": "How any record names the attempt it belongs to. Downstream records embed this instead of defining their own run or attempt id.",
        "required": [
          "task_id",
          "run_id"
        ],
        "properties": {
          "task_id": {
            "$ref": "#/$defs/identifier"
          },
          "run_id": {
            "$ref": "#/$defs/mintedId"
          },
          "stage_attempt_id": {
            "$ref": "#/$defs/mintedId"
          }
        }
      },
      "attempt": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "kind",
          "id",
          "task_id",
          "parent_id"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "attempt"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "kind": {
            "enum": [
              "pair",
              "arm",
              "run",
              "stage_attempt"
            ]
          },
          "id": {
            "$ref": "#/$defs/mintedId"
          },
          "task_id": {
            "$ref": "#/$defs/identifier"
          },
          "parent_id": {
            "$ref": "#/$defs/identifier"
          },
          "stage": {
            "$ref": "#/$defs/slug"
          },
          "role": {
            "enum": [
              "primary",
              "challenger"
            ]
          },
          "retry_of": {
            "$ref": "#/$defs/mintedId"
          },
          "code_identity": {
            "$ref": "#/$defs/codeIdentity"
          },
          "session_refs": {
            "$ref": "#/$defs/sessionRefs"
          },
          "legacy_ids": {
            "type": "array",
            "description": "Producer-local labels (e.g. Wavemill's kind@head7#epoch). Not unique; never a key.",
            "items": {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:@#-]{0,127}$",
              "not": {
                "pattern": "@[^@]*\\.[A-Za-z]{2,}$"
              }
            }
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "kind": {
                  "const": "stage_attempt"
                }
              }
            },
            "then": {
              "required": [
                "stage"
              ],
              "properties": {
                "parent_id": {
                  "$ref": "#/$defs/mintedId"
                }
              }
            },
            "else": {
              "not": {
                "required": [
                  "stage"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "kind": {
                  "const": "arm"
                }
              }
            },
            "then": {
              "required": [
                "role"
              ],
              "properties": {
                "parent_id": {
                  "$ref": "#/$defs/mintedId"
                }
              }
            },
            "else": {
              "not": {
                "required": [
                  "role"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "kind": {
                  "enum": [
                    "pair",
                    "arm"
                  ]
                }
              }
            },
            "then": {
              "not": {
                "required": [
                  "retry_of"
                ]
              }
            }
          }
        ]
      },
      "control": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "write_id",
          "attempt",
          "action"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "control"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "write_id": {
            "$ref": "#/$defs/mintedId"
          },
          "attempt": {
            "$ref": "#/$defs/attemptRef"
          },
          "action": {
            "enum": [
              "outcome",
              "phase",
              "next_action",
              "linear_transition",
              "merge_decision"
            ]
          },
          "outcome": {
            "enum": [
              "succeeded",
              "failed",
              "aborted",
              "abandoned"
            ]
          },
          "value": {
            "$ref": "#/$defs/slug"
          }
        },
        "if": {
          "properties": {
            "action": {
              "const": "outcome"
            }
          }
        },
        "then": {
          "required": [
            "outcome"
          ],
          "not": {
            "required": [
              "value"
            ]
          }
        },
        "else": {
          "required": [
            "value"
          ],
          "not": {
            "required": [
              "outcome"
            ]
          }
        }
      },
      "evidence": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "write_id",
          "attempt",
          "evidence_kind",
          "evidence_version"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "evidence"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "write_id": {
            "$ref": "#/$defs/mintedId"
          },
          "attempt": {
            "$ref": "#/$defs/attemptRef"
          },
          "evidence_kind": {
            "$ref": "#/$defs/evidenceKind"
          },
          "evidence_version": {
            "$ref": "#/$defs/evidenceVersion"
          },
          "executed_model": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$"
          },
          "session_refs": {
            "$ref": "#/$defs/sessionRefs"
          },
          "code_identity": {
            "$ref": "#/$defs/codeIdentity"
          },
          "cost_event_ids": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/identifier"
            }
          }
        }
      },
      "derived": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "derived_id",
          "derived_kind",
          "inputs"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "derived"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "derived_id": {
            "$ref": "#/$defs/mintedId"
          },
          "derived_kind": {
            "$ref": "#/$defs/slug"
          },
          "inputs": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": [
                "attempt",
                "evidence_kind",
                "evidence_version"
              ],
              "properties": {
                "attempt": {
                  "$ref": "#/$defs/attemptRef"
                },
                "evidence_kind": {
                  "$ref": "#/$defs/evidenceKind"
                },
                "evidence_version": {
                  "$ref": "#/$defs/evidenceVersion"
                }
              }
            }
          },
          "supersedes": {
            "$ref": "#/$defs/mintedId"
          }
        }
      }
    }
  }
);

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

// ../core/src/fixtures/task-cost/attempt/builders.ts
function mint(n) {
  return `019a3c00-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}
function at(seconds) {
  const date2 = new Date(Date.UTC(2026, 9, 31, 12, 0, 0) + seconds * 1e3);
  return date2.toISOString().replace(".000Z", "Z");
}
var TASK = "HOK-9001";
var OTHER_TASK = "HOK-9002";
var HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
var BASE = "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567";
function attempt(input) {
  return {
    schema_version: "task_attempt/v1",
    record_type: "attempt",
    observed_at: at(input.t),
    kind: input.kind,
    id: input.id,
    task_id: input.task ?? TASK,
    parent_id: input.parent,
    ...input.stage !== void 0 ? { stage: input.stage } : {},
    ...input.role !== void 0 ? { role: input.role } : {},
    ...input.retryOf !== void 0 ? { retry_of: input.retryOf } : {},
    ...input.code !== void 0 ? { code_identity: input.code } : {},
    ...input.sessions !== void 0 ? { session_refs: input.sessions } : {},
    ...input.legacy !== void 0 ? { legacy_ids: input.legacy } : {}
  };
}
function ref2(runId, stageAttemptId, task = TASK) {
  return {
    task_id: task,
    run_id: runId,
    ...stageAttemptId !== void 0 ? { stage_attempt_id: stageAttemptId } : {}
  };
}
function outcome(writeId, attemptRef, value, t) {
  return {
    schema_version: "task_attempt/v1",
    record_type: "control",
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    action: "outcome",
    outcome: value
  };
}
function control(writeId, attemptRef, action, value, t) {
  return {
    schema_version: "task_attempt/v1",
    record_type: "control",
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    action,
    value
  };
}
function evidence(writeId, attemptRef, kind, version, t, payload = {}) {
  return {
    schema_version: "task_attempt/v1",
    record_type: "evidence",
    observed_at: at(t),
    write_id: writeId,
    attempt: attemptRef,
    evidence_kind: kind,
    evidence_version: version,
    ...payload
  };
}
function derivedResult(derivedId, inputs, t, supersedes) {
  return {
    schema_version: "task_attempt/v1",
    record_type: "derived",
    observed_at: at(t),
    derived_id: derivedId,
    derived_kind: "challenge_comparison",
    inputs,
    ...supersedes !== void 0 ? { supersedes } : {}
  };
}
function decision(index, entry, value, reasons2) {
  const key = entry.record_type === "attempt" ? entry.id : entry.record_type === "derived" ? entry.derived_id : entry.write_id;
  return {
    index,
    record_type: entry.record_type,
    key,
    decision: value,
    ...reasons2 !== void 0 ? { reasons: reasons2 } : {}
  };
}
function state(record, overrides) {
  return {
    id: record.id,
    kind: record.kind,
    task_id: record.task_id,
    parent_id: record.parent_id,
    ...record.stage !== void 0 ? { stage: record.stage } : {},
    ...record.role !== void 0 ? { role: record.role } : {},
    ...record.retry_of !== void 0 ? { retry_of: record.retry_of } : {},
    outcome: null,
    ...record.code_identity !== void 0 ? { code_identity: record.code_identity } : {},
    session_refs: record.session_refs ?? [],
    ...overrides
  };
}

// ../core/src/fixtures/task-cost/attempt/fixtures.ts
var stageRetry = (() => {
  const run = attempt({ kind: "run", id: mint(1), parent: TASK, t: 0 });
  const plan1 = attempt({ kind: "stage_attempt", id: mint(2), parent: run.id, stage: "planning", t: 1 });
  const plan1Failed = outcome(mint(101), ref2(run.id, plan1.id), "failed", 2);
  const plan2 = attempt({
    kind: "stage_attempt",
    id: mint(3),
    parent: run.id,
    stage: "planning",
    retryOf: plan1.id,
    t: 3
  });
  const impl = attempt({ kind: "stage_attempt", id: mint(4), parent: run.id, stage: "implementation", t: 4 });
  const crossStageRetry = attempt({
    kind: "stage_attempt",
    id: mint(5),
    parent: run.id,
    stage: "implementation",
    retryOf: plan1.id,
    t: 5
  });
  const plan2Done = outcome(mint(102), ref2(run.id, plan2.id), "succeeded", 6);
  const lateFirstPlan = outcome(mint(103), ref2(run.id, plan1.id), "succeeded", 7);
  const log = [run, plan1, plan1Failed, plan2, impl, crossStageRetry, plan2Done, lateFirstPlan];
  return {
    name: "stage-retry-vs-child",
    description: "Planning fails and is retried (retry_of): the retry supersedes it. Implementation is a child of the run (parent_id), not a retry. A retry across stages is rejected, and a late completion of the superseded planning attempt cannot settle it.",
    log,
    expected: {
      decisions: [
        decision(0, run, "accepted"),
        decision(1, plan1, "accepted"),
        decision(2, plan1Failed, "accepted"),
        decision(3, plan2, "accepted"),
        decision(4, impl, "accepted"),
        decision(5, crossStageRetry, "rejected", ["retry_target_invalid"]),
        decision(6, plan2Done, "accepted"),
        decision(7, lateFirstPlan, "rejected", ["stale_stage_attempt"])
      ],
      attempts: [
        state(run, { current: true }),
        state(plan1, { current: false, superseded_by: plan2.id, outcome: "failed" }),
        state(plan2, { current: true, outcome: "succeeded" }),
        state(impl, { current: true })
      ],
      evidence: [],
      derived: []
    }
  };
})();
var relaunchSettled = (() => {
  const run1 = attempt({ kind: "run", id: mint(11), parent: TASK, t: 0, code: { head_sha: HEAD, base_sha: BASE } });
  const run1Done = outcome(mint(111), ref2(run1.id), "succeeded", 1);
  const reuse = attempt({ kind: "run", id: run1.id, parent: TASK, t: 2 });
  const retryOfSucceeded = attempt({ kind: "run", id: mint(12), parent: TASK, retryOf: run1.id, t: 3 });
  const run2 = attempt({ kind: "run", id: mint(13), parent: TASK, t: 4 });
  const run2Phase = control(mint(112), ref2(run2.id), "phase", "planning", 5);
  const log = [run1, run1Done, reuse, retryOfSucceeded, run2, run2Phase];
  return {
    name: "relaunch-settled-task",
    description: "A settled task is relaunched. The launch cannot reuse the settled run id, and cannot claim to retry a run that succeeded; it is a new run that supersedes the old one, and inherits none of its state.",
    log,
    expected: {
      decisions: [
        decision(0, run1, "accepted"),
        decision(1, run1Done, "accepted"),
        decision(2, reuse, "rejected", ["id_reused"]),
        decision(3, retryOfSucceeded, "rejected", ["retry_of_succeeded"]),
        decision(4, run2, "accepted"),
        decision(5, run2Phase, "accepted")
      ],
      attempts: [
        state(run1, { current: false, superseded_by: run2.id, outcome: "succeeded" }),
        state(run2, { current: true })
      ],
      evidence: [],
      derived: []
    }
  };
})();
var staleAfterRelaunch = (() => {
  const run1 = attempt({ kind: "run", id: mint(21), parent: TASK, t: 0 });
  const impl1 = attempt({ kind: "stage_attempt", id: mint(22), parent: run1.id, stage: "implementation", t: 1 });
  const run2 = attempt({ kind: "run", id: mint(23), parent: TASK, retryOf: run1.id, t: 10 });
  const impl2 = attempt({ kind: "stage_attempt", id: mint(24), parent: run2.id, stage: "implementation", t: 11 });
  const staleCompletion = outcome(mint(121), ref2(run1.id, impl1.id), "succeeded", 12);
  const staleAbort = outcome(mint(122), ref2(run1.id), "aborted", 13);
  const staleCost = evidence(mint(123), ref2(run1.id, impl1.id), "cost", 1, 14, {
    cost_event_ids: ["event-0001", "event-0002"]
  });
  const currentCost = evidence(mint(124), ref2(run2.id, impl2.id), "cost", 1, 15, {
    cost_event_ids: ["event-0003"]
  });
  const impl2Done = outcome(mint(125), ref2(run2.id, impl2.id), "succeeded", 16);
  const log = [run1, impl1, run2, impl2, staleCompletion, staleAbort, staleCost, currentCost, impl2Done];
  return {
    name: "stale-control-and-evidence-after-relaunch",
    description: "Run 1 is abandoned and relaunched as run 2. A completion and an abort from run 1 arrive late: both are control writes for a run that is not current and are rejected, so they cannot settle or abort run 2. A late cost report for run 1 is evidence: accepted, attributed to run 1, not run 2.",
    log,
    expected: {
      decisions: [
        decision(0, run1, "accepted"),
        decision(1, impl1, "accepted"),
        decision(2, run2, "accepted"),
        decision(3, impl2, "accepted"),
        decision(4, staleCompletion, "rejected", ["stale_run"]),
        decision(5, staleAbort, "rejected", ["stale_run"]),
        decision(6, staleCost, "accepted"),
        decision(7, currentCost, "accepted"),
        decision(8, impl2Done, "accepted")
      ],
      attempts: [
        state(run1, { current: false, superseded_by: run2.id }),
        // Latest in its stage group, but its run is not current.
        state(impl1, { current: false }),
        state(run2, { current: true }),
        state(impl2, { current: true, outcome: "succeeded" })
      ],
      evidence: [
        { attempt_id: impl1.id, evidence_kind: "cost", latest_version: 1, write_ids: [staleCost.write_id] },
        { attempt_id: impl2.id, evidence_kind: "cost", latest_version: 1, write_ids: [currentCost.write_id] }
      ],
      derived: []
    }
  };
})();
var pendingSessionResolved = (() => {
  const pending = { harness: "codex", session_id: "pending:7f3a9c21" };
  const resolved = {
    harness: "codex",
    session_id: "019a3c11-2222-7333-8444-555566667777",
    resolves: "pending:7f3a9c21"
  };
  const run = attempt({ kind: "run", id: mint(31), parent: TASK, t: 0 });
  const review = attempt({
    kind: "stage_attempt",
    id: mint(32),
    parent: run.id,
    stage: "review",
    t: 1,
    sessions: [pending]
  });
  const firstSessions = evidence(mint(131), ref2(run.id, review.id), "session_resolution", 1, 2, {
    session_refs: [pending]
  });
  const reviewDone = outcome(mint(132), ref2(run.id, review.id), "succeeded", 3);
  const runDone = outcome(mint(133), ref2(run.id), "succeeded", 4);
  const resolution = evidence(mint(134), ref2(run.id, review.id), "session_resolution", 2, 60, {
    session_refs: [resolved]
  });
  const lateModel = evidence(mint(135), ref2(run.id, review.id), "executed_model", 1, 61, {
    executed_model: "gpt-5.5-codex"
  });
  const latePhase = control(mint(136), ref2(run.id, review.id), "phase", "review", 62);
  const replayedResolution = { ...resolution };
  const log = [run, review, firstSessions, reviewDone, runDone, resolution, lateModel, latePhase, replayedResolution];
  return {
    name: "codex-pending-session-resolved",
    description: "A review stage launches a Codex session known only as pending:<nonce>. The run settles. The session resolves a minute later: the resolution is evidence for the same stage_attempt_id at evidence_version 2, adds a session ref, and changes no ID or outcome. A control write after settlement is rejected; a replayed write is a duplicate.",
    log,
    expected: {
      decisions: [
        decision(0, run, "accepted"),
        decision(1, review, "accepted"),
        decision(2, firstSessions, "accepted"),
        decision(3, reviewDone, "accepted"),
        decision(4, runDone, "accepted"),
        decision(5, resolution, "accepted"),
        decision(6, lateModel, "accepted"),
        decision(7, latePhase, "rejected", ["settled"]),
        decision(8, replayedResolution, "duplicate")
      ],
      attempts: [
        state(run, { current: true, outcome: "succeeded" }),
        state(review, { current: true, outcome: "succeeded", session_refs: [pending, resolved] })
      ],
      evidence: [
        {
          attempt_id: review.id,
          evidence_kind: "session_resolution",
          latest_version: 2,
          write_ids: [firstSessions.write_id, resolution.write_id]
        },
        { attempt_id: review.id, evidence_kind: "executed_model", latest_version: 1, write_ids: [lateModel.write_id] }
      ],
      derived: []
    }
  };
})();
var sameSecondLaunches = (() => {
  const legacy = "planning@a1b2c3d#1793396483";
  const run = attempt({ kind: "run", id: mint(41), parent: TASK, t: 0 });
  const first = attempt({
    kind: "stage_attempt",
    id: mint(42),
    parent: run.id,
    stage: "planning",
    t: 5,
    legacy: [legacy]
  });
  const second = attempt({
    kind: "stage_attempt",
    id: mint(43),
    parent: run.id,
    stage: "planning",
    t: 5,
    legacy: [legacy]
  });
  const firstDone = outcome(mint(141), ref2(run.id, first.id), "succeeded", 6);
  const firstCost = evidence(mint(142), ref2(run.id, first.id), "cost", 1, 6);
  const secondDone = outcome(mint(143), ref2(run.id, second.id), "succeeded", 7);
  const log = [run, first, second, firstDone, firstCost, secondDone];
  return {
    name: "same-second-launches",
    description: "Two planning launches in the same second share Wavemill's derived label (kind@head7#epoch-seconds) but get distinct minted stage_attempt_ids. The later launch is current; the earlier one keeps its own evidence and cannot settle the stage.",
    log,
    expected: {
      decisions: [
        decision(0, run, "accepted"),
        decision(1, first, "accepted"),
        decision(2, second, "accepted"),
        decision(3, firstDone, "rejected", ["stale_stage_attempt"]),
        decision(4, firstCost, "accepted"),
        decision(5, secondDone, "accepted")
      ],
      attempts: [
        state(run, { current: true }),
        state(first, { current: false, superseded_by: second.id }),
        state(second, { current: true, outcome: "succeeded" })
      ],
      evidence: [{ attempt_id: first.id, evidence_kind: "cost", latest_version: 1, write_ids: [firstCost.write_id] }],
      derived: []
    }
  };
})();
var challengePair = (() => {
  const pair = attempt({ kind: "pair", id: mint(51), parent: TASK, t: 0 });
  const primary = attempt({ kind: "arm", id: mint(52), parent: pair.id, role: "primary", t: 1 });
  const challenger = attempt({ kind: "arm", id: mint(53), parent: pair.id, role: "challenger", t: 1 });
  const primaryRun = attempt({ kind: "run", id: mint(54), parent: primary.id, t: 2 });
  const challengerRun = attempt({ kind: "run", id: mint(55), parent: challenger.id, t: 2 });
  const challengerAborted = outcome(mint(151), ref2(challengerRun.id), "aborted", 30);
  const challengerRelaunch = attempt({
    kind: "run",
    id: mint(56),
    parent: challenger.id,
    retryOf: challengerRun.id,
    t: 40
  });
  const relaunchPhase = control(mint(152), ref2(challengerRelaunch.id), "phase", "planning", 41);
  const lateAbort = outcome(mint(153), ref2(challengerRun.id), "aborted", 42);
  const primaryDone = outcome(mint(154), ref2(primaryRun.id), "succeeded", 50);
  const challengerDone = outcome(mint(155), ref2(challengerRelaunch.id), "succeeded", 60);
  const log = [
    pair,
    primary,
    challenger,
    primaryRun,
    challengerRun,
    challengerAborted,
    challengerRelaunch,
    relaunchPhase,
    lateAbort,
    primaryDone,
    challengerDone
  ];
  return {
    name: "challenge-pair",
    description: "One pair, a primary and a challenger arm, each with its own run. Both runs are current at once. The challenger is aborted and relaunched as a new run under the same arm (retry_of): it does not inherit the abort, a late repeat of the abort cannot reach it, and the primary is unaffected.",
    log,
    expected: {
      decisions: [
        decision(0, pair, "accepted"),
        decision(1, primary, "accepted"),
        decision(2, challenger, "accepted"),
        decision(3, primaryRun, "accepted"),
        decision(4, challengerRun, "accepted"),
        decision(5, challengerAborted, "accepted"),
        decision(6, challengerRelaunch, "accepted"),
        decision(7, relaunchPhase, "accepted"),
        decision(8, lateAbort, "rejected", ["stale_run"]),
        decision(9, primaryDone, "accepted"),
        decision(10, challengerDone, "accepted")
      ],
      attempts: [
        state(pair, { current: true }),
        state(primary, { current: true }),
        state(challenger, { current: true }),
        state(primaryRun, { current: true, outcome: "succeeded" }),
        state(challengerRun, { current: false, superseded_by: challengerRelaunch.id, outcome: "aborted" }),
        state(challengerRelaunch, { current: true, outcome: "succeeded" })
      ],
      evidence: [],
      derived: []
    }
  };
})();
var comparisonRecomputed = (() => {
  const pair = attempt({ kind: "pair", id: mint(61), parent: TASK, t: 0 });
  const primary = attempt({ kind: "arm", id: mint(62), parent: pair.id, role: "primary", t: 0 });
  const challenger = attempt({ kind: "arm", id: mint(63), parent: pair.id, role: "challenger", t: 0 });
  const primaryRun = attempt({ kind: "run", id: mint(64), parent: primary.id, t: 1 });
  const challengerRun = attempt({ kind: "run", id: mint(65), parent: challenger.id, t: 1 });
  const primaryDone = outcome(mint(161), ref2(primaryRun.id), "succeeded", 10);
  const challengerDone = outcome(mint(162), ref2(challengerRun.id), "succeeded", 11);
  const primaryCost = evidence(mint(163), ref2(primaryRun.id), "cost", 1, 12, { cost_event_ids: ["event-0101"] });
  const challengerCost1 = evidence(mint(164), ref2(challengerRun.id), "cost", 1, 12, {
    cost_event_ids: ["event-0201"]
  });
  const comparison1 = derivedResult(
    mint(165),
    [
      { attempt: ref2(primaryRun.id), evidence_kind: "cost", evidence_version: 1 },
      { attempt: ref2(challengerRun.id), evidence_kind: "cost", evidence_version: 1 }
    ],
    13
  );
  const challengerCost2 = evidence(mint(166), ref2(challengerRun.id), "cost", 2, 120, {
    cost_event_ids: ["event-0201", "event-0202"]
  });
  const comparison2 = derivedResult(
    mint(167),
    [
      { attempt: ref2(primaryRun.id), evidence_kind: "cost", evidence_version: 1 },
      { attempt: ref2(challengerRun.id), evidence_kind: "cost", evidence_version: 2 }
    ],
    121,
    comparison1.derived_id
  );
  const log = [
    pair,
    primary,
    challenger,
    primaryRun,
    challengerRun,
    primaryDone,
    challengerDone,
    primaryCost,
    challengerCost1,
    comparison1,
    challengerCost2,
    comparison2
  ];
  return {
    name: "comparison-recomputed",
    description: "A challenge comparison is computed from incomplete challenger cost (evidence_version 1). Corrected cost arrives as version 2 after both runs settled: the outcomes do not change, the comparison becomes stale, and a recomputed comparison supersedes it.",
    log,
    prefixExpectations: [
      {
        length: 10,
        derived: [{ derived_id: comparison1.derived_id, derived_kind: "challenge_comparison", status: "current" }]
      },
      {
        length: 11,
        derived: [
          {
            derived_id: comparison1.derived_id,
            derived_kind: "challenge_comparison",
            status: "stale",
            stale_inputs: [{ attempt: ref2(challengerRun.id), evidence_kind: "cost", evidence_version: 1 }]
          }
        ]
      }
    ],
    expected: {
      decisions: log.map((entry, index) => decision(index, entry, "accepted")),
      attempts: [
        state(pair, { current: true }),
        state(primary, { current: true }),
        state(challenger, { current: true }),
        state(primaryRun, { current: true, outcome: "succeeded" }),
        state(challengerRun, { current: true, outcome: "succeeded" })
      ],
      evidence: [
        { attempt_id: primaryRun.id, evidence_kind: "cost", latest_version: 1, write_ids: [primaryCost.write_id] },
        {
          attempt_id: challengerRun.id,
          evidence_kind: "cost",
          latest_version: 2,
          write_ids: [challengerCost1.write_id, challengerCost2.write_id]
        }
      ],
      derived: [
        {
          derived_id: comparison1.derived_id,
          derived_kind: "challenge_comparison",
          status: "superseded",
          superseded_by: comparison2.derived_id
        },
        { derived_id: comparison2.derived_id, derived_kind: "challenge_comparison", status: "current" }
      ]
    }
  };
})();
var twoPrMergeCandidate = (() => {
  const runA = attempt({ kind: "run", id: mint(71), parent: TASK, t: 0 });
  const runB = attempt({ kind: "run", id: mint(72), parent: OTHER_TASK, task: OTHER_TASK, t: 0 });
  const runADone = outcome(mint(171), ref2(runA.id), "succeeded", 10);
  const runBDone = outcome(mint(172), ref2(runB.id, void 0, OTHER_TASK), "succeeded", 11);
  const checkA = evidence(mint(173), ref2(runA.id), "check_run", 1, 20);
  const checkB = evidence(mint(174), ref2(runB.id, void 0, OTHER_TASK), "check_run", 1, 20);
  const wrongTask = evidence(mint(175), ref2(runB.id), "check_run", 2, 21);
  const log = [runA, runB, runADone, runBDone, checkA, checkB, wrongTask];
  return {
    name: "two-pr-merge-candidate",
    description: "A merge-queue candidate spans two PRs from two tasks. The candidate references both runs (attempt_refs); it is not itself a run or attempt. Check-run evidence lands on each run. A ref naming a run under the wrong task is rejected as a mismatch.",
    log,
    extensionRecords: [
      {
        event_id: mint(176),
        candidate_id: mint(177),
        attempt_refs: [ref2(runA.id), ref2(runB.id, void 0, OTHER_TASK)]
      }
    ],
    expected: {
      decisions: [
        decision(0, runA, "accepted"),
        decision(1, runB, "accepted"),
        decision(2, runADone, "accepted"),
        decision(3, runBDone, "accepted"),
        decision(4, checkA, "accepted"),
        decision(5, checkB, "accepted"),
        decision(6, wrongTask, "rejected", ["ref_mismatch"])
      ],
      attempts: [
        state(runA, { current: true, outcome: "succeeded" }),
        state(runB, { current: true, outcome: "succeeded" })
      ],
      evidence: [
        { attempt_id: runA.id, evidence_kind: "check_run", latest_version: 1, write_ids: [checkA.write_id] },
        { attempt_id: runB.id, evidence_kind: "check_run", latest_version: 1, write_ids: [checkB.write_id] }
      ],
      derived: []
    }
  };
})();

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
    const evidence3 = ciEvidence();
    if (evidence3) return { value: evidence3.value, evidence: evidence3.provenance };
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
  for (const change2 of changes) {
    const ext = getExtension(change2.headPath || change2.basePath || "");
    if (!COMPLEXITY_EXTENSIONS.has(ext)) continue;
    if (change2.basePath && change2.status !== "A") {
      const baseSource = runGit(
        checkoutDir,
        ["show", `${mergeBase}:${change2.basePath}`],
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
    if (change2.headPath && change2.status !== "D") {
      const absPath = join2(checkoutDir, change2.headPath);
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
function getExtension(path4) {
  const lastSlash = path4.lastIndexOf("/");
  const base = lastSlash >= 0 ? path4.slice(lastSlash + 1) : path4;
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
  const changedFiles2 = names.split("\n").map((line) => line.trim()).filter(Boolean).sort();
  let linesAdded = 0;
  let linesDeleted = 0;
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, deleted] = line.split("	");
    linesAdded += parseNumstatCount(added);
    linesDeleted += parseNumstatCount(deleted);
  }
  return {
    changedFiles: changedFiles2,
    filesTouched: changedFiles2.length,
    linesAdded,
    linesDeleted,
    locTouched: linesAdded + linesDeleted,
    diffUncertain: changedFiles2.length > 0 && numstat.trim().length === 0
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
  const allowedPrefixes = (contract.scope.allowedPrefixes ?? []).map(normalizeRepoPath).filter((path4) => Boolean(path4)).map((path4) => path4.endsWith("/") ? path4 : `${path4}/`);
  if (allowedFiles.size === 0 && allowedPrefixes.length === 0) return null;
  let outOfScope = 0;
  for (const file of diffStats.changedFiles) {
    const normalized = normalizeRepoPath(file);
    if (!normalized) {
      outOfScope += 1;
      continue;
    }
    const allowed = allowedFiles.has(normalized) || allowedPrefixes.some((prefix) => normalized.startsWith(prefix));
    if (!allowed) outOfScope += 1;
  }
  return outOfScope;
}
function normalizeRepoPath(path4) {
  const normalized = path4.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  return normalized;
}
function isTestFile(path4) {
  return TEST_FILE_PATTERN.test(path4);
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
  const normalized = normalizeComplexity(
    typeof value === "string" || typeof value === "number" ? value : void 0
  );
  if (typeof normalized !== "number" || !Number.isFinite(normalized)) return null;
  return Math.max(0, Math.min(10, normalized));
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
function isExistingDir(path4) {
  try {
    return statSync2(path4).isDirectory();
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
    const path4 = normalizedStatus === "R" || normalizedStatus === "C" ? secondPath : firstPath;
    return {
      status: normalizedStatus,
      path: path4,
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
var SURVIVAL_LABELLER_VERSION = "1.4.0";
var SURVIVAL_NORMALIZATION_VERSION = "1.0.0";
var DAY_SECONDS = 86400;
var GIT_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;
function assertIntegrationBranch(target) {
  if (target.integrationBranch === "main" && target.integrationMode !== "direct") {
    throw new Error(
      'survival-labeller: integrationBranch "main" requires integrationMode "direct" (S2 v1.1.0): squash promotion rewrites the SHA lineage the labeller needs'
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
    const match = enumerated.find((ref3) => ref3.prNumber === prNumber);
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
    const path4 = entry.newPath ?? entry.oldPath;
    if (!path4) continue;
    files.push({ path: path4, oldPath: entry.oldPath ?? path4, hunks: entry.hunks });
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
var LS_TREE_CHUNK = 400;
function blobsAt(deps, sha, paths) {
  const out = new Map(paths.map((path4) => [path4, null]));
  const unique2 = [...new Set(paths)];
  for (let i = 0; i < unique2.length; i += LS_TREE_CHUNK) {
    const chunk = unique2.slice(i, i + LS_TREE_CHUNK);
    const result = deps.runGit(["--literal-pathspecs", "ls-tree", "-z", "--full-tree", sha, "--", ...chunk]);
    if (result.exitCode !== 0) continue;
    for (const entry of result.stdout.split("\0")) {
      const tab = entry.indexOf("	");
      if (tab < 0) continue;
      const oid = entry.slice(0, tab).split(" ")[2];
      const path4 = entry.slice(tab + 1);
      if (oid && out.has(path4)) out.set(path4, oid);
    }
  }
  return out;
}
function forwardFate(deps, pr, substrate, terminalSha) {
  const toFate = (stdout) => {
    const fate = /* @__PURE__ */ new Map();
    for (const entry of parseNameStatusOutput(stdout)) {
      fate.set(entry.previousPath ?? entry.path, { status: entry.status, newPath: entry.path });
    }
    return fate;
  };
  const paths = [...new Set(substrate.files.map((file) => file.path))].sort();
  if (paths.length > 0) {
    const scoped = deps.runGit([
      "--literal-pathspecs",
      "diff",
      "--name-status",
      "--no-renames",
      pr.mergeSha,
      terminalSha,
      "--",
      ...paths
    ]);
    if (scoped.exitCode !== 0) return null;
    const fate = toFate(scoped.stdout);
    if (![...fate.values()].some((entry) => entry.status === "D")) return fate;
  }
  const nameStatus = deps.runGit(["diff", "--name-status", "--find-renames", pr.mergeSha, terminalSha]);
  if (nameStatus.exitCode !== 0) return null;
  return toFate(nameStatus.stdout);
}
function analyseForward(deps, pr, substrate, terminalSha, baseBlobs) {
  const fate = forwardFate(deps, pr, substrate, terminalSha);
  if (!fate) return null;
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
  const mappedPaths = substrate.files.map((file) => {
    const fileFate = fate.get(file.path);
    return fileFate?.status === "D" ? null : fileFate?.newPath ?? file.path;
  });
  const { parent: parentBlobs, merge: mergeBlobs } = baseBlobs();
  const terminalBlobs = blobsAt(deps, terminalSha, mappedPaths.filter((path4) => path4 !== null));
  for (const [index, file] of substrate.files.entries()) {
    const mappedPath = mappedPaths[index];
    const parentBlob = parentBlobs.get(file.oldPath) ?? null;
    const mergeBlob = mergeBlobs.get(file.path) ?? null;
    const terminalBlob = mappedPath ? terminalBlobs.get(mappedPath) ?? null : null;
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
var BOT_LOGIN_PATTERN = /(?:\[bot\]|bot|robot)$/i;
function isFollowupReference(ref3, target) {
  const sameRepo = new RegExp(`^https://github\\.com/${escapeRegExp(target.owner)}/${escapeRegExp(target.repo)}/(?:issues|pull)/\\d+`, "i");
  if (!sameRepo.test(ref3.url)) return false;
  if (ref3.sourceAuthorType === "Bot" || ref3.sourceAuthorLogin && BOT_LOGIN_PATTERN.test(ref3.sourceAuthorLogin)) return false;
  if (typeof ref3.sourceBaseRef === "string" && ref3.sourceBaseRef !== target.integrationBranch) return false;
  return true;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var AGENT_NAME_PATTERN = /^(?:claude(?: code)?|codex|(?:github )?copilot|devin(?:-ai-integration)?|aider|cursor(?:-agent)?|openhands(?:-agent)?)(?:\[bot\])?$/i;
var AGENT_EMAIL_PATTERN = /@(?:anthropic|openai)\.com$|\bcopilot@users\.noreply\.github\.com$|devin-ai-integration/i;
var AUTOMATION_NAME_PATTERN = /\[bot\]$|(?:^|[\s_-])(?:bot|robot)$|mergebot$|^bors$/i;
var CO_AUTHOR_TRAILER = /^co-authored-by:\s*(.*?)\s*<([^>]*)>/gim;
function classifyIdentity(name, email) {
  if (AGENT_NAME_PATTERN.test(name.trim()) || AGENT_EMAIL_PATTERN.test(email.trim())) return "agent";
  if (AUTOMATION_NAME_PATTERN.test(name.trim())) return "automation";
  return "human";
}
function classifyCommitActor(commit) {
  const author = classifyIdentity(commit.authorName, commit.authorEmail);
  if (author === "agent") return "agent";
  for (const [, name = "", email = ""] of commit.body.matchAll(CO_AUTHOR_TRAILER)) {
    if (classifyIdentity(name, email) === "agent") return "agent";
  }
  return author;
}
function attributeUndoers(deps, pr, terminalSha, touchedPaths, extraVotes) {
  const votes = new Set(extraVotes);
  if (touchedPaths.length > 0) {
    const result = deps.runGit([
      "log",
      "--no-merges",
      "--pretty=format:%H%x1f%an%x1f%ae%x1f%B%x1e",
      `${pr.landedSha ?? pr.mergeSha}..${terminalSha}`,
      "--",
      ...touchedPaths
    ]);
    if (result.exitCode === 0) {
      for (const record of result.stdout.split("")) {
        if (!record.trim()) continue;
        const [, authorName = "", authorEmail = "", body = ""] = record.split("");
        const actor = classifyCommitActor({ authorName, authorEmail, body });
        if (actor !== "automation") votes.add(actor);
      }
    }
  }
  if (votes.size === 1) return [...votes][0];
  return null;
}
var ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
var NON_TASK_KEY_PREFIXES = /* @__PURE__ */ new Set([
  "CVE",
  "CWE",
  "GHSA",
  "PEP",
  "RFC",
  "ISO",
  "UTF",
  "SHA",
  "MD",
  "HTTP",
  "TLS",
  "SSL",
  "ECMA",
  "ES",
  "IEEE",
  "POSIX",
  "UCS",
  "WCAG",
  "FIPS",
  "NIST"
]);
function extractIssueKeys(text) {
  return new Set((text.match(ISSUE_KEY_PATTERN) ?? []).filter((key) => !NON_TASK_KEY_PREFIXES.has(key.slice(0, key.lastIndexOf("-")))));
}
var redispatchIndexes = /* @__PURE__ */ new WeakMap();
function redispatchIndex(all) {
  let index = redispatchIndexes.get(all);
  if (!index) {
    index = /* @__PURE__ */ new Map();
    for (const other of all) {
      for (const key of extractIssueKeys(other.subject)) {
        const list = index.get(key) ?? [];
        list.push({ epoch: other.mergedAtEpoch, mergeSha: other.mergeSha });
        index.set(key, list);
      }
    }
    redispatchIndexes.set(all, index);
  }
  return index;
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
      integration_mode: target.integrationMode ?? "promotion",
      computed_at: deps.now().toISOString()
    }
  });
}
function buildHorizonTerminalIndex(deps, branch) {
  const result = deps.runGit(["log", "--first-parent", "--pretty=format:%H %ct", branch]);
  if (result.exitCode !== 0) return null;
  const shas = [];
  const prefixMin = [];
  let min = Number.POSITIVE_INFINITY;
  for (const line of result.stdout.split("\n")) {
    const [sha, ct] = line.split(" ");
    const epoch = Number(ct);
    if (!sha || !Number.isFinite(epoch)) continue;
    min = Math.min(min, epoch);
    shas.push(sha);
    prefixMin.push(min);
  }
  return { shas, prefixMin };
}
function lookupHorizonTerminal(index, cutoffEpoch) {
  let lo = 0;
  let hi = index.prefixMin.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (index.prefixMin[mid] <= cutoffEpoch) hi = mid;
    else lo = mid + 1;
  }
  return index.shas[lo] ?? null;
}
function resolveHorizonTerminal(deps, target, cutoffEpoch, index) {
  if (index) return lookupHorizonTerminal(index, cutoffEpoch);
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
  let base = null;
  const baseBlobs = () => base ??= {
    parent: blobsAt(deps, pr.parentSha, substrate?.files.map((file) => file.oldPath) ?? []),
    merge: blobsAt(deps, pr.mergeSha, substrate?.files.map((file) => file.path) ?? [])
  };
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
      (ref3) => ref3.createdAtEpoch > pr.mergedAtEpoch && ref3.createdAtEpoch <= cutoffEpoch && isFollowupReference(ref3, target)
    );
  };
  const issueKeys = extractIssueKeys(pr.subject);
  const redispatchAt = (cutoffEpoch) => {
    if (issueKeys.size === 0 || !options.allMergedPrs) return false;
    const index = redispatchIndex(options.allMergedPrs);
    return [...issueKeys].some(
      (key) => (index.get(key) ?? []).some(
        (other) => other.mergeSha !== pr.mergeSha && other.epoch > pr.mergedAtEpoch && other.epoch <= cutoffEpoch
      )
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
    const terminalSha = resolveHorizonTerminal(deps, target, cutoffEpoch, options.horizonTerminalIndex);
    if (!terminalSha) {
      labels.push(missingLabel(pr, target, deps, horizon2, "inaccessible_history", {
        lineRanges: substrate.lineRanges
      }));
      continue;
    }
    const analysis = analyseForward(deps, pr, substrate, terminalSha, baseBlobs);
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
        integration_mode: target.integrationMode ?? "promotion",
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
    const outcome2 = label2.outcome.report_outcome;
    if (outcome2 === null) bucket.missing += 1;
    else bucket[outcome2] += 1;
    horizons[key] = bucket;
  }
  for (const bucket of Object.values(horizons)) {
    const labelled = bucket.rows - bucket.missing;
    bucket.survival_rate = labelled > 0 ? bucket.survived / labelled : null;
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
          url: event17.source?.issue?.html_url ?? "",
          // The timeline does not carry a referencing PR's base branch; sourceBaseRef stays unknown.
          sourceAuthorLogin: event17.source?.issue?.user?.login ?? null,
          sourceAuthorType: event17.source?.issue?.user?.type ?? null
        })).filter((ref3) => Number.isFinite(ref3.createdAtEpoch));
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
function createDefaultScanGitHubClient(target) {
  const env = target.token ? { ...process.env, GH_TOKEN: target.token } : process.env;
  const api = (path4) => {
    const result = execArgvCommand("gh", ["api", path4, "-H", "Accept: application/vnd.github+json"], { env, cwd: target.repoDir, maxBuffer: 16 * 1024 * 1024 });
    if (result.exitCode !== 0) {
      if (/HTTP 404/i.test(result.stderr)) return "";
      throw new ScanUpstreamError(classifyUpstreamFailure(result));
    }
    return result.stdout;
  };
  const parse = (text) => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new ScanUpstreamError("GitHub returned malformed JSON");
    }
  };
  return {
    async getRepo() {
      await Promise.resolve();
      const repo = parse(api(`repos/${target.owner}/${target.repo}`));
      if (!repo?.default_branch) throw new ScanUpstreamError("GitHub repository metadata is unavailable");
      return { defaultBranch: repo.default_branch, private: repo.private === true };
    },
    async getPullRequest(number) {
      await Promise.resolve();
      const raw = parse(api(`repos/${target.owner}/${target.repo}/pulls/${number}`));
      if (!raw) return null;
      if (!raw.number || !raw.head?.ref || !raw.head.sha || !raw.merged_at) return null;
      return { number: raw.number, title: raw.title ?? "", body: raw.body ?? null, authorLogin: raw.user?.login ?? null, authorType: raw.user?.type ?? null, headRef: raw.head.ref, headSha: raw.head.sha, labels: (raw.labels ?? []).flatMap((label2) => label2.name ? [label2.name] : []), mergedAt: raw.merged_at };
    },
    async listPullCommits(number) {
      await Promise.resolve();
      const messages = [];
      for (let page = 1; page <= 100; page++) {
        const commits = parse(api(`repos/${target.owner}/${target.repo}/pulls/${number}/commits?per_page=100&page=${page}`)) ?? [];
        messages.push(...commits.flatMap((commit) => commit.commit?.message ? [commit.commit.message] : []));
        if (commits.length < 100) break;
      }
      return messages;
    },
    async getCheckConclusion(sha) {
      await Promise.resolve();
      const checks = parse(api(`repos/${target.owner}/${target.repo}/commits/${sha}/check-runs?per_page=100`));
      const conclusions = (checks?.check_runs ?? []).map((check) => check.conclusion).filter((x) => typeof x === "string");
      if (!conclusions.length) return "none";
      if (conclusions.some((x) => x === "failure" || x === "timed_out" || x === "action_required")) return "failure";
      if (conclusions.every((x) => x === "success")) return "success";
      return "neutral";
    }
  };
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
function validateIntegrationMode(value) {
  if (value === void 0 || value === "promotion") return "promotion";
  if (value === "direct") return "direct";
  throw new ScanInputError("--integration-mode must be promotion or direct");
}
function validateIntegrationBranch(value, mode = "promotion") {
  if (!value || !value.trim()) {
    throw new ScanInputError("--integration-branch is required");
  }
  if (value === "main" && mode !== "direct") {
    throw new ScanInputError("integration branch main requires --integration-mode direct (S2 v1.1.0): main is only safe to walk when PRs merge into it directly");
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
function isAncestor(runGit3, sha, ref3) {
  try {
    const result = runGit3(["merge-base", "--is-ancestor", sha, ref3]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
function discoverMerges(opts) {
  const { runGit: runGit3, ref: ref3, cursor, bootstrapDays, now, maxPrs } = opts;
  const merges = [];
  let cursorReset = false;
  let useBootstrapWindow = cursor === null;
  if (cursor !== null && !isAncestor(runGit3, cursor, ref3)) {
    cursorReset = true;
    useBootstrapWindow = true;
  }
  const cutoffEpoch = Math.floor(now().getTime() / 1e3) - bootstrapDays * 86400;
  const format = "%H%x09%P%x09%ct%x09%s";
  const sinceArgs = cutoffEpoch > 0 ? [`--since=${new Date(cutoffEpoch * 1e3).toISOString()}`] : [];
  const args = useBootstrapWindow ? ["log", "--first-parent", "--reverse", `--pretty=format:${format}`, ...sinceArgs, ref3] : ["log", "--first-parent", "--reverse", `--pretty=format:${format}`, `${cursor}..${ref3}`];
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
function writeState(dir, state2) {
  const stateFile = path.join(dir, "state.json");
  const result = validateShadowState(state2);
  if (!result.ok) {
    throw new ShadowError("INVALID_ROW");
  }
  writeFileAtomic(stateFile, JSON.stringify(state2, null, 2));
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
  let labelled = 0;
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
        const outcome2 = {
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
        const validation = validateShadowOutcomeRow(outcome2);
        if (!validation.ok) {
          log(`SHADOW_SKIP pr=${score.pr_number} code=INVALID_ROW`);
          skipped++;
          continue;
        }
        rows.push(outcome2);
        labelled++;
      } catch {
        log(`SHADOW_SKIP pr=${score.pr_number} code=LABEL_FAILED`);
        skipped++;
      }
    }
    if (rows.length > 0) {
      appendJsonl(outcomesFile, rows, validateShadowOutcomeRow);
    }
  }
  return { labelled, pending, skipped, unlabellable };
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
    const outcome2 = outcomeFor(score);
    if (!outcome2 || outcome2.survived === null) continue;
    if (outcome2.survived) survived++;
    if (isFlagged) {
      flaggedMatured++;
      if (outcome2.survived) flaggedSurvived++;
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
      const outcome2 = outcomeFor(score);
      if (!outcome2) continue;
      if (outcome2.survived === null) n_unlabelled++;
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

// src/corpus/cli.ts
import { createHash as createHash4, randomBytes } from "node:crypto";
import { chmodSync, closeSync as closeSync2, existsSync as existsSync4, mkdirSync as mkdirSync2, openSync as openSync2, readdirSync, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync2, writeSync as writeSync2 } from "node:fs";
import { dirname, join as join7, resolve as resolve4 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";
import { gzipSync, inflateRawSync } from "node:zlib";

// src/corpus/calibration.ts
import { createHash as createHash3 } from "node:crypto";

// src/report/stats.ts
function round42(value) {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}
function roundedInterval(low, high, value) {
  let lo = round42(Math.max(0, Math.min(1, low)));
  let hi = round42(Math.max(0, Math.min(1, high)));
  if (value !== void 0) {
    lo = Math.min(lo, round42(value));
    hi = Math.max(hi, round42(value));
  }
  return { low: lo, high: hi };
}
function wilsonInterval(k, n, z = 1.959964) {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n < 0 || k < 0 || k > n || !Number.isInteger(k) || !Number.isInteger(n) || z <= 0) {
    throw new RangeError("wilsonInterval requires integer counts with 0 <= k <= n and z > 0");
  }
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / den;
  return roundedInterval(center - half, center + half, p);
}
function katzLogRatioInterval(k1, n1, k2, n2) {
  for (const [k, n] of [[k1, n1], [k2, n2]]) {
    if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) {
      throw new RangeError("katzLogRatioInterval requires integer counts with 0 <= k <= n");
    }
  }
  const corrected = [k1, n1 - k1, k2, n2 - k2].some((x) => x === 0);
  const a = k1 + (corrected ? 0.5 : 0);
  const b = n1 - k1 + (corrected ? 0.5 : 0);
  const c = k2 + (corrected ? 0.5 : 0);
  const d = n2 - k2 + (corrected ? 0.5 : 0);
  const ratio3 = a / (a + b) / (c / (c + d));
  const se = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const low = Math.exp(Math.log(ratio3) - 1.959964 * se);
  const high = Math.exp(Math.log(ratio3) + 1.959964 * se);
  const r = round42(ratio3);
  return { ratio: r, low: Math.min(r, round42(low)), high: Math.max(r, round42(high)) };
}
function nearestRankQuartiles(sorted) {
  if (!sorted.length) return null;
  for (let i = 0; i < sorted.length; i++) {
    if (!Number.isFinite(sorted[i]) || i > 0 && sorted[i] < sorted[i - 1]) {
      throw new RangeError("nearestRankQuartiles requires finite ascending values");
    }
  }
  const at2 = (q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return [at2(0.25), at2(0.5), at2(0.75)];
}
function quartileOf(value, cuts) {
  if (!Number.isFinite(value) || cuts.some((n, i) => !Number.isFinite(n) || i > 0 && n < cuts[i - 1])) {
    throw new RangeError("quartileOf requires finite values and ascending cuts");
  }
  return value <= cuts[0] ? "q1" : value <= cuts[1] ? "q2" : value <= cuts[2] ? "q3" : "q4";
}

// src/corpus/calibration.ts
var CALIBRATION_SAMPLER_VERSION = "1.0.0";
var CALIBRATION_STRATA = ["revert", "repair_reference", "regression_issue", "szz_strong", "szz_weak", "rejected", "negative"];
function parseCalibrationPlan(raw) {
  const plan = raw;
  if (!plan || typeof plan !== "object") throw new Error("plan must be an object");
  const allocation = plan.allocation;
  if (!allocation || typeof allocation !== "object") throw new Error("plan.allocation is required");
  for (const stratum of CALIBRATION_STRATA) {
    if (!Number.isInteger(allocation[stratum]) || allocation[stratum] < 0) throw new Error(`plan.allocation.${stratum} must be a non-negative integer`);
  }
  const extra = Object.keys(allocation).filter((k) => !CALIBRATION_STRATA.includes(k));
  if (extra.length) throw new Error(`plan.allocation has unknown strata: ${extra.join(", ")}`);
  const num2 = (key, ok) => {
    const v = plan[key];
    if (typeof v !== "number" || !ok(v)) throw new Error(`plan.${key} is out of range`);
    return v;
  };
  if (typeof plan.plan_version !== "string") throw new Error("plan.plan_version is required");
  return {
    plan_version: plan.plan_version,
    horizon_days: num2("horizon_days", (v) => Number.isInteger(v) && v > 0),
    allocation,
    double_label_share: num2("double_label_share", (v) => v >= 0 && v <= 1),
    human_audit_share: num2("human_audit_share", (v) => v > 0 && v <= 1),
    labellers: parseLabellers(plan.labellers),
    min_repos: num2("min_repos", (v) => Number.isInteger(v) && v >= 1),
    szz_strong_min_lines: num2("szz_strong_min_lines", (v) => Number.isInteger(v) && v >= 1),
    kappa_floor: num2("kappa_floor", (v) => v > 0 && v <= 1),
    definition_precision_floor: num2("definition_precision_floor", (v) => v > 0 && v <= 1)
  };
}
function parseLabellers(raw) {
  const l = raw;
  if (!l || typeof l.a !== "string" || typeof l.b !== "string" || !l.a || !l.b) throw new Error("plan.labellers needs model IDs for a and b");
  if (l.a === l.b) throw new Error("plan.labellers.a and .b must be different models");
  return { a: l.a, b: l.b };
}
var sha256 = (...parts) => createHash3("sha256").update(parts.join("\0")).digest("hex");
function seededOrder(list, key) {
  return list.map((item) => [key(item), item]).sort((a, b) => a[0].localeCompare(b[0])).map(([, item]) => item);
}
var STRATUM_PRIORITY = ["revert", "repair_reference", "regression_issue", "szz"];
function classifyCalibrationRepo(input) {
  const horizonSeconds = input.horizonDays * 86400;
  const byOriginal = /* @__PURE__ */ new Map();
  for (const c of input.candidates) {
    if (c.lag_seconds > horizonSeconds) continue;
    const list = byOriginal.get(c.original.pr_url) ?? [];
    list.push({
      candidate_id: c.candidate_id,
      proxy: c.proxy,
      status: c.status,
      exclusion_code: c.exclusion_code,
      fix_url: c.fix.pr_url ?? `https://github.com/${input.repo}/commit/${c.fix.sha}`,
      lag_days: Math.round(c.lag_seconds / 86400 * 10) / 10,
      blamed_lines: c.evidence.find((e) => e.kind === "blamed_lines")?.count ?? null,
      revert_reason: c.evidence.find((e) => e.kind === "revert_reason")?.ref ?? null
    });
    byOriginal.set(c.original.pr_url, list);
  }
  const units = [];
  for (const row of input.correctiveRows) {
    if (row.horizon_days !== input.horizonDays || row.corrective === null) continue;
    const candidates = (byOriginal.get(row.prUrl) ?? []).sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
    const accepted2 = new Set(row.repair_pair_ids);
    const acceptedCandidates = candidates.filter((c) => accepted2.has(c.candidate_id));
    const proxies = [...new Set(acceptedCandidates.map((c) => c.proxy))].filter((p) => ADMITTED_PROXIES.includes(p)).sort();
    let stratum;
    if (row.corrective) {
      const top = STRATUM_PRIORITY.find((p) => proxies.includes(p));
      if (!top) throw new Error(`${row.prUrl}: corrective row without an accepted pair within ${input.horizonDays} days`);
      if (top === "szz") {
        const lines = Math.max(...acceptedCandidates.filter((c) => c.proxy === "szz").map((c) => c.blamed_lines ?? 0));
        stratum = lines >= input.szzStrongMinLines ? "szz_strong" : "szz_weak";
      } else stratum = top;
    } else stratum = candidates.length ? "rejected" : "negative";
    units.push({ repo: input.repo, pr_url: row.prUrl, stratum, proxies, candidates });
  }
  return units;
}
function drawCalibrationSample(units, plan, seed) {
  const items = [];
  const cells = /* @__PURE__ */ new Map();
  const shortfalls = [];
  for (const stratum of CALIBRATION_STRATA) {
    const byRepo = /* @__PURE__ */ new Map();
    for (const u of units) {
      if (u.stratum !== stratum) continue;
      const list = byRepo.get(u.repo);
      if (list) list.push(u);
      else byRepo.set(u.repo, [u]);
    }
    for (const [repo, list] of byRepo) {
      byRepo.set(repo, seededOrder(list, (u) => sha256(seed, stratum, u.pr_url)));
      cells.set(`${repo}\0${stratum}`, { repo, stratum, population: list.length, sampled: 0 });
    }
    const repos = seededOrder([...byRepo.keys()], (repo) => sha256(seed, "repo", stratum, repo));
    const want = plan.allocation[stratum];
    const picked = [];
    for (let round = 0; picked.length < want; round++) {
      let any = false;
      for (const repo of repos) {
        const unit = byRepo.get(repo)[round];
        if (!unit || picked.length >= want) continue;
        picked.push(unit);
        cells.get(`${repo}\0${stratum}`).sampled++;
        any = true;
      }
      if (!any) break;
    }
    if (picked.length < want) shortfalls.push({ stratum, allocated: want, drawn: picked.length });
    const doubles = new Set(
      seededOrder(picked, (u) => sha256(seed, "double", u.pr_url)).slice(0, Math.ceil(picked.length * plan.double_label_share)).map((u) => u.pr_url)
    );
    const audited = new Set(
      seededOrder(picked, (u) => sha256(seed, "audit", u.pr_url)).slice(0, Math.ceil(picked.length * plan.human_audit_share)).map((u) => u.pr_url)
    );
    for (const unit of picked) items.push({ ...unit, item_id: sha256(seed, "item", unit.pr_url).slice(0, 12), double: doubles.has(unit.pr_url), audit: audited.has(unit.pr_url) });
  }
  return {
    items: seededOrder(items, (i) => sha256(seed, "order", i.item_id)),
    cells: [...cells.values()].sort((x, y) => x.repo.localeCompare(y.repo) || CALIBRATION_STRATA.indexOf(x.stratum) - CALIBRATION_STRATA.indexOf(y.stratum)),
    shortfalls
  };
}
var SHEET_COLUMNS = ["item_id", "pr_url", "candidate_fixes", "related_prs", "corrective", "cause_code", "exclusion_code", "notes"];
var csvCell = (value) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
function renderLabelSheet(items, related = /* @__PURE__ */ new Map(), filled = /* @__PURE__ */ new Map()) {
  const rows = items.map((item) => {
    const row = {
      item_id: item.item_id,
      pr_url: item.pr_url,
      candidate_fixes: [...new Set(item.candidates.map((c) => c.fix_url))].sort().join(" "),
      related_prs: (related.get(item.item_id) ?? []).join(" "),
      ...filled.get(item.item_id)
    };
    return SHEET_COLUMNS.map((c) => row[c] ?? "");
  });
  return `${[SHEET_COLUMNS, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")}
`;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell2 = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell2 += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell2 += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell2);
      cell2 = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell2);
      rows.push(row);
      row = [];
      cell2 = "";
    } else cell2 += ch;
  }
  if (cell2 || row.length) {
    row.push(cell2);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function parseLabelSheet(text, items) {
  const [header, ...rows] = parseCsv(text);
  const col = (name) => header?.indexOf(name) ?? -1;
  const errors = [];
  const missing = ["item_id", "corrective", "cause_code", "exclusion_code"].filter((c) => col(c) < 0);
  if (missing.length) return { labels: /* @__PURE__ */ new Map(), unlabelled: [], errors: [`missing columns: ${missing.join(", ")}`] };
  const labels = /* @__PURE__ */ new Map();
  const unlabelled = [];
  const causes = CAUSE_CODES;
  const exclusions = HUMAN_EXCLUSION_CODES;
  for (const r of rows) {
    const get = (name) => (r[col(name)] ?? "").trim().toLowerCase();
    const id2 = (r[col("item_id")] ?? "").trim();
    const item = items.get(id2);
    if (!item) {
      errors.push(`${id2 || "(blank)"}: not in the sample`);
      continue;
    }
    if (labels.has(id2)) {
      errors.push(`${id2}: labelled twice on one sheet`);
      continue;
    }
    const verdict = get("corrective");
    const cause = get("cause_code");
    const exclusion = get("exclusion_code") || null;
    if (!verdict) {
      unlabelled.push(id2);
      continue;
    }
    if (!CALIBRATION_VERDICTS.includes(verdict)) {
      errors.push(`${id2}: corrective must be yes, no or unclear, not "${verdict}"`);
      continue;
    }
    if (verdict === "yes") {
      if (!causes.includes(cause) || cause === "not_rework") errors.push(`${id2}: a yes needs a cause code other than not_rework`);
      if (exclusion) errors.push(`${id2}: a yes takes no exclusion code`);
      labels.set(id2, { verdict, cause_code: cause, exclusion_code: null });
    } else if (verdict === "no") {
      if (cause && cause !== "not_rework") errors.push(`${id2}: a no takes cause not_rework (or blank)`);
      if (exclusion && !exclusions.includes(exclusion)) errors.push(`${id2}: unknown exclusion code "${exclusion}"`);
      if (!exclusion && item.candidates.length) errors.push(`${id2}: a no on an item with candidate fixes needs an exclusion code`);
      labels.set(id2, { verdict, cause_code: "not_rework", exclusion_code: exclusion });
    } else {
      if (cause && cause !== "unclear") errors.push(`${id2}: an unclear takes cause unclear (or blank)`);
      if (exclusion && !exclusions.includes(exclusion)) errors.push(`${id2}: unknown exclusion code "${exclusion}"`);
      labels.set(id2, { verdict: "unclear", cause_code: "unclear", exclusion_code: exclusion });
    }
  }
  return { labels, unlabelled, errors };
}
function cohensKappa(pairs) {
  if (!pairs.length) return null;
  const n = pairs.length;
  const a = /* @__PURE__ */ new Map();
  const b = /* @__PURE__ */ new Map();
  let agree = 0;
  for (const [x, y] of pairs) {
    if (x === y) agree++;
    a.set(x, (a.get(x) ?? 0) + 1);
    b.set(y, (b.get(y) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [k, count] of a) pe += count / n * ((b.get(k) ?? 0) / n);
  if (pe === 1) return null;
  return round43((po - pe) / (1 - pe));
}
function kappaWithCodes(pairs, codes, floor) {
  const per_code = {};
  for (const code of codes) {
    const used = pairs.filter(([x, y]) => x === code || y === code).length;
    const kappa = used ? cohensKappa(pairs.map(([x, y]) => [String(x === code), String(y === code)])) : null;
    per_code[code] = { used, kappa, verdict: !used ? "not_observed" : kappa === null ? "undefined" : kappa >= floor ? "pass" : "below_floor" };
  }
  return { pairs: pairs.length, kappa: cohensKappa(pairs), per_code };
}
function agreementBetween(items, x, y, floor) {
  const both = items.filter((i) => x.has(i.item_id) && y.has(i.item_id));
  const pairs = (pick) => both.flatMap((i) => {
    const a = pick(x.get(i.item_id));
    const b = pick(y.get(i.item_id));
    return a !== null && b !== null ? [[a, b]] : [];
  });
  return {
    corrective: kappaWithCodes(pairs((l) => l.verdict), CALIBRATION_VERDICTS, floor),
    cause_code: kappaWithCodes(pairs((l) => l.cause_code), CAUSE_CODES, floor),
    exclusion_code: kappaWithCodes(pairs((l) => l.verdict === "no" ? l.exclusion_code ?? "(none)" : null), HUMAN_EXCLUSION_CODES, floor)
  };
}
var round43 = (x) => Math.round(x * 1e4) / 1e4;
function definitionVariants(plan) {
  const strongSzz = (c) => c.proxy !== "szz" || (c.blamed_lines ?? 0) >= plan.szz_strong_min_lines;
  const notInternal = (c) => c.proxy !== "revert" || c.revert_reason !== "internal_build";
  return [
    { name: "cr-0.1.0", description: "all admitted proxies (P1\u2013P4)", keep: () => true },
    { name: "high_precision", description: "P1 revert and P2 repair_reference only", keep: (c) => c.proxy === "revert" || c.proxy === "repair_reference" },
    { name: `szz_min_${plan.szz_strong_min_lines}`, description: `SZZ links need \u2265${plan.szz_strong_min_lines} blamed lines`, keep: strongSzz },
    { name: "no_internal_build", description: "reverts for internal-build breakage excluded", keep: notInternal },
    { name: `szz_min_${plan.szz_strong_min_lines}+no_internal_build`, description: "both of the above", keep: (c) => strongSzz(c) && notInternal(c) }
  ];
}
var accepted = (item) => item.candidates.filter((c) => c.status === "accepted" && item.proxies.includes(c.proxy));
var precisionOf = (positive) => (rows) => {
  let num2 = 0;
  let den = 0;
  for (const r of rows) {
    if (!positive(r.item)) continue;
    den += r.weight;
    if (r.label.verdict === "yes") num2 += r.weight;
  }
  return den ? num2 / den : null;
};
var recallOf = (positive) => (rows) => {
  let num2 = 0;
  let den = 0;
  for (const r of rows) {
    if (r.label.verdict !== "yes") continue;
    den += r.weight;
    if (positive(r.item)) num2 += r.weight;
  }
  return den ? num2 / den : null;
};
function prng(seed) {
  let a = parseInt(sha256(seed, "bootstrap").slice(0, 8), 16) >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function bootstrap(rows, estimator, relevant, seed, resamples) {
  const estimate = estimator(rows);
  const n = rows.filter(relevant).length;
  if (estimate === null) return { estimate: null, ci95: null, n };
  const cells = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const key = `${r.item.repo}\0${r.item.stratum}`;
    const cell2 = cells.get(key);
    if (cell2) cell2.push(r);
    else cells.set(key, [r]);
  }
  const groups = [...cells.values()];
  const rand = prng(seed);
  const values = [];
  for (let b = 0; b < resamples; b++) {
    const resampled = [];
    for (const g of groups) for (let i = 0; i < g.length; i++) resampled.push(g[Math.floor(rand() * g.length)]);
    const v = estimator(resampled);
    if (v !== null) values.push(v);
  }
  values.sort((x, y) => x - y);
  const at2 = (q) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))];
  return { estimate: round43(estimate), ci95: values.length ? { low: round43(at2(0.025)), high: round43(at2(0.975)) } : null, n };
}
function scoreCalibration(input) {
  const { plan, items, sheetA, sheetB, seed } = input;
  const resamples = input.resamples ?? 2e3;
  const decided = (id2) => {
    const l = sheetA.get(id2);
    return l && l.verdict !== "unclear" ? l : null;
  };
  const decidedPerCell = /* @__PURE__ */ new Map();
  for (const item of items) if (decided(item.item_id)) decidedPerCell.set(`${item.repo}\0${item.stratum}`, (decidedPerCell.get(`${item.repo}\0${item.stratum}`) ?? 0) + 1);
  const population = new Map(input.cells.map((c) => [`${c.repo}\0${c.stratum}`, c.population]));
  const rows = items.flatMap((item) => {
    const label2 = decided(item.item_id);
    const key = `${item.repo}\0${item.stratum}`;
    return label2 ? [{ item, label: label2, weight: (population.get(key) ?? 0) / decidedPerCell.get(key) }] : [];
  });
  const unrepresented = input.cells.filter((c) => !decidedPerCell.get(`${c.repo}\0${c.stratum}`)).reduce((s, c) => s + c.population, 0);
  const est = (name, estimator, relevant, subset = rows) => bootstrap(subset, estimator, relevant, `${seed}\0${name}`, resamples);
  const strata = CALIBRATION_STRATA.map((stratum) => {
    const inStratum = items.filter((i) => i.stratum === stratum);
    const count = (v) => inStratum.filter((i) => sheetA.get(i.item_id)?.verdict === v).length;
    const yes = count("yes");
    const no = count("no");
    return {
      stratum,
      sampled: inStratum.length,
      yes,
      no,
      unclear: count("unclear"),
      unlabelled: inStratum.filter((i) => !sheetA.has(i.item_id)).length,
      yes_rate: yes + no ? round43(yes / (yes + no)) : null,
      yes_rate_ci95: wilsonInterval(yes, yes + no)
    };
  });
  const proxies = {};
  for (const proxy of ADMITTED_PROXIES) {
    const fired = (item) => item.proxies.includes(proxy);
    proxies[proxy] = {
      precision: est(`p:${proxy}`, precisionOf(fired), (r) => fired(r.item)),
      recall: est(`r:${proxy}`, recallOf(fired), (r) => r.label.verdict === "yes")
    };
  }
  const definitions = definitionVariants(plan).map((d) => {
    const positive = (item) => accepted(item).some(d.keep);
    return {
      name: d.name,
      description: d.description,
      precision: est(`dp:${d.name}`, precisionOf(positive), (r) => positive(r.item)),
      recall: est(`dr:${d.name}`, recallOf(positive), (r) => r.label.verdict === "yes")
    };
  });
  let chosen = null;
  for (const d of definitions) {
    if (d.precision.estimate === null || d.precision.estimate < plan.definition_precision_floor) continue;
    if (!chosen || (d.recall.estimate ?? 0) > (chosen.recall.estimate ?? 0)) chosen = d;
  }
  const repoNames = seededOrder([...new Set(items.map((i) => i.repo))], (repo) => sha256(seed, "pseudonym", repo));
  const anyProxy = (item) => item.proxies.length > 0;
  const repos = repoNames.map((repo, i) => {
    const subset = rows.filter((r) => r.item.repo === repo);
    return {
      repo,
      pseudonym: `R${i + 1}`,
      sampled: items.filter((it) => it.repo === repo).length,
      precision: est(`rp:${repo}`, precisionOf(anyProxy), (r) => anyProxy(r.item), subset),
      recall: est(`rr:${repo}`, recallOf(anyProxy), (r) => r.label.verdict === "yes", subset)
    };
  });
  const rejected = items.filter((i) => i.stratum === "rejected");
  const rejYes = rejected.filter((i) => sheetA.get(i.item_id)?.verdict === "yes").length;
  const rejDecided = rejected.filter((i) => decided(i.item_id)).length;
  const by_code = {};
  for (const item of rejected) {
    const label2 = sheetA.get(item.item_id);
    if (label2?.verdict !== "no") continue;
    const human = label2.exclusion_code ?? "(none)";
    for (const auto of new Set(item.candidates.map((c) => c.exclusion_code ?? "(accepted)"))) {
      by_code[auto] ??= {};
      by_code[auto][human] = (by_code[auto][human] ?? 0) + 1;
    }
  }
  const linkage_error = {};
  for (const proxy of ADMITTED_PROXIES) {
    const nos = items.filter((i) => i.proxies.includes(proxy) && sheetA.get(i.item_id)?.verdict === "no");
    const linkage = nos.filter((i) => sheetA.get(i.item_id)?.exclusion_code === "linkage_error").length;
    linkage_error[proxy] = { no: nos.length, linkage_error: linkage, rate: nos.length ? round43(linkage / nos.length) : null };
  }
  const raw = {};
  const weighted = {};
  let yesWeight = 0;
  for (const item of items) {
    const label2 = sheetA.get(item.item_id);
    if (label2?.verdict === "yes") raw[label2.cause_code] = (raw[label2.cause_code] ?? 0) + 1;
  }
  for (const r of rows) {
    if (r.label.verdict !== "yes") continue;
    weighted[r.label.cause_code] = (weighted[r.label.cause_code] ?? 0) + r.weight;
    yesWeight += r.weight;
  }
  const weighted_share = Object.fromEntries(Object.entries(weighted).map(([k, v]) => [k, round43(v / yesWeight)]));
  const agreement = agreementBetween(items, sheetA, sheetB, plan.kappa_floor);
  return {
    sampler_version: CALIBRATION_SAMPLER_VERSION,
    plan,
    items: items.length,
    labelled: sheetA.size,
    unlabelled: items.length - sheetA.size,
    unclear: [...sheetA.values()].filter((l) => l.verdict === "unclear").length,
    unrepresented_population: unrepresented,
    strata,
    proxies,
    definitions,
    chosen_definition: chosen?.name ?? null,
    repos,
    rejections: { wrongly_rejected: { yes: rejYes, decided: rejDecided, rate: rejDecided ? round43(rejYes / rejDecided) : null, ci95: wilsonInterval(rejYes, rejDecided) }, by_code },
    linkage_error,
    causes: { raw, weighted_share },
    agreement
  };
}
function scoreCalibrationRun(input) {
  const { plan, items, cells, sheets, seed, resamples } = input;
  const model = scoreCalibration({ plan, items, cells, sheetA: sheets.a, sheetB: sheets.b, seed, resamples });
  const audited = items.filter((i) => i.audit);
  const human = scoreCalibration({ plan, items: audited, cells, sheetA: sheets.h, sheetB: sheets.a, seed, resamples });
  const kappa = human.agreement.corrective.kappa;
  const models_stand_in = kappa !== null && kappa >= plan.kappa_floor;
  const primary = models_stand_in ? model : human;
  const gateDefinition = primary.chosen_definition ?? "cr-0.1.0";
  return {
    plan,
    model,
    human,
    human_vs_b: agreementBetween(audited, sheets.h, sheets.b, plan.kappa_floor),
    models_stand_in,
    primary: models_stand_in ? "model" : "human",
    chosen_definition: primary.chosen_definition,
    gate_label_precision: { definition: gateDefinition, precision: human.definitions.find((d) => d.name === gateDefinition).precision }
  };
}
var pct = (x) => x === null || x === void 0 ? "\u2014" : `${(x * 100).toFixed(1)}%`;
var estCell = (e) => e.estimate === null ? "\u2014" : `${pct(e.estimate)} (${pct(e.ci95?.low)}\u2013${pct(e.ci95?.high)})`;
var kappaCell = (k) => k === null ? "\u2014" : k.toFixed(2);
function renderAgreement(lines, title, agreement, floor) {
  lines.push("", `### ${title} (floor \u03BA \u2265 ${floor})`, "");
  for (const [field, k] of Object.entries(agreement)) {
    lines.push(`**${field}:** \u03BA = ${kappaCell(k.kappa)} over ${k.pairs} pairs`, "", "| Code | Used | \u03BA | Verdict |", "| --- | --- | --- | --- |");
    for (const [code, c] of Object.entries(k.per_code)) lines.push(`| ${code} | ${c.used} | ${kappaCell(c.kappa)} | ${c.verdict} |`);
    lines.push("");
  }
}
function renderEstimates(lines, r) {
  lines.push("", `${r.items} items \xB7 ${r.labelled} labelled \xB7 ${r.unclear} unclear \xB7 ${r.repos.length} repos`);
  if (r.unrepresented_population) lines.push("", `${r.unrepresented_population} population PRs sit in cells with no decided item and are not covered by these estimates.`);
  lines.push("", "### Definitions", "", "| Definition | Precision | Recall |", "| --- | --- | --- |");
  for (const d of r.definitions) lines.push(`| ${d.name}: ${d.description} | ${estCell(d.precision)} | ${estCell(d.recall)} |`);
  lines.push("", `Pick under the plan (highest recall with precision \u2265 ${pct(r.plan.definition_precision_floor)}): **${r.chosen_definition ?? "none qualifies"}**`);
  lines.push("", "### Proxies", "", "| Proxy | Precision | n | Recall |", "| --- | --- | --- | --- |");
  for (const [proxy, e] of Object.entries(r.proxies)) lines.push(`| ${proxy} | ${estCell(e.precision)} | ${e.precision.n} | ${estCell(e.recall)} |`);
  lines.push("", "### Strata (unweighted)", "", "| Stratum | Sampled | Yes | No | Unclear | Yes rate (Wilson 95%) |", "| --- | --- | --- | --- | --- | --- |");
  for (const st of r.strata) lines.push(`| ${st.stratum} | ${st.sampled} | ${st.yes} | ${st.no} | ${st.unclear} | ${pct(st.yes_rate)} (${pct(st.yes_rate_ci95?.low)}\u2013${pct(st.yes_rate_ci95?.high)}) |`);
  lines.push("", "### Repos (pseudonymized)", "", "| Repo | Sampled | Precision (any proxy) | Recall |", "| --- | --- | --- | --- |");
  for (const repo of r.repos) lines.push(`| ${repo.pseudonym} | ${repo.sampled} | ${estCell(repo.precision)} | ${estCell(repo.recall)} |`);
  const w = r.rejections.wrongly_rejected;
  lines.push("", "### Rejections", "", `Wrongly rejected (judged corrective): ${w.yes} of ${w.decided} (${pct(w.rate)}, Wilson ${pct(w.ci95?.low)}\u2013${pct(w.ci95?.high)}).`);
  const labelCodes = [...new Set(Object.values(r.rejections.by_code).flatMap((m) => Object.keys(m)))].sort();
  if (labelCodes.length) {
    lines.push("", `| Automatic code \\ labelled code | ${labelCodes.join(" | ")} |`, `| --- |${labelCodes.map(() => " --- |").join("")}`);
    for (const [auto, m] of Object.entries(r.rejections.by_code).sort()) lines.push(`| ${auto} | ${labelCodes.map((h) => m[h] ?? 0).join(" | ")} |`);
  }
  lines.push("", "| Proxy | Labelled no | linkage_error | Rate |", "| --- | --- | --- | --- |");
  for (const [proxy, l] of Object.entries(r.linkage_error)) lines.push(`| ${proxy} | ${l.no} | ${l.linkage_error} | ${pct(l.rate)} |`);
  lines.push("", "### Causes (items labelled yes)", "", "| Cause | Count | Weighted share |", "| --- | --- | --- |");
  for (const code of CAUSE_CODES) if (r.causes.raw[code]) lines.push(`| ${code} | ${r.causes.raw[code]} | ${pct(r.causes.weighted_share[code])} |`);
}
function renderCalibrationMarkdown(run) {
  const { plan, model, human } = run;
  const lines = [];
  const complete = model.unlabelled === 0 && human.unlabelled === 0;
  lines.push(`# HOK-3269 calibration results${complete ? "" : " (INCOMPLETE)"}`, "");
  lines.push(`Horizon ${plan.horizon_days} days \xB7 plan ${plan.plan_version} \xB7 sampler ${CALIBRATION_SAMPLER_VERSION} \xB7 labellers: A ${plan.labellers.a}, B ${plan.labellers.b}, H a person (audit subset)`);
  lines.push("", "Estimates are reweighted by cell (repo \xD7 stratum) population; 95% intervals are a stratified bootstrap. `unclear` labels are left out of rates.");
  const k = human.agreement.corrective.kappa;
  lines.push("", "## Verdict", "");
  lines.push(`- Person vs model A on the verdict: \u03BA = ${kappaCell(k)} over ${human.agreement.corrective.pairs} items (floor ${plan.kappa_floor}). Model labels ${run.models_stand_in ? "**stand in** for the full sample" : "**do not** stand in; estimates come from the human audit alone"}.`);
  lines.push(`- cr-0.2.0 pick (from the ${run.primary} labels): **${run.chosen_definition ?? "none qualifies"}**`);
  lines.push(`- HOK-3028 \xA76 label precision (${run.gate_label_precision.definition} against the person's labels): ${estCell(run.gate_label_precision.precision)}; the diagnostic's bar is 80%.`);
  lines.push("", `## Full sample, model A labels${run.primary === "model" ? " (primary)" : ""}`);
  renderEstimates(lines, model);
  lines.push("", `## Human audit${run.primary === "human" ? " (primary)" : ""}`);
  renderEstimates(lines, human);
  lines.push("", "## Agreement");
  renderAgreement(lines, "Person vs model A (audit subset)", human.agreement, plan.kappa_floor);
  renderAgreement(lines, "Person vs model B (audit subset)", run.human_vs_b, plan.kappa_floor);
  renderAgreement(lines, "Model A vs model B", model.agreement, plan.kappa_floor);
  return `${lines.join("\n").trimEnd()}
`;
}

// src/corpus/calibration-evidence.ts
var EVIDENCE_DIFF_MAX_CHARS = 6e4;
var EVIDENCE_RELATED_MAX = 15;
var EVIDENCE_RELATED_MAX_FILES = 50;
function git(runGit3, args) {
  const result = runGit3(args);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim().split("\n").pop()}`);
  return result.stdout;
}
function cap(diff) {
  return diff.length > EVIDENCE_DIFF_MAX_CHARS ? { diff: `${diff.slice(0, EVIDENCE_DIFF_MAX_CHARS)}
[diff truncated at ${EVIDENCE_DIFF_MAX_CHARS} characters]`, diff_truncated: true } : { diff, diff_truncated: false };
}
function change(runGit3, url, from, to, pr) {
  const files = git(runGit3, ["diff", "--name-only", "--no-renames", from, to]).split("\n").filter(Boolean);
  return {
    url,
    title: pr?.title ?? null,
    body: pr?.body ?? null,
    merged_at: pr?.merged_at ?? null,
    files,
    ...cap(git(runGit3, ["diff", "--no-color", "--no-ext-diff", "--stat", "--patch", from, to]))
  };
}
function buildItemEvidence(item, context, runGit3) {
  const pr = context.prs.get(item.pr_url);
  if (!pr) throw new Error(`${item.item_id}: original not in the enumeration cache`);
  const original = change(runGit3, pr.pr_url, pr.base_sha, pr.merge_sha, pr);
  const fixUrls = [...new Set(item.candidates.map((c) => c.fix_url))].sort();
  const fixes = fixUrls.map((url) => {
    const fixPr = context.prs.get(url);
    if (fixPr) return change(runGit3, url, fixPr.base_sha, fixPr.merge_sha, fixPr);
    const sha = url.match(/\/commit\/([0-9a-f]{40})$/)?.[1];
    if (!sha) throw new Error(`${item.item_id}: fix ${url} is neither an enumerated PR nor a commit`);
    return change(runGit3, url, `${sha}^`, sha, void 0);
  });
  const searched = original.files.slice(0, EVIDENCE_RELATED_MAX_FILES);
  const since = new Date(pr.merged_at);
  const until = new Date(since.getTime() + context.horizonDays * 864e5);
  const related = [];
  if (searched.length) {
    const log = git(runGit3, ["log", "--first-parent", "--format=%H %cI", `--since=${since.toISOString()}`, `--until=${until.toISOString()}`, context.branch, "--", ...searched]);
    const seen = /* @__PURE__ */ new Set([pr.pr_url, ...fixUrls]);
    const later = log.split("\n").filter(Boolean).map((line) => context.bySha.get(line.split(" ")[0])).filter((r) => !!r && r.merged_at > pr.merged_at).sort((a, b) => a.merged_at.localeCompare(b.merged_at));
    for (const r of later) {
      if (seen.has(r.pr_url) || related.length >= EVIDENCE_RELATED_MAX) continue;
      seen.add(r.pr_url);
      related.push({ url: r.pr_url, title: r.title, merged_at: r.merged_at });
    }
  }
  return { item_id: item.item_id, original, fixes, related, related_files_dropped: original.files.length - searched.length };
}

// src/corpus/corrective-szz.ts
var TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|testing)\/|(?:^|\/)test_[^/]*$|[._-](?:test|spec)s?\.[^/]+$|_test\.go$|Tests?\.(?:java|kt|cs|swift)$/;
var GENERATED_PATH = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.(?:mod|sum)|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:__snapshots__|__generated__|generated|openapi-gen|testdata|translations)\/|\.(?:snap|pb\.go|pb\.cc|pb\.h|min\.js|png|jpe?g|gif|svg|ico)$|[._]generated\.[^/]+$/;
var SZZ_MAX_FILES = 20;
var SZZ_MAX_CHANGED_LINES = 500;
var SZZ_SKIP_FILES = 100;
var SZZ_SKIP_CHANGED_LINES = 5e3;
var ISSUE_BATCH = 50;
function prefetchIssueMeta(repo, numbers, graphql, cache) {
  const [owner, name] = repo.split("/");
  const out = /* @__PURE__ */ new Map();
  const unique2 = [...new Set(numbers)].sort((a, b) => a - b);
  for (let i = 0; i < unique2.length; i += ISSUE_BATCH) {
    const batch = unique2.slice(i, i + ISSUE_BATCH);
    const key = `issues1:${batch.join(",")}`;
    let rows = cache?.get(key);
    if (!rows) {
      const fields = batch.map((n) => `i${n}: issueOrPullRequest(number:${n}){ __typename ... on Issue { url issueType{ name } labels(first:50){ nodes{ name } } } }`).join("\n");
      const data = graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name });
      rows = batch.map((n) => {
        const node = data.repository[`i${n}`];
        if (!node || node.__typename !== "Issue" || !node.url) return [n, null];
        return [n, { url: node.url, labels: (node.labels?.nodes ?? []).map((l) => l.name), type: node.issueType?.name ?? null }];
      });
      cache?.set(key, rows);
    }
    for (const [n, meta] of rows) if (meta) out.set(n, meta);
  }
  return out;
}
var BUG_LABEL = /^(?:(?:type|kind|t|c|issue|category)\s*[:/-]\s*)?bug$|^bug[- ]unreleased$|^potential bug$|^(?:(?:type|kind|c|i)\s*[:/-]\s*)?(?:crash|ice)$/i;
var REGRESSION_LABEL = /regress|^incident\b/i;
var NOT_REGRESSION = /\b(?:not|non)[- ]?(?:a[- ])?regression/i;
function regressionLabels(issue) {
  return issue.labels.filter((l) => REGRESSION_LABEL.test(l) && !NOT_REGRESSION.test(l));
}
function isBugIssue(issue) {
  return issue.type === "Bug" || issue.labels.some((l) => BUG_LABEL.test(l)) || regressionLabels(issue).length > 0;
}
function diffHeaderPath(line) {
  const name = line.slice(4).replace(/\t$/, "");
  return name === "/dev/null" ? null : name.replace(/^[ab]\//, "");
}
function buildLandingIndex(runGit3, branch, originals) {
  const owners = /* @__PURE__ */ new Map();
  const own = (sha, pr) => {
    const set = owners.get(sha) ?? /* @__PURE__ */ new Set();
    set.add(pr);
    owners.set(sha, set);
  };
  const rebased = originals.filter((pr) => pr.member_commits > 1);
  let position = null;
  let order = [];
  if (rebased.length) {
    const result = runGit3(["rev-list", "--first-parent", "--reverse", branch]);
    if (result.exitCode !== 0) throw new Error(`szz: cannot list ${branch}: ${result.stderr.trim()}`);
    order = result.stdout.split("\n").filter(Boolean);
    position = new Map(order.map((sha, i) => [sha, i]));
  }
  for (const pr of originals) {
    if (pr.landed_sha && pr.landed_sha !== pr.merge_sha) continue;
    own(pr.merge_sha, pr);
    for (const sha of pr.relanded_merge_shas ?? []) own(sha, pr);
    if (pr.member_commits > 1 && position) {
      const from = position.get(pr.base_sha);
      const to = position.get(pr.merge_sha);
      if (from !== void 0 && to !== void 0) for (let i = from + 1; i < to; i++) own(order[i], pr);
    }
  }
  const out = /* @__PURE__ */ new Map();
  for (const [sha, set] of owners) if (set.size === 1) out.set(sha, [...set][0]);
  return out;
}
function blameFix(runGit3, fix, landing, sinceEpoch) {
  const diff = runGit3(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--ignore-submodules", fix.parentSha, fix.tipSha]);
  if (diff.exitCode !== 0) throw new Error(`szz: cannot diff ${fix.parentSha}..${fix.tipSha}: ${diff.stderr.trim()}`);
  const ranges = /* @__PURE__ */ new Map();
  let oldFile = null;
  let anyFile = null;
  let inHeader = false;
  let changedLines = 0;
  const touched = /* @__PURE__ */ new Set();
  for (const line of diff.stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldFile = anyFile = null;
      inHeader = true;
      continue;
    }
    if (inHeader && (line.startsWith("--- ") || line.startsWith("+++ "))) {
      const path4 = diffHeaderPath(line);
      if (path4 === null) continue;
      if (line.startsWith("--- ")) oldFile = path4;
      anyFile ??= path4;
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (hunk) inHeader = false;
    if (!hunk || !anyFile || TEST_PATH.test(anyFile) || GENERATED_PATH.test(anyFile)) continue;
    const start = Number(hunk[1]);
    const deleted = hunk[2] === void 0 ? 1 : Number(hunk[2]);
    const added = hunk[3] === void 0 ? 1 : Number(hunk[3]);
    touched.add(anyFile);
    changedLines += deleted + added;
    if (oldFile && deleted > 0) {
      const list = ranges.get(oldFile) ?? [];
      list.push([start, start + deleted - 1]);
      ranges.set(oldFile, list);
    }
  }
  const files = touched.size;
  if (files > SZZ_SKIP_FILES || changedLines > SZZ_SKIP_CHANGED_LINES) return { status: "skipped", files, changedLines };
  const blamed = /* @__PURE__ */ new Map();
  for (const [path4, list] of ranges) {
    const result = runGit3([
      "blame",
      "--first-parent",
      "-w",
      "-M",
      "-C",
      "--line-porcelain",
      `--since=@${sinceEpoch}`,
      ...list.flatMap(([a, b]) => ["-L", `${a},${b}`]),
      fix.parentSha,
      "--",
      path4
    ]);
    if (result.exitCode !== 0) throw new Error(`szz: cannot blame ${path4} at ${fix.parentSha}: ${result.stderr.trim()}`);
    let sha = null;
    let boundary = false;
    for (const line of result.stdout.split("\n")) {
      const header = line.match(/^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/);
      if (header) {
        sha = header[1];
        boundary = false;
      } else if (line === "boundary") {
        boundary = true;
      } else if (line.startsWith("	")) {
        const original = sha && !boundary ? landing.get(sha) : void 0;
        if (original && line.slice(1).trim()) blamed.set(original, (blamed.get(original) ?? 0) + 1);
        sha = null;
      }
    }
  }
  return { status: "blamed", tooLarge: files > SZZ_MAX_FILES || changedLines > SZZ_MAX_CHANGED_LINES, files, changedLines, blamed };
}

// src/corpus/corrective.ts
var CORRECTIVE_LABELLER_VERSION = "1.0.0";
var MAX_FIX_LAG_SECONDS = 60 * 86400;
var LINE_SURVIVAL_MAX_LINES = 2e4;
function readRevertCommits(runGit3, branch, from, until) {
  const result = runGit3([
    "log",
    "--first-parent",
    "--reverse",
    "-i",
    "-E",
    "--grep=^revert\\b",
    "--grep=^this reverts commit",
    "--grep=^reverted https://",
    `--since=${from.toISOString()}`,
    `--until=${until.toISOString()}`,
    "--pretty=format:%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e",
    branch
  ]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot read reverts on ${branch}: ${result.stderr.trim()}`);
  const out = [];
  for (const entry of result.stdout.split("")) {
    const [sha = "", parents = "", epochText = "", subject = "", body = ""] = entry.replace(/^\n/, "").split("");
    const epoch = Number.parseInt(epochText, 10);
    if (!/^[0-9a-f]{40}$/.test(sha) || !Number.isFinite(epoch) || epoch * 1e3 < from.getTime() || epoch * 1e3 >= until.getTime()) continue;
    out.push({ sha, parents: parents.trim().split(/\s+/).filter(Boolean), epoch, subject, body });
  }
  return out;
}
function collectFixEvents(fixPrs, revertCommits) {
  const events17 = [];
  const bySha = /* @__PURE__ */ new Map();
  for (const pr of fixPrs) {
    const event17 = {
      pr,
      sha: pr.landed_sha ?? pr.merge_sha,
      parentSha: pr.base_sha,
      epoch: Math.floor(Date.parse(pr.merged_at) / 1e3),
      title: pr.title,
      body: pr.body ?? "",
      labels: pr.labels,
      closingIssues: pr.closing_issues,
      authorLogin: pr.author_login
    };
    events17.push(event17);
    bySha.set(pr.merge_sha, event17);
    if (pr.landed_sha) bySha.set(pr.landed_sha, event17);
  }
  for (const commit of revertCommits) {
    const landed = bySha.get(commit.sha);
    if (landed) {
      landed.body = `${landed.body}
${commit.subject}
${commit.body}`;
      continue;
    }
    events17.push({
      pr: null,
      sha: commit.sha,
      parentSha: commit.parents[0] ?? commit.sha,
      epoch: commit.epoch,
      title: commit.subject,
      body: commit.body,
      labels: [],
      closingIssues: [],
      authorLogin: null
    });
  }
  return events17;
}
var REVERT_TITLE = /^\s*(?:\[[^\]]*\]\s*)?revert\b|\brevert(?:ed|s)?\s+"/i;
var REVERTS_COMMIT = /^\s*this reverts commit ([0-9a-f]{7,40})/gim;
var REVERT_OF_REVERT = /^\s*(?:\[[^\]]*\]\s*)?(?:revert\s+"revert\b|re-?land\b|reapply\b|re-?apply\b)/i;
var FIX_TITLE = /^\s*(?:\[[^\]]*\]\s*)*(?:[\w.-]+(?:\([^)]*\))?!?:\s*)?(?:hot)?fix(?:e[sd])?\b|^\s*(?:\[[^\]]*\]\s*)*bug ?fix\b/i;
var FIX_LABEL = /\b(?:bug|regression|hotfix)\b|^fix$|^type: ?fix$|^kind\/(?:bug|regression)$/i;
var REGRESSION_CONTEXT = /\b(?:(?:regress(?:ion|ed)?|broke(?:n)?|breakage|bug|crash\w*|fail\w*)\s+(?:in|from|by|after|since|introduced|caused)|caused by|introduced (?:in|by))\b[^.\n]{0,25}$/i;
var MAX_ORIGINALS_PER_ISSUE = 3;
var BACKPORT2 = /^\s*(?:\[[^\]]*\]\s*)*\[?(?:backport|cherry[- ]?pick)\b|\(cherry picked from commit [0-9a-f]{7,40}\)/im;
var DEPENDENCY_BOT = /^(?:dependabot(?:-preview)?|renovate(?:-bot)?|greenkeeper|pyup-bot|snyk-bot|depfu)(?:\[bot\])?$/i;
var REVERT_REASON = /\bdue to\b([^\n]*)/i;
var NON_DEFECT_REASON = /merge conflict|conflicts? with|(?:to|in order to)(?: be able to)? (?:cleanly )?revert|dependen(?:cy|t) (?:of|on)|depends on|land ?race|stack (?:is )?in a (?:weird|bad|broken) state|wait(?:ing)? for .{0,40}(?:confirm|approv|review)|before merging|needs? to (?:be )?land(?:ed)? internally|ghfirst|diff train/i;
function evidence2(kind, ref3 = null, count = null) {
  return { kind, ref: ref3, count };
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var OriginalIndex = class {
  byNumber = /* @__PURE__ */ new Map();
  byPrefix = /* @__PURE__ */ new Map();
  constructor(originals) {
    for (const pr of originals) {
      this.byNumber.set(pr.pr_number, pr);
      for (const sha of /* @__PURE__ */ new Set([pr.merge_sha, pr.landed_sha, pr.head_sha, ...pr.relanded_merge_shas ?? []])) {
        if (!sha) continue;
        const bucket = this.byPrefix.get(sha.slice(0, 7)) ?? [];
        bucket.push({ sha, pr });
        this.byPrefix.set(sha.slice(0, 7), bucket);
      }
    }
  }
  /** The one original a SHA or SHA prefix names; null when unknown or ambiguous. */
  bySha(token) {
    const hits = (this.byPrefix.get(token.slice(0, 7)) ?? []).filter((h) => h.sha.startsWith(token));
    const prs = new Set(hits.map((h) => h.pr));
    return prs.size === 1 ? hits[0] : null;
  }
};
function citedNumbers(text, repo) {
  const out = [];
  const pattern = new RegExp(
    `https://github\\.com/${escapeRegExp2(repo)}/(?:pull|issues)/(\\d+)|\\b${escapeRegExp2(repo)}#(\\d+)\\b|(?:^|[^\\w/.#-])#(\\d+)\\b`,
    "gi"
  );
  for (const m of text.matchAll(pattern)) out.push({ n: Number(m[1] ?? m[2] ?? m[3]), index: m.index ?? 0 });
  return out;
}
function shaTokens(text) {
  const out = [];
  for (const m of text.matchAll(/\b([0-9a-f]{7,40})\b/g)) if (/[a-f]/.test(m[1])) out.push({ token: m[1], index: m.index ?? 0 });
  return out;
}
function detectCandidates(input) {
  const index = new OriginalIndex(input.originals);
  const drafts = /* @__PURE__ */ new Map();
  const eventsById = /* @__PURE__ */ new Map();
  const issueCiters = issueCitations(input.repo, input.originals, input.crossReferences);
  const szzStats = { fixes: 0, skipped: 0, too_large: 0 };
  const add = (original, event17, proxy, items, exclusion) => {
    if (original.pr_url === event17.pr?.pr_url) return;
    const lag = event17.epoch - Math.floor(Date.parse(original.merged_at) / 1e3);
    if (lag < 1 || lag > MAX_FIX_LAG_SECONDS) return;
    const id2 = correctiveCandidateId(original, { pr_url: event17.pr?.pr_url ?? null, sha: event17.sha }, proxy);
    eventsById.set(id2, event17);
    const draft = drafts.get(id2);
    if (!draft) {
      drafts.set(id2, { original, event: event17, proxy, evidence: [...items], exclusion });
      return;
    }
    for (const item of items) if (!draft.evidence.some((e) => e.kind === item.kind && e.ref === item.ref)) draft.evidence.push(item);
    draft.exclusion ??= exclusion;
  };
  for (const event17 of input.events) {
    const text = `${event17.title}
${event17.body}`;
    const common = commonExclusion(event17);
    if (isRevert(event17)) {
      const exclusion = common ?? revertExclusion(event17);
      const reason = evidence2("revert_reason", revertReasonClass(event17));
      for (const target of revertTargets(event17, text, input.repo, index)) {
        const ofRevert = REVERT_TITLE.test(target.original.title) ? "revert_of_revert" : null;
        add(target.original, event17, "revert", [target.evidence, reason], ofRevert ?? exclusion);
      }
      continue;
    }
    const signals = [];
    if (FIX_TITLE.test(event17.title)) signals.push(evidence2("fix_title_prefix"));
    for (const label2 of event17.labels) if (FIX_LABEL.test(label2)) signals.push(evidence2("fix_label", label2));
    const cited = /* @__PURE__ */ new Map();
    const cite = (original, item, at2) => {
      if (!REGRESSION_CONTEXT.test(text.slice(Math.max(0, at2 - 60), at2))) return;
      const items = cited.get(original) ?? [];
      items.push(item, evidence2("regression_in_marker"));
      cited.set(original, items);
    };
    for (const { n, index: at2 } of citedNumbers(text, input.repo)) {
      const original = index.byNumber.get(n);
      if (original) cite(original, evidence2("cites_original_pr", original.pr_url), at2);
    }
    for (const { token, index: at2 } of shaTokens(text)) {
      const hit = index.bySha(token);
      if (hit) cite(hit.pr, evidence2("cites_original_sha", hit.sha), at2);
    }
    const fixShaped = signals.length > 0;
    for (const issue of fixShaped ? event17.closingIssues : []) {
      const citers = issueCiters.get(issue) ?? [];
      if (citers.length > MAX_ORIGINALS_PER_ISSUE) continue;
      for (const { original, url } of citers) {
        if (original.pr_url === event17.pr?.pr_url) continue;
        const items = cited.get(original) ?? [];
        items.push(evidence2("closes_issue_citing_original", url));
        cited.set(original, items);
      }
    }
    for (const [original, items] of cited) add(original, event17, "repair_reference", dedupeEvidence([...items, ...signals]), common);
    const closed = event17.closingIssues.flatMap((n) => {
      const issue = input.issues.get(n);
      return issue ? [{ n, issue }] : [];
    });
    for (const { n, issue } of closed) {
      const labels = regressionLabels(issue);
      const citers = issueCiters.get(n) ?? [];
      if (!labels.length || citers.length > MAX_ORIGINALS_PER_ISSUE) continue;
      for (const { original, url } of citers) {
        add(original, event17, "regression_issue", [...labels.map((l) => evidence2("regression_issue_label", l)), evidence2("closes_issue_citing_original", url)], common);
      }
    }
    const bugs = closed.filter(({ issue }) => isBugIssue(issue));
    if (!bugs.length || !input.blame || !event17.pr) continue;
    const szz = input.blame(event17);
    szzStats.fixes++;
    if (szz.status === "skipped") {
      szzStats.skipped++;
      continue;
    }
    if (szz.tooLarge) szzStats.too_large++;
    const bugEvidence = bugs.map(({ issue }) => evidence2("closes_bug_issue", issue.url));
    for (const [original, lines] of szz.blamed) {
      add(original, event17, "szz", [...bugEvidence, evidence2("blamed_lines", original.merge_sha, lines)], common ?? (szz.tooLarge ? "fix_too_large" : null));
    }
  }
  const candidates = [...drafts.entries()].map(([id2, d]) => ({
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    record_type: "candidate",
    candidate_id: id2,
    original: originalRef(d.original),
    fix: fixRef(d.event),
    lag_seconds: d.event.epoch - Math.floor(Date.parse(d.original.merged_at) / 1e3),
    proxy: d.proxy,
    confidence: PROXY_CONFIDENCE[d.proxy],
    evidence: d.evidence,
    status: d.exclusion ? "rejected" : "accepted",
    exclusion_code: d.exclusion,
    envelope: input.envelope
  }));
  candidates.sort((a, b) => a.original.merged_at.localeCompare(b.original.merged_at) || a.candidate_id.localeCompare(b.candidate_id));
  return { candidates, events: eventsById, szz: szzStats };
}
function isRevert(event17) {
  return REVERT_TITLE.test(event17.title) || /^\s*this reverts commit [0-9a-f]{7,40}/im.test(event17.body) || /^\s*reverts [\w.-]+\/[\w.-]+#\d+/im.test(event17.body);
}
function commonExclusion(event17) {
  if (event17.authorLogin && DEPENDENCY_BOT.test(event17.authorLogin)) return "dependency_bot";
  if (BACKPORT2.test(`${event17.title}
${event17.body}`)) return "backport";
  return null;
}
var AUTOREVERT = /autorevert/i;
var INTERNAL_BUILD = /internal(?:ly)?\b|internalfb|fbcode|\bD\d{7,}\b|\bdiff\b.{0,30}\b(?:reverted|backed out)/i;
var PUBLIC_CI = /\b(?:ci|trunk|tests?|builds?|jobs?|lint|failures?|fail(?:s|ed|ing)?|break(?:s|ing)?|broke(?:n)?|red|flak\w*|timeouts?|timed out|segfaults?|crash\w*)\b|actions\/runs|hud\.pytorch/i;
function revertReasonClass(event17) {
  const reason = event17.body.match(REVERT_REASON)?.[1];
  if (!reason) return AUTOREVERT.test(event17.body) ? "autorevert" : "unstated";
  if (NON_DEFECT_REASON.test(reason)) return "collateral";
  if (AUTOREVERT.test(reason)) return "autorevert";
  if (INTERNAL_BUILD.test(reason)) return "internal_build";
  if (PUBLIC_CI.test(reason)) return "public_ci";
  return "other";
}
function revertExclusion(event17) {
  if (REVERT_OF_REVERT.test(event17.title)) return "revert_of_revert";
  const reason = event17.body.match(REVERT_REASON)?.[1];
  if (reason && NON_DEFECT_REASON.test(reason)) return "revert_non_defect";
  return null;
}
function revertTargets(event17, text, repo, index) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (original, item) => {
    if (original && !seen.has(original)) {
      seen.add(original);
      out.push({ original, evidence: item });
    }
  };
  for (const m of text.matchAll(REVERTS_COMMIT)) {
    const hit = index.bySha(m[1]);
    if (hit) push(hit.pr, evidence2("revert_message", hit.sha));
  }
  const prRef = new RegExp(`^\\s*reverts? ${escapeRegExp2(repo)}#(\\d+)|^\\s*reverted https://github\\.com/${escapeRegExp2(repo)}/pull/(\\d+)`, "gim");
  for (const m of text.matchAll(prRef)) {
    const original = index.byNumber.get(Number(m[1] ?? m[2]));
    push(original, evidence2("reverts_pr_reference", original?.pr_url ?? null));
  }
  if (!out.length) {
    for (const { token } of shaTokens(text)) {
      const hit = index.bySha(token);
      if (hit) push(hit.pr, evidence2("revert_message", hit.sha));
    }
  }
  if (!out.length) {
    const quoted = event17.title.match(/^\s*(?:\[[^\]]*\]\s*)?revert\s+"(.*)"/i)?.[1];
    for (const { n } of quoted ? citedNumbers(quoted, repo) : []) {
      const original = index.byNumber.get(n);
      push(original, evidence2("reverts_pr_reference", original?.pr_url ?? null));
    }
  }
  return out;
}
function issueCitations(repo, originals, crossReferences) {
  const out = /* @__PURE__ */ new Map();
  const issuePrefix = `https://github.com/${repo}/issues/`;
  for (const original of originals) {
    const merged = Math.floor(Date.parse(original.merged_at) / 1e3);
    for (const ref3 of crossReferences.get(original.pr_number) ?? []) {
      if (!ref3.url.startsWith(issuePrefix) || ref3.createdAtEpoch <= merged) continue;
      const issue = Number(ref3.url.slice(issuePrefix.length));
      if (!Number.isInteger(issue)) continue;
      const list = out.get(issue) ?? [];
      if (!list.some((e) => e.original === original)) list.push({ original, url: ref3.url });
      out.set(issue, list);
    }
  }
  return out;
}
function dedupeEvidence(items) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((e) => {
    const key = `${e.kind}\0${e.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function originalRef(pr) {
  return { pr_url: pr.pr_url, merge_sha: pr.merge_sha, merged_at: utc(Date.parse(pr.merged_at)) };
}
function fixRef(event17) {
  return { pr_url: event17.pr?.pr_url ?? null, sha: event17.sha, merged_at: utc(event17.epoch * 1e3) };
}
function utc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function buildRepairPair(candidate, original, fix, runGit3) {
  const originalFiles = changedFiles(runGit3, original.base_sha, original.merge_sha);
  const fixChanges = changedFiles(runGit3, fix.parentSha, fix.pr?.merge_sha ?? fix.sha);
  const originalPaths = new Set(originalFiles.map((f) => f.path));
  const fixPaths = new Set(fixChanges.map((f) => f.path));
  const tests = { added: 0, modified: 0, deleted: 0 };
  for (const f of fixChanges) {
    if (!TEST_PATH.test(f.path)) continue;
    if (f.status === "A") tests.added++;
    else if (f.status === "D") tests.deleted++;
    else tests.modified++;
  }
  return {
    schema_version: candidate.schema_version,
    record_type: "repair_pair",
    candidate_id: candidate.candidate_id,
    original: candidate.original,
    fix: candidate.fix,
    lag_seconds: candidate.lag_seconds,
    proxy: candidate.proxy,
    confidence: candidate.confidence,
    files: {
      original: [...originalPaths].sort(),
      fix: [...fixPaths].sort(),
      fix_only: [...fixPaths].filter((p) => !originalPaths.has(p)).sort(),
      original_only: [...originalPaths].filter((p) => !fixPaths.has(p)).sort(),
      fix_preexisting: existingPaths(runGit3, original.merge_sha, [...fixPaths]).sort()
    },
    line_survival: lineSurvival(runGit3, original, fix.parentSha),
    fix_tests: tests,
    // Review metadata is not in the corpus cache; null means not collected.
    original_review: { reviewed: null, review_count: null, reviewer_count: null, first_review_latency_seconds: null },
    graph_distance: null,
    envelope: candidate.envelope
  };
}
function changedFiles(runGit3, from, to) {
  const result = runGit3(["diff", "--name-status", "--no-renames", "-z", from, to]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot diff ${from}..${to}: ${result.stderr.trim()}`);
  const parts = result.stdout.split("\0").filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i].charAt(0), path: parts[i + 1] });
  return out;
}
function existingPaths(runGit3, sha, paths) {
  const out = [];
  for (let i = 0; i < paths.length; i += 200) {
    const result = runGit3(["ls-tree", "-r", "--name-only", "-z", sha, "--", ...paths.slice(i, i + 200)]);
    if (result.exitCode !== 0) throw new Error(`corrective: cannot list ${sha}: ${result.stderr.trim()}`);
    out.push(...result.stdout.split("\0").filter(Boolean));
  }
  return out;
}
function lineSurvival(runGit3, original, fixParent) {
  if (addedLineCount(runGit3, original.base_sha, original.merge_sha) > LINE_SURVIVAL_MAX_LINES) return null;
  const added = diffLines(runGit3, original.base_sha, original.merge_sha, "+");
  let total = 0;
  for (const lines of added.values()) for (const count of lines.values()) total += count;
  if (total === 0 || total > LINE_SURVIVAL_MAX_LINES) return null;
  const removed = diffLines(runGit3, original.merge_sha, fixParent, "-", [...added.keys()]);
  let lost = 0;
  for (const [path4, lines] of removed) {
    const mine = added.get(path4);
    if (!mine) continue;
    for (const [line, count] of lines) lost += Math.min(count, mine.get(line) ?? 0);
  }
  return Math.round((1 - lost / total) * 1e4) / 1e4;
}
function addedLineCount(runGit3, from, to) {
  const result = runGit3(["diff", "--numstat", "--no-renames", from, to]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot diff ${from}..${to}: ${result.stderr.trim()}`);
  let total = 0;
  for (const line of result.stdout.split("\n")) {
    const added = Number(line.split("	")[0]);
    if (Number.isFinite(added)) total += added;
  }
  return total;
}
function diffLines(runGit3, from, to, side, paths) {
  const out = /* @__PURE__ */ new Map();
  if (paths && paths.length === 0) return out;
  const result = runGit3(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", from, to, ...paths ? ["--", ...paths] : []]);
  if (result.exitCode !== 0) throw new Error(`corrective: cannot diff ${from}..${to}: ${result.stderr.trim()}`);
  let file = null;
  let inHeader = false;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      inHeader = true;
      continue;
    }
    if (line.startsWith("@@")) {
      inHeader = false;
      continue;
    }
    if (inHeader) {
      if (line.startsWith(side === "+" ? "+++ " : "--- ")) {
        const path4 = diffHeaderPath(line);
        if (path4 === null) file = null;
        else {
          file = out.get(path4) ?? /* @__PURE__ */ new Map();
          out.set(path4, file);
        }
      }
      continue;
    }
    if (!file || !line.startsWith(side)) continue;
    const content = line.slice(1).trim();
    if (content) file.set(content, (file.get(content) ?? 0) + 1);
  }
  return out;
}
function deriveCorrectiveRows(s2Rows, pairs, envelope) {
  const byOriginal = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const list = byOriginal.get(pair.original.pr_url) ?? [];
    list.push(pair);
    byOriginal.set(pair.original.pr_url, list);
  }
  const out = [];
  for (const row of s2Rows) {
    out.push(
      deriveCorrectiveLabel({
        prUrl: row.prUrl,
        horizon_days: row.horizon_days,
        base_label_hash: canonicalHash(row),
        base_label_present: row.outcome.report_outcome !== null,
        repair_pairs: byOriginal.get(row.prUrl) ?? [],
        envelope
      })
    );
  }
  return out;
}
function correctiveEnvelope(branch, asOf, now) {
  return {
    schema_version: ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
    definition_version: CORRECTIVE_REWORK_DEFINITION_VERSION,
    labeller_version: CORRECTIVE_LABELLER_VERSION,
    integration_branch: branch,
    as_of: utc(asOf.getTime()),
    computed_at: utc(now.getTime())
  };
}
function correctiveCorpusRepo(input, deps) {
  const envelope = correctiveEnvelope(input.branch, input.asOf, deps.now());
  const reverts = readRevertCommits(deps.runGit, input.branch, input.from, input.asOf);
  const events17 = collectFixEvents([...input.originals, ...input.laterPrs], reverts);
  deps.onDiagnostic?.(`info: ${input.repo}: ${events17.length} fix events (${reverts.length} revert commits)`);
  const landing = input.szz ? buildLandingIndex(deps.runGit, input.branch, input.originals) : null;
  let blameFailures = 0;
  let blamed = 0;
  const blame = landing ? (event17) => {
    if (++blamed % 500 === 0) deps.onDiagnostic?.(`info: ${input.repo}: blamed ${blamed} bug fixes`);
    try {
      return blameFix(deps.runGit, { parentSha: event17.parentSha, tipSha: event17.pr?.merge_sha ?? event17.sha }, landing, event17.epoch - MAX_FIX_LAG_SECONDS - 86400);
    } catch (error) {
      blameFailures++;
      deps.onDiagnostic?.(`error: ${input.repo}: cannot blame ${event17.pr?.pr_url ?? event17.sha}: ${String(error).slice(0, 200)}`);
      return { status: "skipped", files: 0, changedLines: 0 };
    }
  } : void 0;
  const { candidates, events: eventsById, szz } = detectCandidates({
    repo: input.repo,
    originals: input.originals,
    events: events17,
    crossReferences: input.crossReferences,
    issues: input.issues,
    ...blame ? { blame } : {},
    envelope
  });
  const byUrl = new Map(input.originals.map((pr) => [pr.pr_url, pr]));
  const repairPairs = [];
  const failedPairs = [];
  const accepted2 = candidates.filter((c) => c.status === "accepted");
  for (const [i, candidate] of accepted2.entries()) {
    if (i > 0 && i % 500 === 0) deps.onDiagnostic?.(`info: ${input.repo}: measured ${i}/${accepted2.length} repair pairs`);
    try {
      repairPairs.push(buildRepairPair(candidate, byUrl.get(candidate.original.pr_url), eventsById.get(candidate.candidate_id), deps.runGit));
    } catch (error) {
      failedPairs.push(candidate.candidate_id);
      deps.onDiagnostic?.(`error: ${input.repo}: cannot measure pair ${candidate.candidate_id}: ${String(error).slice(0, 200)}`);
    }
  }
  return {
    candidates,
    repairPairs,
    corrective: deriveCorrectiveRows(input.s2Rows, repairPairs, envelope),
    failedPairs,
    szz: { ...szz, skipped: szz.skipped - blameFailures, failed: blameFailures }
  };
}
function summarizeCorrective(result, originals) {
  const count = (items, key) => items.reduce((acc, item) => (acc[key(item)] = (acc[key(item)] ?? 0) + 1, acc), {});
  const byHorizon = {};
  for (const row of result.corrective) {
    const h = byHorizon[row.horizon_days] ??= { rows: 0, true: 0, false: 0, null: 0, true_share: null };
    h.rows++;
    h[String(row.corrective)]++;
  }
  for (const h of Object.values(byHorizon)) h.true_share = h.true + h.false ? Math.round(h.true / (h.true + h.false) * 1e4) / 1e4 : null;
  const flagged = new Set(result.repairPairs.map((p) => p.original.pr_url));
  return {
    candidates: result.candidates.length,
    candidates_by_proxy_status: count(result.candidates, (c) => `${c.proxy}:${c.status}`),
    exclusions: count(result.candidates.filter((c) => c.exclusion_code), (c) => c.exclusion_code),
    revert_reasons: count(
      result.candidates.filter((c) => c.proxy === "revert" && c.status === "accepted"),
      (c) => c.evidence.find((e) => e.kind === "revert_reason")?.ref ?? "unstated"
    ),
    szz: result.szz,
    repair_pairs: result.repairPairs.length,
    direct_push_fixes: result.repairPairs.filter((p) => p.fix.pr_url === null).length,
    failed_pairs: result.failedPairs.length,
    originals,
    originals_with_fix_60d: flagged.size,
    originals_with_fix_60d_share: originals ? Math.round(flagged.size / originals * 1e4) / 1e4 : null,
    corrective_by_horizon: byHorizon
  };
}

// src/corpus/pr-refs.ts
var SQUASH = /\(#(\d+)\)\s*$/;
var MERGE_PR = /^merge pull request #(\d+)\b/i;
var BORS_AUTO = /^(?:auto merge|rollup merge) of #(\d+)\b/i;
var BORS_BATCH = /^merge((?:\s+#\d+)+)\s*$/i;
function extractCorpusPrNumbers(subject, body, repo) {
  const found = [];
  const add = (value) => {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0 && !found.includes(n)) found.push(n);
  };
  const trimmed = subject.trim();
  const batch = trimmed.match(BORS_BATCH);
  if (batch) {
    for (const match of batch[1].matchAll(/#(\d+)/g)) add(match[1]);
  } else {
    add((trimmed.match(MERGE_PR) ?? trimmed.match(BORS_AUTO) ?? trimmed.match(SQUASH))?.[1]);
  }
  const trailer = new RegExp(`^Pull Request resolved:\\s*https://github\\.com/${escapeRegExp3(repo)}/pull/(\\d+)\\s*$`, "im");
  add(body.match(trailer)?.[1]);
  return found;
}
function escapeRegExp3(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/corpus/enumerate.ts
var UNMAPPED_AUDIT_SAMPLE = 50;
var PR_FIELDS = `number url mergedAt baseRefName headRefOid title body
  mergeCommit{ oid } author{ login __typename }
  labels(first:30){ nodes{ name } }
  closingIssuesReferences(first:10){ nodes{ number } }
  commits{ totalCount }`;
var SEARCH_QUERY = `query($q:String!,$after:String){
  search(type:ISSUE, query:$q, first:50, after:$after){
    issueCount pageInfo{ endCursor hasNextPage }
    nodes{ ... on PullRequest { ${PR_FIELDS} } }
  }
}`;
var COUNT_QUERY = `query($q:String!){ search(type:ISSUE, query:$q, first:1){ issueCount } }`;
var SEARCH_CAP = 1e3;
var DAY_MS = 864e5;
var EMPTY_TREE_SHA2 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function enumerateCorpusRepo(target, deps) {
  const commits = readFirstParent(target, deps.runGit);
  const rollups = readRollupMembers(target, deps.runGit, commits);
  const apiPrs = fetchMergedPrs(target, deps);
  const byNumber = new Map(apiPrs.map((pr) => [pr.number, pr]));
  const byMergeSha = /* @__PURE__ */ new Map();
  for (const pr of apiPrs) {
    if (!pr.mergeCommit) continue;
    const list = byMergeSha.get(pr.mergeCommit.oid) ?? [];
    list.push(pr);
    byMergeSha.set(pr.mergeCommit.oid, list);
  }
  const named = [...commits.flatMap((c) => c.prNumbers), ...[...rollups.values()].flat().map((m) => m.prNumber)];
  const missing = [...new Set(named)].filter((n) => !byNumber.has(n));
  for (const pr of fetchPrsByNumber(target.repo, missing, deps)) byNumber.set(pr.number, pr);
  const records = [];
  const mapped = /* @__PURE__ */ new Set();
  const used = /* @__PURE__ */ new Set();
  let batchedCommits = 0;
  let relandedCommits = 0;
  let rollupPrs = 0;
  let rollupUnresolved = 0;
  const recordByNumber = /* @__PURE__ */ new Map();
  const toRecord = (pr, landing, fields) => ({
    repo: target.repo,
    pr_number: pr.number,
    pr_url: pr.url,
    merged_at: pr.mergedAt ?? new Date(landing.epoch * 1e3).toISOString(),
    base_ref: pr.baseRefName,
    head_sha: pr.headRefOid,
    ...fields,
    landed_sha: landing.sha,
    relanded_merge_shas: [],
    author_login: pr.author?.login ?? null,
    author_type: pr.author?.__typename ?? null,
    labels: pr.labels.nodes.map((label2) => label2.name),
    closing_issues: pr.closingIssuesReferences.nodes.map((issue) => issue.number),
    title: pr.title,
    body: pr.body ?? ""
  });
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const viaSha = byMergeSha.get(commit.sha) ?? [];
    const viaRef = commit.prNumbers.map((n) => byNumber.get(n)).filter((pr) => !!pr);
    const candidates = [...new Map([...viaSha, ...viaRef].map((pr) => [pr.number, pr])).values()];
    const rollupMembers = rollups.get(commit.sha);
    if (rollupMembers) {
      mapped.add(commit.sha);
      for (const pr of candidates) used.add(pr.number);
      rollupPrs++;
      for (const member of rollupMembers) {
        const pr = byNumber.get(member.prNumber);
        if (!pr || used.has(pr.number)) {
          rollupUnresolved++;
          continue;
        }
        used.add(pr.number);
        const record = toRecord(pr, commit, { merge_sha: member.sha, base_sha: member.parentSha, member_commits: 1, landed_by: "rollup", batched: false });
        records.push(record);
        recordByNumber.set(pr.number, record);
      }
      continue;
    }
    const prs = candidates.filter((pr) => !used.has(pr.number));
    if (prs.length === 0) {
      const relanded = candidates.filter((pr) => recordByNumber.has(pr.number));
      if (relanded.length) {
        mapped.add(commit.sha);
        relandedCommits++;
        for (const pr of relanded) recordByNumber.get(pr.number).relanded_merge_shas.push(commit.sha);
      }
      continue;
    }
    mapped.add(commit.sha);
    const batched = prs.length > 1;
    if (batched) batchedCommits++;
    for (const pr of prs) {
      used.add(pr.number);
      let first = i;
      const isMergeCommit = commit.parents.length > 1;
      if (!batched && !isMergeCommit && viaSha.includes(pr) && pr.commits.totalCount > 1) {
        for (let k = 1; k < pr.commits.totalCount && first - 1 >= 0 && !mapped.has(commits[first - 1].sha) && commits[first - 1].prNumbers.length === 0; k++) {
          first--;
          mapped.add(commits[first].sha);
        }
      }
      const members = i - first + 1;
      const record = toRecord(pr, commit, {
        merge_sha: commit.sha,
        base_sha: commits[first].parents[0] ?? EMPTY_TREE_SHA2,
        member_commits: members,
        landed_by: !viaSha.includes(pr) ? "number_ref" : isMergeCommit ? "merge_commit" : members > 1 ? "rebase" : "squash",
        batched
      });
      records.push(record);
      recordByNumber.set(pr.number, record);
    }
  }
  const defaultNames = new Set(target.defaultBranchNames);
  const unmapped = commits.filter((c) => !mapped.has(c.sha));
  const audit = auditUnmapped(unmapped.filter((c) => !c.isRevert), deps.pullsForCommit, unmapped.length);
  const stats = {
    repo: target.repo,
    branch: target.branch,
    window: { from: target.from.toISOString(), until: target.until.toISOString() },
    first_parent_commits: commits.length,
    mapped_commits: mapped.size,
    mapped_share: commits.length ? Number((mapped.size / commits.length).toFixed(4)) : null,
    unmapped_audited: audit.checked,
    unmapped_audited_with_pr: audit.withPr,
    pr_recall_est: audit.estimate(mapped.size, commits.length).recall,
    direct_push_share_est: audit.estimate(mapped.size, commits.length).directPush,
    prs: records.length,
    batched_commits: batchedCommits,
    relanded_commits: relandedCommits,
    unmapped_reverts: unmapped.filter((c) => c.isRevert).length,
    rebase_prs: records.filter((r) => r.landed_by === "rebase").length,
    number_ref_prs: records.filter((r) => r.landed_by === "number_ref").length,
    rollup_prs: rollupPrs,
    rollup_member_prs: records.filter((r) => r.landed_by === "rollup").length,
    rollup_members_unresolved: rollupUnresolved,
    api_prs_not_on_branch: apiPrs.filter((pr) => !used.has(pr.number)).length,
    api_prs_not_on_branch_default_base: apiPrs.filter((pr) => !used.has(pr.number) && pr.baseRefName !== null && defaultNames.has(pr.baseRefName)).length,
    unmapped_sample: unmapped.slice(0, 20).map((c) => c.sha)
  };
  records.sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return { records, stats };
}
function auditUnmapped(unmapped, pullsForCommit, unmappedTotal) {
  const step = Math.max(1, unmapped.length / UNMAPPED_AUDIT_SAMPLE);
  const sample = pullsForCommit ? Array.from({ length: Math.min(UNMAPPED_AUDIT_SAMPLE, unmapped.length) }, (_, i) => unmapped[Math.floor(i * step)]) : [];
  const withPr = sample.filter((c) => pullsForCommit(c.sha).length > 0).length;
  const round = (value) => Number(value.toFixed(4));
  return {
    checked: sample.length,
    withPr,
    estimate(mappedCount, total) {
      if (total === 0) return { recall: null, directPush: null };
      if (unmapped.length === 0) return { recall: 1, directPush: round(unmappedTotal / total) };
      if (sample.length === 0) return { recall: null, directPush: null };
      const missed = unmapped.length * withPr / sample.length;
      return { recall: round(mappedCount / (mappedCount + missed)), directPush: round((unmappedTotal - missed) / total) };
    }
  };
}
function readFirstParent(target, runGit3) {
  const commits = [];
  const seen = /* @__PURE__ */ new Set();
  const start = target.from.getTime();
  const end = target.until.getTime();
  for (let lo = start; lo < end; lo += 30 * DAY_MS) {
    const hi = Math.min(lo + 30 * DAY_MS, end);
    const result = runGit3([
      "log",
      "--first-parent",
      "--reverse",
      `--since=${new Date(lo).toISOString()}`,
      `--until=${new Date(hi).toISOString()}`,
      "--pretty=format:%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1e",
      target.branch
    ]);
    if (result.exitCode !== 0) throw new Error(`corpus: cannot read first-parent history of ${target.branch}: ${result.stderr.trim()}`);
    for (const entry of result.stdout.split("")) {
      const [sha = "", parents = "", epochText = "", subject = "", body = ""] = entry.replace(/^\n/, "").split("");
      if (!/^[0-9a-f]{40}$/.test(sha) || seen.has(sha)) continue;
      const epoch = Number.parseInt(epochText, 10);
      if (!Number.isFinite(epoch) || epoch * 1e3 < lo || epoch * 1e3 >= hi) continue;
      seen.add(sha);
      commits.push({ sha, parents: parents.trim().split(/\s+/).filter(Boolean), epoch, prNumbers: extractCorpusPrNumbers(subject, body, target.repo), isRevert: /^revert\b/i.test(subject.trim()) });
    }
  }
  return commits;
}
var ROLLUP_MERGE = /^Rollup merge of #(\d+)\b/;
function readRollupMembers(target, runGit3, commits) {
  const out = /* @__PURE__ */ new Map();
  if (!commits.some((c) => c.parents.length > 1)) return out;
  const result = runGit3([
    "log",
    "--grep=^Rollup merge of #",
    `--since=${new Date(target.from.getTime() - 30 * DAY_MS).toISOString()}`,
    `--until=${target.until.toISOString()}`,
    "--pretty=format:%H%x1f%P%x1f%s%x1e",
    target.branch
  ]);
  if (result.exitCode !== 0) throw new Error(`corpus: cannot read rollup merges on ${target.branch}: ${result.stderr.trim()}`);
  const bySha = /* @__PURE__ */ new Map();
  for (const entry of result.stdout.split("")) {
    const [sha = "", parents = "", subject = ""] = entry.replace(/^\n/, "").split("");
    const prNumber = Number(subject.trim().match(ROLLUP_MERGE)?.[1]);
    const parentSha = parents.trim().split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/.test(sha) && parentSha && Number.isInteger(prNumber)) bySha.set(sha, { sha, parentSha, prNumber });
  }
  for (const commit of commits) {
    const chain = [];
    for (let member = bySha.get(commit.parents[1] ?? ""); member; member = bySha.get(member.parentSha)) chain.push(member);
    if (chain.length) out.set(commit.sha, chain.reverse());
  }
  return out;
}
function fetchMergedPrs(target, deps) {
  const out = /* @__PURE__ */ new Map();
  const pending = [[target.from.getTime(), target.until.getTime() - DAY_MS]];
  while (pending.length) {
    const [lo, hi] = pending.shift();
    const range = `${isoDay(lo)}..${isoDay(hi)}`;
    const q = `repo:${target.repo} is:pr is:merged merged:${range}`;
    const cacheKey = `merged:${range}`;
    const cached = deps.cache?.get(cacheKey);
    if (cached) {
      for (const pr of cached) out.set(pr.number, pr);
      continue;
    }
    const count = deps.graphql(COUNT_QUERY, { q }).search.issueCount;
    if (count > SEARCH_CAP) {
      if (hi <= lo) throw new Error(`corpus: more than ${SEARCH_CAP} PRs merged on ${isoDay(lo)}; cannot slice further`);
      const mid = lo + Math.floor((hi - lo) / DAY_MS / 2) * DAY_MS;
      pending.unshift([lo, mid], [mid + DAY_MS, hi]);
      continue;
    }
    const slice = [];
    for (let after = null; ; ) {
      const page = deps.graphql(SEARCH_QUERY, { q, after }).search;
      slice.push(...page.nodes.filter((node) => typeof node.number === "number"));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    deps.cache?.set(cacheKey, slice);
    deps.onDiagnostic?.(`info: ${target.repo} ${range}: ${slice.length} merged PRs`);
    for (const pr of slice) out.set(pr.number, pr);
  }
  return [...out.values()];
}
function fetchPrsByNumber(repo, numbers, deps) {
  const [owner, name] = repo.split("/");
  const out = [];
  for (let i = 0; i < numbers.length; i += 50) {
    const batch = numbers.slice(i, i + 50);
    const cacheKey = `by-number:${batch.join(",")}`;
    let prs = deps.cache?.get(cacheKey);
    if (!prs) {
      const fields = batch.map((n) => `pr${n}: pullRequest(number:${n}){ ${PR_FIELDS} }`).join("\n");
      const data = deps.graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name });
      prs = Object.values(data.repository).filter((pr) => pr !== null);
      deps.cache?.set(cacheKey, prs);
    }
    out.push(...prs);
  }
  return out;
}

// src/corpus/label.ts
var CROSS_REFERENCE_BATCH = 50;
function toMergedPrRef(record) {
  return {
    prNumber: record.pr_number,
    prUrl: record.pr_url,
    mergeSha: record.merge_sha,
    parentSha: record.base_sha,
    // Absent in records enumerated before rollup expansion; those all landed on first-parent.
    ...record.landed_sha && record.landed_sha !== record.merge_sha ? { landedSha: record.landed_sha } : {},
    headSha: record.head_sha ?? record.merge_sha,
    mergedAtEpoch: Math.floor(Date.parse(record.merged_at) / 1e3),
    // Redispatch detection reads tracker keys from the subject; the PR title is the subject's source.
    subject: record.title
  };
}
function prefetchCrossReferences(repo, prNumbers, graphql, cache) {
  const [owner, name] = repo.split("/");
  const out = /* @__PURE__ */ new Map();
  for (let i = 0; i < prNumbers.length; i += CROSS_REFERENCE_BATCH) {
    const batch = prNumbers.slice(i, i + CROSS_REFERENCE_BATCH);
    const key = `xref2:${batch.join(",")}`;
    let rows = cache?.get(key);
    if (!rows) {
      const fields = batch.map((n) => `pr${n}: pullRequest(number:${n}){ timelineItems(itemTypes:[CROSS_REFERENCED_EVENT], first:100){ nodes{ ... on CrossReferencedEvent { createdAt source{ ... on Issue { url author{ login __typename } } ... on PullRequest { url baseRefName author{ login __typename } } } } } } }`).join("\n");
      const data = graphql(`query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${fields} } }`, { owner, name });
      rows = batch.map((n) => {
        const nodes = data.repository[`pr${n}`]?.timelineItems.nodes ?? [];
        const refs = nodes.filter((node) => node.createdAt).map((node) => ({
          createdAtEpoch: Math.floor(Date.parse(node.createdAt) / 1e3),
          url: node.source?.url ?? "",
          sourceAuthorLogin: node.source?.author?.login ?? null,
          sourceAuthorType: node.source?.author?.__typename ?? null,
          sourceBaseRef: node.source?.baseRefName ?? null
        })).filter((ref3) => Number.isFinite(ref3.createdAtEpoch));
        return [n, refs];
      });
      cache?.set(key, rows);
    }
    for (const [n, refs] of rows) out.set(n, refs);
  }
  return out;
}
function prefetchedGithubClient(crossReferences) {
  return {
    getPrMetadata: () => null,
    listCrossReferences: (prNumber) => crossReferences.get(prNumber) ?? []
  };
}
function labelCorpusRepo(input, deps) {
  const target = { owner: input.owner, repo: input.repo, integrationBranch: input.branch, integrationMode: "direct", repoDir: input.repoDir };
  const labellerDeps = { runGit: deps.runGit, github: deps.github, now: deps.now, onDiagnostic: deps.onDiagnostic };
  const all = input.records.map(toMergedPrRef);
  const horizonTerminalIndex = buildHorizonTerminalIndex(labellerDeps, input.branch) ?? void 0;
  const rows = [];
  const failed = [];
  for (const [i, pr] of all.entries()) {
    if (i > 0 && i % 500 === 0) deps.onDiagnostic?.(`info: ${input.owner}/${input.repo}: labelled ${i}/${all.length} PRs`);
    try {
      rows.push(...labelMergedPr(target, labellerDeps, pr, { horizons: input.horizons, allMergedPrs: all, horizonTerminalIndex }));
    } catch (error) {
      failed.push(pr.prNumber);
      deps.onDiagnostic?.(`error: failed to label ${pr.prUrl}: ${String(error).slice(0, 200)}`);
    }
  }
  return { rows, failed };
}

// src/corpus/manifest.ts
var RUNNABLE_STATUSES = ["kept", "pending_exception", "unmeasured"];
var REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var DAY = /^\d{4}-\d{2}-\d{2}$/;
function parseCohortManifest(input) {
  const fail2 = (message) => {
    throw new Error(`cohort manifest: ${message}`);
  };
  if (!input || typeof input !== "object") fail2("must be an object");
  const m = input;
  if (typeof m.manifest_version !== "string") fail2("manifest_version is required");
  if (!m.window || !DAY.test(m.window.merged_from ?? "") || !DAY.test(m.window.merged_until ?? "")) fail2("window.merged_from/merged_until must be YYYY-MM-DD");
  if (Date.parse(m.window.merged_from) >= Date.parse(m.window.merged_until)) fail2("window must be non-empty");
  for (const key of ["repos", "alternates"]) {
    if (!Array.isArray(m[key])) fail2(`${key} must be an array`);
    for (const entry of m[key]) {
      if (!REPO.test(entry?.repo ?? "")) fail2(`invalid repo ${JSON.stringify(entry?.repo)}`);
      if (typeof entry.status !== "string") fail2(`${entry.repo}: status is required`);
    }
  }
  return m;
}
function runnableRepos(manifest, only) {
  const all = [...manifest.repos, ...manifest.alternates];
  if (only) {
    const entry = all.find((r) => r.repo === only);
    if (!entry) throw new Error(`cohort manifest: ${only} is not declared; add it to the manifest first`);
    return [entry];
  }
  return all.filter((r) => RUNNABLE_STATUSES.includes(r.status));
}

// src/corpus/report.ts
var CORPUS_REPORT_VERSION = "1.0.0";
var DEGENERATE_RATE = 5e-3;
var CHURN_RATE = 0.25;
var FLAG_HORIZON = 30;
var SZZ_SENSITIVITY_MIN_LINES = 3;
var HIGH_PRECISION = ["revert", "repair_reference"];
var ratio2 = (k, n) => n ? round44(k / n) : null;
function round44(value) {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}
var bump = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};
var sortKeys = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
function blamedLines(candidate) {
  return candidate.evidence.filter((e) => e.kind === "blamed_lines").reduce((sum, e) => sum + (e.count ?? 0), 0);
}
function summarizeCorpusRepo(input) {
  const horizons = /* @__PURE__ */ new Map();
  const at2 = (h) => {
    let s = horizons.get(h);
    if (!s) {
      s = {
        horizon_days: h,
        prs: 0,
        s2_outcomes: {},
        corrective: { true: 0, false: 0, null: 0 },
        corrective_rate: null,
        corrective_rate_ci95: null,
        proxy_contribution: Object.fromEntries(ADMITTED_PROXIES.map((p) => [p, { rows: 0, sole: 0 }])),
        corrective_rate_high_precision: null,
        corrective_rate_szz_min_lines: null,
        candidates: { total: 0, rejected: 0, rejection_rate: null },
        rejections_by_reason: {},
        rejections_by_proxy: {},
        linkage_error: { rejected: 0, rate: null }
      };
      horizons.set(h, s);
    }
    return s;
  };
  for (const h of HORIZONS) at2(h);
  for (const row of input.s2Rows) {
    const s = at2(row.horizon_days);
    s.prs++;
    bump(s.s2_outcomes, row.outcome.report_outcome ?? "missing");
  }
  const accepted2 = /* @__PURE__ */ new Map();
  const revertReasons = {};
  for (const c of input.candidates) {
    if (c.status === "accepted") accepted2.set(c.candidate_id, c);
    if (c.status === "accepted" && c.proxy === "revert") {
      const reason = c.evidence.find((e) => e.kind === "revert_reason")?.ref;
      if (reason) bump(revertReasons, reason);
    }
    for (const s of horizons.values()) {
      if (c.lag_seconds > s.horizon_days * 86400) continue;
      const rejected = c.status === "rejected";
      s.candidates.total++;
      const byProxy = s.rejections_by_proxy[c.proxy] ??= { total: 0, rejected: 0, rejection_rate: null };
      byProxy.total++;
      if (!rejected) continue;
      s.candidates.rejected++;
      byProxy.rejected++;
      bump(s.rejections_by_reason, c.exclusion_code ?? "unknown");
      if (c.exclusion_code === "linkage_error") s.linkage_error.rejected++;
    }
  }
  const highPrecision = /* @__PURE__ */ new Map();
  const szzMin = /* @__PURE__ */ new Map();
  for (const row of input.correctiveRows) {
    const s = at2(row.horizon_days);
    if (row.corrective === null) {
      s.corrective.null++;
      continue;
    }
    if (!row.corrective) {
      s.corrective.false++;
      continue;
    }
    s.corrective.true++;
    const proxies = row.reason_codes.filter((c) => ADMITTED_PROXIES.includes(c));
    for (const p of proxies) {
      const cell2 = s.proxy_contribution[p];
      cell2.rows++;
      if (proxies.length === 1) cell2.sole++;
    }
    if (proxies.some((p) => HIGH_PRECISION.includes(p))) highPrecision.set(row.horizon_days, (highPrecision.get(row.horizon_days) ?? 0) + 1);
    const pairs = row.repair_pair_ids.map((id2) => accepted2.get(id2)).filter((c) => c !== void 0);
    const kept = pairs.length === 0 || pairs.some((c) => c.proxy !== "szz" || blamedLines(c) >= SZZ_SENSITIVITY_MIN_LINES);
    if (kept) szzMin.set(row.horizon_days, (szzMin.get(row.horizon_days) ?? 0) + 1);
  }
  for (const s of horizons.values()) {
    const n = s.corrective.true + s.corrective.false;
    s.corrective_rate = ratio2(s.corrective.true, n);
    s.corrective_rate_ci95 = wilsonInterval(s.corrective.true, n);
    s.corrective_rate_high_precision = ratio2(highPrecision.get(s.horizon_days) ?? 0, n);
    s.corrective_rate_szz_min_lines = ratio2(szzMin.get(s.horizon_days) ?? 0, n);
    s.candidates.rejection_rate = ratio2(s.candidates.rejected, s.candidates.total);
    s.linkage_error.rate = ratio2(s.linkage_error.rejected, s.candidates.total);
    for (const cell2 of Object.values(s.rejections_by_proxy)) cell2.rejection_rate = ratio2(cell2.rejected, cell2.total);
    s.s2_outcomes = sortKeys(s.s2_outcomes);
    s.rejections_by_reason = sortKeys(s.rejections_by_reason);
    s.rejections_by_proxy = sortKeys(s.rejections_by_proxy);
  }
  return {
    repo: input.repo,
    tier: input.tier ?? null,
    merge_convention: input.mergeConvention ?? null,
    horizons: [...horizons.values()].sort((a, b) => a.horizon_days - b.horizon_days),
    revert_reasons: sortKeys(revertReasons)
  };
}
var pct2 = (r) => r === null ? "n/a" : `${(r * 100).toFixed(1)}%`;
var rateAt = (repo, field = "corrective_rate") => repo.horizons.find((h) => h.horizon_days === FLAG_HORIZON)?.[field] ?? null;
function sanityFlags(repos, notes = []) {
  const flags = [];
  for (const repo of repos) {
    const rate = rateAt(repo);
    if (rate === null) continue;
    if (rate < DEGENERATE_RATE) flags.push({ code: "degenerate_rate", repos: [repo.repo], merge_convention: repo.merge_convention, detail: `${pct2(rate)} at ${FLAG_HORIZON}d is below ${pct2(DEGENERATE_RATE)}`, resolution: null });
    if (rate > CHURN_RATE) flags.push({ code: "churn_rate", repos: [repo.repo], merge_convention: repo.merge_convention, detail: `${pct2(rate)} at ${FLAG_HORIZON}d is above ${pct2(CHURN_RATE)}`, resolution: null });
  }
  for (const flag of flags) {
    const note = notes.find((n) => n.code === flag.code && n.repo === flag.repos[0]);
    if (note) flag.resolution = { action: note.action, note: note.note };
  }
  return flags;
}
function conventionSpread(repos) {
  const groups = /* @__PURE__ */ new Map();
  for (const repo of repos) if (repo.merge_convention && rateAt(repo) !== null) groups.set(repo.merge_convention, [...groups.get(repo.merge_convention) ?? [], repo]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([convention, members]) => {
    const sorted = [...members].sort((a, b) => rateAt(a) - rateAt(b) || a.repo.localeCompare(b.repo));
    const hp = members.map((m) => rateAt(m, "corrective_rate_high_precision") ?? 0);
    return {
      merge_convention: convention,
      repos: members.length,
      low: { repo: sorted[0].repo, rate: rateAt(sorted[0]) },
      high: { repo: sorted.at(-1).repo, rate: rateAt(sorted.at(-1)) },
      high_precision: { low: Math.min(...hp), high: Math.max(...hp) }
    };
  });
}
var ci = (i) => i ? `${(i.low * 100).toFixed(1)}\u2013${(i.high * 100).toFixed(1)}` : "n/a";
function renderCorpusReportMarkdown(report) {
  const lines = [
    `# Corpus sanity report`,
    "",
    `Run \`${report.run_id}\`, as-of ${report.as_of}. Corrective rate = true / (true + false), 95% Wilson CI. Proxy columns count corrective rows each proxy supports (rows can have several). "P1+P2" is the rate from reverts and repair references alone; "SZZ\u2265${SZZ_SENSITIVITY_MIN_LINES}" requires SZZ links to blame at least ${SZZ_SENSITIVITY_MIN_LINES} lines. Rejected = share of candidates (lag \u2264 horizon) the labeller rejected.`,
    "",
    "| Repo | Convention | H | PRs | S2 survived | Corrective | 95% CI | P1+P2 | SZZ\u22653 | revert | repair_ref | szz | regr_issue | Rejected | linkage_error |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"
  ];
  for (const repo of report.repos) {
    for (const h of repo.horizons) {
      const labelled = h.prs - (h.s2_outcomes.missing ?? 0);
      const c = h.proxy_contribution;
      lines.push(
        `| ${repo.repo} | ${repo.merge_convention ?? ""} | ${h.horizon_days} | ${h.prs} | ${pct2(ratio2(h.s2_outcomes.survived ?? 0, labelled))} | ${pct2(h.corrective_rate)} | ${ci(h.corrective_rate_ci95)} | ${pct2(h.corrective_rate_high_precision)} | ${pct2(h.corrective_rate_szz_min_lines)} | ${c.revert?.rows ?? 0} | ${c.repair_reference?.rows ?? 0} | ${c.szz?.rows ?? 0} | ${c.regression_issue?.rows ?? 0} | ${pct2(h.candidates.rejection_rate)} | ${h.linkage_error.rejected} |`
      );
    }
  }
  lines.push("", "## Sanity flags", "");
  if (!report.flags.length) lines.push("None.");
  for (const flag of report.flags) {
    lines.push(`- **${flag.code}** (${flag.repos.join(", ")}): ${flag.detail}.`);
    lines.push(flag.resolution ? `  - ${flag.resolution.action}: ${flag.resolution.note}` : "  - **unresolved**");
  }
  if (report.spread?.length) {
    lines.push("", `## Spread by merge convention (${FLAG_HORIZON}d, informational)`, "", "| Convention | Repos | Lowest | Highest | P1+P2 range |", "|---|---|---|---|---|");
    for (const g of report.spread) lines.push(`| ${g.merge_convention} | ${g.repos} | ${pct2(g.low.rate)} (${g.low.repo}) | ${pct2(g.high.rate)} (${g.high.repo}) | ${pct2(g.high_precision.low)}\u2013${pct2(g.high_precision.high)} |`);
  }
  if (report.conventionFindings?.length) {
    lines.push("", "## Merge-convention findings", "");
    for (const f of report.conventionFindings) lines.push(`- **${f.merge_convention}**${f.repos.length ? ` (${f.repos.join(", ")})` : ""}: ${f.finding}`);
  }
  return `${lines.join("\n")}
`;
}

// src/corpus/cli.ts
var OPTIONS = {
  manifest: { type: "string" },
  "cache-dir": { type: "string" },
  repo: { type: "string" },
  "as-of": { type: "string" },
  out: { type: "string" },
  notes: { type: "string" },
  plan: { type: "string" },
  "exclude-slice": { type: "string" },
  seed: { type: "string" },
  sample: { type: "string" }
};
var CORPUS_COMMANDS = [
  "corpus-enumerate",
  "corpus-label",
  "corpus-corrective",
  "corpus-report",
  "corpus-calibration-sample",
  "corpus-calibration-evidence",
  "corpus-calibration-score"
];
var RETRYABLE = /HTTP 50[234]|secondary rate limit|abuse|timed? ?out|ETIMEDOUT|ECONNRESET|was submitted too quickly|Something went wrong while executing your query|connection reset by peer|unexpected EOF|error connecting to|could not resolve host|unexpected end of JSON input/i;
var RATE_LIMITED = /rate limit (?:already )?exceeded|RATE_LIMITED/i;
function secondsUntilReset() {
  const result = execArgvCommand("gh", ["api", "rate_limit", "--jq", "[.resources.graphql, .resources.core] | map(select(.remaining < 50) | .reset) | max // 0"], { encoding: "utf8" });
  const reset = Number(result.stdout.trim());
  if (result.exitCode !== 0 || !Number.isFinite(reset) || reset === 0) return 60;
  return Math.max(30, reset - Math.floor(Date.now() / 1e3) + 5);
}
var blockingSleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
function createGhGraphql(sleep, log) {
  return (query, variables) => {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value === null) continue;
      args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
    }
    for (let attempt2 = 0; ; attempt2++) {
      const result = execArgvCommand("gh", args, { encoding: "utf8", maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      const parsed = parseGraphqlResponse(result.stdout);
      if (parsed?.data && (parsed.errors ?? []).every((error) => error.type === "NOT_FOUND")) return parsed.data;
      if (result.exitCode === 0 && parsed?.errors?.length) throw new Error(`GitHub GraphQL error: ${parsed.errors[0].message}`);
      const stderr = result.stderr || result.stdout;
      if (RATE_LIMITED.test(stderr) && attempt2 < 48) {
        const wait = secondsUntilReset();
        log(`warn: GitHub rate limit reached; waiting ${wait}s for the window to reset`);
        sleep(wait * 1e3);
        continue;
      }
      if (RETRYABLE.test(stderr) && attempt2 < 6) {
        const wait = 2e3 * 2 ** attempt2;
        log(`warn: GitHub ${stderr.split("\n")[0]?.slice(0, 80)}; retrying in ${wait / 1e3}s`);
        sleep(wait);
        continue;
      }
      throw new Error(`GitHub request failed: ${stderr.split("\n")[0]?.slice(0, 200)}`);
    }
  };
}
function parseGraphqlResponse(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
function createGhPullsForCommit(repo, sleep, log) {
  return (sha) => {
    for (let attempt2 = 0; ; attempt2++) {
      const result = execArgvCommand("gh", ["api", `repos/${repo}/commits/${sha}/pulls`, "--jq", "[.[] | .number]"], { encoding: "utf8" });
      if (result.exitCode === 0) return JSON.parse(result.stdout || "[]");
      if (RATE_LIMITED.test(result.stderr) && attempt2 < 48) {
        const wait = secondsUntilReset();
        log(`warn: GitHub rate limit reached; waiting ${wait}s for the window to reset`);
        sleep(wait * 1e3);
        continue;
      }
      if (RETRYABLE.test(result.stderr) && attempt2 < 6) {
        log(`warn: GitHub ${result.stderr.split("\n")[0]?.slice(0, 80)}; retrying`);
        sleep(2e3 * 2 ** attempt2);
        continue;
      }
      throw new Error(`GitHub request failed: ${result.stderr.split("\n")[0]?.slice(0, 200)}`);
    }
  };
}
var GZIP_MEMBER_BYTES = 32 * 1024 * 1024;
function writeJsonl(path4, rows, options = {}) {
  const fd = openSync2(path4, "w");
  let bytes = 0;
  let writtenBytes = 0;
  let largestRowBytes = 0;
  let pending = [];
  let pendingBytes = 0;
  const flush = () => {
    if (pendingBytes === 0) return;
    const chunk = gzipSync(Buffer.concat(pending));
    writeSync2(fd, chunk);
    writtenBytes += chunk.length;
    pending = [];
    pendingBytes = 0;
  };
  try {
    for (const row of rows) {
      const line = Buffer.from(`${JSON.stringify(row)}
`);
      bytes += line.length;
      largestRowBytes = Math.max(largestRowBytes, line.length);
      if (!options.gzip) {
        writeSync2(fd, line);
        writtenBytes += line.length;
        continue;
      }
      pending.push(line);
      pendingBytes += line.length;
      if (pendingBytes >= (options.memberBytes ?? GZIP_MEMBER_BYTES)) flush();
    }
    flush();
  } finally {
    closeSync2(fd);
  }
  return { bytes, writtenBytes, largestRowBytes };
}
function fileCache(dir) {
  mkdirSync2(dir, { recursive: true });
  const path4 = (key) => join7(dir, `${createHash4("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  return {
    get: (key) => existsSync4(path4(key)) ? JSON.parse(readFileSync3(path4(key), "utf8")) : void 0,
    set: (key, value) => writeFileSync2(path4(key), JSON.stringify(value))
  };
}
function syncClone(repo, dir, defaultBranch) {
  const runGit3 = (args) => execArgvCommand("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: GIT_OUTPUT_MAX_BUFFER });
  const url = `https://github.com/${repo}.git`;
  for (let attempt2 = 1; !existsSync4(join7(dir, "HEAD")); attempt2++) {
    const cloned = execArgvCommand("git", ["clone", "--bare", "--filter=blob:none", "--no-tags", url, dir], { encoding: "utf8" });
    if (cloned.exitCode === 0) break;
    rmSync2(dir, { recursive: true, force: true });
    if (attempt2 >= 3) throw new Error(`git clone failed: ${cloned.stderr.trim().split("\n").pop()}`);
  }
  const fetched = runGit3(["fetch", "--no-tags", "--filter=blob:none", "origin", `+refs/heads/${defaultBranch}:refs/heads/${defaultBranch}`]);
  if (fetched.exitCode !== 0) throw new Error(`git fetch failed: ${fetched.stderr.trim().split("\n").pop()}`);
  return runGit3;
}
function runCorpusCli(command, argv, io) {
  if (!CORPUS_COMMANDS.includes(command)) {
    io.writeStderr(`error: unknown corpus command ${command}; expected one of ${CORPUS_COMMANDS.join(", ")}
`);
    return { exitCode: 2 };
  }
  let values;
  let entries;
  let manifestBytes;
  let window;
  try {
    ({ values } = parseArgs2({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (error) {
    io.writeStderr(`error: ${error.message}
`);
    return { exitCode: 2 };
  }
  if (command === "corpus-calibration-score") {
    if (!values.sample) {
      io.writeStderr("error: corpus-calibration-score needs --sample <dir>\n");
      return { exitCode: 2 };
    }
    return runCalibrationScore(resolve4(io.cwd, values.sample), io);
  }
  try {
    if (!values.manifest || !values["cache-dir"]) throw new Error("--manifest and --cache-dir are required");
    manifestBytes = readFileSync3(resolve4(io.cwd, values.manifest));
    const manifest = parseCohortManifest(JSON.parse(manifestBytes.toString("utf8")));
    entries = runnableRepos(manifest, values.repo);
    window = { from: /* @__PURE__ */ new Date(`${manifest.window.merged_from}T00:00:00Z`), until: /* @__PURE__ */ new Date(`${manifest.window.merged_until}T00:00:00Z`) };
  } catch (error) {
    io.writeStderr(`error: ${error.message}
`);
    return { exitCode: 2 };
  }
  const log = (line) => io.writeStderr(`${line}
`);
  if (command === "corpus-calibration-sample") {
    if (!values.plan || !values["exclude-slice"] || !values.out) {
      io.writeStderr("error: corpus-calibration-sample needs --plan <json>, --exclude-slice <slice manifest> and --out <private dir>\n");
      return { exitCode: 2 };
    }
    if (values.seed !== void 0 && !/^[0-9a-f]{64}$/.test(values.seed)) {
      io.writeStderr("error: --seed must be 64 lowercase hex characters\n");
      return { exitCode: 2 };
    }
    return runCalibrationSample(entries, manifestBytes, resolve4(io.cwd, values["cache-dir"]), resolve4(io.cwd, values.plan), resolve4(io.cwd, values["exclude-slice"]), resolve4(io.cwd, values.out), values.seed, io, log);
  }
  if (command === "corpus-calibration-evidence") {
    if (!values.sample) {
      io.writeStderr("error: corpus-calibration-evidence needs --sample <dir>\n");
      return { exitCode: 2 };
    }
    return runCalibrationEvidence(resolve4(io.cwd, values["cache-dir"]), resolve4(io.cwd, values.sample), io, log);
  }
  if (command === "corpus-report") {
    const asOf = values["as-of"] ? new Date(values["as-of"]) : null;
    if (!asOf || !Number.isFinite(asOf.getTime()) || !values.out) {
      io.writeStderr("error: corpus-report needs --as-of <iso> and --out <dir>\n");
      return { exitCode: 2 };
    }
    let notes = { notes: [], convention_findings: [] };
    try {
      if (values.notes) {
        const parsed = JSON.parse(readFileSync3(resolve4(io.cwd, values.notes), "utf8"));
        notes = { notes: parsed.notes ?? [], convention_findings: parsed.convention_findings ?? [] };
      }
    } catch (error) {
      io.writeStderr(`error: --notes: ${error.message}
`);
      return { exitCode: 2 };
    }
    return runReport(entries, resolve4(io.cwd, values["cache-dir"]), asOf, manifestBytes, notes, resolve4(io.cwd, values.out), io, log);
  }
  const graphql = createGhGraphql(io.sleep ?? blockingSleep, log);
  const cacheRoot = resolve4(io.cwd, values["cache-dir"]);
  if (command === "corpus-label" || command === "corpus-corrective") {
    const asOf = values["as-of"] ? new Date(values["as-of"]) : /* @__PURE__ */ new Date();
    if (!Number.isFinite(asOf.getTime())) {
      io.writeStderr("error: --as-of must be an ISO-8601 timestamp\n");
      return { exitCode: 2 };
    }
    if (command === "corpus-corrective") return runCorrective(entries, cacheRoot, window, asOf, graphql, io, log);
    return runLabel(entries, cacheRoot, asOf, graphql, io, log);
  }
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split("/");
    const repoDir = join7(cacheRoot, `${owner}__${name}`);
    try {
      mkdirSync2(repoDir, { recursive: true });
      const meta = graphql("query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ defaultBranchRef{ name } } }", { owner, name });
      const branch = meta.repository.defaultBranchRef?.name;
      if (!branch) throw new Error("repository has no default branch");
      log(`info: ${entry.repo}: syncing clone of ${branch}`);
      const runGit3 = syncClone(entry.repo, join7(repoDir, "repo.git"), branch);
      const { records, stats } = enumerateCorpusRepo(
        { repo: entry.repo, branch, defaultBranchNames: [branch, ...entry.default_branch_aliases ?? []], ...window },
        { runGit: runGit3, graphql, cache: fileCache(join7(repoDir, "graphql")), onDiagnostic: log, pullsForCommit: createGhPullsForCommit(entry.repo, io.sleep ?? blockingSleep, log) }
      );
      writeJsonl(join7(repoDir, "prs.jsonl"), records);
      writeFileSync2(join7(repoDir, "enumeration.json"), `${JSON.stringify(stats, null, 2)}
`);
      io.writeStdout(`${JSON.stringify(stats)}
`);
      log(`info: ${entry.repo}: ${stats.prs} PRs, mapped_share ${stats.mapped_share}, pr_recall_est ${stats.pr_recall_est}, direct_push_share_est ${stats.direct_push_share_est}`);
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: error.message })}
`);
      log(`error: ${entry.repo}: ${error.message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}
function runLabel(entries, cacheRoot, asOf, graphql, io, log) {
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split("/");
    const repoDir = join7(cacheRoot, `${owner}__${name}`);
    const started = Date.now();
    try {
      const statsPath = join7(repoDir, "enumeration.json");
      if (!existsSync4(statsPath)) throw new Error("not enumerated yet; run corpus-enumerate first");
      const { branch } = JSON.parse(readFileSync3(statsPath, "utf8"));
      const records = readFileSync3(join7(repoDir, "prs.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const gitDir = join7(repoDir, "repo.git");
      const runGit3 = (args) => execArgvCommand("git", ["-C", gitDir, ...args], { encoding: "utf8", maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      log(`info: ${entry.repo}: backfilling blobs`);
      const backfill = runGit3(["backfill"]);
      if (backfill.exitCode !== 0) throw new Error(`git backfill failed: ${backfill.stderr.trim().split("\n").pop()}`);
      log(`info: ${entry.repo}: prefetching cross-references for ${records.length} PRs`);
      const crossReferences = prefetchCrossReferences(entry.repo, records.map((r) => r.pr_number), graphql, fileCache(join7(repoDir, "graphql")));
      log(`info: ${entry.repo}: labelling`);
      const { rows, failed } = labelCorpusRepo(
        { owner, repo: name, branch, repoDir: gitDir, records, horizons: HORIZONS },
        { runGit: runGit3, github: prefetchedGithubClient(crossReferences), now: () => asOf, onDiagnostic: log }
      );
      const written = writeJsonl(join7(repoDir, "s2.jsonl.gz"), rows, { gzip: true });
      const summary = {
        repo: entry.repo,
        as_of: asOf.toISOString(),
        prs: records.length,
        rows: rows.length,
        failed_prs: failed.length,
        failed_sample: failed.slice(0, 20),
        s2_bytes: written.bytes,
        s2_gzip_bytes: written.writtenBytes,
        largest_row_bytes: written.largestRowBytes,
        wall_clock_seconds: Math.round((Date.now() - started) / 1e3),
        base_rates: summarizeLabels(entry.repo, rows)
      };
      writeFileSync2(join7(repoDir, "s2.summary.json"), `${JSON.stringify(summary, null, 2)}
`);
      io.writeStdout(`${JSON.stringify(summary)}
`);
      if (failed.length) failures++;
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: error.message })}
`);
      log(`error: ${entry.repo}: ${error.message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}
function readJsonl2(path4) {
  return readFileSync3(path4, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function* readGzipJsonlMembers(path4) {
  const raw = readFileSync3(path4);
  for (let offset = 0; offset < raw.length; ) {
    if (raw[offset] !== 31 || raw[offset + 1] !== 139 || raw[offset + 3] !== 0) throw new Error(`${path4}: unexpected gzip member header at byte ${offset}`);
    const { buffer, engine } = inflateRawSync(raw.subarray(offset + 10), { info: true });
    offset += 10 + engine.bytesWritten + 8;
    for (const line of buffer.toString("utf8").split("\n")) if (line) yield JSON.parse(line);
  }
}
function runCorrective(entries, cacheRoot, window, asOf, graphql, io, log) {
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split("/");
    const repoDir = join7(cacheRoot, `${owner}__${name}`);
    const started = Date.now();
    try {
      const s2Path = join7(repoDir, "s2.jsonl.gz");
      if (!existsSync4(s2Path)) throw new Error("not labelled yet; run corpus-label first");
      const { branch } = JSON.parse(readFileSync3(join7(repoDir, "enumeration.json"), "utf8"));
      const originals = readJsonl2(join7(repoDir, "prs.jsonl"));
      const gitDir = join7(repoDir, "repo.git");
      const runGit3 = (args) => execArgvCommand("git", ["-C", gitDir, ...args], { encoding: "utf8", maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      const cache = fileCache(join7(repoDir, "graphql"));
      const laterPath = join7(repoDir, "fix-prs.jsonl");
      let laterPrs = [];
      if (existsSync4(laterPath)) laterPrs = readJsonl2(laterPath);
      else if (window.until < asOf) {
        log(`info: ${entry.repo}: enumerating fix sources ${window.until.toISOString()}..${asOf.toISOString()}`);
        ({ records: laterPrs } = enumerateCorpusRepo(
          { repo: entry.repo, branch, defaultBranchNames: [branch, ...entry.default_branch_aliases ?? []], from: window.until, until: asOf },
          { runGit: runGit3, graphql, cache, onDiagnostic: log }
        ));
        writeJsonl(laterPath, laterPrs);
      }
      log(`info: ${entry.repo}: loading cross-references and S2 rows`);
      const crossReferences = prefetchCrossReferences(entry.repo, originals.map((r) => r.pr_number), graphql, cache);
      const closing = [...originals, ...laterPrs].flatMap((pr) => pr.closing_issues);
      log(`info: ${entry.repo}: fetching labels for ${new Set(closing).size} closed issues`);
      const issues = prefetchIssueMeta(entry.repo, closing, graphql, cache);
      const s2Rows = readGzipJsonlMembers(s2Path);
      const result = correctiveCorpusRepo(
        { repo: entry.repo, branch, originals, laterPrs, from: window.from, asOf, crossReferences, issues, szz: true, s2Rows },
        { runGit: runGit3, now: () => /* @__PURE__ */ new Date(), onDiagnostic: log }
      );
      writeJsonl(join7(repoDir, "candidates.jsonl.gz"), result.candidates, { gzip: true });
      writeJsonl(join7(repoDir, "repair_pairs.jsonl.gz"), result.repairPairs, { gzip: true });
      writeJsonl(join7(repoDir, "corrective.jsonl.gz"), result.corrective, { gzip: true });
      const summary = {
        repo: entry.repo,
        as_of: asOf.toISOString(),
        later_prs: laterPrs.length,
        ...summarizeCorrective(result, originals.length),
        wall_clock_seconds: Math.round((Date.now() - started) / 1e3)
      };
      writeFileSync2(join7(repoDir, "corrective.summary.json"), `${JSON.stringify(summary, null, 2)}
`);
      io.writeStdout(`${JSON.stringify(summary)}
`);
      if (result.failedPairs.length || result.szz.failed) failures++;
    } catch (error) {
      failures++;
      io.writeStdout(`${JSON.stringify({ repo: entry.repo, error: error.message })}
`);
      log(`error: ${entry.repo}: ${error.message}`);
    }
  }
  return { exitCode: failures ? 3 : 0 };
}
var REPORT_INPUTS = ["s2.jsonl.gz", "candidates.jsonl.gz", "repair_pairs.jsonl.gz", "corrective.jsonl.gz"];
function runReport(entries, cacheRoot, asOf, manifestBytes, notes, outDir, io, log) {
  const sha2562 = (bytes) => createHash4("sha256").update(bytes).digest("hex");
  const repos = [];
  const inputs = [];
  const versions = { s2: /* @__PURE__ */ new Set(), corrective: /* @__PURE__ */ new Set() };
  const day = asOf.toISOString().slice(0, 10);
  let failures = 0;
  for (const entry of entries) {
    const [owner, name] = entry.repo.split("/");
    const repoDir = join7(cacheRoot, `${owner}__${name}`);
    try {
      for (const file of REPORT_INPUTS) if (!existsSync4(join7(repoDir, file))) throw new Error(`missing ${file}; run corpus-label and corpus-corrective first`);
      const counted = (file, onRow) => {
        const path4 = join7(repoDir, file);
        const bytes = readFileSync3(path4);
        const record = { repo: entry.repo, file, sha256: sha2562(bytes), bytes: bytes.length, rows: 0 };
        inputs.push(record);
        return (function* () {
          for (const row of readGzipJsonlMembers(path4)) {
            record.rows++;
            onRow(row);
            yield row;
          }
        })();
      };
      const checkAsOf = (value, file) => {
        if (value.slice(0, 10) !== day) throw new Error(`${file} is labelled as of ${value}, not ${day}`);
      };
      const s2Rows = counted("s2.jsonl.gz", (r) => versions.s2.add(`schema ${r.schema_version}, labeller ${r.envelope.labeller_version}`));
      const candidates = counted("candidates.jsonl.gz", (r) => checkAsOf(r.envelope.as_of, "candidates.jsonl.gz"));
      const correctiveRows = counted("corrective.jsonl.gz", (r) => {
        checkAsOf(r.envelope.as_of, "corrective.jsonl.gz");
        versions.corrective.add(`schema ${r.schema_version}, definition ${r.envelope.definition_version}, labeller ${r.envelope.labeller_version}`);
      });
      const pairs = counted("repair_pairs.jsonl.gz", () => {
      })[Symbol.iterator]();
      while (!pairs.next().done) ;
      const summary = summarizeCorpusRepo({ repo: entry.repo, tier: entry.tier ?? null, mergeConvention: entry.observed_merge_convention ?? null, s2Rows, candidates, correctiveRows });
      repos.push(summary);
      log(`info: ${entry.repo}: summarized`);
    } catch (error) {
      failures++;
      log(`error: ${entry.repo}: ${error.message}`);
    }
  }
  if (failures) return { exitCode: 3 };
  const flags = sanityFlags(repos, notes.notes);
  const findings = notes.convention_findings;
  const spread = conventionSpread(repos);
  const manifest = {
    report_version: CORPUS_REPORT_VERSION,
    as_of: asOf.toISOString(),
    cohort_manifest_sha256: sha2562(manifestBytes),
    label_versions: { s2: [...versions.s2].sort(), corrective: [...versions.corrective].sort() },
    inputs
  };
  const run_id = sha2562(Buffer.from(JSON.stringify(manifest))).slice(0, 16);
  mkdirSync2(outDir, { recursive: true });
  writeFileSync2(join7(outDir, "run-manifest.json"), `${JSON.stringify({ run_id, ...manifest, flags: flags.map(({ code, repos: r, merge_convention, resolution }) => ({ code, repos: r, merge_convention, resolution })), convention_findings: findings }, null, 2)}
`);
  writeFileSync2(join7(outDir, "corpus-report.json"), `${JSON.stringify({ run_id, as_of: manifest.as_of, report_version: CORPUS_REPORT_VERSION, repos, flags, convention_spread: spread, convention_findings: findings }, null, 2)}
`);
  writeFileSync2(join7(outDir, "corpus-report.md"), renderCorpusReportMarkdown({ run_id, as_of: day, repos, flags, spread, conventionFindings: findings }));
  const unresolved = flags.filter((f) => !f.resolution).length;
  io.writeStdout(`${JSON.stringify({ run_id, repos: repos.length, flags: flags.length, unresolved })}
`);
  return { exitCode: unresolved ? 1 : 0 };
}
function insideGitWorkTree(path4) {
  for (let dir = path4; ; dir = dirname(dir)) {
    if (existsSync4(join7(dir, ".git"))) return true;
    if (dirname(dir) === dir) return false;
  }
}
function runCalibrationSample(entries, manifestBytes, cacheRoot, planPath, slicePath, outDir, seedArg, io, log) {
  const sha2562 = (bytes2) => createHash4("sha256").update(bytes2).digest("hex");
  let plan;
  let planBytes;
  let sliceBytes;
  let sliceRepos;
  try {
    planBytes = readFileSync3(planPath);
    plan = parseCalibrationPlan(JSON.parse(planBytes.toString("utf8")));
    sliceBytes = readFileSync3(slicePath);
    const slice = JSON.parse(sliceBytes.toString("utf8"));
    if (!Array.isArray(slice.repos) || !slice.repos.length || !slice.repos.every((r) => typeof r === "string")) throw new Error("--exclude-slice has no repos list");
    sliceRepos = new Set(slice.repos);
    if (insideGitWorkTree(outDir)) throw new Error("--out must be outside any git work tree; the sample and its labels stay private");
    if (existsSync4(outDir) && readdirSync(outDir).length) throw new Error(`${outDir} is not empty; refusing to overwrite a drawn sample`);
  } catch (error) {
    io.writeStderr(`error: ${error.message}
`);
    return { exitCode: 2 };
  }
  const development = entries.filter((e) => !sliceRepos.has(e.repo));
  const seed = seedArg ?? randomBytes(32).toString("hex");
  const units = [];
  const inputs = [];
  let failures = 0;
  for (const entry of development) {
    const [owner, name] = entry.repo.split("/");
    const repoDir = join7(cacheRoot, `${owner}__${name}`);
    try {
      const files = ["candidates.jsonl.gz", "corrective.jsonl.gz"];
      for (const file2 of files) {
        const path4 = join7(repoDir, file2);
        if (!existsSync4(path4)) throw new Error(`missing ${file2}; run corpus-corrective first`);
        inputs.push({ repo: entry.repo, file: file2, sha256: sha2562(readFileSync3(path4)) });
      }
      units.push(
        ...classifyCalibrationRepo({
          repo: entry.repo,
          horizonDays: plan.horizon_days,
          szzStrongMinLines: plan.szz_strong_min_lines,
          candidates: readGzipJsonlMembers(join7(repoDir, files[0])),
          correctiveRows: readGzipJsonlMembers(join7(repoDir, files[1]))
        })
      );
    } catch (error) {
      failures++;
      log(`error: ${entry.repo}: ${error.message}`);
    }
  }
  if (failures) return { exitCode: 3 };
  const sample = drawCalibrationSample(units, plan, seed);
  const repos = new Set(sample.items.map((i) => i.repo)).size;
  if (repos < plan.min_repos) {
    io.writeStderr(`error: the sample spans ${repos} repos; the plan needs at least ${plan.min_repos}
`);
    return { exitCode: 3 };
  }
  const file = {
    procedure: "hok-3269-calibration-sample",
    sampler_version: CALIBRATION_SAMPLER_VERSION,
    plan,
    plan_sha256: sha2562(planBytes),
    cohort_manifest_sha256: sha2562(manifestBytes),
    excluded_slice_sha256: sha2562(sliceBytes),
    seed,
    inputs,
    cells: sample.cells,
    items: sample.items,
    drawn_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  mkdirSync2(outDir, { recursive: true, mode: 448 });
  const bytes = Buffer.from(`${JSON.stringify(file, null, 2)}
`, "utf8");
  writeFileSync2(join7(outDir, "sample.json"), bytes, { mode: 384, flag: "wx" });
  const strata = Object.fromEntries(CALIBRATION_STRATA.map((s) => [s, sample.items.filter((i) => i.stratum === s).length]));
  io.writeStdout(
    `${JSON.stringify({ sample_sha256: sha2562(bytes), items: sample.items.length, double: sample.items.filter((i) => i.double).length, audit: sample.items.filter((i) => i.audit).length, repos, strata, shortfalls: sample.shortfalls })}
`
  );
  return { exitCode: 0 };
}
function runCalibrationScore(sampleDir, io) {
  let sample;
  let sheets;
  try {
    sample = JSON.parse(readFileSync3(join7(sampleDir, "sample.json"), "utf8"));
    if (sample.procedure !== "hok-3269-calibration-sample") throw new Error(`${sampleDir}/sample.json is not a calibration sample`);
    sheets = {
      a: readFileSync3(join7(sampleDir, "sheet-a.csv"), "utf8"),
      b: readFileSync3(join7(sampleDir, "sheet-b.csv"), "utf8"),
      h: readFileSync3(join7(sampleDir, "sheet-h.csv"), "utf8")
    };
  } catch (error) {
    io.writeStderr(`error: ${error.message}
`);
    return { exitCode: 2 };
  }
  const subset = (keep) => new Map(sample.items.filter(keep).map((i) => [i.item_id, i]));
  const a = parseLabelSheet(sheets.a, subset(() => true));
  const b = parseLabelSheet(sheets.b, subset((i) => i.double));
  const h = parseLabelSheet(sheets.h, subset((i) => i.audit));
  const errors = [...a.errors.map((e) => `sheet-a: ${e}`), ...b.errors.map((e) => `sheet-b: ${e}`), ...h.errors.map((e) => `sheet-h: ${e}`)];
  if (errors.length) {
    io.writeStderr(`${errors.map((e) => `error: ${e}`).join("\n")}
`);
    return { exitCode: 2 };
  }
  const run = scoreCalibrationRun({ plan: sample.plan, items: sample.items, cells: sample.cells, sheets: { a: a.labels, b: b.labels, h: h.labels }, seed: sample.seed });
  writeFileSync2(join7(sampleDir, "calibration-results.json"), `${JSON.stringify({ sample_plan_sha256: sample.plan_sha256, ...run }, null, 2)}
`, { mode: 384 });
  writeFileSync2(join7(sampleDir, "calibration-table.md"), renderCalibrationMarkdown(run), { mode: 384 });
  io.writeStdout(
    `${JSON.stringify({ items: run.model.items, model_unlabelled: run.model.unlabelled, audit_unlabelled: run.human.unlabelled, models_stand_in: run.models_stand_in, chosen_definition: run.chosen_definition, table: join7(sampleDir, "calibration-table.md") })}
`
  );
  return { exitCode: 0 };
}
function runCalibrationEvidence(cacheRoot, sampleDir, io, log) {
  let sample;
  try {
    sample = JSON.parse(readFileSync3(join7(sampleDir, "sample.json"), "utf8"));
    if (sample.procedure !== "hok-3269-calibration-sample") throw new Error(`${sampleDir}/sample.json is not a calibration sample`);
    for (const file of ["evidence.jsonl", "sheet-h.csv"]) if (existsSync4(join7(sampleDir, file))) throw new Error(`${file} exists; refusing to overwrite`);
  } catch (error) {
    io.writeStderr(`error: ${error.message}
`);
    return { exitCode: 2 };
  }
  const evidence3 = [];
  let failures = 0;
  for (const repo of [...new Set(sample.items.map((i) => i.repo))].sort()) {
    const repoDir = join7(cacheRoot, repo.replace("/", "__"));
    try {
      const { branch } = JSON.parse(readFileSync3(join7(repoDir, "enumeration.json"), "utf8"));
      const records = [...readJsonl2(join7(repoDir, "prs.jsonl")), ...existsSync4(join7(repoDir, "fix-prs.jsonl")) ? readJsonl2(join7(repoDir, "fix-prs.jsonl")) : []];
      const prs = new Map(records.map((r) => [r.pr_url, r]));
      const bySha = /* @__PURE__ */ new Map();
      for (const r of records) for (const sha of [r.merge_sha, r.landed_sha, ...r.relanded_merge_shas ?? []]) if (!bySha.has(sha)) bySha.set(sha, r);
      const gitDir = join7(repoDir, "repo.git");
      const runGit3 = (args) => execArgvCommand("git", ["-C", gitDir, ...args], { encoding: "utf8", maxBuffer: GIT_OUTPUT_MAX_BUFFER });
      for (const item of sample.items.filter((i) => i.repo === repo)) evidence3.push(buildItemEvidence(item, { branch, horizonDays: sample.plan.horizon_days, prs, bySha }, runGit3));
    } catch (error) {
      failures++;
      log(`error: evidence failed for one repo: ${error.message}`);
    }
  }
  if (failures) return { exitCode: 3 };
  const order = new Map(sample.items.map((i, n) => [i.item_id, n]));
  evidence3.sort((x, y) => order.get(x.item_id) - order.get(y.item_id));
  writeJsonl(join7(sampleDir, "evidence.jsonl"), evidence3);
  chmodSync(join7(sampleDir, "evidence.jsonl"), 384);
  const related = new Map(evidence3.map((e) => [e.item_id, e.related.map((r) => r.url)]));
  writeFileSync2(join7(sampleDir, "sheet-h.csv"), renderLabelSheet(sample.items.filter((i) => i.audit), related), { mode: 384, flag: "wx" });
  const truncated = evidence3.reduce((n, e) => n + Number(e.original.diff_truncated) + e.fixes.filter((f) => f.diff_truncated).length, 0);
  io.writeStdout(`${JSON.stringify({ items: evidence3.length, audit: sample.items.filter((i) => i.audit).length, diffs_truncated: truncated, with_related: evidence3.filter((e) => e.related.length).length })}
`);
  return { exitCode: 0 };
}

// src/orchestrate/github.ts
function createOfflineScanGitHubClient() {
  return {
    offline: true,
    async getRepo() {
      await Promise.resolve();
      return { defaultBranch: "", private: false };
    },
    async getPullRequest() {
      await Promise.resolve();
      return null;
    },
    async listPullCommits() {
      await Promise.resolve();
      return [];
    },
    async getCheckConclusion() {
      await Promise.resolve();
      return null;
    }
  };
}

// src/orchestrate/integration-branch.ts
var IntegrationBranchError = class extends Error {
  exitCode = 2;
  constructor(message) {
    super(message);
    this.name = "IntegrationBranchError";
  }
};
var MAIN_GUIDANCE = "integration branch resolves to main and no promotion branch was detected. Pass --integration-branch <ref>, or --integration-mode direct if PRs merge straight into main (S2 v1.1.0).";
var PR_MERGE = /^Merge pull request #(\d+) from [^/]+\/(.+)$/i;
var SQUASH2 = /\(#(\d+)\)\s*$/;
function resolveIntegrationBranch(evidence3) {
  const explicit = evidence3.explicitBranch?.trim();
  const explicitMode = evidence3.explicitMode ?? null;
  if (explicit) {
    if (explicit.toLowerCase() === "main" && explicitMode !== "direct") throw new IntegrationBranchError(MAIN_GUIDANCE);
    return { branch: explicit, mode: explicitMode ?? "promotion", detected: false, summary: "explicit integration branch" };
  }
  if (!evidence3.defaultBranch) throw new IntegrationBranchError("Repository default branch is missing.");
  if (evidence3.defaultBranch.toLowerCase() !== "main") return { branch: evidence3.defaultBranch, mode: explicitMode ?? "direct", detected: false, summary: "repository default branch" };
  if (explicitMode === "direct") return { branch: evidence3.defaultBranch, mode: "direct", detected: false, summary: "default branch, direct merge (explicit)" };
  const counts = /* @__PURE__ */ new Map();
  let promotions = 0;
  for (const subject of evidence3.recentFirstParentSubjects.slice(0, 200)) {
    let number = null;
    let ref3 = null;
    const merge = subject.match(PR_MERGE);
    const squash = subject.match(SQUASH2);
    if (merge) {
      number = Number(merge[1]);
      ref3 = merge[2];
    } else if (squash) {
      number = Number(squash[1]);
      ref3 = evidence3.headRefLookup(number);
    }
    if (!number || !ref3 || !ref3.includes("/")) continue;
    promotions++;
    counts.set(ref3, (counts.get(ref3) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (winner && promotions > 0 && winner[1] / promotions >= 0.6 && evidence3.remoteBranchExists(winner[0])) {
    return { branch: winner[0], mode: "promotion", detected: true, summary: `detected ${winner[0]} in ${winner[1]}/${promotions} promotion merges` };
  }
  throw new IntegrationBranchError(MAIN_GUIDANCE);
}

// src/orchestrate/scan-report.ts
import * as fs3 from "node:fs";
import * as os from "node:os";
import * as path3 from "node:path";

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
function hide(cell2, reasons2) {
  cell2.suppressed = true;
  cell2.value = null;
  cell2.ci = null;
  cell2.suppression_reasons = ordered([...cell2.suppression_reasons, ...reasons2]);
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
  const harness = report.coverage.attribution.harness.rate >= policy.min_harness_coverage;
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
  eligibility.harness_table = harness;
  eligibility.cost_adjusted_by_model = exact && actual;
  eligibility.retrospective = !!report.model_provenance && !!report.retrospective && report.retrospective.n_reworked >= policy.min_reworked_for_retrospective;
  const modelReasons = exact ? [] : harness ? ["exact_model_coverage_below_floor", "harness_only_evidence"] : ["exact_model_coverage_below_floor"];
  const harnessReasons = harness ? [] : ["harness_coverage_below_floor"];
  const costReasons = exact ? actual ? [] : ["cost_coverage_below_floor"] : modelReasons;
  const sectionReasons = {
    survival_by_horizon: [],
    risk_ratios: [],
    survival_by_model: modelReasons,
    survival_by_harness: harnessReasons,
    cost_adjusted_survival_by_model: costReasons
  };
  for (const [name, section2] of Object.entries(report.aggregates)) {
    const reason = sectionReasons[name];
    for (const row of section2.rows)
      for (const cell2 of rowsCells(row)) {
        if (cell2.n < policy.min_cell_n) hide(cell2, ["n_below_floor"]);
        if (reason.length) hide(cell2, reason);
      }
    const cells = section2.rows.flatMap(
      rowsCells
    );
    if (reason.length || !cells.length || cells.every((c) => c.suppressed)) {
      section2.status = "suppressed";
      section2.suppression_reasons = ordered([
        ...section2.suppression_reasons,
        ...reason,
        ...cells.flatMap((c) => c.suppression_reasons),
        ...!cells.length ? ["n_below_floor"] : []
      ]);
    } else {
      section2.status = "shown";
      section2.suppression_reasons = [];
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
    for (const [name, cell2] of Object.entries({
      precision: report.retrospective.precision,
      recall: report.retrospective.recall,
      flagged_share: report.retrospective.flagged_share
    })) {
      if (cell2.n < policy.min_cell_n) hide(cell2, ["n_below_floor"]);
      if (name !== "flagged_share" && cell2.n < policy.min_reworked_for_retrospective)
        hide(cell2, ["reworked_below_floor"]);
      if (reasons2.length) hide(cell2, reasons2);
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

// src/report/aggregate.ts
var OUTCOMES = ["survived", "followup", "substantially_rewritten", "reverted"];
var emptySection = (rows) => ({ basis: "descriptive", status: "shown", suppression_reasons: [], rows });
function makeCell(k, n) {
  const ci2 = wilsonInterval(k, n);
  return { basis: "descriptive", n, value: n ? Math.round(k / n * 1e4) / 1e4 : null, ci: ci2 ? { ...ci2, level: 0.95 } : null, suppressed: false, suppression_reasons: [] };
}
function ratioCell(ratio3, n, ci2) {
  return { basis: "descriptive", n, value: ratio3, ci: ci2 ? { low: ci2.low, high: ci2.high, level: 0.95 } : null, suppressed: false, suppression_reasons: [] };
}
function labelAt(pr, horizon2) {
  return pr.labels.find((label2) => label2.horizon_days === horizon2);
}
function bucketFor(pr, feature, cuts) {
  if (feature === "tests_changed") return pr.features.tests_changed === null ? null : pr.features.tests_changed ? "true" : "false";
  if (feature === "files_touched_bucket") return pr.features.files_touched_bucket;
  if (pr.features.loc_touched === null || !cuts) return null;
  return quartileOf(pr.features.loc_touched, cuts);
}
var reworked = (label2) => ["followup", "substantially_rewritten", "reverted"].includes(label2.outcome.report_outcome ?? "");
function buildAggregates(prs, horizons) {
  const survival = [];
  const risks = [];
  const models = [];
  const harnesses = [];
  for (const h of [...horizons].sort((a, b) => a - b)) {
    const labelled = prs.flatMap((pr) => {
      const l = labelAt(pr, h);
      return l?.outcome.report_outcome ? [{ pr, l }] : [];
    });
    for (const outcome2 of OUTCOMES) {
      const selected = labelled.filter(({ l }) => l.outcome.report_outcome === outcome2);
      survival.push({ horizon_days: h, outcome: outcome2, cell: makeCell(selected.length, labelled.length) });
    }
    for (const feature of Object.keys(REPORT_FEATURE_BUCKETS)) {
      const locValues = feature === "loc_touched" ? labelled.map(({ pr }) => pr.features.loc_touched).filter((v) => v !== null).sort((a, b) => a - b) : [];
      const cuts = nearestRankQuartiles(locValues);
      const buckets = REPORT_FEATURE_BUCKETS[feature];
      for (const bucket of buckets) {
        const group = labelled.filter(({ pr }) => bucketFor(pr, feature, cuts) === bucket);
        const outside = labelled.filter(({ pr }) => bucketFor(pr, feature, cuts) !== null && bucketFor(pr, feature, cuts) !== bucket);
        const ki = group.filter(({ l }) => reworked(l)).length;
        const ko = outside.filter(({ l }) => reworked(l)).length;
        const ciRate = wilsonInterval(ki, group.length);
        const ciBase = wilsonInterval(ko, outside.length);
        const rr = group.length && outside.length ? katzLogRatioInterval(ki, group.length, ko, outside.length) : null;
        risks.push({ horizon_days: h, feature, bucket, rework_rate: makeCell(ki, group.length), baseline_rate: makeCell(ko, outside.length), ratio: ratioCell(rr?.ratio ?? null, Math.min(group.length, outside.length), rr) });
        if (!ciRate || !ciBase) {
        }
      }
    }
    const modelIds = [...new Set(labelled.map(({ pr }) => pr.attribution.exact_model.id).filter((v) => !!v))].sort();
    for (const id2 of modelIds) {
      const group = labelled.filter(({ pr }) => pr.attribution.exact_model.id === id2);
      models.push({ horizon_days: h, model_id: id2, cell: makeCell(group.filter(({ l }) => l.outcome.survived === true).length, group.length) });
    }
    const harnessIds = [...new Set(labelled.map(({ pr }) => pr.attribution.harness.id).filter((v) => !!v))].sort();
    for (const id2 of harnessIds) {
      const group = labelled.filter(({ pr }) => pr.attribution.harness.id === id2);
      harnesses.push({ horizon_days: h, harness_id: id2, cell: makeCell(group.filter(({ l }) => l.outcome.survived === true).length, group.length) });
    }
  }
  return {
    survival_by_horizon: emptySection(survival),
    risk_ratios: emptySection(risks),
    survival_by_model: emptySection(models),
    survival_by_harness: emptySection(harnesses),
    cost_adjusted_survival_by_model: emptySection([])
  };
}
function buildCoverage(prs, horizons) {
  const missingByHorizon = [...horizons].sort((a, b) => a - b).map((h) => {
    const labels = prs.map((pr) => labelAt(pr, h)).filter((label2) => !!label2);
    const missing = /* @__PURE__ */ new Map();
    for (const label2 of labels) if (!label2.outcome.report_outcome) for (const reason of label2.outcome.reason_codes) missing.set(reason, (missing.get(reason) ?? 0) + 1);
    return { horizon_days: h, labelled: labels.filter((label2) => !!label2.outcome.report_outcome).length, missing: [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })) };
  });
  const identifiedAgent = prs.filter((pr) => pr.attribution.agent.status === "agent").length;
  const identifiedHarness = prs.filter((pr) => !!pr.attribution.harness.id).length;
  const identifiedModel = prs.filter((pr) => !!pr.attribution.exact_model.id).length;
  const methods2 = [];
  const tallies = /* @__PURE__ */ new Map();
  for (const pr of prs) for (const [dimension2, values] of [["agent", pr.attribution.agent.methods], ["harness", pr.attribution.harness.methods], ["exact_model", pr.attribution.exact_model.methods]]) for (const method of values) {
    const key = `${dimension2}	${method}`;
    tallies.set(key, (tallies.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...tallies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [dimension2, method] = key.split("	");
    methods2.push({ dimension: dimension2, method, count });
  }
  return {
    basis: "descriptive",
    prs_enumerated: prs.length,
    prs_eligible: prs.filter((pr) => pr.labels.some((label2) => !!label2.outcome.report_outcome)).length,
    labels_by_horizon: missingByHorizon,
    attribution: {
      agent: { identified_agent: identifiedAgent, identified_human_signal: 0, unknown: prs.length - identifiedAgent, rate: prs.length ? Math.round(identifiedAgent / prs.length * 1e4) / 1e4 : 0 },
      harness: { identified: identifiedHarness, unknown: prs.length - identifiedHarness, rate: prs.length ? Math.round(identifiedHarness / prs.length * 1e4) / 1e4 : 0 },
      exact_model: { identified: identifiedModel, unknown: prs.length - identifiedModel, rate: prs.length ? Math.round(identifiedModel / prs.length * 1e4) / 1e4 : 0 },
      methods: methods2
    }
  };
}

// src/report/build.ts
function buildReportDraft(input) {
  const horizons = [...input.horizons].sort((a, b) => a - b);
  const prs = [...input.prs].sort((a, b) => a.merged_at.localeCompare(b.merged_at) || a.pr_number - b.pr_number);
  return {
    schema_version: "arbiter_report/v1",
    data_origin: "scan",
    repo: { host: "github", owner: input.owner, name: input.repo },
    scan: {
      scanned_at: input.scannedAt,
      as_of: input.asOf,
      scanner: { package: "@hokusai/scan", version: input.scannerVersion },
      integration_branch: input.integrationBranch,
      lookback_days: input.lookbackDays,
      window: { merged_from: input.mergedFrom, merged_to: input.mergedTo },
      horizons_days: horizons,
      contracts: { candidate_features: "candidate_features/v1", survival_label: "1.0.0", labeller_version: SCAN_CONTRACT.labellerVersion, normalization_version: SCAN_CONTRACT.normalizationVersion }
    },
    policy: structuredClone(input.policy ?? DEFAULT_REPORT_POLICY),
    coverage: buildCoverage(prs, horizons),
    prs,
    aggregates: buildAggregates(prs, horizons),
    cost: null,
    retrospective: null,
    model_provenance: null,
    eligibility: { exact_model_table: false, harness_table: false, cost_adjusted_by_model: false, retrospective: false, model_routing_cta: false, reasons: [] }
  };
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object2 = value;
    return `{${Object.keys(object2).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object2[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function emitReport(draft, policy = DEFAULT_REPORT_POLICY) {
  const report = applyReportSuppression(draft, policy);
  const validation = validateArbiterReportV1(report);
  if (!validation.ok) throw new Error(`Invalid arbiter_report/v1: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  return `${JSON.stringify(JSON.parse(canonicalJson(report)), null, 2)}
`;
}

// src/attribution/metadata-block.ts
function extractMetadataBlock(body) {
  if (!body) return null;
  const match = body.match(/<!--\s*wavemill-meta\s*([\s\S]*?)\s*-->/i);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([A-Za-z][\w.-]{0,63})\s*:\s*(.{1,256})\s*$/);
    if (pair) data[pair[1].toLowerCase()] = pair[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return data;
}

// src/attribution/engine.ts
var AttributionConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AttributionConfigError";
  }
};
var HARNESS_REGISTRY = Object.freeze(["aider", "claude-code", "codex", "openhands", "wavemill"]);
var MODEL_SIGNATURES = Object.freeze(["claude-", "gpt-", "o1", "o3", "gemini-"]);
var GENERIC_AGENT_SIGNATURES = Object.freeze(["bot", "[bot]"]);
var known = /* @__PURE__ */ new Set(["botLogins", "branchPrefixes", "labels", "extraBotLogins", "extraBranchPrefixes"]);
function resolveAttributionConfig(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new AttributionConfigError("Attribution config must be an object");
  const config = input;
  const unknown = Object.keys(config).filter((key) => !known.has(key));
  if (unknown.length) throw new AttributionConfigError(`Unknown attribution config key: ${unknown[0]}`);
  for (const key of ["botLogins", "branchPrefixes", "extraBotLogins", "extraBranchPrefixes"]) {
    const values = config[key];
    if (values !== void 0 && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length > 200))) {
      throw new AttributionConfigError(`${key} must be an array of bounded strings`);
    }
  }
  if (config.labels !== void 0 && (!config.labels || typeof config.labels !== "object" || Array.isArray(config.labels))) throw new AttributionConfigError("labels must be an object");
  return config;
}
var unique = (values) => [...new Set(values)];
var recognizedModel = (value) => !!value && MODEL_SIGNATURES.some((signature) => value.toLowerCase().startsWith(signature));
function attributePullRequest(pr, config = {}) {
  const metadata = extractMetadataBlock(pr.body);
  const agentMethods = [];
  const harnessMethods = [];
  const modelMethods = [];
  let identifiedAgent = false;
  const routeRole = typeof metadata?.["executedroute"] === "string" ? metadata["executedroute"].toLowerCase() : "";
  const metadataHead = typeof metadata?.["headsha"] === "string" ? metadata["headsha"].toLowerCase() : null;
  const routeVerified = routeRole === "coder" && recognizedModel(typeof metadata?.["model"] === "string" ? metadata["model"] : null) && (!metadataHead || metadataHead === pr.headSha.toLowerCase());
  if (routeVerified) {
    identifiedAgent = true;
    agentMethods.push("first_party_route_metadata");
    harnessMethods.push("first_party_route_metadata");
    modelMethods.push("first_party_route_metadata");
  }
  const login = (pr.authorLogin ?? "").toLowerCase();
  const configuredBot = [...config.botLogins ?? [], ...config.extraBotLogins ?? []].some((value) => value.toLowerCase() === login);
  const botAuthor = configuredBot || /\[bot\]$/i.test(pr.authorLogin ?? "") || (pr.authorType ?? "").toLowerCase() === "bot";
  if (botAuthor) {
    identifiedAgent = true;
    agentMethods.push(configuredBot ? "owner_config" : "bot_author");
  }
  if (pr.commitMessages.some((message) => /co-authored-by:.*(?:\[bot\]|\b(?:bot|agent)\b)/i.test(message))) {
    identifiedAgent = true;
    agentMethods.push("co_authored_by_trailer");
  }
  const configuredPrefix = config.branchPrefixes?.find((value) => pr.headRef.startsWith(value));
  const ownerPrefix = config.extraBranchPrefixes?.find((value) => pr.headRef.startsWith(value));
  const builtInPrefix = /^(?:agent|bot|codex|aider|claude-code)\//i.test(pr.headRef);
  if (configuredPrefix || ownerPrefix || builtInPrefix) {
    identifiedAgent = true;
    agentMethods.push(ownerPrefix ? "owner_config" : "branch_prefix");
  }
  const matchedLabel = pr.labels.find((label2) => config.labels?.[label2] !== void 0);
  if (matchedLabel) {
    identifiedAgent = true;
    agentMethods.push("pr_label");
  }
  const signatureMatches = pr.commitMessages.join("\n").match(/\b(?:gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|o[13](?:-[\w.-]+)?)\b/ig) ?? [];
  const signatureModels = [...new Set(signatureMatches.map((value) => value.toLowerCase()))];
  if (signatureModels.length) {
    identifiedAgent = true;
    agentMethods.push("commit_signature");
  }
  const metadataHarness = typeof metadata?.["harness"] === "string" ? metadata["harness"].toLowerCase() : null;
  const labelHarness = matchedLabel ? config.labels?.[matchedLabel]?.harness?.toLowerCase() ?? null : null;
  const prefixHarness = builtInPrefix ? pr.headRef.split("/")[0]?.toLowerCase() ?? null : null;
  const harnessEvidence = routeVerified ? [metadataHarness] : [metadataHarness, labelHarness, prefixHarness].filter((value) => !!value);
  const harnessIds = [...new Set(harnessEvidence.filter((value) => typeof value === "string" && HARNESS_REGISTRY.includes(value)))];
  const harness = harnessIds.length === 1 ? harnessIds[0] : null;
  if (harness && !routeVerified) harnessMethods.push(metadataHarness ? "first_party_route_metadata" : labelHarness ? "pr_label" : "branch_prefix");
  const metadataModel = typeof metadata?.["model"] === "string" ? metadata["model"].toLowerCase() : null;
  const labelModel = matchedLabel ? config.labels?.[matchedLabel]?.model?.toLowerCase() ?? null : null;
  const modelEvidence = routeVerified ? [metadataModel] : [labelModel, ...signatureModels].filter((value) => !!value && recognizedModel(value));
  const modelIds = [...new Set(modelEvidence.filter((value) => recognizedModel(value)))];
  const exactModel = modelIds.length === 1 ? modelIds[0] : null;
  if (exactModel && !routeVerified) modelMethods.push(signatureModels.includes(exactModel) ? "commit_signature" : "pr_label");
  return {
    agent: { status: identifiedAgent ? "agent" : "unknown", confidence: identifiedAgent ? 1 : null, methods: unique(agentMethods) },
    harness: { id: harness, confidence: harness ? routeVerified ? 1 : 0.8 : null, methods: unique(harnessMethods) },
    exactModel: { id: exactModel, confidence: exactModel ? routeVerified ? 1 : 0.5 : null, methods: unique(modelMethods), evidence: exactModel ? routeVerified ? "first_party_executed" : "heuristic" : null }
  };
}
function toReportAttribution(value) {
  return { agent: value.agent, harness: value.harness, exact_model: value.exactModel };
}

// src/orchestrate/enumerate.ts
var EMPTY_TREE_SHA3 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
function enumerateWindow(options) {
  const { runGit: runGit3, branch, from, to, cursor = null, maxPrs = Number.MAX_SAFE_INTEGER } = options;
  const cutoff = Math.floor(from.getTime() / 1e3);
  const end = Math.floor(to.getTime() / 1e3);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.getTime() > to.getTime() || cutoff > end) throw new RangeError("Invalid merge window");
  let reset = false;
  let bootstrap2 = cursor === null;
  if (cursor !== null && !isAncestor(runGit3, cursor, branch)) {
    reset = true;
    bootstrap2 = true;
  }
  const fmt = "%H%x09%P%x09%ct%x09%s";
  const args = bootstrap2 ? ["log", "--first-parent", "--reverse", `--pretty=format:${fmt}`, ...cutoff > 0 ? [`--since=${from.toISOString()}`] : [], branch] : ["log", "--first-parent", "--reverse", `--pretty=format:${fmt}`, `${cursor}..${branch}`];
  const result = runGit3(args);
  if (result.exitCode !== 0) throw new Error("Unable to enumerate integration branch history");
  const merges = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [sha, parentsText = "", epochText = "", ...subjectParts] = line.split("	");
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const epoch = Number.parseInt(epochText, 10);
    if (!Number.isFinite(epoch) || epoch < cutoff || epoch > end) continue;
    const parents = parentsText.trim().split(/\s+/).filter(Boolean);
    const parentSha = parents[0] ?? EMPTY_TREE_SHA3;
    const subject = subjectParts.join("	");
    merges.push({ mergeSha: sha, parentSha, mergedAtEpoch: epoch, prNumber: extractPrNumber(subject), headSha: parents[1] ?? sha });
  }
  const cap2 = Math.max(0, Math.floor(maxPrs));
  return { merges: cap2 < merges.length ? merges.slice(-cap2) : merges, cursorReset: reset };
}

// src/orchestrate/state.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import { createHash as createHash5 } from "node:crypto";
function scanConfigHash(config) {
  return createHash5("sha256").update(stableJson(config)).digest("hex");
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value;
    return `{${Object.keys(o).sort().map((key) => `${JSON.stringify(key)}:${stableJson(o[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function atomicWrite(file, contents) {
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    fs2.writeFileSync(temp, contents, { mode: 384 });
    fs2.renameSync(temp, file);
  } catch (error) {
    try {
      fs2.unlinkSync(temp);
    } catch {
    }
    throw error;
  }
}
function validHeader(value) {
  if (!value || typeof value !== "object") return false;
  const h = value;
  return h.state_version === 1 && ["scanner_version", "labeller_version", "normalization_version", "integration_branch"].every((key) => typeof h[key] === "string") && typeof h.config_hash === "string" && /^[0-9a-f]{64}$/.test(h.config_hash) && (h.last_seen_merge_sha === null || typeof h.last_seen_merge_sha === "string" && /^[0-9a-f]{40}$/.test(h.last_seen_merge_sha));
}
function validRow(value) {
  if (!value || typeof value !== "object") return false;
  const row = value;
  return exactKeys(row, ["merge_sha", "merged_at_epoch", "pr_number", "merged_at", "attribution", "features", "labels_by_horizon"]) && typeof row.merge_sha === "string" && /^[0-9a-f]{40}$/.test(row.merge_sha) && Number.isInteger(row.merged_at_epoch) && row.merged_at_epoch >= 0 && Number.isInteger(row.pr_number) && row.pr_number > 0 && typeof row.merged_at === "string" && validAttribution(row.attribution) && validateCandidateFeaturesV1(row.features).ok && validLabelsByHorizon(row.labels_by_horizon);
}
function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function validMethods(value) {
  return Array.isArray(value) && value.every((method) => typeof method === "string" && REPORT_ATTRIBUTION_METHODS.includes(method));
}
function validDimension(value, status, ids, evidence3 = false) {
  if (!object(value)) return false;
  const keys = evidence3 ? ["id", "confidence", "methods", "evidence"] : ids ? ["id", "confidence", "methods"] : ["status", "confidence", "methods"];
  return exactKeys(value, keys) && (ids ? typeof value.id === "string" || value.id === null : status.includes(value.status)) && (typeof value.confidence === "number" || value.confidence === null) && validMethods(value.methods) && (!evidence3 || value.evidence === "first_party_executed" || value.evidence === "heuristic" || value.evidence === null);
}
function validAttribution(value) {
  if (!object(value) || !exactKeys(value, ["agent", "harness", "exact_model"])) return false;
  return validDimension(value.agent, ["agent", "not_agent_signal", "unknown"], false) && validDimension(value.harness, [], true) && validDimension(value.exact_model, [], true, true);
}
function validLabel(value) {
  if (!object(value) || !exactKeys(value, ["horizon_days", "label_provenance", "outcome", "label_hash"]) || !HORIZONS.includes(value.horizon_days) || value.label_provenance !== "harvested" && value.label_provenance !== "owner_corrected" || typeof value.label_hash !== "string" || !/^[0-9a-f]{64}$/.test(value.label_hash) || !object(value.outcome)) return false;
  const outcome2 = value.outcome;
  return exactKeys(outcome2, ["survived", "survival_ratio", "reverted", "undone_by", "followup", "report_outcome", "reason_codes"]) && (typeof outcome2.survived === "boolean" || outcome2.survived === null) && (typeof outcome2.survival_ratio === "number" || outcome2.survival_ratio === null) && (typeof outcome2.reverted === "boolean" || outcome2.reverted === null) && (outcome2.undone_by === "human" || outcome2.undone_by === "agent" || outcome2.undone_by === null) && (typeof outcome2.followup === "boolean" || outcome2.followup === null) && ["survived", "followup", "substantially_rewritten", "reverted", null].includes(outcome2.report_outcome) && Array.isArray(outcome2.reason_codes) && outcome2.reason_codes.every((code) => typeof code === "string" && REASON_CODES.includes(code));
}
function validLabelsByHorizon(value) {
  return object(value) && Object.entries(value).every(([horizon2, label2]) => /^(14|30|60)$/.test(horizon2) && validLabel(label2) && String(label2.horizon_days) === horizon2);
}
function readScanState(dir, versions, isAncestor2) {
  const statePath = path2.join(dir, "state.json");
  const rowsPath = path2.join(dir, "prs.jsonl");
  if (!fs2.existsSync(statePath)) return { header: null, rows: [], invalidated: false };
  try {
    const header = JSON.parse(fs2.readFileSync(statePath, "utf8"));
    if (!validHeader(header)) throw new Error("invalid state header");
    const configHash = scanConfigHash(versions.config);
    const same = header.scanner_version === versions.scannerVersion && header.labeller_version === versions.labellerVersion && header.normalization_version === versions.normalizationVersion && header.integration_branch === versions.integrationBranch && header.config_hash === configHash;
    const ancestor = header.last_seen_merge_sha === null || isAncestor2(header.last_seen_merge_sha);
    if (!same || !ancestor) return { header: null, rows: [], invalidated: true };
    const rows = [];
    if (fs2.existsSync(rowsPath)) for (const line of fs2.readFileSync(rowsPath, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (!validRow(row)) throw new Error("invalid cache row");
      rows.push(row);
    }
    return { header, rows, invalidated: false };
  } catch {
    return { header: null, rows: [], invalidated: true };
  }
}
function writeScanState(dir, versions, lastSeenMergeSha, rows) {
  if (lastSeenMergeSha !== null && !/^[0-9a-f]{40}$/.test(lastSeenMergeSha)) throw new TypeError("Invalid merge cursor");
  if (!rows.every(validRow)) throw new TypeError("Invalid derived scan cache row");
  const header = { state_version: 1, scanner_version: versions.scannerVersion, labeller_version: versions.labellerVersion, normalization_version: versions.normalizationVersion, config_hash: scanConfigHash(versions.config), integration_branch: versions.integrationBranch, last_seen_merge_sha: lastSeenMergeSha };
  atomicWrite(path2.join(dir, "prs.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  atomicWrite(path2.join(dir, "state.json"), `${JSON.stringify(header, null, 2)}
`);
}

// src/orchestrate/scan-report.ts
var ScanStageFailureError = class extends Error {
  constructor() {
    super("STAGE_FAILURE_THRESHOLD");
    this.name = "ScanStageFailureError";
  }
};
async function runReportScan(target, deps, options) {
  const now = deps.now();
  const maxLookback = options.maxLookbackDays ?? 730;
  const requested = options.lookbackDays ?? 180;
  const lookbackDays = Math.max(1, Math.min(requested, maxLookback));
  if (requested > maxLookback) deps.onDiagnostic?.(`warn: lookback clamped to ${maxLookback} days`);
  const maxPrs = options.maxPrs ?? 500;
  const from = new Date(now.getTime() - lookbackDays * 864e5);
  const stateVersions = { scannerVersion: options.scannerVersion, labellerVersion: SCAN_CONTRACT.labellerVersion, normalizationVersion: SCAN_CONTRACT.normalizationVersion, integrationBranch: target.integrationBranch, config: { horizons: options.horizons ?? [14, 30, 60], attributionConfig: options.attributionConfig ?? {}, staticAnalysis: options.staticAnalysis ?? "off", features: ["candidate_features/v1"] } };
  const cached = options.stateDir ? readScanState(options.stateDir, stateVersions, (sha) => isAncestor(deps.runGit, sha, target.integrationBranch)) : null;
  if (cached?.invalidated) deps.onDiagnostic?.("info: incremental cache invalidated; performing a full rescan");
  const enumerated = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, from, to: now, cursor: cached?.header?.last_seen_merge_sha ?? null, maxPrs: maxPrs + 1 });
  let merges = enumerated.merges;
  if (merges.length > maxPrs) {
    merges = merges.slice(-maxPrs);
    deps.onDiagnostic?.(`warn: capped report at newest ${maxPrs} PRs`);
  }
  const allLocal = enumerateWindow({ runGit: deps.runGit, branch: target.integrationBranch, from: /* @__PURE__ */ new Date(0), to: now }).merges;
  const reportMergeShas = new Set(allLocal.filter((merge) => merge.mergedAtEpoch >= Math.floor(from.getTime() / 1e3) && merge.mergedAtEpoch <= Math.floor(now.getTime() / 1e3)).slice(-maxPrs).map((merge) => merge.mergeSha));
  merges = merges.filter((merge) => reportMergeShas.has(merge.mergeSha));
  const config = resolveAttributionConfig(options.attributionConfig);
  const reportRows = /* @__PURE__ */ new Map();
  for (const row of cached?.rows ?? []) if (reportMergeShas.has(row.merge_sha)) {
    reportRows.set(row.merge_sha, { pr_number: row.pr_number, merged_at: row.merged_at, attribution: row.attribution, features: row.features, labels: Object.values(row.labels_by_horizon), cost: null, prediction: null });
  }
  const cachedBySha = new Map((cached?.rows ?? []).map((row) => [row.merge_sha, row]));
  const stateBySha = new Map((cached?.rows ?? []).map((row) => [row.merge_sha, row]));
  const horizons = options.horizons ?? [14, 30, 60];
  const label2 = deps.label ?? labelMergedPr;
  const labellerTarget = { owner: target.owner, repo: target.repo, repoDir: target.repoDir, integrationBranch: target.integrationBranch, integrationMode: target.integrationMode };
  const refs = allLocal.flatMap((merge) => merge.prNumber === null ? [] : [{
    prNumber: merge.prNumber,
    prUrl: `https://github.com/${target.owner}/${target.repo}/pull/${merge.prNumber}`,
    mergeSha: merge.mergeSha,
    parentSha: merge.parentSha,
    headSha: merge.headSha,
    mergedAtEpoch: merge.mergedAtEpoch,
    subject: `#${merge.prNumber}`
  }]);
  const refBySha = new Map(refs.map((ref3) => [ref3.mergeSha, ref3]));
  let failedPrs = 0;
  const attemptedPrs = merges.filter((merge) => merge.prNumber !== null).length;
  for (const merge of merges) {
    if (merge.prNumber === null) {
      deps.onDiagnostic?.("info: skipped commit without a PR number");
      continue;
    }
    try {
      const previous = cachedBySha.get(merge.mergeSha);
      let prNumber = merge.prNumber;
      let mergedAt;
      let attribution;
      let features;
      if (previous) {
        prNumber = previous.pr_number;
        mergedAt = previous.merged_at;
        attribution = previous.attribution;
        features = previous.features;
      } else {
        const apiPr = await deps.github.getPullRequest(merge.prNumber);
        if (!apiPr && !deps.github.offline) {
          deps.onDiagnostic?.(`warn: GitHub could not find PR #${merge.prNumber}; skipped`);
          continue;
        }
        const pr = apiPr ?? { number: merge.prNumber, title: "", body: null, authorLogin: null, authorType: null, headRef: "", headSha: merge.headSha, labels: [], mergedAt: new Date(merge.mergedAtEpoch * 1e3).toISOString() };
        const commits = deps.github.offline ? deps.runGit(["log", "--format=%B", `${merge.parentSha}..${merge.mergeSha}`]).stdout.split("\n\n").filter(Boolean) : await deps.github.listPullCommits(pr.number);
        attribution = toReportAttribution(attributePullRequest({ ...pr, commitMessages: commits }, config));
        mergedAt = pr.mergedAt;
        if (deps.extract) {
          features = deps.extract({ ...merge, prNumber: merge.prNumber }, { taskText: `${pr.title}

${pr.body ?? ""}` });
        } else {
          const checkoutParent = fs3.mkdtempSync(path3.join(os.tmpdir(), "hokusai-scan-report-"));
          const checkoutDir = path3.join(checkoutParent, "checkout");
          try {
            const add = deps.runGit(["worktree", "add", "--detach", "--no-checkout", checkoutDir, merge.mergeSha]);
            if (add.exitCode !== 0) throw new Error("Unable to prepare PR checkout");
            for (const args of [["-C", checkoutDir, "update-ref", "HEAD", merge.mergeSha], ["-C", checkoutDir, "checkout", "-f"]]) {
              if (deps.runGit(args).exitCode !== 0) throw new Error("Unable to check out PR merge");
            }
            features = extractCandidateFeatures({
              checkoutDir,
              prNumber: pr.number,
              baseRef: merge.parentSha,
              offline: true,
              staticFeatures: options.staticAnalysis === "off" ? NULL_STATIC_FEATURES : void 0,
              contract: { taskText: `${pr.title}

${pr.body ?? ""}` }
            });
          } finally {
            deps.runGit(["worktree", "remove", "--force", checkoutDir]);
            fs3.rmSync(checkoutParent, { recursive: true, force: true });
          }
        }
        await deps.github.getCheckConclusion(pr.headSha);
      }
      const ref3 = refBySha.get(merge.mergeSha);
      const labelCache = previous?.labels_by_horizon ?? {};
      const labelsByHorizon = /* @__PURE__ */ new Map();
      for (const horizon2 of horizons) {
        const old = labelCache[String(horizon2)];
        const matured = merge.mergedAtEpoch + horizon2 * 86400 <= Math.floor(now.getTime() / 1e3);
        if (old && matured && !old.outcome.reason_codes.includes("missing_horizon")) labelsByHorizon.set(horizon2, old);
      }
      if (horizons.some((horizon2) => !labelsByHorizon.has(horizon2))) {
        const fresh = label2(labellerTarget, deps.labeller, ref3, { horizons, allMergedPrs: refs }).map(projectSurvivalLabel);
        for (const item of fresh) {
          const old = labelCache[String(item.horizon_days)];
          const matured = merge.mergedAtEpoch + item.horizon_days * 86400 <= Math.floor(now.getTime() / 1e3);
          labelsByHorizon.set(item.horizon_days, old && matured && !old.outcome.reason_codes.includes("missing_horizon") ? old : item);
        }
      }
      const labels = horizons.map((horizon2) => labelsByHorizon.get(horizon2)).filter((item) => !!item);
      const reportRow = { pr_number: prNumber, merged_at: mergedAt, attribution, features, labels, cost: null, prediction: null };
      reportRows.set(merge.mergeSha, reportRow);
      stateBySha.set(merge.mergeSha, { merge_sha: merge.mergeSha, merged_at_epoch: merge.mergedAtEpoch, pr_number: prNumber, merged_at: mergedAt, attribution, features, labels_by_horizon: Object.fromEntries(labels.map((item) => [String(item.horizon_days), item])) });
    } catch (error) {
      if (error instanceof ScanUpstreamError) throw error;
      failedPrs++;
      deps.onDiagnostic?.(`error: failed to process PR #${merge.prNumber}`);
    }
  }
  const processedShas = new Set(merges.map((merge) => merge.mergeSha));
  for (const previous of cached?.rows ?? []) {
    if (processedShas.has(previous.merge_sha) || !reportMergeShas.has(previous.merge_sha)) continue;
    const ref3 = refBySha.get(previous.merge_sha);
    if (!ref3) continue;
    const labelsByHorizon = /* @__PURE__ */ new Map();
    for (const horizon2 of horizons) {
      const old = previous.labels_by_horizon[String(horizon2)];
      const matured = previous.merged_at_epoch + horizon2 * 86400 <= Math.floor(now.getTime() / 1e3);
      if (old && matured && !old.outcome.reason_codes.includes("missing_horizon")) labelsByHorizon.set(horizon2, old);
    }
    if (horizons.some((horizon2) => !labelsByHorizon.has(horizon2))) {
      const fresh = label2(labellerTarget, deps.labeller, ref3, { horizons, allMergedPrs: refs }).map(projectSurvivalLabel);
      for (const item of fresh) {
        const old = previous.labels_by_horizon[String(item.horizon_days)];
        const matured = previous.merged_at_epoch + item.horizon_days * 86400 <= Math.floor(now.getTime() / 1e3);
        labelsByHorizon.set(item.horizon_days, old && matured && !old.outcome.reason_codes.includes("missing_horizon") ? old : item);
      }
    }
    const labels = horizons.map((horizon2) => labelsByHorizon.get(horizon2)).filter((item) => !!item);
    const reportRow = { pr_number: previous.pr_number, merged_at: previous.merged_at, attribution: previous.attribution, features: previous.features, labels, cost: null, prediction: null };
    reportRows.set(previous.merge_sha, reportRow);
    stateBySha.set(previous.merge_sha, { ...previous, labels_by_horizon: Object.fromEntries(labels.map((item) => [String(item.horizon_days), item])) });
  }
  if (attemptedPrs > 0 && failedPrs / attemptedPrs > 0.1) throw new ScanStageFailureError();
  if (options.stateDir) {
    const lastSeen = allLocal.at(-1)?.mergeSha ?? null;
    const save = () => writeScanState(options.stateDir, stateVersions, lastSeen, [...stateBySha.values()]);
    if (options.onStateSave) options.onStateSave(save);
    else save();
  }
  const rows = [...reportRows.values()];
  const dates = rows.map((pr) => pr.merged_at).sort();
  return buildReportDraft({
    owner: target.owner,
    repo: target.repo,
    integrationBranch: target.integrationBranch,
    scannerVersion: options.scannerVersion,
    scannedAt: now.toISOString(),
    asOf: now.toISOString(),
    lookbackDays,
    mergedFrom: dates[0] ?? from.toISOString(),
    mergedTo: now.toISOString(),
    horizons,
    prs: rows,
    ...options.policy ? { policy: options.policy } : {}
  });
}

// src/report/contribute.ts
var ContributionPayloadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionPayloadError";
  }
};
var forbidden = new Set(REPORT_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));
function findForbidden(value, prefix = "") {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findForbidden(value[i], `${prefix}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (forbidden.has(lower) || lower.startsWith("raw") && lower.length > 3) return `${prefix}.${key}`;
    const found = findForbidden(child, `${prefix}.${key}`);
    if (found) return found;
  }
  return null;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object2 = value;
    return `{${Object.keys(object2).sort().map((key) => `${JSON.stringify(key)}:${canonical(object2[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function buildContributionPayload(report) {
  const checked = validateArbiterReportV1(report);
  if (!checked.ok) throw new ContributionPayloadError(`Invalid report: ${checked.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  if (checked.value.data_origin !== "scan") throw new ContributionPayloadError("Only scan reports can be contributed");
  const path4 = findForbidden(checked.value);
  if (path4) throw new ContributionPayloadError(`Forbidden report field at ${path4}`);
  return { payload: checked.value, body: `${JSON.stringify(JSON.parse(canonical(checked.value)), null, 2)}
` };
}
async function submitReport(transport, payload, options) {
  if (!options.apiKey) throw new ContributionPayloadError("API key is required");
  let response;
  try {
    response = await transport(`${options.baseUrl.replace(/\/$/, "")}/api/v1/arbiter/reports`, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "application/json" }, body: payload.body });
  } catch {
    throw new ScanUpstreamError("Arbiter report submission failed");
  }
  const responseText = await response.text();
  if (response.status < 200 || response.status >= 300) throw new ScanUpstreamError(`Arbiter report submission failed (HTTP ${response.status})`);
  return { status: response.status, responseText };
}

// src/cli-core.ts
var EXIT_OK = 0;
var EXIT_INTERNAL = 1;
var EXIT_INVALID_INPUT = 2;
var EXIT_UPSTREAM = 3;
var USAGE = `usage: hokusai-scan <label|extract|scan|report> [options]

label    --repo <path> --integration-branch <name> [--integration-mode promotion|direct]
         [--github-repo <owner/name>]
         [--pr-url <url>] [--horizons 14,30,60] [--max-prs <n>] [--as-of <iso>]
         [--no-links] [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
extract  --repo <path> --pr <n> [--base-ref <ref>] [--config-path <path>]
         [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
scan     --repo <path> --integration-branch <name> --pr <n> [common options]
report   [<github-url|owner/name>] [--repo <path>] [--integration-branch <name>]
         [--integration-mode promotion|direct]
         [--lookback-days <n>] [--max-prs <n>] [--horizons 14,30,60]
         [--state-dir <path>] [--contribute [--dry-run]]

shadow-score     --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--threshold 0.5]
                 [--bootstrap-days 30] [--max-prs 200]
shadow-backfill  --data-dir <path> --integration-branch <name> [--repo <path>]
                 [--github-repo <owner/name>] [--horizon-days 30]
shadow-report    --data-dir <path> [--window-days 30] [--horizon-days 30]
                 (shadow commands always exit 0 and print SHADOW_* lines)

corpus-enumerate --manifest <cohort.json> --cache-dir <path> [--repo <owner/name>]
                 (HOK-3022 corpus; prs.jsonl in the cache holds raw titles/bodies and stays local)
corpus-label     --manifest <cohort.json> --cache-dir <path> [--repo <owner/name>] [--as-of <iso>]
                 (S2 v1.1.0 rows per enumerated PR \xD7 14/30/60 into <cache>/<repo>/s2.jsonl)
corpus-corrective --manifest <cohort.json> --cache-dir <path> [--repo <owner/name>] [--as-of <iso>]
                 (corrective-rework candidates, repair pairs and rows per labelled repo; HOK-3267)
corpus-report    --manifest <cohort.json> --cache-dir <path> --as-of <iso> --out <dir> [--notes <flag-notes.json>]
                 (per repo \xD7 horizon sanity report, flags and run manifest from persisted outputs; HOK-3268)
corpus-calibration-sample --manifest <cohort.json> --cache-dir <path> --plan <plan.json> --exclude-slice <slice.json> --out <private dir>
                 (stratified calibration sample, evaluation slice excluded; HOK-3269)
corpus-calibration-evidence --manifest <cohort.json> --cache-dir <path> --sample <private dir>
                 (per-item diffs, candidate fixes and related later PRs, plus the blank human-audit sheet; HOK-3269)
corpus-calibration-score --sample <private dir>
                 (precision, recall, kappa and cause distribution from the model and human-audit sheets; HOK-3269)
`;
var OPTION_SPEC = {
  "repo": { type: "string" },
  "integration-branch": { type: "string" },
  "integration-mode": { type: "string" },
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
  "lookback-days": { type: "string" },
  "max-lookback-days": { type: "string" },
  "static-analysis": { type: "string" },
  "state-dir": { type: "string" },
  "no-state": { type: "boolean" },
  "attribution-config": { type: "string" },
  "contribute": { type: "boolean" },
  "dry-run": { type: "boolean" },
  "api-key-env": { type: "string" },
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
    if (command.startsWith("shadow-")) {
      const result = runShadowCli(command, rest, {
        log: (line) => io.writeStdout(`${line}
`),
        cwd: process.cwd()
      });
      return { exitCode: result.exitCode, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (command.startsWith("corpus-")) {
      const result = runCorpusCli(command, rest, { writeStdout: io.writeStdout, writeStderr: io.writeStderr, cwd: process.cwd() });
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
      ({ output, rowCount } = runLabel2(context, {
        repoDir,
        offline,
        asOf,
        integrationBranch: validateIntegrationBranch(values["integration-branch"], validateIntegrationMode(values["integration-mode"])),
        integrationMode: validateIntegrationMode(values["integration-mode"]),
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
        integrationBranch: validateIntegrationBranch(values["integration-branch"], validateIntegrationMode(values["integration-mode"])),
        integrationMode: validateIntegrationMode(values["integration-mode"]),
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
      mkdirSync4(dirname3(outputPath), { recursive: true });
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
async function runScanCliAsync(argv, io) {
  if (argv[0] !== "report") return runScanCli(argv, io);
  return runReportCli(argv.slice(1), io);
}
async function runReportCli(argv, io) {
  const context = { io, debug: false, token: void 0, summaryLines: [] };
  const diag = makeDiagnostics(context);
  let temporaryRepo = null;
  try {
    let parsed;
    try {
      parsed = parseArgs3({ args: [...argv], options: OPTION_SPEC, strict: true, allowPositionals: true });
    } catch (error) {
      throw new ScanInputError(error.message);
    }
    const values = parsed.values;
    if (values.help === true) {
      io.writeStderr(USAGE);
      return { exitCode: EXIT_OK, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (parsed.positionals.length > 1) throw new ScanInputError("report accepts at most one repository URL or owner/name positional");
    const tokenName = validateTokenEnvName(values["token-env"]);
    context.token = io.env[tokenName];
    const explicitRepo = validateGithubRepo(values["github-repo"]);
    const targetFromPositional = parseGithubTarget(parsed.positionals[0]);
    if (explicitRepo && targetFromPositional && (explicitRepo.owner !== targetFromPositional.owner || explicitRepo.repo !== targetFromPositional.repo)) {
      throw new ScanInputError("positional repository and --github-repo must match");
    }
    const github = explicitRepo ?? targetFromPositional;
    const offline = values.offline === true;
    let repoDir;
    if (values.repo) repoDir = resolveRepoDir(values.repo);
    else if (!offline && targetFromPositional?.url) {
      temporaryRepo = mkdtempSync3(join10(tmpdir3(), "hokusai-report-"));
      const result = execArgvCommand("git", ["clone", "--no-tags", targetFromPositional.url, temporaryRepo], { env: context.token ? { ...process.env, GH_TOKEN: context.token } : process.env });
      if (result.exitCode !== 0) throw new ScanUpstreamError("Unable to clone the public repository");
      repoDir = temporaryRepo;
    } else {
      throw new ScanInputError("report requires --repo <local checkout> or a public GitHub URL");
    }
    const resolvedGithub = requireGithubRepo(context, repoDir, github ?? void 0);
    const asOf = validateAsOf(values["as-of"]) ?? /* @__PURE__ */ new Date();
    const scanGithub = offline ? createOfflineScanGitHubClient() : createDefaultScanGitHubClient({ ...resolvedGithub, repoDir, ...context.token ? { token: context.token } : {} });
    const reportDeps = buildLabellerWorld(context, { repoDir, offline, asOf, integrationBranch: "develop", githubRepo: resolvedGithub });
    if (offline) reportDeps.deps.github = createOfflineGitHubClient();
    const repoMetadata = offline ? { defaultBranch: values["integration-branch"] ?? "", private: false } : await scanGithub.getRepo();
    const explicitBranch = values["integration-branch"];
    const explicitMode = values["integration-mode"] === void 0 ? void 0 : validateIntegrationMode(values["integration-mode"]);
    let integrationBranch;
    let integrationMode;
    if (explicitBranch) {
      integrationMode = explicitMode ?? "promotion";
      integrationBranch = validateIntegrationBranch(explicitBranch, integrationMode);
    } else {
      const log = reportDeps.deps.runGit(["log", "--first-parent", "-200", "--pretty=format:%s", repoMetadata.defaultBranch]);
      if (log.exitCode !== 0) throw new ScanInputError("cannot read the repository default branch history");
      const resolved = resolveIntegrationBranch({
        defaultBranch: repoMetadata.defaultBranch,
        recentFirstParentSubjects: log.stdout.split("\n"),
        explicitMode: explicitMode ?? null,
        headRefLookup: (number) => {
          const result = execArgvCommand("gh", ["pr", "view", String(number), "--json", "headRefName"], { cwd: repoDir, ...context.token ? { env: { ...process.env, GH_TOKEN: context.token } } : {} });
          if (result.exitCode !== 0) return null;
          try {
            return JSON.parse(result.stdout).headRefName ?? null;
          } catch {
            return null;
          }
        },
        remoteBranchExists: (ref3) => execArgvCommand("git", ["-C", repoDir, "ls-remote", "--exit-code", "--heads", "origin", ref3]).exitCode === 0
      });
      integrationBranch = resolved.branch;
      integrationMode = resolved.mode;
    }
    if (temporaryRepo) {
      const fetched = execArgvCommand("git", ["-C", repoDir, "fetch", "--no-tags", "origin", integrationBranch], { env: context.token ? { ...process.env, GH_TOKEN: context.token } : process.env });
      if (fetched.exitCode !== 0) throw new ScanUpstreamError("Unable to fetch the integration branch");
      const checkout = execArgvCommand("git", ["-C", repoDir, "checkout", "-B", integrationBranch, "FETCH_HEAD"]);
      if (checkout.exitCode !== 0) throw new ScanInputError("unable to check out the integration branch");
    }
    const lookback = parsePositiveInteger(values["lookback-days"], 180, "--lookback-days", 3650);
    const maxLookback = parsePositiveInteger(values["max-lookback-days"], 730, "--max-lookback-days", 3650);
    const maxPrs = parsePositiveInteger(values["max-prs"], 500, "--max-prs", 2e4);
    const horizons = validateHorizons(values.horizons);
    const staticAnalysis = values["static-analysis"] === void 0 ? "off" : values["static-analysis"];
    if (staticAnalysis !== "off" && staticAnalysis !== "committed") throw new ScanInputError("--static-analysis must be off or committed");
    let attributionConfig = {};
    const configPath = values["attribution-config"];
    if (configPath) {
      try {
        attributionConfig = JSON.parse(readFileSync5(resolve5(configPath), "utf8"));
      } catch {
        throw new ScanInputError("--attribution-config must point to valid JSON");
      }
    }
    try {
      resolveAttributionConfig(attributionConfig);
    } catch (error) {
      if (error instanceof AttributionConfigError) throw new ScanInputError(error.message);
      throw error;
    }
    const stateDir = values["state-dir"] ?? (values["no-state"] === true ? void 0 : join10(repoDir, ".git", "hokusai-scan", `${resolvedGithub.owner}__${resolvedGithub.repo}`));
    let saveState;
    const draft = await runReportScan({ ...resolvedGithub, repoDir, integrationBranch, integrationMode }, {
      runGit: reportDeps.deps.runGit,
      labeller: reportDeps.deps,
      github: scanGithub,
      now: () => asOf,
      onDiagnostic: (line) => io.writeStderr(`${line.startsWith("info:") || line.startsWith("warn:") || line.startsWith("error:") ? "" : "info: "}${line}
`)
    }, { lookbackDays: lookback, maxLookbackDays: maxLookback, maxPrs, horizons, attributionConfig, staticAnalysis, scannerVersion: "0.4.0", onStateSave: (save) => {
      saveState = save;
    }, ...stateDir ? { stateDir } : {} });
    const output = emitReport(draft);
    const outSpec = values.out ?? "-";
    const outputPath = outSpec === "-" ? null : resolve5(outSpec);
    if (values.contribute === true) {
      const built = buildContributionPayload(JSON.parse(output));
      if (values["dry-run"] === true) {
        if (outSpec === "-") io.writeStdout(built.body);
        else {
          mkdirSync4(dirname3(outputPath), { recursive: true });
          writeFileSync4(outputPath, built.body);
        }
      } else {
        const apiKeyName = validateTokenEnvName(values["api-key-env"] ?? "HOKUSAI_API_KEY");
        const apiKey = io.env[apiKeyName];
        if (!apiKey) throw new ScanInputError(`missing API key in environment variable ${apiKeyName}`);
        const transport = (input, init) => fetch(input, init);
        await submitReport(transport, built, { baseUrl: io.env.HOKUSAI_BASE_URL ?? "https://api.hokus.ai", apiKey });
        if (outSpec !== "-") {
          mkdirSync4(dirname3(outputPath), { recursive: true });
          writeFileSync4(outputPath, output);
        }
      }
    } else if (outSpec === "-") io.writeStdout(output);
    else {
      mkdirSync4(dirname3(outputPath), { recursive: true });
      writeFileSync4(outputPath, output);
    }
    try {
      saveState?.();
    } catch (error) {
      diag.warn(`could not save incremental state: ${error.message}`);
    }
    context.summaryLines.push(`report ${resolvedGithub.owner}/${resolvedGithub.repo}`, `PRs ${draft.prs.length}`, `lookback ${draft.scan.lookback_days} days`);
    return { exitCode: EXIT_OK, rowCount: draft.prs.length, outputPath, summaryLines: context.summaryLines };
  } catch (error) {
    if (error instanceof ScanInputError || error instanceof IntegrationBranchError) {
      diag.error(error.message);
      return { exitCode: EXIT_INVALID_INPUT, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    if (error instanceof ScanUpstreamError) {
      diag.error(error.message);
      return { exitCode: EXIT_UPSTREAM, rowCount: 0, outputPath: null, summaryLines: [] };
    }
    diag.error(`unexpected: ${error.message}`);
    return { exitCode: EXIT_INTERNAL, rowCount: 0, outputPath: null, summaryLines: [] };
  } finally {
    if (temporaryRepo) rmSync4(temporaryRepo, { recursive: true, force: true });
  }
}
function parsePositiveInteger(value, fallback, name, maximum) {
  if (value === void 0 || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new ScanInputError(`${name} must be an integer from 1 to ${maximum}`);
  return parsed;
}
function parseGithubTarget(value) {
  if (!value) return null;
  const match = value.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\.git)?\/?$/i);
  if (!match || match[2] === "." || match[2] === "..") throw new ScanInputError("repository must be a GitHub URL or owner/name");
  return { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}.git` };
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
    integrationMode: params.integrationMode ?? "promotion",
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
function runLabel2(context, params) {
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
async function main() {
  const actionEnv = {
    input: (name) => readActionInput(process.env, name),
    runnerTemp: process.env.RUNNER_TEMP,
    workspace: process.env.GITHUB_WORKSPACE
  };
  if (isShadowMode(actionEnv.input("mode"))) {
    const { argv: argv2 } = buildShadowActionArgv(actionEnv);
    await runScanCliAsync(argv2, {
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
  const result = await runScanCliAsync(argv, {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
    env
  });
  if (result.exitCode === 0) {
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, "output-path", result.outputPath ?? outputPath);
    writeGithubKeyValue(process.env.GITHUB_OUTPUT, "contract-version", scanContractVersion());
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
process.exitCode = await main();
