import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('core public surface', () => {
  it('exposes the expected entry points', () => {
    expect(core.HokusaiClient).toBeDefined();
    expect(core.InMemoryCorrelationStorage).toBeDefined();
    expect(core.InMemoryModelRegistry).toBeDefined();
    expect(core.anonymizeText).toBeDefined();
  });
});
