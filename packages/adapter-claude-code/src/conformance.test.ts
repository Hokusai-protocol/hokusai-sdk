import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  InMemoryCorrelationStorage,
  buildOutcomeReport,
  conformanceChecks,
  conformanceFixtures,
  type ConformanceSubject,
} from '@hokusai/core';
import {
  buildClaudeCodeTaskPacket,
  createClaudeCodeHarnessAdapter,
  createClaudeCodeModelProvider,
} from './index.js';

const modelProvider = createClaudeCodeModelProvider();
const previewConfigPath = path.join(os.tmpdir(), 'hokusai-claude-conformance');

const subject: ConformanceSubject = {
  buildTaskPacket(text) {
    return buildClaudeCodeTaskPacket(
      { taskText: text },
      { redactionConfig: { salt: conformanceFixtures.redactionSalt } },
    ).packet;
  },
  buildOutcomeReport(input) {
    return buildOutcomeReport(input);
  },
  async previewPayload(payload) {
    const adapter = createClaudeCodeHarnessAdapter({ configPath: previewConfigPath });
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
  supportedModelId: 'claude-sonnet-4-6',
};

describe('Claude Code adapter conformance', () => {
  for (const check of conformanceChecks) {
    it(check.name, async () => {
      await check.run(subject);
    });
  }
});
