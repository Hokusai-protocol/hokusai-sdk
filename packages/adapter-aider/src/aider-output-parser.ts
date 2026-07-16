export interface AiderUsageTelemetry {
  model?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheCreationTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  actualCostUsd?: number | undefined;
  diagnostics: string[];
}

const MODEL_PATTERNS = [
  /^Model:\s*(.+)$/im,
  /^Main model:\s*(.+)$/im,
  /^Using model:\s*(.+)$/im,
  /^litellm(?:[_ ]model)?\s*[:=]\s*(.+)$/im,
] as const;

const LABEL_PATTERNS = {
  inputTokens: [
    /^Input tokens:\s*([0-9][0-9,]*)$/im,
    /^prompt_tokens\s*[:=]\s*([0-9][0-9,]*)$/im,
  ],
  outputTokens: [
    /^Output tokens:\s*([0-9][0-9,]*)$/im,
    /^completion_tokens\s*[:=]\s*([0-9][0-9,]*)$/im,
  ],
  cacheCreationTokens: [
    /^Cache creation tokens:\s*([0-9][0-9,]*)$/im,
    /^cache_creation_input_tokens\s*[:=]\s*([0-9][0-9,]*)$/im,
  ],
  cacheReadTokens: [
    /^Cache read tokens:\s*([0-9][0-9,]*)$/im,
    /^cache_read_input_tokens\s*[:=]\s*([0-9][0-9,]*)$/im,
  ],
  actualCostUsd: [
    /^Cost:\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)$/im,
    /^Total cost:\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)$/im,
    /^Model cost:\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)$/im,
  ],
} as const;

const SUMMARY_PATTERNS = [
  /^Tokens:\s*input\s+([0-9][0-9,]*)\s+output\s+([0-9][0-9,]*)(?:\s+cache write\s+([0-9][0-9,]*))?(?:\s+cache read\s+([0-9][0-9,]*))?$/im,
  /^Usage:\s*prompt_tokens=([0-9][0-9,]*)\s+completion_tokens=([0-9][0-9,]*)(?:\s+cache_creation_input_tokens=([0-9][0-9,]*))?(?:\s+cache_read_input_tokens=([0-9][0-9,]*))?(?:\s+cost(?:_usd)?=\$?([0-9][0-9,]*(?:\.[0-9]+)?))?$/im,
] as const;

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replaceAll(',', '').trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  return Number.parseInt(normalized, 10);
}

function parseDecimal(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replaceAll(',', '').trim().replace(/^\$/, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseModel(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseAiderOutput(output: string): AiderUsageTelemetry {
  const telemetry: AiderUsageTelemetry = {
    diagnostics: [],
  };

  for (const pattern of MODEL_PATTERNS) {
    const match = pattern.exec(output);
    if (match?.[1]) {
      telemetry.model = parseModel(match[1]);
      break;
    }
  }

  for (const pattern of SUMMARY_PATTERNS) {
    const match = pattern.exec(output);
    if (!match) {
      continue;
    }

    telemetry.inputTokens ??= parseInteger(match[1]);
    telemetry.outputTokens ??= parseInteger(match[2]);
    telemetry.cacheCreationTokens ??= parseInteger(match[3]);
    telemetry.cacheReadTokens ??= parseInteger(match[4]);
    telemetry.actualCostUsd ??= parseDecimal(match[5]);
  }

  for (const pattern of LABEL_PATTERNS.inputTokens) {
    const match = pattern.exec(output);
    telemetry.inputTokens ??= parseInteger(match?.[1]);
  }

  for (const pattern of LABEL_PATTERNS.outputTokens) {
    const match = pattern.exec(output);
    telemetry.outputTokens ??= parseInteger(match?.[1]);
  }

  for (const pattern of LABEL_PATTERNS.cacheCreationTokens) {
    const match = pattern.exec(output);
    telemetry.cacheCreationTokens ??= parseInteger(match?.[1]);
  }

  for (const pattern of LABEL_PATTERNS.cacheReadTokens) {
    const match = pattern.exec(output);
    telemetry.cacheReadTokens ??= parseInteger(match?.[1]);
  }

  for (const pattern of LABEL_PATTERNS.actualCostUsd) {
    const match = pattern.exec(output);
    telemetry.actualCostUsd ??= parseDecimal(match?.[1]);
  }

  if (!telemetry.model) {
    telemetry.diagnostics.push('Aider did not report a model in its summary output.');
  }
  if (
    telemetry.inputTokens === undefined &&
    telemetry.outputTokens === undefined
  ) {
    telemetry.diagnostics.push('Aider did not report token usage in its summary output.');
  }
  if (telemetry.actualCostUsd === undefined) {
    telemetry.diagnostics.push('Aider did not report measured cost in its summary output.');
  }

  return telemetry;
}
