/**
 * An offline stand-in for the Hokusai API, so the reference flow runs with no
 * API key and no network.
 *
 * **This file simulates the server, not the harness.** The fidelity
 * classification below mirrors the rules in the API's
 * `contribution_fidelity.py` so the printed tier matches what production would
 * return. Do not copy this into your harness: the classification is
 * server-authoritative, and a client-side copy would silently drift. Your
 * harness should read `response.rowFidelityTiers`, never compute it.
 *
 * @module mock-client
 */

import {
  ContributionValidationError,
  validateContributionRow,
  type ContributionAcceptedResponse,
  type ContributionRequest,
  type HarnessOutcomeRowV1,
  type RouteRequest,
  type RouteResponse,
} from '@hokusai/core';

export const MOCK_INFERENCE_LOG_ID = '73c19164-7194-48b1-a62e-7314bcf3ebd5';

export interface MockHokusaiClient {
  route(request: RouteRequest): Promise<RouteResponse>;
  submitContribution(request: ContributionRequest): Promise<ContributionAcceptedResponse>;
}

/**
 * Mirrors `classify_row` in the API. A row is training-eligible only when
 * success-under-budget is computable, which needs both a numeric budget and a
 * numeric actual cost.
 */
function classifyRow(row: HarnessOutcomeRowV1): string {
  const hasModels =
    Array.isArray(row.allowed_models) &&
    row.allowed_models.length > 0 &&
    Boolean(row.selected_models?.coder ?? row.selected_models?.reviewer);
  if (!hasModels) {
    return 'invalid';
  }

  const hasBudget = typeof row.budget_usd === 'number';
  const hasCost = typeof row.actual_cost_usd === 'number';
  return hasBudget && hasCost ? 'training_eligible' : 'partial';
}

export function createMockHokusaiClient(): MockHokusaiClient {
  return {
    route(request: RouteRequest): Promise<RouteResponse> {
      return Promise.resolve({
        // The real API returns its persisted inference_log_id here. Threading
        // it into the contribution row is what makes the row attributable.
        routeId: MOCK_INFERENCE_LOG_ID,
        taskId: request.task.id,
        status: 'accepted',
        recommendation: {
          model: 'claude-sonnet-4-6',
          reason: 'Estimated highest-reliability strategy for this task descriptor.',
          confidence: 0.79,
        },
      });
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async submitContribution(
      request: ContributionRequest,
    ): Promise<ContributionAcceptedResponse> {
      // Mirrors the API's two distinct failure modes:
      //   - a forbidden field (raw prompt text) rejects the whole batch, loudly
      //   - a row that does not match the schema is classified `invalid`
      // A fork that leaks prompt text therefore fails here, offline, rather
      // than at the network boundary in production.
      const tiers = request.rows.map((row) => {
        try {
          validateContributionRow(row);
        } catch (error: unknown) {
          if (
            error instanceof ContributionValidationError &&
            error.code === 'forbidden_field'
          ) {
            throw error;
          }

          return 'invalid';
        }

        return classifyRow(row);
      });

      const accepted = tiers.filter((tier) => tier !== 'invalid');
      const count = (tier: string): number =>
        tiers.filter((entry) => entry === tier).length;

      return {
        accepted: accepted.length > 0,
        submissionId: request.metadata.idempotency_key,
        rowsAccepted: accepted.length,
        submittedRows: request.rows.length,
        tokenReward: 0,
        rowFidelityTiers: accepted,
        fidelitySummary: {
          training_eligible: count('training_eligible'),
          partial: count('partial'),
          passthrough: count('passthrough'),
          invalid: count('invalid'),
        },
        rejectedRows: tiers.flatMap((tier, index) =>
          tier === 'invalid'
            ? [{ index, reason: 'missing route identity or model selection' }]
            : [],
        ),
      };
    },
  };
}
