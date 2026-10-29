import { describe, expect, it } from 'vitest';
import { CAUSE_CODES, EXCLUSION_CODES, HUMAN_EXCLUSION_CODES } from './index.js';

describe('calibration label taxonomy', () => {
  it('reuses the shared human exclusion codes rather than defining its own', () => {
    expect([...HUMAN_EXCLUSION_CODES]).toEqual(EXCLUSION_CODES.slice(0, HUMAN_EXCLUSION_CODES.length));
  });

  it('keeps both escapes and leaves stale_context out', () => {
    expect(CAUSE_CODES).toContain('not_rework');
    expect(CAUSE_CODES).toContain('unclear');
    expect(CAUSE_CODES).not.toContain('stale_context');
  });
});
