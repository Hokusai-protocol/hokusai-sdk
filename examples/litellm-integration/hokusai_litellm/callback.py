from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import uuid4

from litellm.integrations.custom_logger import CustomLogger

from .contribution import HarnessOutcomeRow, build_harness_outcome_row
from .hokusai_client import HokusaiHttpClient
from .router_strategy import canonical_model_id

LOGGER = logging.getLogger(__name__)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _as_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _coerce_tokens(value: Any) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def _extract_response_mapping(response_obj: Any) -> dict[str, Any]:
    if isinstance(response_obj, Mapping):
        return dict(response_obj)
    if hasattr(response_obj, "model_dump"):
        dumped = response_obj.model_dump()
        return dict(dumped) if isinstance(dumped, Mapping) else {}
    if hasattr(response_obj, "dict"):
        dumped = response_obj.dict()
        return dict(dumped) if isinstance(dumped, Mapping) else {}
    return {}


class HokusaiContributionLogger(CustomLogger):
    def __init__(
        self,
        client: HokusaiHttpClient,
        *,
        logger: logging.Logger | None = None,
    ) -> None:
        self._client = client
        self._logger = logger or LOGGER
        self.last_row: HarnessOutcomeRow | None = None
        self.last_telemetry: dict[str, Any] | None = None

    def _extract_times(self, start_time: Any, end_time: Any) -> float:
        if isinstance(start_time, datetime) and isinstance(end_time, datetime):
            return max(0.0, (end_time - start_time).total_seconds() * 1000.0)
        return 0.0

    def _extract_selected_model(self, kwargs: Mapping[str, Any]) -> str:
        metadata = _as_mapping(kwargs.get("metadata"))
        hokusai = _as_mapping(metadata.get("hokusai"))
        selected = hokusai.get("selected_model_id")
        if isinstance(selected, str):
            return selected
        model = kwargs.get("model")
        if isinstance(model, str):
            return canonical_model_id(model) or model
        return "unknown"

    def _extract_allowed_models(self, kwargs: Mapping[str, Any], selected_model: str) -> list[str]:
        metadata = _as_mapping(kwargs.get("metadata"))
        hokusai = _as_mapping(metadata.get("hokusai"))
        allowed = hokusai.get("allowed_deployment_names")
        if (
            isinstance(allowed, list)
            and allowed
            and all(isinstance(entry, str) for entry in allowed)
        ):
            return list(allowed)
        return [selected_model]

    def _extract_cost(self, kwargs: Mapping[str, Any], response: Mapping[str, Any]) -> float | None:
        hidden_params = _as_mapping(response.get("_hidden_params"))
        hidden_cost = hidden_params.get("response_cost")
        if isinstance(hidden_cost, (int, float)):
            return float(hidden_cost)
        top_level_cost = kwargs.get("response_cost")
        if isinstance(top_level_cost, (int, float)):
            return float(top_level_cost)
        return None

    def _build_row(
        self,
        *,
        kwargs: Mapping[str, Any],
        response_obj: Any,
        start_time: Any,
        end_time: Any,
        completion_result: str,
        exception: Exception | None = None,
    ) -> tuple[HarnessOutcomeRow, str]:
        response = _extract_response_mapping(response_obj)
        usage = _as_mapping(response.get("usage"))
        metadata = _as_mapping(kwargs.get("metadata"))
        hokusai = _as_mapping(metadata.get("hokusai"))

        selected_model = self._extract_selected_model(kwargs)
        allowed_models = self._extract_allowed_models(kwargs, selected_model)
        prompt_tokens = _coerce_tokens(usage.get("prompt_tokens"))
        completion_tokens = _coerce_tokens(usage.get("completion_tokens"))
        total_tokens = _coerce_tokens(usage.get("total_tokens"))
        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens

        latency_ms = self._extract_times(start_time, end_time)
        budget_usd = (
            float(metadata["budget_usd"])
            if isinstance(metadata.get("budget_usd"), (int, float))
            else None
        )
        inference_log_id = (
            str(hokusai["inference_log_id"])
            if isinstance(hokusai.get("inference_log_id"), str)
            else None
        )
        task_id = str(metadata["task_id"]) if isinstance(metadata.get("task_id"), str) else None
        row = build_harness_outcome_row(
            task_descriptor={"task_type": str(metadata.get("task_type", "unknown"))},
            allowed_models=allowed_models,
            selected_model=selected_model,
            completion_result=completion_result,
            cost_usd=self._extract_cost(kwargs, response),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            budget_usd=budget_usd,
            inference_log_id=inference_log_id,
            task_id=task_id,
        )

        self.last_row = row
        self.last_telemetry = {
            "selected_model": selected_model,
            "allowed_models": allowed_models,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "cost_usd": row.get("actual_cost_usd"),
            "error_type": type(exception).__name__ if exception is not None else None,
        }

        idempotency_key = (
            str(hokusai["idempotency_key"])
            if isinstance(hokusai.get("idempotency_key"), str)
            else uuid4().hex
        )
        return row, idempotency_key

    def log_success_event(
        self,
        kwargs: Any,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
    ) -> None:
        row, idempotency_key = self._build_row(
            kwargs=_as_dict(kwargs),
            response_obj=response_obj,
            start_time=start_time,
            end_time=end_time,
            completion_result="success",
        )
        try:
            self._client.submit_contribution(row, idempotency_key=idempotency_key)
        except Exception as exc:  # pragma: no cover - exercised via tests
            self._logger.warning("Hokusai contribution submission failed: %s", exc)

    def log_failure_event(
        self,
        kwargs: Any,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
    ) -> None:
        exception = response_obj if isinstance(response_obj, Exception) else None
        row, idempotency_key = self._build_row(
            kwargs=_as_dict(kwargs),
            response_obj={},
            start_time=start_time,
            end_time=end_time,
            completion_result="failure",
            exception=exception,
        )
        try:
            self._client.submit_contribution(row, idempotency_key=idempotency_key)
        except Exception as exc:  # pragma: no cover - exercised via tests
            self._logger.warning("Hokusai contribution submission failed: %s", exc)

    async def async_log_success_event(
        self,
        kwargs: Any,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
    ) -> None:
        row, idempotency_key = self._build_row(
            kwargs=_as_dict(kwargs),
            response_obj=response_obj,
            start_time=start_time,
            end_time=end_time,
            completion_result="success",
        )
        try:
            await self._client.async_submit_contribution(row, idempotency_key=idempotency_key)
        except Exception as exc:  # pragma: no cover - exercised via tests
            self._logger.warning("Hokusai contribution submission failed: %s", exc)

    async def async_log_failure_event(
        self,
        kwargs: Any,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
    ) -> None:
        exception = response_obj if isinstance(response_obj, Exception) else None
        row, idempotency_key = self._build_row(
            kwargs=_as_dict(kwargs),
            response_obj={},
            start_time=start_time,
            end_time=end_time,
            completion_result="failure",
            exception=exception,
        )
        try:
            await self._client.async_submit_contribution(row, idempotency_key=idempotency_key)
        except Exception as exc:  # pragma: no cover - exercised via tests
            self._logger.warning("Hokusai contribution submission failed: %s", exc)
