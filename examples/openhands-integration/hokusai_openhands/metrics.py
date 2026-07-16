from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Any

from .contribution import ContributionMetrics


@dataclass(frozen=True)
class OpenHandsMetricsSnapshot:
    actual_cost_usd: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    latency_seconds: float | None = None
    completion_result: str | None = None

    def as_contribution_metrics(self) -> ContributionMetrics:
        return ContributionMetrics(
            actual_cost_usd=self.actual_cost_usd,
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            total_tokens=self.total_tokens,
            latency_seconds=self.latency_seconds,
            completion_result=self.completion_result,
        )


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
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


def _maybe_attr(value: Any, name: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _extract_token_usage(metrics: Any) -> tuple[int | None, int | None]:
    usage = _maybe_attr(metrics, "accumulated_token_usage")
    prompt_tokens = _coerce_int(_maybe_attr(usage, "prompt_tokens"))
    completion_tokens = _coerce_int(_maybe_attr(usage, "completion_tokens"))
    return prompt_tokens, completion_tokens


def _extract_total_tokens(prompt_tokens: int | None, completion_tokens: int | None) -> int | None:
    if prompt_tokens is None or completion_tokens is None:
        return None
    return prompt_tokens + completion_tokens


def _extract_latency_seconds(metrics: Any) -> float | None:
    response_latencies = _maybe_attr(metrics, "response_latencies")
    if not isinstance(response_latencies, Sequence):
        return None

    total_latency = 0.0
    seen_latency = False
    for entry in response_latencies:
        latency = _coerce_float(_maybe_attr(entry, "latency"))
        if latency is None:
            continue
        total_latency += latency
        seen_latency = True

    if not seen_latency:
        return None
    return total_latency


def _metrics_from_conversation(conversation: Any, usage_id: str | None) -> Any:
    state = getattr(conversation, "state", None)
    if state is None:
        return None
    stats = getattr(state, "stats", None)
    if stats is None:
        return None

    if usage_id and hasattr(stats, "get_metrics_for_usage"):
        try:
            return stats.get_metrics_for_usage(usage_id)
        except Exception:
            pass

    if hasattr(stats, "get_combined_metrics"):
        try:
            return stats.get_combined_metrics()
        except Exception:
            return None

    usage_to_metrics = _as_mapping(getattr(stats, "usage_to_metrics", None))
    if usage_id and usage_id in usage_to_metrics:
        return usage_to_metrics[usage_id]
    if usage_to_metrics:
        return next(iter(usage_to_metrics.values()))
    return None


def infer_completion_result(conversation: Any) -> str | None:
    state = getattr(conversation, "state", None)
    status = getattr(state, "execution_status", None)
    value = getattr(status, "value", status)
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized == "finished":
        return "success"
    if normalized in {"error", "stuck"}:
        return "failure"
    return None


def extract_metrics(
    *,
    llm: Any | None = None,
    conversation: Any | None = None,
    usage_id: str | None = None,
) -> OpenHandsMetricsSnapshot:
    metrics = _metrics_from_conversation(conversation, usage_id)
    if metrics is None and llm is not None:
        metrics = getattr(llm, "metrics", None)

    if metrics is None:
        return OpenHandsMetricsSnapshot(
            completion_result=infer_completion_result(conversation),
        )

    actual_cost_usd = _coerce_float(_maybe_attr(metrics, "accumulated_cost"))
    prompt_tokens, completion_tokens = _extract_token_usage(metrics)
    total_tokens = _extract_total_tokens(prompt_tokens, completion_tokens)
    latency_seconds = _extract_latency_seconds(metrics)

    return OpenHandsMetricsSnapshot(
        actual_cost_usd=actual_cost_usd,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        latency_seconds=latency_seconds,
        completion_result=infer_completion_result(conversation),
    )
