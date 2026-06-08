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

export function resolveConsent(
  partial?: Partial<ConsentSettings>,
): ConsentSettings {
  return {
    routingEnabled: partial?.routingEnabled ?? false,
    outcomeReportingEnabled: partial?.outcomeReportingEnabled ?? false,
  };
}
