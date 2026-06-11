import os from 'node:os';
import path from 'node:path';
import { createDefaultHandoff, type HarnessProfile } from '@hokusai/core';
import { buildCodexOutcomeReport } from './outcome.js';
import { buildCodexTaskPacket } from './task-context.js';
import { createOpenAiRegistry } from './registry.js';

export function resolveCodexConfigDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.HOKUSAI_CONFIG_DIR?.trim();
  if (configured) {
    return configured;
  }

  return path.join(os.homedir(), '.config', 'hokusai', 'codex');
}

export function hasRoutingConsent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.HOKUSAI_ROUTING_CONSENT?.trim().toLowerCase() === 'true';
}

export function hasOutcomeOptIn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.HOKUSAI_OUTCOME_OPT_IN?.trim().toLowerCase() === 'true';
}

export function getApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.HOKUSAI_API_KEY?.trim();
  return value ? value : undefined;
}

export function getApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.HOKUSAI_API_BASE_URL?.trim();
  return value ? value : undefined;
}

export function getRetentionDays(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number.parseInt(env.HOKUSAI_RETENTION_DAYS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 7;
}

export function createCodexHarnessProfile(): HarnessProfile {
  const registry = createOpenAiRegistry();

  return {
    harnessName: 'codex',
    subjectId: 'codex',
    registry,
    allowedProviders: ['openai'],
    defaultModelId: registry.getDefault()?.id,
    buildTask({ taskText, taskId, metadata, currentModelId }) {
      const packet = buildCodexTaskPacket(
        {
          taskId,
          taskSummary: taskText,
          ...(currentModelId ? { model: currentModelId } : {}),
        },
        {
          redactionConfig: {
            salt: 'hokusai-codex-route',
          },
        },
      ).packet;

      return {
        id: taskId,
        prompt: JSON.stringify(packet, null, 2),
        ...(metadata ? { metadata } : {}),
      };
    },
    buildPreview(payload) {
      return {
        summary: `Task ${payload.task.id} (model: ${payload.model.id})`,
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      };
    },
    buildOutcomeReport: buildCodexOutcomeReport,
    buildHandoff({ recommendation, currentModelId }) {
      return createDefaultHandoff(recommendation, currentModelId, 'codex');
    },
    async storeCorrelationMetadata({ payload, recommendation, payloadHash, now, store }) {
      const existing =
        (await store.getCorrelation(payload.correlation.correlationId.replace(/[:.]/g, '_'))) ??
        (await store.listCorrelations()).find(
          (entry) => entry.metadata?.originalCorrelationId === payload.correlation.correlationId,
        );
      if (!existing) {
        return;
      }

      await store.putCorrelation({
        ...existing,
        metadata: {
          ...existing.metadata,
          taskId: payload.task.id,
          originalCorrelationId: payload.correlation.correlationId,
          recommendedModelId: recommendation.model.id,
          recommendedAlternativeIds: JSON.stringify(
            recommendation.alternatives?.map((entry) => entry.model.id) ?? [],
          ),
          reasonPreview: recommendation.reason.slice(0, 120),
          payloadHash,
          status: 'pending',
          decisionAt: now,
        },
      });
    },
  };
}
