/**
 * Best-effort capture of a Claude Code session's per-task cost so the Model 30
 * contribution row can carry an `actual_cost_usd` without the operator typing it.
 *
 * Claude Code exposes cumulative cost only via the statusline stdin
 * (`cost.total_cost_usd`, single-slot) and per-turn token `usage` via the
 * session transcript JSONL (officially "internal/unstable" — parsed here
 * defensively). Hooks carry no cost, and no env var/API exposes it.
 *
 * Two auto sources are supported, both layered behind explicit operator input:
 *  1. A statusline sidecar file (`<claude-config>/hokusai/session-cost.json`)
 *     written by the opt-in Hokusai statusline script. Diffing the cumulative
 *     cost between route time and report time yields Claude's own exact number.
 *  2. The session transcript JSONL, parsed line-by-line for numeric `usage`
 *     fields on turns after the route baseline, priced via the core price table.
 *
 * Every function is pure over an injected filesystem so it is unit-testable
 * without touching the real home directory, and every auto path is defensive:
 * any failure returns `undefined`/an empty result and never throws.
 *
 * @module session-usage
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeActualCostUsd } from './pricing.js';

/**
 * Minimal synchronous filesystem surface used by this module. Defaulting to
 * Node's `fs` keeps callers simple; injecting a fake keeps tests off the real
 * home directory.
 */
export interface SessionUsageFileSystem {
  /** Read a UTF-8 file. Throws (e.g. ENOENT) when the file is unreadable. */
  readFileSync: (filePath: string) => string;
  /** List directory entries. Throws when the directory is unreadable. */
  readdirSync: (dirPath: string) => string[];
  /** Stat a path, returning at least the modification time in ms. */
  statSync: (filePath: string) => { mtimeMs: number };
}

const nodeFs: SessionUsageFileSystem = {
  readFileSync: (filePath) => readFileSync(filePath, 'utf8'),
  readdirSync: (dirPath) => readdirSync(dirPath),
  statSync: (filePath) => ({ mtimeMs: statSync(filePath).mtimeMs }),
};

/** Sidecar file written by the opt-in Hokusai statusline script. */
export interface SessionCostSidecar {
  /** Claude Code session id the cumulative cost belongs to. */
  session_id: string;
  /** Cumulative cost for the session in USD (`cost.total_cost_usd`). */
  cost_usd: number;
  /** ISO timestamp the sidecar was last written, when present. */
  updated_at?: string;
  /** Cumulative input tokens, when the statusline surfaced them. */
  input_tokens?: number;
  /** Cumulative output tokens, when the statusline surfaced them. */
  output_tokens?: number;
}

/** Baseline snapshot persisted into the routeContext at route time. */
export interface CostBaselineSnapshot {
  /** ISO timestamp of the route — always present; filters transcript turns. */
  baselineAt: string;
  /** Encoded project-dir key (cwd with non-alphanumerics → `-`). */
  projectDirKey: string;
  /** Cumulative session cost at route time (sidecar diff base), when fresh. */
  costBaselineUsd?: number;
  /** Session id the baseline cost belongs to, when a fresh sidecar was found. */
  sessionId?: string;
}

/** Token totals summed from a transcript, kept per-tier for correct pricing. */
export interface TranscriptUsageTotals {
  /** Uncached input_tokens. */
  inputTokens: number;
  /** cache_creation_input_tokens (billed above the input rate). */
  cacheCreationTokens: number;
  /** cache_read_input_tokens (billed below the input rate). */
  cacheReadTokens: number;
  /** output_tokens. */
  outputTokens: number;
  /** Number of turns that contributed usage after the baseline filter. */
  turns: number;
}

/**
 * A sidecar older than this (relative to the route) is treated as stale and its
 * cost/session id are not adopted as a baseline. The session-id guard at report
 * time is the primary protection; this simply avoids trusting an ancient file.
 */
export const DEFAULT_SIDECAR_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Encode a working directory into Claude Code's transcript project-dir key:
 * every non-alphanumeric character becomes `-`.
 */
export function encodeProjectDirKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Resolve Claude Code's config dir: `CLAUDE_CONFIG_DIR` when set, else
 * `<home>/.claude`. This is distinct from the Hokusai plugin config dir.
 */
export function resolveClaudeConfigDir(input?: {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}): string {
  const env = input?.env ?? process.env;
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override) {
    return override;
  }

  return path.join(input?.homedir ?? os.homedir(), '.claude');
}

/** Absolute path of the statusline sidecar under a Claude config dir. */
export function sessionCostSidecarPath(claudeConfigDir: string): string {
  return path.join(claudeConfigDir, 'hokusai', 'session-cost.json');
}

/** Absolute path of the transcript directory for a cwd under a Claude config dir. */
export function sessionTranscriptDir(claudeConfigDir: string, cwd: string): string {
  return path.join(claudeConfigDir, 'projects', encodeProjectDirKey(cwd));
}

function claudeConfigDirFrom(input: {
  env?: NodeJS.ProcessEnv | undefined;
  homedir?: string | undefined;
}): string {
  return resolveClaudeConfigDir({
    ...(input.env ? { env: input.env } : {}),
    ...(input.homedir ? { homedir: input.homedir } : {}),
  });
}

/**
 * Read and validate the statusline sidecar. Returns `undefined` when the file
 * is absent, unreadable, unparseable, or missing a `session_id`/finite
 * `cost_usd`. Never throws.
 */
export function readSessionCostSidecar(
  sidecarPath: string,
  fs: SessionUsageFileSystem = nodeFs,
): SessionCostSidecar | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPath);
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const sessionId = record.session_id;
    const cost = record.cost_usd;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return undefined;
    }
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      return undefined;
    }

    return {
      session_id: sessionId,
      cost_usd: cost,
      ...(typeof record.updated_at === 'string' ? { updated_at: record.updated_at } : {}),
      ...(typeof record.input_tokens === 'number' && Number.isFinite(record.input_tokens)
        ? { input_tokens: record.input_tokens }
        : {}),
      ...(typeof record.output_tokens === 'number' && Number.isFinite(record.output_tokens)
        ? { output_tokens: record.output_tokens }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function isSidecarFresh(
  sidecar: SessionCostSidecar,
  nowIso: string,
  freshnessMs: number,
): boolean {
  if (!sidecar.updated_at) {
    // No timestamp to judge by — trust a present, well-formed sidecar.
    return true;
  }

  const updated = Date.parse(sidecar.updated_at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(updated) || !Number.isFinite(now)) {
    return true;
  }

  return Math.abs(now - updated) <= freshnessMs;
}

/**
 * Capture the route-time cost baseline for later diffing. Always records
 * `baselineAt` and the encoded project-dir key; additionally adopts the current
 * sidecar's cost/session id when a fresh sidecar is present. Never throws.
 */
export function captureCostBaseline(input: {
  cwd: string;
  nowIso: string;
  env?: NodeJS.ProcessEnv | undefined;
  homedir?: string | undefined;
  fs?: SessionUsageFileSystem | undefined;
  freshnessMs?: number | undefined;
}): CostBaselineSnapshot {
  const snapshot: CostBaselineSnapshot = {
    baselineAt: input.nowIso,
    projectDirKey: encodeProjectDirKey(input.cwd),
  };

  try {
    const configDir = claudeConfigDirFrom(input);
    const sidecar = readSessionCostSidecar(sessionCostSidecarPath(configDir), input.fs ?? nodeFs);
    if (
      sidecar &&
      isSidecarFresh(sidecar, input.nowIso, input.freshnessMs ?? DEFAULT_SIDECAR_FRESHNESS_MS)
    ) {
      return {
        ...snapshot,
        costBaselineUsd: sidecar.cost_usd,
        sessionId: sidecar.session_id,
      };
    }
  } catch {
    // Defensive: fall through to the baseline without a cost anchor.
  }

  return snapshot;
}

/**
 * Diff the current sidecar cumulative cost against the route-time baseline. The
 * session ids must match (Claude's cost is per-session) and the baseline cost
 * must be finite. Returns the clamped (>= 0) diff, or `undefined` when the
 * sidecar is absent, the sessions differ, or no baseline cost exists.
 */
export function resolveSidecarCostDiff(input: {
  sidecar: SessionCostSidecar | undefined;
  baselineSessionId: string | undefined;
  costBaselineUsd: number | undefined;
}): number | undefined {
  const { sidecar, baselineSessionId, costBaselineUsd } = input;
  if (!sidecar) {
    return undefined;
  }
  if (typeof costBaselineUsd !== 'number' || !Number.isFinite(costBaselineUsd)) {
    return undefined;
  }
  if (baselineSessionId !== undefined && sidecar.session_id !== baselineSessionId) {
    return undefined;
  }

  const diff = sidecar.cost_usd - costBaselineUsd;
  const clamped = diff > 0 ? diff : 0;
  return Math.round(clamped * 1_000_000) / 1_000_000;
}

function toNumericToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractUsage(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const message = record.message;
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const usage = (message as Record<string, unknown>).usage;
    if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
      return usage as Record<string, unknown>;
    }
  }

  const usage = record.usage;
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    return usage as Record<string, unknown>;
  }

  return undefined;
}

/**
 * Sum numeric `usage` tokens from a transcript JSONL, folding cache tokens into
 * the input total. Parses defensively (per-line try/catch; malformed lines
 * skipped). When `afterIso` is provided, only entries with a timestamp strictly
 * after it are counted; entries without a usable timestamp are skipped. Never
 * reads message text — only numeric usage fields and timestamps.
 */
export function parseTranscriptUsageTotals(input: {
  contents: string;
  afterIso?: string | undefined;
}): TranscriptUsageTotals {
  const afterMs = input.afterIso ? Date.parse(input.afterIso) : Number.NaN;
  const hasAfter = Number.isFinite(afterMs);

  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let turns = 0;

  for (const line of input.contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    if (hasAfter) {
      const timestamp = record.timestamp;
      if (typeof timestamp !== 'string') {
        continue;
      }
      const timestampMs = Date.parse(timestamp);
      if (!Number.isFinite(timestampMs) || timestampMs <= afterMs) {
        continue;
      }
    }

    const usage = extractUsage(record);
    if (!usage) {
      continue;
    }

    const inputForTurn = toNumericToken(usage.input_tokens);
    const cacheCreationForTurn = toNumericToken(usage.cache_creation_input_tokens);
    const cacheReadForTurn = toNumericToken(usage.cache_read_input_tokens);
    const outputForTurn = toNumericToken(usage.output_tokens);
    if (
      inputForTurn === 0 &&
      cacheCreationForTurn === 0 &&
      cacheReadForTurn === 0 &&
      outputForTurn === 0
    ) {
      continue;
    }

    inputTokens += inputForTurn;
    cacheCreationTokens += cacheCreationForTurn;
    cacheReadTokens += cacheReadForTurn;
    outputTokens += outputForTurn;
    turns += 1;
  }

  return { inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, turns };
}

/**
 * Locate the current session transcript: the newest-mtime `*.jsonl` under the
 * project transcript directory. Returns `undefined` when the directory is
 * missing or holds no transcript. Never throws.
 */
export function locateSessionTranscript(input: {
  dir: string;
  fs?: SessionUsageFileSystem | undefined;
}): string | undefined {
  const fs = input.fs ?? nodeFs;

  let names: string[];
  try {
    names = fs.readdirSync(input.dir);
  } catch {
    return undefined;
  }

  let best: string | undefined;
  let bestMtime = Number.NEGATIVE_INFINITY;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) {
      continue;
    }

    const full = path.join(input.dir, name);
    let mtime: number;
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }

    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = full;
    }
  }

  return best;
}

/**
 * Price a transcript's post-baseline usage via the core price table. Returns
 * `undefined` when no post-baseline turn carried usage or the model is unknown.
 */
export function computeTranscriptCostUsd(input: {
  contents: string;
  afterIso?: string | undefined;
  model: string;
}): number | undefined {
  const totals = parseTranscriptUsageTotals({
    contents: input.contents,
    ...(input.afterIso ? { afterIso: input.afterIso } : {}),
  });
  if (totals.turns === 0) {
    return undefined;
  }

  return computeActualCostUsd({
    model: input.model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
  });
}

/** Route-context fields consumed by the layered cost resolver. */
export interface CostResolutionRouteContext {
  costBaselineUsd?: number | undefined;
  sessionId?: string | undefined;
  baselineAt?: string | undefined;
  projectDirKey?: string | undefined;
}

/**
 * Resolve `actual_cost_usd` with layered, graceful fallback (first finite value
 * wins):
 *  1. Explicit operator override (`explicitActualCostUsd`).
 *  2. Explicit token counts priced via the core price table.
 *  3. Statusline sidecar diff: `currentCost - costBaselineUsd` when the current
 *     sidecar's session id matches the route baseline (clamped >= 0).
 *  4. Transcript best-effort: newest `*.jsonl` for the project, usage summed for
 *     turns after `baselineAt`, priced via the price table.
 *  5. Otherwise `undefined` — the row is submitted partial (telemetry-only).
 *
 * Tiers 3 and 4 only engage when the routeContext carries the corresponding
 * baseline (a sidecar cost, or a `baselineAt`), so a missing baseline never
 * triggers filesystem access or an unfiltered transcript sum. Never throws.
 */
export function resolveActualCostUsd(input: {
  explicitActualCostUsd?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  model: string;
  routeContext?: CostResolutionRouteContext | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homedir?: string | undefined;
  fs?: SessionUsageFileSystem | undefined;
}): number | undefined {
  // Tier 1: explicit operator override.
  if (
    typeof input.explicitActualCostUsd === 'number' &&
    Number.isFinite(input.explicitActualCostUsd)
  ) {
    return input.explicitActualCostUsd;
  }

  // Tier 2: explicit token counts.
  if (input.inputTokens !== undefined && input.outputTokens !== undefined) {
    const fromTokens = computeActualCostUsd({
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    });
    if (fromTokens !== undefined) {
      return fromTokens;
    }
  }

  const routeContext = input.routeContext;

  // Tier 3: statusline sidecar diff (only with a captured baseline cost).
  if (routeContext && typeof routeContext.costBaselineUsd === 'number') {
    try {
      const configDir = claudeConfigDirFrom(input);
      const sidecar = readSessionCostSidecar(
        sessionCostSidecarPath(configDir),
        input.fs ?? nodeFs,
      );
      const diff = resolveSidecarCostDiff({
        sidecar,
        baselineSessionId: routeContext.sessionId,
        costBaselineUsd: routeContext.costBaselineUsd,
      });
      if (diff !== undefined) {
        return diff;
      }
    } catch {
      // Defensive: fall through to the transcript tier.
    }
  }

  // Tier 4: transcript best-effort (requires a baseline timestamp to filter on).
  if (routeContext?.baselineAt) {
    try {
      const configDir = claudeConfigDirFrom(input);
      const dir = routeContext.projectDirKey
        ? path.join(configDir, 'projects', routeContext.projectDirKey)
        : sessionTranscriptDir(configDir, input.cwd ?? process.cwd());
      const transcriptPath = locateSessionTranscript({
        dir,
        ...(input.fs ? { fs: input.fs } : {}),
      });
      if (transcriptPath) {
        const contents = (input.fs ?? nodeFs).readFileSync(transcriptPath);
        const cost = computeTranscriptCostUsd({
          contents,
          model: input.model,
          afterIso: routeContext.baselineAt,
        });
        if (cost !== undefined) {
          return cost;
        }
      }
    } catch {
      // Defensive: fall through to omission.
    }
  }

  // Tier 5: nothing available — omit (partial row).
  return undefined;
}
