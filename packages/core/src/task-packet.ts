import { redact, type RedactionConfig, type RedactionRecord } from './anonymization.js';

const TASK_FAMILIES = [
  'bugfix',
  'feature',
  'refactor',
  'test',
  'docs',
  'chore',
  'investigation',
  'bug',
  'migration',
  'infra',
  'mixed',
] as const;

const REASONING_DEPTHS = ['shallow', 'standard', 'deep'] as const;
const REPOSITORY_SCALES = ['small', 'medium', 'large', 'xlarge'] as const;

export const TASK_PACKET_SCHEMA_VERSION = '1.0.0';

export type TaskFamily = (typeof TASK_FAMILIES)[number];
export type ReasoningDepth = (typeof REASONING_DEPTHS)[number];
export type RepositoryScale = (typeof REPOSITORY_SCALES)[number];

export interface TaskPacket {
  schemaVersion: typeof TASK_PACKET_SCHEMA_VERSION;
  userIntent: string;
  taskFamily: TaskFamily;
  reasoningDepth: ReasoningDepth;
  repositoryScale?: RepositoryScale;
  languageSignals?: string[];
  frameworkSignals?: string[];
  availableTools?: string[];
  constraints?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
}

export interface HarnessContext {
  userIntent: string;
  taskFamily: TaskFamily;
  reasoningDepth?: ReasoningDepth;
  repositoryScale?: RepositoryScale;
  languageSignals?: string[];
  frameworkSignals?: string[];
  availableTools?: string[];
  constraints?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; packet: TaskPacket }
  | { ok: false; errors: ValidationError[] };

type PacketKey = keyof TaskPacket;
type PacketRecord = Partial<Record<PacketKey, unknown>>;

const TASK_PACKET_KEYS = [
  'schemaVersion',
  'userIntent',
  'taskFamily',
  'reasoningDepth',
  'repositoryScale',
  'languageSignals',
  'frameworkSignals',
  'availableTools',
  'constraints',
  'modelConstraints',
  'providerConstraints',
] as const satisfies readonly PacketKey[];

const ARRAY_FIELDS = [
  'languageSignals',
  'frameworkSignals',
  'availableTools',
  'constraints',
  'modelConstraints',
  'providerConstraints',
] as const satisfies readonly PacketKey[];

const TASK_PACKET_KEY_SET = new Set<string>(TASK_PACKET_KEYS);

export class TaskPacketBuildError extends Error {
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'TaskPacketBuildError';
    this.errors = errors;
  }
}

export function validateTaskPacket(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'Task packet must be a non-null object.' }],
    };
  }

  const packet = input;

  for (const key of Object.keys(packet)) {
    if (!TASK_PACKET_KEY_SET.has(key)) {
      errors.push({
        path: key,
        message: `Unknown field "${key}" is not allowed in task packets.`,
      });
    }
  }

  validateLiteralString(
    packet.schemaVersion,
    'schemaVersion',
    TASK_PACKET_SCHEMA_VERSION,
    errors,
  );
  validateNonEmptyString(packet.userIntent, 'userIntent', errors);
  validateEnum(packet.taskFamily, 'taskFamily', TASK_FAMILIES, errors);
  validateEnum(packet.reasoningDepth, 'reasoningDepth', REASONING_DEPTHS, errors);

  if (packet.repositoryScale !== undefined) {
    validateEnum(
      packet.repositoryScale,
      'repositoryScale',
      REPOSITORY_SCALES,
      errors,
    );
  }

  for (const field of ARRAY_FIELDS) {
    const value = packet[field];
    if (value !== undefined) {
      validateStringArray(value, field, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const validatedPacket: TaskPacket = {
    schemaVersion: TASK_PACKET_SCHEMA_VERSION,
    userIntent: packet.userIntent as string,
    taskFamily: packet.taskFamily as TaskFamily,
    reasoningDepth: packet.reasoningDepth as ReasoningDepth,
  };

  if (packet.repositoryScale !== undefined) {
    validatedPacket.repositoryScale = packet.repositoryScale as RepositoryScale;
  }

  for (const field of ARRAY_FIELDS) {
    const value = packet[field];
    if (value !== undefined) {
      validatedPacket[field] = [...(value as string[])];
    }
  }

  return { ok: true, packet: validatedPacket };
}

export function buildTaskPacket(context: HarnessContext): TaskPacket {
  const candidate: PacketRecord = {
    schemaVersion: TASK_PACKET_SCHEMA_VERSION,
    userIntent: context?.userIntent,
    taskFamily: context?.taskFamily,
    reasoningDepth: context?.reasoningDepth ?? 'standard',
    repositoryScale: context?.repositoryScale,
  };

  for (const field of ARRAY_FIELDS) {
    const value = context?.[field];
    if (value !== undefined) {
      candidate[field] = value;
    }
  }

  const result = validateTaskPacket(candidate);
  if (!result.ok) {
    throw new TaskPacketBuildError(
      formatBuildErrorMessage(result.errors),
      result.errors,
    );
  }

  return result.packet;
}

function validateLiteralString(
  value: unknown,
  path: string,
  expected: string,
  errors: ValidationError[],
): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({
      path,
      message: `Expected "${path}" to be "${expected}".`,
    });
    return;
  }

  if (value !== expected) {
    errors.push({
      path,
      message: `Unsupported schema version "${value}". Expected "${expected}".`,
    });
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({
      path,
      message: `"${path}" must be a non-empty string.`,
    });
  }
}

function validateEnum<T extends readonly string[]>(
  value: unknown,
  path: string,
  allowedValues: T,
  errors: ValidationError[],
): void {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    errors.push({
      path,
      message: `"${path}" must be one of: ${allowedValues.join(', ')}.`,
    });
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (!Array.isArray(value)) {
    errors.push({
      path,
      message: `"${path}" must be an array of strings.`,
    });
    return;
  }

  const entries: unknown[] = value;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      errors.push({
        path: `${path}[${index}]`,
        message: `"${path}" entries must be non-empty strings.`,
      });
    }
  }
}

function formatBuildErrorMessage(errors: ValidationError[]): string {
  const formatted = errors.map((error) => `${error.path}: ${error.message}`).join('; ');
  return `Failed to build task packet: ${formatted}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AnonymizeTaskPacketResult {
  packet: TaskPacket;
  redactions: RedactionRecord[];
}

// Free-text fields that may carry user-supplied sensitive data and must be redacted.
const FREE_TEXT_ARRAY_FIELDS = [
  'constraints',
  'modelConstraints',
  'providerConstraints',
] as const satisfies readonly PacketKey[];

export function anonymizeTaskPacket(
  packet: TaskPacket,
  config: RedactionConfig,
): AnonymizeTaskPacketResult {
  const allRedactions: RedactionRecord[] = [];

  function redactString(value: string): string {
    const result = redact(value, config);
    allRedactions.push(...result.redactions);
    return result.output;
  }

  function redactStringArray(values: string[]): string[] {
    return values.map((v) => redactString(v));
  }

  const redacted: Record<string, unknown> = {
    schemaVersion: packet.schemaVersion,
    userIntent: redactString(packet.userIntent),
    taskFamily: packet.taskFamily,
    reasoningDepth: packet.reasoningDepth,
  };

  if (packet.repositoryScale !== undefined) {
    redacted.repositoryScale = packet.repositoryScale;
  }

  // Controlled-vocabulary arrays (languageSignals, frameworkSignals, availableTools) are
  // passed through unchanged — they are derived from a fixed map, never raw user text.
  for (const field of ['languageSignals', 'frameworkSignals', 'availableTools'] as const) {
    const value = packet[field];
    if (value !== undefined) {
      redacted[field] = [...value];
    }
  }

  // Free-text arrays flow through the redactor.
  for (const field of FREE_TEXT_ARRAY_FIELDS) {
    const value = packet[field];
    if (value !== undefined) {
      redacted[field] = redactStringArray(value);
    }
  }

  const validationResult = validateTaskPacket(redacted);
  if (!validationResult.ok) {
    throw new TaskPacketBuildError(
      formatBuildErrorMessage(validationResult.errors),
      validationResult.errors,
    );
  }

  return { packet: validationResult.packet, redactions: allRedactions };
}
