import { describe, expect, it } from 'vitest';
import {
  ConsentRequiredError,
  assertCanRoute,
  assertCanSubmitOutcome,
  canReportOutcome,
  canRoute,
  canRouteWithAuth,
  canSubmitOutcomeWithAuth,
  resolveConsent,
} from './consent.js';

describe('consent helpers', () => {
  it('defaults routing to enabled and outcome reporting to disabled', () => {
    expect(resolveConsent({})).toEqual({
      routingEnabled: true,
      outcomeReportingEnabled: false,
    });
  });

  it('keeps routing enabled for older callers that pass routingEnabled=false', () => {
    expect(resolveConsent({ routingEnabled: false })).toEqual({
      routingEnabled: true,
      outcomeReportingEnabled: false,
    });
  });

  it('preserves outcome consent independently', () => {
    expect(resolveConsent({ outcomeReportingEnabled: true })).toEqual({
      routingEnabled: true,
      outcomeReportingEnabled: true,
    });
  });

  it('does not gate routing on consent settings', () => {
    expect(
      canRoute({
        routingEnabled: true,
        outcomeReportingEnabled: false,
      }),
    ).toBe(true);
    expect(
      canRoute({
        routingEnabled: false,
        outcomeReportingEnabled: true,
      }),
    ).toBe(true);
    expect(
      canReportOutcome({
        routingEnabled: false,
        outcomeReportingEnabled: true,
      }),
    ).toBe(true);
  });

  it('handles undefined consent input', () => {
    expect(resolveConsent(undefined)).toEqual({
      routingEnabled: true,
      outcomeReportingEnabled: false,
    });
  });

  it('evaluates route auth without routing consent', () => {
    expect(
      canRouteWithAuth({
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
      }),
    ).toBe(false);
    expect(
      canRouteWithAuth({
        apiKey: 'hk_live',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
      }),
    ).toBe(true);
  });

  it('evaluates outcome auth and outcome opt-in together', () => {
    expect(
      canSubmitOutcomeWithAuth({
        apiKey: 'hk_live',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: true,
      }),
    ).toBe(true);
    expect(
      canSubmitOutcomeWithAuth({
        apiKey: 'hk_live',
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
      }),
    ).toBe(false);
    expect(
      canSubmitOutcomeWithAuth({
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: true,
      }),
    ).toBe(false);
  });

  it('throws structured consent errors without leaking the API key', () => {
    expect.assertions(5);

    try {
      assertCanRoute({
        routingConsentEnabled: true,
        outcomeSubmissionEnabled: false,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConsentRequiredError);
      expect((error as ConsentRequiredError).scope).toBe('routing');
      expect((error as ConsentRequiredError).reason).toBe('no-auth');
      expect((error as Error).message).not.toContain('hk_live_secret');
    }

    expect(() =>
      assertCanSubmitOutcome({
        apiKey: 'hk_live_secret',
        routingConsentEnabled: false,
        outcomeSubmissionEnabled: false,
      }),
    ).toThrowError(ConsentRequiredError);
  });
});
