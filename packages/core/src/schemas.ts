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
