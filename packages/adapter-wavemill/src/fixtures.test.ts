import { describe, expect, it } from 'vitest';
import {
  buildOutcomeReport,
  validateOutcomeReport,
  validateTaskPacket,
} from '@hokusai/core';
import {
  wavemillAnonymizationFixture,
  wavemillConformanceFixtures,
} from './fixtures.js';

describe('wavemillConformanceFixtures', () => {
  it('ships a valid task packet fixture', () => {
    expect(validateTaskPacket(wavemillConformanceFixtures.taskPacket)).toEqual({
      ok: true,
      packet: wavemillConformanceFixtures.taskPacket,
    });
  });

  it('ships a valid success outcome fixture', () => {
    const report = buildOutcomeReport(wavemillConformanceFixtures.successOutcome);

    expect(validateOutcomeReport(report)).toEqual([]);
  });

  it('ships a valid overridden outcome fixture', () => {
    const report = buildOutcomeReport(wavemillConformanceFixtures.overriddenOutcome);

    expect(validateOutcomeReport(report)).toEqual([]);
  });

  it('ships the Wavemill anonymization fixture', () => {
    expect(wavemillAnonymizationFixture.knownNames).toEqual(['Wavemill Labs']);
    expect(wavemillConformanceFixtures.anonymization).toEqual(
      wavemillAnonymizationFixture,
    );
  });
});
