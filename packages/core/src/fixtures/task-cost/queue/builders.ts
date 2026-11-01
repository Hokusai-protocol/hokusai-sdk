import type { TaskAttemptRef } from '../../../task-cost/attempt.js';
import type {
  QueueAgentActor,
  QueueAutomationActor,
  QueueGithubActor,
  QueueLifecycleEventV1,
  QueueOperatorActor,
} from '../../../task-cost/queue-lifecycle.js';
import type {
  QueueLifecycleDecision,
  QueueLifecycleDecisionReason,
  QueueLifecycleLogResult,
  QueueLifecycleStreamEntry,
} from '../../../task-cost/queue-lifecycle-reducer.js';
import { at } from '../attempt/builders.js';

export { OTHER_TASK, TASK, at, attempt, mint, outcome, ref } from '../attempt/builders.js';

/**
 * A golden queue-lifecycle fixture: an arrival-ordered stream of
 * `queue_lifecycle_event/v1` events interleaved with the `task_attempt/v1`
 * records they depend on, and the hand-written result
 * `reduceQueueLifecycleLog` must produce.
 */
export interface QueueLifecycleFixture {
  name: string;
  description: string;
  stream: QueueLifecycleStreamEntry[];
  expected: QueueLifecycleLogResult;
}

/** Synthetic 40-hex git object ids. Never real commits. */
export function sha(n: number): string {
  return `c0de${n.toString(16).padStart(36, '0')}`;
}

export const TEND: QueueAutomationActor = { kind: 'tend', component: 'merge-lane' };
export const WATCHDOG: QueueAutomationActor = { kind: 'monitor', component: 'ready-watchdog' };
export const GITHUB: QueueGithubActor = { kind: 'github', app: 'merge-queue' };
export const ACTIONS: QueueGithubActor = { kind: 'github', app: 'actions' };
export const OPERATOR: QueueOperatorActor = { kind: 'operator' };

/** An agent whose executed model was observed from the provider response. */
export function agent(executed: string, intended: string = executed, harness = 'claude-code'): QueueAgentActor {
  return {
    kind: 'agent',
    harness,
    intended_model: intended,
    executed_model_evidence: 'provider_response',
    executed_model: executed,
  };
}

type Distribute<T> = T extends unknown ? Omit<T, 'schema_version' | 'observed_at'> & { t: number } : never;
export type QueueEventInput = Distribute<QueueLifecycleEventV1>;

/** Builds an event; `t` is seconds after the fixture epoch. */
export function qe<T extends QueueEventInput>(input: T): QueueLifecycleEventV1 {
  const { t, ...rest } = input;
  return { schema_version: 'queue_lifecycle_event/v1', observed_at: at(t), ...rest } as unknown as QueueLifecycleEventV1;
}

/** PR-scope fields. */
export function pr(attempt: TaskAttemptRef, prNumber: number, headSha: string) {
  return { attempt, pr_number: prNumber, head_sha: headSha };
}

/** Expected decision for stream position `index`. */
export function decided(
  index: number,
  event: QueueLifecycleStreamEntry,
  decision: QueueLifecycleDecision['decision'],
  reasons?: QueueLifecycleDecisionReason[],
): QueueLifecycleDecision {
  if (event.schema_version !== 'queue_lifecycle_event/v1') {
    throw new TypeError(`stream entry ${index} is not a queue event`);
  }
  return {
    index,
    event_id: event.event_id,
    event_type: event.event_type,
    decision,
    ...(reasons !== undefined ? { reasons } : {}),
  };
}

/** Decisions for every queue event in `stream`, all accepted unless overridden. */
export function decisionsFor(
  stream: readonly QueueLifecycleStreamEntry[],
  overrides: Record<number, [QueueLifecycleDecision['decision'], QueueLifecycleDecisionReason[]?]> = {},
): QueueLifecycleDecision[] {
  const out: QueueLifecycleDecision[] = [];
  for (const [index, entry] of stream.entries()) {
    if (entry.schema_version !== 'queue_lifecycle_event/v1') continue;
    const [decision, reasons] = overrides[index] ?? ['accepted'];
    out.push(decided(index, entry, decision, reasons));
  }
  return out;
}

export function eventIds(...events: QueueLifecycleEventV1[]): string[] {
  return events.map((event) => event.event_id);
}
