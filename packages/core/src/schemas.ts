import type { ConsentSnapshot } from './consent.js';
import type { ModelSelection } from './model-registry.js';
import type { RedactionMatch, RedactionRecord } from './anonymization.js';
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
  /**
   * Builders should pass user-visible summaries through redact() before
   * constructing outcome packets when the reusable redaction engine is enabled.
   */
  summary: string;
  redactions?: RedactionRecord[];
}

export interface HokusaiDispatchPayload {
  task: HokusaiTaskInput;
  prompt: string;
  consent: ConsentSnapshot;
  model: ModelSelection;
  correlation: CorrelationRecord;
  redactions: Array<RedactionMatch | RedactionRecord>;
  createdAt: string;
}
