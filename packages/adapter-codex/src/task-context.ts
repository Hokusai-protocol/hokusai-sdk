import {
  DEFAULT_REDACTION_CONFIG,
  buildTaskPacket,
  bucketRepositoryScale,
  classifyTaskFamily,
  inferReasoningDepth,
  preview,
  redact,
  summarizeFrameworkSignals,
  summarizeLanguageSignals,
  type HarnessTaskContext,
  type PreviewResult,
  type ReasoningDepth,
  type RedactionConfig,
  type RedactionCategory,
  type RedactionRecord,
  type TaskFamily,
  type TaskPacket,
} from '@hokusai/core';

export interface CodexRepositorySignals {
  dependencyCategories?: string[];
  extensionCounts?: Record<string, number>;
  fileCount?: number;
}

export interface CodexSessionTelemetry {
  taskSummary: string;
  taskTitle?: string;
  taskId?: string;
  model?: string;
  repositorySignals?: CodexRepositorySignals;
  availableTools?: string[];
  constraints?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
  latencyPreference?: string;
  costPreference?: string;
  reasoningDepth?: ReasoningDepth;
  taskFamily?: TaskFamily;
  hints?: string[];
  cwd?: string;
  command?: string;
  configPath?: string;
  metadata?: Record<string, string>;
  harnessVersion?: string;
}

export interface CodexTaskContextBuilderOptions {
  redactionConfig: RedactionConfig;
  clock?: () => Date;
}

export interface CodexTaskTextBuilderOptions {
  redactionConfig?: RedactionConfig;
}

export interface CodexTaskPacketBuildResult {
  packet: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
}

export interface CodexTaskPacketPreview {
  willSend: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
  hasRawCode: boolean;
  hasRawLogs: boolean;
}

export function buildCodexTaskPacket(
  input: CodexSessionTelemetry,
  options: CodexTaskContextBuilderOptions,
): CodexTaskPacketBuildResult {
  const prepared = prepareTaskPacket(input, options);

  return {
    packet: prepared.packet,
    redactionSummary: prepared.redactionSummary,
  };
}

export function previewCodexTaskPacket(
  input: CodexSessionTelemetry,
  options: CodexTaskContextBuilderOptions,
): CodexTaskPacketPreview {
  const prepared = prepareTaskPacket(input, options);

  return {
    willSend: prepared.packet,
    redactionSummary: prepared.redactionSummary,
    hasRawCode: prepared.previewResult.hasRawCode,
    hasRawLogs: prepared.previewResult.hasRawLogs,
  };
}

export function buildCodexTaskPacketFromText(
  taskText: string,
  options?: CodexTaskTextBuilderOptions,
): CodexTaskPacketBuildResult {
  return buildCodexTaskPacket(
    textToMinimalTelemetry(taskText),
    toTextBuilderOptions(options),
  );
}

export function previewCodexTaskPacketFromText(
  taskText: string,
  options?: CodexTaskTextBuilderOptions,
): CodexTaskPacketPreview {
  return previewCodexTaskPacket(
    textToMinimalTelemetry(taskText),
    toTextBuilderOptions(options),
  );
}

export function buildCodexHarnessTaskContext(
  input: CodexSessionTelemetry,
  options: CodexTaskContextBuilderOptions,
): HarnessTaskContext {
  const built = buildCodexTaskPacket(input, options);
  const taskId =
    input.taskId?.trim() || `codex-${(options.clock ?? (() => new Date()))().toISOString()}`;
  const metadata: Record<string, string> = {
    ...(input.metadata ?? {}),
    taskFamily: built.packet.taskFamily,
    reasoningDepth: built.packet.reasoningDepth,
  };

  if (input.model?.trim()) {
    metadata.model = input.model.trim();
  }

  if (built.packet.repositoryScale) {
    metadata.repositoryScale = built.packet.repositoryScale;
  }

  return {
    task: {
      id: taskId,
      prompt: built.packet.userIntent,
      metadata,
    },
    harness: {
      name: 'codex',
      ...(input.harnessVersion ? { version: input.harnessVersion } : {}),
    },
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.configPath ? { configPath: input.configPath } : {}),
    metadata,
  };
}

function toTextBuilderOptions(
  options?: CodexTaskTextBuilderOptions,
): CodexTaskContextBuilderOptions {
  return {
    redactionConfig: options?.redactionConfig ?? DEFAULT_REDACTION_CONFIG,
  };
}

function textToMinimalTelemetry(taskText: string): CodexSessionTelemetry {
  if (typeof taskText !== 'string' || taskText.trim().length === 0) {
    throw new Error('Expected "taskText" to be a non-empty string.');
  }

  return {
    taskSummary: taskText.trim(),
  };
}

function prepareTaskPacket(
  input: CodexSessionTelemetry,
  options: CodexTaskContextBuilderOptions,
): {
  packet: TaskPacket;
  previewResult: PreviewResult;
  redactionSummary: PreviewResult['redactionSummary'];
} {
  if (
    typeof input.taskSummary !== 'string' ||
    input.taskSummary.trim().length === 0
  ) {
    throw new Error('Expected "taskSummary" to be a non-empty string.');
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

function buildUserIntent(input: CodexSessionTelemetry): string {
  const sections = [input.taskTitle?.trim(), input.taskSummary.trim()];

  if (input.latencyPreference) {
    sections.push(`Latency preference: ${input.latencyPreference}`);
  }

  if (input.costPreference) {
    sections.push(`Cost preference: ${input.costPreference}`);
  }

  if (input.model?.trim()) {
    sections.push(`Requested model: ${input.model.trim()}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

function collectRawArrayFields(input: CodexSessionTelemetry): string[] {
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

function buildConstraintList(
  input: CodexSessionTelemetry,
): string[] | undefined {
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
