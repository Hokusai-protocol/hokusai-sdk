/**
 * Final assembly shared by the file-based adapters: boundary-accepted rows
 * in, ordered `IngestUsageInput` records out. Sequences are assigned per
 * session in timestamp order (stable for ties), so cumulative/replay
 * semantics in the reducer see a consistent ordering regardless of file
 * supply order.
 *
 * @module sources/assemble
 */

import type { TaskCostHarness, TaskCostTokenUsage } from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';

/** A boundary-accepted row, ready to become one ingest input. */
export interface AcceptedUsageRow {
  eventId: string;
  sessionId: string;
  turnId: string;
  observedAt: string;
  observedMs: number;
  observedModel: string;
  usage: Partial<TaskCostTokenUsage>;
  actualCostUsd: number | null;
  harnessVersion: string | null;
  isSubagent?: boolean;
  /** Attach the contract's `invalid_token_usage` diagnostic to the event. */
  usageInvalid: boolean;
}

export interface AssembledInputs {
  inputs: IngestUsageInput[];
  sourceVersions: string[];
}

export function assembleInputs(
  taskId: string,
  harness: TaskCostHarness,
  providerContractVersion: string,
  rows: readonly AcceptedUsageRow[],
): AssembledInputs {
  const bySession = new Map<string, AcceptedUsageRow[]>();
  for (const row of rows) {
    const sessionRows = bySession.get(row.sessionId);
    if (sessionRows === undefined) bySession.set(row.sessionId, [row]);
    else sessionRows.push(row);
  }

  const inputs: IngestUsageInput[] = [];
  const sourceVersions: string[] = [];
  for (const sessionRows of bySession.values()) {
    const ordered = [...sessionRows].sort((a, b) => a.observedMs - b.observedMs);
    for (const [index, row] of ordered.entries()) {
      if (
        row.harnessVersion !== null &&
        !sourceVersions.includes(row.harnessVersion)
      ) {
        sourceVersions.push(row.harnessVersion);
      }
      inputs.push({
        eventId: row.eventId,
        taskId,
        sessionId: row.sessionId,
        turnId: row.turnId,
        sequence: index + 1,
        harness,
        ...(row.harnessVersion !== null
          ? { harnessVersion: row.harnessVersion }
          : {}),
        providerContractVersion,
        observedModel: row.observedModel,
        usage: row.usage,
        usageKind: 'delta',
        ...(row.actualCostUsd !== null
          ? { actualCostUsd: row.actualCostUsd }
          : {}),
        ...(row.isSubagent !== undefined
          ? { isSubagent: row.isSubagent }
          : {}),
        observedAt: row.observedAt,
        ...(row.usageInvalid ? { diagnostics: ['invalid_token_usage'] } : {}),
      });
    }
  }
  return { inputs, sourceVersions };
}
