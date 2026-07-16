/**
 * Parse the model/token/cost lines Aider prints so the wrapper can attach
 * `actual_cost_usd` and tokens to the Hokusai contribution row.
 *
 * The output format is documented informally in Aider's help output and can
 * change between releases. Every regex here is defensive and every extractor
 * returns `undefined` when its pattern does not match. Malformed or missing
 * cost data is the caller's cue to submit a telemetry-only row.
 */

// Strip CSI (Control Sequence Introducer) escapes: optional ESC, `[`, params,
// final byte. Constructed at runtime so the source file has no literal 0x1b.
const ANSI_CSI_RE = new RegExp(
  `${String.fromCharCode(0x1b)}?\\[[0-9;?]*[ -/]*[@-~]`,
  'g',
);

function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI_RE, '');
}

function parseTokenCount(raw: string): number | undefined {
  const trimmed = raw.trim().toLowerCase().replace(/,/g, '');
  if (!trimmed) {
    return undefined;
  }
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(trimmed);
  if (!match) {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const suffix = match[2];
  if (suffix === 'k') {
    return Math.round(value * 1_000);
  }
  if (suffix === 'm') {
    return Math.round(value * 1_000_000);
  }
  return Math.round(value);
}

export interface AiderTokenLine {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  messageCostUsd?: number;
  sessionCostUsd?: number;
}

// Captures the tokens payload up to the `. Cost:` boundary, or to the end of
// the line when no `Cost:` follows. The non-greedy `.+?` keeps the match tight
// so numeric periods inside `1.1k received` do not close the group early.
const TOKEN_LINE_RE = /Tokens:\s*(.+?)(?:\.\s+Cost:|\.?\s*$)/i;
const COST_LINE_RE = /Cost:\s*(.+?)\.?\s*$/i;

function parseTokenSegment(
  segment: string,
): {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
} {
  const parts = segment.split(/,\s+/).map((part) => part.trim());
  const result: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  } = {};
  for (const part of parts) {
    const match =
      /^([\d.,]+\s*[km]?)\s+(sent|received|cache\s+write|cache\s+read)$/i.exec(
        part,
      );
    if (!match) {
      continue;
    }
    const count = parseTokenCount(match[1] ?? '');
    if (count === undefined) {
      continue;
    }
    const label = (match[2] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (label === 'sent') {
      result.inputTokens = count;
    } else if (label === 'received') {
      result.outputTokens = count;
    } else if (label === 'cache write') {
      result.cacheWriteTokens = count;
    } else if (label === 'cache read') {
      result.cacheReadTokens = count;
    }
  }
  return result;
}

function parseCostSegment(segment: string): {
  messageCostUsd?: number;
  sessionCostUsd?: number;
} {
  const parts = segment.split(/,\s+/).map((part) => part.trim());
  const result: { messageCostUsd?: number; sessionCostUsd?: number } = {};
  for (const part of parts) {
    const match = /^\$([\d.]+)\s+(message|session)$/i.exec(part);
    if (!match) {
      continue;
    }
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) {
      continue;
    }
    const label = (match[2] ?? '').toLowerCase();
    if (label === 'message') {
      result.messageCostUsd = amount;
    } else if (label === 'session') {
      result.sessionCostUsd = amount;
    }
  }
  return result;
}

/**
 * Parse a single Aider output line of the shape
 *   `Tokens: 14k sent, 1.1k received. Cost: $0.06 message, $0.21 session.`
 * Returns `undefined` when neither `Tokens:` nor `Cost:` is present. Callers
 * that see multiple lines should keep the last one whose `sessionCostUsd` is
 * defined — Aider's session cost is cumulative.
 */
export function parseAiderTokenLine(line: string): AiderTokenLine | undefined {
  const clean = stripAnsi(line);
  const tokenMatch = TOKEN_LINE_RE.exec(clean);
  const costMatch = COST_LINE_RE.exec(clean);
  if (!tokenMatch && !costMatch) {
    return undefined;
  }
  const tokens = tokenMatch ? parseTokenSegment(tokenMatch[1] ?? '') : {};
  const costs = costMatch ? parseCostSegment(costMatch[1] ?? '') : {};
  const merged: AiderTokenLine = { ...tokens, ...costs };
  if (Object.keys(merged).length === 0) {
    return undefined;
  }
  return merged;
}

const MODEL_LINE_RE =
  /^\s*(?:Main model|Model):\s*(\S+)(?:\s+with\s+[^\s].*)?$/i;

/**
 * Parse the model banner Aider prints at startup, e.g.
 *   `Main model: openai/gpt-4o with diff edit format`
 * or `Model: gemini/gemini-2.5-pro-exp-03-25 with diff-fenced edit format`.
 */
export function parseAiderModelLine(line: string): string | undefined {
  const clean = stripAnsi(line);
  const match = MODEL_LINE_RE.exec(clean);
  if (!match) {
    return undefined;
  }
  const model = (match[1] ?? '').trim();
  return model.length > 0 ? model : undefined;
}

export interface AiderAccountingSummary {
  /** Last non-empty `Model:` / `Main model:` id seen in the output. */
  reportedModel?: string;
  /** Sum of every parsed `sent` token count on `Tokens:` lines. */
  inputTokens?: number;
  /** Sum of every parsed `received` token count on `Tokens:` lines. */
  outputTokens?: number;
  /** Sum of every parsed `cache write` count. Diagnostic only. */
  cacheWriteTokens?: number;
  /** Sum of every parsed `cache read` count. Diagnostic only. */
  cacheReadTokens?: number;
  /** Most recent session-cost figure Aider printed, treated as authoritative. */
  sessionCostUsd?: number;
}

/**
 * Fold every parseable line in a captured Aider transcript into one summary.
 * Token counts are summed across all message lines because Aider prints one
 * per message; session cost is cumulative so the *last* value is kept.
 */
export function summarizeAiderOutput(
  output: string,
): AiderAccountingSummary {
  const summary: AiderAccountingSummary = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const model = parseAiderModelLine(line);
    if (model) {
      summary.reportedModel = model;
    }
    const parsed = parseAiderTokenLine(line);
    if (!parsed) {
      continue;
    }
    if (parsed.inputTokens !== undefined) {
      summary.inputTokens =
        (summary.inputTokens ?? 0) + parsed.inputTokens;
    }
    if (parsed.outputTokens !== undefined) {
      summary.outputTokens =
        (summary.outputTokens ?? 0) + parsed.outputTokens;
    }
    if (parsed.cacheWriteTokens !== undefined) {
      summary.cacheWriteTokens =
        (summary.cacheWriteTokens ?? 0) + parsed.cacheWriteTokens;
    }
    if (parsed.cacheReadTokens !== undefined) {
      summary.cacheReadTokens =
        (summary.cacheReadTokens ?? 0) + parsed.cacheReadTokens;
    }
    if (parsed.sessionCostUsd !== undefined) {
      summary.sessionCostUsd = parsed.sessionCostUsd;
    }
  }
  return summary;
}
