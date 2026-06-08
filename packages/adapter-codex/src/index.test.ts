import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
import { createCodexAdapter } from './index.js';

describe('createCodexAdapter', () => {
  it('returns a stable command surface', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });

    expect(adapter.harness).toBe('codex');
    expect(adapter.commands[0]?.name).toBe('hokusai:run');
    expect(adapter.manifest.pluginId).toBe('hokusai.codex');
  });

  it('creates a HokusaiClient by default', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });

    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('accepts a pre-built HokusaiClient', () => {
    const sharedClient = new HokusaiClient({ apiKey: 'sk-test' });
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
      client: sharedClient,
    });

    expect(adapter.client).toBe(sharedClient);
  });

  it('accepts clientOptions to construct the client', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
      clientOptions: { apiKey: 'sk-from-options' },
    });

    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('toTaskReference returns codex-prefixed reference', () => {
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
    });

    expect(adapter.toTaskReference({ id: 'task-7', prompt: 'test' })).toBe(
      'codex:task-7',
    );
  });

  it('shared client can call reportOutcome() in dry-run mode', async () => {
    const sharedClient = new HokusaiClient({ apiKey: 'sk-test', dryRun: true });
    const adapter = createCodexAdapter({
      defaultModel: 'gpt-5-codex',
      pluginId: 'hokusai.codex',
      client: sharedClient,
    });

    const descriptor = await adapter.client.reportOutcome({
      taskId: 'task-1',
      routingId: 'route-abc',
      status: 'completed',
      summary: 'done',
    });

    expect(descriptor).toMatchObject({ dryRun: true });
  });
});
