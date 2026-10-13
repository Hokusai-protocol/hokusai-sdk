// A deterministic, scripted "harness" for the offline examples: it emits
// usage events exactly like a real harness would, but makes no LLM calls and
// needs no network, credentials, or environment. Payload shapes come from the
// two provider APIs via the exported mappers.
import { EventEmitter } from 'node:events';
import { fromAnthropicUsage, fromOpenAIUsage } from '@hokusai/costs';

export function createFakeHarness() {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    /** "Run the task": emit a multi-model usage script, then return. */
    async run() {
      // Turn 1 — a Claude call, Anthropic-shaped usage with cache tokens.
      emitter.emit('usage', {
        model: 'claude-sonnet-5',
        eventId: 'turn-0001',
        usage: fromAnthropicUsage({
          input_tokens: 12_000,
          output_tokens: 1_800,
          cache_read_input_tokens: 2_000,
          cache_creation_input_tokens: 500,
        }),
      });
      await Promise.resolve();
      // Turn 2 — a GPT call, OpenAI-shaped usage.
      emitter.emit('usage', {
        model: 'gpt-5',
        eventId: 'turn-0002',
        usage: fromOpenAIUsage({
          prompt_tokens: 9_000,
          completion_tokens: 1_200,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 300 },
        }),
      });
      // A retry re-emits turn-0001 with the same event id: replay dedupe
      // counts it once (see the duplicate_event diagnostic in the report).
      emitter.emit('usage', {
        model: 'claude-sonnet-5',
        eventId: 'turn-0001',
        usage: fromAnthropicUsage({ input_tokens: 12_000, output_tokens: 1_800 }),
      });
      return 42;
    },
  };
}
