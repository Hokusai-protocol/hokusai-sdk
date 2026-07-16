from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any
from uuid import uuid4

from litellm.types.router import CustomRoutingStrategyBase

from .errors import ConfigurationError, PromptLeakageError, RoutingCallFailed
from .hokusai_client import HokusaiHttpClient
from .metadata import build_routing_metadata

LOGGER = logging.getLogger(__name__)

KNOWN_PROVIDER_PREFIXES = (
    "openrouter/",
    "litellm/",
    "openai/",
    "anthropic/",
    "azure/",
    "google/",
    "gemini/",
)


def canonical_model_id(model: str | None) -> str | None:
    if model is None:
        return None
    normalized = model.strip().lower()
    for _ in range(5):
        prefix = next(
            (
                value
                for value in KNOWN_PROVIDER_PREFIXES
                if normalized.startswith(value)
            ),
            None,
        )
        if prefix is None:
            break
        normalized = normalized[len(prefix) :]
    return normalized or None


def _deployment_identifier(deployment: Mapping[str, Any]) -> str:
    model_info = deployment.get("model_info")
    if isinstance(model_info, Mapping) and isinstance(model_info.get("hokusai_id"), str):
        return str(model_info["hokusai_id"])
    litellm_params = deployment.get("litellm_params")
    if isinstance(litellm_params, Mapping) and isinstance(litellm_params.get("model"), str):
        return str(litellm_params["model"])
    model_name = deployment.get("model_name")
    if isinstance(model_name, str):
        return model_name
    raise ConfigurationError("Deployment is missing model_name and litellm_params.model")


def map_recommendation_to_deployment(
    recommendation: str | None,
    deployments: list[dict[str, Any]],
) -> tuple[dict[str, Any], bool]:
    if not deployments:
        raise ConfigurationError("At least one LiteLLM deployment is required")

    if recommendation is None:
        return deployments[0], True

    normalized_recommendation = canonical_model_id(recommendation)
    for deployment in deployments:
        candidates = [
            deployment.get("model_name"),
            _deployment_identifier(deployment),
        ]
        for candidate in candidates:
            if (
                isinstance(candidate, str)
                and canonical_model_id(candidate) == normalized_recommendation
            ):
                return deployment, False

    return deployments[0], True


class HokusaiRoutingStrategy(CustomRoutingStrategyBase):
    def __init__(
        self,
        client: HokusaiHttpClient,
        deployments: list[dict[str, Any]],
        *,
        latency_budget_ms: int | None = None,
        budget_usd: float | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._client = client
        self._deployments = deployments
        self._latency_budget_ms = latency_budget_ms
        self._budget_usd = budget_usd
        self._logger = logger or LOGGER

    def _deployment_names(self) -> list[str]:
        return [_deployment_identifier(deployment) for deployment in self._deployments]

    def _fallback_deployment(self) -> dict[str, Any]:
        if not self._deployments:
            raise ConfigurationError("At least one LiteLLM deployment is required")
        return self._deployments[0]

    def _stash_metadata(
        self,
        request_kwargs: dict[str, Any],
        *,
        deployment: Mapping[str, Any],
        fallback_used: bool,
        routing_metadata: Mapping[str, Any],
        inference_log_id: str | None,
    ) -> None:
        request_metadata = request_kwargs.setdefault("metadata", {})
        if not isinstance(request_metadata, dict):
            request_metadata = {}
            request_kwargs["metadata"] = request_metadata
        hokusai_metadata = request_metadata.setdefault("hokusai", {})
        if not isinstance(hokusai_metadata, dict):
            hokusai_metadata = {}
            request_metadata["hokusai"] = hokusai_metadata
        hokusai_metadata.update(
            {
                "selected_model_id": _deployment_identifier(deployment),
                "allowed_deployment_names": self._deployment_names(),
                "fallback_used": fallback_used,
                "routing_metadata": dict(routing_metadata),
                "idempotency_key": hokusai_metadata.get("idempotency_key") or uuid4().hex,
            }
        )
        if inference_log_id:
            hokusai_metadata["inference_log_id"] = inference_log_id

    async def async_get_available_deployment(
        self,
        model: str,
        messages: list[dict[str, str]] | None = None,
        input: str | list[Any] | None = None,
        specific_deployment: bool | None = False,
        request_kwargs: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _ = model, messages, input, specific_deployment
        kwargs = dict(request_kwargs or {})
        routing_metadata: Mapping[str, Any] = {"candidate_models": self._deployment_names()}

        try:
            routing_metadata = build_routing_metadata(
                kwargs,
                candidate_models=self._deployment_names(),
                latency_budget_ms=self._latency_budget_ms,
                budget_usd=self._budget_usd,
            )
            recommendation = await self._client.select_model(routing_metadata)
            deployment, fallback_used = map_recommendation_to_deployment(
                recommendation.model,
                self._deployments,
            )
            self._stash_metadata(
                kwargs,
                deployment=deployment,
                fallback_used=fallback_used,
                routing_metadata=routing_metadata,
                inference_log_id=recommendation.inference_log_id,
            )
            if request_kwargs is not None:
                request_kwargs.clear()
                request_kwargs.update(kwargs)
            return deployment
        except (RoutingCallFailed, PromptLeakageError) as exc:
            fallback = self._fallback_deployment()
            self._logger.warning("Hokusai routing failed open (%s): %s", type(exc).__name__, exc)
            self._stash_metadata(
                kwargs,
                deployment=fallback,
                fallback_used=True,
                routing_metadata=routing_metadata,
                inference_log_id=None,
            )
            if request_kwargs is not None:
                request_kwargs.clear()
                request_kwargs.update(kwargs)
            return fallback

    def get_available_deployment(
        self,
        model: str,
        messages: list[dict[str, str]] | None = None,
        input: str | list[Any] | None = None,
        specific_deployment: bool | None = False,
        request_kwargs: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError("Use async_get_available_deployment for this prototype")
