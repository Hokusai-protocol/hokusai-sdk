export const wavemillFixture = {
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
};
