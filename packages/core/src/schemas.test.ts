import { describe, expect, it } from 'vitest';
import { validateRouteResponse } from './schemas.js';

describe('validateRouteResponse', () => {
  it('accepts a recommendation with confidence and alternatives', () => {
    expect(
      validateRouteResponse({
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
        requestId: 'req-1',
        recommendation: {
          model: 'claude-sonnet-4-6',
          reason: 'Balanced for refactors.',
          confidence: 0.87,
          alternatives: [
            {
              model: 'claude-opus-4-8',
              reason: 'More depth for thorny debugging.',
              confidence: 0.63,
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('rejects invalid recommendation confidence and empty models', () => {
    expect(
      validateRouteResponse({
        routeId: 'route-1',
        taskId: 'task-1',
        status: 'accepted',
        recommendation: {
          model: '',
          confidence: 1.2,
          alternatives: [
            {
              model: '',
              confidence: -0.1,
            },
          ],
        },
      }),
    ).toEqual([
      {
        path: 'recommendation.model',
        message: 'Value must not be empty.',
        code: 'required',
      },
      {
        path: 'recommendation.confidence',
        message: 'Expected a number between 0 and 1.',
        code: 'invalid_value',
      },
      {
        path: 'recommendation.alternatives.0.model',
        message: 'Value must not be empty.',
        code: 'required',
      },
      {
        path: 'recommendation.alternatives.0.confidence',
        message: 'Expected a number between 0 and 1.',
        code: 'invalid_value',
      },
    ]);
  });
});
