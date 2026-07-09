// src/index.ts
import { mkdir as mkdir4, readFile as readFile3, rm as rm5, writeFile as writeFile4 } from "node:fs/promises";
import path2 from "node:path";

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
  for (const { label, pattern } of patterns) {
    text = text.replace(pattern, (value) => {
      redactions.push({ label, value });
      return options.defaultReplacement ?? `<redacted:${label}>`;
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
function validateSummary(value, path3, knownKeys, statuses, errors) {
  if (!isPlainObject(value)) {
    errors.push({
      path: path3,
      message: `"${path3}" must be an object.`
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) {
      errors.push({
        path: `${path3}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path3}".`
      });
    }
  }
  validateEnum(value.status, `${path3}.status`, statuses, errors);
  if (value.failures !== void 0) {
    validateNonNegativeInteger(value.failures, `${path3}.failures`, errors);
  }
}
function validateExtensions(value, path3, errors) {
  if (!isPlainObject(value)) {
    errors.push({
      path: path3,
      message: `"${path3}" must be an object.`
    });
    return;
  }
  for (const key of Object.keys(value)) {
    if (!OUTCOME_EXTENSION_KEY_SET.has(key)) {
      errors.push({
        path: `${path3}.${key}`,
        message: `Unknown field "${key}" is not allowed in "${path3}".`
      });
    }
  }
  validateNonEmptyString(value.version, `${path3}.version`, errors);
  if (!isPlainObject(value.data)) {
    errors.push({
      path: `${path3}.data`,
      message: `"${path3}.data" must be an object.`
    });
  }
}
function validateLiteralString(value, path3, expected, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({
      path: path3,
      message: `Expected "${path3}" to be "${expected}".`
    });
    return;
  }
  if (value !== expected) {
    errors.push({
      path: path3,
      message: `Unsupported schema version "${value}". Expected "${expected}".`
    });
  }
}
function validateNonEmptyString(value, path3, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({
      path: path3,
      message: `"${path3}" must be a non-empty string.`
    });
  }
}
function validateBoolean(value, path3, errors) {
  if (typeof value !== "boolean") {
    errors.push({
      path: path3,
      message: `"${path3}" must be a boolean.`
    });
  }
}
function validateEnum(value, path3, allowedValues, errors) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    errors.push({
      path: path3,
      message: `"${path3}" must be one of: ${allowedValues.join(", ")}.`
    });
  }
}
function validateIntegerInRange(value, path3, min, max, errors) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.push({
      path: path3,
      message: `"${path3}" must be an integer between ${min} and ${max}.`
    });
  }
}
function validateNonNegativeInteger(value, path3, errors) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push({
      path: path3,
      message: `"${path3}" must be a non-negative integer.`
    });
  }
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatBuildErrorMessage(errors) {
  return `Invalid outcome report: ${errors.map(({ path: path3, message }) => `${path3 || "$"}: ${message}`).join("; ")}`;
}

// ../core/src/schemas.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function pushFieldError(errors, path3, message, code) {
  errors.push({ path: path3, message, code });
}
function validateNonEmptyString2(value, path3, errors) {
  if (typeof value !== "string") {
    pushFieldError(errors, path3, "Expected a string.", "invalid_type");
    return;
  }
  if (value.trim().length === 0) {
    pushFieldError(errors, path3, "Value must not be empty.", "required");
  }
}
function validateStringRecord(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      pushFieldError(
        errors,
        `${path3}.${key}`,
        "Expected a string value.",
        "invalid_type"
      );
    }
  }
}
function validateTaskInput(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.id, `${path3}.id`, errors);
  validateNonEmptyString2(value.prompt, `${path3}.prompt`, errors);
  if ("metadata" in value && value.metadata !== void 0) {
    validateStringRecord(value.metadata, `${path3}.metadata`, errors);
  }
}
function validateConfidence(value, path3, errors) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    pushFieldError(errors, path3, "Expected a number.", "invalid_type");
    return;
  }
  if (value < 0 || value > 1) {
    pushFieldError(
      errors,
      path3,
      "Expected a number between 0 and 1.",
      "invalid_value"
    );
  }
}
function validateRouteRecommendationAlternative(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.model, `${path3}.model`, errors);
  if ("reason" in value && value.reason !== void 0) {
    validateNonEmptyString2(value.reason, `${path3}.reason`, errors);
  }
  if ("confidence" in value && value.confidence !== void 0) {
    validateConfidence(value.confidence, `${path3}.confidence`, errors);
  }
}
function validateRouteRecommendation(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.model, `${path3}.model`, errors);
  if ("reason" in value && value.reason !== void 0) {
    validateNonEmptyString2(value.reason, `${path3}.reason`, errors);
  }
  if ("confidence" in value && value.confidence !== void 0) {
    validateConfidence(value.confidence, `${path3}.confidence`, errors);
  }
  if ("alternatives" in value && value.alternatives !== void 0) {
    if (!Array.isArray(value.alternatives)) {
      pushFieldError(
        errors,
        `${path3}.alternatives`,
        "Expected an array.",
        "invalid_type"
      );
      return;
    }
    value.alternatives.forEach((alternative, index) => {
      validateRouteRecommendationAlternative(
        alternative,
        `${path3}.alternatives.${index}`,
        errors
      );
    });
  }
}
function validateConsentSnapshot(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.subjectId, `${path3}.subjectId`, errors);
  if (!Array.isArray(value.grantedScopes)) {
    pushFieldError(
      errors,
      `${path3}.grantedScopes`,
      "Expected an array of consent scopes.",
      "invalid_type"
    );
    return;
  }
  value.grantedScopes.forEach((scope, index) => {
    validateNonEmptyString2(scope, `${path3}.grantedScopes.${index}`, errors);
  });
}
function validateModelSelection(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.id, `${path3}.id`, errors);
  validateNonEmptyString2(value.provider, `${path3}.provider`, errors);
  if (!Array.isArray(value.capabilities)) {
    pushFieldError(
      errors,
      `${path3}.capabilities`,
      "Expected an array of capabilities.",
      "invalid_type"
    );
    return;
  }
  value.capabilities.forEach((capability, index) => {
    validateNonEmptyString2(capability, `${path3}.capabilities.${index}`, errors);
  });
}
function validateCorrelationRecord(value, path3, errors) {
  if (!isRecord(value)) {
    pushFieldError(errors, path3, "Expected an object.", "invalid_type");
    return;
  }
  validateNonEmptyString2(value.taskId, `${path3}.taskId`, errors);
  validateNonEmptyString2(value.correlationId, `${path3}.correlationId`, errors);
  validateNonEmptyString2(value.createdAt, `${path3}.createdAt`, errors);
}
function validateRedactions(value, path3, errors) {
  if (!Array.isArray(value)) {
    pushFieldError(
      errors,
      path3,
      "Expected an array of redactions.",
      "invalid_type"
    );
    return;
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      pushFieldError(
        errors,
        `${path3}.${index}`,
        "Expected an object.",
        "invalid_type"
      );
      return;
    }
    if ("label" in entry) {
      validateNonEmptyString2(entry.label, `${path3}.${index}.label`, errors);
      return;
    }
    validateNonEmptyString2(entry.category, `${path3}.${index}.category`, errors);
    validateNonEmptyString2(
      entry.placeholder,
      `${path3}.${index}.placeholder`,
      errors
    );
    if (typeof entry.count !== "number") {
      pushFieldError(
        errors,
        `${path3}.${index}.count`,
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
  get(modelId) {
    return this.#models.find((model) => model.id === modelId);
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
  const modelId = typeof recommendation.model === "string" ? recommendation.model.trim() : "";
  const allowedProviders = options.allowedProviders;
  const filteredSuggestions = (excludedModelId) => {
    return options.registry.listAvailable().filter((model) => allowedProviders?.includes(model.provider) ?? true).filter((model) => model.id !== excludedModelId).map((model) => model.id);
  };
  if (!modelId) {
    throw new ModelMappingError(
      "UNKNOWN_MODEL",
      "Model recommendation must include a non-empty model id.",
      filteredSuggestions()
    );
  }
  const descriptor = options.registry.resolve(modelId);
  if (!descriptor) {
    throw new ModelMappingError(
      "UNKNOWN_MODEL",
      `Unsupported model recommendation: ${modelId}.`,
      filteredSuggestions()
    );
  }
  if (allowedProviders && !allowedProviders.includes(descriptor.provider)) {
    throw new ModelMappingError(
      "PROVIDER_NOT_ALLOWED",
      `Model ${descriptor.id} uses provider ${descriptor.provider}, which is not supported by this harness.`,
      filteredSuggestions(descriptor.id)
    );
  }
  if (options.requireAvailable && descriptor.available === false) {
    throw new ModelMappingError(
      "MODEL_UNAVAILABLE",
      `Model ${descriptor.id} is currently unavailable in this harness.`,
      filteredSuggestions(descriptor.id)
    );
  }
  return descriptor;
}
function validateRecommendedModel(modelId, options) {
  const registry = options.registry ?? new InMemoryModelRegistry(ANTHROPIC_MODELS);
  const normalizedModelId = modelId.trim();
  const allowlistedIds = new Set(
    options.allowlist.map((entry) => registry.resolve(entry)).filter(
      (descriptor2) => descriptor2 !== void 0 && descriptor2.provider === "anthropic"
    ).map((descriptor2) => descriptor2.id)
  );
  const suggestions = registry.listAvailable().filter((descriptor2) => descriptor2.provider === "anthropic").filter((descriptor2) => allowlistedIds.has(descriptor2.id)).map((descriptor2) => descriptor2.id);
  if (normalizedModelId.length === 0) {
    return {
      ok: false,
      reason: "unknown",
      suggestions
    };
  }
  const descriptor = registry.resolve(normalizedModelId);
  if (!descriptor) {
    return {
      ok: false,
      reason: "unknown",
      suggestions
    };
  }
  if (descriptor.provider !== "anthropic") {
    return {
      ok: false,
      reason: "not-anthropic",
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor.id)
    };
  }
  if (!allowlistedIds.has(descriptor.id)) {
    return {
      ok: false,
      reason: "not-in-allowlist",
      suggestions: suggestions.filter((suggestion) => suggestion !== descriptor.id)
    };
  }
  return normalizedModelId === descriptor.id ? {
    ok: true,
    modelId: descriptor.id
  } : {
    ok: true,
    modelId: descriptor.id,
    mappedFrom: normalizedModelId
  };
}
var ANTHROPIC_MODELS = [
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    family: "claude",
    aliases: ["opus", "claude-opus"],
    capabilities: ["reasoning", "streaming", "tool-use"],
    available: true
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    family: "claude",
    aliases: ["sonnet", "claude-sonnet"],
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
  constructor(id) {
    super(`Invalid local store identifier: ${id}`);
    this.name = "InvalidStoreIdError";
    this.id = id;
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
function assertSafeStoreId(id) {
  if (id.length === 0 || id.length > 255 || !SAFE_ID_PATTERN.test(id)) {
    throw new InvalidStoreIdError(id);
  }
}
function isRawFieldName(key) {
  return RAW_FIELD_NAMES.has(key) || RAW_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}
function assertNoRawPayloadFields(record, path3 = "") {
  if (Array.isArray(record)) {
    for (const [index, value] of record.entries()) {
      assertNoRawPayloadFields(value, `${path3}[${index}]`);
    }
    return;
  }
  if (!record || typeof record !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    const fieldPath = path3 ? `${path3}.${key}` : key;
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
  async putConfigRecord(id, record) {
    assertSafeStoreId(id);
    assertNoRawPayloadFields(record);
    await writeJsonFile(this.#configFilePath(id), record);
  }
  async getConfigRecord(id) {
    const filePath = this.#configFilePath(id);
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return void 0;
      }
      throw new StoreCorruptError(filePath, error);
    }
  }
  deleteConfigRecord(id) {
    return removeFile(this.#configFilePath(id));
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
  #auditFilePath(id) {
    assertSafeStoreId(id);
    return join(this.#auditDir(), `${id}.json`);
  }
  #configFilePath(id) {
    assertSafeStoreId(id);
    return join(this.#configDir(), `${id}.json`);
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
var ROUTE_PATH = "/api/v1/models/30/predict";
var OUTCOME_PATH = "/v1/outcomes";
var CONTRIBUTIONS_PATH = "/api/v1/models/30/contributions";
var SIGNAL_PATH = "/v1/signals";
var SDK_VERSION = "0.2.0";
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
  async prepareDispatch(task, modelId, scope = "task-execution") {
    if (!isConsentGranted(this.#consent, scope)) {
      throw new HokusaiDispatchError(
        `Consent has not been granted for scope "${scope}".`
      );
    }
    const model = this.#resolveModel(modelId);
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
    return {
      task,
      consent: {
        grantedScopes: [...this.#consent.grantedScopes],
        subjectId: this.#consent.subjectId
      },
      model: this.#toModelSelection(model),
      correlation: correlationRecord,
      prompt: "output" in promptPayload ? promptPayload.output : promptPayload.text,
      redactions: "output" in promptPayload ? promptPayload.redactions : promptPayload.redactions.map(({ label }) => ({ label })),
      createdAt: this.#clock().toISOString()
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
  #resolveModel(modelId) {
    const model = this.#modelRegistry.get(modelId);
    if (!model) {
      throw new HokusaiDispatchError(`Unknown model "${modelId}".`);
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
    const technicalTaskRouterRequest = buildTechnicalTaskRouterRequest(request);
    if (options.dryRun) {
      return {
        ok: true,
        request: technicalTaskRouterRequest
      };
    }
    return this.#send({
      path: ROUTE_PATH,
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
      throw new HokusaiValidationError("Contribution request validation failed.", {
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
    const idempotencyKey = request.metadata.idempotency_key.trim().length > 0 ? request.metadata.idempotency_key : requestId;
    return this.#send({
      path: CONTRIBUTIONS_PATH,
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
    let attempt = 0;
    let lastError;
    while (attempt <= this.#maxRetries) {
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
        if (!shouldRetryResponse(response.status, attempt, this.#maxRetries)) {
          throw lastError;
        }
        await this.#sleep(
          getRetryDelayMs({
            attempt,
            backoffMs: this.#backoffMs,
            retryAfter: parsedError.retryAfter
          })
        );
      } catch (error) {
        if (error instanceof HokusaiApiError) {
          if (!isRetryableApiError(error) || attempt >= this.#maxRetries) {
            throw error;
          }
          lastError = error;
          await this.#sleep(
            getRetryDelayMs({
              attempt,
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
          if (attempt >= this.#maxRetries) {
            throw networkError;
          }
          lastError = networkError;
          await this.#sleep(
            getRetryDelayMs({
              attempt,
              backoffMs: this.#backoffMs
            })
          );
        }
      }
      attempt += 1;
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
function buildUrl(baseUrl, path3) {
  const resolvedBaseUrl = new URL(baseUrl.toString());
  if (!resolvedBaseUrl.pathname.endsWith("/")) {
    resolvedBaseUrl.pathname = `${resolvedBaseUrl.pathname}/`;
  }
  return new URL(path3.replace(/^\/+/, ""), resolvedBaseUrl).toString();
}
function createRequestId() {
  const cryptoObject = Reflect.get(globalThis, "crypto");
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }
  return `hokusai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function defaultBackoffMs(attempt) {
  return Math.min(250 * 2 ** attempt, 2e3);
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
  for (const field of ["kind", "stage", "installationId", "occurredAt"]) {
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
  const rowsAccepted = firstFiniteNumber(record.rowsAccepted, record.rows_accepted);
  if (rowsAccepted !== void 0) {
    response.rowsAccepted = rowsAccepted;
  }
  const submittedRows = firstFiniteNumber(record.submittedRows, record.submitted_rows);
  if (submittedRows !== void 0) {
    response.submittedRows = submittedRows;
  }
  const tokenReward = firstFiniteNumber(record.tokenReward, record.token_reward);
  if (tokenReward !== void 0) {
    response.tokenReward = tokenReward;
  }
  return response;
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
function readStringList(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return void 0;
  }
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : void 0;
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
function normalizeRoutingObjective(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["lowest_cost", "fastest_completion", "highest_reliability"].includes(
    normalized
  )) {
    return normalized;
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
  const modelIds = readStringList(metadata.available_models) ?? [
    request.model.id
  ];
  const inputs = {
    task: omitUndefined({
      description: request.prompt,
      task_type: normalizeTaskType(
        metadata.task_type ?? metadata.taskType ?? metadata.taskFamily,
        request.prompt
      ),
      language: firstNonEmptyString(metadata.primaryLanguage, metadata.language),
      framework: firstNonEmptyString(metadata.framework, metadata.stack),
      repo_type: firstNonEmptyString(metadata.repoType, metadata.repo_type)
    }),
    routing: omitUndefined({
      available_models: modelIds,
      available_planner_models: readStringList(metadata.available_planner_models) ?? modelIds,
      available_coder_models: readStringList(metadata.available_coder_models) ?? modelIds,
      available_reviewer_models: readStringList(metadata.available_reviewer_models) ?? modelIds,
      preferred_models: readStringList(metadata.preferred_models),
      max_cost_usd: readNumber(metadata.max_cost_usd),
      max_latency_seconds: readNumber(metadata.max_latency_seconds),
      objective: normalizeRoutingObjective(metadata.objective),
      prioritize_quality: readBoolean(metadata.prioritize_quality),
      prioritize_speed: readBoolean(metadata.prioritize_speed)
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
  return { inputs: omitEmptySections(inputs) };
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
  return /\b(test|tests|testing|spec|vitest|jest|pytest|cypress)\b/i.test(prompt);
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
    const fieldError = {
      path: entry.path,
      message: entry.message
    };
    if (isFieldErrorCode(entry.code)) {
      fieldError.code = entry.code;
    }
    fieldErrors.push(fieldError);
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
function shouldRetryResponse(status, attempt, maxRetries) {
  if (attempt >= maxRetries) {
    return false;
  }
  return status === 429 || status >= 500;
}

// ../core/src/config.ts
import { readFile as readFile2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
import { mkdir as mkdir2 } from "node:fs/promises";

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

// ../core/src/config.ts
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
    const descriptor = resolvedRegistry.resolve(entry);
    if (!descriptor || descriptor.provider !== "anthropic") {
      unknownEntries.push(entry);
      continue;
    }
    validModelIds.add(descriptor.id);
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
function normalizeBoolean(value, path3, fieldErrors, defaultValue) {
  if (value === void 0) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    fieldErrors.push({
      path: path3,
      code: "invalid_type",
      message: `Expected ${path3} to be a boolean.`
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
    const descriptor = options.registry?.resolve(normalized);
    if (!descriptor) {
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
    if (descriptor.provider !== "anthropic") {
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
    allowlist.push(descriptor.id);
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

// ../core/src/onboarding-funnel.ts
var STORE_ID = "onboarding-funnel";
async function recordOnboardingFunnelSignal(input) {
  if (!input.enabled || !input.client) {
    return;
  }
  const now = input.now ?? /* @__PURE__ */ new Date();
  const state = await getOrCreateState(input.store, now);
  const stages = new Set(state.emittedStages);
  const pendingSignals = [];
  if (!stages.has("install")) {
    pendingSignals.push(buildSignal("install", state, now, input.harness));
    stages.add("install");
  }
  if (!stages.has(input.stage)) {
    pendingSignals.push(
      buildSignal(input.stage, state, now, input.harness)
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
    ...state,
    emittedStages: [...stages]
  });
}
function buildSignal(stage, state, now, harness) {
  const signal = {
    kind: "onboarding_funnel",
    stage,
    installationId: state.installationId,
    installedAt: state.installedAt,
    occurredAt: now.toISOString()
  };
  if (harness) {
    signal.harness = harness;
  }
  if (stage === "first_route") {
    signal.timeToFirstRouteMs = Math.max(
      0,
      now.getTime() - Date.parse(state.installedAt)
    );
  }
  return signal;
}
async function getOrCreateState(store, now) {
  const stored = await store.getConfigRecord(STORE_ID);
  if (stored) {
    return normalizeState(stored, now);
  }
  const state = {
    installationId: createInstallationId(now),
    installedAt: now.toISOString(),
    emittedStages: []
  };
  await putState(store, state);
  return state;
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
function putState(store, state) {
  return store.putConfigRecord(STORE_ID, {
    installationId: state.installationId,
    installedAt: state.installedAt,
    emittedStages: state.emittedStages
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

// ../core/src/doctor.ts
import { mkdir as mkdir3, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
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
  const modelId = allowlistSummary.validModelIds[0];
  const model = modelId ? registry.get(modelId) : void 0;
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
  const path3 = options?.path ?? DEFAULT_REACHABILITY_PATH;
  const requestId = options?.requestId ?? (/* @__PURE__ */ new Date()).toISOString();
  const isDefaultHealthProbe = path3 === DEFAULT_REACHABILITY_PATH;
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
        path3
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
function buildReachabilityUrl(baseUrl, path3) {
  const normalizedBase = new URL(baseUrl);
  if (!normalizedBase.pathname.endsWith("/")) {
    normalizedBase.pathname = `${normalizedBase.pathname}/`;
  }
  return new URL(path3.replace(/^\/+/, ""), normalizedBase).toString();
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
    await rm3(probePath, { force: true }).catch(() => void 0);
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
function validateLiteralString2(value, path3, expected, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({
      path: path3,
      message: `Expected "${path3}" to be "${expected}".`
    });
    return;
  }
  if (value !== expected) {
    errors.push({
      path: path3,
      message: `Unsupported schema version "${value}". Expected "${expected}".`
    });
  }
}
function validateNonEmptyString3(value, path3, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({
      path: path3,
      message: `"${path3}" must be a non-empty string.`
    });
  }
}
function validateEnum2(value, path3, allowedValues, errors) {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    errors.push({
      path: path3,
      message: `"${path3}" must be one of: ${allowedValues.join(", ")}.`
    });
  }
}
function validateStringArray(value, path3, errors) {
  if (!Array.isArray(value)) {
    errors.push({
      path: path3,
      message: `"${path3}" must be an array of strings.`
    });
    return;
  }
  const entries = value;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      errors.push({
        path: `${path3}[${index}]`,
        message: `"${path3}" entries must be non-empty strings.`
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
var DATE_SUFFIX = /-\d{8}$/;
function resolveModelPrice(model) {
  if (typeof model !== "string") {
    return void 0;
  }
  const normalized = model.trim().toLowerCase();
  if (normalized.length === 0) {
    return void 0;
  }
  return ANTHROPIC_MODEL_PRICING[normalized] ?? ANTHROPIC_MODEL_PRICING[normalized.replace(DATE_SUFFIX, "")];
}
function computeActualCostUsd(input) {
  const price = resolveModelPrice(input.model);
  if (!price) {
    return void 0;
  }
  const { inputTokens, outputTokens } = input;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) {
    return void 0;
  }
  const cost = inputTokens / 1e6 * price.inputPerMTokUsd + outputTokens / 1e6 * price.outputPerMTokUsd;
  return Math.round(cost * 1e6) / 1e6;
}

// ../core/src/plugin-commands/commands.ts
import { rm as rm4 } from "node:fs/promises";

// ../core/src/plugin-commands/harness-profile.ts
function toModelSelection(model) {
  return {
    id: model.id,
    provider: model.provider,
    capabilities: model.capabilities
  };
}
function buildDefaultRecommendation(profile, model, registry = profile.modelCatalog.registry) {
  const allowedProviders = profile.modelCatalog.allowedProviders;
  return {
    model: toModelSelection(model),
    reason: profile.defaultRecommendationReason,
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
function deriveTaskDescriptor(input) {
  const derived = {};
  const taskText = input.taskText?.trim();
  if (taskText && taskText.length > 0) {
    derived.task_type = TASK_FAMILY_TO_HOKUSAI_TYPE[classifyTaskFamily({ text: taskText })];
    derived.complexity = inferReasoningDepth({ text: taskText });
  }
  const repoSizeBucket = bucketRepositoryScale(input.repositorySignals?.fileCount);
  if (repoSizeBucket) {
    derived.repo_size_bucket = repoSizeBucket;
  }
  const extensionCounts = input.repositorySignals?.extensionCounts;
  if (extensionCounts) {
    const dominant = dominantLanguage(extensionCounts);
    if (dominant) {
      derived.language = dominant;
    }
  }
  return derived;
}
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
function buildRouteContextProjection(metadata, modelConstraints, signals = {}) {
  const derived = deriveTaskDescriptor({
    taskText: signals.taskText,
    repositorySignals: signals.repositorySignals
  });
  const descriptorPairs = [
    [
      "task_type",
      firstMetadataValue(metadata, "task_type", "taskType", "taskFamily") ?? derived.task_type
    ],
    ["language", firstMetadataValue(metadata, "language", "primaryLanguage") ?? derived.language],
    ["domain", firstMetadataValue(metadata, "domain")],
    [
      "complexity",
      firstMetadataValue(metadata, "estimated_complexity", "complexity", "reasoningDepth") ?? derived.complexity
    ],
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
  return {
    taskDescriptor,
    allowedModels,
    ...budgetUsd !== void 0 && Number.isFinite(budgetUsd) ? { budgetUsd } : {}
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
      ...typeof record.budgetUsd === "number" && Number.isFinite(record.budgetUsd) ? { budgetUsd: record.budgetUsd } : {}
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
function summarizeCount(label, value) {
  if (!value) {
    return void 0;
  }
  const suffix = value.failures === void 0 ? "" : ` (${value.failures} failures)`;
  return `${label}: ${value.status}${suffix}`;
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
    "Contribution row (harness_outcome_row/v1) that will be submitted:",
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
  try {
    const row = buildHarnessOutcomeRow({
      inferenceLogId: input.inferenceLogId,
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
function applyProfileConstraints(packet, profile, registry) {
  const providerConstraints = profile.modelCatalog.providerConstraintLabels ?? profile.modelCatalog.allowedProviders;
  const modelConstraints = profile.modelCatalog.modelConstraintLabels ?? profile.modelCatalog.allowedModels ?? listSupportedModelIds(registry, {
    ...profile.modelCatalog.allowedProviders ? { allowedProviders: profile.modelCatalog.allowedProviders } : {},
    ...profile.modelCatalog.requireAvailable === void 0 ? {} : { requireAvailable: profile.modelCatalog.requireAvailable }
  });
  return {
    ...packet,
    ...providerConstraints && providerConstraints.length > 0 ? { providerConstraints: [...providerConstraints] } : {},
    ...modelConstraints && modelConstraints.length > 0 ? { modelConstraints: [...modelConstraints] } : {}
  };
}
function buildRecommendationFromRoute(route, profile, registry) {
  if (!route.recommendation) {
    return void 0;
  }
  const mapped = mapRecommendation(route.recommendation, {
    registry,
    ...profile.modelCatalog.allowedProviders ? { allowedProviders: profile.modelCatalog.allowedProviders } : {},
    requireAvailable: profile.modelCatalog.requireAvailable ?? true
  });
  return {
    model: toModelSelection(mapped),
    reason: route.recommendation.reason ?? profile.routeRecommendationReason,
    ...route.recommendation.confidence === void 0 ? {} : { confidence: route.recommendation.confidence },
    ...route.recommendation.alternatives?.length ? {
      alternatives: route.recommendation.alternatives.map(
        (alternative) => ({
          model: toModelSelection(
            mapRecommendation(alternative, {
              registry,
              ...profile.modelCatalog.allowedProviders ? {
                allowedProviders: profile.modelCatalog.allowedProviders
              } : {},
              requireAvailable: profile.modelCatalog.requireAvailable ?? true
            })
          ),
          ...alternative.reason === void 0 ? {} : { reason: alternative.reason },
          ...alternative.confidence === void 0 ? {} : { confidence: alternative.confidence }
        })
      )
    } : {}
  };
}
function resolveCommandContext(profile, options) {
  const consent = options?.consent ?? {
    subjectId: profile.defaultSubjectId,
    grantedScopes: ["task-execution", "telemetry", "local-storage"]
  };
  const config = profile.resolveConfigPath(
    options?.configPath ? { override: options.configPath } : void 0
  );
  const settings = resolveConsent({
    routingEnabled: options?.settings?.routingEnabled ?? isConsentGranted(consent, "task-execution"),
    outcomeReportingEnabled: options?.settings?.outcomeReportingEnabled ?? isConsentGranted(consent, "telemetry")
  });
  return {
    builderOptions: profile.createBuilderOptions(options),
    consent,
    configDir: config.dir,
    registry: options?.registry ?? profile.modelCatalog.registry,
    settings
  };
}
function createRouteTask(profile) {
  return async function routeTask2(input, options) {
    if (typeof input.taskText !== "string" || input.taskText.trim().length === 0) {
      return fail(
        "INVALID_TASK",
        'Expected "taskText" to be a non-empty string.'
      );
    }
    const context = resolveCommandContext(profile, options);
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
        `No ${profile.harnessLabel} model is configured for routing.`
      );
    }
    let recommendation;
    try {
      const mapped = mapRecommendation(
        { model: selectedModelId },
        {
          registry: context.registry,
          ...profile.modelCatalog.allowedProviders ? { allowedProviders: profile.modelCatalog.allowedProviders } : {},
          requireAvailable: profile.modelCatalog.requireAvailable ?? true
        }
      );
      recommendation = buildDefaultRecommendation(
        profile,
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
    const packetResult = profile.buildTaskPacket(input, context.builderOptions);
    packetResult.packet = applyProfileConstraints(
      packetResult.packet,
      profile,
      context.registry
    );
    const store = new FsLocalStore(context.configDir);
    const taskId = profile.toTaskId(input, options?.clock);
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
        prompt: profile.toPrompt(packetResult.packet),
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
            (fieldError) => `${fieldError.path}: ${fieldError.message}`
          )
        }
      );
    }
    const timestamp = (options?.clock ?? (() => /* @__PURE__ */ new Date()))().getTime();
    const correlationId = payload.correlation.correlationId;
    const payloadHash = hashPayload(
      payload,
      (context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG).salt
    );
    await store.putPayloadHash({
      hash: payloadHash,
      algorithm: "sha-256-hmac",
      createdAt: timestamp
    });
    let route;
    if (options?.apiClient) {
      try {
        route = await options.apiClient.route(payload);
        const routeRecommendation = buildRecommendationFromRoute(
          route,
          profile,
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
          timestamp,
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
        timestamp
      });
    }
    const currentModelId = selectedModelId;
    const handoff = profile.buildHandoff({
      recommendation,
      currentModelId
    });
    const storedCorrelation = await findStoredCorrelationRecord(
      store,
      correlationId
    );
    if (storedCorrelation.record) {
      const redactionConfig = context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
      const routeContextProjection = buildRouteContextProjection(
        input.metadata,
        packetResult.packet.modelConstraints,
        {
          taskText: input.taskText,
          ...input.repositorySignals ? { repositorySignals: input.repositorySignals } : {}
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
        timestamp
      });
      await recordCommandFunnelSignal({
        enabled: canReportOutcome(context.settings),
        options,
        stage: "first_route",
        store,
        harness: profile.harness
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
function createDeclineRecommendation(profile) {
  return async function declineRecommendation2(input, options) {
    if (typeof input.correlationId !== "string" || input.correlationId.trim().length === 0) {
      return fail(
        "UNKNOWN_CORRELATION",
        "A correlation id is required to decline a recommendation."
      );
    }
    const context = resolveCommandContext(profile, options);
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
function createRunDoctor(profile) {
  return function runDoctor3(options) {
    const config = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    );
    const consent = options?.consent ?? {
      subjectId: profile.defaultSubjectId,
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
function createPreviewTaskPayload(profile) {
  return function previewTaskPayload2(input, options) {
    const context = resolveCommandContext(profile, options);
    const packet = applyProfileConstraints(
      profile.buildTaskPacket(input, context.builderOptions).packet,
      profile,
      context.registry
    );
    const previewResult = profile.previewTaskPacket(
      input,
      context.builderOptions
    );
    const taskId = profile.toTaskId(input, options?.clock);
    const harnessPreview = buildPayloadPreview({
      task: { id: taskId, prompt: profile.toPrompt(packet) },
      prompt: packet.userIntent,
      consent: {
        subjectId: context.consent.subjectId,
        grantedScopes: [...context.consent.grantedScopes]
      },
      model: {
        id: input.modelId ?? context.registry.getDefault()?.id ?? "unconfigured-model",
        provider: context.registry.get(
          input.modelId ?? context.registry.getDefault()?.id ?? ""
        )?.provider ?? profile.modelCatalog.allowedProviders?.[0] ?? "unknown",
        capabilities: context.registry.get(
          input.modelId ?? context.registry.getDefault()?.id ?? ""
        )?.capabilities ?? []
      },
      correlation: {
        taskId,
        correlationId: "preview-only",
        createdAt: (/* @__PURE__ */ new Date(0)).toISOString()
      },
      redactions: profile.buildTaskPacket(input, context.builderOptions).redactionSummary.map((entry) => ({
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
async function findLatestRoutingDecision(input) {
  const store = new FsLocalStore(input.configDir);
  const records = await store.listCorrelations();
  const latest = records.reduce(
    (currentLatest, record) => {
      if (!currentLatest || record.createdAt > currentLatest.createdAt) {
        return record;
      }
      return currentLatest;
    },
    void 0
  );
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
function createPreviewReportOutcome(profile) {
  return function previewReportOutcome2(input, options) {
    const context = resolveCommandContext(profile, options);
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
      harness: profile.harness,
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
function createReportTaskOutcome(profile) {
  const previewReportOutcome2 = createPreviewReportOutcome(profile);
  return async function reportTaskOutcome2(input, options) {
    const previewResult = previewReportOutcome2(input, options);
    if (!previewResult.ok) {
      return previewResult;
    }
    const context = resolveCommandContext(profile, options);
    const store = new FsLocalStore(context.configDir);
    const timestamp = (options?.clock ?? (() => /* @__PURE__ */ new Date()))().getTime();
    const observedAt = new Date(timestamp).toISOString();
    const redactionConfig = context.builderOptions.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
    await store.putPayloadHash({
      hash: hashPayload(previewResult.value.report, redactionConfig.salt),
      algorithm: "sha-256-hmac",
      createdAt: timestamp
    });
    const resolvedCorrelation = await findStoredCorrelationRecord(
      store,
      input.correlationId
    );
    const routeContext = parseRouteContext(resolvedCorrelation.record?.metadata?.routeContext) ?? input.routeContext;
    const inferenceLogId = input.inferenceLogId ?? resolvedCorrelation.record?.metadata?.inferenceLogId;
    const contributionRowResult = buildReportContributionRow({
      report: previewResult.value.report,
      routeContext,
      inferenceLogId,
      harness: profile.harness,
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
        timestamp,
        error: "dry-run"
      });
    } else if (options?.apiClient) {
      if (!contributionRowResult.ok) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "contribution"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp,
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
          timestamp
        });
        await recordCommandFunnelSignal({
          enabled: canReportOutcome(context.settings),
          options,
          stage: "first_contribution",
          store,
          harness: profile.harness
        });
      } catch (error) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "contribution"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp,
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
          timestamp
        });
      } catch (error) {
        await store.appendAudit({
          id: toAuditId(input.correlationId, "outcome"),
          kind: "outcome",
          correlationId: input.correlationId,
          status: "failed",
          timestamp,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      await store.appendAudit({
        id: toAuditId(input.correlationId, "outcome"),
        kind: "outcome",
        correlationId: input.correlationId,
        status: "skipped",
        timestamp
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
function createClearLocalState(profile) {
  return async function clearLocalState(options) {
    const config = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    );
    const store = new FsLocalStore(config.dir);
    await store.clear();
    if (profile.getStateFilePath) {
      await rm4(profile.getStateFilePath(config.dir), { force: true });
    }
    await rm4(config.dir, { recursive: true, force: true });
    return ok({ ok: true });
  };
}
function createListRoutingDecisions(profile) {
  return async function listRoutingDecisions2(input = {}, options) {
    const context = resolveCommandContext(profile, options);
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
function createPreviewStoredDecision(profile) {
  return async function previewStoredDecision2(input, options) {
    if (typeof input.correlationId !== "string" || input.correlationId.trim().length === 0) {
      return fail("UNKNOWN_CORRELATION", "A correlation id is required.");
    }
    const context = resolveCommandContext(profile, options);
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
function createListSubmissionAudit(profile) {
  return async function listSubmissionAudit2(input = {}, options) {
    const context = resolveCommandContext(profile, options);
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
function createClearPrivacyState(profile) {
  const clearLocalState = createClearLocalState(profile);
  return async function clearPrivacyState2(input, options) {
    const configDir = input.configDir ?? profile.resolveConfigPath(
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
function createSetReportingEnabled(profile) {
  return async function setReportingEnabled2(input, options) {
    const configDir = profile.resolveConfigPath(
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
function createGetReportingStatus(profile) {
  return async function getReportingStatus2(options) {
    const configDir = profile.resolveConfigPath(
      options?.configPath ? { override: options.configPath } : void 0
    ).dir;
    const store = new FilePluginConfigStore(defaultPluginConfigPath(configDir));
    const stored = await store.read();
    const config = await loadPluginConfig({
      env: options?.env ?? process.env,
      store,
      registry: profile.modelCatalog.registry
    });
    return ok({
      enabled: config.outcomeSubmissionEnabled,
      source: (options?.env ?? process.env).HOKUSAI_OUTCOME_OPT_IN !== void 0 ? "env" : stored?.outcomeSubmissionEnabled !== void 0 ? "stored" : "default"
    });
  };
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
function toConfigFilePath(profile, configPath) {
  if (!configPath) {
    return void 0;
  }
  return configPath.endsWith(".json") ? configPath : defaultPluginConfigPath(profile.resolveConfigPath({ override: configPath }).dir);
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
function createRunCli(profile, impls) {
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
    const registry = profile.modelCatalog.registry;
    const loadConfigImpl = deps.loadConfig ?? ((input) => loadPluginConfig({
      env: input.env,
      registry,
      ...input.configPath ? { store: new FilePluginConfigStore(input.configPath) } : {}
    }));
    const routeTaskImpl = deps.routeTaskImpl ?? impls.routeTask;
    const declineRecommendationImpl = deps.declineRecommendationImpl ?? impls.declineRecommendation;
    let config;
    try {
      const configPath = toConfigFilePath(profile, parsed.configPath);
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
          `Hokusai recommended a model not available in ${profile.harnessLabel} (${recommendedModel}). Suggested fallbacks: ${suggestions}.`,
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
    lines.push(...profile.renderHandoff(result.value.handoff));
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
function toConfigFilePath2(profile, configPath) {
  if (!configPath) {
    return void 0;
  }
  return configPath.endsWith(".json") ? configPath : defaultPluginConfigPath(profile.resolveConfigPath({ override: configPath }).dir);
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
function withDefaultBucket(value, label, notes) {
  if (value !== void 0) {
    return value;
  }
  notes.push(`Defaulted ${label} to "medium".`);
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
function createRunReportCli(profile, impls) {
  return async function runReportCli2(argv, env, deps = {}) {
    const parsed = parseArgs2(argv);
    const registry = profile.modelCatalog.registry;
    const loadConfigImpl = deps.loadConfig ?? ((input) => loadPluginConfig({
      env: input.env,
      registry,
      // Always read the persisted plugin config so consent set via
      // `hokusai-privacy reporting on` is honored, not just the
      // HOKUSAI_OUTCOME_OPT_IN env var. Mirrors getReportingStatus.
      store: new FilePluginConfigStore(
        input.configPath ?? defaultPluginConfigPath(profile.resolveConfigPath().dir)
      )
    }));
    const previewReportOutcomeImpl = deps.previewReportOutcomeImpl ?? impls.previewReportOutcome;
    const reportTaskOutcomeImpl = deps.reportTaskOutcomeImpl ?? impls.reportTaskOutcome;
    const findLatestRoutingDecisionImpl = deps.findLatestRoutingDecisionImpl ?? impls.findLatestRoutingDecision;
    let config;
    try {
      const configPath = toConfigFilePath2(profile, parsed.configPath);
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
    const configDir = profile.resolveConfigPath(
      parsed.configPath ? { override: parsed.configPath } : void 0
    ).dir;
    let latest;
    if (parsed.useLatest || parsed.correlationId === void 0 && pipedInput.correlationId === void 0) {
      try {
        latest = await findLatestRoutingDecisionImpl({ configDir });
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
    if ((parsed.useLatest || parsed.correlationId === void 0) && pipedInput.correlationId === void 0 && !latest) {
      return toMessage2(
        parsed,
        "No local routing decision was found. Pass --correlation-id or route a task first.",
        REPORT_CLI_EXIT_CODES.OUTCOME_VALIDATION_ERROR,
        {
          fieldErrors: ["correlationId: Provide --correlation-id or use --use-latest after routing a task."]
        }
      );
    }
    const stderrNotes = [];
    const recommendationAccepted = resolveRecommendationAccepted(parsed, pipedInput);
    const resolvedInferenceLogId = parsed.inferenceLogId ?? latest?.inferenceLogId;
    const resolvedActualModel = parsed.actualModel ?? pipedInput.actualModel ?? (recommendationAccepted === true ? latest?.recommendedModelId : void 0) ?? "";
    const resolvedActualCostUsd = parsed.actualCostUsd ?? (parsed.inputTokens !== void 0 && parsed.outputTokens !== void 0 ? computeActualCostUsd({
      model: resolvedActualModel,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens
    }) : void 0);
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
function detectOutcomeCompletionSignal(event) {
  const signals = /* @__PURE__ */ new Set();
  collectCompletionSignals(event, signals);
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
  const actualModel = input.actualModel ?? input.latestRoute.recommendedModelId;
  if (!actualModel) {
    return {
      shouldPrompt: true,
      status: "missing_model",
      message: "Looks like this task succeeded - contribute this outcome after supplying the actual model used.",
      signals: detection.signals,
      remediation: "Run the report command with --actual-model set to the model that completed the task."
    };
  }
  const reportArgs = [
    "--use-latest",
    "--recommended-model",
    input.latestRoute.recommendedModelId ?? actualModel,
    "--actual-model",
    actualModel,
    "--accepted",
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
function parseNumber(value) {
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
    const limit = limitIndex >= 0 ? parseNumber(argv[limitIndex + 1]) : void 0;
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
function fail2(message, code, json) {
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
      return fail2(
        parsed.error,
        PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
        argv.includes("--json")
      );
    }
    if ("limit" in parsed && parsed.limit !== void 0 && parsed.limit < 0 || "limit" in parsed && argv.includes("--limit") && parsed.limit === void 0) {
      return fail2(
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
        return fail2(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
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
        return fail2(
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
        return fail2(
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
        return fail2(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
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
        return fail2(
          "Specify one of --all, --records, or --audit.",
          PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
          parsed.json
        );
      }
      if (!parsed.yes) {
        return fail2(
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
        return fail2(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
      }
      return ok2(`Cleared ${parsed.scope} privacy state.
`, parsed.json, {
        subcommand: "clear",
        result: result.value
      });
    }
    if (parsed.subcommand === "reporting") {
      if (!parsed.action) {
        return fail2(
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
          return fail2(result2.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
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
        return fail2(result.error.message, PRIVACY_CLI_EXIT_CODES.UNKNOWN_ERROR, parsed.json);
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
        return fail2(
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
    return fail2(
      "Usage: hokusai-privacy list|preview|audit|clear|reporting|debug",
      PRIVACY_CLI_EXIT_CODES.PRIVACY_USAGE_ERROR,
      argv.includes("--json")
    );
  };
}

// ../core/src/plugin-commands/doctor.ts
function buildFallbackAllowlist(profile) {
  const allowedProviders = profile.modelCatalog.allowedProviders;
  return profile.modelCatalog.registry.list().filter((model) => allowedProviders?.includes(model.provider) ?? true).map((model) => model.id);
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
function createRunBootstrapDoctor(profile) {
  return async function runBootstrapDoctor2(options = {}) {
    const configPath = profile.resolveConfigPath(
      options.configPath ? { override: options.configPath } : void 0
    );
    const pluginConfigPath = options.pluginConfigPath ?? defaultPluginConfigPath(configPath.dir);
    const modelAllowlist = buildFallbackAllowlist(profile);
    let config = profile.createFallbackConfig?.({
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
        registry: profile.modelCatalog.registry,
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
        summary: `Plugin configuration is invalid for: ${error.fieldErrors.map((fieldError) => fieldError.path).join(", ")}.`,
        nextAction: "Fix the invalid Hokusai plugin configuration values and rerun the doctor."
      };
    }
    const mode = config.apiKey?.trim() && options.transport ? "network" : "offline";
    const baseReport = await runPluginDoctor({
      config,
      mode,
      stateDir: configPath.dir,
      registry: profile.modelCatalog.registry,
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
          harness: profile.harness,
          now: new Date(report.checkedAt),
          stage: "doctor_pass",
          store: new FsLocalStore(configPath.dir)
        });
      } catch {
      }
    }
    return {
      report,
      rendered: (profile.renderDoctorReport ?? renderPluginDoctorReport)(
        report
      )
    };
  };
}

// ../core/src/contribution/schema.ts
var TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION = "technical_task_router_row/v1";
var TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2 = "technical_task_router_row/v2";
var HARNESS_OUTCOME_ROW_SCHEMA_VERSION = "harness_outcome_row/v1";
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
function isPlainObject3(value) {
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
  if (!isPlainObject3(value)) {
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
  if (!isPlainObject3(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["planner_models", "coder_models", "reviewer_models"])) {
    return false;
  }
  return isStringArray(value.planner_models) && isStringArray(value.coder_models) && isStringArray(value.reviewer_models);
}
function isOutcomeLabels(value) {
  if (!isPlainObject3(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["budget_label", "cost_label", "time_label", "success_label"])) {
    return false;
  }
  return (value.budget_label === "under_budget" || value.budget_label === "over_budget" || value.budget_label === "unknown") && (value.cost_label === "free" || value.cost_label === "low" || value.cost_label === "medium" || value.cost_label === "high" || value.cost_label === "unknown") && (value.time_label === "fast" || value.time_label === "medium" || value.time_label === "slow" || value.time_label === "unknown") && (value.success_label === "success" || value.success_label === "failure");
}
function isCandidatePoolMetadata(value) {
  if (!isPlainObject3(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["scenario_id", "scenario_kind", "pool_size", "baseline_model"])) {
    return false;
  }
  return typeof value.scenario_id === "string" && typeof value.scenario_kind === "string" && isFiniteNonNegativeNumber(value.pool_size) && (value.baseline_model === void 0 || typeof value.baseline_model === "string");
}
function isSparseCellMetadata(value) {
  if (!isPlainObject3(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["cell_id", "descriptor_signature", "observed_count", "is_sparse"])) {
    return false;
  }
  return typeof value.cell_id === "string" && typeof value.descriptor_signature === "string" && isFiniteNonNegativeNumber(value.observed_count) && typeof value.is_sparse === "boolean";
}
function assertNoForbiddenKeys(value, path3 = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, [...path3, String(index)]);
    }
    return;
  }
  if (!isPlainObject3(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      throw new ContributionValidationError(
        "forbidden_field",
        `Forbidden field at ${[...path3, key].join(".")}`
      );
    }
    assertNoForbiddenKeys(child, [...path3, key]);
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
  if (!isPlainObject3(value)) {
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
  if (value.inputs !== void 0 && !isPlainObject3(value.inputs)) {
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
  if (!isPlainObject3(value)) {
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
  if (!isPlainObject3(value.task_descriptor)) {
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
  if (!isPlainObject3(value)) {
    return false;
  }
  if (value.schema_version !== TECHNICAL_TASK_ROUTER_ROW_SCHEMA_VERSION_V2) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, [
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
  if (!isPlainObject3(value.task_descriptor)) {
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
  if (!isPlainObject3(value)) {
    return false;
  }
  if (!hasOnlyAllowedKeys(value, ["harness", "sdk_version"])) {
    return false;
  }
  return (value.harness === void 0 || typeof value.harness === "string") && (value.sdk_version === void 0 || typeof value.sdk_version === "string");
}
function isHarnessOutcomeRowV1(value) {
  if (!isPlainObject3(value)) {
    return false;
  }
  if (value.schema_version !== HARNESS_OUTCOME_ROW_SCHEMA_VERSION) {
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
    "completion_result",
    "success_under_budget",
    "inference_log_id",
    "harness",
    "task_id",
    "observed_at",
    "harness_metadata"
  ])) {
    return false;
  }
  if (!isPlainObject3(value.task_descriptor) || Object.keys(value.task_descriptor).length === 0) {
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
function validateContributionRow(row) {
  assertNoForbiddenKeys(row);
  if (isTechnicalTaskRouterContributionRowV1(row) || isTechnicalTaskRouterContributionRowV2(row) || isHarnessOutcomeRowV1(row) || isSubmitDataContributionRow(row)) {
    return row;
  }
  throw new ContributionValidationError(
    "schema_validation_failed",
    "Contribution row does not match a supported redacted schema"
  );
}

// ../core/src/contribution/builder.ts
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
    schema_version: HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
    task_descriptor: { ...projection.taskDescriptor },
    allowed_models: [...projection.allowedModels],
    selected_models: { ...projection.selectedModels },
    completion_result: projection.completionResult,
    ...projection.budgetUsd !== void 0 ? { budget_usd: projection.budgetUsd } : {},
    ...projection.actualCostUsd !== void 0 ? { actual_cost_usd: projection.actualCostUsd } : {},
    ...projection.wallClockSeconds !== void 0 ? { wall_clock_seconds: projection.wallClockSeconds } : {},
    ...projection.successUnderBudget !== void 0 ? { success_under_budget: projection.successUnderBudget } : {},
    ...projection.inferenceLogId ? { inference_log_id: projection.inferenceLogId } : {},
    ...projection.harness ? { harness: projection.harness } : {},
    ...projection.taskId ? { task_id: projection.taskId } : {},
    ...projection.observedAt ? { observed_at: projection.observedAt } : {},
    ...Object.keys(harnessMetadata).length > 0 ? { harness_metadata: harnessMetadata } : {}
  };
  return validateContributionRow(row);
}

// src/config-path.ts
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
var CLAUDE_CODE_STATE_FILE = "state.json";
function resolveClaudeCodeConfigPath(options) {
  const dir = options?.override?.trim() || process.env.HOKUSAI_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude", "hokusai");
  return {
    dir,
    exists: existsSync(dir)
  };
}
function getClaudeCodeStateFilePath(configDir) {
  return path.join(configDir, CLAUDE_CODE_STATE_FILE);
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
  findLatestRoutingDecision,
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
    const [config, latestRoute, rawStdin] = await Promise.all([
      loadConfigImpl(configPath === void 0 ? { env } : { configPath, env }),
      (deps.findLatestRoutingDecisionImpl ?? findLatestRoutingDecision)({
        configDir
      }),
      (deps.readStdin ?? defaultReadStdin2)()
    ]);
    const event = parseEvent(rawStdin, parsed.eventText);
    const actualModel = env.HOKUSAI_ACTUAL_MODEL;
    const prompt = buildOutcomeContributionPrompt({
      event,
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
async function writeStateFile(filePath, state) {
  await mkdir4(path2.dirname(filePath), { recursive: true });
  await writeFile4(filePath, JSON.stringify(state, null, 2), "utf8");
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
        const state = await readStateFile(stateFilePath);
        return ok3(state[key]);
      },
      async set(key, value) {
        const state = await readStateFile(stateFilePath);
        state[key] = value;
        await writeStateFile(stateFilePath, state);
        return ok3(void 0);
      },
      async delete(key) {
        const state = await readStateFile(stateFilePath);
        delete state[key];
        if (Object.keys(state).length === 0) {
          await rm5(stateFilePath, { force: true });
        } else {
          await writeStateFile(stateFilePath, state);
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
  findLatestRoutingDecision,
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
