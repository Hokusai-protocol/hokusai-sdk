from __future__ import annotations

from collections.abc import Mapping
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
        "message_count",
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
    message_count: int


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


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


def assert_safe_routing_metadata(metadata: Mapping[str, Any]) -> None:
    keys = set(metadata)
    if not keys.issubset(ALLOWED_ROUTING_FIELDS):
        extra = sorted(keys - ALLOWED_ROUTING_FIELDS)
        raise PromptLeakageError(f"Routing metadata contains disallowed keys: {extra}")
    forbidden = sorted(keys & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Routing metadata contains forbidden keys: {forbidden}")


def build_routing_metadata(
    *,
    candidate_models: list[str],
    task_metadata: Mapping[str, Any] | None = None,
    message_count: int | None = None,
    latency_budget_ms: int | None = None,
    budget_usd: float | None = None,
    integration_version: str,
) -> SafeRoutingMetadata:
    """Build a safe routing payload for Hokusai.

    Never reads message content, tool arguments, or completion text. Only
    integer counts and allowlisted signals from ``task_metadata``.
    """

    metadata = _as_mapping(task_metadata)
    result: dict[str, Any] = {
        "task_type": str(metadata.get("task_type", "unknown")),
        "candidate_models": list(candidate_models),
        "integration_version": str(
            metadata.get("integration_version", integration_version)
        ),
    }

    if message_count is not None and message_count > 0:
        result["message_count"] = int(message_count)

    estimated_input_tokens = _coerce_int(metadata.get("estimated_input_tokens"))
    if estimated_input_tokens is None and message_count is not None:
        estimated_input_tokens = max(message_count * 4, 0)
    if estimated_input_tokens is not None and estimated_input_tokens > 0:
        result["estimated_input_tokens"] = estimated_input_tokens

    estimated_output_tokens = _coerce_int(metadata.get("estimated_output_tokens"))
    if estimated_output_tokens is not None and estimated_output_tokens > 0:
        result["estimated_output_tokens"] = estimated_output_tokens

    resolved_latency = latency_budget_ms
    if resolved_latency is None:
        resolved_latency = _coerce_int(metadata.get("latency_budget_ms"))
    if resolved_latency is not None:
        result["latency_budget_ms"] = resolved_latency

    resolved_budget = budget_usd
    if resolved_budget is None:
        resolved_budget = _coerce_float(metadata.get("budget_usd"))
    if resolved_budget is not None:
        result["budget_usd"] = resolved_budget

    quality_tier = metadata.get("quality_tier")
    if isinstance(quality_tier, str):
        result["quality_tier"] = quality_tier

    requires_tools = _coerce_bool(metadata.get("requires_tools"))
    if requires_tools is not None:
        result["requires_tools"] = requires_tools

    context_length_needed = _coerce_int(metadata.get("context_length_needed"))
    if context_length_needed is not None and context_length_needed > 0:
        result["context_length_needed"] = context_length_needed

    assert_safe_routing_metadata(result)
    return cast(SafeRoutingMetadata, result)
