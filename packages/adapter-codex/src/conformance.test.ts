import { describe, it } from 'vitest';
import type { ModelDefinition } from '@hokusai/core';
import {
  InMemoryCorrelationStorage,
  conformanceChecks,
  conformanceFixtures,
  type ConformanceSubject,
} from '@hokusai/core';
import {
  buildCodexOutcomeReport,
  buildCodexTaskPacket,
  createCodexHarnessAdapter,
  createCodexModelProvider,
} from './index.js';

const CODEX_MODEL: ModelDefinition = {
  id: 'gpt-5-codex',
  provider: 'openai',
  family: 'gpt',
  capabilities: ['reasoning', 'tool-use'],
  default: true,
};

const modelProvider = createCodexModelProvider([CODEX_MODEL]);

const subject: ConformanceSubject = {
  buildTaskPacket(text) {
    return buildCodexTaskPacket(
      { taskSummary: text },
      { redactionConfig: { salt: conformanceFixtures.redactionSalt } },
    ).packet;
  },
  buildOutcomeReport(input) {
    return buildCodexOutcomeReport(input);
  },
  async previewPayload(payload) {
    const adapter = createCodexHarnessAdapter({
      defaultModel: CODEX_MODEL.id,
      models: [CODEX_MODEL],
      redactionConfig: { salt: conformanceFixtures.redactionSalt },
    });
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
  supportedModelId: CODEX_MODEL.id,
};

describe('Codex adapter conformance', () => {
  for (const check of conformanceChecks) {
    it(check.name, async () => {
      await check.run(subject);
    });
  }
});
