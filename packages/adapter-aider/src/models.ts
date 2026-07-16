import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  PRIORITY_MODELS,
  type ModelDefinition,
} from '@hokusai/core';

function dedupeById(pools: readonly ModelDefinition[][]): ModelDefinition[] {
  const seen = new Set<string>();
  const out: ModelDefinition[] = [];
  for (const pool of pools) {
    for (const model of pool) {
      const key = model.id.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(model);
    }
  }
  return out;
}

/**
 * Default candidate pool: every priced model from the shared launch-priority
 * catalog, plus every Anthropic and OpenAI model core exposes. Ids that appear
 * in more than one core list are kept once — the first spelling wins, so
 * `PRIORITY_MODELS` aliases take precedence.
 */
export const DEFAULT_AIDER_MODEL_POOL: readonly ModelDefinition[] = Object.freeze(
  dedupeById([PRIORITY_MODELS, ANTHROPIC_MODELS, OPENAI_MODELS]),
);

/**
 * A default model chosen from the built-in pool. Callers can override with
 * `--available-model` or an explicit override in the loop options.
 */
export const DEFAULT_AIDER_MODEL_ID = 'claude-sonnet-4-6';

function isKnownId(pool: readonly ModelDefinition[], id: string): boolean {
  const normalized = id.trim().toLowerCase();
  return pool.some(
    (model) =>
      model.id.trim().toLowerCase() === normalized ||
      (model.aliases ?? []).some(
        (alias) => alias.trim().toLowerCase() === normalized,
      ),
  );
}

/**
 * Turn a caller-supplied model id into an opaque `ModelDefinition` when it is
 * not already covered by the built-in pool. This lets Aider users hand-carry
 * ids like `openrouter/anthropic/claude-3.5-sonnet` or `openai/local-llama` to
 * a routing decision without teaching core about every provider.
 */
export function normalizeExtraModelId(id: string): ModelDefinition {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error('Cannot normalize an empty model id.');
  }
  return {
    id: trimmed,
    provider: providerFromId(trimmed),
    family: 'external',
    capabilities: ['tool-use'],
    available: true,
  };
}

function providerFromId(id: string): string {
  const slash = id.indexOf('/');
  if (slash <= 0) {
    return 'external';
  }
  const prefix = id.slice(0, slash).toLowerCase();
  return prefix.length > 0 ? prefix : 'external';
}

/**
 * Merge the built-in pool with any `--available-model` overrides, dedup'd by
 * canonical id. Every extra id becomes a permissive ModelDefinition so the
 * router can rank it and the mapping step can pass it back untouched.
 */
export function buildAiderCandidatePool(
  extraModelIds: string[] = [],
  basePool: readonly ModelDefinition[] = DEFAULT_AIDER_MODEL_POOL,
): ModelDefinition[] {
  const seen = new Set<string>();
  const combined: ModelDefinition[] = [];

  for (const model of basePool) {
    const key = model.id.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(model);
  }

  for (const raw of extraModelIds) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key) || isKnownId(basePool, trimmed)) {
      continue;
    }
    seen.add(key);
    combined.push(normalizeExtraModelId(trimmed));
  }

  return combined;
}
