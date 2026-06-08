import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('core public surface', () => {
  it('exposes the expected entry points', () => {
    expect(core.HokusaiClient).toBeDefined();
    expect(core.InMemoryCorrelationStorage).toBeDefined();
    expect(core.InMemoryModelRegistry).toBeDefined();
    expect(core.anonymizeText).toBeDefined();
  });

  it('exposes error classes', () => {
    expect(core.HokusaiClientError).toBeDefined();
    expect(core.HokusaiError).toBeDefined();
    expect(core.HokusaiAuthError).toBeDefined();
    expect(core.HokusaiValidationError).toBeDefined();
    expect(core.HokusaiNetworkError).toBeDefined();
    expect(core.HokusaiApiError).toBeDefined();
  });

  it('exposes schema validators', () => {
    expect(core.validateRouteRequest).toBeDefined();
    expect(core.validateRouteResponse).toBeDefined();
    expect(core.validateOutcomeRequest).toBeDefined();
    expect(core.validateOutcomeResponse).toBeDefined();
  });

  it('exposes SDK version constant', () => {
    expect(core.SDK_VERSION).toBeTruthy();
    expect(typeof core.SDK_VERSION).toBe('string');
  });
});
