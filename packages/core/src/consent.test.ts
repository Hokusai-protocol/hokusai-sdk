import { describe, expect, it } from 'vitest';
import {
  canReportOutcome,
  canRoute,
  resolveConsent,
} from './consent.js';

describe('consent helpers', () => {
  it('defaults both consent flags to false', () => {
    expect(resolveConsent({})).toEqual({
      routingEnabled: false,
      outcomeReportingEnabled: false,
    });
  });

  it('preserves routing consent independently', () => {
    expect(resolveConsent({ routingEnabled: true })).toEqual({
      routingEnabled: true,
      outcomeReportingEnabled: false,
    });
  });

  it('preserves outcome consent independently', () => {
    expect(resolveConsent({ outcomeReportingEnabled: true })).toEqual({
      routingEnabled: false,
      outcomeReportingEnabled: true,
    });
  });

  it('reads routing and outcome consent independently', () => {
    expect(
      canRoute({
        routingEnabled: true,
        outcomeReportingEnabled: false,
      }),
    ).toBe(true);
    expect(
      canReportOutcome({
        routingEnabled: true,
        outcomeReportingEnabled: false,
      }),
    ).toBe(false);
    expect(
      canRoute({
        routingEnabled: false,
        outcomeReportingEnabled: true,
      }),
    ).toBe(false);
    expect(
      canReportOutcome({
        routingEnabled: false,
        outcomeReportingEnabled: true,
      }),
    ).toBe(true);
  });

  it('handles undefined consent input', () => {
    expect(resolveConsent(undefined)).toEqual({
      routingEnabled: false,
      outcomeReportingEnabled: false,
    });
  });
});
