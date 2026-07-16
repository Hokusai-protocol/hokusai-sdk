from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TypedDict, cast

from .errors import PromptLeakageError

ALLOWED_ROUTING_FIELDS = frozenset(
    {
        "task_type",
        "estimated_input_tokens",
        "estimated_output_tokens",
        "latency_budget_ms",
        "quality_tier",
        "requires_tools",
        "context_length_needed",
        "candidate_models",
        "budget_usd",
        "integration_version",
    }
)

FORBIDDEN_FIELDS = frozenset(
    {
        "messages",
        "prompt",
        "input",
        "content",
        "system",
        "tools",
        "tool_calls",
        "tool_choice",
        "functions",
        "function_call",
        "completion",
        "response",
        "choices",
        "text",
    }
)


class SafeRoutingMetadata(TypedDict, total=False):
    task_type: str
    estimated_input_tokens: int
    estimated_output_tokens: int
    latency_budget_ms: int
    quality_tier: str
    requires_tools: bool
    context_length_needed: int
    candidate_models: list[str]
    budget_usd: float
    integration_version: str


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _message_count(messages: Any) -> int:
    return (
        len(messages)
        if isinstance(messages, Sequence) and not isinstance(messages, (str, bytes))
        else 0
    )


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        finite = float(value)
        return finite if finite >= 0 else None
    return None


def _coerce_bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _coerce_str(value: Any, default: str) -> str:
    return value if isinstance(value, str) and value else default


def _deep_key_scan(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, Mapping):
        for key, child in value.items():
            keys.add(str(key))
            keys.update(_deep_key_scan(child))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            keys.update(_deep_key_scan(item))
    return keys


def assert_safe_routing_metadata(metadata: Mapping[str, Any]) -> None:
    keys = set(metadata)
    if not keys.issubset(ALLOWED_ROUTING_FIELDS):
        extra = sorted(keys - ALLOWED_ROUTING_FIELDS)
        raise PromptLeakageError(f"Routing metadata contains disallowed keys: {extra}")
    forbidden = sorted(_deep_key_scan(metadata) & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Routing metadata contains forbidden keys: {forbidden}")


def build_routing_metadata(
    litellm_kwargs: Mapping[str, Any],
    *,
    candidate_models: list[str],
    latency_budget_ms: int | None = None,
    budget_usd: float | None = None,
) -> SafeRoutingMetadata:
    metadata = _as_mapping(litellm_kwargs.get("metadata"))
    forbidden = sorted(_deep_key_scan(metadata) & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Routing metadata contains forbidden keys: {forbidden}")

    result: dict[str, Any] = {
        "task_type": _coerce_str(metadata.get("task_type"), "unknown"),
        "candidate_models": list(candidate_models),
        "integration_version": _coerce_str(
            metadata.get("integration_version"),
            "hokusai-litellm-example/0.1.0",
        ),
    }

    estimated_input_tokens = _coerce_int(metadata.get("estimated_input_tokens")) or 0
    estimated_input_tokens += _message_count(litellm_kwargs.get("messages")) * 4
    if estimated_input_tokens > 0:
        result["estimated_input_tokens"] = estimated_input_tokens

    for key in ALLOWED_ROUTING_FIELDS:
        if key in {"candidate_models", "integration_version", "task_type"}:
            continue
        if key == "estimated_input_tokens":
            continue
        if key == "latency_budget_ms":
            coerced_latency = latency_budget_ms
            if coerced_latency is None:
                coerced_latency = _coerce_int(metadata.get(key))
            if coerced_latency is not None:
                result[key] = coerced_latency
            continue
        if key == "budget_usd":
            coerced_budget = budget_usd
            if coerced_budget is None:
                coerced_budget = _coerce_float(metadata.get(key))
            if coerced_budget is not None:
                result[key] = coerced_budget
            continue

        value = metadata.get(key)
        if key == "estimated_output_tokens":
            coerced = _coerce_int(value)
        elif key == "requires_tools":
            coerced = _coerce_bool(value)
            if coerced is None and "tools" in litellm_kwargs:
                coerced = bool(litellm_kwargs.get("tools"))
        elif key == "context_length_needed":
            coerced = _coerce_int(value)
        elif key == "quality_tier":
            coerced_value: Any = str(value) if isinstance(value, str) else None
            coerced = coerced_value
        else:
            coerced = cast(Any, value)

        if coerced is not None:
            result[key] = coerced

    assert_safe_routing_metadata(result)
    return cast(SafeRoutingMetadata, result)
