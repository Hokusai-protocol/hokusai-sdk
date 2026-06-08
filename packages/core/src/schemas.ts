import type { ConsentSnapshot } from './consent.js';
import type { ModelSelection } from './model-registry.js';
import type { RedactionMatch } from './anonymization.js';
import type { CorrelationRecord } from './storage.js';

export interface HokusaiTaskInput {
  id: string;
  prompt: string;
  metadata?: Record<string, string>;
}

export type OutcomeStatus = 'accepted' | 'completed' | 'failed';

export interface HokusaiOutcome {
  taskId: string;
  status: OutcomeStatus;
  summary: string;
}

export interface HokusaiDispatchPayload {
  task: HokusaiTaskInput;
  prompt: string;
  consent: ConsentSnapshot;
  model: ModelSelection;
  correlation: CorrelationRecord;
  redactions: RedactionMatch[];
  createdAt: string;
}

// --- API schema types ---

export interface HokusaiValidationIssue {
  field: string;
  message: string;
}

export interface RouteRequest {
  taskId: string;
  prompt: string;
  modelId?: string;
  metadata?: Record<string, string>;
}

export interface RouteResponse {
  taskId: string;
  routingId: string;
  selectedModel: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeRequest {
  taskId: string;
  routingId: string;
  status: OutcomeStatus;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeResponse {
  taskId: string;
  routingId: string;
  acknowledged: boolean;
}

export interface DryRunDescriptor {
  dryRun: true;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

// --- Validation helpers ---

const VALID_OUTCOME_STATUSES: ReadonlySet<string> = new Set([
  'accepted',
  'completed',
  'failed',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateRouteRequest(
  value: unknown,
): RouteRequest | HokusaiValidationIssue[] {
  const issues: HokusaiValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: 'root', message: 'Expected an object' }];
  }
  const taskId = value['taskId'];
  if (typeof taskId !== 'string' || taskId.length === 0) {
    issues.push({ field: 'taskId', message: 'taskId is required' });
  }
  const prompt = value['prompt'];
  if (typeof prompt !== 'string' || prompt.length === 0) {
    issues.push({ field: 'prompt', message: 'prompt is required' });
  }
  if (issues.length > 0) return issues;
  return value as unknown as RouteRequest;
}

export function validateRouteResponse(
  value: unknown,
): RouteResponse | HokusaiValidationIssue[] {
  const issues: HokusaiValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: 'root', message: 'Expected an object' }];
  }
  if (typeof value['taskId'] !== 'string') {
    issues.push({ field: 'taskId', message: 'taskId is required' });
  }
  if (typeof value['routingId'] !== 'string') {
    issues.push({ field: 'routingId', message: 'routingId is required' });
  }
  if (typeof value['selectedModel'] !== 'string') {
    issues.push({ field: 'selectedModel', message: 'selectedModel is required' });
  }
  if (issues.length > 0) return issues;
  return value as unknown as RouteResponse;
}

export function validateOutcomeRequest(
  value: unknown,
): OutcomeRequest | HokusaiValidationIssue[] {
  const issues: HokusaiValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: 'root', message: 'Expected an object' }];
  }
  const taskId = value['taskId'];
  if (typeof taskId !== 'string' || taskId.length === 0) {
    issues.push({ field: 'taskId', message: 'taskId is required' });
  }
  const routingId = value['routingId'];
  if (typeof routingId !== 'string' || routingId.length === 0) {
    issues.push({ field: 'routingId', message: 'routingId is required' });
  }
  const status = value['status'];
  if (typeof status !== 'string' || !VALID_OUTCOME_STATUSES.has(status)) {
    issues.push({
      field: 'status',
      message: 'status must be accepted, completed, or failed',
    });
  }
  const summary = value['summary'];
  if (typeof summary !== 'string' || summary.length === 0) {
    issues.push({ field: 'summary', message: 'summary is required' });
  }
  if (issues.length > 0) return issues;
  return value as unknown as OutcomeRequest;
}

export function validateOutcomeResponse(
  value: unknown,
): OutcomeResponse | HokusaiValidationIssue[] {
  const issues: HokusaiValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ field: 'root', message: 'Expected an object' }];
  }
  if (typeof value['taskId'] !== 'string') {
    issues.push({ field: 'taskId', message: 'taskId is required' });
  }
  if (typeof value['routingId'] !== 'string') {
    issues.push({ field: 'routingId', message: 'routingId is required' });
  }
  if (typeof value['acknowledged'] !== 'boolean') {
    issues.push({ field: 'acknowledged', message: 'acknowledged is required' });
  }
  if (issues.length > 0) return issues;
  return value as unknown as OutcomeResponse;
}
