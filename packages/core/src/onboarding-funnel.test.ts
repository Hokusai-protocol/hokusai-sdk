import { describe, expect, it } from 'vitest';
import {
  recordOnboardingFunnelSignal,
  type OnboardingFunnelSignal,
} from './onboarding-funnel.js';
import { InMemoryLocalStore } from './storage.js';

function createSignalClient() {
  const signals: OnboardingFunnelSignal[] = [];
  return {
    signals,
    client: {
      signal(signal: OnboardingFunnelSignal): Promise<{ status: 'recorded' }> {
        signals.push(signal);
        return Promise.resolve({ status: 'recorded' });
      },
    },
  };
}

describe('recordOnboardingFunnelSignal', () => {
  it('emits install and first route once with time-to-first-route', async () => {
    const store = new InMemoryLocalStore();
    const { client, signals } = createSignalClient();

    await recordOnboardingFunnelSignal({
      client,
      enabled: true,
      harness: 'codex',
      now: new Date('2026-01-01T00:00:00.000Z'),
      stage: 'doctor_pass',
      store,
    });
    await recordOnboardingFunnelSignal({
      client,
      enabled: true,
      harness: 'codex',
      now: new Date('2026-01-01T00:03:30.000Z'),
      stage: 'first_route',
      store,
    });
    await recordOnboardingFunnelSignal({
      client,
      enabled: true,
      harness: 'codex',
      now: new Date('2026-01-01T00:04:00.000Z'),
      stage: 'first_route',
      store,
    });

    expect(signals.map((signal) => signal.stage)).toEqual([
      'install',
      'doctor_pass',
      'first_route',
    ]);
    expect(signals[0]).toMatchObject({
      harness: 'codex',
      installedAt: '2026-01-01T00:00:00.000Z',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(signals[2]).toMatchObject({
      timeToFirstRouteMs: 210_000,
      occurredAt: '2026-01-01T00:03:30.000Z',
    });
  });

  it('does not create local state when disabled', async () => {
    const store = new InMemoryLocalStore();
    const { client, signals } = createSignalClient();

    await recordOnboardingFunnelSignal({
      client,
      enabled: false,
      now: new Date('2026-01-01T00:00:00.000Z'),
      stage: 'first_route',
      store,
    });

    await expect(store.getConfigRecord('onboarding-funnel')).resolves.toBeUndefined();
    expect(signals).toEqual([]);
  });
});
