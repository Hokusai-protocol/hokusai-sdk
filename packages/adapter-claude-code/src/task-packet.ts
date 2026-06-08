import {
  buildTaskPacket,
  bucketRepositoryScale,
  classifyTaskFamily,
  inferReasoningDepth,
  preview,
  redact,
  summarizeFrameworkSignals,
  summarizeLanguageSignals,
  type PreviewResult,
  type ReasoningDepth,
  type RedactionConfig,
  type RedactionCategory,
  type RedactionRecord,
  type TaskFamily,
  type TaskPacket,
} from '@hokusai/core';

export interface ClaudeCodeRepositorySignals {
  dependencyCategories?: string[];
  extensionCounts?: Record<string, number>;
  fileCount?: number;
}

export interface ClaudeCodeTaskInput {
  taskText: string;
  taskTitle?: string;
  repositorySignals?: ClaudeCodeRepositorySignals;
  availableTools?: string[];
  constraints?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
  latencyPreference?: string;
  costPreference?: string;
  reasoningDepth?: ReasoningDepth;
  taskFamily?: TaskFamily;
  hints?: string[];
}

export interface ClaudeCodeBuilderOptions {
  redactionConfig: RedactionConfig;
  clock?: () => Date;
}

export interface ClaudeCodeTaskPacketBuildResult {
  packet: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
}

export interface ClaudeCodeTaskPacketPreview {
  willSend: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
  hasRawCode: boolean;
  hasRawLogs: boolean;
}

export function buildClaudeCodeTaskPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions,
): ClaudeCodeTaskPacketBuildResult {
  const prepared = prepareTaskPacket(input, options);

  return {
    packet: prepared.packet,
    redactionSummary: prepared.redactionSummary,
  };
}

export function previewClaudeCodeTaskPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions,
): ClaudeCodeTaskPacketPreview {
  const prepared = prepareTaskPacket(input, options);

  return {
    willSend: prepared.packet,
    redactionSummary: prepared.redactionSummary,
    hasRawCode: prepared.previewResult.hasRawCode,
    hasRawLogs: prepared.previewResult.hasRawLogs,
  };
}

function prepareTaskPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions,
): {
  packet: TaskPacket;
  previewResult: PreviewResult;
  redactionSummary: PreviewResult['redactionSummary'];
} {
  if (typeof input.taskText !== 'string' || input.taskText.trim().length === 0) {
    throw new Error('Expected "taskText" to be a non-empty string.');
  }

  const rawUserIntent = buildUserIntent(input);
  const rawArrayFields = collectRawArrayFields(input);
  const rawCombinedInput = [rawUserIntent, ...rawArrayFields].filter(Boolean).join('\n');
  const previewResult = preview(rawCombinedInput, options.redactionConfig);
  const intentRedaction = redact(rawUserIntent, options.redactionConfig);

  const redactedAvailableTools = redactStringArray(
    input.availableTools,
    options.redactionConfig,
  );
  const redactedConstraints = redactStringArray(
    buildConstraintList(input),
    options.redactionConfig,
  );
  const redactedModelConstraints = redactStringArray(
    input.modelConstraints,
    options.redactionConfig,
  );
  const redactedProviderConstraints = redactStringArray(
    input.providerConstraints,
    options.redactionConfig,
  );
  const repositoryScale = bucketRepositoryScale(input.repositorySignals?.fileCount);
  const languageSignals = toOptionalArray(
    summarizeLanguageSignals(input.repositorySignals?.extensionCounts ?? {}),
  );
  const frameworkSignals = toOptionalArray(
    summarizeFrameworkSignals(input.repositorySignals?.dependencyCategories ?? []),
  );

  const packet = buildTaskPacket({
    userIntent: intentRedaction.output,
    taskFamily:
      input.taskFamily ??
      classifyTaskFamily({
        text: rawUserIntent,
        ...(input.hints ? { hints: input.hints } : {}),
      }),
    reasoningDepth: inferReasoningDepth({
      text: rawUserIntent,
      ...(input.reasoningDepth ? { reasoningDepth: input.reasoningDepth } : {}),
    }),
    ...(repositoryScale ? { repositoryScale } : {}),
    ...(languageSignals ? { languageSignals } : {}),
    ...(frameworkSignals ? { frameworkSignals } : {}),
    ...(redactedAvailableTools.output
      ? { availableTools: redactedAvailableTools.output }
      : {}),
    ...(redactedConstraints.output ? { constraints: redactedConstraints.output } : {}),
    ...(redactedModelConstraints.output
      ? { modelConstraints: redactedModelConstraints.output }
      : {}),
    ...(redactedProviderConstraints.output
      ? { providerConstraints: redactedProviderConstraints.output }
      : {}),
  });

  return {
    packet,
    previewResult,
    redactionSummary: aggregateRedactionSummary([
      ...intentRedaction.redactions,
      ...redactedAvailableTools.redactions,
      ...redactedConstraints.redactions,
      ...redactedModelConstraints.redactions,
      ...redactedProviderConstraints.redactions,
    ]),
  };
}

function buildUserIntent(input: ClaudeCodeTaskInput): string {
  const sections = [input.taskTitle?.trim(), input.taskText.trim()];

  if (input.latencyPreference) {
    sections.push(`Latency preference: ${input.latencyPreference}`);
  }

  if (input.costPreference) {
    sections.push(`Cost preference: ${input.costPreference}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

function collectRawArrayFields(input: ClaudeCodeTaskInput): string[] {
  const sources = [
    input.availableTools,
    input.constraints,
    input.modelConstraints,
    input.providerConstraints,
    input.hints,
  ];

  const entries: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const entry of source) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

function buildConstraintList(input: ClaudeCodeTaskInput): string[] | undefined {
  const constraints = [
    ...(input.constraints ?? []),
    ...(input.latencyPreference ? [`latency:${input.latencyPreference}`] : []),
    ...(input.costPreference ? [`cost:${input.costPreference}`] : []),
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  return constraints.length > 0 ? constraints : undefined;
}

function redactStringArray(
  entries: string[] | undefined,
  config: RedactionConfig,
): {
  output: string[] | undefined;
  redactions: RedactionRecord[];
} {
  if (!entries || entries.length === 0) {
    return { output: undefined, redactions: [] };
  }

  const output: string[] = [];
  const redactions: RedactionRecord[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      continue;
    }

    const result = redact(entry, config);
    output.push(result.output);
    redactions.push(...result.redactions);
  }

  return {
    output: output.length > 0 ? output : undefined,
    redactions,
  };
}

function aggregateRedactionSummary(
  redactions: RedactionRecord[],
): Array<{ category: RedactionCategory; count: number }> {
  const counts = new Map<RedactionCategory, number>();

  for (const redaction of redactions) {
    counts.set(redaction.category, (counts.get(redaction.category) ?? 0) + redaction.count);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function toOptionalArray<T>(entries: T[]): T[] | undefined {
  return entries.length > 0 ? entries : undefined;
}
