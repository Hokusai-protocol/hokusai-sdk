import { describe, expect, it } from 'vitest';
import { HokusaiClient } from '@hokusai/core';
import { createClaudeCodeAdapter } from './index.js';

describe('createClaudeCodeAdapter', () => {
  it('returns stable manifest and command metadata', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.harness).toBe('claude-code');
    expect(adapter.commands[0]?.name).toBe('hokusai.run');
    expect(adapter.manifest.entrypoint).toBe('hokusai');
  });

  it('creates a HokusaiClient by default', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('accepts a pre-built HokusaiClient', () => {
    const sharedClient = new HokusaiClient({ apiKey: 'sk-test' });
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
      client: sharedClient,
    });

    expect(adapter.client).toBe(sharedClient);
  });

  it('accepts clientOptions to construct the client', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
      clientOptions: { apiKey: 'sk-from-options' },
    });

    expect(adapter.client).toBeInstanceOf(HokusaiClient);
  });

  it('toTaskReference returns claude-code-prefixed reference', () => {
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.toTaskReference({ id: 'task-42', prompt: 'hello' })).toBe(
      'claude-code:task-42',
    );
  });

  it('shared client can call route() in dry-run mode', async () => {
    const sharedClient = new HokusaiClient({ apiKey: 'sk-test', dryRun: true });
    const adapter = createClaudeCodeAdapter({
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
      client: sharedClient,
    });

    const descriptor = await adapter.client.route({
      taskId: 'task-1',
      prompt: 'hello',
    });

    expect(descriptor).toMatchObject({ dryRun: true });
  });
});
