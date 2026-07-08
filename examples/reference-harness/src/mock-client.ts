import type {
  HokusaiClient,
  OutcomeReport,
  OutcomeResponse,
  RouteRequest,
  RouteResponse,
} from '@hokusai/core';

export interface MockHokusaiClient
  extends Pick<HokusaiClient, 'route' | 'reportOutcome'> {
  route(request: RouteRequest): Promise<RouteResponse>;
  reportOutcome(report: OutcomeReport): Promise<OutcomeResponse>;
}

export function createMockHokusaiClient(): Pick<
  HokusaiClient,
  'route' | 'reportOutcome'
> & MockHokusaiClient {
  return {
    route(request: RouteRequest): Promise<RouteResponse> {
      return Promise.resolve({
        routeId: 'mock-decision-0001',
        taskId: request.task.id,
        status: 'accepted',
      });
    },
    reportOutcome(report: OutcomeReport): Promise<OutcomeResponse> {
      return Promise.resolve({
        inferenceLogId: report.inferenceLogId ?? report.correlationId,
        status: 'recorded',
      });
    },
  };
}
