from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import uuid4

from .contribution import (
    HARNESS_NAME,
    INTEGRATION_VERSION,
    HarnessOutcomeRow,
    build_harness_outcome_row,
)
from .errors import ContributionSubmissionFailed
from .hokusai_client import HokusaiHttpClient
from .router import HokusaiRouteResolver, RouteDecision
from .telemetry import MetricsSnapshot, snapshot_from_metrics

LOGGER = logging.getLogger(__name__)


class HokusaiOutcomeReporter:
    """Turn a completed OpenHands routed call into a Hokusai contribution row.

    Callers pull the ``RouteDecision`` for the call from the resolver (by
    ``call_id``) and hand a fresh metrics snapshot to :meth:`report`.
    ``report`` builds a ``harness_outcome_row/v1`` row and submits it through
    the shared Hokusai integration endpoint.
    """

    def __init__(
        self,
        client: HokusaiHttpClient,
        resolver: HokusaiRouteResolver,
        *,
        openhands_sdk_version: str | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._client = client
        self._resolver = resolver
        self._openhands_sdk_version = openhands_sdk_version
        self._logger = logger or LOGGER
        self.last_row: HarnessOutcomeRow | None = None
        self.last_snapshot: MetricsSnapshot | None = None
        self.last_diagnostics: dict[str, Any] = {}

    def build_row(
        self,
        *,
        decision: RouteDecision,
        metrics: Any,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        completion_result: str | None = None,
        error: BaseException | None = None,
        task_descriptor: Mapping[str, Any] | None = None,
        task_id: str | None = None,
        observed_at: str | None = None,
    ) -> HarnessOutcomeRow:
        snapshot = snapshot_from_metrics(
            metrics,
            started_at=started_at,
            ended_at=ended_at,
            completion_result=completion_result,
            error=error,
        )

        descriptor: dict[str, Any]
        if task_descriptor:
            descriptor = dict(task_descriptor)
        else:
            descriptor = {
                "task_type": str(
                    decision.routing_metadata.get("task_type", "unknown")
                )
            }

        allowed_models = self._resolver.candidate_model_ids()

        wall_clock_seconds = snapshot.latency_seconds or 0.0
        budget_usd: float | None = None
        raw_budget = decision.routing_metadata.get("budget_usd")
        if isinstance(raw_budget, (int, float)) and not isinstance(raw_budget, bool):
            budget_usd = float(raw_budget)

        diagnostics: dict[str, Any] = {
            "routing_key": decision.routing_key,
            "fallback_used": decision.fallback_used,
        }
        if decision.recommendation.selected_model:
            diagnostics["recommended_model"] = decision.recommendation.selected_model
        if decision.fallback_reason:
            diagnostics["fallback_reason"] = decision.fallback_reason
        if snapshot.error_type is not None:
            diagnostics["error_type"] = snapshot.error_type
        if snapshot.prompt_tokens is not None:
            diagnostics["prompt_tokens"] = int(snapshot.prompt_tokens)
        if snapshot.completion_tokens is not None:
            diagnostics["completion_tokens"] = int(snapshot.completion_tokens)
        if snapshot.prompt_tokens is not None and snapshot.completion_tokens is not None:
            diagnostics["total_tokens"] = int(snapshot.prompt_tokens) + int(
                snapshot.completion_tokens
            )
        if self._openhands_sdk_version is not None:
            diagnostics["openhands_sdk_version"] = self._openhands_sdk_version

        row = build_harness_outcome_row(
            task_descriptor=descriptor,
            allowed_models=allowed_models,
            selected_model=decision.model_id,
            completion_result=snapshot.completion_result or "unknown",
            cost_usd=snapshot.accumulated_cost,
            prompt_tokens=snapshot.prompt_tokens,
            completion_tokens=snapshot.completion_tokens,
            wall_clock_seconds=wall_clock_seconds,
            budget_usd=budget_usd,
            inference_log_id=decision.route_id,
            task_id=task_id,
            observed_at=observed_at,
            harness=HARNESS_NAME,
            sdk_version=INTEGRATION_VERSION,
        )
        self.last_row = row
        self.last_snapshot = snapshot
        self.last_diagnostics = diagnostics
        self._logger.info("hokusai openhands outcome diagnostics: %s", diagnostics)
        return row

    def report(
        self,
        *,
        decision: RouteDecision,
        metrics: Any,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        completion_result: str | None = None,
        error: BaseException | None = None,
        task_descriptor: Mapping[str, Any] | None = None,
        task_id: str | None = None,
        observed_at: str | None = None,
        idempotency_key: str | None = None,
    ) -> HarnessOutcomeRow:
        row = self.build_row(
            decision=decision,
            metrics=metrics,
            started_at=started_at,
            ended_at=ended_at,
            completion_result=completion_result,
            error=error,
            task_descriptor=task_descriptor,
            task_id=task_id,
            observed_at=observed_at,
        )
        idem = idempotency_key or uuid4().hex
        try:
            self._client.submit_contribution(row, idempotency_key=idem)
        except ContributionSubmissionFailed as exc:
            self._logger.warning("Hokusai contribution submission failed: %s", exc)
        return row

    async def async_report(
        self,
        *,
        decision: RouteDecision,
        metrics: Any,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
        completion_result: str | None = None,
        error: BaseException | None = None,
        task_descriptor: Mapping[str, Any] | None = None,
        task_id: str | None = None,
        observed_at: str | None = None,
        idempotency_key: str | None = None,
    ) -> HarnessOutcomeRow:
        row = self.build_row(
            decision=decision,
            metrics=metrics,
            started_at=started_at,
            ended_at=ended_at,
            completion_result=completion_result,
            error=error,
            task_descriptor=task_descriptor,
            task_id=task_id,
            observed_at=observed_at,
        )
        idem = idempotency_key or uuid4().hex
        try:
            await self._client.async_submit_contribution(row, idempotency_key=idem)
        except ContributionSubmissionFailed as exc:
            self._logger.warning("Hokusai contribution submission failed: %s", exc)
        return row
