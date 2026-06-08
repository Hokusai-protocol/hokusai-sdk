import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('core public surface', () => {
  it('exposes the expected entry points', () => {
    expect(core.HokusaiClient).toBeDefined();
    expect(core.HokusaiDispatchBuilder).toBeDefined();
    expect(core.DEFAULT_HOKUSAI_BASE_URL).toBeDefined();
    expect(core.HokusaiApiError).toBeDefined();
    expect(core.HokusaiAuthError).toBeDefined();
    expect(core.HokusaiValidationError).toBeDefined();
    expect(core.HokusaiNetworkError).toBeDefined();
    expect(core.canRoute).toBeDefined();
    expect(core.canReportOutcome).toBeDefined();
    expect(core.resolveConsent).toBeDefined();
    expect(core.FsLocalStore).toBeDefined();
    expect(core.InMemoryCorrelationStorage).toBeDefined();
    expect(core.InMemoryLocalStore).toBeDefined();
    expect(core.RawPayloadRejectedError).toBeDefined();
    expect(core.StoreCorruptError).toBeDefined();
    expect(core.InvalidStoreIdError).toBeDefined();
    expect(core.InMemoryModelRegistry).toBeDefined();
    expect(core.ModelMappingError).toBeDefined();
    expect(new core.ModelMappingError('UNKNOWN_MODEL', 'message', [])).toBeInstanceOf(
      Error,
    );
    expect(core.mapRecommendation).toBeDefined();
    expect(Array.isArray(core.ANTHROPIC_MODELS)).toBe(true);
    expect(core.anonymizeText).toBeDefined();
    expect(core.redact).toBeDefined();
    expect(core.preview).toBeDefined();
    expect(core.hashPayload).toBeDefined();
    expect(core.DEFAULT_REDACTION_CONFIG).toBeDefined();
    expect(core.TASK_PACKET_SCHEMA_VERSION).toBe('1.0.0');
    expect(core.OUTCOME_REPORT_SCHEMA_VERSION).toBe('1');
    expect(core.buildTaskPacket).toBeDefined();
    expect(core.buildOutcomeReport).toBeDefined();
    expect(core.previewOutcomePayload).toBeDefined();
    expect(core.validateTaskPacket).toBeDefined();
    expect(core.genericTaskPacketFixture).toBeDefined();
  });
});
