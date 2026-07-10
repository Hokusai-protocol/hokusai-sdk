import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  latestRouteWithCodex,
  previewOutcomeWithCodex,
  previewRoutePayloadWithCodex,
  privacyStatusWithCodex,
  promptOutcomeContributionWithCodex,
  routeTaskWithCodex,
  submitOutcomeWithCodex,
} from './plugin-commands.js';

const tempDirs: string[] = [];

async function createEnv(extra: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hokusai-codex-plugin-'));
  tempDirs.push(dir);
  return {
    HOKUSAI_CONFIG_DIR: dir,
    ...extra,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('previewRoutePayloadWithCodex', () => {
  it('previews without consent or network', async () => {
    const env = await createEnv();
    const transport = vi.fn();

    const result = await previewRoutePayloadWithCodex(
      { task: 'Inspect the failing CI workflow.' },
      { env, transport },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.payload.task.prompt).toContain(
      'Inspect the failing CI workflow.',
    );
    expect(JSON.parse(result.value.payload.task.prompt)).toMatchObject({
      providerConstraints: ['openai'],
      modelConstraints: ['gpt-5-codex', 'gpt-5', 'gpt-5-mini'],
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('narrows preview constraints to the Codex allowlist', async () => {
    const env = await createEnv({
      HOKUSAI_MODEL_ALLOWLIST: 'gpt-5, claude-sonnet-4-6',
    });

    const result = await previewRoutePayloadWithCodex(
      { task: 'Inspect the failing CI workflow.' },
      { env },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(JSON.parse(result.value.payload.task.prompt)).toMatchObject({
      providerConstraints: ['openai'],
      modelConstraints: ['gpt-5'],
    });
  });
});

describe('routeTaskWithCodex', () => {
  it('fails with a structured missing-key error before network', async () => {
    const env = await createEnv({});
    const transport = vi.fn();

    const result = await routeTaskWithCodex(
      { task: 'Route this task.' },
      { env, transport },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'E_MISSING_API_KEY',
        message: 'HOKUSAI_API_KEY is not configured.',
        remediation: 'Set HOKUSAI_API_KEY in the environment before routing.',
      },
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('succeeds when primary is openai but alternatives include non-openai providers', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
    });

    const result = await routeTaskWithCodex(
      { task: 'Route with mixed alternatives.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-mixed',
                  taskId: 'task-mixed',
                  status: 'accepted',
                  recommendation: {
                    model: 'gpt-5-codex',
                    reason: 'Primary is OpenAI.',
                    confidence: 0.9,
                    alternatives: [
                      {
                        model: 'claude-sonnet-4-6',
                        reason: 'Non-OpenAI alternative.',
                      },
                      { model: 'gpt-5', reason: 'Also valid.' },
                    ],
                  },
                }),
              ),
          }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.recommendation.model.provider).toBe('openai');
    const altIds =
      result.value.recommendation.alternatives?.map((a) => a.model.id) ?? [];
    expect(altIds).not.toContain('claude-sonnet-4-6');
    expect(altIds).toContain('gpt-5');
  });

  it('stores the latest route and rejects non-openai recommendations', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
    });

    const success = await routeTaskWithCodex(
      { task: 'Refactor the router and add tests.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-1',
                  taskId: 'task-1',
                  status: 'accepted',
                  recommendation: {
                    model: 'gpt-5-codex',
                    reason: 'Best fit.',
                    confidence: 0.93,
                    alternatives: [{ model: 'gpt-5' }, { model: 'gpt-5-mini' }],
                  },
                }),
              ),
          }),
      },
    );

    expect(success.ok).toBe(true);
    if (!success.ok) {
      return;
    }
    expect(success.value.recommendation.model.provider).toBe('openai');

    const latest = await latestRouteWithCodex({ env });
    expect(latest.ok).toBe(true);
    if (!latest.ok) {
      return;
    }
    expect(latest.value.recommendedModel).toBe('gpt-5-codex');
    expect(latest.value.alternatives).toEqual(['gpt-5', 'gpt-5-mini']);

    const rejected = await routeTaskWithCodex(
      { task: 'Route this task again.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-2',
                  taskId: 'task-2',
                  status: 'accepted',
                  recommendation: {
                    model: 'claude-sonnet-4-6',
                    reason: 'Wrong provider.',
                    confidence: 0.1,
                  },
                }),
              ),
          }),
      },
    );

    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.error.code).toBe('E_UNSUPPORTED_MODEL');
  });

  it('sends only allowlisted OpenAI models to the router', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
      HOKUSAI_MODEL_ALLOWLIST: 'gpt-5, gpt-5-mini, claude-sonnet-4-6',
    });
    let capturedPrompt = '';

    const result = await routeTaskWithCodex(
      { task: 'Route this task again.' },
      {
        env,
        transport: (_url, init) => {
          capturedPrompt = init?.body ? String(init.body) : '';

          return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-allowlist',
                  taskId: 'task-allowlist',
                  status: 'accepted',
                }),
              ),
          });
        },
      },
    );

    expect(result.ok).toBe(true);
    const request = JSON.parse(capturedPrompt) as {
      inputs: Record<string, unknown>;
    };

    expect(request.inputs).toMatchObject({
      routing: {
        available_models: ['gpt-5', 'gpt-5-mini'],
      },
      task: {
        task_type: 'maintenance',
      },
    });
    // The non-OpenAI allowlist entry is filtered out by provider.
    expect(
      (request.inputs.routing as { available_models: string[] })
        .available_models,
    ).not.toContain('claude-sonnet-4-6');
  });
});

describe('submitOutcomeWithCodex', () => {
  it('previews first and requires explicit approval plus opt-in to send', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
    });

    const routed = await routeTaskWithCodex(
      { task: 'Fix the flaky test.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-3',
                  taskId: 'task-3',
                  status: 'accepted',
                  recommendation: {
                    model: 'gpt-5-codex',
                    reason: 'Best fit.',
                    confidence: 0.92,
                  },
                }),
              ),
          }),
      },
    );
    expect(routed.ok).toBe(true);

    const preview = await previewOutcomeWithCodex(
      {
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      { env },
    );
    expect(preview.ok).toBe(true);

    const notApproved = await submitOutcomeWithCodex(
      {
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
      },
      { env },
    );
    expect(notApproved.ok).toBe(true);
    if (!notApproved.ok) {
      return;
    }
    expect(notApproved.value.submitted).toBe(false);

    const missingOptIn = await submitOutcomeWithCodex(
      {
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
        approve: true,
      },
      { env },
    );
    expect(missingOptIn.ok).toBe(false);
    if (missingOptIn.ok) {
      return;
    }
    expect(missingOptIn.error.code).toBe('E_MISSING_CONSENT');
  });
});

describe('promptOutcomeContributionWithCodex', () => {
  it('builds a consent-gated report prompt from the latest route', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
      HOKUSAI_OUTCOME_OPT_IN: 'true',
    });

    const routed = await routeTaskWithCodex(
      { task: 'Fix the flaky test.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-prompt',
                  taskId: 'task-prompt',
                  status: 'accepted',
                  recommendation: {
                    model: 'gpt-5-codex',
                    reason: 'Best fit.',
                  },
                }),
              ),
          }),
      },
    );
    expect(routed.ok).toBe(true);

    const prompt = await promptOutcomeContributionWithCodex(
      {
        event: {
          status: 'success',
          transcript: 'All tests passed.',
        },
      },
      { env },
    );

    expect(prompt.ok).toBe(true);
    if (!prompt.ok) {
      return;
    }
    expect(prompt.value).toMatchObject({
      shouldPrompt: true,
      status: 'ready',
      reportCommand:
        '$hokusai-report --use-latest --recommended-model gpt-5-codex --actual-model gpt-5-codex --accepted --status succeeded --latency-bucket medium --cost-bucket medium --token-bucket medium --test-status passed',
    });
  });

  it('does not provide a report command without outcome opt-in', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
    });
    await routeTaskWithCodex(
      { task: 'Fix the flaky test.' },
      {
        env,
        transport: () =>
          Promise.resolve({
            status: 200,
            headers: { get: () => null },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  routeId: 'route-no-opt-in',
                  taskId: 'task-no-opt-in',
                  status: 'accepted',
                  recommendation: {
                    model: 'gpt-5-codex',
                    reason: 'Best fit.',
                  },
                }),
              ),
          }),
      },
    );

    const prompt = await promptOutcomeContributionWithCodex(
      { event: { status: 'success' } },
      { env },
    );

    expect(prompt.ok).toBe(true);
    if (!prompt.ok) {
      return;
    }
    expect(prompt.value).toMatchObject({
      shouldPrompt: true,
      status: 'needs_outcome_opt_in',
    });
    expect(prompt.value).not.toHaveProperty('reportCommand');
  });
});

describe('privacyStatusWithCodex', () => {
  it('returns storage and doctor status', async () => {
    const env = await createEnv({
      HOKUSAI_API_KEY: 'hk_test',
    });

    const result = await privacyStatusWithCodex({ env });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.apiKeyConfigured).toBe(true);
    expect(result.value.routingConsentGranted).toBe(true);
    expect(result.value.doctor.status).toBe('action_required');
  });
});
