import { describe, expect, it } from 'vitest';
import { TOOLS } from './mcp-server.js';

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
