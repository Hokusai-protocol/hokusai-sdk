from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any


@dataclass(frozen=True)
class MetricsSnapshot:
    """A privacy-safe snapshot of OpenHands metrics / conversation stats.

    Only numeric aggregates and status strings are extracted. Message content,
    tool arguments, and completion text are never read.
    """

    accumulated_cost: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    latency_seconds: float | None = None
    completion_result: str | None = None
    error_type: str | None = None


def _get_attr(source: Any, name: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(name)
    return getattr(source, name, None)


def _coerce_positive_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        as_float = float(value)
        if as_float >= 0:
            return as_float
    return None


def _coerce_non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value.is_integer() and value >= 0:
        return int(value)
    return None


def _extract_token_usage(source: Any) -> tuple[int | None, int | None, int | None]:
    if source is None:
        return None, None, None

    prompt_keys = ("prompt_tokens", "input_tokens", "accumulated_prompt_tokens")
    completion_keys = (
        "completion_tokens",
        "output_tokens",
        "accumulated_completion_tokens",
    )
    total_keys = ("total_tokens", "accumulated_total_tokens")

    prompt_tokens: int | None = None
    for key in prompt_keys:
        prompt_tokens = _coerce_non_negative_int(_get_attr(source, key))
        if prompt_tokens is not None:
            break

    completion_tokens: int | None = None
    for key in completion_keys:
        completion_tokens = _coerce_non_negative_int(_get_attr(source, key))
        if completion_tokens is not None:
            break

    total_tokens: int | None = None
    for key in total_keys:
        total_tokens = _coerce_non_negative_int(_get_attr(source, key))
        if total_tokens is not None:
            break

    if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
        total_tokens = prompt_tokens + completion_tokens

    return prompt_tokens, completion_tokens, total_tokens


def _extract_latency_seconds(source: Any) -> float | None:
    """Read ``response_latencies`` (seconds) from OpenHands metrics.

    OpenHands records a list of latencies per request. We take the last one
    because a routed call produces exactly one entry in the snapshot for that
    call. Falls back to ``latency_seconds`` when a fake exposes a scalar.
    """

    scalar = _coerce_positive_float(_get_attr(source, "latency_seconds"))
    if scalar is not None:
        return scalar

    latencies = _get_attr(source, "response_latencies")
    if latencies is None:
        return None

    if isinstance(latencies, (int, float)) and not isinstance(latencies, bool):
        return _coerce_positive_float(latencies)

    latest: float | None = None
    try:
        iterator = list(latencies)
    except TypeError:
        return None

    for entry in iterator:
        candidate: Any = entry
        if not isinstance(entry, (int, float)):
            candidate = _get_attr(entry, "latency") or _get_attr(entry, "seconds")
        coerced = _coerce_positive_float(candidate)
        if coerced is not None:
            latest = coerced

    return latest


def _wall_clock_seconds(start: Any, end: Any) -> float | None:
    if isinstance(start, datetime) and isinstance(end, datetime):
        return max(0.0, (end - start).total_seconds())
    if isinstance(start, timedelta):
        return max(0.0, start.total_seconds())
    return None


def snapshot_from_metrics(
    source: Any,
    *,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
    completion_result: str | None = None,
    error: BaseException | None = None,
) -> MetricsSnapshot:
    """Build a snapshot from OpenHands ``llm.metrics``, ``conversation.conversation_stats``,
    a plain dict, or a lightweight fake exposing the same attributes.
    """

    if source is None:
        source = {}

    combined = _get_attr(source, "get_combined_metrics")
    if callable(combined):
        try:
            source = combined()
        except TypeError:
            pass

    cost = _coerce_positive_float(_get_attr(source, "accumulated_cost"))
    if cost is None:
        cost = _coerce_positive_float(_get_attr(source, "cost"))

    token_source: Any = _get_attr(source, "accumulated_token_usage")
    if token_source is None:
        token_source = source
    prompt_tokens, completion_tokens, total_tokens = _extract_token_usage(token_source)

    latency_seconds = _extract_latency_seconds(source)
    if latency_seconds is None:
        latency_seconds = _wall_clock_seconds(started_at, ended_at)

    resolved_result = completion_result
    if resolved_result is None:
        if error is not None:
            resolved_result = "failure"
        else:
            status = _get_attr(source, "completion_result")
            if isinstance(status, str) and status:
                resolved_result = status
            else:
                resolved_result = "unknown"

    error_type = type(error).__name__ if error is not None else None

    return MetricsSnapshot(
        accumulated_cost=cost,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        latency_seconds=latency_seconds,
        completion_result=resolved_result,
        error_type=error_type,
    )
