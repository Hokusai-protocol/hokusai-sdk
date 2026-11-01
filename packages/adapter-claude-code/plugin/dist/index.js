// src/index.ts
import { mkdir as mkdir4, readFile as readFile3, rm as rm5, writeFile as writeFile4 } from "node:fs/promises";
import path3 from "node:path";

// ../core/src/anonymization.ts
import { createHmac } from "node:crypto";
var defaultPatterns = [
  {
    label: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    label: "token",
    pattern: /\b(?:sk|tok)-[A-Za-z0-9]{8,}\b/g
  }
];
var SECRET_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bxoxb-[A-Za-z0-9-]+\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g
];
var TOKEN_PATTERNS = [
  /\btok-[A-Za-z0-9]{8,}\b/g,
  /\bBearer [A-Za-z0-9._-]{10,}\b/g,
  /^Authorization:\s+[^\n]+$/gm
];
var CREDENTIAL_PATTERNS = [
  /\bpassword[=: ]+\S+\b/gi,
  /\bpasswd[=: ]+\S+\b/gi,
  /\bapi[_-]?key[=: ]+\S+\b/gi,
  /\bprivate[_-]?key[=: ]+\S+\b/gi
];
var EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
var URL_PATTERN = /https?:\/\/[^\s"']+/g;
var HOSTNAME_PATTERN = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}\b/gi;
var CODE_PATTERNS = [
  /```[\s\S]*?```/g,
  /(?:^|\n)(?: {4,}|\t).*(?:\n(?: {4,}|\t).*)*/g
];
var LOG_PATTERNS = [
  /^(?:\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?\s+.*|(?:ERROR|WARN|INFO|DEBUG|TRACE)\b.*)$/gm
];
var DEFAULT_REDACTION_CONFIG = {
  mode: "conservative",
  salt: "hokusai-default-redaction-salt",
  secret: true,
  token: true,
  credential: true,
  email: true,
  url: true,
  hostname: true,
  org: true,
  id: true,
  code: true,
  log: true,
  knownNames: [],
  customRules: []
};
function normalizeSensitiveValue(value) {
  return value.toLowerCase().trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function categoryEnabled(config, category) {
  if ((category === "code" || category === "log") && config.mode !== "conservative") {
    return false;
  }
  return config[category];
}
function normalizeConfig(config) {
  return {
    mode: config.mode ?? "conservative",
    salt: config.salt,
    secret: config.secret ?? DEFAULT_REDACTION_CONFIG.secret ?? true,
    token: config.token ?? DEFAULT_REDACTION_CONFIG.token ?? true,
    credential: config.credential ?? DEFAULT_REDACTION_CONFIG.credential ?? true,
    email: config.email ?? DEFAULT_REDACTION_CONFIG.email ?? true,
    url: config.url ?? DEFAULT_REDACTION_CONFIG.url ?? true,
    hostname: config.hostname ?? DEFAULT_REDACTION_CONFIG.hostname ?? true,
    org: config.org ?? DEFAULT_REDACTION_CONFIG.org ?? true,
    id: config.id ?? DEFAULT_REDACTION_CONFIG.id ?? true,
    code: config.code ?? DEFAULT_REDACTION_CONFIG.code ?? true,
    log: config.log ?? DEFAULT_REDACTION_CONFIG.log ?? true,
    knownNames: [...config.knownNames ?? DEFAULT_REDACTION_CONFIG.knownNames ?? []],
    customRules: [...config.customRules ?? DEFAULT_REDACTION_CONFIG.customRules ?? []]
  };
}
function buildOrgRules(knownNames) {
  return [...knownNames].filter((name) => name.trim().length > 0).sort((left, right) => right.length - left.length).map((name) => ({
    category: "org",
    pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi")
  }));
}
function buildCustomRules(customRules) {
  return customRules.map((rule) => ({
    category: rule.category,
    pattern: new RegExp(rule.pattern.source, rule.pattern.flags)
  }));
}
function buildRules(config) {
  return [
    ...SECRET_PATTERNS.map((pattern) => ({ category: "secret", pattern })),
    ...TOKEN_PATTERNS.map((pattern) => ({ category: "token", pattern })),
    ...CREDENTIAL_PATTERNS.map((pattern) => ({
      category: "credential",
      pattern
    })),
    { category: "email", pattern: EMAIL_PATTERN },
    { category: "url", pattern: URL_PATTERN },
    { category: "hostname", pattern: HOSTNAME_PATTERN },
    ...buildOrgRules(config.knownNames),
    ...buildCustomRules(config.customRules),
    ...CODE_PATTERNS.map((pattern) => ({ category: "code", pattern })),
    ...LOG_PATTERNS.map((pattern) => ({ category: "log", pattern }))
  ];
}
function detectPattern(text, patterns) {
  return patterns.some((pattern) => {
    const copy = new RegExp(pattern.source, pattern.flags);
    copy.lastIndex = 0;
    return copy.test(text);
  });
}
function aggregateSummary(redactions) {
  const counts = /* @__PURE__ */ new Map();
  for (const redaction of redactions) {
    counts.set(redaction.category, (counts.get(redaction.category) ?? 0) + redaction.count);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}
function makePlaceholder(category, value, salt) {
  const digest = createHmac("sha256", salt).update(normalizeSensitiveValue(value)).digest("hex").slice(0, 8);
  return `${category.toUpperCase()}_${digest}`;
}
function redact(input, config) {
  if (typeof input !== "string") {
    throw new TypeError("Expected input to be a string.");
  }
  if (typeof config?.salt !== "string" || config.salt.trim().length === 0) {
    throw new TypeError("Expected redaction salt to be a non-empty string.");
  }
  const normalizedConfig = normalizeConfig(config);
  const placeholderByValue = /* @__PURE__ */ new Map();
  const redactionCounts = /* @__PURE__ */ new Map();
  let output = input;
  for (const rule of buildRules(normalizedConfig)) {
    if (!categoryEnabled(normalizedConfig, rule.category)) {
      continue;
    }
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(pattern, (value) => {
      const normalizedValue = normalizeSensitiveValue(value);
      const placeholder = placeholderByValue.get(normalizedValue) ?? makePlaceholder(rule.category, value, normalizedConfig.salt);
      placeholderByValue.set(normalizedValue, placeholder);
      const existing = redactionCounts.get(placeholder);
      if (existing) {
        existing.count += 1;
      } else {
        redactionCounts.set(placeholder, {
          category: rule.category,
          placeholder,
          count: 1
        });
      }
      return placeholder;
    });
  }
  return {
    output,
    redactions: [...redactionCounts.values()],
    mode: normalizedConfig.mode
  };
}
function preview(input, config) {
  const result = redact(input, config);
  return {
    mode: result.mode,
    willSend: result.output,
    redactionSummary: aggregateSummary(result.redactions),
    hasRawCode: detectPattern(result.output, CODE_PATTERNS),
    hasRawLogs: detectPattern(result.output, LOG_PATTERNS)
  };
}
function sortKeys(payload) {
  if (Array.isArray(payload)) {
    return payload.map((entry) => sortKeys(entry));
  }
  if (payload && typeof payload === "object") {
    const entries = Object.entries(payload).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return Object.fromEntries(
      entries.map(([key, value]) => [key, sortKeys(value)])
    );
  }
  return payload;
}
function hashPayload(payload, salt) {
  if (typeof salt !== "string" || salt.trim().length === 0) {
    throw new TypeError("Expected payload hash salt to be a non-empty string.");
  }
  const serialized = typeof payload === "string" ? payload : JSON.stringify(sortKeys(payload));
  return createHmac("sha256", salt).update(serialized).digest("hex");
}
function anonymizeText(input, options = {}) {
  const patterns = options.patterns ?? defaultPatterns;
  const redactions = [];
  let text = input;
  for (const { label: label2, pattern } of patterns) {
    text = text.replace(pattern, (value) => {
      redactions.push({ label: label2, value });
      return options.defaultReplacement ?? `<redacted:${label2}>`;
    });
  }
  return { text, redactions };
}

// ../core/src/consent.ts
function isConsentGranted(consent, scope) {
  return consent.grantedScopes.includes(scope);
}
function canRoute(settings) {
  void settings;
  return true;
}
function canReportOutcome(settings) {
  return settings.outcomeReportingEnabled;
}
function resolveConsent(partial) {
  return {
    routingEnabled: true,
    outcomeReportingEnabled: partial?.outcomeReportingEnabled ?? false
  };
}

// ../core/src/routing-objective.ts
var DEFAULT_ROUTING_OBJECTIVE = "reliability";
var ALIASES = {
  speed: "speed",
  fast: "speed",
  fastest: "speed",
  latency: "speed",
  // backend enum, accepted for power users
  fastest_completion: "speed",
  cost: "cost",
  cheap: "cost",
  cheapest: "cost",
  lowest_cost: "cost",
  reliability: "reliability",
  reliable: "reliability",
  quality: "reliability",
  highest_reliability: "reliability"
};
var API_VALUES = {
  speed: "fastest_completion",
  cost: "lowest_cost",
  reliability: "highest_reliability"
};
function parseRoutingObjective(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  return ALIASES[value.trim().toLowerCase()];
}
function routingObjectiveToApiValue(objective) {
  return API_VALUES[objective];
}

// ../core/src/routing-inputs.ts
var ROUTING_ROLES = ["planner", "coder", "reviewer"];
var ROLE_POOL_FIELDS = {
  planner: "availablePlannerModels",
  coder: "availableCoderModels",
  reviewer: "availableReviewerModels"
};
var CSV_METADATA_KEYS = {
  availableModels: "available_models",
  availablePlannerModels: "available_planner_models",
  availableCoderModels: "available_coder_models",
  availableReviewerModels: "available_reviewer_models"
};
function normalizePool(value) {
  const seen = /* @__PURE__ */ new Set();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}
function parseCsvPool(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return void 0;
  }
  const entries = normalizePool(value.split(","));
  return entries.length > 0 ? entries : void 0;
}
function parseNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : void 0;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return void 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return void 0;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  return void 0;
}
function parseObjective(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const objective = parseRoutingObjective(value);
  return objective ? routingObjectiveToApiValue(objective) : void 0;
}
function effectiveRolePool(pools, role) {
  return pools[ROLE_POOL_FIELDS[role]] ?? pools.availableModels;
}
function classifyRoutingPools(pools) {
  const constrained = ROUTING_ROLES.map(
    (role) => effectiveRolePool(pools, role)
  ).filter((pool2) => pool2 !== void 0);
  if (constrained.length === 0) {
    return "ranking";
  }
  const singletons = constrained.filter(
    (pool2) => normalizePool(pool2).length < 2
  );
  if (singletons.length === 0) {
    return "ranking";
  }
  return singletons.length === constrained.length ? "non_ranking" : "partially_ranking";
}
function singletonRoles(pools) {
  return ROUTING_ROLES.filter((role) => {
    const pool2 = effectiveRolePool(pools, role);
    return pool2 !== void 0 && normalizePool(pool2).length < 2;
  });
}
function validateRoutingInput(routing, path4 = "routing") {
  if (routing === void 0) {
    return [];
  }
  const errors = [];
  const poolFields = [
    "availableModels",
    "availablePlannerModels",
    "availableCoderModels",
    "availableReviewerModels",
    "preferredModels"
  ];
  for (const field of poolFields) {
    const value = routing[field];
    if (value === void 0) {
      continue;
    }
    if (!Array.isArray(value)) {
      errors.push({
        path: `${path4}.${field}`,
        message: "Expected an array of model ids.",
        code: "invalid_type"
      });
      continue;
    }
    if (normalizePool(value).length === 0) {
      errors.push({
        path: `${path4}.${field}`,
        message: "Candidate pool must not be empty. Omit the field to leave the pool unconstrained.",
        code: "invalid_value"
      });
    }
  }
  return errors;
}
function resolveRoutingInput(options) {
  const typed = options.routing ?? {};
  const metadata = options.metadata ?? {};
  const deprecations = [];
  const fromCsv = (field) => {
    const key = CSV_METADATA_KEYS[field];
    const parsed = parseCsvPool(metadata[key]);
    if (parsed) {
      deprecations.push(
        `task.metadata.${key} is deprecated; set routing.${field} on the dispatch payload instead.`
      );
    }
    return parsed;
  };
  const resolvePool = (field) => {
    const typedValue = typed[field];
    if (typedValue !== void 0) {
      return normalizePool(typedValue);
    }
    return fromCsv(field);
  };
  const availableModels = resolvePool("availableModels") ?? normalizePool(options.fallbackModels);
  const pools = {
    availableModels,
    availablePlannerModels: resolvePool("availablePlannerModels"),
    availableCoderModels: resolvePool("availableCoderModels"),
    availableReviewerModels: resolvePool("availableReviewerModels")
  };
  const preferredModels = typed.preferredModels !== void 0 ? normalizePool(typed.preferredModels) : parseCsvPool(metadata.preferred_models);
  const routing = {
    ...pools,
    preferredModels,
    objective: typed.objective ?? parseObjective(metadata.objective),
    maxCostUsd: typed.maxCostUsd ?? parseNumber(metadata.max_cost_usd),
    maxLatencySeconds: typed.maxLatencySeconds ?? parseNumber(metadata.max_latency_seconds),
    prioritizeQuality: typed.prioritizeQuality ?? parseBoolean(metadata.prioritize_quality),
    prioritizeSpeed: typed.prioritizeSpeed ?? parseBoolean(metadata.prioritize_speed)
  };
  return {
    routing,
    fidelity: classifyRoutingPools(pools),
    deprecations
  };
}

// ../core/src/outcome.ts
var OUTCOME_REPORT_SCHEMA_VERSION = "1";
var COMPLETION_STATUSES = [
  "succeeded",
  "failed",
  "abandoned",
  "overridden",
  "partial"
];
var COARSE_BUCKETS = ["low", "medium", "high"];
var BUILD_TEST_STATUSES = ["passed", "failed", "skipped"];
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
var DEFAULT_OUTCOME_NOTES_REDACTION_SALT = "hokusai-outcome-notes";
var OutcomeReportBuildError = class extends Error {
  errors;
  constructor(message, errors) {
    super(message);
    this.name = "OutcomeReportBuildError";
    this.errors = errors;
  }
};
function validateOutcomeReport(input) {
  if (!isPlainObject(input)) {
    return [
      {
        path: "$",
        message: "Outcome report must be a non-null object."
      }
    ];
  }
  const errors = [];
  for (const key of Object.keys(input)) {
    if (!OUTCOME_REPORT_KEY_SET.has(key)) {
      errors.push({
        path: key,
        message: `Unknown field "${key}" is not allowed in outcome reports.`
      });
    }
  }
  validateLiteralString(
    input.schemaVersion,
    "schemaVersion",
    OUTCOME_REPORT_SCHEMA_VERSION,
    errors
  );
  validateNonEmptyString(input.correlationId, "correlationId", errors);
  validateNonEmptyString(input.recommendedModel, "recommendedModel", errors);
  validateNonEmptyString(input.actualModel, "actualModel", errors);
  validateBoolean(
    input.recommendationAccepted,
    "recommendationAccepted",
    errors
  );
  validateEnum(
    input.completionStatus,
    "completionStatus",
    COMPLETION_STATUSES,
    errors
  );
  if (input.userRating !== void 0) {
    validateIntegerInRange(input.userRating, "userRating", 1, 5, errors);
  }
  validateEnum(input.latencyBucket, "latencyBucket", COARSE_BUCKETS, errors);
  validateEnum(input.costBucket, "costBucket", COARSE_BUCKETS, errors);
  validateEnum(input.tokenBucket, "tokenBucket", COARSE_BUCKETS, errors);
  if (input.build !== void 0) {
    validateSummary(
      input.build,
      "build",
      BUILD_SUMMARY_KEY_SET,
      BUILD_TEST_STATUSES,
      errors
    );
  }
  if (input.test !== void 0) {
    validateSummary(
      input.test,
      "test",
      TEST_SUMMARY_KEY_SET,
      BUILD_TEST_STATUSES,
      errors
    );
  }
  if (input.notes !== void 0 && typeof input.notes !== "string") {
    errors.push({
      path: "notes",
      message: '"notes" must be a string.'
    });
  }
  if (input.extensions !== void 0) {
    validateExtensions(input.extensions, "extensions", errors);
  }
  return errors;
}
function buildOutcomeReport(input) {
  const candidate = createOutcomeCandidate(input);
  const errors = validateOutcomeReport(candidate);
  if (errors.length > 0) {
    throw new OutcomeReportBuildError(
      formatBuildErrorMessage(errors),
      errors
    );
  }
  return candidate;
}
function createOutcomeCandidate(input) {
  const candidate = {
    ...input,
    schemaVersion: OUTCOME_REPORT_SCHEMA_VERSION
  };
  delete candidate.redactionSalt;
  if (input.build !== void 0) {
    candidate.build = { ...input.build };
  } else {
    delete candidate.build;
  }
  if (input.test !== void 0) {
    candidate.test = { ...input.test };
  } else {
    delete candidate.test;
  }
  if (input.extensions !== void 0) {
    candidate.extensions = {
      version: input.extensions.version,
      data: isPlainObject(input.extensions.data) ? { ...input.extensions.data } : input.extensions.data
    };
  } else {
    delete candidate.extensions;
  }
  if (typeof input.notes === "string" && input.notes.length > 0) {
    candidate.notes = redact(input.notes, {
      salt: input.redactionSalt ?? DEFAULT_OUTCOME_NOTES_REDACTION_SALT,
      email: true,
      url: true,
      secret: true,
      token: true,
      credential: true,
      hostname: true,
      org: true,
      id: true,
      code: true,
      log: true,
      customRules: [
        {
          category: "id",
          pattern: /\/(?:Users|home|tmp|var|opt|srv|etc|private)\/[^\s]+/g
        }
      ]
    }).output;
  } else if (input.notes === void 0) {
    delete candidate.notes;
  }
  if (input.userRating === void 0) {
    delete candidate.userRating;
  }
  return candidate;
}
function validateSummary(value, path4, knownKeys, statuses, errors) {
  if (!isPlainObject(value)) {
    errors.push({
      path: path4,
      message: `"${path4}" must be an object.`
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      errors.push({
        path: `${path4}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path4}".`
      });
    }
  }
  validateEnum(value.status, `${path4}.status`, statuses, errors);
  if (value.failures !== void 0) {
    validateNonNegativeInteger(value.failures, `${path4}.failures`, errors);
  }
}
function validateExtensions(value, path4, errors) {
  if (!isPlainObject(value)) {
    errors.push({
      path: path4,
      message: `"${path4}" must be an object.`
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!OUTCOME_EXTENSION_KEY_SET.has(key)) {
      errors.push({
        path: `${path4}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path4}".`
      });
    }
  }
  validateNonEmptyString(value.version, `${path4}.version`, errors);
  if (!isPlainObject(value.data)) {
    errors.push({
      path: `${path4}.data`,
      message: `"${path4}.data" must be an object.`
    });
  }
}
function validateLiteralString(value, path4, expected, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({
      path: path4,
      message: `Expected "${path4}" to be "${expected}".`
    });
    return;
  }
  if (value !== expected) {
    errors.push({
      path: path4,
      message: `Unsupported schema version "${value}". Expected "${expected}".`
    });
  }
}
function validateNonEmptyString(value, path4, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({
      path: path4,
      message: `"${path4}" must be a non-empty string.`
    });
  }
}
function validateBoolean(value, path4, errors) {
  if (typeof value !== "boolean") {
    errors.push({
      path: path4,
      message: `"${path4}" must be a boolean.`
    });
  }
}
function validateEnum(value, path4, allowedValues, errors) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    errors.push({
      path: path4,
      message: `"${path4}" must be one of: ${allowedValues.join(", ")}.`
    });
  }
}
function validateIntegerInRange(value, path4, min, max, errors) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.push({
      path: path4,
      message: `"${path4}" must be an integer between ${min} and ${max}.`
    });
  }
}
function validateNonNegativeInteger(value, path4, errors) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push({
      path: path4,
      message: `"${path4}" must be a non-negative integer.`
    });
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatBuildErrorMessage(errors) {
  return `Invalid outcome report: ${errors.map(({ path: path4, message }) => `${path4 || "$"}: ${message}`).join("; ")}`;
}

// ../core/src/schemas.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function pushFieldError(errors, path4, message, code) {
  errors.push({ path: path4, message, code });
}
function validateNonEmptyString2(value, path4, errors) {
  if (typeof value !== "string") {
    pushFieldError(errors, path4, "Expected a string.", "invalid_type");
    return;
  }
  if (value.trim().length === 0) {
    pushFieldError(errors, path4, "Value must not be empty.", "required");
  }
}
function validateStringRecord(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      pushFieldError(
        errors,
        `${path4}.${key}`,
        "Expected a string value.",
        "invalid_type"
      );
    }
  }
}
function validateTaskInput(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.id, `${path4}.id`, errors);
  validateNonEmptyString2(value.prompt, `${path4}.prompt`, errors);
  if ("metadata" in value && value.metadata !== void 0) {
    validateStringRecord(value.metadata, `${path4}.metadata`, errors);
  }
}
function validateConfidence(value, path4, errors) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    pushFieldError(errors, path4, "Expected a number.", "invalid_type");
    return;
  }
  if (value < 0 || value > 1) {
    pushFieldError(
      errors,
      path4,
      "Expected a number between 0 and 1.",
      "invalid_value"
    );
  }
}
function validateRouteRecommendationAlternative(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.model, `${path4}.model`, errors);
  if ("reason" in value && value.reason !== void 0) {
    validateNonEmptyString2(value.reason, `${path4}.reason`, errors);
  }
  if ("confidence" in value && value.confidence !== void 0) {
    validateConfidence(value.confidence, `${path4}.confidence`, errors);
  }
}
function validateRouteRecommendation(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.model, `${path4}.model`, errors);
  if ("reason" in value && value.reason !== void 0) {
    validateNonEmptyString2(value.reason, `${path4}.reason`, errors);
  }
  if ("confidence" in value && value.confidence !== void 0) {
    validateConfidence(value.confidence, `${path4}.confidence`, errors);
  }
  if ("alternatives" in value && value.alternatives !== void 0) {
    if (!Array.isArray(value.alternatives)) {
      pushFieldError(
        errors,
        `${path4}.alternatives`,
        "Expected an array.",
        "invalid_type"
      );
      return;
    }
    value.alternatives.forEach((alternative, index) => {
      validateRouteRecommendationAlternative(
        alternative,
        `${path4}.alternatives.${index}`,
        errors
      );
    });
  }
}
function validateConsentSnapshot(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.subjectId, `${path4}.subjectId`, errors);
  if (!Array.isArray(value.grantedScopes)) {
    pushFieldError(
      errors,
      `${path4}.grantedScopes`,
      "Expected an array of consent scopes.",
      "invalid_type"
    );
    return;
  }
  value.grantedScopes.forEach((scope, index) => {
    validateNonEmptyString2(scope, `${path4}.grantedScopes.${index}`, errors);
  });
}
function validateModelSelection(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.id, `${path4}.id`, errors);
  validateNonEmptyString2(value.provider, `${path4}.provider`, errors);
  if (!Array.isArray(value.capabilities)) {
    pushFieldError(
      errors,
      `${path4}.capabilities`,
      "Expected an array of capabilities.",
      "invalid_type"
    );
    return;
  }
  value.capabilities.forEach((capability, index) => {
    validateNonEmptyString2(capability, `${path4}.capabilities.${index}`, errors);
  });
}
function validateCorrelationRecord(value, path4, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path4, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.taskId, `${path4}.taskId`, errors);
  validateNonEmptyString2(value.correlationId, `${path4}.correlationId`, errors);
  validateNonEmptyString2(value.createdAt, `${path4}.createdAt`, errors);
}
function validateRedactions(value, path4, errors) {
  if (!Array.isArray(value)) {
    pushFieldError(
      errors,
      path4,
      "Expected an array of redactions.",
      "invalid_type"
    );
    return;
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      pushFieldError(
        errors,
        `${path4}.${index}`,
        "Expected an object.",
        "invalid_type"
      );
      return;
    }
    if ("label" in entry) {
      validateNonEmptyString2(entry.label, `${path4}.${index}.label`, errors);
      return;
    }
    validateNonEmptyString2(entry.category, `${path4}.${index}.category`, errors);
    validateNonEmptyString2(
      entry.placeholder,
      `${path4}.${index}.placeholder`,
      errors
    );
    if (typeof entry.count !== "number") {
      pushFieldError(
        errors,
        `${path4}.${index}.count`,
        "Expected a number.",
        "invalid_type"
      );
    }
  });
}
function validateRouteRequest(request) {
  const errors = [];
  if (!isRecord(request)) {
    return [
      {
        path: "$",
        message: "Expected a route request object.",
        code: "invalid_type"
      }
    ];
  }
  validateTaskInput(request.task, "task", errors);
  validateNonEmptyString2(request.prompt, "prompt", errors);
  validateConsentSnapshot(request.consent, "consent", errors);
  validateModelSelection(request.model, "model", errors);
  validateCorrelationRecord(request.correlation, "correlation", errors);
  validateRedactions(request.redactions, "redactions", errors);
  validateNonEmptyString2(request.createdAt, "createdAt", errors);
  if (request.routing !== void 0) {
    if (isRecord(request.routing)) {
      errors.push(...validateRoutingInput(request.routing));
    } else {
      pushFieldError(errors, "routing", "Expected an object.", "invalid_type");
    }
  }
  return errors;
}
function validateOutcomeReport2(request) {
  return validateOutcomeReport(request).map((error) => ({
    path: error.path,
    message: error.message
  }));
}
function validateRouteResponse(response) {
  const errors = [];
  if (!isRecord(response)) {
    return [
      {
        path: "$",
        message: "Expected a route response object.",
        code: "invalid_type"
      }
    ];
  }
  validateNonEmptyString2(response.routeId, "routeId", errors);
  validateNonEmptyString2(response.taskId, "taskId", errors);
  if (response.status !== "accepted") {
    pushFieldError(errors, "status", "Expected accepted.", "invalid_value");
  }
  if ("requestId" in response && response.requestId !== void 0) {
    validateNonEmptyString2(response.requestId, "requestId", errors);
  }
  if ("recommendation" in response && response.recommendation !== void 0) {
    validateRouteRecommendation(
      response.recommendation,
      "recommendation",
      errors
    );
  }
  return errors;
}
function validateOutcomeResponse(response) {
  const errors = [];
  if (!isRecord(response)) {
    return [
      {
        path: "$",
        message: "Expected an outcome response object.",
        code: "invalid_type"
      }
    ];
  }
  validateNonEmptyString2(response.taskId, "taskId", errors);
  if (response.status !== "accepted" && response.status !== "recorded") {
    pushFieldError(
      errors,
      "status",
      "Expected accepted or recorded.",
      "invalid_value"
    );
  }
  if ("requestId" in response && response.requestId !== void 0) {
    validateNonEmptyString2(response.requestId, "requestId", errors);
  }
  return errors;
}

// ../core/src/model-registry.ts
var InMemoryModelRegistry = class {
  #models;
  #idIndex = /* @__PURE__ */ new Map();
  #aliasIndex = /* @__PURE__ */ new Map();
  constructor(models) {
    this.#models = [...models];
    for (const model of this.#models) {
      const normalizedId = this.#normalizeKey(model.id);
      if (normalizedId && this.#aliasIndex.has(normalizedId)) {
        throw new Error(`Duplicate model key: ${model.id}`);
      }
      this.#registerKey(this.#idIndex, model.id, model);
      for (const alias of model.aliases ?? []) {
        const normalizedAlias = this.#normalizeKey(alias);
        if (!normalizedAlias) {
          continue;
        }
        if (this.#idIndex.has(normalizedAlias)) {
          throw new Error(`Duplicate model key: ${alias}`);
        }
        this.#registerKey(this.#aliasIndex, alias, model);
      }
    }
  }
  get(modelId2) {
    return this.#models.find((model) => model.id === modelId2);
  }
  getDefault() {
    return this.#models.find((model) => model.default) ?? this.#models[0];
  }
  list() {
    return [...this.#models];
  }
  resolve(idOrAlias) {
    const normalizedKey = this.#normalizeKey(idOrAlias);
    if (!normalizedKey) {
      return void 0;
    }
    return this.#idIndex.get(normalizedKey) ?? this.#aliasIndex.get(normalizedKey);
  }
  listAvailable() {
    return this.#models.filter((model) => model.available !== false);
  }
  #registerKey(index, key, model) {
    const normalizedKey = this.#normalizeKey(key);
    if (!normalizedKey) {
      return;
    }
    if (index.has(normalizedKey)) {
      throw new Error(`Duplicate model key: ${key}`);
    }
    index.set(normalizedKey, model);
  }
  #normalizeKey(key) {
    const normalizedKey = key?.trim().toLowerCase();
    return normalizedKey ? normalizedKey : void 0;
  }
};
var ModelMappingError = class extends Error {
  code;
  suggestions;
  constructor(code, message, suggestions) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ModelMappingError";
    this.code = code;
    this.suggestions = suggestions;
  }
};
function listSupportedModelIds(registry, options = {}) {
  const models = options.requireAvailable === false ? registry.list() : registry.listAvailable();
  return models.filter((model) => options.allowedProviders?.includes(model.provider) ?? true).map((model) => model.id);
}
function mapRecommendation(recommendation, options) {
  const modelId2 = typeof recommendation.model === "string" ? recommendation.model.trim() : "";
  const allowedProviders = options.allowedProviders;
  const filteredSuggestions = (excludedModelId) => {
    return options.registry.listAvailable().filter((model) => allowedProviders?.includes(model.provider) ?? true).filter((model) => model.id !== excludedModelId).map((model) => model.id);
  };
  if (!modelId2) {
    throw new ModelMappingError(
      "UNKNOWN_MODEL",
      "Model recommendation must include a non-empty model id.",
      filteredSuggestions()
    );
  }
  const descriptor2 = options.registry.resolve(modelId2);
  if (!descriptor2) {
    throw new ModelMappingError(
      "UNKNOWN_MODEL",
      `Unsupported model recommendation: ${modelId2}.`,
      filteredSuggestions()
    );
  }
  if (allowedProviders && !allowedProviders.includes(descriptor2.provider)) {
    throw new ModelMappingError(
      "PROVIDER_NOT_ALLOWED",
      `Model ${descriptor2.id} uses provider ${descriptor2.provider}, which is not supported by this harness.`,
      filteredSuggestions(descriptor2.id)
    );
  }
  if (options.requireAvailable && descriptor2.available === false) {
    throw new ModelMappingError(
      "MODEL_UNAVAILABLE",
      `Model ${descriptor2.id} is currently unavailable in this harness.`,
      filteredSuggestions(descriptor2.id)
    );
  }
  return descriptor2;
}
function validateRecommendedModel(modelId2, options) {
  const registry = options.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const normalizedModelId = modelId2.trim();
  const allowlistedIds = new Set(
    options.allowlist.map((entry) => registry.resolve(entry)).filter(
      (descriptor3) => descriptor3 !== void 0 && descriptor3.provider === "anthropic"
    ).map((descriptor3) => descriptor3.id)
  );
  const suggestions = registry.listAvailable().filter((descriptor3) => descriptor3.provider === "anthropic").filter((descriptor3) => allowlistedIds.has(descriptor3.id)).map((descriptor3) => descriptor3.id);
  if (normalizedModelId.length === 0) {
    return {
      ok: false,
      reason: "unknown",
      suggestions
    };
  }
  const descriptor2 = registry.resolve(normalizedModelId);
  if (!descriptor2) {
    return {
      ok: false,
      reason: "unknown",
      suggestions
    };
  }
  if (descriptor2.provider !== "anthropic") {
    return {
      ok: false,
      reason: "not-anthropic",
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor2.id)
    };
  }
  if (!allowlistedIds.has(descriptor2.id)) {
    return {
      ok: false,
      reason: "not-in-allowlist",
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor2.id)
    };
  }
  return normalizedModelId === descriptor2.id ? {
    ok: true,
    modelId: descriptor2.id
  } : {
    ok: true,
    modelId: descriptor2.id,
    mappedFrom: normalizedModelId
  };
}
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

// ../core/src/storage.ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
var InMemoryCorrelationStorage = class {
  #records = /* @__PURE__ */ new Map();
  get(taskId) {
    return Promise.resolve(this.#records.get(taskId));
  }
  set(record) {
    this.#records.set(record.taskId, record);
    return Promise.resolve();
  }
};
var RawPayloadRejectedError = class extends Error {
  constructor(fieldName) {
    super(`Raw payload field is not allowed in local storage: ${fieldName}`);
    this.name = "RawPayloadRejectedError";
  }
};
var InvalidStoreIdError = class extends Error {
  id;
  constructor(id2) {
    super(`Invalid local store identifier: ${id2}`);
    this.name = "InvalidStoreIdError";
    this.id = id2;
  }
};
var StoreCorruptError = class extends Error {
  filePath;
  constructor(filePath, cause) {
    super(`Stored Hokusai state is corrupt: ${filePath}`);
    this.name = "StoreCorruptError";
    this.filePath = filePath;
    this.cause = cause;
  }
};
var RAW_FIELD_NAMES = /* @__PURE__ */ new Set([
  "rawTaskText",
  "rawCode",
  "rawLog",
  "prompt",
  "rawPrompt",
  "rawContent"
]);
var RAW_FIELD_PATTERNS = [
  /^customer/i,
  /^rawCustomer/i,
  /^prompt$/i,
  /^rawPrompt$/i,
  /^rawContent$/i,
  /^rawCode$/i,
  /^rawLog$/i
];
var SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
function assertSafeStoreId(id2) {
  if (id2.length === 0 || id2.length > 255 || !SAFE_ID_PATTERN.test(id2)) {
    throw new InvalidStoreIdError(id2);
  }
}
function isRawFieldName(key) {
  return RAW_FIELD_NAMES.has(key) || RAW_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}
function assertNoRawPayloadFields(record, path4 = "") {
  if (Array.isArray(record)) {
    for (const [index, value] of record.entries()) {
      assertNoRawPayloadFields(value, `${path4}[${index}]`);
    }
    return;
  }
  if (!record || typeof record !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    const fieldPath = path4 ? `${path4}.${key}` : key;
    if (isRawFieldName(key)) {
      throw new RawPayloadRejectedError(fieldPath);
    }
    assertNoRawPayloadFields(value, fieldPath);
  }
}
function pruneByRetention(records, now, policy) {
  const minCreatedAt = policy.maxAgeMs === void 0 ? void 0 : now - policy.maxAgeMs;
  let kept = minCreatedAt === void 0 ? [...records] : records.filter((record) => record.createdAt >= minCreatedAt);
  if (policy.maxRecords !== void 0 && kept.length > policy.maxRecords) {
    kept = kept.sort((left, right) => left.createdAt - right.createdAt).slice(-policy.maxRecords);
  }
  return kept;
}
async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}
async function readJsonFiles(dirPath) {
  let fileNames;
  try {
    fileNames = await readdir(dirPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const records = await Promise.all(
    fileNames.filter((fileName) => fileName.endsWith(".json")).map(async (fileName) => {
      const filePath = join(dirPath, fileName);
      try {
        return JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        throw new StoreCorruptError(filePath, error);
      }
    })
  );
  return records;
}
async function writeJsonFile(filePath, value) {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
async function removeFile(filePath) {
  await rm(filePath, { force: true });
}
var FsLocalStore = class {
  #baseDir;
  constructor(baseDir) {
    this.#baseDir = baseDir;
  }
  async putCorrelation(record) {
    assertNoRawPayloadFields(record);
    await writeJsonFile(this.#correlationFilePath(record.correlationId), record);
  }
  async getCorrelation(correlationId) {
    const filePath = this.#correlationFilePath(correlationId);
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return void 0;
      }
      throw new StoreCorruptError(filePath, error);
    }
  }
  async listCorrelations() {
    return (await readJsonFiles(this.#correlationsDir())).sort((left, right) => left.createdAt - right.createdAt);
  }
  async deleteCorrelation(correlationId) {
    await removeFile(this.#correlationFilePath(correlationId));
  }
  async clearCorrelations() {
    await rm(this.#correlationsDir(), { recursive: true, force: true });
  }
  async putPayloadHash(record) {
    await writeJsonFile(this.#payloadHashFilePath(record.hash), record);
  }
  async listPayloadHashes() {
    return (await readJsonFiles(this.#hashesDir())).sort(
      (left, right) => left.createdAt - right.createdAt
    );
  }
  async clearPayloadHashes() {
    await rm(this.#hashesDir(), { recursive: true, force: true });
  }
  async appendAudit(entry) {
    await writeJsonFile(this.#auditFilePath(entry.id), entry);
  }
  async listAudit() {
    return (await readJsonFiles(this.#auditDir())).sort(
      (left, right) => left.timestamp - right.timestamp
    );
  }
  async clearAudit() {
    await rm(this.#auditDir(), { recursive: true, force: true });
  }
  async putConfigRecord(id2, record) {
    assertSafeStoreId(id2);
    assertNoRawPayloadFields(record);
    await writeJsonFile(this.#configFilePath(id2), record);
  }
  async getConfigRecord(id2) {
    const filePath = this.#configFilePath(id2);
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return void 0;
      }
      throw new StoreCorruptError(filePath, error);
    }
  }
  deleteConfigRecord(id2) {
    return removeFile(this.#configFilePath(id2));
  }
  async pruneExpired(now, policy) {
    const correlations = await this.listCorrelations();
    await this.#rewriteRecords(
      this.#correlationsDir(),
      correlations,
      pruneByRetention(correlations, now, policy),
      (record) => this.#correlationFilePath(record.correlationId)
    );
    const payloadHashes = await this.listPayloadHashes();
    await this.#rewriteRecords(
      this.#hashesDir(),
      payloadHashes,
      pruneByRetention(payloadHashes, now, policy),
      (record) => this.#payloadHashFilePath(record.hash)
    );
    const auditEntries = await this.listAudit();
    const keptAuditEntries = pruneByRetention(
      auditEntries.map((entry) => ({ ...entry, createdAt: entry.timestamp })),
      now,
      policy
    ).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      correlationId: entry.correlationId,
      status: entry.status,
      timestamp: entry.timestamp,
      ...entry.error === void 0 ? {} : { error: entry.error }
    }));
    await this.#rewriteRecords(
      this.#auditDir(),
      auditEntries,
      keptAuditEntries,
      (entry) => this.#auditFilePath(entry.id)
    );
  }
  async clear() {
    await Promise.all([
      this.clearCorrelations(),
      this.clearPayloadHashes(),
      this.clearAudit(),
      rm(this.#configDir(), { recursive: true, force: true })
    ]);
  }
  #correlationsDir() {
    return join(this.#baseDir, "correlations");
  }
  #hashesDir() {
    return join(this.#baseDir, "hashes");
  }
  #auditDir() {
    return join(this.#baseDir, "audit");
  }
  #configDir() {
    return join(this.#baseDir, "config");
  }
  #correlationFilePath(correlationId) {
    assertSafeStoreId(correlationId);
    return join(this.#correlationsDir(), `${correlationId}.json`);
  }
  #payloadHashFilePath(hash) {
    assertSafeStoreId(hash);
    return join(this.#hashesDir(), `${hash}.json`);
  }
  #auditFilePath(id2) {
    assertSafeStoreId(id2);
    return join(this.#auditDir(), `${id2}.json`);
  }
  #configFilePath(id2) {
    assertSafeStoreId(id2);
    return join(this.#configDir(), `${id2}.json`);
  }
  async #rewriteRecords(dirPath, existing, kept, getFilePath) {
    const keptFilePaths = new Set(kept.map((record) => getFilePath(record)));
    await Promise.all(
      existing.map((record) => getFilePath(record)).filter((filePath) => !keptFilePaths.has(filePath)).map((filePath) => removeFile(filePath))
    );
    if (kept.length === 0) {
      await rm(dirPath, { recursive: true, force: true });
      return;
    }
    await ensureDir(dirPath);
  }
};

// ../core/src/client.ts
var DEFAULT_MAX_RETRIES = 2;
var DEFAULT_TIMEOUT_MS = 1e4;
var MAX_RETRY_AFTER_MS = 5e3;
var OUTCOME_PATH = "/v1/outcomes";
var SIGNAL_PATH = "/v1/signals";
var DEFAULT_ROUTER_MODEL_ID = "30";
function buildModelPredictPath(modelId2) {
  return `/api/v1/models/${modelId2}/predict`;
}
function buildModelContributionsPath(modelId2) {
  return `/api/v1/models/${modelId2}/contributions`;
}
var SDK_VERSION = "0.6.0";
var DEFAULT_HOKUSAI_BASE_URL = "https://api.hokus.ai";
var HokusaiDispatchError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HokusaiDispatchError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var HokusaiApiError = class extends Error {
  code;
  requestId;
  status;
  constructor(message, options) {
    super(message);
    this.name = "HokusaiApiError";
    this.requestId = options.requestId;
    if (options.status !== void 0) {
      this.status = options.status;
    }
    if (options.code !== void 0) {
      this.code = options.code;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var HokusaiAuthError = class extends HokusaiApiError {
  constructor(message, options) {
    super(message, options);
    this.name = "HokusaiAuthError";
  }
};
var HokusaiValidationError = class extends HokusaiApiError {
  fieldErrors;
  constructor(message, options) {
    super(message, options);
    this.name = "HokusaiValidationError";
    this.fieldErrors = [...options.fieldErrors];
  }
};
var HokusaiNetworkError = class extends HokusaiApiError {
  constructor(message, options) {
    super(message, options);
    this.name = "HokusaiNetworkError";
  }
};
var HokusaiRateLimitError = class extends HokusaiApiError {
  retryAfter;
  constructor(message, options) {
    super(message, options);
    this.name = "HokusaiRateLimitError";
    if (options.retryAfter !== void 0) {
      this.retryAfter = options.retryAfter;
    }
  }
};
function defaultRoutingWarning(message) {
  console.warn(`[hokusai] ${message}`);
}
var HokusaiDispatchBuilder = class {
  #anonymization;
  #redactionConfig;
  #clock;
  #consent;
  #modelRegistry;
  #modelAllowlist;
  #storage;
  constructor(options) {
    this.#consent = options.consent;
    this.#anonymization = options.anonymization;
    this.#redactionConfig = options.redactionConfig;
    this.#modelRegistry = options.modelRegistry;
    this.#modelAllowlist = options.modelAllowlist;
    this.#storage = options.storage ?? new InMemoryCorrelationStorage();
    this.#clock = options.clock ?? (() => /* @__PURE__ */ new Date());
  }
  /**
   * Every model the harness can actually route to: the registry's available
   * models, narrowed by the configured allowlist. This is the default candidate
   * pool for a route call.
   */
  listCandidateModels() {
    const supported = listSupportedModelIds(this.#modelRegistry);
    if (!this.#modelAllowlist) {
      return supported;
    }
    const allowed = new Set(
      this.#modelAllowlist.map((entry) => this.#modelRegistry.resolve(entry)?.id).filter((id2) => id2 !== void 0)
    );
    return supported.filter((id2) => allowed.has(id2));
  }
  async prepareDispatch(task, modelId2, scope = "task-execution", routing) {
    if (!isConsentGranted(this.#consent, scope)) {
      throw new HokusaiDispatchError(
        `Consent has not been granted for scope "${scope}".`
      );
    }
    const model = this.#resolveModel(modelId2);
    if (this.#modelAllowlist) {
      const validation = validateRecommendedModel(model.id, {
        allowlist: this.#modelAllowlist,
        registry: this.#modelRegistry
      });
      if (!validation.ok) {
        throw new HokusaiDispatchError(
          `Model "${model.id}" is not permitted by the configured allowlist.`
        );
      }
    }
    const correlationRecord = await this.#getOrCreateCorrelationRecord(task.id);
    const promptPayload = this.#redactionConfig ? redact(task.prompt, this.#redactionConfig) : anonymizeText(task.prompt, this.#anonymization ?? {});
    const candidateModels = this.listCandidateModels();
    const resolvedRouting = {
      ...routing,
      availableModels: routing?.availableModels ?? (candidateModels.length > 0 ? candidateModels : [model.id])
    };
    return {
      task,
      consent: {
        grantedScopes: [...this.#consent.grantedScopes],
        subjectId: this.#consent.subjectId
      },
      model: this.#toModelSelection(model),
      correlation: correlationRecord,
      prompt: "output" in promptPayload ? promptPayload.output : promptPayload.text,
      redactions: "output" in promptPayload ? promptPayload.redactions : promptPayload.redactions.map(({ label: label2 }) => ({ label: label2 })),
      createdAt: this.#clock().toISOString(),
      routing: resolvedRouting
    };
  }
  async #getOrCreateCorrelationRecord(taskId) {
    const existing = await this.#storage.get(taskId);
    if (existing) {
      return existing;
    }
    const createdAt = this.#clock().toISOString();
    const correlationRecord = {
      taskId,
      correlationId: `${taskId}:${createdAt}`,
      createdAt
    };
    await this.#storage.set(correlationRecord);
    return correlationRecord;
  }
  #resolveModel(modelId2) {
    const model = this.#modelRegistry.get(modelId2);
    if (!model) {
      throw new HokusaiDispatchError(`Unknown model "${modelId2}".`);
    }
    return model;
  }
  #toModelSelection(model) {
    return {
      id: model.id,
      provider: model.provider,
      capabilities: [...model.capabilities]
    };
  }
};
var HokusaiClient = class {
  #apiKey;
  #backoffMs;
  #baseUrl;
  #maxRetries;
  #requestIdFactory;
  #sdkVersion;
  #sleep;
  #timeoutMs;
  #transport;
  #routePath;
  #contributionPath;
  constructor(options = {}) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_HOKUSAI_BASE_URL);
    this.#transport = options.transport ?? getGlobalFetchTransport();
    this.#maxRetries = normalizeMaxRetries(options.maxRetries);
    this.#timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.#sdkVersion = options.sdkVersion ?? SDK_VERSION;
    this.#requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.#backoffMs = options.backoffMs ?? defaultBackoffMs;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#routePath = options.routePath ?? buildModelPredictPath(options.routeModelId ?? DEFAULT_ROUTER_MODEL_ID);
    this.#contributionPath = options.contributionPath ?? buildModelContributionsPath(
      options.contributionModelId ?? DEFAULT_ROUTER_MODEL_ID
    );
  }
  async route(request, options = {}) {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateRouteRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError("Route request validation failed.", {
        requestId,
        fieldErrors
      });
    }
    const { request: technicalTaskRouterRequest, resolved } = buildTechnicalTaskRouterRequest(request);
    const warn = options.onWarning ?? defaultRoutingWarning;
    for (const deprecation of resolved.deprecations) {
      warn(deprecation);
    }
    if (resolved.fidelity !== "ranking") {
      const roles = singletonRoles(resolved.routing);
      const detail = `Candidate pool for ${roles.join(", ")} has fewer than two models; the router cannot rank it.`;
      if (!options.dryRun && options.routingMode !== "non-ranking") {
        throw new HokusaiValidationError(
          `Route request is not ranking-eligible. ${detail} Supply more candidate models via routing.availableModels, or pass routingMode: 'non-ranking' to submit it as non-ranking telemetry.`,
          {
            requestId,
            fieldErrors: roles.map((role) => ({
              path: `routing.available${role[0].toUpperCase()}${role.slice(1)}Models`,
              message: "Candidate pool must contain at least two models.",
              code: "invalid_value"
            }))
          }
        );
      }
      warn(`${detail} This row is classified ${resolved.fidelity}.`);
    }
    if (options.dryRun) {
      return {
        ok: true,
        request: technicalTaskRouterRequest,
        path: this.#routePath
      };
    }
    return this.#send({
      path: this.#routePath,
      request: technicalTaskRouterRequest,
      requestId,
      requestOptions: options,
      responseMapper: (response, responseRequestId) => normalizeTechnicalTaskRouterResponse(
        response,
        request,
        responseRequestId
      ),
      responseValidator: validateRouteResponse,
      responseErrorMessage: "Hokusai API returned an invalid route response."
    });
  }
  async reportOutcome(request, options = {}) {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateOutcomeReport2(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError("Outcome report validation failed.", {
        requestId,
        fieldErrors
      });
    }
    if (options.dryRun) {
      return {
        ok: true,
        request
      };
    }
    const response = await this.#send({
      allowNoContent: true,
      path: OUTCOME_PATH,
      request,
      requestId,
      requestOptions: options,
      responseValidator: validateOutcomeResponse,
      responseErrorMessage: "Hokusai API returned an invalid outcome response."
    });
    if (response.status === "recorded") {
      return response;
    }
    return response;
  }
  async signal(request, options = {}) {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateSignalRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError("Signal request validation failed.", {
        requestId,
        fieldErrors
      });
    }
    if (options.dryRun) {
      return {
        ok: true,
        request
      };
    }
    return this.#send({
      allowNoContent: true,
      path: SIGNAL_PATH,
      request,
      requestId,
      requestOptions: options,
      responseValidator: validateSignalResponse,
      responseErrorMessage: "Hokusai API returned an invalid signal response."
    });
  }
  async submitContribution(request, options = {}) {
    const requestId = options.requestId ?? this.#requestIdFactory();
    const fieldErrors = validateContributionRequest(request);
    if (fieldErrors.length > 0) {
      throw new HokusaiValidationError(
        "Contribution request validation failed.",
        {
          requestId,
          fieldErrors
        }
      );
    }
    if (options.dryRun) {
      return {
        ok: true,
        request,
        path: this.#contributionPath
      };
    }
    const idempotencyKey = request.metadata.idempotency_key.trim().length > 0 ? request.metadata.idempotency_key : requestId;
    return this.#send({
      path: this.#contributionPath,
      request,
      requestId,
      requestOptions: options,
      headers: { "Idempotency-Key": idempotencyKey },
      responseMapper: normalizeContributionResponse,
      responseValidator: validateContributionResponse,
      responseErrorMessage: "Hokusai API returned an invalid contribution response."
    });
  }
  async #send(options) {
    const transport = this.#transport;
    if (!transport) {
      throw new HokusaiApiError(
        "No fetch transport is available. Pass a transport explicitly when constructing HokusaiClient.",
        {
          requestId: options.requestId
        }
      );
    }
    if (!this.#apiKey) {
      throw new HokusaiAuthError(
        "A Hokusai API key is required. Pass apiKey when constructing HokusaiClient.",
        {
          requestId: options.requestId
        }
      );
    }
    let attempt2 = 0;
    let lastError;
    while (attempt2 <= this.#maxRetries) {
      try {
        const response = await this.#executeRequest({
          path: options.path,
          request: options.request,
          requestId: options.requestId,
          signal: options.requestOptions.signal,
          transport,
          ...options.headers ? { headers: options.headers } : {}
        });
        const headerRequestId = response.headers.get("x-hokusai-request-id") ?? options.requestId;
        if (response.status >= 200 && response.status < 300) {
          if (response.status === 204 && options.allowNoContent) {
            return {
              requestId: headerRequestId,
              status: "recorded",
              taskId: getTaskId(options.request)
            };
          }
          const body = await readJsonBody(response, options.requestId);
          const responseObject = options.responseMapper ? options.responseMapper(body, headerRequestId) : body;
          const fieldErrors = options.responseValidator(responseObject);
          if (fieldErrors.length > 0) {
            throw new HokusaiApiError(options.responseErrorMessage, {
              requestId: headerRequestId,
              status: response.status
            });
          }
          if (responseObject.requestId === void 0) {
            responseObject.requestId = headerRequestId;
          }
          return responseObject;
        }
        const parsedError = await parseErrorResponse(response);
        lastError = this.#toApiError({
          parsedError,
          requestId: headerRequestId,
          status: response.status
        });
        if (!shouldRetryResponse(response.status, attempt2, this.#maxRetries)) {
          throw lastError;
        }
        await this.#sleep(
          getRetryDelayMs({
            attempt: attempt2,
            backoffMs: this.#backoffMs,
            retryAfter: parsedError.retryAfter
          })
        );
      } catch (error) {
        if (error instanceof HokusaiApiError) {
          if (!isRetryableApiError(error) || attempt2 >= this.#maxRetries) {
            throw error;
          }
          lastError = error;
          await this.#sleep(
            getRetryDelayMs({
              attempt: attempt2,
              backoffMs: this.#backoffMs,
              retryAfter: error instanceof HokusaiRateLimitError ? error.retryAfter : void 0
            })
          );
        } else {
          const networkError = new HokusaiNetworkError(
            "Unable to reach the Hokusai API. Check your network connection and try again.",
            {
              requestId: options.requestId
            }
          );
          if (attempt2 >= this.#maxRetries) {
            throw networkError;
          }
          lastError = networkError;
          await this.#sleep(
            getRetryDelayMs({
              attempt: attempt2,
              backoffMs: this.#backoffMs
            })
          );
        }
      }
      attempt2 += 1;
    }
    throw lastError ?? new HokusaiNetworkError("Hokusai API request failed.", {
      requestId: options.requestId
    });
  }
  async #executeRequest(options) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.#timeoutMs);
    const cleanup = linkAbortSignals(options.signal, controller);
    try {
      return await options.transport(buildUrl(this.#baseUrl, options.path), {
        method: "POST",
        body: JSON.stringify(options.request),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "X-Request-ID": options.requestId,
          "X-Hokusai-Request-Id": options.requestId,
          "X-Hokusai-Sdk-Version": this.#sdkVersion,
          ...options.headers
        },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HokusaiNetworkError(
          "The Hokusai API request timed out before the server responded.",
          {
            requestId: options.requestId
          }
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      cleanup();
    }
  }
  #toApiError(options) {
    const message = options.parsedError.message ?? defaultErrorMessageForStatus(options.status);
    if (options.status === 401 || options.status === 403) {
      return new HokusaiAuthError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code
      });
    }
    if (options.status === 400 || options.status === 422) {
      return new HokusaiValidationError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
        fieldErrors: options.parsedError.fieldErrors ?? []
      });
    }
    if (options.status === 429) {
      return new HokusaiRateLimitError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code,
        retryAfter: options.parsedError.retryAfter
      });
    }
    if (options.status >= 500) {
      return new HokusaiNetworkError(message, {
        requestId: options.requestId,
        status: options.status,
        code: options.parsedError.code
      });
    }
    return new HokusaiApiError(message, {
      requestId: options.requestId,
      status: options.status,
      code: options.parsedError.code
    });
  }
};
function buildUrl(baseUrl, path4) {
  const resolvedBaseUrl = new URL(baseUrl.toString());
  if (!resolvedBaseUrl.pathname.endsWith("/")) {
    resolvedBaseUrl.pathname = `${resolvedBaseUrl.pathname}/`;
  }
  return new URL(path4.replace(/^\/+/, ""), resolvedBaseUrl).toString();
}
function createRequestId() {
  const cryptoObject = Reflect.get(globalThis, "crypto");
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }
  return `hokusai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function defaultBackoffMs(attempt2) {
  return Math.min(250 * 2 ** attempt2, 2e3);
}
function defaultErrorMessageForStatus(status) {
  if (status === 404) {
    return "The requested Hokusai API endpoint was not found.";
  }
  if (status >= 500) {
    return "The Hokusai API is temporarily unavailable. Try again shortly.";
  }
  return `Hokusai API request failed with status ${status}.`;
}
function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function getGlobalFetchTransport() {
  const fetchValue = Reflect.get(globalThis, "fetch");
  if (typeof fetchValue !== "function") {
    return void 0;
  }
  return fetchValue;
}
function getRetryDelayMs(options) {
  if (options.retryAfter !== void 0) {
    return Math.min(options.retryAfter, MAX_RETRY_AFTER_MS);
  }
  return options.backoffMs(options.attempt);
}
function getTaskId(request) {
  if (typeof request === "object" && request !== null && "taskId" in request && typeof request.taskId === "string") {
    return request.taskId;
  }
  return "";
}
function validateSignalRequest(request) {
  const errors = [];
  for (const field of [
    "kind",
    "stage",
    "installationId",
    "occurredAt"
  ]) {
    if (typeof request[field] !== "string" || request[field].trim().length === 0) {
      errors.push({
        path: field,
        message: "Expected a non-empty string."
      });
    }
  }
  if (Number.isNaN(Date.parse(request.occurredAt))) {
    errors.push({
      path: "occurredAt",
      message: "Expected an ISO timestamp."
    });
  }
  if (request.installedAt !== void 0 && Number.isNaN(Date.parse(request.installedAt))) {
    errors.push({
      path: "installedAt",
      message: "Expected an ISO timestamp."
    });
  }
  if (request.timeToFirstRouteMs !== void 0 && (!Number.isFinite(request.timeToFirstRouteMs) || request.timeToFirstRouteMs < 0)) {
    errors.push({
      path: "timeToFirstRouteMs",
      message: "Expected a non-negative finite number."
    });
  }
  return errors;
}
function validateSignalResponse(value) {
  if (typeof value === "object" && value !== null && (!("status" in value) || value.status === "recorded")) {
    return [];
  }
  return [
    {
      path: "status",
      message: 'Expected "recorded".'
    }
  ];
}
function validateContributionRequest(request) {
  const errors = [];
  if (!Array.isArray(request.rows) || request.rows.length === 0) {
    errors.push({
      path: "rows",
      message: "Expected a non-empty array of contribution rows."
    });
  }
  if (typeof request.metadata?.idempotency_key !== "string" || request.metadata.idempotency_key.trim().length === 0) {
    errors.push({
      path: "metadata.idempotency_key",
      message: "Expected a non-empty idempotency key."
    });
  }
  return errors;
}
function validateContributionResponse(value) {
  if (isPlainRecord(value) && typeof value.accepted === "boolean") {
    return [];
  }
  return [
    {
      path: "accepted",
      message: 'Expected a boolean "accepted" field.'
    }
  ];
}
function normalizeContributionResponse(value, requestId) {
  const record = isPlainRecord(value) ? value : {};
  const response = {
    accepted: record.accepted === true,
    requestId
  };
  const submissionId = firstString(record.submissionId, record.submission_id);
  if (submissionId !== void 0) {
    response.submissionId = submissionId;
  }
  const rowsAccepted = firstFiniteNumber(
    record.rowsAccepted,
    record.rows_accepted
  );
  if (rowsAccepted !== void 0) {
    response.rowsAccepted = rowsAccepted;
  }
  const submittedRows = firstFiniteNumber(
    record.submittedRows,
    record.submitted_rows
  );
  if (submittedRows !== void 0) {
    response.submittedRows = submittedRows;
  }
  const tokenReward = firstFiniteNumber(
    record.tokenReward,
    record.token_reward
  );
  if (tokenReward !== void 0) {
    response.tokenReward = tokenReward;
  }
  const rowFidelityTiers = firstStringArray(
    record.rowFidelityTiers,
    record.row_fidelity_tiers
  );
  if (rowFidelityTiers !== void 0) {
    response.rowFidelityTiers = rowFidelityTiers;
  }
  const fidelitySummary = normalizeFidelitySummary(
    record.fidelitySummary ?? record.fidelity_summary
  );
  if (fidelitySummary !== void 0) {
    response.fidelitySummary = fidelitySummary;
  }
  const rejectedRows = normalizeRejectedRows(
    record.rejectedRows ?? record.rejected_rows
  );
  if (rejectedRows !== void 0) {
    response.rejectedRows = rejectedRows;
  }
  return response;
}
function firstStringArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return [...value];
    }
  }
  return void 0;
}
function normalizeFidelitySummary(value) {
  if (!isPlainRecord(value)) {
    return void 0;
  }
  return {
    training_eligible: firstFiniteNumber(value.training_eligible) ?? 0,
    partial: firstFiniteNumber(value.partial) ?? 0,
    passthrough: firstFiniteNumber(value.passthrough) ?? 0,
    invalid: firstFiniteNumber(value.invalid) ?? 0
  };
}
function normalizeRejectedRows(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const rows = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    const index = firstFiniteNumber(entry.index);
    const reason = firstString(entry.reason);
    if (index !== void 0 && reason !== void 0) {
      rows.push({ index, reason });
    }
  }
  return rows;
}
function firstFiniteNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return void 0;
}
function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== void 0)
  );
}
function omitEmptySections(inputs) {
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([key, value]) => key === "task" || isPlainRecord(value) && Object.keys(value).length > 0
    )
  );
}
function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return void 0;
}
function readNumber(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return void 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function readInteger(value) {
  const parsed = readNumber(value);
  if (parsed === void 0) {
    return void 0;
  }
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : void 0;
}
function readBoolean(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return void 0;
}
function normalizeTaskType(value, prompt) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["feature", "bugfix", "refactor", "research", "maintenance"].includes(
    normalized
  )) {
    return normalized;
  }
  if (["bug", "fix"].includes(normalized)) {
    return "bugfix";
  }
  if (["docs", "doc", "chore", "infra", "test", "tests"].includes(normalized)) {
    return "maintenance";
  }
  return normalizeLegacyTaskType(inferTaskType(prompt));
}
function normalizeLegacyTaskType(value) {
  if (value === "bugfix" || value === "refactor") {
    return value;
  }
  if (value === "research") {
    return "research";
  }
  if (value === "feature") {
    return "feature";
  }
  return "maintenance";
}
function normalizeRepoSizeBucket(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace("-", "_") : "";
  if (["tiny", "small", "medium", "large", "very_large"].includes(normalized)) {
    return normalized;
  }
  return void 0;
}
function normalizeRiskLevel(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["low", "medium", "high", "critical"].includes(normalized)) {
    return normalized;
  }
  return void 0;
}
function normalizeComplexity(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["low", "medium", "high"].includes(normalized)) {
    return normalized;
  }
  if (["shallow", "simple"].includes(normalized)) {
    return "low";
  }
  if (["deep", "complex"].includes(normalized)) {
    return "high";
  }
  return void 0;
}
function normalizeExecutionEnvironment(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["local", "ci", "remote", "hybrid"].includes(normalized)) {
    return normalized;
  }
  return void 0;
}
function buildTechnicalTaskRouterRequest(request) {
  const metadata = request.task.metadata ?? {};
  const resolved = resolveRoutingInput({
    routing: request.routing,
    metadata,
    fallbackModels: [request.model.id]
  });
  const { routing } = resolved;
  const inputs = {
    task: omitUndefined({
      description: request.prompt,
      task_type: normalizeTaskType(
        metadata.task_type ?? metadata.taskType ?? metadata.taskFamily,
        request.prompt
      ),
      language: firstNonEmptyString(
        metadata.primaryLanguage,
        metadata.language
      ),
      framework: firstNonEmptyString(metadata.framework, metadata.stack),
      repo_type: firstNonEmptyString(metadata.repoType, metadata.repo_type)
    }),
    routing: omitUndefined({
      available_models: routing.availableModels,
      available_planner_models: routing.availablePlannerModels,
      available_coder_models: routing.availableCoderModels,
      available_reviewer_models: routing.availableReviewerModels,
      preferred_models: routing.preferredModels,
      max_cost_usd: routing.maxCostUsd,
      max_latency_seconds: routing.maxLatencySeconds,
      objective: routing.objective,
      prioritize_quality: routing.prioritizeQuality,
      prioritize_speed: routing.prioritizeSpeed
    }),
    context: omitUndefined({
      domain: firstNonEmptyString(metadata.domain, metadata.repo),
      repo_size_bucket: normalizeRepoSizeBucket(metadata.repositoryScale),
      requires_tests: readBoolean(metadata.requires_tests) ?? inferRequiresTests(request.prompt),
      risk_level: normalizeRiskLevel(metadata.risk_level),
      file_count: readInteger(metadata.file_count),
      estimated_complexity: normalizeComplexity(
        metadata.estimated_complexity ?? metadata.complexity ?? metadata.reasoningDepth
      ),
      security_sensitive: readBoolean(metadata.security_sensitive)
    }),
    workflow: omitUndefined({
      surface: firstNonEmptyString(metadata.surface) ?? "hokusai-sdk",
      stages: ["plan", "code", "review"],
      execution_environment: normalizeExecutionEnvironment(
        metadata.execution_environment
      ),
      human_review_required: readBoolean(metadata.human_review_required)
    }),
    metadata: omitUndefined({
      external_task_id: request.task.id,
      run_id: request.correlation.correlationId,
      integration_version: SDK_VERSION,
      idempotency_key: request.correlation.correlationId
    })
  };
  return { request: { inputs: omitEmptySections(inputs) }, resolved };
}
function normalizeTechnicalTaskRouterResponse(response, request, requestId) {
  if (validateRouteResponse(response).length === 0) {
    return response;
  }
  const responseRecord = isPlainRecord(response) ? response : {};
  const predictions = isPlainRecord(responseRecord.predictions) ? responseRecord.predictions : {};
  const recommendedStrategy = isPlainRecord(predictions.recommended_strategy) ? predictions.recommended_strategy : void 0;
  if (recommendedStrategy) {
    const model2 = firstString(
      recommendedStrategy.coder_model,
      recommendedStrategy.planner_model,
      recommendedStrategy.reviewer_model
    );
    const confidence2 = firstNumber(recommendedStrategy.confidence);
    const reason2 = firstString(recommendedStrategy.rationale);
    const metadata2 = isPlainRecord(responseRecord.metadata) ? responseRecord.metadata : {};
    const routeId2 = firstString(
      responseRecord.inference_log_id,
      metadata2.request_id,
      metadata2.requestId
    ) ?? request.correlation.correlationId;
    const normalized2 = {
      routeId: routeId2,
      taskId: request.task.id,
      status: "accepted",
      requestId
    };
    if (model2) {
      normalized2.recommendation = {
        model: model2,
        ...reason2 ? { reason: reason2 } : {},
        ...confidence2 !== void 0 ? { confidence: confidence2 } : {}
      };
    }
    return normalized2;
  }
  if (!("metadata" in responseRecord) && !("completed_successfully" in responseRecord)) {
    return response;
  }
  const metadata = isPlainRecord(responseRecord.metadata) ? responseRecord.metadata : {};
  const model = firstString(
    metadata.coder_model,
    metadata.recommended_model,
    metadata.recommendedModel,
    metadata.model,
    metadata.planner_model,
    metadata.reviewer_model
  );
  const confidence = firstNumber(metadata.confidence, metadata.score);
  const reason = firstString(metadata.reason, metadata.explanation);
  const routeId = firstString(
    metadata.routeId,
    metadata.route_id,
    metadata.predictionId,
    metadata.prediction_id,
    metadata.requestId,
    metadata.request_id
  ) ?? request.correlation.correlationId;
  const normalized = {
    routeId,
    taskId: request.task.id,
    status: "accepted",
    requestId
  };
  if (model) {
    normalized.recommendation = {
      model,
      ...reason ? { reason } : {},
      ...confidence !== void 0 ? { confidence } : {}
    };
  }
  return normalized;
}
function inferRequiresTests(prompt) {
  return /\b(test|tests|testing|spec|vitest|jest|pytest|cypress)\b/i.test(
    prompt
  );
}
function inferTaskType(prompt) {
  if (/\b(migrat(?:e|ion|ing)|backfill)\b/i.test(prompt)) {
    return "migration";
  }
  if (/\b(refactor|rename|cleanup|restructure)\b/i.test(prompt)) {
    return "refactor";
  }
  if (/\b(test|tests|spec|coverage)\b/i.test(prompt)) {
    return "test";
  }
  if (/\b(docs?|readme|documentation)\b/i.test(prompt)) {
    return "docs";
  }
  if (/\b(bug|regression|failure|crash|timeout|fix)\b/i.test(prompt)) {
    return "bugfix";
  }
  if (/\b(feature|implement|add support|enable)\b/i.test(prompt)) {
    return "feature";
  }
  return "chore";
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return void 0;
}
function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clampConfidence(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return clampConfidence(parsed);
      }
    }
  }
  return void 0;
}
function clampConfidence(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
function isRetryableApiError(error) {
  if (error instanceof HokusaiRateLimitError) {
    return true;
  }
  return error instanceof HokusaiNetworkError;
}
function linkAbortSignals(signal, controller) {
  if (!signal) {
    return () => {
    };
  }
  if (signal.aborted) {
    controller.abort();
    return () => {
    };
  }
  const onAbort = () => {
    controller.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}
function normalizeMaxRetries(value) {
  if (value === void 0) {
    return DEFAULT_MAX_RETRIES;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HokusaiApiError("maxRetries must be a non-negative integer.", {
      requestId: "configuration"
    });
  }
  return value;
}
function normalizeTimeoutMs(value) {
  if (value === void 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new HokusaiApiError("timeoutMs must be greater than zero.", {
      requestId: "configuration"
    });
  }
  return value;
}
function parseApiFieldErrors(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const fieldErrors = [];
  for (const entry of value) {
    if (!isFieldErrorLike(entry)) {
      continue;
    }
    const fieldError2 = {
      path: entry.path,
      message: entry.message
    };
    if (isFieldErrorCode(entry.code)) {
      fieldError2.code = entry.code;
    }
    fieldErrors.push(fieldError2);
  }
  return fieldErrors;
}
function isFieldErrorCode(value) {
  return value === "invalid_type" || value === "invalid_value" || value === "required";
}
function isFieldErrorLike(value) {
  return typeof value === "object" && value !== null && "path" in value && typeof value.path === "string" && "message" in value && typeof value.message === "string";
}
async function parseErrorResponse(response) {
  const rawBody = await response.text();
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  if (rawBody.trim().length === 0) {
    return { retryAfter };
  }
  try {
    const parsed = JSON.parse(rawBody);
    const result = { retryAfter };
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      result.message = parsed.message;
    } else if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      result.message = parsed.error;
    }
    if (typeof parsed.code === "string" && parsed.code.trim().length > 0) {
      result.code = parsed.code;
    }
    const fieldErrors = parseApiFieldErrors(parsed.fieldErrors);
    if (fieldErrors !== void 0) {
      result.fieldErrors = fieldErrors;
    }
    return result;
  } catch {
    return {
      message: rawBody.trim(),
      retryAfter
    };
  }
}
function parseBaseUrl(input) {
  try {
    const url = new URL(input);
    return new URL(url.toString().replace(/\/+$/, ""));
  } catch {
    throw new HokusaiApiError(
      `Invalid Hokusai base URL "${input}". Pass a full URL such as https://api.hokus.ai.`,
      {
        requestId: "configuration"
      }
    );
  }
}
function parseRetryAfter(value) {
  if (!value) {
    return void 0;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1e3;
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return void 0;
  }
  return Math.max(dateMs - Date.now(), 0);
}
async function readJsonBody(response, requestId) {
  const rawBody = await response.text();
  if (rawBody.trim().length === 0) {
    throw new HokusaiApiError("Hokusai API returned an empty JSON response.", {
      requestId,
      status: response.status
    });
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HokusaiApiError("Hokusai API returned malformed JSON.", {
      requestId,
      status: response.status
    });
  }
}
function shouldRetryResponse(status, attempt2, maxRetries) {
  if (attempt2 >= maxRetries) {
    return false;
  }
  return status === 429 || status >= 500;
}

// ../core/src/config.ts
import { readFile as readFile2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
import { mkdir as mkdir2 } from "node:fs/promises";
var CONFIG_RECORD_ID = "hokusai-plugin-config";
var DEFAULT_ALLOWLIST = ANTHROPIC_MODELS.map((model) => model.id);
var ConfigValidationError = class extends Error {
  fieldErrors;
  constructor(message, fieldErrors) {
    super(message);
    this.name = "ConfigValidationError";
    this.fieldErrors = [...fieldErrors];
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var FilePluginConfigStore = class {
  #filePath;
  constructor(filePath) {
    this.#filePath = filePath;
  }
  async read() {
    try {
      return JSON.parse(await readFile2(this.#filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return void 0;
      }
      throw error;
    }
  }
  async write(config) {
    if ("apiKey" in config) {
      throw new Error("apiKey must not be persisted in plugin config storage.");
    }
    await mkdir2(dirname2(this.#filePath), { recursive: true });
    await writeFile2(this.#filePath, JSON.stringify(config, null, 2), "utf8");
  }
  async clear() {
    await rm2(this.#filePath, { force: true });
  }
};
async function loadPluginConfig(options = {}) {
  const storeConfig = await options.store?.read() ?? {};
  const envConfig = readEnvConfig(options.env);
  const overrideConfig = options.overrides ?? {};
  const merged = {
    ...storeConfig,
    ...envConfig,
    ...overrideConfig
  };
  const fieldErrors = [];
  const apiBaseUrl = normalizeBaseUrl(
    merged.apiBaseUrl ?? DEFAULT_HOKUSAI_BASE_URL,
    fieldErrors
  );
  const routingConsentEnabled = true;
  const outcomeSubmissionEnabled = normalizeBoolean(
    merged.outcomeSubmissionEnabled,
    "outcomeSubmissionEnabled",
    fieldErrors,
    false
  );
  const modelAllowlist = normalizeAllowlist(
    merged.modelAllowlist,
    {
      fieldErrors,
      strict: options.strictAllowlist ?? false,
      ...options.registry ? { registry: options.registry } : {}
    }
  );
  const apiKey = normalizeApiKey(merged.apiKey, fieldErrors);
  const routingObjective = normalizeObjective(
    merged.routingObjective,
    fieldErrors,
    DEFAULT_ROUTING_OBJECTIVE
  );
  if (fieldErrors.length > 0) {
    throw new ConfigValidationError(
      "Plugin configuration validation failed.",
      fieldErrors
    );
  }
  return {
    ...apiKey === void 0 ? {} : { apiKey },
    apiBaseUrl,
    routingConsentEnabled,
    outcomeSubmissionEnabled,
    modelAllowlist,
    routingObjective
  };
}
function redactPluginConfig(config) {
  if (!config.apiKey) {
    return {
      apiKey: "<unset>",
      apiBaseUrl: config.apiBaseUrl,
      routingConsentEnabled: config.routingConsentEnabled,
      outcomeSubmissionEnabled: config.outcomeSubmissionEnabled,
      modelAllowlist: [...config.modelAllowlist],
      ...config.routingObjective ? { routingObjective: config.routingObjective } : {}
    };
  }
  return {
    apiKey: "<set>",
    apiKeyFingerprint: `...${config.apiKey.slice(-4)}`,
    apiBaseUrl: config.apiBaseUrl,
    routingConsentEnabled: config.routingConsentEnabled,
    outcomeSubmissionEnabled: config.outcomeSubmissionEnabled,
    modelAllowlist: [...config.modelAllowlist],
    ...config.routingObjective ? { routingObjective: config.routingObjective } : {}
  };
}
function summarizeAllowlist(config, registry) {
  const resolvedRegistry = registry ?? {
    get() {
      return void 0;
    },
    getDefault() {
      return void 0;
    },
    list() {
      return ANTHROPIC_MODELS;
    },
    listAvailable() {
      return ANTHROPIC_MODELS.filter((model) => model.available !== false);
    },
    resolve(idOrAlias) {
      const normalized = idOrAlias.trim().toLowerCase();
      return ANTHROPIC_MODELS.find(
        (model) => model.id.toLowerCase() === normalized || model.aliases?.some((alias) => alias.toLowerCase() === normalized)
      );
    }
  };
  const validModelIds = /* @__PURE__ */ new Set();
  const unknownEntries = [];
  for (const entry of config.modelAllowlist) {
    const descriptor2 = resolvedRegistry.resolve(entry);
    if (!descriptor2 || descriptor2.provider !== "anthropic") {
      unknownEntries.push(entry);
      continue;
    }
    validModelIds.add(descriptor2.id);
  }
  return {
    validModelIds: [...validModelIds],
    unknownEntries
  };
}
function defaultPluginConfigPath(baseDir) {
  return join2(baseDir, `${CONFIG_RECORD_ID}.json`);
}
function normalizeApiKey(value, fieldErrors) {
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string") {
    fieldErrors.push({
      path: "apiKey",
      code: "invalid_type",
      message: "Expected apiKey to be a string when provided."
    });
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function normalizeBaseUrl(value, fieldErrors) {
  if (typeof value !== "string") {
    fieldErrors.push({
      path: "apiBaseUrl",
      code: "invalid_type",
      message: "Expected apiBaseUrl to be a string."
    });
    return DEFAULT_HOKUSAI_BASE_URL;
  }
  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    fieldErrors.push({
      path: "apiBaseUrl",
      code: "invalid_value",
      message: `Invalid Hokusai base URL "${String(value)}".`
    });
    return DEFAULT_HOKUSAI_BASE_URL;
  }
}
function normalizeBoolean(value, path4, fieldErrors, defaultValue) {
  if (value === void 0) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    fieldErrors.push({
      path: path4,
      code: "invalid_type",
      message: `Expected ${path4} to be a boolean.`
    });
    return defaultValue;
  }
  return value;
}
function normalizeObjective(value, fieldErrors, defaultValue) {
  if (value === void 0) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    fieldErrors.push({
      path: "routingObjective",
      code: "invalid_type",
      message: "Expected routingObjective to be a string."
    });
    return defaultValue;
  }
  const parsed = parseRoutingObjective(value);
  if (!parsed) {
    fieldErrors.push({
      path: "routingObjective",
      code: "invalid_value",
      message: `Unknown routing objective "${value}". Choose speed, cost, or reliability.`
    });
    return defaultValue;
  }
  return parsed;
}
function normalizeAllowlist(value, options) {
  const rawEntries = value === void 0 ? DEFAULT_ALLOWLIST : value;
  if (!Array.isArray(rawEntries)) {
    options.fieldErrors.push({
      path: "modelAllowlist",
      code: "invalid_type",
      message: "Expected modelAllowlist to be an array of strings."
    });
    return [...DEFAULT_ALLOWLIST];
  }
  const allowlist = [];
  for (const [index, entry] of rawEntries.entries()) {
    if (typeof entry !== "string") {
      options.fieldErrors.push({
        path: `modelAllowlist[${index}]`,
        code: "invalid_type",
        message: "Expected allowlist entries to be strings."
      });
      continue;
    }
    const normalized = entry.trim();
    if (normalized.length === 0) {
      continue;
    }
    const descriptor2 = options.registry?.resolve(normalized);
    if (!descriptor2) {
      if (options.strict) {
        options.fieldErrors.push({
          path: `modelAllowlist[${index}]`,
          code: "invalid_value",
          message: `Unknown model allowlist entry "${normalized}".`
        });
      }
      allowlist.push(normalized);
      continue;
    }
    if (descriptor2.provider !== "anthropic") {
      if (options.strict) {
        options.fieldErrors.push({
          path: `modelAllowlist[${index}]`,
          code: "invalid_value",
          message: `Model "${normalized}" is not an Anthropic model.`
        });
      }
      allowlist.push(normalized);
      continue;
    }
    allowlist.push(descriptor2.id);
  }
  return allowlist.length > 0 ? allowlist : [...DEFAULT_ALLOWLIST];
}
function readEnvConfig(env) {
  if (!env) {
    return {};
  }
  return {
    ...env.HOKUSAI_API_KEY !== void 0 ? { apiKey: env.HOKUSAI_API_KEY } : {},
    ...env.HOKUSAI_API_BASE_URL !== void 0 ? { apiBaseUrl: env.HOKUSAI_API_BASE_URL } : {},
    ...env.HOKUSAI_OUTCOME_OPT_IN !== void 0 ? {
      outcomeSubmissionEnabled: parseBooleanEnv(
        env.HOKUSAI_OUTCOME_OPT_IN
      )
    } : {},
    ...env.HOKUSAI_MODEL_ALLOWLIST !== void 0 ? {
      modelAllowlist: env.HOKUSAI_MODEL_ALLOWLIST.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    } : {},
    ...env.HOKUSAI_OBJECTIVE !== void 0 ? { routingObjective: env.HOKUSAI_OBJECTIVE } : {}
  };
}
function parseBooleanEnv(value) {
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

// ../core/src/handoff.ts
function buildHandoffInstructions(input) {
  if (input.harness === "codex") {
    const recommendedModelId2 = input.recommendation.model.id.trim();
    const currentModelId2 = input.currentModelId?.trim();
    return {
      mechanism: "manual",
      slashCommand: recommendedModelId2,
      copyableCommand: recommendedModelId2,
      instructions: currentModelId2 && currentModelId2 === recommendedModelId2 ? [] : [
        `Switch Codex to ${recommendedModelId2} before continuing this task.`
      ]
    };
  }
  const slashCommand = `/model ${input.recommendation.model.id}`;
  const currentModelId = input.currentModelId?.trim();
  const recommendedModelId = input.recommendation.model.id.trim();
  if (input.harness === "claude-code" && currentModelId && currentModelId === recommendedModelId) {
    return {
      mechanism: "manual",
      slashCommand,
      copyableCommand: slashCommand,
      instructions: []
    };
  }
  return {
    mechanism: "manual",
    slashCommand,
    copyableCommand: slashCommand,
    instructions: [
      `Run ${slashCommand} in Claude Code to switch to the recommended model.`
    ]
  };
}

// ../core/src/plugin-commands/commands.ts
import { rm as rm3 } from "node:fs/promises";

// ../core/src/plugin-commands/harness-profile.ts
function toModelSelection(model) {
  return {
    id: model.id,
    provider: model.provider,
    capabilities: model.capabilities
  };
}
function buildDefaultRecommendation(profile17, model, registry = profile17.modelCatalog.registry) {
  const allowedProviders = profile17.modelCatalog.allowedProviders;
  return {
    model: toModelSelection(model),
    reason: profile17.defaultRecommendationReason,
    alternatives: registry.listAvailable().filter(
      (candidate) => allowedProviders?.includes(candidate.provider) ?? true
    ).filter((candidate) => candidate.id !== model.id).map((candidate) => ({
      model: toModelSelection(candidate)
    }))
  };
}
function buildPayloadPreview(payload) {
  return {
    summary: `Task ${payload.task.id} (model: ${payload.model.id})`,
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length
  };
}
function displayTaskRecommendation(recommendation) {
  const lines = [
    `Recommended model: ${recommendation.model.id}`,
    `Provider: ${recommendation.model.provider}`,
    `Reason: ${recommendation.reason}`
  ];
  if (recommendation.confidence !== void 0) {
    lines.push(`Confidence: ${Math.round(recommendation.confidence * 100)}%`);
  }
  if (recommendation.alternatives && recommendation.alternatives.length > 0) {
    lines.push(
      `Alternatives: ${recommendation.alternatives.map((entry) => entry.model.id).join(", ")}`
    );
    for (const alternative of recommendation.alternatives) {
      const parts = [alternative.model.id];
      if (alternative.reason) {
        parts.push(alternative.reason);
      }
      if (alternative.confidence !== void 0) {
        parts.push(`${Math.round(alternative.confidence * 100)}%`);
      }
      lines.push(`- ${parts.join(" - ")}`);
    }
  }
  return {
    lines,
    model: recommendation.model.id,
    provider: recommendation.model.provider
  };
}

// ../core/src/onboarding-funnel.ts
var STORE_ID = "onboarding-funnel";
async function recordOnboardingFunnelSignal(input) {
  if (!input.enabled || !input.client) {
    return;
  }
  const now = input.now ?? /* @__PURE__ */ new Date();
  const state2 = await getOrCreateState(input.store, now);
  const stages = new Set(state2.emittedStages);
  const pendingSignals = [];
  if (!stages.has("install")) {
    pendingSignals.push(buildSignal("install", state2, now, input.harness));
    stages.add("install");
  }
  if (!stages.has(input.stage)) {
    pendingSignals.push(
      buildSignal(input.stage, state2, now, input.harness)
    );
    stages.add(input.stage);
  }
  if (pendingSignals.length === 0) {
    return;
  }
  for (const signal of pendingSignals) {
    await input.client.signal(signal);
  }
  await putState(input.store, {
    ...state2,
    emittedStages: [...stages]
  });
}
function buildSignal(stage, state2, now, harness) {
  const signal = {
    kind: "onboarding_funnel",
    stage,
    installationId: state2.installationId,
    installedAt: state2.installedAt,
    occurredAt: now.toISOString()
  };
  if (harness) {
    signal.harness = harness;
  }
  if (stage === "first_route") {
    signal.timeToFirstRouteMs = Math.max(
      0,
      now.getTime() - Date.parse(state2.installedAt)
    );
  }
  return signal;
}
async function getOrCreateState(store, now) {
  const stored = await store.getConfigRecord(STORE_ID);
  if (stored) {
    return normalizeState(stored, now);
  }
  const state2 = {
    installationId: createInstallationId(now),
    installedAt: now.toISOString(),
    emittedStages: []
  };
  await putState(store, state2);
  return state2;
}
function normalizeState(stored, now) {
  const installationId = typeof stored.installationId === "string" && stored.installationId.trim() ? stored.installationId : createInstallationId(now);
  const installedAt = typeof stored.installedAt === "string" && !Number.isNaN(Date.parse(stored.installedAt)) ? stored.installedAt : now.toISOString();
  const emittedStages = Array.isArray(stored.emittedStages) ? stored.emittedStages.filter(isOnboardingFunnelStage) : [];
  return {
    installationId,
    installedAt,
    emittedStages
  };
}
function putState(store, state2) {
  return store.putConfigRecord(STORE_ID, {
    installationId: state2.installationId,
    installedAt: state2.installedAt,
    emittedStages: state2.emittedStages
  });
}
function isOnboardingFunnelStage(value) {
  return value === "install" || value === "doctor_pass" || value === "first_route" || value === "first_contribution";
}
function createInstallationId(now) {
  const cryptoObject = Reflect.get(globalThis, "crypto");
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }
  return `install-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ../core/src/plugin-commands/commands.ts
var ROUTING_REASON_LIMIT = 120;
var DEBUG_PREVIEW_LIMIT = 1e3;
var DEFAULT_RETENTION_DAYS = 7;
var DEFAULT_RETENTION_MAX_RECORDS = 200;
async function recordCommandFunnelSignal(input) {
  try {
    await recordOnboardingFunnelSignal({
      client: input.options?.apiClient,
      enabled: input.enabled,
      harness: input.harness,
      now: (input.options?.clock ?? (() => /* @__PURE__ */ new Date()))(),
      stage: input.stage,
      store: input.store
    });
  } catch {
  }
}
function ok(value) {
  return { ok: true, value };
}
function fail(code, message, details) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details ? { details } : {}
    }
  };
}
function toStoredCorrelationId(correlationId) {
  return correlationId.replace(/[:.]/g, "_");
}
function truncateForStorage(value, maxLength = ROUTING_REASON_LIMIT) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
function redactForStorage(input, config) {
  return truncateForStorage(redact(input, config).output);
}
function buildDebugPreview(input, config) {
  return preview(input, config).willSend.slice(0, DEBUG_PREVIEW_LIMIT);
}
function toAuditId(correlationId, suffix) {
  return `${toStoredCorrelationId(correlationId)}-${suffix}`;
}
function firstMetadataValue(metadata, ...keys) {
  if (!metadata) {
    return void 0;
  }
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return void 0;
}
function parseMetadataList(value) {
  if (!value) {
    return void 0;
  }
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : void 0;
}
function buildRouteContextProjection(metadata, modelConstraints, signals = {}) {
  const derived = deriveTaskDescriptor({
    taskText: signals.taskText,
    repositorySignals: signals.repositorySignals
  });
  const languageOverride = firstMetadataValue(metadata, "language", "primaryLanguage");
  const complexityOverride = normalizeComplexity2(
    firstMetadataValue(metadata, "estimated_complexity", "complexity", "reasoningDepth")
  );
  const descriptorPairs = [
    [
      "task_type",
      firstMetadataValue(metadata, "task_type", "taskType", "taskFamily") ?? derived.task_type
    ],
    [
      "language",
      languageOverride !== void 0 ? normalizeHokusaiLanguage(languageOverride) : derived.language
    ],
    ["domain", firstMetadataValue(metadata, "domain")],
    ["complexity", complexityOverride ?? derived.complexity],
    [
      "repo_size_bucket",
      firstMetadataValue(metadata, "repo_size_bucket", "repositoryScale") ?? derived.repo_size_bucket
    ],
    ["risk_level", firstMetadataValue(metadata, "risk_level")]
  ];
  const taskDescriptor = {};
  for (const [key, value] of descriptorPairs) {
    if (value !== void 0) {
      taskDescriptor[key] = value;
    }
  }
  if (Object.keys(taskDescriptor).length === 0) {
    taskDescriptor.task_type = "unknown";
  }
  const allowedModels = parseMetadataList(firstMetadataValue(metadata, "available_models")) ?? parseMetadataList(firstMetadataValue(metadata, "available_coder_models")) ?? (modelConstraints && modelConstraints.length > 0 ? [...modelConstraints] : []);
  const budgetRaw = firstMetadataValue(metadata, "max_cost_usd");
  const budgetUsd = budgetRaw !== void 0 ? Number(budgetRaw) : void 0;
  const costBaseline = signals.costBaseline;
  return {
    taskDescriptor,
    allowedModels,
    ...budgetUsd !== void 0 && Number.isFinite(budgetUsd) ? { budgetUsd } : {},
    ...costBaseline ? {
      baselineAt: costBaseline.baselineAt,
      projectDirKey: costBaseline.projectDirKey,
      ...costBaseline.costBaselineUsd !== void 0 ? { costBaselineUsd: costBaseline.costBaselineUsd } : {},
      ...costBaseline.sessionId !== void 0 ? { sessionId: costBaseline.sessionId } : {}
    } : {}
  };
}
function parseRouteContext(value) {
  if (!value) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return void 0;
    }
    const record = parsed;
    const taskDescriptor = typeof record.taskDescriptor === "object" && record.taskDescriptor !== null && !Array.isArray(record.taskDescriptor) ? record.taskDescriptor : {};
    const allowedModels = Array.isArray(record.allowedModels) ? record.allowedModels.filter((entry) => typeof entry === "string") : [];
    return {
      taskDescriptor,
      allowedModels,
      ...typeof record.budgetUsd === "number" && Number.isFinite(record.budgetUsd) ? { budgetUsd: record.budgetUsd } : {},
      ...typeof record.costBaselineUsd === "number" && Number.isFinite(record.costBaselineUsd) ? { costBaselineUsd: record.costBaselineUsd } : {},
      ...typeof record.sessionId === "string" && record.sessionId.length > 0 ? { sessionId: record.sessionId } : {},
      ...typeof record.baselineAt === "string" && record.baselineAt.length > 0 ? { baselineAt: record.baselineAt } : {},
      ...typeof record.projectDirKey === "string" && record.projectDirKey.length > 0 ? { projectDirKey: record.projectDirKey } : {}
    };
  } catch {
    return void 0;
  }
}
function parseAlternativeIds(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
function toWarningMessage(rawValue) {
  return `Ignoring invalid HOKUSAI_RETENTION_DAYS value: ${rawValue}. Using default 7 day retention.`;
}
function resolveRetentionPolicyWithWarnings(env = process.env) {
  const rawValue = env.HOKUSAI_RETENTION_DAYS;
  const defaults = {
    maxAgeMs: DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1e3,
    maxRecords: DEFAULT_RETENTION_MAX_RECORDS
  };
  if (rawValue === void 0) {
    return { policy: defaults, warnings: [] };
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { policy: defaults, warnings: [toWarningMessage(rawValue)] };
  }
  return {
    policy: {
      maxAgeMs: parsed * 24 * 60 * 60 * 1e3,
      maxRecords: DEFAULT_RETENTION_MAX_RECORDS
    },
    warnings: []
  };
}
function resolveRetentionPolicy(env = process.env) {
  return resolveRetentionPolicyWithWarnings(env).policy;
}
async function pruneStoreForPrivacy(store, env, clock) {
  const { policy, warnings } = resolveRetentionPolicyWithWarnings(env);
  if (warnings.length > 0) {
    process.stderr.write(`${warnings.join("\n")}
`);
  }
  await store.pruneExpired((clock ?? (() => /* @__PURE__ */ new Date()))().getTime(), policy);
  return warnings.length === 0 ? {} : { warnings };
}
function maybeWarnings(warnings) {
  return warnings.length === 0 ? {} : { warnings };
}
function findPayloadHashRecord(payloadHashes, hash) {
  if (!hash) {
    return void 0;
  }
  return payloadHashes.find((record) => record.hash === hash);
}
function toRoutingDecisionSummary(record, payloadHashes) {
  const payloadHashRecord = findPayloadHashRecord(
    payloadHashes,
    record.metadata?.payloadHash
  );
  return {
    correlationId: record.metadata?.originalCorrelationId ?? record.correlationId,
    taskId: record.metadata?.taskId ?? record.packetHash,
    createdAt: new Date(record.createdAt).toISOString(),
    ...record.metadata?.recommendedModelId ? { recommendedModelId: record.metadata.recommendedModelId } : {},
    alternatives: parseAlternativeIds(
      record.metadata?.recommendedAlternativeIds
    ),
    ...record.metadata?.reasonPreview ? { reasonPreview: record.metadata.reasonPreview } : {},
    ...record.metadata?.status ? { status: record.metadata.status } : {},
    ...record.metadata?.reasonHash ? { reasonHash: record.metadata.reasonHash } : {},
    ...payloadHashRecord ? { payloadHash: payloadHashRecord } : {}
  };
}
async function findStoredCorrelationRecord(store, correlationId) {
  const storedCorrelationId = toStoredCorrelationId(correlationId);
  const direct = await store.getCorrelation(storedCorrelationId);
  if (direct) {
    return { storedCorrelationId, record: direct };
  }
  const records = await store.listCorrelations();
  const byOriginal = records.find(
    (entry) => entry.metadata?.originalCorrelationId === correlationId
  );
  return {
    storedCorrelationId: byOriginal?.correlationId ?? storedCorrelationId,
    record: byOriginal
  };
}
function summarizeCount(label2, value) {
  if (!value) {
    return void 0;
  }
  const suffix = value.failures === void 0 ? "" : ` (${value.failures} failures)`;
  return `${label2}: ${value.status}${suffix}`;
}
function buildOutcomePreviewLines(report) {
  const lines = [
    "Outcome report preview:",
    `Schema version: ${report.schemaVersion}`,
    `Correlation id: ${report.correlationId}`,
    `Recommended model: ${report.recommendedModel}`,
    `Actual model: ${report.actualModel}`,
    `Recommendation accepted: ${report.recommendationAccepted ? "yes" : "no"}`,
    `Completion status: ${report.completionStatus}`,
    `Latency bucket: ${report.latencyBucket}`,
    `Cost bucket: ${report.costBucket}`,
    `Token bucket: ${report.tokenBucket}`
  ];
  if (report.userRating !== void 0) {
    lines.push(`User rating: ${report.userRating}/5`);
  }
  const buildSummary2 = summarizeCount("Build summary", report.build);
  if (buildSummary2) {
    lines.push(buildSummary2);
  }
  const testSummary = summarizeCount("Test summary", report.test);
  if (testSummary) {
    lines.push(testSummary);
  }
  if (report.notes) {
    lines.push(`Notes: ${report.notes}`);
  }
  if (report.extensions) {
    lines.push(
      `Extensions: ${report.extensions.version} (${Object.keys(report.extensions.data).length} fields)`
    );
  }
  lines.push(
    "Excluded by default: raw code, raw prompts, terminal logs, and customer data."
  );
  return lines;
}
function buildContributionPreviewLines(row) {
  return [
    "",
    `Contribution row (${row.schema_version}) that will be submitted:`,
    JSON.stringify(row, null, 2)
  ];
}
function buildReportContributionRow(input) {
  if (!input.inferenceLogId) {
    return fail(
      "CONTRIBUTION_UNAVAILABLE",
      "No inference log id is available for this routing decision. Route a task with this plugin first, or pass --inference-log-id."
    );
  }
  if (!input.routeContext || input.routeContext.allowedModels.length === 0) {
    return fail(
      "CONTRIBUTION_UNAVAILABLE",
      "No routing context with allowed models was found for this decision. Route a task with this plugin before reporting."
    );
  }
  if (!input.recommendedModelId) {
    return fail(
      "CONTRIBUTION_UNAVAILABLE",
      "The stored route has no recommended model, so the report cannot state whether the recommendation was followed."
    );
  }
  const recommended = input.recommendedModelId;
  const executed = input.report.actualModel;
  const routeOverrides = executed === recommended ? [] : ["coder", "reviewer"].map((role) => ({
    role,
    source: "operator",
    from: recommended,
    to: executed,
    reason: input.report.recommendationAccepted ? "model_changed" : "recommendation_declined"
  }));
  try {
    const row = buildHarnessOutcomeRow({
      inferenceLogId: input.inferenceLogId,
      routeOverrides,
      taskDescriptor: input.routeContext.taskDescriptor,
      allowedModels: input.routeContext.allowedModels,
      selectedModels: {
        coder: input.report.actualModel,
        reviewer: input.report.actualModel
      },
      completionResult: input.report.completionStatus === "succeeded" ? "success" : "failure",
      harness: input.harness,
      sdkVersion: SDK_VERSION,
      observedAt: input.observedAt,
      ...input.routeContext.budgetUsd !== void 0 ? { budgetUsd: input.routeContext.budgetUsd } : {},
      ...input.actualCostUsd !== void 0 ? { actualCostUsd: input.actualCostUsd } : {},
      ...input.wallClockSeconds !== void 0 ? { wallClockSeconds: input.wallClockSeconds } : {},
      ...input.taskId ? { taskId: input.taskId } : {}
    });
    return ok(row);
  } catch (error) {
    return fail(
      "CONTRIBUTION_VALIDATION_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }
}
function applyProfileConstraints(packet, profile17, registry) {
  const providerConstraints = profile17.modelCatalog.providerConstraintLabels ?? profile17.modelCatalog.allowedProviders;
  const modelConstraints = profile17.modelCatalog.modelConstraintLabels ?? profile17.modelCatalog.allowedModels ?? listSupportedModelIds(registry, {
    ...profile17.modelCatalog.allowedProviders ? { allowedProviders: profile17.modelCatalog.allowedProviders } : {},
    ...profile17.modelCatalog.requireAvailable === void 0 ? {} : { requireAvailable: profile17.modelCatalog.requireAvailable }
  });
  return {
    ...packet,
    ...providerConstraints && providerConstraints.length > 0 ? { providerConstraints: [...providerConstraints] } : {},
    ...modelConstraints && modelConstraints.length > 0 ? { modelConstraints: [...modelConstraints] } : {}
  };
}
function buildRecommendationFromRoute(route, profile17, registry) {
  if (!route.recommendation) {
    return void 0;
  }
  const mapped = mapRecommendation(route.recommendation, {
    registry,
    ...profile17.modelCatalog.allowedProviders ? { allowedProviders: profile17.modelCatalog.allowedProviders } : {},
    requireAvailable: profile17.modelCatalog.requireAvailable ?? true
  });
  return {
    model: toModelSelection(mapped),
    reason: route.recommendation.reason ?? profile17.routeRecommendationReason,
    ...route.recommendation.confidence === void 0 ? {} : { confidence: route.recommendation.confidence },
    ...route.recommendation.alternatives?.length ? {
      alternatives: route.recommendation.alternatives.map(
        (alternative) => ({
          model: toModelSelection(
            mapRecommendation(alternative, {
              registry,
              ...profile17.modelCatalog.allowedProviders ? {
                allowedProviders: profile17.modelCatalog.allowedProviders
              } : {},
              requireAvailable: profile17.modelCatalog.requireAvailable ?? true
            })
          ),
          ...alternative.reason === void 0 ? {} : { reason: alternative.reason },
          ...alternative.confidence === void 0 ? {} : { confidence: alternative.confidence }
        })
      )
    } : {}
  };
}
function resolveCommandContext(profile17, options) {
  const consent = options?.consent ?? {
    subjectId: profile17.defaultSubjectId,
    grantedScopes: ["task-execution", "telemetry", "local-storage"]
  };
  const config = profile17.resolveConfigPath(
    options?.configPath ? { override: options.configPath } : void 0
  );
  const settings = resolveConsent({
    routingEnabled: options?.settings?.routingEnabled ?? isConsentGranted(consent, "task-execution"),
    outcomeReportingEnabled: options?.settings?.outcomeReportingEnabled ?? isConsentGranted(consent, "telemetry")
  });
  return {
    builderOptions: profile17.createBuilderOptions(options),
    consent,
    configDir: config.dir,
    registry: options?.registry ?? profile17.modelCatalog.registry,
    settings
  };
}
function createRouteTask(profile17) {
  return async function routeTask2(input, options) {
    if (typeof input.taskText !== "string" || input.taskText.trim().length === 0) {
      return fail(
        "INVALID_TASK",
        'Expected "taskText" to be a non-empty string.'
      );
    }
    const context = resolveCommandContext(profile17, options);
    if (!canRoute(context.settings)) {
      return fail(
        "ROUTING_DISABLED",
        "Routing is disabled by the current consent settings."
      );
    }
    const selectedModelId = input.modelId ?? context.registry.getDefault()?.id;
    if (!selectedModelId) {
      return fail(
        "UNKNOWN_MODEL",
        `No ${profile17.harnessLabel} model is configured for routing.`
      );
    }
    let recommendation;
    try {
      const mapped = mapRecommendation(
        { model: selectedModelId },
        {
          registry: context.registry,
          ...profile17.modelCatalog.allowedProviders ? { allowedProviders: profile17.modelCatalog.allowedProviders } : {},
          requireAvailable: profile17.modelCatalog.requireAvailable ?? true
        }
      );
      recommendation = buildDefaultRecommendation(
        profile17,
        mapped,
        context.registry
      );
    } catch (error) {
      if (error instanceof ModelMappingError) {
        return fail(error.code, error.message, {
          suggestions: error.suggestions
        });
      }
      throw error;
    }
    const packetResult = profile17.buildTaskPacket(input, context.builderOptions);
    packetResult.packet = applyProfileConstraints(
      packetResult.packet,
      profile17,
      context.registry
    );
    const store = new FsLocalStore(context.configDir);
    const taskId = profile17.toTaskId(input, options?.clock);
    const payload = await new HokusaiDispatchBuilder({
      consent: context.consent,
      modelRegistry: context.registry,
      storage: {
        async get(lookupTaskId) {
          const records = await store.listCorrelations();
          const found = records.find(
            (record) => record.metadata?.taskId === lookupTaskId
          );
          if (!found) {
            return void 0;
          }
          return {
            taskId: lookupTaskId,
            correlationId: found.metadata?.originalCorrelationId ?? found.correlationId,
            createdAt: new Date(found.createdAt).toISOString()
          };
        },
        async set(record) {
          await store.putCorrelation({
            correlationId: toStoredCorrelationId(record.correlationId),
            packetHash: record.taskId,
            createdAt: Date.parse(record.createdAt),
            metadata: {
              taskId: record.taskId,
              originalCorrelationId: record.correlationId
            }
          });
        }
      },
      ...options?.clock ? { clock: options.clock } : {}
    }).prepareDispatch(
      {
        id: taskId,
        prompt: profile17.toPrompt(packetResult.packet),
        ...input.metadata ? { metadata: input.metadata } : {}
      },
      recommendation.model.id
    );
    const validationErrors = validateRouteRequest(payload);
    if (validationErrors.length > 0) {
      return fail(
        "ROUTE_VALIDATION_FAILED",
        "Route payload validation failed.",
        {
          fieldErrors: validationErrors.map(
            (fieldError2) => `${fieldError2.path}: ${fieldError2.message}`
          )
        }
      );
    }
    const timestamp2 = (options?.clock ?? (() => /* @__PURE__ */ new Date()))().getTime();
    const correlationId = payload.correlation.correlationId;
    const payloadHash = hashPayload(
      payload,
      (context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG).salt
    );
    await store.putPayloadHash({
      hash: payloadHash,
      algorithm: "sha-256-hmac",
      createdAt: timestamp2
    });
    let route;
    if (options?.apiClient) {
      try {
        route = await options.apiClient.route(payload);
        const routeRecommendation = buildRecommendationFromRoute(
          route,
          profile17,
          context.registry
        );
        if (routeRecommendation) {
          recommendation = routeRecommendation;
        }
      } catch (error) {
        await store.appendAudit({
          id: toAuditId(correlationId, "route"),
          kind: "routing",
          correlationId,
          status: "failed",
          timestamp: timestamp2,
          error: error instanceof Error ? error.message : String(error)
        });
        if (error instanceof ModelMappingError) {
          return fail(error.code, error.message, {
            suggestions: error.suggestions
          });
        }
        if (error instanceof HokusaiNetworkError) {
          return fail("NETWORK_ERROR", error.message, {
            requestId: error.requestId
          });
        }
        throw error;
      }
    } else {
      await store.appendAudit({
        id: toAuditId(correlationId, "route"),
        kind: "routing",
        correlationId,
        status: "skipped",
        timestamp: timestamp2
      });
    }
    const currentModelId = selectedModelId;
    const handoff = profile17.buildHandoff({
      recommendation,
      currentModelId
    });
    const storedCorrelation = await findStoredCorrelationRecord(
      store,
      correlationId
    );
    if (storedCorrelation.record) {
      const redactionConfig = context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
      const costBaseline = captureCostBaseline({
        cwd: process.cwd(),
        nowIso: (options?.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
        ...options?.env ? { env: options.env } : {}
      });
      const routeContextProjection = buildRouteContextProjection(
        input.metadata,
        packetResult.packet.modelConstraints,
        {
          taskText: input.taskText,
          ...input.repositorySignals ? { repositorySignals: input.repositorySignals } : {},
          costBaseline
        }
      );
      await store.putCorrelation({
        ...storedCorrelation.record,
        metadata: {
          ...storedCorrelation.record.metadata,
          recommendedModelId: recommendation.model.id,
          recommendedAlternativeIds: JSON.stringify(
            recommendation.alternatives?.map((entry) => entry.model.id) ?? []
          ),
          reasonHash: hashPayload(recommendation.reason, redactionConfig.salt),
          reasonPreview: redactForStorage(
            recommendation.reason,
            redactionConfig
          ),
          payloadHash,
          routeContext: JSON.stringify(routeContextProjection),
          ...route?.routeId ? { inferenceLogId: route.routeId } : {},
          status: "pending",
          decisionAt: (options?.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
          ...options?.env?.HOKUSAI_DEBUG === "1" || process.env.HOKUSAI_DEBUG === "1" ? {
            debugRedactedPayloadPreview: buildDebugPreview(
              payload.prompt,
              redactionConfig
            )
          } : {}
        }
      });
    }
    if (options?.apiClient) {
      await store.appendAudit({
        id: toAuditId(correlationId, "route"),
        kind: "routing",
        correlationId,
        status: "submitted",
        timestamp: timestamp2
      });
      await recordCommandFunnelSignal({
        enabled: canReportOutcome(context.settings),
        options,
        stage: "first_route",
        store,
        harness: profile17.harness
      });
    }
    return ok({
      recommendation,
      payload,
      preview: buildPayloadPreview(payload),
      correlationId,
      routingDecisionId: correlationId,
      handoff,
      ...route ? { route } : {}
    });
  };
}
function createDeclineRecommendation(profile17) {
  return async function declineRecommendation2(input, options) {
    if (typeof input.correlationId !== "string" || input.correlationId.trim().length === 0) {
      return fail(
        "UNKNOWN_CORRELATION",
        "A correlation id is required to decline a recommendation."
      );
    }
    const context = resolveCommandContext(profile17, options);
    const store = new FsLocalStore(context.configDir);
    const resolved = await findStoredCorrelationRecord(
      store,
      input.correlationId.trim()
    );
    if (!resolved.record) {
      return fail(
        "UNKNOWN_CORRELATION",
        `No stored routing decision matches correlation id ${input.correlationId.trim()}.`
      );
    }
    const redactionConfig = context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
    await store.putCorrelation({
      ...resolved.record,
      metadata: {
        ...resolved.record.metadata,
        status: "declined",
        declinedAt: (options?.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
        ...input.reason?.trim() ? {
          declineReason: redactForStorage(
            input.reason.trim(),
            redactionConfig
          )
        } : {}
      }
    });
    return ok({
      correlationId: resolved.record.metadata?.originalCorrelationId ?? input.correlationId.trim(),
      status: "declined"
    });
  };
}
function createRunDoctor(profile17) {
  return function runDoctor3(options) {
    const config = profile17.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    );
    const consent = options?.consent ?? {
      subjectId: profile17.defaultSubjectId,
      grantedScopes: ["task-execution", "telemetry", "local-storage"]
    };
    const settings = resolveConsent({
      routingEnabled: options?.settings?.routingEnabled ?? isConsentGranted(consent, "task-execution"),
      outcomeReportingEnabled: options?.settings?.outcomeReportingEnabled ?? isConsentGranted(consent, "telemetry")
    });
    return {
      configDir: config.dir,
      configPresent: config.exists,
      needsSetup: !config.exists,
      consent: {
        routingEnabled: canRoute(settings),
        outcomeReportingEnabled: canReportOutcome(settings),
        grantedScopes: [...consent.grantedScopes]
      },
      connectivity: options?.apiClient ? "configured" : "unchecked"
    };
  };
}
function createPreviewTaskPayload(profile17) {
  return function previewTaskPayload2(input, options) {
    const context = resolveCommandContext(profile17, options);
    const packet = applyProfileConstraints(
      profile17.buildTaskPacket(input, context.builderOptions).packet,
      profile17,
      context.registry
    );
    const previewResult = profile17.previewTaskPacket(
      input,
      context.builderOptions
    );
    const taskId = profile17.toTaskId(input, options?.clock);
    const harnessPreview = buildPayloadPreview({
      task: { id: taskId, prompt: profile17.toPrompt(packet) },
      prompt: packet.userIntent,
      consent: {
        subjectId: context.consent.subjectId,
        grantedScopes: [...context.consent.grantedScopes]
      },
      model: {
        id: input.modelId ?? context.registry.getDefault()?.id ?? "unconfigured-model",
        provider: context.registry.get(
          input.modelId ?? context.registry.getDefault()?.id ?? ""
        )?.provider ?? profile17.modelCatalog.allowedProviders?.[0] ?? "unknown",
        capabilities: context.registry.get(
          input.modelId ?? context.registry.getDefault()?.id ?? ""
        )?.capabilities ?? []
      },
      correlation: {
        taskId,
        correlationId: "preview-only",
        createdAt: (/* @__PURE__ */ new Date(0)).toISOString()
      },
      redactions: profile17.buildTaskPacket(input, context.builderOptions).redactionSummary.map((entry) => ({
        label: entry.category,
        count: entry.count,
        category: entry.category,
        placeholder: `<redacted:${entry.category}>`
      })),
      createdAt: (/* @__PURE__ */ new Date(0)).toISOString()
    });
    return {
      packet,
      preview: previewResult,
      harnessPreview
    };
  };
}
async function findRoutingDecision(input) {
  const store = new FsLocalStore(input.configDir);
  let latest;
  if (input.correlationId?.trim()) {
    latest = (await findStoredCorrelationRecord(store, input.correlationId.trim())).record;
  } else if (input.taskId?.trim() || input.sessionId?.trim()) {
    const taskId = input.taskId?.trim();
    const sessionId = input.sessionId?.trim();
    const records = await store.listCorrelations();
    latest = records.filter(
      (record) => taskId ? record.metadata?.taskId === taskId : parseRouteContext(record.metadata?.routeContext)?.sessionId === sessionId
    ).reduce(
      (newest, record) => !newest || record.createdAt > newest.createdAt ? record : newest,
      void 0
    );
  }
  if (!latest) {
    return void 0;
  }
  const routeContext = parseRouteContext(latest.metadata?.routeContext);
  return {
    correlationId: latest.metadata?.originalCorrelationId ?? latest.correlationId,
    taskId: latest.metadata?.taskId ?? latest.packetHash,
    createdAt: new Date(latest.createdAt).toISOString(),
    ...latest.metadata?.recommendedModelId ? { recommendedModelId: latest.metadata.recommendedModelId } : {},
    ...latest.metadata?.inferenceLogId ? { inferenceLogId: latest.metadata.inferenceLogId } : {},
    ...routeContext ? { routeContext } : {}
  };
}
function createPreviewReportOutcome(profile17) {
  return function previewReportOutcome2(input, options) {
    const context = resolveCommandContext(profile17, options);
    if (!canReportOutcome(context.settings)) {
      return fail(
        "OUTCOME_REPORTING_DISABLED",
        "Outcome reporting is disabled by the current consent settings."
      );
    }
    let report;
    const {
      taskId,
      inferenceLogId,
      routedRecommendedModelId,
      routeContext,
      actualCostUsd,
      wallClockSeconds,
      ...reportInput
    } = input;
    try {
      report = buildOutcomeReport(reportInput);
    } catch (error) {
      if (error instanceof Error && "errors" in error) {
        const validationErrors = error.errors ?? [];
        return fail("OUTCOME_VALIDATION_FAILED", error.message, {
          fieldErrors: validationErrors.map(
            (validationError) => `${validationError.path}: ${validationError.message}`
          )
        });
      }
      throw error;
    }
    const contributionResult = buildReportContributionRow({
      report,
      routeContext,
      inferenceLogId,
      recommendedModelId: routedRecommendedModelId,
      harness: profile17.harness,
      observedAt: (options?.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
      ...actualCostUsd !== void 0 ? { actualCostUsd } : {},
      ...wallClockSeconds !== void 0 ? { wallClockSeconds } : {},
      ...taskId ? { taskId } : {}
    });
    const contributionRow = contributionResult.ok ? contributionResult.value : void 0;
    const lines = buildOutcomePreviewLines(report);
    if (contributionRow) {
      lines.push(...buildContributionPreviewLines(contributionRow));
    }
    return ok({
      report,
      preview: {
        lines,
        payload: report
      },
      ...contributionRow ? { contributionRow } : {}
    });
  };
}
function createReportTaskOutcome(profile17) {
  const previewReportOutcome2 = createPreviewReportOutcome(profile17);
  return async function reportTaskOutcome2(input, options) {
    const previewResult = previewReportOutcome2(input, options);
    if (!previewResult.ok) {
      return previewResult;
    }
    const context = resolveCommandContext(profile17, options);
    const store = new FsLocalStore(context.configDir);
    const timestamp2 = (options?.clock ?? (() => /* @__PURE__ */ new Date()))().getTime();
    const observedAt = new Date(timestamp2).toISOString();
    const redactionConfig = context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
    await store.putPayloadHash({
      hash: hashPayload(previewResult.value.report, redactionConfig.salt),
      algorithm: "sha-256-hmac",
      createdAt: timestamp2
    });
    const resolvedCorrelation = await findStoredCorrelationRecord(
      store,
      input.correlationId
    );
    const storedMetadata = resolvedCorrelation.record?.metadata;
    if (storedMetadata?.taskId && input.taskId && storedMetadata.taskId !== input.taskId) {
      return fail(
        "CORRELATION_MISMATCH",
        `Correlation ${input.correlationId} belongs to task ${storedMetadata.taskId}, not ${input.taskId}.`
      );
    }
    if (storedMetadata?.inferenceLogId && input.inferenceLogId && storedMetadata.inferenceLogId !== input.inferenceLogId) {
      return fail(
        "CORRELATION_MISMATCH",
        `Correlation ${input.correlationId} was routed by inference ${storedMetadata.inferenceLogId}, not ${input.inferenceLogId}.`
      );
    }
    const routeContext = parseRouteContext(storedMetadata?.routeContext) ?? input.routeContext;
    const inferenceLogId = input.inferenceLogId ?? storedMetadata?.inferenceLogId;
    const recommendedModelId = storedMetadata?.recommendedModelId ?? input.routedRecommendedModelId;
    const contributionRowResult = buildReportContributionRow({
      report: previewResult.value.report,
      routeContext,
      inferenceLogId,
      recommendedModelId,
      harness: profile17.harness,
      observedAt,
      ...input.actualCostUsd !== void 0 ? { actualCostUsd: input.actualCostUsd } : {},
      ...input.wallClockSeconds !== void 0 ? { wallClockSeconds: input.wallClockSeconds } : {},
      ...input.taskId ? { taskId: input.taskId } : {}
    });
    let response;
    let contribution;
    let contributionRow = contributionRowResult.ok ? contributionRowResult.value : void 0;
    if (options?.dryRun) {
      await store.appendAudit({
        id: toAuditId(input.correlationId, "outcome"),
        kind: "outcome",
        correlationId: input.correlationId,
        status: "skipped",
        timestamp: timestamp2,
        error: "dry-run"
      });
    } else if (options?.apiClient) {
      if (!contributionRowResult.ok) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "contribution"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp: timestamp2,
          error: contributionRowResult.error.message
        });
        return contributionRowResult;
      }
      const row = contributionRowResult.value;
      contributionRow = row;
      const contributionRequest = {
        rows: [row],
        metadata: { idempotency_key: input.correlationId }
      };
      try {
        contribution = await options.apiClient.submitContribution(
          contributionRequest
        );
        await store.appendAudit({
          id: toAuditId(input.correlationId, "contribution"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "submitted",
          timestamp: timestamp2
        });
        await recordCommandFunnelSignal({
          enabled: canReportOutcome(context.settings),
          options,
          stage: "first_contribution",
          store,
          harness: profile17.harness
        });
      } catch (error) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "contribution"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp: timestamp2,
          error: error instanceof Error ? error.message : String(error)
        });
        if (error instanceof HokusaiNetworkError) {
          return fail("NETWORK_ERROR", error.message, {
            requestId: error.requestId
          });
        }
        throw error;
      }
      try {
        response = await options.apiClient.reportOutcome(
          previewResult.value.report
        );
        await store.appendAudit({
          id: toAuditId(input.correlationId, "outcome"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "submitted",
          timestamp: timestamp2
        });
      } catch (error) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "outcome"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp: timestamp2,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      await store.appendAudit({
        id: toAuditId(input.correlationId, "outcome"),
        kind: "outcome",
        correlationId: input.correlationId,
        status: "skipped",
        timestamp: timestamp2
      });
    }
    return ok({
      report: previewResult.value.report,
      ...response ? { response } : {},
      submitted: Boolean(contribution ?? response),
      ...contributionRow ? { contributionRow } : {},
      ...contribution ? { contribution } : {}
    });
  };
}
function createClearLocalState(profile17) {
  return async function clearLocalState(options) {
    const config = profile17.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    );
    const store = new FsLocalStore(config.dir);
    await store.clear();
    if (profile17.getStateFilePath) {
      await rm3(profile17.getStateFilePath(config.dir), { force: true });
    }
    await rm3(config.dir, { recursive: true, force: true });
    return ok({ ok: true });
  };
}
function createListRoutingDecisions(profile17) {
  return async function listRoutingDecisions2(input = {}, options) {
    const context = resolveCommandContext(profile17, options);
    const store = new FsLocalStore(context.configDir);
    const { warnings = [] } = await pruneStoreForPrivacy(
      store,
      options?.env ?? process.env,
      options?.clock
    );
    const [records, payloadHashes] = await Promise.all([
      store.listCorrelations(),
      store.listPayloadHashes()
    ]);
    const limit = input.limit !== void 0 ? Math.max(0, input.limit) : records.length;
    return ok({
      decisions: records.slice().sort((left, right) => right.createdAt - left.createdAt).slice(0, limit).map((record) => toRoutingDecisionSummary(record, payloadHashes)),
      ...maybeWarnings(warnings)
    });
  };
}
function createPreviewStoredDecision(profile17) {
  return async function previewStoredDecision2(input, options) {
    if (typeof input.correlationId !== "string" || input.correlationId.trim().length === 0) {
      return fail("UNKNOWN_CORRELATION", "A correlation id is required.");
    }
    const context = resolveCommandContext(profile17, options);
    const store = new FsLocalStore(context.configDir);
    const { warnings = [] } = await pruneStoreForPrivacy(
      store,
      options?.env ?? process.env,
      options?.clock
    );
    const resolved = await findStoredCorrelationRecord(
      store,
      input.correlationId.trim()
    );
    if (!resolved.record) {
      return fail(
        "UNKNOWN_CORRELATION",
        `No record found for correlation id: ${input.correlationId.trim()}`
      );
    }
    const payloadHashes = await store.listPayloadHashes();
    const summary = toRoutingDecisionSummary(resolved.record, payloadHashes);
    return ok({
      ...summary,
      ...resolved.record.metadata?.decisionAt ? { decisionAt: resolved.record.metadata.decisionAt } : {},
      ...resolved.record.metadata?.declinedAt ? { declinedAt: resolved.record.metadata.declinedAt } : {},
      ...input.debug && resolved.record.metadata?.debugRedactedPayloadPreview ? {
        debugRedactedPayloadPreview: resolved.record.metadata.debugRedactedPayloadPreview
      } : {},
      ...maybeWarnings(warnings)
    });
  };
}
function createListSubmissionAudit(profile17) {
  return async function listSubmissionAudit2(input = {}, options) {
    const context = resolveCommandContext(profile17, options);
    const store = new FsLocalStore(context.configDir);
    const { warnings = [] } = await pruneStoreForPrivacy(
      store,
      options?.env ?? process.env,
      options?.clock
    );
    const entries = await store.listAudit();
    const limit = input.limit !== void 0 ? Math.max(0, input.limit) : entries.length;
    return ok({
      entries: entries.slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, limit),
      ...maybeWarnings(warnings)
    });
  };
}
function createClearPrivacyState(profile17) {
  const clearLocalState = createClearLocalState(profile17);
  return async function clearPrivacyState2(input, options) {
    const configDir = input.configDir ?? profile17.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    ).dir;
    const store = new FsLocalStore(configDir);
    if (input.scope === "all") {
      const [correlations, payloadHashes, auditEntries2] = await Promise.all([
        store.listCorrelations(),
        store.listPayloadHashes(),
        store.listAudit()
      ]);
      await clearLocalState({
        ...options ?? {},
        configPath: configDir
      });
      return ok({
        scope: "all",
        correlationsCleared: correlations.length,
        payloadHashesCleared: payloadHashes.length,
        auditEntriesCleared: auditEntries2.length,
        configCleared: true
      });
    }
    if (input.scope === "records") {
      const [correlations, payloadHashes] = await Promise.all([
        store.listCorrelations(),
        store.listPayloadHashes()
      ]);
      await Promise.all([
        store.clearCorrelations(),
        store.clearPayloadHashes()
      ]);
      return ok({
        scope: "records",
        correlationsCleared: correlations.length,
        payloadHashesCleared: payloadHashes.length,
        auditEntriesCleared: 0,
        configCleared: false
      });
    }
    const auditEntries = await store.listAudit();
    await store.clearAudit();
    return ok({
      scope: "audit",
      correlationsCleared: 0,
      payloadHashesCleared: 0,
      auditEntriesCleared: auditEntries.length,
      configCleared: false
    });
  };
}
function createSetReportingEnabled(profile17) {
  return async function setReportingEnabled2(input, options) {
    const configDir = profile17.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    ).dir;
    const pluginConfigPath = input.configPath ?? defaultPluginConfigPath(configDir);
    const store = new FilePluginConfigStore(pluginConfigPath);
    const existing = await store.read() ?? {};
    await store.write({
      ...existing,
      outcomeSubmissionEnabled: input.enabled
    });
    return ok({ enabled: input.enabled });
  };
}
function createGetReportingStatus(profile17) {
  return async function getReportingStatus2(options) {
    const configDir = profile17.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    ).dir;
    const store = new FilePluginConfigStore(defaultPluginConfigPath(configDir));
    const stored = await store.read();
    const config = await loadPluginConfig({
      env: options?.env ?? process.env,
      store,
      registry: profile17.modelCatalog.registry
    });
    return ok({
      enabled: config.outcomeSubmissionEnabled,
      source: (options?.env ?? process.env).HOKUSAI_OUTCOME_OPT_IN !== void 0 ? "env" : stored?.outcomeSubmissionEnabled !== void 0 ? "stored" : "default"
    });
  };
}

// ../core/src/doctor.ts
import { mkdir as mkdir3, rm as rm4, writeFile as writeFile3 } from "node:fs/promises";
import { join as join3 } from "node:path";
import { randomUUID } from "node:crypto";
var DEFAULT_REACHABILITY_PATH = "/api/health";
var DEFAULT_TIMEOUT_MS2 = 5e3;
var DEFAULT_NODE_MIN_VERSION = "18.0.0";
async function runDoctor(input) {
  const registry = input.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const allowlistSummary = summarizeAllowlist(input.config, registry);
  const checkedAt = (input.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    auth: input.config.apiKey ? "configured" : "missing",
    routingConsent: input.config.routingConsentEnabled,
    outcomeConsent: input.config.outcomeSubmissionEnabled,
    apiReachable: await checkReachability(input, checkedAt),
    allowlistCount: allowlistSummary.validModelIds.length,
    allowlistValid: allowlistSummary.unknownEntries.length === 0,
    unknownAllowlistEntries: allowlistSummary.unknownEntries,
    redactedConfig: redactPluginConfig(input.config),
    checkedAt
  };
}
function renderDoctorReport(report) {
  const unknownEntries = report.unknownAllowlistEntries.length > 0 ? report.unknownAllowlistEntries.join(", ") : "none";
  return [
    "Hokusai doctor",
    `checkedAt: ${report.checkedAt}`,
    `auth: ${report.auth}`,
    `routingConsent: ${report.routingConsent ? "enabled" : "disabled"}`,
    `outcomeConsent: ${report.outcomeConsent ? "enabled" : "disabled"}`,
    `apiReachable: ${report.apiReachable}`,
    `allowlistCount: ${report.allowlistCount}`,
    `allowlistValid: ${report.allowlistValid ? "yes" : "no"}`,
    `unknownAllowlistEntries: ${unknownEntries}`,
    `apiKey: ${report.redactedConfig.apiKey}`,
    ...report.redactedConfig.apiKeyFingerprint ? [`apiKeyFingerprint: ${report.redactedConfig.apiKeyFingerprint}`] : [],
    `apiBaseUrl: ${report.redactedConfig.apiBaseUrl}`
  ].join("\n");
}
function checkNodeRuntime(current, minimum) {
  const parsedCurrent = parseSemver(current);
  const parsedMinimum = parseSemver(minimum);
  if (!parsedCurrent || !parsedMinimum) {
    return {
      id: "node-runtime",
      label: "node-runtime",
      status: "warn",
      summary: `Unable to verify Node.js runtime (${current}) against minimum (${minimum}).`,
      nextAction: `Use Node.js ${minimum} or newer.`
    };
  }
  return compareSemver(parsedCurrent, parsedMinimum) >= 0 ? {
    id: "node-runtime",
    label: "node-runtime",
    status: "pass",
    summary: `Node.js v${current} meets minimum v${minimum}.`
  } : {
    id: "node-runtime",
    label: "node-runtime",
    status: "fail",
    summary: `Node.js v${current} is below minimum v${minimum}.`,
    nextAction: `Upgrade Node.js to ${minimum} or newer.`
  };
}
function checkApiKey(config) {
  return config.apiKey?.trim() ? {
    id: "api-key",
    label: "api-key",
    status: "pass",
    summary: "API key is configured."
  } : {
    id: "api-key",
    label: "api-key",
    status: "fail",
    summary: "API key is not configured.",
    nextAction: "Set HOKUSAI_API_KEY=hk_live_... to enable routing."
  };
}
function checkOutcomeConsent(config) {
  return config.outcomeSubmissionEnabled ? {
    id: "outcome-consent",
    label: "outcome-consent",
    status: "pass",
    summary: "Outcome submission consent is enabled."
  } : {
    id: "outcome-consent",
    label: "outcome-consent",
    status: "warn",
    summary: "Outcome submission consent is not enabled.",
    nextAction: 'Run "hokusai-privacy reporting on" to opt into outcome submission persistently, or set HOKUSAI_OUTCOME_OPT_IN=1 for the current shell only.'
  };
}
function checkModelAllowlist(config, registry) {
  const summary = summarizeAllowlist(config, registry);
  const validCount = summary.validModelIds.length;
  if (validCount > 0) {
    return {
      id: "model-allowlist",
      label: "model-allowlist",
      status: "pass",
      summary: `${validCount} Anthropic model${validCount === 1 ? "" : "s"} configured in allowlist.`
    };
  }
  return {
    id: "model-allowlist",
    label: "model-allowlist",
    status: "fail",
    summary: summary.unknownEntries.length > 0 ? `No valid Anthropic models found in allowlist: ${summary.unknownEntries.join(", ")}.` : "No Anthropic models configured in allowlist.",
    nextAction: "Configure at least one supported Anthropic model in the Hokusai allowlist."
  };
}
async function checkDryRunRoute(config, registry, options) {
  if (!config.apiKey?.trim()) {
    return {
      id: "dry-run-route",
      label: "dry-run-route",
      status: "skipped",
      summary: "Skipped dry-run route because API key is not configured.",
      nextAction: "Configure HOKUSAI_API_KEY, then rerun the doctor."
    };
  }
  const allowlistSummary = summarizeAllowlist(config, registry);
  const modelId2 = allowlistSummary.validModelIds[0];
  const model = modelId2 ? registry.get(modelId2) : void 0;
  if (!model) {
    return {
      id: "dry-run-route",
      label: "dry-run-route",
      status: "fail",
      summary: "Dry-run route failed because no supported model is configured.",
      nextAction: "Configure at least one supported model in the Hokusai allowlist."
    };
  }
  const checkedAt = (options?.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const client = options?.client ?? new HokusaiClient({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    transport: () => Promise.reject(
      new Error("dry-run route must not use network transport")
    )
  });
  try {
    await client.route(
      {
        task: {
          id: "hokusai-doctor-dry-run",
          prompt: "Hokusai doctor dry-run route verification."
        },
        prompt: "Hokusai doctor dry-run route verification.",
        consent: {
          subjectId: "hokusai-doctor",
          grantedScopes: ["task-execution"]
        },
        model: {
          id: model.id,
          provider: model.provider,
          capabilities: [...model.capabilities]
        },
        correlation: {
          taskId: "hokusai-doctor-dry-run",
          correlationId: `hokusai-doctor-dry-run:${checkedAt}`,
          createdAt: checkedAt
        },
        redactions: [],
        createdAt: checkedAt
      },
      { dryRun: true, requestId: checkedAt }
    );
    return {
      id: "dry-run-route",
      label: "dry-run-route",
      status: "pass",
      summary: "Dry-run route payload validated successfully."
    };
  } catch (error) {
    return {
      id: "dry-run-route",
      label: "dry-run-route",
      status: "fail",
      summary: `Dry-run route failed (${sanitizeDryRunError(error)}).`,
      nextAction: "Fix the routing configuration and rerun the doctor before sending tasks."
    };
  }
}
async function checkStateDirWritable(stateDir, probe) {
  try {
    await probe(stateDir);
    return {
      id: "state-dir-writable",
      label: "state-dir-writable",
      status: "pass",
      summary: "State directory is writable."
    };
  } catch (error) {
    return {
      id: "state-dir-writable",
      label: "state-dir-writable",
      status: "fail",
      summary: `State directory is not writable (${sanitizeStateDirError(error, stateDir)}).`,
      nextAction: "Ensure the Hokusai state directory exists and is writable by the current user."
    };
  }
}
async function checkApiReachability(config, transport, options) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS2
  );
  const path4 = options?.path ?? DEFAULT_REACHABILITY_PATH;
  const requestId = options?.requestId ?? (/* @__PURE__ */ new Date()).toISOString();
  const isDefaultHealthProbe = path4 === DEFAULT_REACHABILITY_PATH;
  const headers = {
    "X-Request-ID": requestId,
    "X-Hokusai-Request-Id": requestId
  };
  if (!isDefaultHealthProbe) {
    headers.Authorization = `Bearer ${config.apiKey ?? ""}`;
  }
  try {
    const response = await transport(
      buildReachabilityUrl(
        config.apiBaseUrl,
        path4
      ),
      {
        method: "GET",
        headers,
        signal: controller.signal
      }
    );
    if (response.status >= 200 && response.status < 300) {
      return {
        id: "api-reachability",
        label: "api-reachability",
        status: "pass",
        summary: `API reachability check succeeded (HTTP ${response.status}).`
      };
    }
    if (response.status === 401 || response.status === 403) {
      if (isDefaultHealthProbe) {
        return {
          id: "api-reachability",
          label: "api-reachability",
          status: "pass",
          summary: `API reachability check reached an auth-protected health endpoint (HTTP ${response.status}).`
        };
      }
      return {
        id: "api-reachability",
        label: "api-reachability",
        status: "fail",
        summary: `API reachability check failed with auth error (HTTP ${response.status}).`,
        nextAction: "Verify HOKUSAI_API_KEY and retry the doctor in network mode."
      };
    }
    return {
      id: "api-reachability",
      label: "api-reachability",
      status: "fail",
      summary: `API reachability check failed (HTTP ${response.status}).`,
      nextAction: "Confirm network access to the Hokusai API and retry in network mode."
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name === "AbortError" ? "timeout" : error.name : "network-error";
    return {
      id: "api-reachability",
      label: "api-reachability",
      status: "fail",
      summary: `API reachability check failed (${reason}).`,
      nextAction: "Confirm network access to the Hokusai API and retry in network mode."
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
async function checkApiKeyAccepted(config, transport, options) {
  const id2 = "api-key-accepted";
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return {
      id: id2,
      label: id2,
      status: "skipped",
      summary: "No API key configured, so it cannot be verified.",
      nextAction: "Set HOKUSAI_API_KEY, then re-run the doctor."
    };
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS2
  );
  const requestId = options?.requestId ?? (/* @__PURE__ */ new Date()).toISOString();
  const modelId2 = options?.routeModelId ?? DEFAULT_ROUTER_MODEL_ID;
  try {
    const response = await transport(
      buildReachabilityUrl(
        config.apiBaseUrl,
        `/api/v1/models/${modelId2}/predict`
      ),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Request-ID": requestId,
          "X-Hokusai-Request-Id": requestId
        },
        signal: controller.signal
      }
    );
    if (response.status === 401 || response.status === 403) {
      return {
        id: id2,
        label: id2,
        status: "fail",
        summary: `Hokusai rejected the API key (HTTP ${response.status}): it is invalid or expired.`,
        nextAction: "Generate a new key at hokus.ai and set HOKUSAI_API_KEY to it. A stale key in your shell or .env is the usual cause."
      };
    }
    if (response.status >= 500) {
      return {
        id: id2,
        label: id2,
        status: "warn",
        summary: `Could not verify the API key: Hokusai returned HTTP ${response.status}.`,
        nextAction: "Retry the doctor once the Hokusai API recovers."
      };
    }
    return {
      id: id2,
      label: id2,
      status: "pass",
      summary: "API key was accepted by the Hokusai API."
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name === "AbortError" ? "timeout" : error.name : "network-error";
    return {
      id: id2,
      label: id2,
      status: "warn",
      summary: `Could not verify the API key (${reason}).`,
      nextAction: "Confirm network access to the Hokusai API and retry in network mode."
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
async function runPluginDoctor(input) {
  const registry = input.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const checkedAt = (input.clock ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const mode = input.mode ?? (input.config.apiKey?.trim() ? "network" : "offline");
  const checks = [
    checkNodeRuntime(
      input.nodeVersion ?? process.versions.node,
      input.nodeMinVersion ?? DEFAULT_NODE_MIN_VERSION
    ),
    checkApiKey(input.config),
    checkOutcomeConsent(input.config),
    checkModelAllowlist(input.config, registry),
    await checkDryRunRoute(input.config, registry, {
      ...input.routeDryRunClient ? { client: input.routeDryRunClient } : {},
      ...input.clock ? { clock: input.clock } : {}
    }),
    await checkStateDirWritable(
      input.stateDir ?? ".",
      input.storageProber ?? probeStateDirWritable
    )
  ];
  if (mode === "network" && input.transport) {
    const reachabilityOptions = { requestId: checkedAt };
    if (input.reachabilityPath !== void 0) {
      reachabilityOptions.path = input.reachabilityPath;
    }
    if (input.reachabilityTimeoutMs !== void 0) {
      reachabilityOptions.timeoutMs = input.reachabilityTimeoutMs;
    }
    checks.push(
      await checkApiReachability(
        input.config,
        input.transport,
        reachabilityOptions
      )
    );
    checks.push(
      await checkApiKeyAccepted(input.config, input.transport, {
        requestId: checkedAt,
        ...input.reachabilityTimeoutMs !== void 0 ? { timeoutMs: input.reachabilityTimeoutMs } : {}
      })
    );
  } else {
    checks.push({
      id: "api-reachability",
      label: "api-reachability",
      status: "skipped",
      summary: "Skipped API reachability check (offline mode).",
      ...mode === "network" && !input.transport ? {
        nextAction: "Provide a network transport to run the API reachability check."
      } : {}
    });
    checks.push({
      id: "api-key-accepted",
      label: "api-key-accepted",
      status: "skipped",
      summary: "Skipped API key verification (offline mode)."
    });
  }
  return {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
    mode,
    checkedAt
  };
}
async function checkReachability(input, requestId) {
  if (!input.config.apiKey || !input.transport) {
    return "skipped";
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    input.reachabilityTimeoutMs ?? DEFAULT_TIMEOUT_MS2
  );
  try {
    const response = await input.transport(
      buildReachabilityUrl(
        input.config.apiBaseUrl,
        input.reachabilityPath ?? DEFAULT_REACHABILITY_PATH
      ),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          "X-Request-ID": requestId,
          "X-Hokusai-Request-Id": requestId
        },
        signal: controller.signal
      }
    );
    return mapReachabilityStatus(response);
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timeoutHandle);
  }
}
function buildReachabilityUrl(baseUrl, path4) {
  const normalizedBase = new URL(baseUrl);
  if (!normalizedBase.pathname.endsWith("/")) {
    normalizedBase.pathname = `${normalizedBase.pathname}/`;
  }
  return new URL(path4.replace(/^\/+/, ""), normalizedBase).toString();
}
function mapReachabilityStatus(response) {
  if (response.status === 401 || response.status === 403) {
    return "unauthorized";
  }
  if (response.status >= 200 && response.status < 300) {
    return "ok";
  }
  return "unreachable";
}
function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) {
    return void 0;
  }
  return [
    Number.parseInt(match[1] ?? "", 10),
    Number.parseInt(match[2] ?? "", 10),
    Number.parseInt(match[3] ?? "", 10)
  ];
}
function compareSemver(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}
async function probeStateDirWritable(dir) {
  const probePath = join3(dir, `.hokusai-doctor-${randomUUID()}.tmp`);
  await mkdir3(dir, { recursive: true });
  try {
    await writeFile3(probePath, "ok", "utf8");
  } finally {
    await rm4(probePath, { force: true }).catch(() => void 0);
  }
}
function sanitizeStateDirError(error, stateDir) {
  const raw = error instanceof Error ? error.message || error.name : typeof error === "string" ? error : "unknown error";
  const escapedStateDir = escapeRegExp2(stateDir);
  const withoutStateDir = raw.replace(
    new RegExp(escapedStateDir, "g"),
    "<state-dir>"
  );
  const withoutAbsolutePaths = withoutStateDir.replace(
    /(?:[A-Za-z]:)?\/[^\s:'"]+/g,
    "<path>"
  );
  return withoutAbsolutePaths.trim() || "unknown error";
}
function sanitizeDryRunError(error) {
  const raw = error instanceof Error ? error.message || error.name : typeof error === "string" ? error : "unknown error";
  return raw.replace(/hk_[A-Za-z0-9_/-]+/g, "<api-key>");
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ../core/src/task-packet.ts
var TASK_FAMILIES = [
  "bugfix",
  "feature",
  "migration",
  "refactor",
  "test",
  "docs",
  "infra",
  "mixed",
  "chore",
  "investigation"
];
var REASONING_DEPTHS = ["shallow", "standard", "deep"];
var REPOSITORY_SCALES = ["small", "medium", "large", "xlarge"];
var TASK_PACKET_SCHEMA_VERSION = "1.1.0";
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
var ARRAY_FIELDS = [
  "languageSignals",
  "frameworkSignals",
  "availableTools",
  "constraints",
  "modelConstraints",
  "providerConstraints"
];
var TASK_PACKET_KEY_SET = new Set(TASK_PACKET_KEYS);
var TaskPacketBuildError = class extends Error {
  errors;
  constructor(message, errors) {
    super(message);
    this.name = "TaskPacketBuildError";
    this.errors = errors;
  }
};
function validateTaskPacket(input) {
  const errors = [];
  if (!isPlainObject2(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Task packet must be a non-null object." }]
    };
  }
  const packet = input;
  for (const key of Object.keys(packet)) {
    if (!TASK_PACKET_KEY_SET.has(key)) {
      errors.push({
        path: key,
        message: `Unknown field "${key}" is not allowed in task packets.`
      });
    }
  }
  validateLiteralString2(
    packet.schemaVersion,
    "schemaVersion",
    TASK_PACKET_SCHEMA_VERSION,
    errors
  );
  validateNonEmptyString3(packet.userIntent, "userIntent", errors);
  validateEnum2(packet.taskFamily, "taskFamily", TASK_FAMILIES, errors);
  validateEnum2(packet.reasoningDepth, "reasoningDepth", REASONING_DEPTHS, errors);
  if (packet.repositoryScale !== void 0) {
    validateEnum2(
      packet.repositoryScale,
      "repositoryScale",
      REPOSITORY_SCALES,
      errors
    );
  }
  for (const field of ARRAY_FIELDS) {
    const value = packet[field];
    if (value !== void 0) {
      validateStringArray(value, field, errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const validatedPacket = {
    schemaVersion: TASK_PACKET_SCHEMA_VERSION,
    userIntent: packet.userIntent,
    taskFamily: packet.taskFamily,
    reasoningDepth: packet.reasoningDepth
  };
  if (packet.repositoryScale !== void 0) {
    validatedPacket.repositoryScale = packet.repositoryScale;
  }
  for (const field of ARRAY_FIELDS) {
    const value = packet[field];
    if (value !== void 0) {
      validatedPacket[field] = [...value];
    }
  }
  return { ok: true, packet: validatedPacket };
}
function buildTaskPacket(context) {
  const candidate = {
    schemaVersion: TASK_PACKET_SCHEMA_VERSION,
    userIntent: context?.userIntent,
    taskFamily: context?.taskFamily,
    reasoningDepth: context?.reasoningDepth ?? "standard",
    repositoryScale: context?.repositoryScale
  };
  for (const field of ARRAY_FIELDS) {
    const value = context?.[field];
    if (value !== void 0) {
      candidate[field] = value;
    }
  }
  const result = validateTaskPacket(candidate);
  if (!result.ok) {
    throw new TaskPacketBuildError(
      formatBuildErrorMessage2(result.errors),
      result.errors
    );
  }
  return result.packet;
}
function validateLiteralString2(value, path4, expected, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({
      path: path4,
      message: `Expected "${path4}" to be "${expected}".`
    });
    return;
  }
  if (value !== expected) {
    errors.push({
      path: path4,
      message: `Unsupported schema version "${value}". Expected "${expected}".`
    });
  }
}
function validateNonEmptyString3(value, path4, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({
      path: path4,
      message: `"${path4}" must be a non-empty string.`
    });
  }
}
function validateEnum2(value, path4, allowedValues, errors) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    errors.push({
      path: path4,
      message: `"${path4}" must be one of: ${allowedValues.join(", ")}.`
    });
  }
}
function validateStringArray(value, path4, errors) {
  if (!Array.isArray(value)) {
    errors.push({
      path: path4,
      message: `"${path4}" must be an array of strings.`
    });
    return;
  }
  const entries = value;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push({
        path: `${path4}[${index}]`,
        message: `"${path4}" entries must be non-empty strings.`
      });
    }
  }
}
function formatBuildErrorMessage2(errors) {
  const formatted = errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  return `Failed to build task packet: ${formatted}`;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
function summarizeFrameworkSignals(dependencyCategories) {
  return [...new Set(dependencyCategories.map((entry) => entry.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
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
function isPlainObject3(value) {
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
  if (!isPlainObject3(input)) {
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
    if (!isPlainObject3(projection)) {
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
function normalizeComplexity2(value) {
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
var CACHE_WRITE_INPUT_MULTIPLIER = 1.25;
var CACHE_READ_INPUT_MULTIPLIER = 0.1;
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
var COMPACT_DATE_SUFFIX = /-\d{8}$/;
var DASHED_DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
var GEMINI_STABLE_SUFFIX = /-001$/;
var KNOWN_PROVIDER_PREFIXES = [
  "openrouter/",
  "litellm/",
  "openai/",
  "anthropic/",
  "google/",
  "gemini/",
  "deepseek/",
  "meta-llama/",
  "meta/",
  "mistralai/",
  "moonshotai/",
  "qwen/",
  "x-ai/",
  "z-ai/"
];
function normalizeModelId(id2) {
  let normalized = id2.trim().toLowerCase();
  for (let index = 0; index < 5; index += 1) {
    const prefix = KNOWN_PROVIDER_PREFIXES.find((candidate) => normalized.startsWith(candidate));
    if (!prefix) {
      break;
    }
    normalized = normalized.slice(prefix.length);
  }
  if (normalized.startsWith("claude-")) {
    normalized = normalized.replaceAll(".", "-");
  }
  return normalized;
}
function stripKnownSnapshotSuffixes(model) {
  const compactDate = model.replace(COMPACT_DATE_SUFFIX, "");
  if (compactDate !== model) {
    return compactDate;
  }
  const dashedDate = model.replace(DASHED_DATE_SUFFIX, "");
  if (dashedDate !== model) {
    return dashedDate;
  }
  if (model.startsWith("gemini-")) {
    return model.replace(GEMINI_STABLE_SUFFIX, "");
  }
  return model;
}
function resolveModelPrice(model) {
  if (typeof model !== "string") {
    return void 0;
  }
  const normalized = normalizeModelId(model);
  if (normalized.length === 0) {
    return void 0;
  }
  return MODEL_PRICING[normalized] ?? MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)];
}
function nonNegativeOrNull(value) {
  if (value === void 0) {
    return 0;
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function computeActualCostUsd(input) {
  const price = resolveModelPrice(input.model);
  if (!price) {
    return void 0;
  }
  const inputTokens = nonNegativeOrNull(input.inputTokens);
  const outputTokens = nonNegativeOrNull(input.outputTokens);
  const cacheCreationTokens = nonNegativeOrNull(input.cacheCreationTokens);
  const cacheReadTokens = nonNegativeOrNull(input.cacheReadTokens);
  if (inputTokens === null || outputTokens === null || cacheCreationTokens === null || cacheReadTokens === null) {
    return void 0;
  }
  if (cacheCreationTokens > 0 || cacheReadTokens > 0) {
    if (!isAnthropicModel(input.model) && !isOpenAIModel(input.model)) {
      return void 0;
    }
  }
  const cost = inputTokens / 1e6 * price.inputPerMTokUsd + cacheCreationTokens / 1e6 * price.inputPerMTokUsd * CACHE_WRITE_INPUT_MULTIPLIER + cacheReadTokens / 1e6 * price.inputPerMTokUsd * CACHE_READ_INPUT_MULTIPLIER + outputTokens / 1e6 * price.outputPerMTokUsd;
  return Math.round(cost * 1e6) / 1e6;
}
function isAnthropicModel(model) {
  const normalized = normalizeModelId(model);
  if (ANTHROPIC_MODEL_PRICING[normalized]) {
    return true;
  }
  return Boolean(ANTHROPIC_MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)]);
}
function isOpenAIModel(model) {
  const normalized = normalizeModelId(model);
  if (OPENAI_MODEL_PRICING[normalized]) {
    return true;
  }
  return Boolean(OPENAI_MODEL_PRICING[stripKnownSnapshotSuffixes(normalized)]);
}

// ../core/src/session-usage.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
var nodeFs = {
  readFileSync: (filePath) => readFileSync(filePath, "utf8"),
  readdirSync: (dirPath) => readdirSync(dirPath),
  statSync: (filePath) => ({ mtimeMs: statSync(filePath).mtimeMs })
};
var DEFAULT_SIDECAR_FRESHNESS_MS = 24 * 60 * 60 * 1e3;
function encodeProjectDirKey(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}
function resolveClaudeConfigDir(input) {
  const env = input?.env ?? process.env;
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override) {
    return override;
  }
  return path.join(input?.homedir ?? os.homedir(), ".claude");
}
function sessionCostSidecarPath(claudeConfigDir) {
  return path.join(claudeConfigDir, "hokusai", "session-cost.json");
}
function sessionTranscriptDir(claudeConfigDir, cwd) {
  return path.join(claudeConfigDir, "projects", encodeProjectDirKey(cwd));
}
function claudeConfigDirFrom(input) {
  return resolveClaudeConfigDir({
    ...input.env ? { env: input.env } : {},
    ...input.homedir ? { homedir: input.homedir } : {}
  });
}
function readSessionCostSidecar(sidecarPath, fs = nodeFs) {
  let raw;
  try {
    raw = fs.readFileSync(sidecarPath);
  } catch {
    return void 0;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return void 0;
    }
    const record = parsed;
    const sessionId = record.session_id;
    const cost = record.cost_usd;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return void 0;
    }
    if (typeof cost !== "number" || !Number.isFinite(cost)) {
      return void 0;
    }
    return {
      session_id: sessionId,
      cost_usd: cost,
      ...typeof record.updated_at === "string" ? { updated_at: record.updated_at } : {},
      ...typeof record.input_tokens === "number" && Number.isFinite(record.input_tokens) ? { input_tokens: record.input_tokens } : {},
      ...typeof record.output_tokens === "number" && Number.isFinite(record.output_tokens) ? { output_tokens: record.output_tokens } : {}
    };
  } catch {
    return void 0;
  }
}
function isSidecarFresh(sidecar, nowIso, freshnessMs) {
  if (!sidecar.updated_at) {
    return true;
  }
  const updated = Date.parse(sidecar.updated_at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(updated) || !Number.isFinite(now)) {
    return true;
  }
  return Math.abs(now - updated) <= freshnessMs;
}
function captureCostBaseline(input) {
  const snapshot = {
    baselineAt: input.nowIso,
    projectDirKey: encodeProjectDirKey(input.cwd)
  };
  try {
    const configDir = claudeConfigDirFrom(input);
    const sidecar = readSessionCostSidecar(sessionCostSidecarPath(configDir), input.fs ?? nodeFs);
    if (sidecar && isSidecarFresh(sidecar, input.nowIso, input.freshnessMs ?? DEFAULT_SIDECAR_FRESHNESS_MS)) {
      return {
        ...snapshot,
        costBaselineUsd: sidecar.cost_usd,
        sessionId: sidecar.session_id
      };
    }
  } catch {
  }
  return snapshot;
}
function resolveSidecarCostDiff(input) {
  const { sidecar, baselineSessionId, costBaselineUsd } = input;
  if (!sidecar) {
    return void 0;
  }
  if (typeof costBaselineUsd !== "number" || !Number.isFinite(costBaselineUsd)) {
    return void 0;
  }
  if (baselineSessionId !== void 0 && sidecar.session_id !== baselineSessionId) {
    return void 0;
  }
  const diff = sidecar.cost_usd - costBaselineUsd;
  const clamped = diff > 0 ? diff : 0;
  return Math.round(clamped * 1e6) / 1e6;
}
function toNumericToken(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function extractUsage(record) {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const usage2 = message.usage;
    if (usage2 && typeof usage2 === "object" && !Array.isArray(usage2)) {
      return usage2;
    }
  }
  const usage = record.usage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    return usage;
  }
  return void 0;
}
function parseTranscriptUsageTotals(input) {
  const afterMs = input.afterIso ? Date.parse(input.afterIso) : Number.NaN;
  const hasAfter = Number.isFinite(afterMs);
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  for (const line of input.contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry;
    if (hasAfter) {
      const timestamp2 = record.timestamp;
      if (typeof timestamp2 !== "string") {
        continue;
      }
      const timestampMs = Date.parse(timestamp2);
      if (!Number.isFinite(timestampMs) || timestampMs <= afterMs) {
        continue;
      }
    }
    const usage = extractUsage(record);
    if (!usage) {
      continue;
    }
    const inputForTurn = toNumericToken(usage.input_tokens);
    const cacheCreationForTurn = toNumericToken(usage.cache_creation_input_tokens);
    const cacheReadForTurn = toNumericToken(usage.cache_read_input_tokens);
    const outputForTurn = toNumericToken(usage.output_tokens);
    if (inputForTurn === 0 && cacheCreationForTurn === 0 && cacheReadForTurn === 0 && outputForTurn === 0) {
      continue;
    }
    inputTokens += inputForTurn;
    cacheCreationTokens += cacheCreationForTurn;
    cacheReadTokens += cacheReadForTurn;
    outputTokens += outputForTurn;
    turns += 1;
  }
  return { inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, turns };
}
function locateSessionTranscript(input) {
  const fs = input.fs ?? nodeFs;
  const sessionId = input.sessionId?.trim();
  if (!sessionId || !/^[A-Za-z0-9._-]{1,200}$/.test(sessionId) || sessionId.startsWith(".")) {
    return void 0;
  }
  const full = path.join(input.dir, `${sessionId}.jsonl`);
  try {
    fs.statSync(full);
  } catch {
    return void 0;
  }
  return full;
}
function computeTranscriptCostUsd(input) {
  const totals = parseTranscriptUsageTotals({
    contents: input.contents,
    ...input.afterIso ? { afterIso: input.afterIso } : {}
  });
  if (totals.turns === 0) {
    return void 0;
  }
  return computeActualCostUsd({
    model: input.model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens
  });
}
function resolveActualCostUsd(input) {
  if (typeof input.explicitActualCostUsd === "number" && Number.isFinite(input.explicitActualCostUsd) && input.explicitActualCostUsd >= 0) {
    return input.explicitActualCostUsd;
  }
  if (input.inputTokens !== void 0 && input.outputTokens !== void 0) {
    const fromTokens = computeActualCostUsd({
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens
    });
    if (fromTokens !== void 0) {
      return fromTokens;
    }
  }
  const routeContext = input.routeContext;
  if (routeContext && typeof routeContext.costBaselineUsd === "number") {
    try {
      const configDir = claudeConfigDirFrom(input);
      const sidecar = readSessionCostSidecar(
        sessionCostSidecarPath(configDir),
        input.fs ?? nodeFs
      );
      const diff = resolveSidecarCostDiff({
        sidecar,
        baselineSessionId: routeContext.sessionId,
        costBaselineUsd: routeContext.costBaselineUsd
      });
      if (diff !== void 0) {
        return diff;
      }
    } catch {
    }
  }
  if (routeContext?.baselineAt && routeContext.sessionId) {
    try {
      const configDir = claudeConfigDirFrom(input);
      const dir = routeContext.projectDirKey ? path.join(configDir, "projects", routeContext.projectDirKey) : sessionTranscriptDir(configDir, input.cwd ?? process.cwd());
      const transcriptPath = locateSessionTranscript({
        dir,
        sessionId: routeContext.sessionId,
        ...input.fs ? { fs: input.fs } : {}
      });
      if (transcriptPath) {
        const contents = (input.fs ?? nodeFs).readFileSync(transcriptPath);
        const cost = computeTranscriptCostUsd({
          contents,
          model: input.model,
          afterIso: routeContext.baselineAt
        });
        if (cost !== void 0) {
          return cost;
        }
      }
    } catch {
    }
  }
  return void 0;
}

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
  if (!isPlainObject4(value)) {
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
function isPlainObject4(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function fail2(message, code = "schema_validation_failed") {
  throw new TaskCostValidationError(code, message);
}
function requireObject(value, label2) {
  if (!isPlainObject4(value)) fail2(`${label2} must be an object`);
  return value;
}
function requireEnum(value, allowed, label2) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail2(`${label2} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function requireId(value, label2) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail2(`${label2} must be an identifier matching ${ID_PATTERN}`);
  }
  return value;
}
function requireMintedId(value, label2) {
  if (typeof value !== "string" || !MINTED_ID_PATTERN.test(value)) {
    fail2(`${label2} must be a minted UUID or ULID, not a derived value`);
  }
  return value;
}
function optionalId(value, label2) {
  return value === void 0 ? void 0 : requireId(value, label2);
}
function requirePattern(value, pattern, label2) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail2(`${label2} must match ${pattern}`);
  }
  return value;
}
function requireModel(value, label2) {
  const model = requirePattern(value, MODEL_PATTERN, label2);
  if (model.includes("..") || model.includes("//")) {
    fail2(`${label2} must not contain path-like sequences`);
  }
  return model;
}
function requireTimestamp(value, label2) {
  if (typeof value !== "string") fail2(`${label2} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) fail2(`${label2} must be an ISO-8601 UTC timestamp`, "invalid_timestamp");
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1).map(Number);
  const date2 = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const roundTrips = date2.getUTCFullYear() === year && date2.getUTCMonth() === month - 1 && date2.getUTCDate() === day && date2.getUTCHours() === hour && date2.getUTCMinutes() === minute && date2.getUTCSeconds() === second;
  if (!roundTrips) fail2(`${label2} is not a real calendar time`, "invalid_timestamp");
  return value;
}
function requireBoolean(value, label2) {
  if (typeof value !== "boolean") fail2(`${label2} must be a boolean`);
  return value;
}
function requireCount(value, label2) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail2(`${label2} must be a non-negative integer`, "usage_out_of_range");
  }
  return value;
}
function requireNullableCount(value, label2) {
  return value === null ? null : requireCount(value, label2);
}
function requireNullableUsd(value, label2) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail2(`${label2} must be null or a finite non-negative number`, "usage_out_of_range");
  }
  return value;
}
function requireDiagnostics(value, label2) {
  if (!Array.isArray(value)) fail2(`${label2} must be an array`);
  for (const [index, code] of value.entries()) {
    requireEnum(code, TASK_COST_DIAGNOSTIC_CODES, `${label2}[${index}]`);
  }
}
function requireStringArray(value, label2, item) {
  if (!Array.isArray(value)) fail2(`${label2} must be an array`);
  return value.map((entry, index) => item(entry, `${label2}[${index}]`));
}
function requireTokenUsage(value, label2) {
  const record = requireObject(value, label2);
  const usage = {};
  for (const field of TASK_COST_TOKEN_FIELDS) {
    if (!(field in record)) fail2(`${label2}.${field} is required (use null for missing)`);
    usage[field] = requireNullableCount(record[field], `${label2}.${field}`);
  }
  return usage;
}
function checkSchemaVersion(record, expected, label2) {
  const version = record.schema_version;
  if (typeof version !== "string") fail2(`${label2}.schema_version is required`);
  if (version !== expected) {
    fail2(`${label2}.schema_version "${version}" is not supported (expected ${expected})`, "unknown_schema_version");
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
  if (replayOf === eventId2) fail2("event.replay_of_event_id must not reference the event itself");
  if (record.run_id !== void 0) requireMintedId(record.run_id, "event.run_id");
  if (record.stage_attempt_id !== void 0) {
    if (record.run_id === void 0) fail2("event.stage_attempt_id requires event.run_id");
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
    fail2(`event.usage_coverage is "${usageCoverage}" but usage implies "${derivedCoverage}"`);
  }
  const actual = requireNullableUsd(record.actual_cost_usd, "event.actual_cost_usd");
  const estimated = requireNullableUsd(record.estimated_cost_usd, "event.estimated_cost_usd");
  const costSource2 = requireEnum(record.cost_source, TASK_COST_EVENT_SOURCES, "event.cost_source");
  const expectedSource = actual !== null ? "provider_reported" : estimated !== null ? "local_estimate" : "none";
  if (costSource2 !== expectedSource) {
    fail2(`event.cost_source is "${costSource2}" but the cost fields imply "${expectedSource}"`);
  }
  const basis2 = requireEnum(record.cost_basis, TASK_COST_BASES, "event.cost_basis");
  if (basis2 === "subscription" && actual !== null) {
    fail2('event.actual_cost_usd must be null when cost_basis is "subscription"');
  }
  const pricingSource = requireEnum(record.pricing_source, TASK_COST_PRICING_SOURCES, "event.pricing_source");
  if (pricingSource === "mixed") fail2('event.pricing_source "mixed" is only legal on summaries');
  if (pricingSource === "none" !== (estimated === null)) {
    fail2('event.pricing_source must be "none" exactly when estimated_cost_usd is null');
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
  if (!Array.isArray(record.model_segments)) fail2("summary.model_segments must be an array");
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
  const eventIds2 = requireStringArray(record.event_ids, "summary.event_ids", requireId);
  if (eventIds2.length !== eventCount) fail2("summary.event_count must equal event_ids.length");
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
  if (!Array.isArray(record.events)) fail2("ledger.events must be an array");
  if (record.events.length !== eventCount) fail2("ledger.event_count must equal events.length");
  const seenTaskIds = /* @__PURE__ */ new Set();
  for (const [index, event17] of record.events.entries()) {
    validateTaskCostEventV1(event17);
    const label2 = `ledger.events[${index}]`;
    if (event17.session_id !== sessionId) fail2(`${label2}.session_id must match ledger.session_id`);
    if (event17.harness !== harness) fail2(`${label2}.harness must match ledger.harness`);
    if (event17.provider_contract_version !== providerContract) {
      fail2(`${label2}.provider_contract_version must match ledger.provider_contract_version`);
    }
    seenTaskIds.add(event17.task_id);
  }
  const expected = [...seenTaskIds].sort();
  if (taskIds.length !== expected.length || taskIds.some((id2, index) => id2 !== expected[index])) {
    fail2("ledger.task_ids must be the sorted, de-duplicated task_ids of its events");
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

// ../core/src/task-cost/queue-lifecycle.ts
var QUEUE_LIFECYCLE_EVENT_WRITE_CLASS = Object.freeze({
  enqueued: "control",
  candidate_prepared: "control",
  check_run_completed: "evidence",
  ejected: "control",
  rerun_requested: "control",
  rebase_performed: "evidence",
  repair_commit_pushed: "evidence",
  recovery_decision: "control",
  merged: "control",
  dequeued: "control",
  abandoned: "control",
  review_round_started: "control",
  review_round_completed: "evidence"
});
var QUEUE_LIFECYCLE_EVENT_SCOPES = Object.freeze({
  enqueued: ["pr"],
  candidate_prepared: ["candidate"],
  check_run_completed: ["pr", "candidate"],
  ejected: ["pr"],
  rerun_requested: ["pr", "candidate"],
  rebase_performed: ["pr"],
  repair_commit_pushed: ["pr"],
  recovery_decision: ["pr", "candidate"],
  merged: ["pr"],
  dequeued: ["pr"],
  abandoned: ["pr"],
  review_round_started: ["pr"],
  review_round_completed: ["pr"]
});

// ../core/src/task-cost/queue-lifecycle-schema.ts
var QUEUE_LIFECYCLE_EVENT_V1_JSON_SCHEMA = Object.freeze(
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "queue-lifecycle-event.v1.schema.json",
    "title": "QueueLifecycleEventV1",
    "description": "Queue, CI and repair lifecycle events for the task-cost contract (queue_lifecycle_event/v1, contract 1.2.0, HOK-3338 / MQ-1.2). Identity is task_attempt/v1: every event names its attempt (PR scope) or attempt_refs (candidate scope); event_id and candidate_id are minted idempotency keys. Control events (enqueued, candidate_prepared, ejected, rerun_requested, recovery_decision, merged, dequeued, abandoned, review_round_started) are accepted only for the current, unsettled run; evidence events (check_run_completed, rebase_performed, repair_commit_pushed, review_round_completed) are always accepted against their own attempt. Facts only: durations, failure classes and time-to-land are derived elsewhere. Absent means not reported; null is not used. Single-record shape only: cross-record rules are in reduceQueueLifecycleLog. Rules: packages/core/src/task-cost/queue-lifecycle.md. Readers ignore unknown fields.",
    "oneOf": [
      {
        "$ref": "#/$defs/enqueued"
      },
      {
        "$ref": "#/$defs/candidate_prepared"
      },
      {
        "$ref": "#/$defs/check_run_completed"
      },
      {
        "$ref": "#/$defs/ejected"
      },
      {
        "$ref": "#/$defs/rerun_requested"
      },
      {
        "$ref": "#/$defs/rebase_performed"
      },
      {
        "$ref": "#/$defs/repair_commit_pushed"
      },
      {
        "$ref": "#/$defs/recovery_decision"
      },
      {
        "$ref": "#/$defs/merged"
      },
      {
        "$ref": "#/$defs/dequeued"
      },
      {
        "$ref": "#/$defs/abandoned"
      },
      {
        "$ref": "#/$defs/review_round_started"
      },
      {
        "$ref": "#/$defs/review_round_completed"
      }
    ],
    "$defs": {
      "schemaVersion": {
        "const": "queue_lifecycle_event/v1"
      },
      "mintedId": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25})$",
        "description": "Lowercase RFC 9562 UUID (v7 recommended) or ULID. Minted, never a hash of anything."
      },
      "identifier": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      },
      "harness": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{0,31}$"
      },
      "model": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$"
      },
      "version": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$"
      },
      "checkKey": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9._:-]{0,127}$"
      },
      "providerId": {
        "type": "string",
        "pattern": "^[0-9]{1,20}$"
      },
      "utcTimestamp": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$"
      },
      "gitSha": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
      },
      "positiveInt": {
        "type": "integer",
        "minimum": 1
      },
      "count": {
        "type": "integer",
        "minimum": 0
      },
      "probability": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "recoveryAction": {
        "enum": [
          "retry",
          "rebase",
          "fix",
          "split",
          "wait_for_predecessor",
          "escalate"
        ]
      },
      "propensitySource": {
        "enum": [
          "exact",
          "deterministic",
          "none"
        ]
      },
      "attemptRef": {
        "type": "object",
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
        },
        "required": [
          "task_id",
          "run_id"
        ],
        "description": "TaskAttemptRef from task_attempt/v1. Never a parallel run id."
      },
      "policy": {
        "type": "object",
        "properties": {
          "name": {
            "$ref": "#/$defs/slug"
          },
          "version": {
            "$ref": "#/$defs/version"
          }
        },
        "required": [
          "name",
          "version"
        ]
      },
      "modelAttribution": {
        "description": "Intended and observed models are separate. executed_model is present iff executed_model_evidence is not not_observed.",
        "type": "object",
        "properties": {
          "harness": {
            "$ref": "#/$defs/harness"
          },
          "intended_model": {
            "$ref": "#/$defs/model"
          },
          "executed_model_evidence": {
            "enum": [
              "provider_response",
              "harness_session",
              "not_observed"
            ]
          },
          "executed_model": {
            "$ref": "#/$defs/model"
          }
        },
        "required": [
          "harness",
          "executed_model_evidence"
        ],
        "if": {
          "properties": {
            "executed_model_evidence": {
              "const": "not_observed"
            }
          }
        },
        "then": {
          "not": {
            "required": [
              "executed_model"
            ]
          }
        },
        "else": {
          "required": [
            "executed_model"
          ]
        }
      },
      "actor": {
        "oneOf": [
          {
            "allOf": [
              {
                "$ref": "#/$defs/modelAttribution"
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "const": "agent"
                  }
                },
                "required": [
                  "kind"
                ]
              }
            ]
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "operator"
              }
            },
            "required": [
              "kind"
            ],
            "description": "A human. Carries no identity.",
            "not": {
              "$ref": "#/$defs/anyModelField"
            }
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "enum": [
                  "tend",
                  "monitor"
                ]
              },
              "component": {
                "$ref": "#/$defs/slug"
              }
            },
            "required": [
              "kind"
            ],
            "not": {
              "$ref": "#/$defs/anyModelField"
            }
          },
          {
            "type": "object",
            "properties": {
              "kind": {
                "const": "github"
              },
              "app": {
                "$ref": "#/$defs/slug"
              }
            },
            "required": [
              "kind"
            ],
            "not": {
              "$ref": "#/$defs/anyModelField"
            }
          }
        ]
      },
      "anyModelField": {
        "anyOf": [
          {
            "required": [
              "harness"
            ]
          },
          {
            "required": [
              "intended_model"
            ]
          },
          {
            "required": [
              "executed_model"
            ]
          },
          {
            "required": [
              "executed_model_evidence"
            ]
          }
        ]
      },
      "prScope": {
        "description": "An event about one PR of one run.",
        "type": "object",
        "properties": {
          "attempt": {
            "$ref": "#/$defs/attemptRef"
          },
          "pr_number": {
            "$ref": "#/$defs/positiveInt"
          },
          "head_sha": {
            "$ref": "#/$defs/gitSha"
          }
        },
        "required": [
          "attempt",
          "pr_number",
          "head_sha"
        ],
        "not": {
          "required": [
            "attempt_refs"
          ]
        }
      },
      "candidateScope": {
        "description": "An event about a merge candidate: one ref per run, predecessors first. A candidate is not a run.",
        "type": "object",
        "properties": {
          "candidate_id": {
            "$ref": "#/$defs/mintedId"
          },
          "attempt_refs": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/attemptRef"
            },
            "minItems": 1
          }
        },
        "required": [
          "candidate_id",
          "attempt_refs"
        ],
        "not": {
          "anyOf": [
            {
              "required": [
                "attempt"
              ]
            },
            {
              "required": [
                "pr_number"
              ]
            }
          ]
        }
      },
      "noCandidateLink": {
        "not": {
          "required": [
            "candidate_id"
          ]
        }
      },
      "base": {
        "type": "object",
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "event_id": {
            "$ref": "#/$defs/mintedId"
          },
          "event_type": {
            "enum": [
              "enqueued",
              "candidate_prepared",
              "check_run_completed",
              "ejected",
              "rerun_requested",
              "rebase_performed",
              "repair_commit_pushed",
              "recovery_decision",
              "merged",
              "dequeued",
              "abandoned",
              "review_round_started",
              "review_round_completed"
            ]
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "actor": {
            "$ref": "#/$defs/actor"
          }
        },
        "required": [
          "schema_version",
          "event_id",
          "event_type",
          "observed_at",
          "actor"
        ]
      },
      "enqueued": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "enqueued"
              },
              "base_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "queue_depth": {
                "$ref": "#/$defs/count"
              }
            },
            "required": [
              "event_type"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Control. The run's PR entered the queue."
      },
      "candidate_prepared": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "candidate_prepared"
              },
              "base_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "pr_number": {
                      "$ref": "#/$defs/positiveInt"
                    },
                    "head_sha": {
                      "$ref": "#/$defs/gitSha"
                    }
                  },
                  "required": [
                    "pr_number",
                    "head_sha"
                  ]
                },
                "minItems": 1
              },
              "candidate_sha": {
                "$ref": "#/$defs/gitSha"
              }
            },
            "required": [
              "event_type",
              "base_sha",
              "entries"
            ]
          },
          {
            "$ref": "#/$defs/candidateScope"
          }
        ],
        "description": "Control. The composition of a merge candidate; entries[i] is the PR of attempt_refs[i] (alignment is a validator rule)."
      },
      "check_run_completed": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "check_run_completed"
              },
              "check_run_id": {
                "$ref": "#/$defs/providerId"
              },
              "check_key": {
                "$ref": "#/$defs/checkKey"
              },
              "run_attempt": {
                "$ref": "#/$defs/positiveInt"
              },
              "head_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "trigger": {
                "enum": [
                  "pull_request",
                  "merge_group",
                  "push",
                  "other"
                ]
              },
              "conclusion": {
                "enum": [
                  "success",
                  "failure",
                  "neutral",
                  "cancelled",
                  "skipped",
                  "timed_out",
                  "action_required",
                  "stale",
                  "startup_failure"
                ]
              },
              "started_at": {
                "$ref": "#/$defs/utcTimestamp"
              },
              "completed_at": {
                "$ref": "#/$defs/utcTimestamp"
              }
            },
            "required": [
              "event_type",
              "check_run_id",
              "check_key",
              "run_attempt",
              "head_sha",
              "trigger",
              "conclusion",
              "completed_at"
            ]
          },
          {
            "oneOf": [
              {
                "allOf": [
                  {
                    "$ref": "#/$defs/prScope"
                  },
                  {
                    "$ref": "#/$defs/noCandidateLink"
                  }
                ]
              },
              {
                "$ref": "#/$defs/candidateScope"
              }
            ]
          }
        ],
        "description": "Evidence. One completed check run attempt, verbatim from the provider."
      },
      "ejected": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "ejected"
              },
              "trigger": {
                "enum": [
                  "check_failed",
                  "merge_conflict",
                  "predecessor_ejected",
                  "base_moved",
                  "operator",
                  "timeout",
                  "policy",
                  "unknown"
                ]
              },
              "candidate_id": {
                "$ref": "#/$defs/mintedId"
              },
              "cause_event_ids": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/mintedId"
                },
                "uniqueItems": true
              }
            },
            "required": [
              "event_type",
              "trigger"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          }
        ],
        "description": "Control. The PR left the queue or a candidate involuntarily. trigger is what the queue reported, not a failure class."
      },
      "rerun_requested": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "rerun_requested"
              },
              "check_run_id": {
                "$ref": "#/$defs/providerId"
              },
              "check_key": {
                "$ref": "#/$defs/checkKey"
              },
              "run_attempt": {
                "$ref": "#/$defs/positiveInt"
              }
            },
            "required": [
              "event_type",
              "check_run_id",
              "check_key",
              "run_attempt"
            ]
          },
          {
            "oneOf": [
              {
                "allOf": [
                  {
                    "$ref": "#/$defs/prScope"
                  },
                  {
                    "$ref": "#/$defs/noCandidateLink"
                  }
                ]
              },
              {
                "$ref": "#/$defs/candidateScope"
              }
            ]
          }
        ],
        "description": "Control. A check run attempt was re-run; the rerun is a later check_run_completed."
      },
      "rebase_performed": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "rebase_performed"
              },
              "previous_head_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "previous_base_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "base_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "method": {
                "enum": [
                  "rebase",
                  "merge"
                ]
              },
              "had_conflicts": {
                "type": "boolean"
              }
            },
            "required": [
              "event_type",
              "previous_head_sha",
              "base_sha",
              "method"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Evidence. A head move onto a new base. Not a new attempt."
      },
      "repair_commit_pushed": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "repair_commit_pushed"
              },
              "parent_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "commits_pushed": {
                "$ref": "#/$defs/positiveInt"
              },
              "cause_event_ids": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/mintedId"
                },
                "uniqueItems": true
              },
              "cost_event_ids": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/identifier"
                }
              }
            },
            "required": [
              "event_type",
              "parent_sha"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Evidence. A repair push; actor is the commit author."
      },
      "recovery_decision": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "recovery_decision"
              },
              "policy": {
                "$ref": "#/$defs/policy"
              },
              "context": {
                "type": "object",
                "properties": {
                  "as_of": {
                    "$ref": "#/$defs/utcTimestamp"
                  },
                  "event_ids": {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/mintedId"
                    },
                    "uniqueItems": true
                  },
                  "failing_check_keys": {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/checkKey"
                    }
                  },
                  "failure_class": {
                    "type": "object",
                    "properties": {
                      "label": {
                        "$ref": "#/$defs/slug"
                      },
                      "labeler_version": {
                        "$ref": "#/$defs/version"
                      }
                    },
                    "required": [
                      "label",
                      "labeler_version"
                    ]
                  },
                  "attempt_number": {
                    "$ref": "#/$defs/positiveInt"
                  },
                  "base_moved_since_candidate": {
                    "type": "boolean"
                  },
                  "queue_depth": {
                    "$ref": "#/$defs/count"
                  },
                  "provenance": {
                    "type": "object",
                    "properties": {
                      "harness": {
                        "$ref": "#/$defs/harness"
                      },
                      "executed_model": {
                        "$ref": "#/$defs/model"
                      },
                      "task_type": {
                        "$ref": "#/$defs/slug"
                      }
                    },
                    "required": []
                  },
                  "flake_history": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "check_key": {
                          "$ref": "#/$defs/checkKey"
                        },
                        "window_runs": {
                          "$ref": "#/$defs/count"
                        },
                        "window_failures": {
                          "$ref": "#/$defs/count"
                        }
                      },
                      "required": [
                        "check_key",
                        "window_runs",
                        "window_failures"
                      ]
                    }
                  }
                },
                "required": [
                  "as_of",
                  "event_ids"
                ],
                "description": "Frozen decision-time snapshot. as_of <= observed_at and every event_id precedes the decision (validator and reducer rules)."
              },
              "available_actions": {
                "type": "array",
                "items": {
                  "$ref": "#/$defs/recoveryAction"
                },
                "minItems": 1,
                "uniqueItems": true
              },
              "chosen_action": {
                "$ref": "#/$defs/recoveryAction"
              },
              "propensity_source": {
                "$ref": "#/$defs/propensitySource"
              },
              "propensities": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "action": {
                      "$ref": "#/$defs/recoveryAction"
                    },
                    "probability": {
                      "$ref": "#/$defs/probability"
                    }
                  },
                  "required": [
                    "action",
                    "probability"
                  ]
                },
                "minItems": 1
              }
            },
            "required": [
              "event_type",
              "policy",
              "context",
              "available_actions",
              "chosen_action",
              "propensity_source"
            ]
          },
          {
            "oneOf": [
              {
                "allOf": [
                  {
                    "$ref": "#/$defs/prScope"
                  },
                  {
                    "$ref": "#/$defs/noCandidateLink"
                  }
                ]
              },
              {
                "$ref": "#/$defs/candidateScope"
              }
            ]
          },
          {
            "if": {
              "properties": {
                "propensity_source": {
                  "const": "none"
                }
              }
            },
            "then": {
              "not": {
                "required": [
                  "propensities"
                ]
              }
            },
            "else": {
              "required": [
                "propensities"
              ]
            }
          }
        ],
        "description": "Control. A self-contained recovery decision. propensities cover exactly available_actions and sum to 1 (validator rule); absent iff propensity_source is none."
      },
      "merged": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "merged"
              },
              "merge_commit_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "base_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "candidate_id": {
                "$ref": "#/$defs/mintedId"
              },
              "method": {
                "enum": [
                  "merge",
                  "squash",
                  "rebase"
                ]
              }
            },
            "required": [
              "event_type",
              "merge_commit_sha"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          }
        ],
        "description": "Control. The PR landed."
      },
      "dequeued": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "dequeued"
              },
              "trigger": {
                "enum": [
                  "pr_closed",
                  "head_changed",
                  "operator",
                  "policy",
                  "unknown"
                ]
              }
            },
            "required": [
              "event_type",
              "trigger"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Control. Left the queue; the run may enqueue again."
      },
      "abandoned": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "abandoned"
              },
              "trigger": {
                "enum": [
                  "retry_budget_exhausted",
                  "superseded",
                  "operator",
                  "policy",
                  "unknown"
                ]
              }
            },
            "required": [
              "event_type",
              "trigger"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Control. The run stops trying to land this PR."
      },
      "review_round_started": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "review_round_started"
              },
              "round": {
                "$ref": "#/$defs/positiveInt"
              },
              "reviewers": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "reviewer_key": {
                      "$ref": "#/$defs/slug"
                    },
                    "stage": {
                      "$ref": "#/$defs/slug"
                    },
                    "stage_attempt_id": {
                      "$ref": "#/$defs/mintedId"
                    },
                    "harness": {
                      "$ref": "#/$defs/harness"
                    },
                    "intended_model": {
                      "$ref": "#/$defs/model"
                    },
                    "challenge": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "reviewer_key",
                    "stage"
                  ],
                  "not": {
                    "anyOf": [
                      {
                        "required": [
                          "executed_model"
                        ]
                      },
                      {
                        "required": [
                          "executed_model_evidence"
                        ]
                      }
                    ]
                  }
                },
                "minItems": 1
              },
              "selection": {
                "type": "object",
                "properties": {
                  "policy": {
                    "$ref": "#/$defs/policy"
                  },
                  "propensity_source": {
                    "$ref": "#/$defs/propensitySource"
                  },
                  "propensity": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 1
                  }
                },
                "required": [
                  "policy",
                  "propensity_source"
                ],
                "if": {
                  "properties": {
                    "propensity_source": {
                      "const": "none"
                    }
                  }
                },
                "then": {
                  "not": {
                    "required": [
                      "propensity"
                    ]
                  }
                },
                "else": {
                  "required": [
                    "propensity"
                  ]
                }
              }
            },
            "required": [
              "event_type",
              "round",
              "reviewers"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          }
        ],
        "description": "Control. Which reviewers a round runs (intent) and the policy that chose them."
      },
      "review_round_completed": {
        "allOf": [
          {
            "$ref": "#/$defs/base"
          },
          {
            "type": "object",
            "properties": {
              "event_type": {
                "const": "review_round_completed"
              },
              "round": {
                "$ref": "#/$defs/positiveInt"
              },
              "first_round_head_sha": {
                "$ref": "#/$defs/gitSha"
              },
              "reviewers": {
                "type": "array",
                "items": {
                  "allOf": [
                    {
                      "$ref": "#/$defs/modelAttribution"
                    },
                    {
                      "type": "object",
                      "properties": {
                        "reviewer_key": {
                          "$ref": "#/$defs/slug"
                        },
                        "stage": {
                          "$ref": "#/$defs/slug"
                        },
                        "stage_attempt_id": {
                          "$ref": "#/$defs/mintedId"
                        }
                      },
                      "required": [
                        "reviewer_key",
                        "stage"
                      ]
                    }
                  ]
                },
                "minItems": 1
              },
              "findings": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "finding_id": {
                      "$ref": "#/$defs/mintedId"
                    },
                    "reviewer_key": {
                      "$ref": "#/$defs/slug"
                    },
                    "blocking": {
                      "type": "boolean"
                    },
                    "location": {
                      "enum": [
                        "first_round",
                        "changed_since_first_round",
                        "unchanged_since_first_round",
                        "unknown"
                      ]
                    },
                    "reflag_of": {
                      "$ref": "#/$defs/mintedId"
                    }
                  },
                  "required": [
                    "finding_id",
                    "reviewer_key",
                    "blocking",
                    "location"
                  ]
                }
              }
            },
            "required": [
              "event_type",
              "round",
              "first_round_head_sha",
              "reviewers",
              "findings"
            ]
          },
          {
            "$ref": "#/$defs/prScope"
          },
          {
            "$ref": "#/$defs/noCandidateLink"
          },
          {
            "if": {
              "properties": {
                "round": {
                  "const": 1
                }
              },
              "required": [
                "round"
              ]
            },
            "then": {
              "properties": {
                "findings": {
                  "items": {
                    "properties": {
                      "location": {
                        "enum": [
                          "first_round",
                          "unknown"
                        ]
                      }
                    },
                    "not": {
                      "required": [
                        "reflag_of"
                      ]
                    }
                  }
                }
              }
            },
            "else": {
              "properties": {
                "findings": {
                  "items": {
                    "properties": {
                      "location": {
                        "not": {
                          "const": "first_round"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        ],
        "description": "Evidence. What a round's reviewers found; findings: [] is an observed clean round."
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

// ../core/src/fixtures/task-cost/queue/builders.ts
function sha(n) {
  return `c0de${n.toString(16).padStart(36, "0")}`;
}
var TEND = { kind: "tend", component: "merge-lane" };
var WATCHDOG = { kind: "monitor", component: "ready-watchdog" };
var GITHUB = { kind: "github", app: "merge-queue" };
var ACTIONS = { kind: "github", app: "actions" };
var OPERATOR = { kind: "operator" };
function agent(executed, intended = executed, harness = "claude-code") {
  return {
    kind: "agent",
    harness,
    intended_model: intended,
    executed_model_evidence: "provider_response",
    executed_model: executed
  };
}
function qe(input) {
  const { t, ...rest } = input;
  return { schema_version: "queue_lifecycle_event/v1", observed_at: at(t), ...rest };
}
function pr(attempt2, prNumber, headSha) {
  return { attempt: attempt2, pr_number: prNumber, head_sha: headSha };
}
function decided(index, event17, decision2, reasons2) {
  if (event17.schema_version !== "queue_lifecycle_event/v1") {
    throw new TypeError(`stream entry ${index} is not a queue event`);
  }
  return {
    index,
    event_id: event17.event_id,
    event_type: event17.event_type,
    decision: decision2,
    ...reasons2 !== void 0 ? { reasons: reasons2 } : {}
  };
}
function decisionsFor(stream, overrides = {}) {
  const out = [];
  for (const [index, entry] of stream.entries()) {
    if (entry.schema_version !== "queue_lifecycle_event/v1") continue;
    const [decision2, reasons2] = overrides[index] ?? ["accepted"];
    out.push(decided(index, entry, decision2, reasons2));
  }
  return out;
}
function eventIds(...events17) {
  return events17.map((event17) => event17.event_id);
}

// ../core/src/fixtures/task-cost/queue/fixtures.ts
var BASE2 = sha(100);
function candidateState(candidate, ejected = [], merged = []) {
  const prepared = candidate;
  return {
    candidate_id: prepared.candidate_id,
    base_sha: prepared.base_sha,
    attempt_refs: prepared.attempt_refs,
    entries: prepared.entries,
    ejected_run_ids: ejected,
    merged_run_ids: merged
  };
}
var cleanMerge = (() => {
  const run = attempt({ kind: "run", id: mint(1001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const enqueued = qe({
    event_id: mint(1101),
    event_type: "enqueued",
    t: 10,
    actor: TEND,
    ...pr(runRef, 101, sha(1)),
    base_sha: BASE2,
    queue_depth: 0
  });
  const candidate = qe({
    event_id: mint(1102),
    event_type: "candidate_prepared",
    t: 20,
    actor: GITHUB,
    candidate_id: mint(1201),
    attempt_refs: [runRef],
    base_sha: BASE2,
    entries: [{ pr_number: 101, head_sha: sha(1) }],
    candidate_sha: sha(2)
  });
  const check = qe({
    event_id: mint(1103),
    event_type: "check_run_completed",
    t: 91,
    actor: ACTIONS,
    candidate_id: mint(1201),
    attempt_refs: [runRef],
    head_sha: sha(2),
    check_run_id: "5001",
    check_key: "ci-test",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "success",
    started_at: at(30),
    completed_at: at(90)
  });
  const merged = qe({
    event_id: mint(1104),
    event_type: "merged",
    t: 95,
    actor: GITHUB,
    ...pr(runRef, 101, sha(1)),
    merge_commit_sha: sha(2),
    base_sha: BASE2,
    candidate_id: mint(1201),
    method: "merge"
  });
  const settled = outcome(mint(1301), runRef, "succeeded", 100);
  const stream = [run, enqueued, candidate, check, merged, settled];
  return {
    name: "clean-merge",
    description: "One PR is enqueued, prepared as a single-entry candidate, passes its merge_group check and merges. The run settles after the merge.",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, candidate, check, merged),
      candidates: [candidateState(candidate, [], [run.id])]
    }
  };
})();
var flakeRerun = (() => {
  const run = attempt({ kind: "run", id: mint(2001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const candidateId = mint(2201);
  const scope = { candidate_id: candidateId, attempt_refs: [runRef] };
  const enqueued = qe({
    event_id: mint(2101),
    event_type: "enqueued",
    t: 10,
    actor: TEND,
    ...pr(runRef, 102, sha(1)),
    base_sha: BASE2
  });
  const candidate = qe({
    event_id: mint(2102),
    event_type: "candidate_prepared",
    t: 20,
    actor: GITHUB,
    ...scope,
    base_sha: BASE2,
    entries: [{ pr_number: 102, head_sha: sha(1) }],
    candidate_sha: sha(2)
  });
  const unit = qe({
    event_id: mint(2103),
    event_type: "check_run_completed",
    t: 81,
    actor: ACTIONS,
    ...scope,
    head_sha: sha(2),
    check_run_id: "6001",
    check_key: "ci-unit",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "success",
    started_at: at(25),
    completed_at: at(80)
  });
  const e2eFailed = qe({
    event_id: mint(2104),
    event_type: "check_run_completed",
    t: 121,
    actor: ACTIONS,
    ...scope,
    head_sha: sha(2),
    check_run_id: "6002",
    check_key: "ci-e2e",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "failure",
    started_at: at(25),
    completed_at: at(120)
  });
  const decision2 = qe({
    event_id: mint(2105),
    event_type: "recovery_decision",
    t: 125,
    actor: TEND,
    ...scope,
    policy: { name: "merge-lane-recovery", version: "1.0.0" },
    context: {
      as_of: at(121),
      event_ids: [e2eFailed.event_id],
      failing_check_keys: ["ci-e2e"],
      attempt_number: 1,
      base_moved_since_candidate: false,
      queue_depth: 0,
      flake_history: [{ check_key: "ci-e2e", window_runs: 20, window_failures: 3 }]
    },
    available_actions: ["retry", "rebase", "escalate"],
    chosen_action: "retry",
    propensity_source: "exact",
    propensities: [
      { action: "retry", probability: 0.8 },
      { action: "rebase", probability: 0.2 },
      { action: "escalate", probability: 0 }
    ]
  });
  const rerun = qe({
    event_id: mint(2106),
    event_type: "rerun_requested",
    t: 126,
    actor: TEND,
    ...scope,
    check_run_id: "6002",
    check_key: "ci-e2e",
    run_attempt: 1
  });
  const e2ePassed = qe({
    event_id: mint(2107),
    event_type: "check_run_completed",
    t: 231,
    actor: ACTIONS,
    ...scope,
    head_sha: sha(2),
    check_run_id: "6003",
    check_key: "ci-e2e",
    trigger: "merge_group",
    run_attempt: 2,
    conclusion: "success",
    started_at: at(130),
    completed_at: at(230)
  });
  const merged = qe({
    event_id: mint(2108),
    event_type: "merged",
    t: 240,
    actor: GITHUB,
    ...pr(runRef, 102, sha(1)),
    merge_commit_sha: sha(2),
    candidate_id: candidateId
  });
  const settled = outcome(mint(2301), runRef, "succeeded", 250);
  const stream = [run, enqueued, candidate, unit, e2eFailed, decision2, rerun, e2ePassed, merged, settled];
  return {
    name: "flake-rerun",
    description: "A merge_group e2e check fails on attempt 1. A randomized (exact-propensity) recovery decision chooses retry over rebase; the rerun is attempt 2 of the same check_key with a new check_run_id, passes, and the PR merges. Both attempts stay as facts.",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, candidate, unit, e2eFailed, decision2, rerun, e2ePassed, merged),
      candidates: [candidateState(candidate, [], [run.id])]
    }
  };
})();
var baseDriftRebase = (() => {
  const run = attempt({ kind: "run", id: mint(3001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const enqueued = qe({
    event_id: mint(3101),
    event_type: "enqueued",
    t: 10,
    actor: TEND,
    ...pr(runRef, 103, sha(1)),
    base_sha: BASE2
  });
  const first = qe({
    event_id: mint(3102),
    event_type: "candidate_prepared",
    t: 20,
    actor: TEND,
    candidate_id: mint(3201),
    attempt_refs: [runRef],
    base_sha: BASE2,
    entries: [{ pr_number: 103, head_sha: sha(1) }]
  });
  const ejected = qe({
    event_id: mint(3103),
    event_type: "ejected",
    t: 60,
    actor: TEND,
    ...pr(runRef, 103, sha(1)),
    trigger: "base_moved",
    candidate_id: mint(3201)
  });
  const decision2 = qe({
    event_id: mint(3104),
    event_type: "recovery_decision",
    t: 62,
    actor: TEND,
    ...pr(runRef, 103, sha(1)),
    policy: { name: "merge-lane-recovery", version: "1.0.0" },
    context: { as_of: at(60), event_ids: [ejected.event_id], attempt_number: 1, base_moved_since_candidate: true },
    available_actions: ["retry", "rebase", "escalate"],
    chosen_action: "rebase",
    propensity_source: "deterministic",
    propensities: [
      { action: "retry", probability: 0 },
      { action: "rebase", probability: 1 },
      { action: "escalate", probability: 0 }
    ]
  });
  const rebased = qe({
    event_id: mint(3105),
    event_type: "rebase_performed",
    t: 70,
    actor: TEND,
    ...pr(runRef, 103, sha(3)),
    previous_head_sha: sha(1),
    previous_base_sha: BASE2,
    base_sha: sha(101),
    method: "rebase",
    had_conflicts: false
  });
  const requeued = qe({
    event_id: mint(3106),
    event_type: "enqueued",
    t: 75,
    actor: TEND,
    ...pr(runRef, 103, sha(3)),
    base_sha: sha(101)
  });
  const second = qe({
    event_id: mint(3107),
    event_type: "candidate_prepared",
    t: 80,
    actor: TEND,
    candidate_id: mint(3202),
    attempt_refs: [runRef],
    base_sha: sha(101),
    entries: [{ pr_number: 103, head_sha: sha(3) }]
  });
  const check = qe({
    event_id: mint(3108),
    event_type: "check_run_completed",
    t: 141,
    actor: ACTIONS,
    ...pr(runRef, 103, sha(3)),
    check_run_id: "7001",
    check_key: "ci-test",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(140)
  });
  const merged = qe({
    event_id: mint(3109),
    event_type: "merged",
    t: 150,
    actor: TEND,
    ...pr(runRef, 103, sha(3)),
    merge_commit_sha: sha(4),
    base_sha: sha(101),
    candidate_id: mint(3202),
    method: "squash"
  });
  const settled = outcome(mint(3301), runRef, "succeeded", 160);
  const stream = [run, enqueued, first, ejected, decision2, rebased, requeued, second, check, merged, settled];
  return {
    name: "base-drift-rebase",
    description: "The base moves under a prepared candidate, so the PR is ejected (trigger base_moved). A deterministic decision rebases it; the head move is a rebase_performed evidence fact on the same run, not a new attempt. It re-enters in a new candidate on the new base and merges.",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, first, ejected, decision2, rebased, requeued, second, check, merged),
      candidates: [candidateState(first, [run.id]), candidateState(second, [], [run.id])]
    }
  };
})();
var realFailureRepair = (() => {
  const run = attempt({ kind: "run", id: mint(4001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const enqueued = qe({
    event_id: mint(4101),
    event_type: "enqueued",
    t: 10,
    actor: TEND,
    ...pr(runRef, 104, sha(1)),
    base_sha: BASE2
  });
  const first = qe({
    event_id: mint(4102),
    event_type: "candidate_prepared",
    t: 20,
    actor: TEND,
    candidate_id: mint(4201),
    attempt_refs: [runRef],
    base_sha: BASE2,
    entries: [{ pr_number: 104, head_sha: sha(1) }]
  });
  const failed = qe({
    event_id: mint(4103),
    event_type: "check_run_completed",
    t: 91,
    actor: ACTIONS,
    ...pr(runRef, 104, sha(1)),
    check_run_id: "8001",
    check_key: "ci-unit",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "failure",
    started_at: at(30),
    completed_at: at(90)
  });
  const ejected = qe({
    event_id: mint(4104),
    event_type: "ejected",
    t: 92,
    actor: TEND,
    ...pr(runRef, 104, sha(1)),
    trigger: "check_failed",
    candidate_id: mint(4201),
    cause_event_ids: [failed.event_id]
  });
  const decision2 = qe({
    event_id: mint(4105),
    event_type: "recovery_decision",
    t: 95,
    actor: TEND,
    ...pr(runRef, 104, sha(1)),
    policy: { name: "merge-lane-recovery", version: "1.0.0" },
    context: {
      as_of: at(92),
      event_ids: [failed.event_id, ejected.event_id],
      failing_check_keys: ["ci-unit"],
      failure_class: { label: "test-assertion", labeler_version: "mq-0.2.0" },
      attempt_number: 1,
      base_moved_since_candidate: false,
      queue_depth: 2,
      provenance: { harness: "claude-code", executed_model: "claude-sonnet-5-5", task_type: "bugfix" },
      flake_history: [{ check_key: "ci-unit", window_runs: 40, window_failures: 0 }]
    },
    available_actions: ["retry", "fix", "escalate"],
    chosen_action: "fix",
    propensity_source: "deterministic",
    propensities: [
      { action: "retry", probability: 0 },
      { action: "fix", probability: 1 },
      { action: "escalate", probability: 0 }
    ]
  });
  const repair = attempt({ kind: "stage_attempt", id: mint(4002), parent: run.id, stage: "repair", t: 100 });
  const repairRef = ref2(run.id, repair.id);
  const pushed = qe({
    event_id: mint(4106),
    event_type: "repair_commit_pushed",
    t: 300,
    actor: agent("claude-sonnet-5-5"),
    ...pr(repairRef, 104, sha(5)),
    parent_sha: sha(1),
    commits_pushed: 1,
    cause_event_ids: [decision2.event_id],
    cost_event_ids: ["evt-repair-0001", "evt-repair-0002"]
  });
  const repairDone = outcome(mint(4301), repairRef, "succeeded", 301);
  const requeued = qe({
    event_id: mint(4107),
    event_type: "enqueued",
    t: 310,
    actor: TEND,
    ...pr(runRef, 104, sha(5)),
    base_sha: BASE2
  });
  const second = qe({
    event_id: mint(4108),
    event_type: "candidate_prepared",
    t: 320,
    actor: TEND,
    candidate_id: mint(4202),
    attempt_refs: [runRef],
    base_sha: BASE2,
    entries: [{ pr_number: 104, head_sha: sha(5) }]
  });
  const passed = qe({
    event_id: mint(4109),
    event_type: "check_run_completed",
    t: 391,
    actor: ACTIONS,
    ...pr(runRef, 104, sha(5)),
    check_run_id: "8002",
    check_key: "ci-unit",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "success",
    started_at: at(330),
    completed_at: at(390)
  });
  const merged = qe({
    event_id: mint(4110),
    event_type: "merged",
    t: 400,
    actor: TEND,
    ...pr(runRef, 104, sha(5)),
    merge_commit_sha: sha(6),
    candidate_id: mint(4202),
    method: "squash"
  });
  const settled = outcome(mint(4302), runRef, "succeeded", 410);
  const stream = [
    run,
    enqueued,
    first,
    failed,
    ejected,
    decision2,
    repair,
    pushed,
    repairDone,
    requeued,
    second,
    passed,
    merged,
    settled
  ];
  return {
    name: "real-failure-repair",
    description: "A unit check fails for real; the PR is ejected with the failed check as cause. A recovery decision snapshots only what preceded it and chooses fix. A repair stage attempt pushes a commit attributed to the agent with its provider-observed model and the cost events of the repair; the PR re-enters and merges.",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, first, failed, ejected, decision2, pushed, requeued, second, passed, merged),
      candidates: [candidateState(first, [run.id]), candidateState(second, [], [run.id])]
    }
  };
})();
var cumulativePredecessorEjects = (() => {
  const runA = attempt({ kind: "run", id: mint(5001), parent: TASK, t: 0 });
  const runB = attempt({ kind: "run", id: mint(5002), parent: OTHER_TASK, task: OTHER_TASK, t: 1 });
  const refA = ref2(runA.id);
  const refB = ref2(runB.id, void 0, OTHER_TASK);
  const enqA = qe({ event_id: mint(5101), event_type: "enqueued", t: 10, actor: TEND, ...pr(refA, 105, sha(1)), queue_depth: 0 });
  const enqB = qe({ event_id: mint(5102), event_type: "enqueued", t: 11, actor: TEND, ...pr(refB, 106, sha(2)), queue_depth: 1 });
  const c1 = mint(5201);
  const cumulative = qe({
    event_id: mint(5103),
    event_type: "candidate_prepared",
    t: 20,
    actor: GITHUB,
    candidate_id: c1,
    attempt_refs: [refA, refB],
    base_sha: BASE2,
    entries: [{ pr_number: 105, head_sha: sha(1) }, { pr_number: 106, head_sha: sha(2) }],
    candidate_sha: sha(3)
  });
  const failed = qe({
    event_id: mint(5104),
    event_type: "check_run_completed",
    t: 91,
    actor: ACTIONS,
    candidate_id: c1,
    attempt_refs: [refA, refB],
    head_sha: sha(3),
    check_run_id: "9001",
    check_key: "ci-unit",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "failure",
    completed_at: at(90)
  });
  const ejectA = qe({
    event_id: mint(5105),
    event_type: "ejected",
    t: 92,
    actor: GITHUB,
    ...pr(refA, 105, sha(1)),
    trigger: "check_failed",
    candidate_id: c1,
    cause_event_ids: [failed.event_id]
  });
  const ejectB = qe({
    event_id: mint(5106),
    event_type: "ejected",
    t: 92,
    actor: GITHUB,
    ...pr(refB, 106, sha(2)),
    trigger: "predecessor_ejected",
    candidate_id: c1,
    cause_event_ids: [ejectA.event_id]
  });
  const wrongComposition = qe({
    event_id: mint(5107),
    event_type: "check_run_completed",
    t: 95,
    actor: ACTIONS,
    candidate_id: c1,
    attempt_refs: [refB],
    head_sha: sha(3),
    check_run_id: "9002",
    check_key: "ci-lint",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(94)
  });
  const c2 = mint(5202);
  const alone = qe({
    event_id: mint(5108),
    event_type: "candidate_prepared",
    t: 100,
    actor: GITHUB,
    candidate_id: c2,
    attempt_refs: [refB],
    base_sha: BASE2,
    entries: [{ pr_number: 106, head_sha: sha(2) }],
    candidate_sha: sha(4)
  });
  const passed = qe({
    event_id: mint(5109),
    event_type: "check_run_completed",
    t: 171,
    actor: ACTIONS,
    candidate_id: c2,
    attempt_refs: [refB],
    head_sha: sha(4),
    check_run_id: "9003",
    check_key: "ci-unit",
    trigger: "merge_group",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(170)
  });
  const staleMerge = qe({
    event_id: mint(5110),
    event_type: "merged",
    t: 175,
    actor: GITHUB,
    ...pr(refB, 106, sha(2)),
    merge_commit_sha: sha(3),
    candidate_id: c1
  });
  const merged = qe({
    event_id: mint(5111),
    event_type: "merged",
    t: 176,
    actor: GITHUB,
    ...pr(refB, 106, sha(2)),
    merge_commit_sha: sha(4),
    candidate_id: c2
  });
  const settled = outcome(mint(5301), refB, "succeeded", 180);
  const stream = [
    runA,
    runB,
    enqA,
    enqB,
    cumulative,
    failed,
    ejectA,
    ejectB,
    wrongComposition,
    alone,
    passed,
    staleMerge,
    merged,
    settled
  ];
  return {
    name: "cumulative-candidate-predecessor-ejects",
    description: "Two PRs from two tasks form one cumulative candidate (B is tested on top of A). The candidate check fails; A is ejected for the failure and B because its predecessor was ejected. B lands alone in a new candidate. A check naming a different composition under the old candidate id is rejected, as is a merge claimed under the candidate B was ejected from.",
    stream,
    expected: {
      decisions: decisionsFor(stream, {
        [stream.indexOf(wrongComposition)]: ["rejected", ["candidate_mismatch"]],
        [stream.indexOf(staleMerge)]: ["rejected", ["ejected_from_candidate"]]
      }),
      accepted_event_ids: eventIds(enqA, enqB, cumulative, failed, ejectA, ejectB, alone, passed, merged),
      candidates: [candidateState(cumulative, [runA.id, runB.id]), candidateState(alone, [], [runB.id])]
    }
  };
})();
var operatorManualCommit = (() => {
  const run = attempt({ kind: "run", id: mint(6001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const enqueued = qe({ event_id: mint(6101), event_type: "enqueued", t: 10, actor: TEND, ...pr(runRef, 107, sha(1)) });
  const failed = qe({
    event_id: mint(6102),
    event_type: "check_run_completed",
    t: 61,
    actor: ACTIONS,
    ...pr(runRef, 107, sha(1)),
    check_run_id: "10001",
    check_key: "ci-typecheck",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "failure",
    completed_at: at(60)
  });
  const dequeued = qe({
    event_id: mint(6103),
    event_type: "dequeued",
    t: 62,
    actor: TEND,
    ...pr(runRef, 107, sha(1)),
    trigger: "policy"
  });
  const escalate = qe({
    event_id: mint(6104),
    event_type: "recovery_decision",
    t: 65,
    actor: WATCHDOG,
    ...pr(runRef, 107, sha(1)),
    policy: { name: "ready-watchdog", version: "3.2.0" },
    context: { as_of: at(62), event_ids: [failed.event_id, dequeued.event_id], failing_check_keys: ["ci-typecheck"], attempt_number: 3 },
    available_actions: ["retry", "fix", "escalate"],
    chosen_action: "escalate",
    propensity_source: "deterministic",
    propensities: [
      { action: "retry", probability: 0 },
      { action: "fix", probability: 0 },
      { action: "escalate", probability: 1 }
    ]
  });
  const manual = qe({
    event_id: mint(6105),
    event_type: "repair_commit_pushed",
    t: 900,
    actor: OPERATOR,
    ...pr(runRef, 107, sha(7)),
    parent_sha: sha(1),
    commits_pushed: 2,
    cause_event_ids: [escalate.event_id]
  });
  const requeued = qe({ event_id: mint(6106), event_type: "enqueued", t: 910, actor: OPERATOR, ...pr(runRef, 107, sha(7)) });
  const passed = qe({
    event_id: mint(6107),
    event_type: "check_run_completed",
    t: 961,
    actor: ACTIONS,
    ...pr(runRef, 107, sha(7)),
    check_run_id: "10002",
    check_key: "ci-typecheck",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(960)
  });
  const merged = qe({
    event_id: mint(6108),
    event_type: "merged",
    t: 970,
    actor: TEND,
    ...pr(runRef, 107, sha(7)),
    merge_commit_sha: sha(8)
  });
  const settled = outcome(mint(6301), runRef, "succeeded", 980);
  const stream = [run, enqueued, failed, dequeued, escalate, manual, requeued, passed, merged, settled];
  return {
    name: "operator-manual-commit",
    description: "The watchdog escalates after a third failure. A human pushes the fix: the repair commit is attributed to the operator (no model, no stage attempt), so the agent is never credited with it. The PR then lands without a merge candidate.",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(enqueued, failed, dequeued, escalate, manual, requeued, passed, merged),
      candidates: []
    }
  };
})();
var crashResumeDuplicate = (() => {
  const run1 = attempt({ kind: "run", id: mint(7001), parent: TASK, t: 0 });
  const ref1 = ref2(run1.id);
  const enqueued = qe({
    event_id: mint(7101),
    event_type: "enqueued",
    t: 10,
    actor: TEND,
    ...pr(ref1, 108, sha(1)),
    queue_depth: 1
  });
  const candidate = qe({
    event_id: mint(7102),
    event_type: "candidate_prepared",
    t: 20,
    actor: TEND,
    candidate_id: mint(7201),
    attempt_refs: [ref1],
    base_sha: BASE2,
    entries: [{ pr_number: 108, head_sha: sha(1) }]
  });
  const check = qe({
    event_id: mint(7103),
    event_type: "check_run_completed",
    t: 81,
    actor: ACTIONS,
    ...pr(ref1, 108, sha(1)),
    check_run_id: "11001",
    check_key: "ci-test",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(80)
  });
  const replayEnqueued = { ...enqueued };
  const replayCandidate = JSON.parse(JSON.stringify(candidate));
  const reorderedCheck = Object.fromEntries(Object.entries(check).reverse());
  const conflicting = qe({
    event_id: mint(7101),
    event_type: "enqueued",
    t: 85,
    actor: TEND,
    ...pr(ref1, 108, sha(1)),
    queue_depth: 0
  });
  const run2 = attempt({ kind: "run", id: mint(7002), parent: TASK, t: 100 });
  const ref22 = ref2(run2.id);
  const staleMerge = qe({
    event_id: mint(7104),
    event_type: "merged",
    t: 110,
    actor: TEND,
    ...pr(ref1, 108, sha(1)),
    merge_commit_sha: sha(2)
  });
  const lateCheck = qe({
    event_id: mint(7105),
    event_type: "check_run_completed",
    t: 111,
    actor: ACTIONS,
    ...pr(ref1, 108, sha(1)),
    check_run_id: "11002",
    check_key: "ci-lint",
    trigger: "pull_request",
    run_attempt: 1,
    conclusion: "success",
    completed_at: at(79)
  });
  const enqueued2 = qe({ event_id: mint(7106), event_type: "enqueued", t: 200, actor: TEND, ...pr(ref22, 108, sha(9)) });
  const merged2 = qe({
    event_id: mint(7107),
    event_type: "merged",
    t: 260,
    actor: TEND,
    ...pr(ref22, 108, sha(9)),
    merge_commit_sha: sha(10)
  });
  const settled = outcome(mint(7301), ref22, "succeeded", 270);
  const lateDequeue = qe({
    event_id: mint(7108),
    event_type: "dequeued",
    t: 280,
    actor: TEND,
    ...pr(ref22, 108, sha(9)),
    trigger: "pr_closed"
  });
  const stream = [
    run1,
    enqueued,
    candidate,
    check,
    replayEnqueued,
    replayCandidate,
    reorderedCheck,
    conflicting,
    run2,
    staleMerge,
    lateCheck,
    enqueued2,
    merged2,
    settled,
    lateDequeue
  ];
  return {
    name: "crash-resume-duplicate",
    description: "After a crash the writer re-emits three events (one with reordered keys): each is a duplicate by event_id and changes nothing. A different fact under a reused event_id is rejected, never overwriting. After a relaunch, a control write from the old run is stale while its late check-run evidence is kept; once run 2 settles, a late dequeue is rejected.",
    stream,
    expected: {
      decisions: decisionsFor(stream, {
        [stream.indexOf(replayEnqueued)]: ["duplicate"],
        [stream.indexOf(replayCandidate)]: ["duplicate"],
        [stream.indexOf(reorderedCheck)]: ["duplicate"],
        [stream.indexOf(conflicting)]: ["rejected", ["event_id_conflict"]],
        [stream.indexOf(staleMerge)]: ["rejected", ["stale_run"]],
        [stream.indexOf(lateDequeue)]: ["rejected", ["settled"]]
      }),
      accepted_event_ids: eventIds(enqueued, candidate, check, lateCheck, enqueued2, merged2),
      candidates: [candidateState(candidate)]
    }
  };
})();
var multiRoundReview = (() => {
  const run = attempt({ kind: "run", id: mint(8001), parent: TASK, t: 0 });
  const runRef = ref2(run.id);
  const reviewFlow = { kind: "monitor", component: "review-flow" };
  const r1Correctness = attempt({ kind: "stage_attempt", id: mint(8002), parent: run.id, stage: "review", t: 10 });
  const r1Security = attempt({ kind: "stage_attempt", id: mint(8003), parent: run.id, stage: "security-review", t: 10 });
  const started1 = qe({
    event_id: mint(8101),
    event_type: "review_round_started",
    t: 11,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(1)),
    round: 1,
    reviewers: [
      { reviewer_key: "correctness", stage: "review", stage_attempt_id: r1Correctness.id, harness: "codex", intended_model: "gpt-5.5" },
      {
        reviewer_key: "security",
        stage: "security-review",
        stage_attempt_id: r1Security.id,
        harness: "claude-code",
        intended_model: "claude-opus-5-5",
        challenge: true
      }
    ],
    selection: { policy: { name: "review-intensity", version: "0.3.0" }, propensity_source: "exact", propensity: 0.25 }
  });
  const f1 = mint(8401);
  const f2 = mint(8402);
  const completed1 = qe({
    event_id: mint(8102),
    event_type: "review_round_completed",
    t: 200,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(1)),
    round: 1,
    first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: "correctness",
        stage: "review",
        stage_attempt_id: r1Correctness.id,
        harness: "codex",
        intended_model: "gpt-5.5",
        executed_model_evidence: "provider_response",
        executed_model: "gpt-5.5-2026-08-01"
      },
      {
        reviewer_key: "security",
        stage: "security-review",
        stage_attempt_id: r1Security.id,
        harness: "claude-code",
        intended_model: "claude-opus-5-5",
        executed_model_evidence: "not_observed"
      }
    ],
    findings: [
      { finding_id: f1, reviewer_key: "correctness", blocking: true, location: "first_round" },
      { finding_id: f2, reviewer_key: "security", blocking: false, location: "first_round" }
    ]
  });
  const fix1 = qe({
    event_id: mint(8103),
    event_type: "repair_commit_pushed",
    t: 400,
    actor: agent("claude-sonnet-5-5"),
    ...pr(runRef, 109, sha(11)),
    parent_sha: sha(1),
    cause_event_ids: [completed1.event_id]
  });
  const r2Correctness = attempt({ kind: "stage_attempt", id: mint(8004), parent: run.id, stage: "review", t: 410 });
  const started2 = qe({
    event_id: mint(8104),
    event_type: "review_round_started",
    t: 411,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(11)),
    round: 2,
    reviewers: [{ reviewer_key: "correctness", stage: "review", stage_attempt_id: r2Correctness.id, harness: "codex", intended_model: "gpt-5.5" }],
    selection: { policy: { name: "review-intensity", version: "0.3.0" }, propensity_source: "deterministic", propensity: 1 }
  });
  const completed2 = qe({
    event_id: mint(8105),
    event_type: "review_round_completed",
    t: 600,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(11)),
    round: 2,
    first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: "correctness",
        stage: "review",
        stage_attempt_id: r2Correctness.id,
        harness: "codex",
        intended_model: "gpt-5.5",
        executed_model_evidence: "provider_response",
        executed_model: "gpt-5.5-2026-08-01"
      }
    ],
    findings: [
      { finding_id: mint(8403), reviewer_key: "correctness", blocking: true, location: "unchanged_since_first_round", reflag_of: f2 },
      { finding_id: mint(8404), reviewer_key: "correctness", blocking: false, location: "unchanged_since_first_round" },
      { finding_id: mint(8405), reviewer_key: "correctness", blocking: true, location: "changed_since_first_round" }
    ]
  });
  const fix2 = qe({
    event_id: mint(8106),
    event_type: "repair_commit_pushed",
    t: 800,
    actor: agent("claude-sonnet-5-5"),
    ...pr(runRef, 109, sha(12)),
    parent_sha: sha(11),
    cause_event_ids: [completed2.event_id]
  });
  const r3Correctness = attempt({ kind: "stage_attempt", id: mint(8005), parent: run.id, stage: "review", t: 810 });
  const started3 = qe({
    event_id: mint(8107),
    event_type: "review_round_started",
    t: 811,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(12)),
    round: 3,
    reviewers: [{ reviewer_key: "correctness", stage: "review", stage_attempt_id: r3Correctness.id, harness: "codex", intended_model: "gpt-5.5" }]
  });
  const completed3 = qe({
    event_id: mint(8108),
    event_type: "review_round_completed",
    t: 950,
    actor: reviewFlow,
    ...pr(runRef, 109, sha(12)),
    round: 3,
    first_round_head_sha: sha(1),
    reviewers: [
      {
        reviewer_key: "correctness",
        stage: "review",
        stage_attempt_id: r3Correctness.id,
        harness: "codex",
        intended_model: "gpt-5.5",
        executed_model_evidence: "provider_response",
        executed_model: "gpt-5.5-2026-08-01"
      }
    ],
    findings: []
  });
  const stream = [
    run,
    r1Correctness,
    r1Security,
    started1,
    completed1,
    fix1,
    r2Correctness,
    started2,
    completed2,
    fix2,
    r3Correctness,
    started3,
    completed3
  ];
  return {
    name: "multi-round-review",
    description: "Three review rounds. Round 1 runs two reviewers chosen with an exact propensity; the challenge reviewer has no observed model, so none is recorded. Round 2 re-flags a round-1 finding and raises a new one on code round 1 already saw (unchanged_since_first_round), plus one on changed lines. Round 3 is an observed clean round (findings: []).",
    stream,
    expected: {
      decisions: decisionsFor(stream),
      accepted_event_ids: eventIds(started1, completed1, fix1, started2, completed2, fix2, started3, completed3),
      candidates: []
    }
  };
})();

// ../core/src/fixtures/routing-outcome.ts
var descriptor = {
  task_type: "bugfix",
  language: "typescript",
  domain: "backend",
  complexity: 3,
  repo_size_bucket: "large",
  files_touched_bucket: "2_5",
  description_length_bucket: "medium",
  is_greenfield: false,
  is_migration: false,
  requires_tests: true,
  cross_service: false,
  ui_heavy: false,
  risk_level: "medium"
};
var pool = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "glm-5.3-flash"];
function routerRow(routing, success) {
  return {
    schema_version: "technical_task_router_row/v3",
    task_descriptor: descriptor,
    allowed_models: pool,
    available_models: { planner_models: pool, coder_models: pool, reviewer_models: pool },
    budget_usd: 5,
    actual_cost_usd: 2.29,
    wall_clock_seconds: 1840,
    success_under_budget: success,
    completion_result: success ? "success" : "failure",
    outcome_labels: {
      budget_label: "under_budget",
      cost_label: "medium",
      time_label: "slow",
      success_label: success ? "success" : "failure"
    },
    candidate_pool: { scenario_id: "wavemill-default", scenario_kind: "production", pool_size: pool.length },
    sparse_cell: { cell_id: "bugfix-typescript", descriptor_signature: "bugfix|typescript|backend", observed_count: 41, is_sparse: false },
    observed_at: "2026-10-30T18:00:00.000Z",
    harness: "wavemill",
    ...routing
  };
}
var followedRecommendationRoutingFixture = routerRow(
  {
    inference_log_id: "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a70",
    overrides: [],
    selected_models: { planner: "claude-sonnet-4-6", coder: "claude-sonnet-4-6", reviewer: "claude-sonnet-4-6" }
  },
  true
);
var escalationOverrideRoutingFixture = routerRow(
  {
    inference_log_id: "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a71",
    overrides: [
      { role: "coder", source: "escalation", from: "claude-haiku-4-5", to: "glm-5.3-flash", reason: "stage_failed" }
    ],
    selected_models: { coder: "glm-5.3-flash", reviewer: "claude-sonnet-4-6" }
  },
  false
);
var challengeOverrideRoutingFixture = routerRow(
  {
    inference_log_id: "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a72",
    overrides: [
      { role: "coder", source: "challenge", from: "claude-opus-4-7", to: "claude-haiku-4-5", reason: "challenge_arm" }
    ],
    selected_models: { coder: "claude-haiku-4-5", reviewer: "claude-sonnet-4-6" }
  },
  false
);
var operatorRerouteRoutingFixture = routerRow(
  {
    inference_log_id: "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a73",
    overrides: [
      { role: "reviewer", source: "operator", from: "claude-haiku-4-5", to: "claude-opus-4-7", reason: "operator_reroute" }
    ],
    selected_models: { coder: "claude-sonnet-4-6", reviewer: "claude-opus-4-7" }
  },
  true
);
var unroutedTelemetryRoutingFixture = routerRow(
  { selected_models: { coder: "claude-sonnet-4-6", reviewer: "claude-sonnet-4-6" } },
  true
);

// ../core/src/contribution/schema.ts
var TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION = "technical_task_router_row/v1";
var TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2 = "technical_task_router_row/v2";
var TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3 = "technical_task_router_row/v3";
var HARNESS_OUTCOME_ROW_SCHEMA_VERSION = "harness_outcome_row/v1";
var HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2 = "harness_outcome_row/v2";
var ROUTE_ROLES = ["planner", "coder", "reviewer"];
var ROUTE_OVERRIDE_SOURCES = ["escalation", "launchability", "challenge", "operator"];
var RECOMMENDATION_COPY_KEYS = Object.freeze([
  "recommended_model",
  "recommended_models",
  "recommended_model_id",
  "recommendation",
  "recommendation_accepted",
  "recommendedmodel",
  "recommendedmodels",
  "recommendationaccepted"
]);
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
var HARNESS_OUTCOME_ROW_V2_FIELDS = Object.freeze([
  ...HARNESS_OUTCOME_ROW_FIELDS,
  "overrides"
]);
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  "prompt",
  "messages",
  "task_text",
  "raw_input",
  "eval_record",
  "originalprompt",
  "original_prompt",
  "description",
  "issue_body"
]);
var ContributionValidationError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ContributionValidationError";
    this.code = code;
  }
};
function isPlainObject5(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isIsoDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function hasOnlyAllowedKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isTechnicalTaskRouterSelectedModels(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["planner", "coder", "reviewer"])) {
    return false;
  }
  if (typeof value.coder !== "string" || typeof value.reviewer !== "string") {
    return false;
  }
  return value.planner === void 0 || typeof value.planner === "string";
}
function isRoleAvailableModels(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["planner_models", "coder_models", "reviewer_models"])) {
    return false;
  }
  return isStringArray(value.planner_models) && isStringArray(value.coder_models) && isStringArray(value.reviewer_models);
}
function isOutcomeLabels(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["budget_label", "cost_label", "time_label", "success_label"])) {
    return false;
  }
  return (value.budget_label === "under_budget" || value.budget_label === "over_budget" || value.budget_label === "unknown") && (value.cost_label === "free" || value.cost_label === "low" || value.cost_label === "medium" || value.cost_label === "high" || value.cost_label === "unknown") && (value.time_label === "fast" || value.time_label === "medium" || value.time_label === "slow" || value.time_label === "unknown") && (value.success_label === "success" || value.success_label === "failure");
}
function isCandidatePoolMetadata(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["scenario_id", "scenario_kind", "pool_size", "baseline_model"])) {
    return false;
  }
  return typeof value.scenario_id === "string" && typeof value.scenario_kind === "string" && isFiniteNonNegativeNumber(value.pool_size) && (value.baseline_model === void 0 || typeof value.baseline_model === "string");
}
function isSparseCellMetadata(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["cell_id", "descriptor_signature", "observed_count", "is_sparse"])) {
    return false;
  }
  return typeof value.cell_id === "string" && typeof value.descriptor_signature === "string" && isFiniteNonNegativeNumber(value.observed_count) && typeof value.is_sparse === "boolean";
}
function assertNoForbiddenKeys2(value, path4 = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys2(item, [...path4, String(index)]);
    }
    return;
  }
  if (!isPlainObject5(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      throw new ContributionValidationError(
        "forbidden_field",
        `Forbidden field at ${[...path4, key].join(".")}`
      );
    }
    assertNoForbiddenKeys2(child, [...path4, key]);
  }
}
var OUTCOME_DIAGNOSTIC_VALUES = /* @__PURE__ */ new Set([
  "eligible",
  "ineligible_missing_outcome",
  "ineligible_failed_outcome",
  "unknown"
]);
var OUTCOME_SOURCE_VALUES = /* @__PURE__ */ new Set([
  "feature_outcome_artifact",
  "reconstructed",
  "unknown"
]);
function isSubmitDataContributionRow(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, [
    "success_under_budget",
    "inputs",
    "actual_cost_usd",
    "wall_clock_seconds",
    "task_id",
    "harness",
    "outcome_diagnostic",
    "outcome_source",
    "outcome_artifact_present",
    "outcome_artifact_valid",
    "outcome_artifact_used",
    "outcome_missing_fields",
    "outcome_invalid_fields",
    "outcome_failure_reason"
  ])) {
    return false;
  }
  if (typeof value.success_under_budget !== "boolean") {
    return false;
  }
  if (value.inputs !== void 0 && !isPlainObject5(value.inputs)) {
    return false;
  }
  if (value.actual_cost_usd !== void 0 && value.actual_cost_usd !== null && !isFiniteNonNegativeNumber(value.actual_cost_usd)) {
    return false;
  }
  if (value.wall_clock_seconds !== void 0 && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }
  if (value.task_id !== void 0 && typeof value.task_id !== "string") {
    return false;
  }
  if (value.harness !== void 0 && typeof value.harness !== "string") {
    return false;
  }
  if (value.outcome_diagnostic !== void 0 && !OUTCOME_DIAGNOSTIC_VALUES.has(value.outcome_diagnostic)) {
    return false;
  }
  if (value.outcome_source !== void 0 && !OUTCOME_SOURCE_VALUES.has(value.outcome_source)) {
    return false;
  }
  if (value.outcome_artifact_present !== void 0 && typeof value.outcome_artifact_present !== "boolean") {
    return false;
  }
  if (value.outcome_artifact_valid !== void 0 && typeof value.outcome_artifact_valid !== "boolean") {
    return false;
  }
  if (value.outcome_artifact_used !== void 0 && typeof value.outcome_artifact_used !== "boolean") {
    return false;
  }
  if (value.outcome_missing_fields !== void 0 && !isStringArray(value.outcome_missing_fields)) {
    return false;
  }
  if (value.outcome_invalid_fields !== void 0 && !isStringArray(value.outcome_invalid_fields)) {
    return false;
  }
  if (value.outcome_failure_reason !== void 0 && typeof value.outcome_failure_reason !== "string") {
    return false;
  }
  return !("schema_version" in value);
}
function isTechnicalTaskRouterContributionRowV1(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (value.schema_version !== TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, [
    "schema_version",
    "task_descriptor",
    "allowed_models",
    "selected_models",
    "budget_usd",
    "actual_cost_usd",
    "wall_clock_seconds",
    "success_under_budget",
    "completion_result",
    "scorer_ref",
    "observed_at",
    "task_id",
    "harness",
    "candidate_pools",
    "current_candidate_pools",
    "audit_metadata",
    "scenario",
    "scenarios"
  ])) {
    return false;
  }
  if (!isPlainObject5(value.task_descriptor)) {
    return false;
  }
  if (!isStringArray(value.allowed_models)) {
    return false;
  }
  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }
  if (value.budget_usd !== void 0 && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }
  if (value.actual_cost_usd !== void 0 && value.actual_cost_usd !== null && !isFiniteNonNegativeNumber(value.actual_cost_usd)) {
    return false;
  }
  if (value.wall_clock_seconds !== void 0 && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }
  if (typeof value.success_under_budget !== "boolean") {
    return false;
  }
  if (value.completion_result !== "success" && value.completion_result !== "failure") {
    return false;
  }
  if (!isIsoDateString(value.observed_at)) {
    return false;
  }
  if (value.scorer_ref !== void 0 && typeof value.scorer_ref !== "string") {
    return false;
  }
  if (value.task_id !== void 0 && typeof value.task_id !== "string") {
    return false;
  }
  if (value.harness !== void 0 && typeof value.harness !== "string") {
    return false;
  }
  return true;
}
function isTechnicalTaskRouterContributionRowV2(value) {
  return isRichRouterRow(value, TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2, []);
}
function isTechnicalTaskRouterContributionRowV3(value) {
  return isRichRouterRow(value, TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3, ["inference_log_id", "overrides"]) && routingOutcomeErrors(value).length === 0;
}
function isRichRouterRow(value, version, extraKeys) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (value.schema_version !== version) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, [
    ...extraKeys,
    "schema_version",
    "task_descriptor",
    "allowed_models",
    "selected_models",
    "available_models",
    "budget_usd",
    "actual_cost_usd",
    "wall_clock_seconds",
    "success_under_budget",
    "completion_result",
    "outcome_labels",
    "candidate_pool",
    "sparse_cell",
    "scorer_ref",
    "observed_at",
    "task_id",
    "harness",
    "candidate_pools",
    "current_candidate_pools",
    "audit_metadata",
    "scenario",
    "scenarios"
  ])) {
    return false;
  }
  if (!isPlainObject5(value.task_descriptor)) {
    return false;
  }
  if (!isStringArray(value.allowed_models)) {
    return false;
  }
  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }
  if (!isRoleAvailableModels(value.available_models)) {
    return false;
  }
  if (value.budget_usd !== void 0 && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }
  if (value.actual_cost_usd !== void 0 && value.actual_cost_usd !== null && !isFiniteNonNegativeNumber(value.actual_cost_usd)) {
    return false;
  }
  if (value.wall_clock_seconds !== void 0 && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }
  if (typeof value.success_under_budget !== "boolean") {
    return false;
  }
  if (value.completion_result !== "success" && value.completion_result !== "failure") {
    return false;
  }
  if (!isOutcomeLabels(value.outcome_labels)) {
    return false;
  }
  if (!isCandidatePoolMetadata(value.candidate_pool)) {
    return false;
  }
  if (!isSparseCellMetadata(value.sparse_cell)) {
    return false;
  }
  if (!isIsoDateString(value.observed_at)) {
    return false;
  }
  if (value.scorer_ref !== void 0 && typeof value.scorer_ref !== "string") {
    return false;
  }
  if (value.task_id !== void 0 && typeof value.task_id !== "string") {
    return false;
  }
  if (value.harness !== void 0 && typeof value.harness !== "string") {
    return false;
  }
  return true;
}
function isHarnessOutcomeRowMetadata(value) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["harness", "sdk_version"])) {
    return false;
  }
  return (value.harness === void 0 || typeof value.harness === "string") && (value.sdk_version === void 0 || typeof value.sdk_version === "string");
}
function isHarnessOutcomeRowV1(value) {
  return isHarnessRow(value, HARNESS_OUTCOME_ROW_SCHEMA_VERSION, HARNESS_OUTCOME_ROW_FIELDS);
}
function isHarnessOutcomeRowV2(value) {
  return isHarnessRow(value, HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2, HARNESS_OUTCOME_ROW_V2_FIELDS) && routingOutcomeErrors(value).length === 0;
}
function isHarnessRow(value, version, fields) {
  if (!isPlainObject5(value)) {
    return false;
  }
  if (value.schema_version !== version) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, fields)) {
    return false;
  }
  if (!isPlainObject5(value.task_descriptor) || Object.keys(value.task_descriptor).length === 0) {
    return false;
  }
  if (!isStringArray(value.allowed_models) || value.allowed_models.length === 0) {
    return false;
  }
  if (!isTechnicalTaskRouterSelectedModels(value.selected_models)) {
    return false;
  }
  if (value.budget_usd !== void 0 && !isFiniteNonNegativeNumber(value.budget_usd)) {
    return false;
  }
  if (value.actual_cost_usd !== void 0 && !isFiniteNonNegativeNumber(value.actual_cost_usd)) {
    return false;
  }
  if (value.wall_clock_seconds !== void 0 && !isFiniteNonNegativeNumber(value.wall_clock_seconds)) {
    return false;
  }
  if (value.completion_result !== "success" && value.completion_result !== "failure") {
    return false;
  }
  if (value.success_under_budget !== void 0 && typeof value.success_under_budget !== "boolean") {
    return false;
  }
  if (value.inference_log_id !== void 0 && typeof value.inference_log_id !== "string") {
    return false;
  }
  if (value.harness !== void 0 && typeof value.harness !== "string") {
    return false;
  }
  if (value.task_id !== void 0 && typeof value.task_id !== "string") {
    return false;
  }
  if (value.observed_at !== void 0 && !isIsoDateString(value.observed_at)) {
    return false;
  }
  if (value.harness_metadata !== void 0 && !isHarnessOutcomeRowMetadata(value.harness_metadata)) {
    return false;
  }
  return true;
}
var RECOMMENDATION_COPY_KEY_SET = new Set(
  RECOMMENDATION_COPY_KEYS.map((key) => key.replaceAll("_", ""))
);
var ROUTE_SLUG_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
function routingOutcomeErrors(row) {
  if (!isPlainObject5(row)) {
    return ["row must be an object"];
  }
  const errors = [];
  const routed = row.inference_log_id !== void 0;
  if (routed && (typeof row.inference_log_id !== "string" || row.inference_log_id.trim().length === 0)) {
    errors.push("inference_log_id must be a non-empty string");
  }
  if (routed && row.overrides === void 0) {
    errors.push("a routed row must list overrides ([] when the recommendation was followed)");
  }
  if (!routed && row.overrides !== void 0) {
    errors.push("overrides require inference_log_id: an unrouted row has no recommendation to override");
  }
  if (row.overrides === void 0) {
    return errors;
  }
  if (!Array.isArray(row.overrides)) {
    return [...errors, "overrides must be an array"];
  }
  const selected = isPlainObject5(row.selected_models) ? row.selected_models : {};
  const lastByRole = /* @__PURE__ */ new Map();
  for (const [index, entry] of row.overrides.entries()) {
    const label2 = `overrides[${index}]`;
    if (!isPlainObject5(entry) || !hasOnlyAllowedKeys(entry, ["role", "source", "from", "to", "reason"])) {
      errors.push(`${label2} must be an object with role, source, from, to and reason`);
      continue;
    }
    if (!ROUTE_ROLES.includes(entry.role)) {
      errors.push(`${label2}.role must be one of: ${ROUTE_ROLES.join(", ")}`);
    }
    if (!ROUTE_OVERRIDE_SOURCES.includes(entry.source)) {
      errors.push(`${label2}.source must be one of: ${ROUTE_OVERRIDE_SOURCES.join(", ")}`);
    }
    for (const key of ["from", "to"]) {
      const model = entry[key];
      if (typeof model !== "string" || model.trim().length === 0) {
        errors.push(`${label2}.${key} must be a non-empty model id`);
      }
    }
    if (entry.from === entry.to) {
      errors.push(`${label2} must change the model (from equals to)`);
    }
    if (typeof entry.reason !== "string" || !ROUTE_SLUG_PATTERN.test(entry.reason)) {
      errors.push(`${label2}.reason must be a slug`);
    }
    const previous = lastByRole.get(String(entry.role));
    if (previous && previous.to !== entry.from) {
      errors.push(`${label2}.from must equal the previous ${String(entry.role)} override's to`);
    }
    lastByRole.set(String(entry.role), entry);
  }
  for (const [role, last] of lastByRole) {
    if (selected[role] !== last.to) {
      errors.push(`the last ${role} override must end at selected_models.${role}`);
    }
  }
  return errors;
}
function findRecommendationCopy(value, path4 = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findRecommendationCopy(item, [...path4, String(index)]);
      if (found) return found;
    }
    return void 0;
  }
  if (!isPlainObject5(value)) {
    return void 0;
  }
  for (const [key, child] of Object.entries(value)) {
    if (RECOMMENDATION_COPY_KEY_SET.has(key.toLowerCase().replaceAll("_", ""))) {
      return [...path4, key].join(".");
    }
    const found = findRecommendationCopy(child, [...path4, key]);
    if (found) return found;
  }
  return void 0;
}
function validateContributionRow(row) {
  assertNoForbiddenKeys2(row);
  const copy = findRecommendationCopy(row);
  if (copy) {
    throw new ContributionValidationError(
      "schema_validation_failed",
      `Contribution rows must not store a recommendation copy (${copy}); Hokusai joins it from inference_log_id`
    );
  }
  if (isPlainObject5(row) && (row.schema_version === TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V3 || row.schema_version === HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2)) {
    const errors = routingOutcomeErrors(row);
    if (errors.length > 0) {
      throw new ContributionValidationError(
        "schema_validation_failed",
        `Invalid routing outcome: ${errors.join("; ")}`
      );
    }
  }
  if (isTechnicalTaskRouterContributionRowV1(row) || isTechnicalTaskRouterContributionRowV2(row) || isTechnicalTaskRouterContributionRowV3(row) || isHarnessOutcomeRowV1(row) || isHarnessOutcomeRowV2(row) || isSubmitDataContributionRow(row)) {
    return row;
  }
  throw new ContributionValidationError(
    "schema_validation_failed",
    "Contribution row does not match a supported redacted schema"
  );
}

// ../core/src/contribution/builder.ts
function routingOutcomeFields(projection) {
  if (projection.inferenceLogId && projection.routeOverrides === void 0) {
    throw new Error(
      "routeOverrides is required for a routed task: pass [] if the recommendation was followed"
    );
  }
  if (!projection.inferenceLogId && projection.routeOverrides !== void 0) {
    throw new Error("routeOverrides requires inferenceLogId: an unrouted task has no recommendation");
  }
  return projection.inferenceLogId ? {
    inference_log_id: projection.inferenceLogId,
    overrides: (projection.routeOverrides ?? []).map((override) => ({ ...override }))
  } : {};
}
function buildHarnessOutcomeRow(projection) {
  if (!projection.taskDescriptor || Object.keys(projection.taskDescriptor).length === 0) {
    throw new Error("taskDescriptor must be a non-empty object");
  }
  if (!projection.allowedModels || projection.allowedModels.length === 0) {
    throw new Error("allowedModels must be a non-empty array");
  }
  if (!projection.selectedModels) {
    throw new Error("selectedModels is required");
  }
  const harnessMetadata = {
    ...projection.harness ? { harness: projection.harness } : {},
    ...projection.sdkVersion ? { sdk_version: projection.sdkVersion } : {}
  };
  const row = {
    schema_version: HARNESS_OUTCOME_ROW_SCHEMA_VERSION_V2,
    task_descriptor: { ...projection.taskDescriptor },
    allowed_models: [...projection.allowedModels],
    selected_models: { ...projection.selectedModels },
    completion_result: projection.completionResult,
    ...projection.budgetUsd !== void 0 ? { budget_usd: projection.budgetUsd } : {},
    ...projection.actualCostUsd !== void 0 ? { actual_cost_usd: projection.actualCostUsd } : {},
    ...projection.wallClockSeconds !== void 0 ? { wall_clock_seconds: projection.wallClockSeconds } : {},
    ...projection.successUnderBudget !== void 0 ? { success_under_budget: projection.successUnderBudget } : {},
    ...routingOutcomeFields(projection),
    ...projection.harness ? { harness: projection.harness } : {},
    ...projection.taskId ? { task_id: projection.taskId } : {},
    ...projection.observedAt ? { observed_at: projection.observedAt } : {},
    ...Object.keys(harnessMetadata).length > 0 ? { harness_metadata: harnessMetadata } : {}
  };
  return validateContributionRow(row);
}

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
function parseArgs(argv) {
  const parsed = {
    decline: false,
    json: false
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === void 0) {
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--task") {
      parsed.task = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--decline") {
      parsed.decline = true;
      continue;
    }
    if (arg === "--correlation-id") {
      parsed.correlationId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      parsed.reason = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--objective") {
      parsed.objective = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--max-cost-usd") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value >= 0) {
        parsed.maxCostUsd = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--config") {
      const configPath = argv[index + 1];
      if (configPath !== void 0) {
        parsed.configPath = configPath;
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  if (parsed.task === void 0 && positional.length > 0) {
    parsed.task = positional.join(" ");
  }
  return parsed;
}
function toConfigFilePath(profile17, configPath) {
  if (!configPath) {
    return void 0;
  }
  return configPath.endsWith(".json") ? configPath : defaultPluginConfigPath(profile17.resolveConfigPath({ override: configPath }).dir);
}
function toMessage(parsed, message, code) {
  const body = parsed.json ? JSON.stringify(
    {
      error: {
        code,
        message
      }
    },
    null,
    2
  ) : message;
  return {
    exitCode: code,
    stdout: "",
    stderr: `${body}
`
  };
}
function extractModelId(message) {
  const match = message.match(/model recommendation: ([^.\s]+)/i);
  if (match?.[1]) {
    return match[1];
  }
  const fallbackMatch = message.match(/Model ([^ ]+)/);
  return fallbackMatch?.[1] ?? "unknown";
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    );
  }
  return chunks.join("");
}
function createRunCli(profile17, impls) {
  return async function runCli2(argv, env, deps = {}) {
    const parsed = parseArgs(argv);
    let flagObjective;
    if (parsed.objective !== void 0) {
      flagObjective = parseRoutingObjective(parsed.objective);
      if (!flagObjective) {
        return toMessage(
          parsed,
          `Unknown routing objective "${parsed.objective}". Choose speed, cost, or reliability.`,
          CLI_EXIT_CODES.UNKNOWN_ERROR
        );
      }
    }
    const registry = profile17.modelCatalog.registry;
    const loadConfigImpl = deps.loadConfig ?? ((input) => loadPluginConfig({
      env: input.env,
      registry,
      ...input.configPath ? { store: new FilePluginConfigStore(input.configPath) } : {}
    }));
    const routeTaskImpl = deps.routeTaskImpl ?? impls.routeTask;
    const declineRecommendationImpl = deps.declineRecommendationImpl ?? impls.declineRecommendation;
    let config;
    try {
      const configPath = toConfigFilePath(profile17, parsed.configPath);
      config = await loadConfigImpl(
        configPath === void 0 ? { env } : { configPath, env }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load Hokusai configuration.";
      return toMessage(parsed, message, CLI_EXIT_CODES.UNKNOWN_ERROR);
    }
    if (parsed.decline) {
      if (!parsed.correlationId?.trim()) {
        return toMessage(
          parsed,
          "Provide --correlation-id when declining a routing recommendation.",
          CLI_EXIT_CODES.UNKNOWN_ERROR
        );
      }
      const result2 = await declineRecommendationImpl(
        {
          correlationId: parsed.correlationId.trim(),
          ...parsed.reason?.trim() ? { reason: parsed.reason.trim() } : {}
        },
        {
          registry,
          ...parsed.configPath ? { configPath: parsed.configPath } : {}
        }
      );
      if (!result2.ok) {
        return toMessage(parsed, result2.error.message, CLI_EXIT_CODES.UNKNOWN_ERROR);
      }
      const body = parsed.json ? JSON.stringify(result2.value, null, 2) : `Declined recommendation for correlation ${result2.value.correlationId}.
`;
      return {
        exitCode: CLI_EXIT_CODES.OK,
        stdout: parsed.json ? `${body}
` : body,
        stderr: ""
      };
    }
    if (!config.apiKey) {
      return toMessage(
        parsed,
        "Hokusai routing needs an API key. Set HOKUSAI_API_KEY and re-run.",
        CLI_EXIT_CODES.AUTH_REQUIRED
      );
    }
    const taskText = (parsed.task ?? await (deps.readStdin?.() ?? readStdin())).trim();
    if (taskText.length === 0) {
      return toMessage(
        parsed,
        "Provide a task description after the slash command, e.g. `/hokusai:route refactor the auth middleware`.",
        CLI_EXIT_CODES.EMPTY_TASK
      );
    }
    const client = deps.createClient?.(config) ?? new HokusaiClient({
      apiKey: config.apiKey,
      baseUrl: config.apiBaseUrl
    });
    const objective = flagObjective ?? config.routingObjective ?? DEFAULT_ROUTING_OBJECTIVE;
    const routeInput = impls.buildRouteInput(taskText);
    const routeInputWithObjective = {
      ...routeInput,
      metadata: {
        ...routeInput.metadata,
        objective: routingObjectiveToApiValue(objective),
        ...parsed.maxCostUsd !== void 0 ? { max_cost_usd: String(parsed.maxCostUsd) } : {}
      }
    };
    const result = await routeTaskImpl(routeInputWithObjective, {
      apiClient: client,
      registry,
      settings: {
        routingEnabled: true,
        outcomeReportingEnabled: config.outcomeSubmissionEnabled
      },
      ...parsed.configPath ? { configPath: parsed.configPath } : {}
    });
    if (!result.ok) {
      if (result.error.code === "NETWORK_ERROR") {
        return toMessage(
          parsed,
          `Could not reach Hokusai (${config.apiBaseUrl}). Check connectivity and retry. Use /hokusai:doctor for details.`,
          CLI_EXIT_CODES.NETWORK_ERROR
        );
      }
      if (result.error.code === "PROVIDER_NOT_ALLOWED" || result.error.code === "MODEL_NOT_ALLOWED" || result.error.code === "MODEL_UNAVAILABLE" || result.error.code === "UNKNOWN_MODEL") {
        const suggestions = Array.isArray(result.error.details?.suggestions) ? result.error.details.suggestions.join(", ") : "none available";
        const recommendedModel = extractModelId(result.error.message);
        return toMessage(
          parsed,
          `Hokusai recommended a model not available in ${profile17.harnessLabel} (${recommendedModel}). Suggested fallbacks: ${suggestions}.`,
          CLI_EXIT_CODES.UNSUPPORTED_MODEL
        );
      }
      return toMessage(parsed, result.error.message, CLI_EXIT_CODES.UNKNOWN_ERROR);
    }
    const recommendation = result.value.recommendation;
    if (parsed.json) {
      return {
        exitCode: CLI_EXIT_CODES.OK,
        stdout: `${JSON.stringify(
          {
            model: recommendation.model.id,
            provider: recommendation.model.provider,
            reason: recommendation.reason,
            ...recommendation.confidence === void 0 ? {} : { confidence: recommendation.confidence },
            ...recommendation.alternatives?.length ? {
              alternatives: recommendation.alternatives.map((alternative) => ({
                model: alternative.model.id,
                provider: alternative.model.provider,
                ...alternative.reason === void 0 ? {} : { reason: alternative.reason },
                ...alternative.confidence === void 0 ? {} : { confidence: alternative.confidence }
              }))
            } : {},
            correlationId: result.value.correlationId,
            routingDecisionId: result.value.routingDecisionId,
            handoff: result.value.handoff,
            ...result.value.route?.requestId ? { requestId: result.value.route.requestId } : {},
            ...result.value.route?.routeId ? { routeId: result.value.route.routeId } : {}
          },
          null,
          2
        )}
`,
        stderr: ""
      };
    }
    const display = displayTaskRecommendation(recommendation);
    const lines = [...display.lines];
    lines.push(`Correlation ID: ${result.value.correlationId}`);
    lines.push("");
    lines.push(...profile17.renderHandoff(result.value.handoff));
    if (result.value.route?.requestId) {
      lines.push(`Request ID: ${result.value.route.requestId}`);
    }
    return {
      exitCode: CLI_EXIT_CODES.OK,
      stdout: `${lines.join("\n")}
`,
      stderr: ""
    };
  };
}

// ../core/src/plugin-commands/report-cli.ts
var REPORT_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7
};
function parseArgs2(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    preview: false,
    send: false,
    useLatest: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--correlation-id" && next !== void 0) {
      parsed.correlationId = next;
      index += 1;
    } else if (arg === "--use-latest") {
      parsed.useLatest = true;
    } else if (arg === "--recommended-model" && next !== void 0) {
      parsed.recommendedModel = next;
      index += 1;
    } else if (arg === "--actual-model" && next !== void 0) {
      parsed.actualModel = next;
      index += 1;
    } else if (arg === "--accepted") {
      parsed.accepted = true;
    } else if (arg === "--rejected") {
      parsed.rejected = true;
    } else if (arg === "--status" && next !== void 0) {
      parsed.status = next;
      index += 1;
    } else if (arg === "--rating" && next !== void 0) {
      parsed.rating = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--latency-bucket" && next !== void 0) {
      parsed.latencyBucket = next;
      index += 1;
    } else if (arg === "--cost-bucket" && next !== void 0) {
      parsed.costBucket = next;
      index += 1;
    } else if (arg === "--token-bucket" && next !== void 0) {
      parsed.tokenBucket = next;
      index += 1;
    } else if (arg === "--build-status" && next !== void 0) {
      parsed.buildStatus = next;
      index += 1;
    } else if (arg === "--build-failures" && next !== void 0) {
      parsed.buildFailures = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--test-status" && next !== void 0) {
      parsed.testStatus = next;
      index += 1;
    } else if (arg === "--test-failures" && next !== void 0) {
      parsed.testFailures = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--notes" && next !== void 0) {
      parsed.notes = next;
      index += 1;
    } else if (arg === "--preview" || arg === "--preview-only") {
      parsed.preview = true;
    } else if (arg === "--dry-run") {
      parsed.preview = true;
      parsed.dryRun = true;
    } else if (arg === "--send") {
      parsed.send = true;
    } else if (arg === "--config" && next !== void 0) {
      parsed.configPath = next;
      index += 1;
    } else if (arg === "--task-id" && next !== void 0) {
      parsed.taskId = next;
      index += 1;
    } else if (arg === "--inference-log-id" && next !== void 0) {
      parsed.inferenceLogId = next;
      index += 1;
    } else if (arg === "--actual-cost-usd" && next !== void 0) {
      const value = Number(next);
      if (Number.isFinite(value)) {
        parsed.actualCostUsd = value;
      }
      index += 1;
    } else if (arg === "--wall-clock-seconds" && next !== void 0) {
      const value = Number(next);
      if (Number.isFinite(value)) {
        parsed.wallClockSeconds = value;
      }
      index += 1;
    } else if (arg === "--input-tokens" && next !== void 0) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) {
        parsed.inputTokens = value;
      }
      index += 1;
    } else if (arg === "--output-tokens" && next !== void 0) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) {
        parsed.outputTokens = value;
      }
      index += 1;
    }
  }
  return parsed;
}
function toConfigFilePath2(profile17, configPath) {
  if (!configPath) {
    return void 0;
  }
  return configPath.endsWith(".json") ? configPath : defaultPluginConfigPath(profile17.resolveConfigPath({ override: configPath }).dir);
}
function toMessage2(parsed, message, code, details) {
  const detailText = !parsed.json && Array.isArray(details?.fieldErrors) ? `
${details.fieldErrors.join("\n")}` : "";
  const body = parsed.json ? JSON.stringify(
    {
      error: {
        code,
        message,
        ...details ? { details } : {}
      }
    },
    null,
    2
  ) : `${message}${detailText}`;
  return {
    exitCode: code,
    stdout: "",
    stderr: `${body}
`
  };
}
function parsePipedInput(raw) {
  if (raw.trim().length === 0) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Could not parse piped JSON outcome input: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Piped JSON outcome input must be an object.");
  }
  return parsed;
}
function buildSummary(status, failures) {
  if (status === void 0) {
    return void 0;
  }
  return failures === void 0 ? { status } : { status, failures };
}
function resolveRecommendationAccepted(parsed, piped) {
  if (parsed.accepted) return true;
  if (parsed.rejected) return false;
  return piped.recommendationAccepted;
}
function withDefaultBucket(value, label2, notes) {
  if (value !== void 0) {
    return value;
  }
  notes.push(`Defaulted ${label2} to "medium".`);
  return "medium";
}
async function defaultReadStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    );
  }
  return chunks.join("");
}
function buildHumanSendLines(result) {
  const lines = [
    "Outcome report submitted.",
    `Correlation id: ${result.report.correlationId}`,
    `Completion status: ${result.report.completionStatus}`
  ];
  if (result.response?.status) {
    lines.push(`Server status: ${result.response.status}`);
  }
  return lines;
}
function renderSuccess(parsed, result, stderrNotes) {
  const preview2 = "preview" in result ? result.preview : { lines: [], payload: result.report };
  const isSubmitted = !("preview" in result) && result.submitted;
  const mode = isSubmitted ? "submitted" : "preview";
  if (parsed.json) {
    return {
      exitCode: REPORT_CLI_EXIT_CODES.OK,
      stdout: `${JSON.stringify(
        {
          mode,
          submitted: isSubmitted,
          report: result.report,
          preview: preview2,
          ...!("preview" in result) && result.response ? { response: result.response } : {}
        },
        null,
        2
      )}
`,
      stderr: stderrNotes.length > 0 ? `${stderrNotes.join("\n")}
` : ""
    };
  }
  const lines = "preview" in result ? [...result.preview.lines] : [...buildHumanSendLines(result)];
  if (!parsed.send) {
    lines.push(
      parsed.dryRun ? "Dry run: no outcome was submitted." : "Preview only. Re-run with --send to submit this report."
    );
  }
  return {
    exitCode: REPORT_CLI_EXIT_CODES.OK,
    stdout: `${lines.join("\n")}
`,
    stderr: stderrNotes.length > 0 ? `${stderrNotes.join("\n")}
` : ""
  };
}
function createRunReportCli(profile17, impls) {
  return async function runReportCli2(argv, env, deps = {}) {
    const parsed = parseArgs2(argv);
    const registry = profile17.modelCatalog.registry;
    const loadConfigImpl = deps.loadConfig ?? ((input) => loadPluginConfig({
      env: input.env,
      registry,
      // Always read the persisted plugin config so consent set via
      // `hokusai-privacy reporting on` is honored, not just the
      // HOKUSAI_OUTCOME_OPT_IN env var. Mirrors getReportingStatus.
      store: new FilePluginConfigStore(
        input.configPath ?? defaultPluginConfigPath(profile17.resolveConfigPath().dir)
      )
    }));
    const previewReportOutcomeImpl = deps.previewReportOutcomeImpl ?? impls.previewReportOutcome;
    const reportTaskOutcomeImpl = deps.reportTaskOutcomeImpl ?? impls.reportTaskOutcome;
    const findRoutingDecisionImpl = deps.findRoutingDecisionImpl ?? impls.findRoutingDecision;
    if (parsed.useLatest) {
      return toMessage2(
        parsed,
        "--use-latest was removed: it attached the newest stored route, whatever task it was for. Pass --task-id or --correlation-id.",
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
      );
    }
    let config;
    try {
      const configPath = toConfigFilePath2(profile17, parsed.configPath);
      config = await loadConfigImpl(
        configPath === void 0 ? { env } : { configPath, env }
      );
    } catch (error) {
      return toMessage2(
        parsed,
        error instanceof Error ? error.message : "Failed to load Hokusai configuration.",
        REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR
      );
    }
    if (!config.outcomeSubmissionEnabled) {
      return toMessage2(
        parsed,
        "Outcome submission consent is required. Run `export HOKUSAI_OUTCOME_OPT_IN=true` to opt in.",
        REPORT_CLI_EXIT_CODES.CONSENT_REQUIRED
      );
    }
    const apiKey = config.apiKey;
    if (parsed.send && !apiKey) {
      return toMessage2(
        parsed,
        "Hokusai outcome submission needs an API key. Set HOKUSAI_API_KEY and re-run.",
        REPORT_CLI_EXIT_CODES.AUTH_REQUIRED
      );
    }
    const rawStdin = await (deps.readStdin ?? defaultReadStdin)();
    let pipedInput;
    try {
      pipedInput = parsePipedInput(rawStdin);
    } catch (error) {
      return toMessage2(
        parsed,
        error instanceof Error ? error.message : "Invalid piped JSON outcome input.",
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
      );
    }
    const configDir = profile17.resolveConfigPath(
      parsed.configPath ? { override: parsed.configPath } : void 0
    ).dir;
    const requestedCorrelationId = parsed.correlationId ?? pipedInput.correlationId;
    const requestedTaskId = parsed.taskId ?? pipedInput.taskId;
    if (requestedCorrelationId === void 0 && requestedTaskId === void 0) {
      return toMessage2(
        parsed,
        "Name the task this outcome belongs to: pass --task-id or --correlation-id.",
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
        { fieldErrors: ["correlationId: Provide --correlation-id, or --task-id of a routed task."] }
      );
    }
    let latest;
    {
      try {
        latest = await findRoutingDecisionImpl({
          configDir,
          ...requestedCorrelationId !== void 0 ? { correlationId: requestedCorrelationId } : {},
          ...requestedTaskId !== void 0 ? { taskId: requestedTaskId } : {}
        });
      } catch (error) {
        return toMessage2(
          parsed,
          `Could not read local routing correlations: ${error instanceof Error ? error.message : String(error)}`,
          REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR
        );
      }
    }
    if (parsed.dryRun) {
      parsed.send = false;
    }
    if (!parsed.send) {
      parsed.preview = true;
    }
    if (requestedCorrelationId === void 0 && !latest) {
      return toMessage2(
        parsed,
        `No stored route for task ${requestedTaskId}. This outcome cannot be linked to a Hokusai recommendation; pass --correlation-id to report it as plain telemetry.`,
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
        { fieldErrors: ["correlationId: No route was recorded for this task id."] }
      );
    }
    if (latest && requestedTaskId !== void 0 && latest.taskId !== requestedTaskId) {
      return toMessage2(
        parsed,
        `Correlation ${latest.correlationId} belongs to task ${latest.taskId}, not ${requestedTaskId}.`,
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
      );
    }
    if (latest?.inferenceLogId !== void 0 && parsed.inferenceLogId !== void 0 && latest.inferenceLogId !== parsed.inferenceLogId) {
      return toMessage2(
        parsed,
        `The route for this task was made by inference ${latest.inferenceLogId}, not ${parsed.inferenceLogId}.`,
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR
      );
    }
    const stderrNotes = [];
    const recommendationAccepted = resolveRecommendationAccepted(parsed, pipedInput);
    const resolvedInferenceLogId = parsed.inferenceLogId ?? latest?.inferenceLogId;
    const resolvedActualModel = parsed.actualModel ?? pipedInput.actualModel ?? (recommendationAccepted === true ? latest?.recommendedModelId : void 0) ?? "";
    const resolvedActualCostUsd = resolveActualCostUsd({
      model: resolvedActualModel,
      env,
      ...parsed.actualCostUsd !== void 0 ? { explicitActualCostUsd: parsed.actualCostUsd } : {},
      ...parsed.inputTokens !== void 0 ? { inputTokens: parsed.inputTokens } : {},
      ...parsed.outputTokens !== void 0 ? { outputTokens: parsed.outputTokens } : {},
      ...latest?.routeContext ? { routeContext: latest.routeContext } : {}
    });
    const reportInput = {
      taskId: parsed.taskId ?? pipedInput.taskId ?? latest?.taskId ?? parsed.correlationId ?? pipedInput.correlationId ?? "outcome-report",
      correlationId: parsed.correlationId ?? pipedInput.correlationId ?? latest?.correlationId ?? "",
      recommendedModel: parsed.recommendedModel ?? pipedInput.recommendedModel ?? latest?.recommendedModelId ?? "",
      actualModel: resolvedActualModel,
      recommendationAccepted: recommendationAccepted ?? false,
      completionStatus: parsed.status ?? pipedInput.completionStatus ?? "",
      latencyBucket: withDefaultBucket(
        parsed.latencyBucket ?? pipedInput.latencyBucket,
        "latency bucket",
        stderrNotes
      ),
      costBucket: withDefaultBucket(
        parsed.costBucket ?? pipedInput.costBucket,
        "cost bucket",
        stderrNotes
      ),
      tokenBucket: withDefaultBucket(
        parsed.tokenBucket ?? pipedInput.tokenBucket,
        "token bucket",
        stderrNotes
      ),
      ...parsed.rating !== void 0 ? { userRating: parsed.rating } : pipedInput.userRating !== void 0 ? { userRating: pipedInput.userRating } : {},
      ...buildSummary(parsed.buildStatus, parsed.buildFailures) ?? pipedInput.build ? {
        build: buildSummary(parsed.buildStatus, parsed.buildFailures) ?? pipedInput.build
      } : {},
      ...buildSummary(parsed.testStatus, parsed.testFailures) ?? pipedInput.test ? {
        test: buildSummary(parsed.testStatus, parsed.testFailures) ?? pipedInput.test
      } : {},
      ...parsed.notes ?? pipedInput.notes ? { notes: parsed.notes ?? pipedInput.notes } : {},
      ...resolvedInferenceLogId ? { inferenceLogId: resolvedInferenceLogId } : {},
      ...latest?.recommendedModelId ? { routedRecommendedModelId: latest.recommendedModelId } : {},
      ...latest?.routeContext ? { routeContext: latest.routeContext } : {},
      ...resolvedActualCostUsd !== void 0 ? { actualCostUsd: resolvedActualCostUsd } : {},
      ...parsed.wallClockSeconds !== void 0 ? { wallClockSeconds: parsed.wallClockSeconds } : {}
    };
    try {
      const result = parsed.send ? await reportTaskOutcomeImpl(reportInput, {
        apiClient: deps.createClient?.(config) ?? new HokusaiClient({
          apiKey: config.apiKey,
          baseUrl: config.apiBaseUrl
        }),
        registry,
        ...parsed.configPath ? { configPath: parsed.configPath } : {}
      }) : await previewReportOutcomeImpl(reportInput, {
        registry,
        dryRun: parsed.dryRun,
        ...parsed.configPath ? { configPath: parsed.configPath } : {}
      });
      if (!result.ok) {
        const code = result.error.code === "OUTCOME_VALIDATION_FAILED" || result.error.code === "CONTRIBUTION_UNAVAILABLE" || result.error.code === "CONTRIBUTION_VALIDATION_FAILED" ? REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR : result.error.code === "NETWORK_ERROR" ? REPORT_CLI_EXIT_CODES.NETWORK_ERROR : REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR;
        return toMessage2(parsed, result.error.message, code, result.error.details);
      }
      return renderSuccess(parsed, result.value, stderrNotes);
    } catch (error) {
      if (error instanceof HokusaiNetworkError) {
        return toMessage2(
          parsed,
          `Could not reach Hokusai (${config.apiBaseUrl}). Check connectivity and retry. Use /hokusai:doctor for details.`,
          REPORT_CLI_EXIT_CODES.NETWORK_ERROR
        );
      }
      return toMessage2(
        parsed,
        error instanceof Error ? error.message : "Failed to process outcome report.",
        REPORT_CLI_EXIT_CODES.UNKNOWN_ERROR
      );
    }
  };
}

// ../core/src/plugin-commands/outcome-prompt.ts
var COMPLETION_TERMS = [
  "task completed",
  "task succeeded",
  "completed successfully",
  "successfully completed",
  "tests passed",
  "test passed",
  "all tests passed",
  "pr merged",
  "pull request merged",
  "merged pull request",
  "issue closed",
  "closed issue"
];
function detectOutcomeCompletionSignal(event17) {
  const signals = /* @__PURE__ */ new Set();
  collectCompletionSignals(event17, signals);
  return {
    shouldPrompt: signals.size > 0,
    signals: [...signals]
  };
}
function buildOutcomeContributionPrompt(input) {
  const detection = detectOutcomeCompletionSignal(input.event);
  if (!detection.shouldPrompt) {
    return {
      shouldPrompt: false,
      status: "no_completion_signal",
      message: "No successful completion signal detected.",
      signals: []
    };
  }
  if (!input.latestRoute) {
    return {
      shouldPrompt: false,
      status: "no_route",
      message: "Looks like this task succeeded, but no Hokusai route was found to attach the outcome to.",
      signals: detection.signals,
      remediation: "Route a task with Hokusai before contributing an outcome."
    };
  }
  if (!input.outcomeOptIn) {
    return {
      shouldPrompt: true,
      status: "needs_outcome_opt_in",
      message: "Looks like this task succeeded - enable HOKUSAI_OUTCOME_OPT_IN=true before contributing this outcome.",
      signals: detection.signals,
      remediation: "Set HOKUSAI_OUTCOME_OPT_IN=true, then rerun the Hokusai report command."
    };
  }
  const actualModel = input.actualModel;
  if (!actualModel) {
    return {
      shouldPrompt: true,
      status: "missing_model",
      message: "Looks like this task succeeded - contribute this outcome after supplying the actual model used.",
      signals: detection.signals,
      remediation: "Run the report command with --actual-model set to the model that completed the task."
    };
  }
  const recommended = input.latestRoute.recommendedModelId;
  const reportArgs = [
    "--correlation-id",
    input.latestRoute.correlationId,
    "--task-id",
    input.latestRoute.taskId,
    ...recommended ? ["--recommended-model", recommended] : [],
    "--actual-model",
    actualModel,
    recommended !== void 0 && recommended === actualModel ? "--accepted" : "--rejected",
    "--status",
    "succeeded",
    "--latency-bucket",
    "medium",
    "--cost-bucket",
    "medium",
    "--token-bucket",
    "medium"
  ];
  if (detection.signals.includes("tests_passed")) {
    reportArgs.push("--test-status", "passed");
  }
  return {
    shouldPrompt: true,
    status: "ready",
    message: "Looks like this task succeeded - contribute this outcome to improve routing?",
    signals: detection.signals,
    reportArgs,
    reportCommand: `${input.reportCommand} ${quoteArgs(reportArgs)}`
  };
}
function collectCompletionSignals(value, signals) {
  if (value === null || value === void 0) {
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    collectStringSignals(String(value), signals);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCompletionSignals(entry, signals));
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const record = value;
  collectStructuredSignals(record, signals);
  Object.values(record).forEach(
    (entry) => collectCompletionSignals(entry, signals)
  );
}
function collectStructuredSignals(record, signals) {
  const status = normalizeTerm(
    record.status ?? record.conclusion ?? record.result
  );
  if (["success", "succeeded", "completed", "passed"].includes(status)) {
    signals.add(status === "passed" ? "tests_passed" : "task_completed");
  }
  if (status === "merged") {
    signals.add("pr_merged");
  }
  if (status === "closed") {
    signals.add("issue_closed");
  }
  if (record.merged === true) {
    signals.add("pr_merged");
  }
}
function collectStringSignals(value, signals) {
  const normalized = normalizeTerm(value);
  if (!COMPLETION_TERMS.some((term) => normalized.includes(term))) {
    return;
  }
  if (normalized.includes("test") && normalized.includes("passed")) {
    signals.add("tests_passed");
  }
  if (normalized.includes("pr merged") || normalized.includes("pull request merged")) {
    signals.add("pr_merged");
  }
  if (normalized.includes("issue closed") || normalized.includes("closed issue")) {
    signals.add("issue_closed");
  }
  if (normalized.includes("task completed") || normalized.includes("task succeeded") || normalized.includes("completed successfully") || normalized.includes("successfully completed")) {
    signals.add("task_completed");
  }
}
function normalizeTerm(value) {
  return String(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function quoteArgs(args) {
  return args.map((arg) => arg.includes(" ") ? JSON.stringify(arg) : arg).join(" ");
}

// ../core/src/plugin-commands/privacy-cli.ts
var PRIVACY_CLI_EXIT_CODES = {
  ...CLI_EXIT_CODES,
  OUTCOME_VALIDATION_ERROR: 7,
  PRIVACY_USAGE_ERROR: 8
};
var FLAG_VALUE_OPTIONS = /* @__PURE__ */ new Set(["--config", "--limit"]);
function firstPositional(argv) {
  for (let i = 1; i < argv.length; i += 1) {
    const prev = argv[i - 1];
    if (prev && FLAG_VALUE_OPTIONS.has(prev)) continue;
    const token = argv[i];
    if (token && !token.startsWith("--")) return token;
  }
  return void 0;
}
function parseNumber2(value) {
  if (value === void 0) return void 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function parseArgs3(argv) {
  const subcommand = argv[0];
  const json = argv.includes("--json");
  const configIndex = argv.indexOf("--config");
  const configPath = configIndex >= 0 ? argv[configIndex + 1] : void 0;
  if (subcommand === "list" || subcommand === "audit") {
    const limitIndex = argv.indexOf("--limit");
    const limit = limitIndex >= 0 ? parseNumber2(argv[limitIndex + 1]) : void 0;
    return {
      subcommand,
      json,
      ...configPath ? { configPath } : {},
      ...limit !== void 0 ? { limit } : {}
    };
  }
  if (subcommand === "preview") {
    const correlationId = firstPositional(argv);
    return {
      subcommand,
      debug: argv.includes("--debug"),
      json,
      ...correlationId ? { correlationId } : {},
      ...configPath ? { configPath } : {}
    };
  }
  if (subcommand === "clear") {
    const scope = argv.includes("--all") ? "all" : argv.includes("--records") ? "records" : argv.includes("--audit") ? "audit" : void 0;
    return {
      subcommand,
      yes: argv.includes("--yes"),
      json,
      ...scope ? { scope } : {},
      ...configPath ? { configPath } : {}
    };
  }
  if (subcommand === "reporting") {
    const action = firstPositional(argv);
    return {
      subcommand,
      json,
      ...action ? { action } : {},
      ...configPath ? { configPath } : {}
    };
  }
  if (subcommand === "debug") {
    const action = firstPositional(argv);
    return {
      subcommand,
      json,
      ...action ? { action } : {},
      ...configPath ? { configPath } : {}
    };
  }
  return { error: "Usage: hokusai-privacy list|preview|audit|clear|reporting|debug" };
}
function ok2(body, json, payload) {
  return {
    exitCode: PRIVACY_CLI_EXIT_CODES.OK,
    stdout: json ? `${JSON.stringify(payload ?? {}, null, 2)}
` : body,
    stderr: ""
  };
}
function fail3(message, code, json) {
  const body = json ? JSON.stringify({ error: { code, message } }, null, 2) : message;
  return {
    exitCode: code,
    stdout: "",
    stderr: `${body}
`
  };
}
function renderWarnings(warnings) {
  return warnings && warnings.length > 0 ? `${warnings.join("\n")}
` : "";
}
function createRunPrivacyCli(_profile, impls) {
  return async function runPrivacyCli2(argv, env) {
    const parsed = parseArgs3(argv);
    if ("error" in parsed) {
      return fail3(
        parsed.error,
        PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
        argv.includes("--json")
      );
    }
    if ("limit" in parsed && parsed.limit !== void 0 && parsed.limit < 0 || "limit" in parsed && argv.includes("--limit") && parsed.limit === void 0) {
      return fail3(
        "Expected --limit to be a non-negative integer.",
        PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
        parsed.json
      );
    }
    if (parsed.subcommand === "list") {
      const result = await impls.listRoutingDecisions(
        { ...parsed.limit !== void 0 ? { limit: parsed.limit } : {} },
        {
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        }
      );
      if (!result.ok) {
        return fail3(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }
      if (result.value.decisions.length === 0) {
        return ok2(
          `${renderWarnings(result.value.warnings)}No records found.
`,
          parsed.json,
          {
            subcommand: "list",
            result: result.value.decisions,
            ...result.value.warnings ? { warnings: result.value.warnings } : {}
          }
        );
      }
      const lines = result.value.decisions.map(
        (entry) => `${entry.createdAt} ${entry.correlationId} ${entry.recommendedModelId ?? "unknown-model"} ${entry.status ?? "unknown-status"}`
      );
      return ok2(
        `${renderWarnings(result.value.warnings)}${lines.join("\n")}
`,
        parsed.json,
        {
          subcommand: "list",
          result: result.value.decisions,
          ...result.value.warnings ? { warnings: result.value.warnings } : {}
        }
      );
    }
    if (parsed.subcommand === "preview") {
      if (!parsed.correlationId) {
        return fail3(
          "Provide a correlation id to preview.",
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json
        );
      }
      const result = await impls.previewStoredDecision(
        { correlationId: parsed.correlationId, debug: parsed.debug },
        {
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        }
      );
      if (!result.ok) {
        return fail3(
          result.error.message,
          PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
          parsed.json
        );
      }
      return ok2(
        `${renderWarnings(result.value.warnings)}${JSON.stringify(result.value, null, 2)}
`,
        parsed.json,
        {
          subcommand: "preview",
          result: result.value,
          ...result.value.warnings ? { warnings: result.value.warnings } : {}
        }
      );
    }
    if (parsed.subcommand === "audit") {
      const result = await impls.listSubmissionAudit(
        { ...parsed.limit !== void 0 ? { limit: parsed.limit } : {} },
        {
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        }
      );
      if (!result.ok) {
        return fail3(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }
      if (result.value.entries.length === 0) {
        return ok2(
          `${renderWarnings(result.value.warnings)}No audit entries found.
`,
          parsed.json,
          {
            subcommand: "audit",
            result: result.value.entries,
            ...result.value.warnings ? { warnings: result.value.warnings } : {}
          }
        );
      }
      const lines = result.value.entries.map(
        (entry) => `${new Date(entry.timestamp).toISOString()} ${entry.kind} ${entry.status} ${entry.correlationId}${entry.error ? ` ${entry.error}` : ""}`
      );
      return ok2(
        `${renderWarnings(result.value.warnings)}${lines.join("\n")}
`,
        parsed.json,
        {
          subcommand: "audit",
          result: result.value.entries,
          ...result.value.warnings ? { warnings: result.value.warnings } : {}
        }
      );
    }
    if (parsed.subcommand === "clear") {
      if (!parsed.scope) {
        return fail3(
          "Specify one of --all, --records, or --audit.",
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json
        );
      }
      if (!parsed.yes) {
        return fail3(
          "Re-run with --yes to confirm.",
          PRIVACY_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
          parsed.json
        );
      }
      const result = await impls.clearPrivacyState(
        { scope: parsed.scope },
        {
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        }
      );
      if (!result.ok) {
        return fail3(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }
      return ok2(`Cleared ${parsed.scope} privacy state.
`, parsed.json, {
        subcommand: "clear",
        result: result.value
      });
    }
    if (parsed.subcommand === "reporting") {
      if (!parsed.action) {
        return fail3(
          "Specify reporting on, off, or status.",
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json
        );
      }
      if (parsed.action === "status") {
        const result2 = await impls.getReportingStatus({
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        });
        if (!result2.ok) {
          return fail3(result2.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
        }
        return ok2(
          `Outcome reporting is ${result2.value.enabled ? "enabled" : "disabled"} (${result2.value.source}).
`,
          parsed.json,
          { subcommand: "reporting", result: result2.value }
        );
      }
      const result = await impls.setReportingEnabled(
        { enabled: parsed.action === "on" },
        {
          ...parsed.configPath ? { configPath: parsed.configPath } : {},
          env
        }
      );
      if (!result.ok) {
        return fail3(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }
      return ok2(
        `Outcome reporting ${result.value.enabled ? "enabled" : "disabled"}.
`,
        parsed.json,
        { subcommand: "reporting", result: result.value }
      );
    }
    if (parsed.subcommand === "debug") {
      if (!parsed.action) {
        return fail3(
          "Specify debug status or off.",
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json
        );
      }
      if (parsed.action === "off") {
        const currentlyEnabled = env.HOKUSAI_DEBUG === "1";
        return ok2("Unset HOKUSAI_DEBUG to disable debug previews.\n", parsed.json, {
          subcommand: "debug",
          result: {
            enabled: currentlyEnabled,
            source: "env",
            message: "Unset HOKUSAI_DEBUG to disable debug previews."
          }
        });
      }
      const enabled = env.HOKUSAI_DEBUG === "1";
      return ok2(
        `Debug previews are ${enabled ? "enabled" : "disabled"}.
`,
        parsed.json,
        {
          subcommand: "debug",
          result: {
            enabled,
            source: "env"
          }
        }
      );
    }
    void parsed;
    return fail3(
      "Usage: hokusai-privacy list|preview|audit|clear|reporting|debug",
      PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
      argv.includes("--json")
    );
  };
}

// ../core/src/plugin-commands/doctor.ts
function buildFallbackAllowlist(profile17) {
  const allowedProviders = profile17.modelCatalog.allowedProviders;
  return profile17.modelCatalog.registry.list().filter((model) => allowedProviders?.includes(model.provider) ?? true).map((model) => model.id);
}
function renderCheck(check) {
  return [
    `[${check.status.toUpperCase().slice(0, 4).padEnd(4)}] ${check.label.padEnd(18)} ${check.summary}`,
    ...check.nextAction ? [`       -> ${check.nextAction}`] : []
  ];
}
function buildOverallLine(report) {
  const failingChecks = report.checks.filter(
    (check) => check.status === "fail"
  );
  if (failingChecks.length === 0) {
    return "Overall: ready to use.";
  }
  const routingBlocked = report.checks.some(
    (check) => check.id === "api-key" && check.status === "fail"
  );
  return routingBlocked ? `Overall: ${failingChecks.length} failing checks - Hokusai routing is unavailable until configured.` : `Overall: ${failingChecks.length} failing checks.`;
}
function renderPluginDoctorReport(report) {
  return [
    "Hokusai doctor",
    "==============",
    `checkedAt: ${report.checkedAt}`,
    `mode: ${report.mode}`,
    "",
    ...report.checks.flatMap((check) => renderCheck(check)),
    "",
    buildOverallLine(report),
    `Ready to use: ${report.ok ? "yes" : "no"}`
  ].join("\n");
}
function createRunBootstrapDoctor(profile17) {
  return async function runBootstrapDoctor2(options = {}) {
    const configPath = profile17.resolveConfigPath(
      options.configPath ? { override: options.configPath } : void 0
    );
    const pluginConfigPath = options.pluginConfigPath ?? defaultPluginConfigPath(configPath.dir);
    const modelAllowlist = buildFallbackAllowlist(profile17);
    let config = profile17.createFallbackConfig?.({
      baseUrl: DEFAULT_HOKUSAI_BASE_URL,
      modelAllowlist
    }) ?? {
      apiBaseUrl: DEFAULT_HOKUSAI_BASE_URL,
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist
    };
    let validationCheck;
    try {
      config = await loadPluginConfig({
        store: new FilePluginConfigStore(pluginConfigPath),
        registry: profile17.modelCatalog.registry,
        ...options.env !== void 0 ? { env: options.env } : {}
      });
    } catch (error) {
      if (!(error instanceof ConfigValidationError)) {
        throw error;
      }
      validationCheck = {
        id: "config-validation",
        label: "config-validation",
        status: "fail",
        summary: `Plugin configuration is invalid for: ${error.fieldErrors.map((fieldError2) => fieldError2.path).join(", ")}.`,
        nextAction: "Fix the invalid Hokusai plugin configuration values and rerun the doctor."
      };
    }
    const mode = config.apiKey?.trim() && options.transport ? "network" : "offline";
    const baseReport = await runPluginDoctor({
      config,
      mode,
      stateDir: configPath.dir,
      registry: profile17.modelCatalog.registry,
      ...options.transport !== void 0 ? { transport: options.transport } : {}
    });
    const report = validationCheck ? {
      ...baseReport,
      checks: [validationCheck, ...baseReport.checks],
      ok: false
    } : baseReport;
    if (report.ok && config.outcomeSubmissionEnabled && config.apiKey?.trim()) {
      try {
        await recordOnboardingFunnelSignal({
          client: new HokusaiClient({
            apiKey: config.apiKey,
            baseUrl: config.apiBaseUrl,
            ...options.transport ? { transport: options.transport } : {}
          }),
          enabled: true,
          harness: profile17.harness,
          now: new Date(report.checkedAt),
          stage: "doctor_pass",
          store: new FsLocalStore(configPath.dir)
        });
      } catch {
      }
    }
    return {
      report,
      rendered: (profile17.renderDoctorReport ?? renderPluginDoctorReport)(
        report
      )
    };
  };
}

// src/config-path.ts
import { existsSync } from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
var CLAUDE_CODE_STATE_FILE = "state.json";
function resolveClaudeCodeConfigPath(options) {
  const dir = options?.override?.trim() || process.env.HOKUSAI_CONFIG_DIR?.trim() || path2.join(os2.homedir(), ".claude", "hokusai");
  return {
    dir,
    exists: existsSync(dir)
  };
}
function getClaudeCodeStateFilePath(configDir) {
  return path2.join(configDir, CLAUDE_CODE_STATE_FILE);
}

// src/task-packet.ts
function buildClaudeCodeTaskPacket(input, options) {
  const prepared = prepareTaskPacket(input, options);
  return {
    packet: prepared.packet,
    redactionSummary: prepared.redactionSummary
  };
}
function previewClaudeCodeTaskPacket(input, options) {
  const prepared = prepareTaskPacket(input, options);
  return {
    willSend: prepared.packet,
    redactionSummary: prepared.redactionSummary,
    hasRawCode: prepared.previewResult.hasRawCode,
    hasRawLogs: prepared.previewResult.hasRawLogs
  };
}
function prepareTaskPacket(input, options) {
  if (typeof input.taskText !== "string" || input.taskText.trim().length === 0) {
    throw new Error('Expected "taskText" to be a non-empty string.');
  }
  const rawUserIntent = buildUserIntent(input);
  const rawArrayFields = collectRawArrayFields(input);
  const rawCombinedInput = [rawUserIntent, ...rawArrayFields].filter(Boolean).join("\n");
  const previewResult = preview(rawCombinedInput, options.redactionConfig);
  const intentRedaction = redact(rawUserIntent, options.redactionConfig);
  const redactedAvailableTools = redactStringArray(
    input.availableTools,
    options.redactionConfig
  );
  const redactedConstraints = redactStringArray(
    buildConstraintList(input),
    options.redactionConfig
  );
  const redactedModelConstraints = redactStringArray(
    input.modelConstraints,
    options.redactionConfig
  );
  const redactedProviderConstraints = redactStringArray(
    input.providerConstraints,
    options.redactionConfig
  );
  const repositoryScale = bucketRepositoryScale(input.repositorySignals?.fileCount);
  const languageSignals = toOptionalArray(
    summarizeLanguageSignals(input.repositorySignals?.extensionCounts ?? {})
  );
  const frameworkSignals = toOptionalArray(
    summarizeFrameworkSignals(input.repositorySignals?.dependencyCategories ?? [])
  );
  const packet = buildTaskPacket({
    userIntent: intentRedaction.output,
    taskFamily: input.taskFamily ?? classifyTaskFamily({
      text: rawUserIntent,
      ...input.hints ? { hints: input.hints } : {}
    }),
    reasoningDepth: inferReasoningDepth({
      text: rawUserIntent,
      ...input.reasoningDepth ? { reasoningDepth: input.reasoningDepth } : {}
    }),
    ...repositoryScale ? { repositoryScale } : {},
    ...languageSignals ? { languageSignals } : {},
    ...frameworkSignals ? { frameworkSignals } : {},
    ...redactedAvailableTools.output ? { availableTools: redactedAvailableTools.output } : {},
    ...redactedConstraints.output ? { constraints: redactedConstraints.output } : {},
    ...redactedModelConstraints.output ? { modelConstraints: redactedModelConstraints.output } : {},
    ...redactedProviderConstraints.output ? { providerConstraints: redactedProviderConstraints.output } : {}
  });
  return {
    packet,
    previewResult,
    redactionSummary: aggregateRedactionSummary([
      ...intentRedaction.redactions,
      ...redactedAvailableTools.redactions,
      ...redactedConstraints.redactions,
      ...redactedModelConstraints.redactions,
      ...redactedProviderConstraints.redactions
    ])
  };
}
function buildUserIntent(input) {
  const sections = [input.taskTitle?.trim(), input.taskText.trim()];
  if (input.latencyPreference) {
    sections.push(`Latency preference: ${input.latencyPreference}`);
  }
  if (input.costPreference) {
    sections.push(`Cost preference: ${input.costPreference}`);
  }
  return sections.filter(Boolean).join("\n\n");
}
function collectRawArrayFields(input) {
  const sources = [
    input.availableTools,
    input.constraints,
    input.modelConstraints,
    input.providerConstraints,
    input.hints
  ];
  const entries = [];
  for (const source of sources) {
    if (!source) continue;
    for (const entry of source) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        entries.push(entry);
      }
    }
  }
  return entries;
}
function buildConstraintList(input) {
  const constraints = [
    ...input.constraints ?? [],
    ...input.latencyPreference ? [`latency:${input.latencyPreference}`] : [],
    ...input.costPreference ? [`cost:${input.costPreference}`] : []
  ].map((entry) => entry.trim()).filter(Boolean);
  return constraints.length > 0 ? constraints : void 0;
}
function redactStringArray(entries, config) {
  if (!entries || entries.length === 0) {
    return { output: void 0, redactions: [] };
  }
  const output = [];
  const redactions = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      continue;
    }
    const result = redact(entry, config);
    output.push(result.output);
    redactions.push(...result.redactions);
  }
  return {
    output: output.length > 0 ? output : void 0,
    redactions
  };
}
function aggregateRedactionSummary(redactions) {
  const counts = /* @__PURE__ */ new Map();
  for (const redaction of redactions) {
    counts.set(redaction.category, (counts.get(redaction.category) ?? 0) + redaction.count);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((left, right) => left.category.localeCompare(right.category));
}
function toOptionalArray(entries) {
  return entries.length > 0 ? entries : void 0;
}

// src/profile.ts
var claudeCodeHarnessProfile = {
  harness: "claude-code",
  harnessLabel: "Claude Code",
  defaultSubjectId: "claude-code",
  resolveConfigPath: resolveClaudeCodeConfigPath,
  getStateFilePath: getClaudeCodeStateFilePath,
  createBuilderOptions(options) {
    return {
      redactionConfig: options?.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
      ...options?.clock ? { clock: options.clock } : {}
    };
  },
  buildTaskPacket: buildClaudeCodeTaskPacket,
  previewTaskPacket: previewClaudeCodeTaskPacket,
  toTaskId(input, clock) {
    return input.taskId ?? `claude-code-${(clock ?? (() => /* @__PURE__ */ new Date()))().getTime()}`;
  },
  toPrompt(packet) {
    return JSON.stringify(packet, null, 2);
  },
  modelCatalog: {
    registry: new InMemoryModelRegistry(ANTHROPIC_MODELS),
    allowedProviders: ["anthropic"],
    requireAvailable: true
  },
  buildHandoff({ recommendation, currentModelId }) {
    return buildHandoffInstructions({
      recommendation,
      harness: "claude-code",
      ...currentModelId ? { currentModelId } : {}
    });
  },
  renderHandoff(handoff) {
    if (handoff.instructions.length === 0) {
      return ["Switch in Claude Code: no switch needed."];
    }
    return [
      `Switch in Claude Code: ${handoff.copyableCommand ?? handoff.slashCommand}`
    ];
  },
  defaultRecommendationReason: "Claude Code routes through the shared Anthropic-backed SDK model registry.",
  routeRecommendationReason: "Recommended by the Hokusai router for this Claude Code task.",
  createFallbackConfig({ baseUrl, modelAllowlist }) {
    return {
      apiBaseUrl: baseUrl,
      routingConsentEnabled: true,
      outcomeSubmissionEnabled: false,
      modelAllowlist
    };
  }
};

// src/commands.ts
var routeTask = createRouteTask(claudeCodeHarnessProfile);
var declineRecommendation = createDeclineRecommendation(claudeCodeHarnessProfile);
var runDoctor2 = createRunDoctor(claudeCodeHarnessProfile);
var previewTaskPayload = createPreviewTaskPayload(claudeCodeHarnessProfile);
var previewReportOutcome = createPreviewReportOutcome(claudeCodeHarnessProfile);
var reportTaskOutcome = createReportTaskOutcome(claudeCodeHarnessProfile);
var clearClaudeCodeLocalState = createClearLocalState(claudeCodeHarnessProfile);
var listRoutingDecisions = createListRoutingDecisions(claudeCodeHarnessProfile);
var previewStoredDecision = createPreviewStoredDecision(claudeCodeHarnessProfile);
var listSubmissionAudit = createListSubmissionAudit(claudeCodeHarnessProfile);
var clearPrivacyState = createClearPrivacyState(claudeCodeHarnessProfile);
var setReportingEnabled = createSetReportingEnabled(claudeCodeHarnessProfile);
var getReportingStatus = createGetReportingStatus(claudeCodeHarnessProfile);
function displayHandoff(handoff) {
  return claudeCodeHarnessProfile.renderHandoff(handoff);
}

// src/cli.ts
var runCli = createRunCli(claudeCodeHarnessProfile, {
  routeTask,
  declineRecommendation,
  buildRouteInput(taskText) {
    return { taskText };
  }
});

// src/report-cli.ts
var runReportCli = createRunReportCli(claudeCodeHarnessProfile, {
  findRoutingDecision,
  previewReportOutcome,
  reportTaskOutcome
});

// src/outcome-prompt-hook.ts
function parseArgs4(argv) {
  const eventParts = [];
  let configPath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--config" && next !== void 0) {
      configPath = next;
      index += 1;
      continue;
    }
    if (arg !== void 0) {
      eventParts.push(arg);
    }
  }
  return {
    ...configPath ? { configPath } : {},
    eventText: eventParts.join(" ")
  };
}
function toConfigFilePath3(configPath) {
  if (!configPath) {
    return void 0;
  }
  return configPath.endsWith(".json") ? configPath : defaultPluginConfigPath(
    claudeCodeHarnessProfile.resolveConfigPath({ override: configPath }).dir
  );
}
async function defaultReadStdin2() {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    );
  }
  return chunks.join("");
}
function eventSessionId(event17) {
  if (!event17 || typeof event17 !== "object" || Array.isArray(event17)) {
    return void 0;
  }
  const sessionId = event17.session_id;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : void 0;
}
function parseEvent(rawStdin, eventText) {
  const raw = rawStdin.trim();
  if (raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return eventText;
}
function renderPrompt(prompt) {
  if (!prompt.shouldPrompt) {
    return "";
  }
  const lines = [prompt.message];
  if (prompt.reportCommand) {
    lines.push(`Run: ${prompt.reportCommand}`);
    lines.push(
      "The report command previews the anonymized payload before submission."
    );
  }
  if (prompt.remediation) {
    lines.push(prompt.remediation);
  }
  return `${lines.join("\n")}
`;
}
async function runOutcomePromptHookCli(argv, env, deps = {}) {
  const parsed = parseArgs4(argv);
  const configDir = claudeCodeHarnessProfile.resolveConfigPath(
    parsed.configPath ? { override: parsed.configPath } : void 0
  ).dir;
  const configPath = toConfigFilePath3(parsed.configPath);
  const loadConfigImpl = deps.loadConfig ?? ((input) => loadPluginConfig({
    env: input.env,
    registry: claudeCodeHarnessProfile.modelCatalog.registry,
    ...input.configPath ? { store: new FilePluginConfigStore(input.configPath) } : {}
  }));
  try {
    const [config, rawStdin] = await Promise.all([
      loadConfigImpl(configPath === void 0 ? { env } : { configPath, env }),
      (deps.readStdin ?? defaultReadStdin2)()
    ]);
    const event17 = parseEvent(rawStdin, parsed.eventText);
    const sessionId = eventSessionId(event17);
    const latestRoute = sessionId ? await (deps.findRoutingDecisionImpl ?? findRoutingDecision)({ configDir, sessionId }) : void 0;
    const actualModel = env.HOKUSAI_ACTUAL_MODEL;
    const prompt = buildOutcomeContributionPrompt({
      event: event17,
      ...latestRoute ? { latestRoute } : {},
      outcomeOptIn: config.outcomeSubmissionEnabled,
      reportCommand: "/hokusai:report",
      ...actualModel ? { actualModel } : {}
    });
    return {
      exitCode: 0,
      stdout: renderPrompt(prompt),
      stderr: ""
    };
  } catch (error) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: `Hokusai outcome prompt skipped: ${error instanceof Error ? error.message : String(error)}
`
    };
  }
}

// src/privacy-cli.ts
var runPrivacyCli = createRunPrivacyCli(claudeCodeHarnessProfile, {
  listRoutingDecisions,
  previewStoredDecision,
  listSubmissionAudit,
  clearPrivacyState,
  getReportingStatus,
  setReportingEnabled
});

// src/doctor-command.ts
var runBootstrapDoctor = createRunBootstrapDoctor(claudeCodeHarnessProfile);

// src/index.ts
function ok3(value) {
  return {
    ok: true,
    value
  };
}
function toDiscoveredModel(model) {
  return {
    id: model.id,
    label: model.id,
    metadata: {
      family: model.family,
      provider: model.provider
    }
  };
}
async function readStateFile(filePath) {
  try {
    const raw = await readFile3(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry) => {
          const [, value] = entry;
          return typeof value === "string";
        }
      )
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    return {};
  }
}
async function writeStateFile(filePath, state2) {
  await mkdir4(path3.dirname(filePath), { recursive: true });
  await writeFile4(filePath, JSON.stringify(state2, null, 2), "utf8");
}
function createClaudeCodeAdapter(options) {
  return {
    ...options.apiClient ? { apiClient: options.apiClient } : {},
    harness: "claude-code",
    commands: [
      {
        name: "hokusai.run",
        description: "Dispatch a Hokusai task from Claude Code."
      },
      {
        name: "hokusai.doctor",
        description: "Inspect Hokusai auth, consent, reachability, and allowlist state."
      }
    ],
    manifest: {
      entrypoint: "hokusai",
      modelId: options.modelId,
      version: options.packageVersion
    },
    toTaskReference(task) {
      return `claude-code:${task.id}`;
    }
  };
}
function createClaudeCodeModelProvider(options) {
  const registry = options?.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const allowlist = options?.allowlist ?? ANTHROPIC_MODELS.map((model) => model.id);
  return {
    discoverModels() {
      return Promise.resolve({
        ok: true,
        value: registry.listAvailable().filter((model) => model.provider === "anthropic").filter(
          (model) => validateRecommendedModel(model.id, {
            allowlist,
            registry
          }).ok
        ).map(toDiscoveredModel)
      });
    },
    mapModel(request) {
      const validation = validateRecommendedModel(request.harnessModelId, {
        allowlist,
        registry
      });
      if (validation.ok) {
        const model = registry.get(validation.modelId);
        if (!model) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "UNKNOWN_MODEL",
              message: `Unsupported model recommendation: ${validation.modelId}.`
            }
          });
        }
        return Promise.resolve({
          ok: true,
          value: {
            id: model.id,
            provider: model.provider,
            capabilities: model.capabilities
          }
        });
      }
      const code = validation.reason === "not-anthropic" ? "PROVIDER_NOT_ALLOWED" : validation.reason === "not-in-allowlist" ? "MODEL_NOT_ALLOWED" : "UNKNOWN_MODEL";
      const message = validation.reason === "not-anthropic" ? `Model ${request.harnessModelId} is not supported by this harness.` : validation.reason === "not-in-allowlist" ? `Model ${request.harnessModelId} is not permitted by the configured allowlist.` : `Unsupported model recommendation: ${request.harnessModelId}.`;
      return Promise.resolve({
        ok: false,
        error: {
          code,
          message,
          details: {
            suggestions: validation.suggestions
          }
        }
      });
    }
  };
}
async function loadClaudeCodePluginConfig(options = {}) {
  const { configPath, ...loadOptions } = options;
  const store = configPath ? new FilePluginConfigStore(configPath) : void 0;
  return loadPluginConfig({
    registry: options.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS),
    ...store ? { store } : {},
    ...loadOptions
  });
}
function createClaudeCodeDoctor(options) {
  return {
    async run() {
      const report = await runDoctor({
        ...options,
        registry: new InMemoryModelRegistry(ANTHROPIC_MODELS)
      });
      return {
        report,
        rendered: renderDoctorReport(report)
      };
    }
  };
}
function createClaudeCodeHarnessAdapter(options) {
  const config = resolveClaudeCodeConfigPath({ override: options.configPath });
  const modelProvider = createClaudeCodeModelProvider(
    options.registry ? { registry: options.registry } : void 0
  );
  const stateFilePath = getClaudeCodeStateFilePath(config.dir);
  const handoff = options.handoff;
  return {
    context: {
      collectTaskContext(request) {
        return Promise.resolve(
          ok3({
            task: {
              id: request.taskId ?? "claude-code-task",
              prompt: ""
            },
            harness: {
              name: "claude-code"
            },
            configPath: config.dir,
            command: "hokusai.route"
          })
        );
      }
    },
    models: modelProvider,
    recommendations: {
      displayRecommendation(request) {
        const formatted = displayTaskRecommendation(
          request.recommendation
        );
        void formatted;
        return ok3(void 0);
      }
    },
    ...handoff ? {
      handoff: {
        handoff(request) {
          return handoff.handoff(request);
        }
      }
    } : {},
    outcomes: {
      collectOutcome(request) {
        return Promise.resolve(
          ok3({
            taskId: request.task.id,
            status: "accepted",
            summary: `Task ${request.task.id} accepted by Claude Code`
          })
        );
      }
    },
    payloads: {
      previewPayload(request) {
        return ok3({
          summary: `Task ${request.payload.task.id} (model: ${request.payload.model.id})`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length
        });
      }
    },
    consent: {
      promptConsent(request) {
        return Promise.resolve(
          ok3({
            outcome: "granted",
            scope: request.scope
          })
        );
      }
    },
    storage: {
      async get(key) {
        const state2 = await readStateFile(stateFilePath);
        return ok3(state2[key]);
      },
      async set(key, value) {
        const state2 = await readStateFile(stateFilePath);
        state2[key] = value;
        await writeStateFile(stateFilePath, state2);
        return ok3(void 0);
      },
      async delete(key) {
        const state2 = await readStateFile(stateFilePath);
        delete state2[key];
        if (Object.keys(state2).length === 0) {
          await rm5(stateFilePath, { force: true });
        } else {
          await writeStateFile(stateFilePath, state2);
        }
        return ok3(void 0);
      }
    }
  };
}
export {
  CLAUDE_CODE_STATE_FILE,
  CLI_EXIT_CODES,
  PRIVACY_CLI_EXIT_CODES,
  REPORT_CLI_EXIT_CODES,
  buildClaudeCodeTaskPacket,
  clearClaudeCodeLocalState,
  clearPrivacyState,
  createClaudeCodeAdapter,
  createClaudeCodeDoctor,
  createClaudeCodeHarnessAdapter,
  createClaudeCodeModelProvider,
  declineRecommendation,
  defaultPluginConfigPath,
  displayHandoff,
  displayTaskRecommendation,
  findRoutingDecision,
  getClaudeCodeStateFilePath,
  getReportingStatus,
  listRoutingDecisions,
  listSubmissionAudit,
  loadClaudeCodePluginConfig,
  previewClaudeCodeTaskPacket,
  previewReportOutcome,
  previewStoredDecision,
  previewTaskPayload,
  renderPluginDoctorReport,
  reportTaskOutcome,
  resolveClaudeCodeConfigPath,
  resolveRetentionPolicy,
  routeTask,
  runBootstrapDoctor,
  runCli,
  runDoctor2 as runDoctor,
  runOutcomePromptHookCli,
  runPrivacyCli,
  runReportCli,
  setReportingEnabled
};
