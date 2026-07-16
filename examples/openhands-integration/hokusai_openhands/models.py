from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .errors import ModelUnavailableError


@dataclass(frozen=True)
class RunnableModel:
    key: str
    model_id: str
    usage_id: str | None
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class ModelChoice:
    key: str
    model_id: str
    usage_id: str | None
    fallback_used: bool
    recommended_model: str


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, Iterable) or isinstance(value, str | bytes | bytearray):
        return ()
    aliases: list[str] = []
    for item in value:
        if isinstance(item, str) and item:
            aliases.append(item)
    return tuple(aliases)


def list_runnable_models(llms_for_routing: Mapping[str, Any]) -> list[RunnableModel]:
    if not llms_for_routing:
        raise ValueError("At least one OpenHands runnable model is required")

    runnable_models: list[RunnableModel] = []
    for key, llm in llms_for_routing.items():
        model_value = getattr(llm, "model", None)
        model_id = model_value if isinstance(model_value, str) and model_value else key
        usage_value = getattr(llm, "usage_id", None)
        usage_id = usage_value if isinstance(usage_value, str) and usage_value else None
        aliases = _string_tuple(getattr(llm, "hokusai_aliases", ()))
        runnable_models.append(
            RunnableModel(
                key=key,
                model_id=model_id,
                usage_id=usage_id,
                aliases=aliases,
            )
        )
    return runnable_models


def allowed_model_ids(runnable_models: list[RunnableModel]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for runnable_model in runnable_models:
        if runnable_model.model_id in seen:
            continue
        seen.add(runnable_model.model_id)
        ordered.append(runnable_model.model_id)
    return ordered


def _matches_recommendation(recommendation: str, runnable_model: RunnableModel) -> bool:
    identifiers = (runnable_model.key, runnable_model.model_id, *runnable_model.aliases)
    return recommendation in identifiers


def _resolve_fallback(
    fallback_model: str | None,
    runnable_models: list[RunnableModel],
) -> RunnableModel | None:
    if fallback_model is None:
        return None
    for runnable_model in runnable_models:
        if _matches_recommendation(fallback_model, runnable_model):
            return runnable_model
    raise ValueError("fallback_model must match one of the configured OpenHands models")


def map_recommendation_to_runnable_model(
    recommendation: str,
    llms_for_routing: Mapping[str, Any],
    *,
    fallback_model: str | None = None,
) -> ModelChoice:
    runnable_models = list_runnable_models(llms_for_routing)
    fallback = _resolve_fallback(fallback_model, runnable_models)

    for runnable_model in runnable_models:
        if _matches_recommendation(recommendation, runnable_model):
            return ModelChoice(
                key=runnable_model.key,
                model_id=runnable_model.model_id,
                usage_id=runnable_model.usage_id,
                fallback_used=False,
                recommended_model=recommendation,
            )

    if fallback is not None:
        return ModelChoice(
            key=fallback.key,
            model_id=fallback.model_id,
            usage_id=fallback.usage_id,
            fallback_used=True,
            recommended_model=recommendation,
        )

    raise ModelUnavailableError(
        f"Hokusai recommended model '{recommendation}' which is not in the configured "
        "OpenHands model set"
    )
