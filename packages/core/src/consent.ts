export type ConsentScope = 'task-execution' | 'telemetry' | 'local-storage';

export interface ConsentConfig {
  subjectId: string;
  grantedScopes: ConsentScope[];
}

export interface HokusaiApiConfig {
  baseUrl?: string;
  apiKeyEnvVar?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ConsentSettings {
  routingEnabled: boolean;
  outcomeReportingEnabled: boolean;
}

export interface PayloadPreviewSettings {
  enabled: boolean;
  maxPreviewChars?: number;
}

export interface RetentionPolicy {
  maxAgeMs?: number;
  maxRecords?: number;
}

export interface ConsentSnapshot {
  subjectId: string;
  grantedScopes: ConsentScope[];
}

export interface PluginConsentSettings {
  apiKey?: string;
  routingConsentEnabled: boolean;
  outcomeSubmissionEnabled: boolean;
}

export type ConsentRequiredScope = 'routing' | 'outcome';
export type ConsentRequiredReason = 'no-auth' | 'no-consent';

export class ConsentRequiredError extends Error {
  readonly scope: ConsentRequiredScope;
  readonly reason: ConsentRequiredReason;

  constructor(
    scope: ConsentRequiredScope,
    reason: ConsentRequiredReason,
  ) {
    super(
      reason === 'no-auth'
        ? `Cannot ${scope} without a configured Hokusai API key.`
        : `Cannot ${scope} until explicit Hokusai consent is enabled.`,
    );
    this.name = 'ConsentRequiredError';
    this.scope = scope;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isConsentGranted(
  consent: ConsentConfig,
  scope: ConsentScope,
): boolean {
  return consent.grantedScopes.includes(scope);
}

export function canRoute(settings: ConsentSettings): boolean {
  return settings.routingEnabled;
}

export function canReportOutcome(settings: ConsentSettings): boolean {
  return settings.outcomeReportingEnabled;
}

export function canRouteWithAuth(settings: PluginConsentSettings): boolean {
  return hasApiKey(settings.apiKey) && settings.routingConsentEnabled;
}

export function canSubmitOutcomeWithAuth(
  settings: PluginConsentSettings,
): boolean {
  return (
    hasApiKey(settings.apiKey) &&
    settings.routingConsentEnabled &&
    settings.outcomeSubmissionEnabled
  );
}

export function assertCanRoute(settings: PluginConsentSettings): void {
  if (!hasApiKey(settings.apiKey)) {
    throw new ConsentRequiredError('routing', 'no-auth');
  }

  if (!settings.routingConsentEnabled) {
    throw new ConsentRequiredError('routing', 'no-consent');
  }
}

export function assertCanSubmitOutcome(settings: PluginConsentSettings): void {
  if (!hasApiKey(settings.apiKey)) {
    throw new ConsentRequiredError('outcome', 'no-auth');
  }

  if (!settings.routingConsentEnabled || !settings.outcomeSubmissionEnabled) {
    throw new ConsentRequiredError('outcome', 'no-consent');
  }
}

export function resolveConsent(
  partial?: Partial<ConsentSettings>,
): ConsentSettings {
  return {
    routingEnabled: partial?.routingEnabled ?? false,
    outcomeReportingEnabled: partial?.outcomeReportingEnabled ?? false,
  };
}

function hasApiKey(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}
