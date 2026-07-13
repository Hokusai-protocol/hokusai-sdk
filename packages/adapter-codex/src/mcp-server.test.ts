import { describe, expect, it } from 'vitest';
import { HokusaiApiError } from '@hokusai/core';
import { TOOLS, describeUnhandledError } from './mcp-server.js';

describe('mcp server', () => {
  it('lists the expected tools', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'hokusai_route',
      'hokusai_preview_route_payload',
      'hokusai_submit_outcome',
      'hokusai_latest_route',
      'hokusai_privacy_status',
      'hokusai_prompt_outcome_contribution',
    ]);
  });
});

/**
 * `executeRouteCommand` rethrows every HokusaiApiError. Before these mappings
 * existed the server logged the throw to stderr and answered nothing, so a
 * rejected API key presented as a 300-second hang in Codex with no diagnostic.
 */
describe('describeUnhandledError', () => {
  it('reports a rejected API key as such, not as an internal error', () => {
    const failure = describeUnhandledError(
      new HokusaiApiError('Hokusai API request failed with status 401.', {
        requestId: 'req-1',
        status: 401,
      }),
    );

    expect(failure.code).toBe('E_INVALID_API_KEY');
    expect(failure.message).toContain('401');
    expect(failure.remediation).toMatch(/invalid or expired/i);
  });

  it('surfaces the request id for other API failures', () => {
    const failure = describeUnhandledError(
      new HokusaiApiError('Hokusai API request failed with status 503.', {
        requestId: 'req-2',
        status: 503,
      }),
    );

    expect(failure.code).toBe('E_API');
    expect(failure.remediation).toContain('req-2');
  });

  it('falls back to an internal error for anything else', () => {
    const failure = describeUnhandledError(new Error('socket hang up'));

    expect(failure.code).toBe('E_INTERNAL');
    expect(failure.message).toBe('socket hang up');
  });
});
