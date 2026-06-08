import { describe, expect, it } from 'vitest';
import { createReferenceHarness } from './index.js';

describe('createReferenceHarness', () => {
  it('composes core and adapter contracts without harness state', async () => {
    const harness = createReferenceHarness();
    const result = await harness.prepare('Summarize HOK-2104');

    expect(result.adapter.manifest.pluginId).toBe('hokusai.codex');
    expect(result.payload.task.id).toBe('reference-task');
    expect(result.payload.model.id).toBe('gpt-5-codex');
  });
});
