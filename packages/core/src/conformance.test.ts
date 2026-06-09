import { describe, expect, it } from 'vitest';
import { buildTaskPacket } from './task-packet.js';
import {
  conformanceChecks,
  conformanceFixtures,
  runAdapterConformance,
  type ConformanceSubject,
} from './conformance.js';
import { buildOutcomeReport } from './outcome.js';
import { DEFAULT_REDACTION_CONFIG, redact } from './anonymization.js';
import { InMemoryCorrelationStorage } from './storage.js';

function createConformantSubject(): ConformanceSubject {
  return {
    buildTaskPacket(text) {
      return buildTaskPacket({
        userIntent: redact(text, {
          ...DEFAULT_REDACTION_CONFIG,
          salt: conformanceFixtures.redactionSalt,
        }).output,
        taskFamily: 'bugfix',
        reasoningDepth: 'standard',
      });
    },
    buildOutcomeReport(input) {
      return buildOutcomeReport(input);
    },
    previewPayload(payload) {
      return {
        summary: `Preview ${payload.task.id}`,
        promptPreview: payload.prompt,
        redactionCount: payload.redactions.length,
      };
    },
    store: new InMemoryCorrelationStorage(),
    mapModel(modelId) {
      if (modelId === 'conformance-model') {
        return Promise.resolve({
          ok: true,
          value: {
            id: 'conformance-model',
            provider: 'conformance',
            capabilities: ['reasoning'],
          },
        });
      }

      return Promise.resolve({
        ok: false,
        error: {
          code: 'UNKNOWN_MODEL',
          message: `Unsupported model: ${modelId}`,
        },
      });
    },
    supportedModelId: 'conformance-model',
  };
}

describe('core conformance suite', () => {
  it('passes for a conformant subject', async () => {
    await expect(runAdapterConformance(createConformantSubject())).resolves.toBeUndefined();
  });

  it('fails the redaction check when private text leaks', async () => {
    const brokenSubject: ConformanceSubject = {
      ...createConformantSubject(),
      buildTaskPacket(text) {
        return buildTaskPacket({
          userIntent: text,
          taskFamily: 'bugfix',
          reasoningDepth: 'standard',
        });
      },
    };

    const check = conformanceChecks.find((candidate) => candidate.name === 'redaction');
    expect(check).toBeDefined();
    await expect(
      Promise.resolve().then(() => check?.run(brokenSubject)),
    ).rejects.toThrow();
  });

  it('fails the unsupported-model check when unknown models are accepted', async () => {
    const brokenSubject: ConformanceSubject = {
      ...createConformantSubject(),
      mapModel(modelId) {
        return Promise.resolve({
          ok: true,
          value: {
            id: modelId,
            provider: 'conformance',
            capabilities: ['reasoning'],
          },
        });
      },
    };

    const check = conformanceChecks.find(
      (candidate) => candidate.name === 'unsupported-model',
    );
    expect(check).toBeDefined();
    await expect(
      Promise.resolve().then(() => check?.run(brokenSubject)),
    ).rejects.toThrow();
  });

  it('enforces the consent gate expectations', async () => {
    const check = conformanceChecks.find((candidate) => candidate.name === 'consent-gate');
    expect(check).toBeDefined();
    await expect(check?.run(createConformantSubject())).resolves.toBeUndefined();
  });
});
