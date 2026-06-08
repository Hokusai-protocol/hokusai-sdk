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

export interface WavemillRepositorySignals {
  dependencyCategories?: string[];
  extensionCounts?: Record<string, number>;
  fileCount?: number;
}

export interface WavemillTaskInput {
  taskText: string;
  taskTitle?: string;
  repositorySignals?: WavemillRepositorySignals;
  availableTools?: string[];
  constraints?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
  latencyPreference?: string;
  costPreference?: string;
  reasoningDepth?: ReasoningDepth;
  taskFamily?: TaskFamily;
  hints?: string[];
  customerNames?: string[];
  priorCorrelationId?: string;
}

export interface WavemillBuilderOptions {
  redactionConfig: RedactionConfig;
  clock?: () => Date;
}

export interface WavemillTaskPacketBuildResult {
  packet: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
}

export interface WavemillTaskPacketPreview {
  willSend: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
  hasRawCode: boolean;
  hasRawLogs: boolean;
  replayCorrelationId?: string;
}

const DEFAULT_AVAILABLE_TOOLS = ['shell', 'git', 'test runner'];
const DEFAULT_FRAMEWORK_SIGNALS = ['pnpm workspace'];

export function buildWavemillTaskPacket(
  input: WavemillTaskInput,
  options: WavemillBuilderOptions,
): WavemillTaskPacketBuildResult {
  const prepared = prepareTaskPacket(input, options);

  return {
    packet: prepared.packet,
    redactionSummary: prepared.redactionSummary,
  };
}

export function previewWavemillTaskPacket(
  input: WavemillTaskInput,
  options: WavemillBuilderOptions,
): WavemillTaskPacketPreview {
  const prepared = prepareTaskPacket(input, options);

  return {
    willSend: prepared.packet,
    redactionSummary: prepared.redactionSummary,
    hasRawCode: prepared.previewResult.hasRawCode,
    hasRawLogs: prepared.previewResult.hasRawLogs,
    ...(input.priorCorrelationId
      ? { replayCorrelationId: input.priorCorrelationId }
      : {}),
  };
}

function prepareTaskPacket(
  input: WavemillTaskInput,
  options: WavemillBuilderOptions,
): {
  packet: TaskPacket;
  previewResult: PreviewResult;
  redactionSummary: PreviewResult['redactionSummary'];
} {
  if (typeof input.taskText !== 'string' || input.taskText.trim().length === 0) {
    throw new Error('Expected "taskText" to be a non-empty string.');
  }

  const redactionConfig = mergeKnownNames(
    options.redactionConfig,
    input.customerNames,
  );
  const rawUserIntent = buildUserIntent(input);
  const rawArrayFields = collectRawArrayFields(input);
  const rawCombinedInput = [rawUserIntent, ...rawArrayFields].filter(Boolean).join('\n');
  const previewResult = preview(rawCombinedInput, redactionConfig);
  const intentRedaction = redact(rawUserIntent, redactionConfig);
  const redactedAvailableTools = redactStringArray(
    input.availableTools ?? DEFAULT_AVAILABLE_TOOLS,
    redactionConfig,
  );
  const redactedConstraints = redactStringArray(
    buildConstraintList(input),
    redactionConfig,
  );
  const redactedModelConstraints = redactStringArray(
    input.modelConstraints,
    redactionConfig,
  );
  const redactedProviderConstraints = redactStringArray(
    input.providerConstraints,
    redactionConfig,
  );
  const taskFamily =
    input.taskFamily ??
    classifyTaskFamily({
      text: rawUserIntent,
      ...(input.hints ? { hints: input.hints } : {}),
    });
  const inferredReasoningDepth = inferReasoningDepth({
    text: rawUserIntent,
    ...(input.reasoningDepth ? { reasoningDepth: input.reasoningDepth } : {}),
  });
  const reasoningDepth =
    input.reasoningDepth ??
    (inferredReasoningDepth === 'standard' &&
    (taskFamily === 'feature' || taskFamily === 'refactor')
      ? 'deep'
      : inferredReasoningDepth);
  const repositoryScale = bucketRepositoryScale(input.repositorySignals?.fileCount);
  const languageSignals = toOptionalArray(
    summarizeLanguageSignals(input.repositorySignals?.extensionCounts ?? {}),
  );
  const frameworkSignals = resolveFrameworkSignals(
    input.repositorySignals?.dependencyCategories,
  );

  const packet = buildTaskPacket({
    userIntent: intentRedaction.output,
    taskFamily,
    reasoningDepth,
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

function buildUserIntent(input: WavemillTaskInput): string {
  const sections = [input.taskTitle?.trim(), input.taskText.trim()];

  if (input.latencyPreference) {
    sections.push(`Latency preference: ${input.latencyPreference}`);
  }

  if (input.costPreference) {
    sections.push(`Cost preference: ${input.costPreference}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

function collectRawArrayFields(input: WavemillTaskInput): string[] {
  const sources = [
    input.availableTools ?? DEFAULT_AVAILABLE_TOOLS,
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

function buildConstraintList(input: WavemillTaskInput): string[] | undefined {
  const constraints = [
    ...(input.constraints ?? []),
    ...(input.latencyPreference ? [`latency:${input.latencyPreference}`] : []),
    ...(input.costPreference ? [`cost:${input.costPreference}`] : []),
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);

  return constraints.length > 0 ? constraints : undefined;
}

function resolveFrameworkSignals(
  dependencyCategories: string[] | undefined,
): string[] | undefined {
  if (!dependencyCategories || dependencyCategories.length === 0) {
    return DEFAULT_FRAMEWORK_SIGNALS;
  }

  return toOptionalArray(summarizeFrameworkSignals(dependencyCategories));
}

function mergeKnownNames(
  config: RedactionConfig,
  customerNames: string[] | undefined,
): RedactionConfig {
  const mergedKnownNames = [
    ...(config.knownNames ?? []),
    ...(customerNames ?? []),
  ]
    .map((name) => name.trim())
    .filter(Boolean);

  if (mergedKnownNames.length === 0) {
    return config;
  }

  return {
    ...config,
    knownNames: [...new Set(mergedKnownNames)],
  };
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
