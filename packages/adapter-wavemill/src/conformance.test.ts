import { describe, it } from 'vitest';
import {
  InMemoryCorrelationStorage,
  conformanceChecks,
  conformanceFixtures,
  type ConformanceSubject,
} from '@hokusai/core';
import {
  DEFAULT_WAVEMILL_MODEL,
  buildWavemillOutcomeReport,
  buildWavemillTaskPacket,
  createWavemillHarnessAdapter,
  createWavemillModelProvider,
} from './index.js';

const modelProvider = createWavemillModelProvider([DEFAULT_WAVEMILL_MODEL]);

const subject: ConformanceSubject = {
  buildTaskPacket(text) {
    return buildWavemillTaskPacket(
      { taskText: text },
      { redactionConfig: { salt: conformanceFixtures.redactionSalt } },
    ).packet;
  },
  buildOutcomeReport(input) {
    return buildWavemillOutcomeReport({
      ...input,
      spendUsdBucket: '0.50-1.00',
      wallClockMinutes: 10,
    }).report;
  },
  async previewPayload(payload) {
    const adapter = createWavemillHarnessAdapter({ integrationId: 'conformance' });
    const result = await adapter.payloads.previewPayload({ payload });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.value;
  },
  store: new InMemoryCorrelationStorage(),
  mapModel(modelId) {
    return modelProvider.mapModel({
      harnessModelId: modelId,
      discoveredModels: [],
      availableModels: [],
    });
  },
  supportedModelId: DEFAULT_WAVEMILL_MODEL.id,
};

describe('Wavemill adapter conformance', () => {
  for (const check of conformanceChecks) {
    it(check.name, async () => {
      await check.run(subject);
    });
  }
});
