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
  if (actionFlagIsTrue(env.input("no-links"))) argv.push("--no-links");
  if (actionFlagIsTrue(env.input("offline"))) argv.push("--offline");
  if (actionFlagIsTrue(env.input("debug"))) argv.push("--debug");
  const requestedOut = env.input("output-path") ?? "hokusai-scan-output.jsonl";
  const outputPath = isAbsolute(requestedOut) ? requestedOut : join(env.runnerTemp ?? ".", requestedOut);
  argv.push("--out", outputPath);
  return { argv, outputPath };
}

// src/cli-core.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, statSync as statSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, resolve as resolve4 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

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
function definitionJsonSchema(definition, nullable) {
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
  return nullable ? { anyOf: [valueSchema, { type: "null" }] } : valueSchema;
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
function candidateFeatureValueJsonSchema(name, nullable = true) {
  return definitionJsonSchema(CANDIDATE_FEATURE_DEFINITIONS[name], nullable);
}

// ../core/src/arbiter-survival-label.ts
import { createHash } from "node:crypto";
var ARBITER_SURVIVAL_LABEL_SCHEMA_VERSION = "1.0.0";
var SUBSTANTIAL_REWRITE_THRESHOLD = 0.5;
var HORIZONS = [14, 30, 60];
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
function canonicalSerialize(label) {
  return JSON.stringify(canonicalize(label));
}
function canonicalHash(label) {
  return createHash("sha256").update(canonicalSerialize(label), "utf-8").digest("hex");
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
  const label = {
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
    label.owner_correction = input.owner_correction;
  }
  return label;
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
function findForbiddenKeys(obj, path2 = "$") {
  const errors = [];
  if (!isPlainObject2(obj)) {
    return errors;
  }
  for (const [key, value] of Object.entries(obj)) {
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
function normalizeHokusaiLanguage(label) {
  if (typeof label !== "string") {
    return "unknown";
  }
  return HOKUSAI_LANGUAGE_BY_LABEL[label.trim().toLowerCase()] ?? "unknown";
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
  codex: "codex/1",
  native: "native/1",
  pi: "pi/1"
});

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
function requireObject(value, label) {
  if (!isPlainObject3(value)) fail(`${label} must be an object`);
  return value;
}
function requireEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function requireId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${label} must be an identifier matching ${ID_PATTERN}`);
  }
  return value;
}
function optionalId(value, label) {
  return value === void 0 ? void 0 : requireId(value, label);
}
function requirePattern(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} must match ${pattern}`);
  }
  return value;
}
function requireModel(value, label) {
  const model = requirePattern(value, MODEL_PATTERN, label);
  if (model.includes("..") || model.includes("//")) {
    fail(`${label} must not contain path-like sequences`);
  }
  return model;
}
function requireTimestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) fail(`${label} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
  if (!roundTrips) fail(`${label} is not a real calendar time`, "invalid_timestamp");
  return value;
}
function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}
function requireCount(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`, "usage_out_of_range");
  }
  return value;
}
function requireNullableCount(value, label) {
  return value === null ? null : requireCount(value, label);
}
function requireNullableUsd(value, label) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be null or a finite non-negative number`, "usage_out_of_range");
  }
  return value;
}
function requireDiagnostics(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  for (const [index, code] of value.entries()) {
    requireEnum(code, TASK_COST_DIAGNOSTIC_CODES, `${label}[${index}]`);
  }
}
function requireStringArray(value, label, item) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => item(entry, `${label}[${index}]`));
}
function requireTokenUsage(value, label) {
  const record = requireObject(value, label);
  const usage = {};
  for (const field of TASK_COST_TOKEN_FIELDS) {
    if (!(field in record)) fail(`${label}.${field} is required (use null for missing)`);
    usage[field] = requireNullableCount(record[field], `${label}.${field}`);
  }
  return usage;
}
function checkSchemaVersion(record, expected, label) {
  const version = record.schema_version;
  if (typeof version !== "string") fail(`${label}.schema_version is required`);
  if (version !== expected) {
    fail(`${label}.schema_version "${version}" is not supported (expected ${expected})`, "unknown_schema_version");
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
  const costSource = requireEnum(record.cost_source, TASK_COST_EVENT_SOURCES, "event.cost_source");
  const expectedSource = actual !== null ? "provider_reported" : estimated !== null ? "local_estimate" : "none";
  if (costSource !== expectedSource) {
    fail(`event.cost_source is "${costSource}" but the cost fields imply "${expectedSource}"`);
  }
  const basis = requireEnum(record.cost_basis, TASK_COST_BASES, "event.cost_basis");
  if (basis === "subscription" && actual !== null) {
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
    const label = `summary.model_segments[${index}]`;
    const segment = requireObject(entry, label);
    requireModel(segment.model, `${label}.model`);
    requireCount(segment.turn_count, `${label}.turn_count`);
    requireTokenUsage(segment.usage, `${label}.usage`);
    requireNullableUsd(segment.actual_cost_usd, `${label}.actual_cost_usd`);
    requireNullableUsd(segment.estimated_cost_usd, `${label}.estimated_cost_usd`);
    requireEnum(segment.cost_source, TASK_COST_SOURCES, `${label}.cost_source`);
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
  for (const [index, event16] of record.events.entries()) {
    validateTaskCostEventV1(event16);
    const label = `ledger.events[${index}]`;
    if (event16.session_id !== sessionId) fail(`${label}.session_id must match ledger.session_id`);
    if (event16.harness !== harness) fail(`${label}.harness must match ledger.harness`);
    if (event16.provider_contract_version !== providerContract) {
      fail(`${label}.provider_contract_version must match ledger.provider_contract_version`);
    }
    seenTaskIds.add(event16.task_id);
  }
  const expected = [...seenTaskIds].sort();
  if (taskIds.length !== expected.length || taskIds.some((id, index) => id !== expected[index])) {
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
function eventFactory(profile16) {
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
      harness: profile16.harness,
      ...profile16.harnessVersion !== void 0 ? { harness_version: profile16.harnessVersion } : {},
      provider_contract_version: profile16.providerContractVersion,
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
function ledgerFor(profile16, events16, sessionId = FIXTURE_SESSION_ID) {
  const first = events16[0];
  const last = events16[events16.length - 1];
  if (!first || !last) throw new Error("ledgerFor requires at least one event");
  return {
    schema_version: TASK_COST_LEDGER_SCHEMA_VERSION,
    harness: profile16.harness,
    ...profile16.harnessVersion !== void 0 ? { harness_version: profile16.harnessVersion } : {},
    provider_contract_version: profile16.providerContractVersion,
    session_id: sessionId,
    task_ids: [...new Set(events16.map((event16) => event16.task_id))].sort(),
    opened_at: first.observed_at,
    closed_at: last.observed_at,
    truncated: false,
    event_count: events16.length,
    events: [...events16]
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
  providerContractVersion: "codex/1",
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
      provider_contract_version: "codex/1",
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

// ../core/src/fixtures/task-cost/codex-simple.ts
var profile8 = {
  harness: "codex",
  providerContractVersion: "codex/1",
  harnessVersion: "0.50.0"
};
var event8 = eventFactory(profile8);
var events8 = [
  event8({ n: 1, model: "gpt-5-codex", usage: tokens(2e3, 600, 0, 0, 150), estimated: 0.01 }),
  event8({ n: 2, model: "gpt-5-codex", usage: tokens(3e3, 900, 0, 0, 300), estimated: 0.01575 })
];
var codexSimpleFixture = {
  name: "codex-simple",
  description: "OpenAI-priced happy path; Codex reports no charge, so the estimate stands.",
  events: events8,
  ledger: ledgerFor(profile8, events8),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/1",
      models: ["gpt-5-codex"],
      model_segments: [
        {
          model: "gpt-5-codex",
          turn_count: 2,
          usage: tokens(5e3, 1500, 0, 0, 450),
          actual_cost_usd: null,
          estimated_cost_usd: 0.02575,
          cost_source: "local_estimate"
        }
      ],
      turn_count: 2,
      turns_truncated: false,
      usage: tokens(5e3, 1500, 0, 0, 450),
      actual_cost_usd: null,
      estimated_cost_usd: 0.02575,
      total_cost_usd: 0.02575,
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
var profile9 = {
  harness: "codex",
  providerContractVersion: "codex/1",
  harnessVersion: "0.50.0"
};
var event9 = eventFactory(profile9);
var events9 = [
  event9({ n: 1, model: "gpt-5", usage: tokens(1e3, 400, 0, 0, 0), estimated: 525e-5 }),
  event9({ n: 2, model: "codex-unlisted-model", usage: tokens(2e3, 700, 0, 0, 0) })
];
var codexUnknownPricingFixture = {
  name: "codex-unknown-pricing",
  description: "A model missing from the price table yields a null cost, partial coverage, and no total.",
  events: events9,
  ledger: ledgerFor(profile9, events9),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/1",
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
var profile10 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event10 = eventFactory(profile10);
var events10 = [
  event10({ n: 1, task: "task-0001", model: "claude-sonnet-5", usage: tokens(1e3, 400, 0, 0, 0), estimated: 9e-3 }),
  event10({ n: 2, task: "task-0002", model: "claude-sonnet-5", usage: tokens(4e3, 1e3, 0, 0, 0), estimated: 0.027 }),
  event10({ n: 3, task: "task-0001", model: "claude-sonnet-5", usage: tokens(2e3, 600, 0, 0, 0), estimated: 0.015 }),
  event10({ n: 4, task: "task-0002", model: "claude-sonnet-5", usage: tokens(1500, 500, 0, 0, 0), estimated: 0.012 }),
  event10({ n: 5, task: "task-0001", model: "claude-sonnet-5", usage: tokens(500, 200, 0, 0, 0), estimated: 45e-4 }),
  event10({ n: 6, task: "task-0002", model: "claude-sonnet-5", usage: tokens(800, 300, 0, 0, 0), estimated: 69e-4 })
];
var concurrentTasksFixture = {
  name: "concurrent-tasks",
  description: "One session, two interleaved tasks: one ledger, two disjoint summaries.",
  events: events10,
  ledger: ledgerFor(profile10, events10),
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
var profile11 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event11 = eventFactory(profile11);
var events11 = [
  event11({ n: 1, model: "claude-sonnet-5", usage: tokens(2e3, 1e3, 0, 0, 0), actual: 0.0212, estimated: 0.021 }),
  event11({ n: 2, model: "claude-sonnet-5", usage: tokens(1e3, 200, 0, 0, 0), actual: 61e-4, estimated: 6e-3 }),
  event11({ n: 3, model: "gpt-5", usage: tokens(3e3, 1e3, 0, 0, 0), estimated: 0.01375 })
];
var mixedModelFixture = {
  name: "mixed-model",
  description: "Anthropic (charged) then OpenAI (estimated) turns: cost_source mixed, two model segments.",
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
var profile12 = {
  harness: "native",
  providerContractVersion: "native/1",
  harnessVersion: "1.0.0"
};
var event12 = eventFactory(profile12);
var events12 = [
  event12({ n: 1, model: "claude-haiku-4-5", usage: tokens(1200, 300, 0, 0, 0), estimated: 27e-4 }),
  event12({ n: 2, model: "claude-haiku-4-5", usage: tokens(0, 0, 0, 0, 0), estimated: 0 })
];
var nativeSimpleFixture = {
  name: "native-simple",
  description: "Native harness: known-zero counters and a known-zero turn stay distinct from missing.",
  events: events12,
  ledger: ledgerFor(profile12, events12),
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
var profile13 = {
  harness: "codex",
  providerContractVersion: "codex/1",
  harnessVersion: "0.50.0"
};
var event13 = eventFactory(profile13);
var events13 = [
  event13({ n: 1, model: "gpt-5", usage: tokens(1e3, null, 0, 0, null) }),
  event13({ n: 2, model: "gpt-5", usage: tokens(2e3, 500, 0, 0, 0), estimated: 75e-4 })
];
var partialUsageFixture = {
  name: "partial-usage",
  description: "Missing (null) output tokens stay null, mark usage partial, and block pricing for that turn.",
  events: events13,
  ledger: ledgerFor(profile13, events13),
  expectedSummaries: [
    {
      schema_version: "task_cost_summary/v1",
      task_id: "task-0001",
      session_ids: ["session-0001"],
      harness: "codex",
      harness_version: "0.50.0",
      provider_contract_version: "codex/1",
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
var profile14 = {
  harness: "pi",
  providerContractVersion: "pi/1",
  harnessVersion: "0.9.0"
};
var event14 = eventFactory(profile14);
var events14 = [
  event14({ n: 1, model: "gemini-2.5-flash", usage: tokens(1e4, 2e3, 0, 0, 0), estimated: 8e-3 }),
  event14({
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
  events: events14,
  ledger: ledgerFor(profile14, events14),
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
var profile15 = {
  harness: "claude-code",
  providerContractVersion: "claude-code/1",
  harnessVersion: "2.1.0"
};
var event15 = eventFactory(profile15);
var events15 = [
  event15({ n: 1, model: "claude-opus-4-8", usage: tokens(2500, 900, 12e3, 3e3, 200), actual: 0.0601, estimated: 0.05975 }),
  event15({ n: 2, model: "claude-opus-4-8", usage: tokens(1200, 700, 15e3, 0, 100), actual: 0.0312, estimated: 0.031 }),
  event15({ n: 3, model: "claude-sonnet-4-6", usage: tokens(3e3, 1e3, 2e4, 500, 0), actual: 0.032, estimated: 0.031875 })
];
var wavemillParityFixture = {
  name: "wavemill-parity",
  description: "Multi-model, cache-tier session with provider-reported cost; matches a real Wavemill golden.",
  events: events15,
  ledger: ledgerFor(profile15, events15),
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
function normalizeRepoPath(path2) {
  const normalized = path2.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  return normalized;
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
    const match = enumerated.find((ref) => ref.prNumber === prNumber);
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
function missingLabel(pr, target, deps, horizon, reason, options = {}) {
  return buildArbiterSurvivalLabel({
    prUrl: pr.prUrl,
    horizon_days: horizon,
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
      (ref) => ref.createdAtEpoch > pr.mergedAtEpoch && ref.createdAtEpoch <= cutoffEpoch
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
  for (const horizon of horizons) {
    const cutoffEpoch = pr.mergedAtEpoch + horizon * DAY_SECONDS;
    if (cutoffEpoch > nowEpoch) {
      labels.push(missingLabel(pr, target, deps, horizon, "missing_horizon", {
        lineRanges: substrate?.lineRanges
      }));
      continue;
    }
    if (!substrate) {
      labels.push(missingLabel(pr, target, deps, horizon, "inaccessible_history"));
      continue;
    }
    if (substrate.totalLines === 0) {
      labels.push(missingLabel(pr, target, deps, horizon, "insufficient_line_range_substrate"));
      continue;
    }
    const terminalSha = resolveHorizonTerminal(deps, target, cutoffEpoch);
    if (!terminalSha) {
      labels.push(missingLabel(pr, target, deps, horizon, "inaccessible_history", {
        lineRanges: substrate.lineRanges
      }));
      continue;
    }
    const analysis = analyseForward(deps, pr, substrate, terminalSha);
    if (!analysis) {
      labels.push(missingLabel(pr, target, deps, horizon, "inaccessible_history", {
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
      horizon_days: horizon,
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
  for (const label of labels) {
    const key = String(label.horizon_days);
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
    const outcome = label.outcome.report_outcome;
    if (outcome === null) bucket.missing += 1;
    else bucket[outcome] += 1;
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
        const events16 = JSON.parse(result.stdout);
        return events16.filter((event16) => event16.event === "cross-referenced" && event16.created_at).map((event16) => ({
          createdAtEpoch: Math.floor(Date.parse(event16.created_at) / 1e3),
          url: event16.source?.issue?.html_url ?? ""
        })).filter((ref) => Number.isFinite(ref.createdAtEpoch));
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
  return labels.map((label) => `${JSON.stringify(label)}
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
function isAncestor(runGit3, sha, ref) {
  try {
    const result = runGit3(["merge-base", "--is-ancestor", sha, ref]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
function discoverMerges(opts) {
  const { runGit: runGit3, ref, cursor, bootstrapDays, now, maxPrs } = opts;
  const merges = [];
  let cursorReset = false;
  let useBootstrapWindow = cursor === null;
  if (cursor !== null && !isAncestor(runGit3, cursor, ref)) {
    cursorReset = true;
    useBootstrapWindow = true;
  }
  const cutoffEpoch = Math.floor(now().getTime() / 1e3) - bootstrapDays * 86400;
  const format = "%H%x09%P%x09%ct%x09%s";
  const args = useBootstrapWindow ? [
    "log",
    "--first-parent",
    "--reverse",
    `--pretty=format:${format}`,
    `--since=${new Date(cutoffEpoch * 1e3).toISOString()}`,
    ref
  ] : ["log", "--first-parent", "--reverse", `--pretty=format:${format}`, `${cursor}..${ref}`];
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
function writeReport(dir, date, serialized) {
  const reportsDir = path.join(dir, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  writeFileAtomic(path.join(reportsDir, `${date}.json`), serialized);
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
          appendJsonl(scoresFile, rows, validateShadowScoreRow);
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
    label = labelMergedPr
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
        const labelResults = label(target, deps, prRef, {
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
      scorer_id: lastScore ? lastScore.scorer_id : "unknown",
      scorer_version: lastScore ? lastScore.scorer_version : "unknown",
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
  const date = now().toISOString().slice(0, 10);
  writeReport(dataDir, date, serialized);
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
  const horizon = HORIZONS.find((h) => h === value);
  if (horizon === void 0) {
    throw new ShadowError("INVALID_ARG");
  }
  return horizon;
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

// src/cli-core.ts
var EXIT_OK = 0;
var EXIT_INTERNAL = 1;
var EXIT_INVALID_INPUT = 2;
var EXIT_UPSTREAM = 3;
var USAGE = `usage: hokusai-scan <label|extract|scan> [options]

label    --repo <path> --integration-branch <name> [--github-repo <owner/name>]
         [--pr-url <url>] [--horizons 14,30,60] [--max-prs <n>] [--as-of <iso>]
         [--no-links] [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
extract  --repo <path> --pr <n> [--base-ref <ref>] [--config-path <path>]
         [--offline] [--token-env <NAME>] [--out <path|->] [--debug]
scan     --repo <path> --integration-branch <name> --pr <n> [common options]

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
      ({ values } = parseArgs2({ args: [...rest], options: OPTION_SPEC, strict: true, allowPositionals: false }));
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
      outputPath = resolve4(outSpec);
      mkdirSync2(dirname(outputPath), { recursive: true });
      writeFileSync2(outputPath, output);
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
  const repoDir = resolve4(validateRepoDir(raw));
  if (!existsSync4(repoDir) || !statSync4(repoDir).isDirectory()) {
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
  for (const [horizon, bucket] of Object.entries(summary.horizons)) {
    context.summaryLines.push(
      `${horizon}d: ${bucket.rows} rows, ${bucket.missing} missing, survival_rate ${bucket.survival_rate ?? "n/a"}`
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
process.exitCode = main();
