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
    expect(core.InMemoryCorrelationStorage).toBeDefined();
    expect(core.InMemoryModelRegistry).toBeDefined();
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
