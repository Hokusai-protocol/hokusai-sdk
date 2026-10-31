/**
 * Reference reducer for the `task_attempt/v1` log: applies the contract's
 * write rules to an ordered log and reports, for every entry, whether it was
 * accepted. Producers that enforce the rules live (Wavemill's task-row
 * writers) must make the same decisions; the golden fixtures are the
 * compatibility test.
 *
 * Unlike cost events, the attempt log is **order-sensitive**: entries are
 * applied in arrival order, because "current" means "the latest launch the
 * writer has seen". Pure: no clock, no I/O.
 *
 * @module task-cost/attempt-reducer
 */

import type {
  TaskAttemptArmRole,
  TaskAttemptCodeIdentity,
  TaskAttemptControlWriteV1,
  TaskAttemptDerivedInput,
  TaskAttemptDerivedResultV1,
  TaskAttemptEvidenceKind,
  TaskAttemptEvidenceWriteV1,
  TaskAttemptKind,
  TaskAttemptLogEntryV1,
  TaskAttemptOutcome,
  TaskAttemptRecordType,
  TaskAttemptRecordV1,
  TaskAttemptRef,
  TaskAttemptSessionRef,
} from './attempt.js';
import { validateTaskAttemptLogEntryV1 } from './attempt-validators.js';

export const TASK_ATTEMPT_DECISIONS = ['accepted', 'rejected', 'duplicate'] as const;
export type TaskAttemptDecisionKind = (typeof TASK_ATTEMPT_DECISIONS)[number];

/** Why an entry was rejected, or a note on an accepted one. Contract order. */
export const TASK_ATTEMPT_DECISION_REASONS = [
  // Attempt records (rejected).
  'id_reused',
  'unknown_parent',
  'parent_mismatch',
  'retry_target_invalid',
  'retry_of_succeeded',
  // Control writes (rejected).
  'unknown_attempt',
  'ref_mismatch',
  'stale_run',
  'stale_stage_attempt',
  'settled',
  // Evidence writes (accepted, noted).
  'undeclared_attempt',
  'evidence_version_not_newer',
] as const;
export type TaskAttemptDecisionReason = (typeof TASK_ATTEMPT_DECISION_REASONS)[number];

export interface TaskAttemptDecision {
  /** Position in the input log. */
  index: number;
  record_type: TaskAttemptRecordType;
  /** `id`, `write_id` or `derived_id` of the entry. */
  key: string;
  decision: TaskAttemptDecisionKind;
  /** Omitted when empty. */
  reasons?: TaskAttemptDecisionReason[];
}

export interface TaskAttemptState {
  id: string;
  kind: TaskAttemptKind;
  task_id: string;
  parent_id: string;
  stage?: string;
  role?: TaskAttemptArmRole;
  retry_of?: string;
  /** The newer sibling launch that replaced this one, if any. */
  superseded_by?: string;
  /** Latest launch among its siblings, under a current parent. */
  current: boolean;
  /** Settled once by an accepted `outcome` control write. */
  outcome: TaskAttemptOutcome | null;
  code_identity?: TaskAttemptCodeIdentity;
  session_refs: TaskAttemptSessionRef[];
}

export interface TaskAttemptEvidenceState {
  /** `stage_attempt_id` when the evidence names one, else `run_id`. */
  attempt_id: string;
  evidence_kind: TaskAttemptEvidenceKind;
  latest_version: number;
  /** Every accepted write, in arrival order (older versions stay for audit). */
  write_ids: string[];
}

export type TaskAttemptDerivedStatus = 'current' | 'stale' | 'superseded';

export interface TaskAttemptDerivedState {
  derived_id: string;
  derived_kind: string;
  status: TaskAttemptDerivedStatus;
  superseded_by?: string;
  /** Inputs that read an older evidence version than the latest. */
  stale_inputs?: TaskAttemptDerivedInput[];
}

export interface TaskAttemptLogResult {
  decisions: TaskAttemptDecision[];
  attempts: TaskAttemptState[];
  evidence: TaskAttemptEvidenceState[];
  derived: TaskAttemptDerivedState[];
}

interface EntityState extends TaskAttemptState {
  groupKey: string;
}

/**
 * Siblings compete for "current": the latest launch in a group wins.
 *
 * - A task's runs and pairs form one group: a relaunch, plain or challenged,
 *   replaces whatever the task was running.
 * - An arm's runs form one group.
 * - A pair's arms are grouped by role.
 * - A run's stage attempts are grouped by stage.
 */
function groupKeyOf(record: TaskAttemptRecordV1): string {
  switch (record.kind) {
    case 'pair':
      return `${record.task_id}|execution`;
    case 'run':
      return record.parent_id === record.task_id ? `${record.task_id}|execution` : `${record.parent_id}|run`;
    case 'arm':
      return `${record.parent_id}|arm|${record.role ?? ''}`;
    case 'stage_attempt':
      return `${record.parent_id}|stage|${record.stage ?? ''}`;
  }
}

const EXPECTED_PARENT_KIND: Record<TaskAttemptKind, TaskAttemptKind | null> = {
  pair: null,
  arm: 'pair',
  run: 'arm',
  stage_attempt: 'run',
};

function evidenceKey(attemptId: string, kind: TaskAttemptEvidenceKind): string {
  return `${attemptId}|${kind}`;
}

function attemptIdOf(ref: TaskAttemptRef): string {
  return ref.stage_attempt_id ?? ref.run_id;
}

function mergeSessionRefs(target: TaskAttemptSessionRef[], refs: readonly TaskAttemptSessionRef[]): void {
  for (const ref of refs) {
    if (!target.some((existing) => existing.harness === ref.harness && existing.session_id === ref.session_id)) {
      target.push({ ...ref });
    }
  }
}

export function reduceTaskAttemptLog(entries: readonly unknown[]): TaskAttemptLogResult {
  for (const entry of entries) validateTaskAttemptLogEntryV1(entry);
  const log = entries as readonly TaskAttemptLogEntryV1[];

  const entities = new Map<string, EntityState>();
  const latestInGroup = new Map<string, string>();
  const seenWrites = new Set<string>();
  const evidence = new Map<string, TaskAttemptEvidenceState>();
  const derived = new Map<string, TaskAttemptDerivedResultV1>();
  const derivedSupersededBy = new Map<string, string>();
  const decisions: TaskAttemptDecision[] = [];

  const isCurrent = (entity: EntityState): boolean => {
    if (latestInGroup.get(entity.groupKey) !== entity.id) return false;
    if (entity.parent_id === entity.task_id) return true;
    const parent = entities.get(entity.parent_id);
    return parent !== undefined && isCurrent(parent);
  };

  const decide = (
    index: number,
    recordType: TaskAttemptRecordType,
    key: string,
    decision: TaskAttemptDecisionKind,
    reasons: TaskAttemptDecisionReason[] = [],
  ): void => {
    decisions.push({
      index,
      record_type: recordType,
      key,
      decision,
      ...(reasons.length > 0 ? { reasons } : {}),
    });
  };

  const applyAttempt = (index: number, record: TaskAttemptRecordV1): void => {
    if (entities.has(record.id)) return decide(index, 'attempt', record.id, 'rejected', ['id_reused']);

    const expectedParentKind = EXPECTED_PARENT_KIND[record.kind];
    const parentIsTask = record.parent_id === record.task_id;
    if (!(parentIsTask && (record.kind === 'pair' || record.kind === 'run'))) {
      const parent = entities.get(record.parent_id);
      if (!parent) return decide(index, 'attempt', record.id, 'rejected', ['unknown_parent']);
      if (parent.kind !== expectedParentKind || parent.task_id !== record.task_id) {
        return decide(index, 'attempt', record.id, 'rejected', ['parent_mismatch']);
      }
    }

    const groupKey = groupKeyOf(record);
    if (record.retry_of !== undefined) {
      const target = entities.get(record.retry_of);
      if (!target || target.kind !== record.kind || target.groupKey !== groupKey) {
        return decide(index, 'attempt', record.id, 'rejected', ['retry_target_invalid']);
      }
      if (target.outcome === 'succeeded') {
        return decide(index, 'attempt', record.id, 'rejected', ['retry_of_succeeded']);
      }
    }

    const previous = latestInGroup.get(groupKey);
    if (previous !== undefined) {
      const previousEntity = entities.get(previous);
      if (previousEntity) previousEntity.superseded_by = record.id;
    }
    if (record.retry_of !== undefined) {
      const target = entities.get(record.retry_of);
      if (target && target.superseded_by === undefined) target.superseded_by = record.id;
    }
    latestInGroup.set(groupKey, record.id);
    entities.set(record.id, {
      id: record.id,
      kind: record.kind,
      task_id: record.task_id,
      parent_id: record.parent_id,
      ...(record.stage !== undefined ? { stage: record.stage } : {}),
      ...(record.role !== undefined ? { role: record.role } : {}),
      ...(record.retry_of !== undefined ? { retry_of: record.retry_of } : {}),
      current: true,
      outcome: null,
      ...(record.code_identity !== undefined ? { code_identity: { ...record.code_identity } } : {}),
      session_refs: (record.session_refs ?? []).map((ref) => ({ ...ref })),
      groupKey,
    });
    decide(index, 'attempt', record.id, 'accepted');
  };

  /** Resolves a ref against declared entities; `null` target means undeclared. */
  const resolveRef = (
    ref: TaskAttemptRef,
  ): { run?: EntityState | undefined; target?: EntityState | undefined; mismatch: boolean } => {
    const run = entities.get(ref.run_id);
    if (run && (run.kind !== 'run' || run.task_id !== ref.task_id)) return { mismatch: true };
    if (ref.stage_attempt_id === undefined) return { run, target: run, mismatch: false };
    const stageAttempt = entities.get(ref.stage_attempt_id);
    if (stageAttempt && (stageAttempt.kind !== 'stage_attempt' || stageAttempt.parent_id !== ref.run_id)) {
      return { mismatch: true };
    }
    return { run, target: stageAttempt, mismatch: false };
  };

  const applyControl = (index: number, write: TaskAttemptControlWriteV1): void => {
    if (seenWrites.has(write.write_id)) return decide(index, 'control', write.write_id, 'duplicate');
    seenWrites.add(write.write_id);
    const { run, target, mismatch } = resolveRef(write.attempt);
    if (mismatch) return decide(index, 'control', write.write_id, 'rejected', ['ref_mismatch']);
    if (!run || !target) return decide(index, 'control', write.write_id, 'rejected', ['unknown_attempt']);
    if (!isCurrent(run)) return decide(index, 'control', write.write_id, 'rejected', ['stale_run']);
    if (target !== run && !isCurrent(target)) {
      return decide(index, 'control', write.write_id, 'rejected', ['stale_stage_attempt']);
    }
    if (run.outcome !== null || target.outcome !== null) {
      return decide(index, 'control', write.write_id, 'rejected', ['settled']);
    }
    if (write.action === 'outcome' && write.outcome !== undefined) target.outcome = write.outcome;
    decide(index, 'control', write.write_id, 'accepted');
  };

  const applyEvidence = (index: number, write: TaskAttemptEvidenceWriteV1): void => {
    if (seenWrites.has(write.write_id)) return decide(index, 'evidence', write.write_id, 'duplicate');
    seenWrites.add(write.write_id);
    const { target, mismatch } = resolveRef(write.attempt);
    if (mismatch) return decide(index, 'evidence', write.write_id, 'rejected', ['ref_mismatch']);

    const reasons: TaskAttemptDecisionReason[] = [];
    if (!target) reasons.push('undeclared_attempt');

    const attemptId = attemptIdOf(write.attempt);
    const key = evidenceKey(attemptId, write.evidence_kind);
    const state = evidence.get(key);
    const isNewer = state === undefined || write.evidence_version > state.latest_version;
    if (state === undefined) {
      evidence.set(key, {
        attempt_id: attemptId,
        evidence_kind: write.evidence_kind,
        latest_version: write.evidence_version,
        write_ids: [write.write_id],
      });
    } else {
      state.write_ids.push(write.write_id);
      if (isNewer) state.latest_version = write.evidence_version;
      else reasons.push('evidence_version_not_newer');
    }

    if (target) {
      if (write.session_refs) mergeSessionRefs(target.session_refs, write.session_refs);
      if (write.code_identity && isNewer) target.code_identity = { ...write.code_identity };
    }
    decide(index, 'evidence', write.write_id, 'accepted', reasons);
  };

  const applyDerived = (index: number, result: TaskAttemptDerivedResultV1): void => {
    if (derived.has(result.derived_id)) return decide(index, 'derived', result.derived_id, 'duplicate');
    derived.set(result.derived_id, result);
    if (result.supersedes !== undefined) derivedSupersededBy.set(result.supersedes, result.derived_id);
    decide(index, 'derived', result.derived_id, 'accepted');
  };

  for (const [index, entry] of log.entries()) {
    switch (entry.record_type) {
      case 'attempt':
        applyAttempt(index, entry);
        break;
      case 'control':
        applyControl(index, entry);
        break;
      case 'evidence':
        applyEvidence(index, entry);
        break;
      case 'derived':
        applyDerived(index, entry);
        break;
    }
  }

  const attempts: TaskAttemptState[] = [...entities.values()].map(({ groupKey: _groupKey, ...entity }) => ({
    ...entity,
    current: isCurrent({ ...entity, groupKey: _groupKey }),
  }));

  const derivedStates: TaskAttemptDerivedState[] = [...derived.values()].map((result) => {
    const supersededBy = derivedSupersededBy.get(result.derived_id);
    if (supersededBy !== undefined) {
      return {
        derived_id: result.derived_id,
        derived_kind: result.derived_kind,
        status: 'superseded',
        superseded_by: supersededBy,
      };
    }
    const staleInputs = result.inputs.filter((input) => {
      const latest = evidence.get(evidenceKey(attemptIdOf(input.attempt), input.evidence_kind));
      return latest !== undefined && latest.latest_version > input.evidence_version;
    });
    return {
      derived_id: result.derived_id,
      derived_kind: result.derived_kind,
      status: staleInputs.length > 0 ? 'stale' : 'current',
      ...(staleInputs.length > 0 ? { stale_inputs: staleInputs } : {}),
    };
  });

  return {
    decisions,
    attempts,
    evidence: [...evidence.values()],
    derived: derivedStates,
  };
}
