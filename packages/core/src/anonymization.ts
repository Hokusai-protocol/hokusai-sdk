import { createHmac } from 'node:crypto';

export interface RedactionMatch {
  label: string;
  value: string;
}

export interface RedactionPattern {
  label: string;
  pattern: RegExp;
}

export interface AnonymizationOptions {
  defaultReplacement?: string;
  patterns?: RedactionPattern[];
}

export interface AnonymizedText {
  text: string;
  redactions: RedactionMatch[];
}

export type RedactionMode = 'conservative' | 'advanced';

export type RedactionCategory =
  | 'secret'
  | 'token'
  | 'credential'
  | 'email'
  | 'url'
  | 'hostname'
  | 'org'
  | 'id'
  | 'code'
  | 'log';

export interface CustomRedactionRule {
  category: RedactionCategory;
  pattern: RegExp;
}

export interface RedactionConfig {
  mode?: RedactionMode;
  salt: string;
  secret?: boolean;
  token?: boolean;
  credential?: boolean;
  email?: boolean;
  url?: boolean;
  hostname?: boolean;
  org?: boolean;
  id?: boolean;
  code?: boolean;
  log?: boolean;
  knownNames?: string[];
  customRules?: CustomRedactionRule[];
}

export interface RedactionRecord {
  category: RedactionCategory;
  placeholder: string;
  count: number;
}

export interface RedactionResult {
  output: string;
  redactions: RedactionRecord[];
  mode: RedactionMode;
}

export interface PreviewResult {
  mode: RedactionMode;
  willSend: string;
  redactionSummary: Array<{ category: RedactionCategory; count: number }>;
  hasRawCode: boolean;
  hasRawLogs: boolean;
}

interface RedactionRule {
  category: RedactionCategory;
  pattern: RegExp;
}

type NormalizedRedactionConfig = Omit<Required<RedactionConfig>, 'mode'> & {
  mode: RedactionMode;
};

const defaultPatterns: RedactionPattern[] = [
  {
    label: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    label: 'token',
    pattern: /\b(?:sk|tok)-[A-Za-z0-9]{8,}\b/g,
  },
];

const SECRET_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bxoxb-[A-Za-z0-9-]+\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

const TOKEN_PATTERNS = [
  /\btok-[A-Za-z0-9]{8,}\b/g,
  /\bBearer [A-Za-z0-9._-]{10,}\b/g,
  /^Authorization:\s+[^\n]+$/gm,
];

const CREDENTIAL_PATTERNS = [
  /\bpassword[=: ]+\S+\b/gi,
  /\bpasswd[=: ]+\S+\b/gi,
  /\bapi[_-]?key[=: ]+\S+\b/gi,
  /\bprivate[_-]?key[=: ]+\S+\b/gi,
];

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN = /https?:\/\/[^\s"']+/g;
const HOSTNAME_PATTERN =
  /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}\b/gi;
const CODE_PATTERNS = [
  /```[\s\S]*?```/g,
  /(?:^|\n)(?: {4,}|\t).*(?:\n(?: {4,}|\t).*)*/g,
];
const LOG_PATTERNS = [
  /^(?:\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?\s+.*|(?:ERROR|WARN|INFO|DEBUG|TRACE)\b.*)$/gm,
];

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  mode: 'conservative',
  salt: 'hokusai-default-redaction-salt',
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
  customRules: [],
};

function normalizeSensitiveValue(value: string): string {
  return value.toLowerCase().trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryEnabled(
  config: NormalizedRedactionConfig,
  category: RedactionCategory,
): boolean {
  if ((category === 'code' || category === 'log') && config.mode !== 'conservative') {
    return false;
  }

  return config[category];
}

function normalizeConfig(config: RedactionConfig): NormalizedRedactionConfig {
  return {
    mode: config.mode ?? 'conservative',
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
    knownNames: [...(config.knownNames ?? DEFAULT_REDACTION_CONFIG.knownNames ?? [])],
    customRules: [...(config.customRules ?? DEFAULT_REDACTION_CONFIG.customRules ?? [])],
  };
}

function buildOrgRules(knownNames: string[]): RedactionRule[] {
  return [...knownNames]
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => right.length - left.length)
    .map((name) => ({
      category: 'org' as const,
      pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'),
    }));
}

function buildCustomRules(customRules: CustomRedactionRule[]): RedactionRule[] {
  return customRules.map((rule) => ({
    category: rule.category,
    pattern: new RegExp(rule.pattern.source, rule.pattern.flags),
  }));
}

function buildRules(config: NormalizedRedactionConfig): RedactionRule[] {
  return [
    ...SECRET_PATTERNS.map((pattern) => ({ category: 'secret' as const, pattern })),
    ...TOKEN_PATTERNS.map((pattern) => ({ category: 'token' as const, pattern })),
    ...CREDENTIAL_PATTERNS.map((pattern) => ({
      category: 'credential' as const,
      pattern,
    })),
    { category: 'email', pattern: EMAIL_PATTERN },
    { category: 'url', pattern: URL_PATTERN },
    { category: 'hostname', pattern: HOSTNAME_PATTERN },
    ...buildOrgRules(config.knownNames),
    ...buildCustomRules(config.customRules),
    ...CODE_PATTERNS.map((pattern) => ({ category: 'code' as const, pattern })),
    ...LOG_PATTERNS.map((pattern) => ({ category: 'log' as const, pattern })),
  ];
}

function detectPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    const copy = new RegExp(pattern.source, pattern.flags);
    copy.lastIndex = 0;
    return copy.test(text);
  });
}

function aggregateSummary(
  redactions: RedactionRecord[],
): Array<{ category: RedactionCategory; count: number }> {
  const counts = new Map<RedactionCategory, number>();

  for (const redaction of redactions) {
    counts.set(redaction.category, (counts.get(redaction.category) ?? 0) + redaction.count);
  }

  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}

export function makePlaceholder(
  category: RedactionCategory,
  value: string,
  salt: string,
): string {
  const digest = createHmac('sha256', salt)
    .update(normalizeSensitiveValue(value))
    .digest('hex')
    .slice(0, 8);

  return `${category.toUpperCase()}_${digest}`;
}

export function redact(input: string, config: RedactionConfig): RedactionResult {
  if (typeof input !== 'string') {
    throw new TypeError('Expected input to be a string.');
  }

  if (typeof config?.salt !== 'string' || config.salt.trim().length === 0) {
    throw new TypeError('Expected redaction salt to be a non-empty string.');
  }

  const normalizedConfig = normalizeConfig(config);
  const placeholderByValue = new Map<string, string>();
  const redactionCounts = new Map<string, RedactionRecord>();
  let output = input;

  for (const rule of buildRules(normalizedConfig)) {
    if (!categoryEnabled(normalizedConfig, rule.category)) {
      continue;
    }

    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(pattern, (value) => {
      const normalizedValue = normalizeSensitiveValue(value);
      const placeholder =
        placeholderByValue.get(normalizedValue) ??
        makePlaceholder(rule.category, value, normalizedConfig.salt);

      placeholderByValue.set(normalizedValue, placeholder);

      const existing = redactionCounts.get(placeholder);
      if (existing) {
        existing.count += 1;
      } else {
        redactionCounts.set(placeholder, {
          category: rule.category,
          placeholder,
          count: 1,
        });
      }

      return placeholder;
    });
  }

  return {
    output,
    redactions: [...redactionCounts.values()],
    mode: normalizedConfig.mode,
  };
}

export function preview(input: string, config: RedactionConfig): PreviewResult {
  const result = redact(input, config);

  return {
    mode: result.mode,
    willSend: result.output,
    redactionSummary: aggregateSummary(result.redactions),
    hasRawCode: detectPattern(result.output, CODE_PATTERNS),
    hasRawLogs: detectPattern(result.output, LOG_PATTERNS),
  };
}

function sortKeys(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => sortKeys(entry));
  }

  if (payload && typeof payload === 'object') {
    const entries = Object.entries(payload as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return Object.fromEntries(
      entries.map(([key, value]) => [key, sortKeys(value)]),
    );
  }

  return payload;
}

export function hashPayload(payload: unknown, salt: string): string {
  if (typeof salt !== 'string' || salt.trim().length === 0) {
    throw new TypeError('Expected payload hash salt to be a non-empty string.');
  }

  const serialized =
    typeof payload === 'string' ? payload : JSON.stringify(sortKeys(payload));

  return createHmac('sha256', salt).update(serialized).digest('hex');
}

export function anonymizeText(
  input: string,
  options: AnonymizationOptions = {},
): AnonymizedText {
  const patterns = options.patterns ?? defaultPatterns;
  const redactions: RedactionMatch[] = [];
  let text = input;

  for (const { label, pattern } of patterns) {
    text = text.replace(pattern, (value) => {
      redactions.push({ label, value });
      return options.defaultReplacement ?? `<redacted:${label}>`;
    });
  }

  return { text, redactions };
}
