import {
  wavemillOverriddenOutcomeFixture,
  wavemillSuccessOutcomeFixture,
  wavemillTaskPacketFixture,
  type OutcomeReportInput,
  type TaskPacket,
} from '@hokusai/core';

export const wavemillAnonymizationFixture = {
  raw: `Wavemill Labs reported correlation id ticket-alice@wavemill.internal-42.
Attach tok-WM12345678 when posting to wavemill.internal and https://wavemill.internal/api/jobs.

DEBUG starting sync for Wavemill Labs
2026-06-08T12:00:00.000Z WARN retrying sync for alice@wavemill.internal
TRACE sync complete`,
  knownNames: ['Wavemill Labs'],
  expectedRedactedValues: [
    'Wavemill Labs',
    'ticket-alice@wavemill.internal-42',
    'tok-WM12345678',
    'wavemill.internal',
    'https://wavemill.internal/api/jobs',
    'DEBUG starting sync for Wavemill Labs',
    '2026-06-08T12:00:00.000Z WARN retrying sync for alice@wavemill.internal',
    'TRACE sync complete',
  ],
} as const;

export const taskPacketFixture: TaskPacket = wavemillTaskPacketFixture;
export const successOutcomeFixture: OutcomeReportInput =
  wavemillSuccessOutcomeFixture;
export const overriddenOutcomeFixture: OutcomeReportInput =
  wavemillOverriddenOutcomeFixture;

export {
  wavemillOverriddenOutcomeFixture,
  wavemillSuccessOutcomeFixture,
  wavemillTaskPacketFixture,
};

export const wavemillConformanceFixtures = {
  taskPacket: wavemillTaskPacketFixture,
  successOutcome: wavemillSuccessOutcomeFixture,
  overriddenOutcome: wavemillOverriddenOutcomeFixture,
  anonymization: wavemillAnonymizationFixture,
} as const;
