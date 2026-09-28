/**
 * Defensive, versioned parser for Codex rollout JSONL.
 *
 * Rows consumed: `session_meta` (session id, CLI version), `turn_context`
 * (turn id, model transitions), and `event_msg` rows whose payload is a
 * `token_count`. Everything else — including `session_meta`'s `cwd`, `git.*`,
 * account and rate-limit attributes — is never read.
 *
 * Codex reports usage two ways: `info.last_token_usage` (a per-event delta,
 * newer CLIs) and `info.total_token_usage` (a cumulative session counter).
 * Both are projected out; the adapter prefers the delta and falls back to
 * baseline-diffed cumulative counters.
 *
 * @module sources/codex/parser
 */

import type { TaskCostTokenUsage } from '@hokusai/core';
import { parseJsonlObjects, type ParseJsonlOptions } from '../jsonl.js';
import {
  asRecord,
  countOrNull,
  idOrNull,
  isPresent,
  modelOrNull,
  timestampOrNull,
  versionOrNull,
} from '../sanitize.js';
import { countDiagnostic, type TaskCostSourceDiagnostics } from '../types.js';

/** Parsing contract implemented by this parser (`provider_contract_version`). */
export const CODEX_PROVIDER_CONTRACT_VERSION = 'codex/1';

/** One `token_count` observation, tied to the turn context in force. */
export interface CodexUsageObservation {
  turnId: string | null;
  observedModel: string;
  observedAt: string | null;
  observedMs: number | null;
  /** Per-event delta (`last_token_usage`), when the CLI reports one. */
  delta: Partial<TaskCostTokenUsage> | null;
  /** Cumulative session counters (`total_token_usage`), when reported. */
  cumulative: Partial<TaskCostTokenUsage> | null;
  /** A present usage field was malformed and nulled. */
  usageInvalid: boolean;
}

export interface CodexParsedSession {
  sessionId: string | null;
  harnessVersion: string | null;
  observations: CodexUsageObservation[];
}

function projectUsage(
  raw: Record<string, unknown>,
  flag: { usageInvalid: boolean },
): Partial<TaskCostTokenUsage> {
  const project = (value: unknown): number | null => {
    const count = countOrNull(value);
    if (count === null && isPresent(value)) flag.usageInvalid = true;
    return count;
  };
  return {
    input_tokens: project(raw.input_tokens),
    output_tokens: project(raw.output_tokens),
    cache_read_tokens: project(raw.cached_input_tokens),
    cache_write_tokens: project(raw.cache_write_input_tokens),
    reasoning_tokens: project(raw.reasoning_output_tokens),
  };
}

/** Parse one rollout's JSONL content. Diagnostics accumulate counts only. */
export function parseCodexRollout(
  content: string,
  diagnostics: TaskCostSourceDiagnostics,
  parseOptions?: ParseJsonlOptions,
): CodexParsedSession {
  const session: CodexParsedSession = {
    sessionId: null,
    harnessVersion: null,
    observations: [],
  };
  let currentTurnId: string | null = null;
  let currentModel = 'unknown';

  for (const entry of parseJsonlObjects(content, diagnostics, parseOptions)) {
    const payload = asRecord(entry.payload);

    if (entry.type === 'session_meta') {
      session.sessionId ??=
        idOrNull(payload?.id) ?? idOrNull(payload?.session_id);
      session.harnessVersion ??= versionOrNull(payload?.cli_version);
      continue;
    }

    if (entry.type === 'turn_context') {
      currentTurnId = idOrNull(payload?.turn_id);
      currentModel = modelOrNull(payload?.model) ?? currentModel;
      continue;
    }

    if (entry.type !== 'event_msg' || payload?.type !== 'token_count') {
      continue;
    }
    const info = asRecord(payload.info);
    const deltaRaw = info === null ? null : asRecord(info.last_token_usage);
    const cumulativeRaw =
      info === null ? null : asRecord(info.total_token_usage);
    if (deltaRaw === null && cumulativeRaw === null) {
      countDiagnostic(diagnostics, 'missing_usage');
      continue;
    }

    const observation: CodexUsageObservation = {
      turnId: currentTurnId,
      observedModel: currentModel,
      observedAt: null,
      observedMs: null,
      delta: null,
      cumulative: null,
      usageInvalid: false,
    };
    const timestamp = timestampOrNull(entry.timestamp);
    if (timestamp !== null) {
      observation.observedAt = timestamp.iso;
      observation.observedMs = timestamp.ms;
    }
    if (deltaRaw !== null) {
      observation.delta = projectUsage(deltaRaw, observation);
    }
    if (cumulativeRaw !== null) {
      observation.cumulative = projectUsage(cumulativeRaw, observation);
    }
    if (observation.usageInvalid) {
      countDiagnostic(diagnostics, 'invalid_usage_value');
    }
    session.observations.push(observation);
  }

  return session;
}
