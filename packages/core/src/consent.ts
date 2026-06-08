export type ConsentScope = 'task-execution' | 'telemetry' | 'local-storage';

export interface ConsentConfig {
  subjectId: string;
  grantedScopes: ConsentScope[];
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
