from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import isfinite
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


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value.is_integer():
        coerced = int(value)
        return coerced if coerced >= 0 else None
    return None


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if not isinstance(value, int | float):
        return None
    coerced = float(value)
    if not isfinite(coerced) or coerced < 0:
        return None
    return coerced


def _coerce_bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _message_count(messages: Sequence[Any] | None) -> int:
    if messages is None:
        return 0
    return len(messages)


def _deep_key_scan(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, Mapping):
        for key, child in value.items():
            keys.add(str(key))
            keys.update(_deep_key_scan(child))
    elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
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
    raw_metadata: Mapping[str, Any] | None,
    *,
    candidate_models: list[str],
    messages: Sequence[Any] | None = None,
    integration_version: str,
) -> SafeRoutingMetadata:
    source = dict(raw_metadata or {})
    forbidden = sorted(_deep_key_scan(source) & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Routing metadata contains forbidden keys: {forbidden}")

    result: dict[str, Any] = {
        "task_type": str(source.get("task_type", "unknown")),
        "candidate_models": list(candidate_models),
        "integration_version": integration_version,
    }

    estimated_input_tokens = _coerce_int(source.get("estimated_input_tokens")) or 0
    estimated_input_tokens += _message_count(messages) * 4
    if estimated_input_tokens > 0:
        result["estimated_input_tokens"] = estimated_input_tokens

    estimated_output_tokens = _coerce_int(source.get("estimated_output_tokens"))
    if estimated_output_tokens is not None:
        result["estimated_output_tokens"] = estimated_output_tokens

    latency_budget_ms = _coerce_int(source.get("latency_budget_ms"))
    if latency_budget_ms is not None:
        result["latency_budget_ms"] = latency_budget_ms

    quality_tier = source.get("quality_tier")
    if isinstance(quality_tier, str) and quality_tier:
        result["quality_tier"] = quality_tier

    requires_tools = _coerce_bool(source.get("requires_tools"))
    if requires_tools is not None:
        result["requires_tools"] = requires_tools

    context_length_needed = _coerce_int(source.get("context_length_needed"))
    if context_length_needed is not None:
        result["context_length_needed"] = context_length_needed

    budget_usd = _coerce_float(source.get("budget_usd"))
    if budget_usd is not None:
        result["budget_usd"] = budget_usd

    assert_safe_routing_metadata(result)
    return cast(SafeRoutingMetadata, result)
