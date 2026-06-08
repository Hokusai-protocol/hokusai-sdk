import { describe, expect, it } from 'vitest';
import { HokusaiClient, HokusaiClientError } from './client.js';
import { InMemoryModelRegistry } from './model-registry.js';
import { InMemoryCorrelationStorage } from './storage.js';

describe('HokusaiClient', () => {
  it('builds an offline dispatch payload with deterministic redactions', async () => {
    const client = new HokusaiClient({
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'gpt-5-codex',
          provider: 'openai',
          family: 'gpt-5',
          capabilities: ['reasoning', 'tool-use'],
          default: true,
        },
      ]),
      storage: new InMemoryCorrelationStorage(),
      clock: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    const payload = await client.prepareDispatch(
      {
        id: 'task-1',
        prompt: 'Email alice@example.com before using sk-12345678',
        metadata: {
          repo: 'hokusai-sdk',
        },
      },
      'gpt-5-codex',
    );

    expect(payload.prompt).toContain('<redacted:email>');
    expect(payload.prompt).toContain('<redacted:token>');
    expect(payload.redactions).toHaveLength(2);
    expect(payload.correlation.correlationId).toBe(
      'task-1:2026-01-02T03:04:05.000Z',
    );
  });

  it('rejects dispatches for missing consent', async () => {
    const client = new HokusaiClient({
      consent: {
        subjectId: 'user-123',
        grantedScopes: [],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'gpt-5-codex',
          provider: 'openai',
          family: 'gpt-5',
          capabilities: ['reasoning'],
        },
      ]),
    });

    await expect(
      client.prepareDispatch(
        {
          id: 'task-2',
          prompt: 'No consent',
        },
        'gpt-5-codex',
      ),
    ).rejects.toBeInstanceOf(HokusaiClientError);
  });
});
