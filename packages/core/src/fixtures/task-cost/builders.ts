/**
 * Small builders that keep the task-cost fixtures readable. They only fill in
 * mechanical defaults and *derive* the redundant fields (`usage_coverage`,
 * `cost_source`, `pricing_source`); the expected summaries in each fixture are
 * written out by hand and are what the reducer is checked against.
 *
 * All ids are synthetic and deterministic. Timestamps are anchored at
 * {@link FIXTURE_EPOCH} plus an offset in seconds.
 *
 * @module fixtures/task-cost/builders
 */

import { MODEL_PRICING_AS_OF } from '../../pricing.js';
import type {
  TaskCostBasis,
  TaskCostDiagnosticCode,
  TaskCostEventV1,
  TaskCostHarness,
  TaskCostLedgerV1,
  TaskCostPriceTable,
  TaskCostSummaryV1,
  TaskCostTokenUsage,
  TaskCostUsageKind,
} from '../../task-cost/index.js';
import {
  TASK_COST_EVENT_SCHEMA_VERSION,
  TASK_COST_LEDGER_SCHEMA_VERSION,
  deriveUsageAvailability,
} from '../../task-cost/index.js';

export const FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
export const FIXTURE_TASK_ID = 'task-0001';
export const FIXTURE_SESSION_ID = 'session-0001';
export const FIXTURE_PRICING_REVISION = MODEL_PRICING_AS_OF;

/** A named, self-describing fixture: events in, expected summaries out. */
export interface TaskCostFixture {
  name: string;
  description: string;
  events: TaskCostEventV1[];
  ledger: TaskCostLedgerV1;
  /** One entry per `task_id` present in `events`, in `task_id` order. */
  expectedSummaries: TaskCostSummaryV1[];
}

export function isoAt(offsetSeconds: number): string {
  return new Date(FIXTURE_EPOCH_MS + offsetSeconds * 1000).toISOString().replace('.000Z', 'Z');
}

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

/** `null` marks a counter the source did not report. */
export function tokens(
  input: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
  reasoning: number | null,
): TaskCostTokenUsage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    reasoning_tokens: reasoning,
  };
}

export interface HarnessProfile {
  harness: TaskCostHarness;
  providerContractVersion: string;
  harnessVersion?: string;
}

export interface EventSpec {
  /** 1-based position; drives event_id, turn_id, sequence and time by default. */
  n: number;
  model: string;
  usage: TaskCostTokenUsage;
  actual?: number | null;
  estimated?: number | null;
  task?: string;
  session?: string;
  turn?: string;
  sequence?: number;
  atSeconds?: number;
  kind?: TaskCostUsageKind;
  basis?: TaskCostBasis;
  table?: TaskCostPriceTable;
  pricingSource?: 'local_estimate' | 'openrouter_api';
  replayOf?: string;
  parent?: string;
  isSubagent?: boolean;
  diagnostics?: TaskCostDiagnosticCode[];
}

export function eventId(n: number): string {
  return `01900000-0000-7000-8000-${pad(n, 12)}`;
}

function defaultTable(model: string): TaskCostPriceTable {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  return 'openai';
}

export function eventFactory(profile: HarnessProfile): (spec: EventSpec) => TaskCostEventV1 {
  return (spec) => {
    const actual = spec.actual ?? null;
    const estimated = spec.estimated ?? null;
    return {
      schema_version: TASK_COST_EVENT_SCHEMA_VERSION,
      event_id: eventId(spec.n),
      task_id: spec.task ?? FIXTURE_TASK_ID,
      session_id: spec.session ?? FIXTURE_SESSION_ID,
      turn_id: spec.turn ?? `turn-${pad(spec.n)}`,
      sequence: spec.sequence ?? spec.n,
      ...(spec.parent !== undefined ? { parent_event_id: spec.parent } : {}),
      ...(spec.isSubagent !== undefined ? { is_subagent: spec.isSubagent } : {}),
      ...(spec.replayOf !== undefined ? { replay_of_event_id: spec.replayOf } : {}),
      harness: profile.harness,
      ...(profile.harnessVersion !== undefined ? { harness_version: profile.harnessVersion } : {}),
      provider_contract_version: profile.providerContractVersion,
      observed_model: spec.model,
      usage_kind: spec.kind ?? 'delta',
      usage: spec.usage,
      usage_coverage: deriveUsageAvailability(spec.usage),
      actual_cost_usd: actual,
      estimated_cost_usd: estimated,
      cost_source: actual !== null ? 'provider_reported' : estimated !== null ? 'local_estimate' : 'none',
      cost_basis: spec.basis ?? 'per_token_api',
      pricing_source: estimated !== null ? (spec.pricingSource ?? 'local_estimate') : 'none',
      ...(estimated !== null
        ? {
            pricing_revision: FIXTURE_PRICING_REVISION,
            price_table: spec.table ?? defaultTable(spec.model),
          }
        : {}),
      observed_at: isoAt(spec.atSeconds ?? spec.n * 60),
      ...(spec.diagnostics !== undefined ? { diagnostics: spec.diagnostics } : {}),
    };
  };
}

export function ledgerFor(
  profile: HarnessProfile,
  events: readonly TaskCostEventV1[],
  sessionId: string = FIXTURE_SESSION_ID,
): TaskCostLedgerV1 {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) throw new Error('ledgerFor requires at least one event');
  return {
    schema_version: TASK_COST_LEDGER_SCHEMA_VERSION,
    harness: profile.harness,
    ...(profile.harnessVersion !== undefined ? { harness_version: profile.harnessVersion } : {}),
    provider_contract_version: profile.providerContractVersion,
    session_id: sessionId,
    task_ids: [...new Set(events.map((event) => event.task_id))].sort(),
    opened_at: first.observed_at,
    closed_at: last.observed_at,
    truncated: false,
    event_count: events.length,
    events: [...events],
  };
}
