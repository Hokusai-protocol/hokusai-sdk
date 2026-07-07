import type { HokusaiClient } from './client.js';
import type { LocalStore } from './storage.js';

export type OnboardingFunnelStage =
  | 'install'
  | 'doctor_pass'
  | 'first_route'
  | 'first_contribution';

export interface OnboardingFunnelSignal {
  kind: 'onboarding_funnel';
  stage: OnboardingFunnelStage;
  installationId: string;
  installedAt: string;
  occurredAt: string;
  harness?: string;
  timeToFirstRouteMs?: number;
}

export interface RecordOnboardingFunnelSignalInput {
  client?: Pick<HokusaiClient, 'signal'> | undefined;
  enabled: boolean;
  harness?: string | undefined;
  now?: Date | undefined;
  stage: OnboardingFunnelStage;
  store: LocalStore;
}

interface OnboardingFunnelState {
  installationId: string;
  installedAt: string;
  emittedStages: OnboardingFunnelStage[];
}

const STORE_ID = 'onboarding-funnel';

export async function recordOnboardingFunnelSignal(
  input: RecordOnboardingFunnelSignalInput,
): Promise<void> {
  if (!input.enabled || !input.client) {
    return;
  }

  const now = input.now ?? new Date();
  const state = await getOrCreateState(input.store, now);
  const stages = new Set(state.emittedStages);
  const pendingSignals: OnboardingFunnelSignal[] = [];

  if (!stages.has('install')) {
    pendingSignals.push(buildSignal('install', state, now, input.harness));
    stages.add('install');
  }

  if (!stages.has(input.stage)) {
    pendingSignals.push(
      buildSignal(input.stage, state, now, input.harness),
    );
    stages.add(input.stage);
  }

  if (pendingSignals.length === 0) {
    return;
  }

  for (const signal of pendingSignals) {
    await input.client.signal(signal);
  }

  await putState(input.store, {
    ...state,
    emittedStages: [...stages],
  });
}

function buildSignal(
  stage: OnboardingFunnelStage,
  state: OnboardingFunnelState,
  now: Date,
  harness: string | undefined,
): OnboardingFunnelSignal {
  const signal: OnboardingFunnelSignal = {
    kind: 'onboarding_funnel',
    stage,
    installationId: state.installationId,
    installedAt: state.installedAt,
    occurredAt: now.toISOString(),
  };

  if (harness) {
    signal.harness = harness;
  }
  if (stage === 'first_route') {
    signal.timeToFirstRouteMs = Math.max(
      0,
      now.getTime() - Date.parse(state.installedAt),
    );
  }

  return signal;
}

async function getOrCreateState(
  store: LocalStore,
  now: Date,
): Promise<OnboardingFunnelState> {
  const stored = await store.getConfigRecord(STORE_ID);
  if (stored) {
    return normalizeState(stored, now);
  }

  const state = {
    installationId: createInstallationId(now),
    installedAt: now.toISOString(),
    emittedStages: [],
  };
  await putState(store, state);
  return state;
}

function normalizeState(
  stored: Record<string, unknown>,
  now: Date,
): OnboardingFunnelState {
  const installationId =
    typeof stored.installationId === 'string' && stored.installationId.trim()
      ? stored.installationId
      : createInstallationId(now);
  const installedAt =
    typeof stored.installedAt === 'string' && !Number.isNaN(Date.parse(stored.installedAt))
      ? stored.installedAt
      : now.toISOString();
  const emittedStages = Array.isArray(stored.emittedStages)
    ? stored.emittedStages.filter(isOnboardingFunnelStage)
    : [];

  return {
    installationId,
    installedAt,
    emittedStages,
  };
}

function putState(
  store: LocalStore,
  state: OnboardingFunnelState,
): Promise<void> {
  return store.putConfigRecord(STORE_ID, {
    installationId: state.installationId,
    installedAt: state.installedAt,
    emittedStages: state.emittedStages,
  });
}

function isOnboardingFunnelStage(
  value: unknown,
): value is OnboardingFunnelStage {
  return (
    value === 'install' ||
    value === 'doctor_pass' ||
    value === 'first_route' ||
    value === 'first_contribution'
  );
}

function createInstallationId(now: Date): string {
  const cryptoObject = Reflect.get(globalThis, 'crypto') as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }

  return `install-${now.getTime().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
