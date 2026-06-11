import type {
  HandoffInstructions,
  HarnessPayloadPreview,
  HarnessRecommendation,
  HokusaiDispatchPayload,
  HokusaiPluginConfig,
  ModelDefinition,
  ModelSelection,
  PluginDoctorReport,
  PreviewResult,
  TaskPacket,
} from '../index.js';
import type {
  ModelCatalog,
  RecommendationDisplay,
  ResolvedConfigPath,
  RouteInputBase,
  SharedCommandOptions,
} from './types.js';

export interface BuildTaskPacketResult {
  packet: TaskPacket;
  redactionSummary: PreviewResult['redactionSummary'];
}

export interface HarnessProfile<
  TRouteInput extends RouteInputBase,
  TBuilderOptions,
  TPreview,
  TOptions extends SharedCommandOptions = SharedCommandOptions,
> {
  harness: string;
  harnessLabel: string;
  defaultSubjectId: string;
  resolveConfigPath(options?: { override?: string }): ResolvedConfigPath;
  getStateFilePath?(configDir: string): string;
  createBuilderOptions(options?: TOptions): TBuilderOptions;
  buildTaskPacket(
    input: TRouteInput,
    options: TBuilderOptions,
  ): BuildTaskPacketResult;
  previewTaskPacket(input: TRouteInput, options: TBuilderOptions): TPreview;
  toTaskId(input: TRouteInput, clock?: () => Date): string;
  toPrompt(packet: TaskPacket): string;
  modelCatalog: ModelCatalog;
  buildHandoff(input: {
    recommendation: HarnessRecommendation;
    currentModelId?: string;
  }): HandoffInstructions;
  renderHandoff(handoff: HandoffInstructions): string[];
  defaultRecommendationReason: string;
  routeRecommendationReason: string;
  createFallbackConfig?(input: {
    baseUrl: string;
    modelAllowlist: string[];
  }): HokusaiPluginConfig;
  renderDoctorReport?(report: PluginDoctorReport): string;
}

export function toModelSelection(model: ModelDefinition): ModelSelection {
  return {
    id: model.id,
    provider: model.provider,
    capabilities: model.capabilities,
  };
}

export function buildDefaultRecommendation(
  profile: Pick<
    HarnessProfile<RouteInputBase, unknown, unknown, SharedCommandOptions>,
    'defaultRecommendationReason' | 'modelCatalog'
  >,
  model: ModelDefinition,
): HarnessRecommendation {
  const allowedProviders = profile.modelCatalog.allowedProviders;

  return {
    model: toModelSelection(model),
    reason: profile.defaultRecommendationReason,
    alternatives: profile.modelCatalog.registry
      .listAvailable()
      .filter((candidate) =>
        allowedProviders?.includes(candidate.provider) ?? true,
      )
      .filter((candidate) => candidate.id !== model.id)
      .map((candidate) => ({
        model: toModelSelection(candidate),
      })),
  };
}

export function buildPayloadPreview(
  payload: HokusaiDispatchPayload,
): HarnessPayloadPreview {
  return {
    summary: `Task ${payload.task.id} (model: ${payload.model.id})`,
    promptPreview: payload.prompt,
    redactionCount: payload.redactions.length,
  };
}

export function displayTaskRecommendation(
  recommendation: HarnessRecommendation,
): RecommendationDisplay {
  const lines = [
    `Recommended model: ${recommendation.model.id}`,
    `Provider: ${recommendation.model.provider}`,
    `Reason: ${recommendation.reason}`,
  ];

  if (recommendation.confidence !== undefined) {
    lines.push(`Confidence: ${Math.round(recommendation.confidence * 100)}%`);
  }

  if (recommendation.alternatives && recommendation.alternatives.length > 0) {
    lines.push(
      `Alternatives: ${recommendation.alternatives.map((entry) => entry.model.id).join(', ')}`,
    );
    for (const alternative of recommendation.alternatives) {
      const parts = [alternative.model.id];
      if (alternative.reason) {
        parts.push(alternative.reason);
      }
      if (alternative.confidence !== undefined) {
        parts.push(`${Math.round(alternative.confidence * 100)}%`);
      }
      lines.push(`- ${parts.join(' - ')}`);
    }
  }

  return {
    lines,
    model: recommendation.model.id,
    provider: recommendation.model.provider,
  };
}
