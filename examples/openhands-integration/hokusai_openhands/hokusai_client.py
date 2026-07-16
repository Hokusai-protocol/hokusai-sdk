from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, cast
from uuid import uuid4

import httpx

from .contribution import INTEGRATION_VERSION, build_contribution_request
from .errors import ContributionSubmissionFailed, MissingRouteIdError, RoutingCallFailed
from .metadata import SafeRoutingMetadata


@dataclass(frozen=True)
class Recommendation:
    """Structured route response returned by the Hokusai routing API."""

    route_id: str
    selected_model: str | None = None
    allowed_models: tuple[str, ...] = ()
    confidence: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


class HokusaiHttpClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        *,
        timeout_ms: int = 500,
        transport: httpx.BaseTransport | httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = httpx.Timeout(timeout_ms / 1000.0)
        self._sync_transport = cast(httpx.BaseTransport | None, transport)
        self._async_transport = cast(httpx.AsyncBaseTransport | None, transport)

    def _headers(
        self,
        *,
        request_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, str]:
        resolved_request_id = request_id or uuid4().hex
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Request-ID": resolved_request_id,
            "X-Hokusai-Request-Id": resolved_request_id,
            "X-Hokusai-Sdk-Version": INTEGRATION_VERSION,
        }
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    @staticmethod
    def _build_route_request(
        metadata: SafeRoutingMetadata,
        request_id: str | None,
    ) -> dict[str, Any]:
        routing: dict[str, Any] = {
            "available_models": list(metadata.get("candidate_models", [])),
        }
        if "budget_usd" in metadata:
            routing["max_cost_usd"] = metadata["budget_usd"]
        if "latency_budget_ms" in metadata:
            routing["max_latency_seconds"] = metadata["latency_budget_ms"] / 1000.0
        if metadata.get("quality_tier") == "high":
            routing["prioritize_quality"] = True
        if metadata.get("quality_tier") == "speed":
            routing["prioritize_speed"] = True

        request: dict[str, Any] = {
            "inputs": {
                "task": {
                    "description": "metadata-only OpenHands route",
                    "task_type": metadata.get("task_type", "unknown"),
                },
                "routing": routing,
                "metadata": {
                    "external_task_id": request_id or "openhands",
                    "integration_version": metadata.get(
                        "integration_version", INTEGRATION_VERSION
                    ),
                },
            },
            "safe_metadata": dict(metadata),
        }
        return request

    @staticmethod
    def _parse_recommendation(
        payload: Any,
        candidate_models: tuple[str, ...],
    ) -> Recommendation:
        body = _as_mapping(payload)
        predictions = _as_mapping(body.get("predictions"))
        strategy = _as_mapping(predictions.get("recommended_strategy"))
        metadata = _as_mapping(body.get("metadata"))

        model = (
            strategy.get("coder_model")
            or strategy.get("model")
            or metadata.get("coder_model")
        )
        if model is not None and not isinstance(model, str):
            raise RoutingCallFailed(
                "Hokusai routing response returned a non-string model recommendation"
            )

        confidence_raw = strategy.get("confidence") or metadata.get("confidence")
        confidence: float | None = None
        if isinstance(confidence_raw, (int, float)) and not isinstance(confidence_raw, bool):
            confidence = float(confidence_raw)
        elif isinstance(confidence_raw, str):
            try:
                confidence = float(confidence_raw)
            except ValueError:
                confidence = None

        route_id_raw: Any = (
            body.get("routeId")
            or body.get("route_id")
            or metadata.get("route_id")
            or metadata.get("prediction_id")
            or metadata.get("predictionId")
        )
        if not isinstance(route_id_raw, str) or not route_id_raw:
            raise MissingRouteIdError(
                "Hokusai routing response did not include a routeId; outcome rows require "
                "inference_log_id and cannot be attributed without one."
            )

        allowed_models_raw = metadata.get("allowed_models")
        if isinstance(allowed_models_raw, list) and all(
            isinstance(entry, str) for entry in allowed_models_raw
        ):
            allowed_models = tuple(allowed_models_raw)
        else:
            allowed_models = candidate_models

        return Recommendation(
            route_id=route_id_raw,
            selected_model=model,
            allowed_models=allowed_models,
            confidence=confidence,
            raw=dict(body),
        )

    async def select_model(
        self,
        metadata: SafeRoutingMetadata,
        *,
        request_id: str | None = None,
    ) -> Recommendation:
        request = self._build_route_request(metadata, request_id)
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._async_transport,
            ) as client:
                response = await client.post(
                    "/api/v1/models/30/predict",
                    headers=self._headers(request_id=request_id),
                    json=request,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise RoutingCallFailed("Hokusai routing request timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise RoutingCallFailed(
                f"Hokusai routing request failed with status {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RoutingCallFailed("Hokusai routing request failed") from exc

        candidates = tuple(metadata.get("candidate_models", ()))
        try:
            return self._parse_recommendation(response.json(), candidates)
        except ValueError as exc:
            if isinstance(exc, RoutingCallFailed):
                raise
            raise RoutingCallFailed("Hokusai routing response was not valid JSON") from exc

    def select_model_sync(
        self,
        metadata: SafeRoutingMetadata,
        *,
        request_id: str | None = None,
    ) -> Recommendation:
        """Blocking counterpart to :meth:`select_model` for sync OpenHands paths."""

        request = self._build_route_request(metadata, request_id)
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._sync_transport,
            ) as client:
                response = client.post(
                    "/api/v1/models/30/predict",
                    headers=self._headers(request_id=request_id),
                    json=request,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise RoutingCallFailed("Hokusai routing request timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise RoutingCallFailed(
                f"Hokusai routing request failed with status {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RoutingCallFailed("Hokusai routing request failed") from exc

        candidates = tuple(metadata.get("candidate_models", ()))
        try:
            return self._parse_recommendation(response.json(), candidates)
        except ValueError as exc:
            if isinstance(exc, RoutingCallFailed):
                raise
            raise RoutingCallFailed("Hokusai routing response was not valid JSON") from exc

    def submit_contribution(
        self,
        row: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        request = build_contribution_request(row, idempotency_key=idempotency_key)
        try:
            with httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._sync_transport,
            ) as client:
                response = client.post(
                    "/api/v1/models/30/contributions",
                    headers=self._headers(idempotency_key=idempotency_key),
                    json=request,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ContributionSubmissionFailed("Contribution submission timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise ContributionSubmissionFailed(
                f"Contribution submission failed with status {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ContributionSubmissionFailed("Contribution submission failed") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ContributionSubmissionFailed("Contribution response was not valid JSON") from exc

        if not isinstance(payload, Mapping):
            raise ContributionSubmissionFailed("Contribution response was not an object")
        return dict(payload)

    async def async_submit_contribution(
        self,
        row: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        request = build_contribution_request(row, idempotency_key=idempotency_key)
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                transport=self._async_transport,
            ) as client:
                response = await client.post(
                    "/api/v1/models/30/contributions",
                    headers=self._headers(idempotency_key=idempotency_key),
                    json=request,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ContributionSubmissionFailed("Contribution submission timed out") from exc
        except httpx.HTTPStatusError as exc:
            raise ContributionSubmissionFailed(
                f"Contribution submission failed with status {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ContributionSubmissionFailed("Contribution submission failed") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ContributionSubmissionFailed("Contribution response was not valid JSON") from exc

        if not isinstance(payload, Mapping):
            raise ContributionSubmissionFailed("Contribution response was not an object")
        return dict(payload)
