from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Any, TypedDict

from .errors import PromptLeakageError
from .metadata import FORBIDDEN_FIELDS

HARNESS_OUTCOME_ROW_SCHEMA_VERSION = "harness_outcome_row/v1"
INTEGRATION_VERSION = "hokusai-openhands-example/0.1.0"
HARNESS_OUTCOME_ROW_FIELDS_PY = (
    "schema_version",
    "task_descriptor",
    "allowed_models",
    "selected_models",
    "budget_usd",
    "actual_cost_usd",
    "wall_clock_seconds",
    "completion_result",
    "success_under_budget",
    "inference_log_id",
    "harness",
    "task_id",
    "observed_at",
    "harness_metadata",
)


class SelectedModels(TypedDict, total=False):
    coder: str
    reviewer: str


class HarnessMetadata(TypedDict, total=False):
    harness: str
    sdk_version: str


class HarnessOutcomeRow(TypedDict, total=False):
    schema_version: str
    task_descriptor: dict[str, Any]
    allowed_models: list[str]
    selected_models: SelectedModels
    budget_usd: float
    actual_cost_usd: float
    wall_clock_seconds: float
    completion_result: str
    success_under_budget: bool
    inference_log_id: str
    harness: str
    task_id: str
    observed_at: str
    harness_metadata: HarnessMetadata


@dataclass(frozen=True)
class ContributionMetrics:
    actual_cost_usd: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    latency_seconds: float | None = None
    completion_result: str | None = None


@dataclass(frozen=True)
class RouteContext:
    route_id: str | None
    selected_model: str | None
    selected_key: str | None
    selected_usage_id: str | None
    allowed_models: list[str]
    fallback_used: bool
    recommended_model: str | None
    idempotency_key: str
    routing_metadata: dict[str, Any]
    error_type: str | None = None


def _coerce_cost(value: float | None) -> float | None:
    if value is None or not isfinite(value) or value < 0:
        return None
    return float(value)


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


def assert_safe_contribution_row(row: Mapping[str, Any]) -> None:
    keys = set(row)
    if not keys.issubset(HARNESS_OUTCOME_ROW_FIELDS_PY):
        extra = sorted(keys - set(HARNESS_OUTCOME_ROW_FIELDS_PY))
        raise PromptLeakageError(f"Contribution row contains unsupported keys: {extra}")

    forbidden = sorted(_deep_key_scan(row) & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Contribution row contains forbidden keys: {forbidden}")


def build_harness_outcome_row(
    *,
    task_descriptor: Mapping[str, Any],
    route_context: RouteContext,
    metrics: ContributionMetrics,
    completion_result: str | None = None,
    budget_usd: float | None = None,
    task_id: str | None = None,
    observed_at: str | None = None,
    harness: str = "openhands",
    sdk_version: str = INTEGRATION_VERSION,
) -> HarnessOutcomeRow:
    if not task_descriptor:
        raise ValueError("task_descriptor must not be empty")
    if not route_context.allowed_models:
        raise ValueError("allowed_models must not be empty")
    if not route_context.selected_model:
        raise ValueError("route_context.selected_model is required")

    resolved_completion_result = completion_result or metrics.completion_result or "failure"
    row: HarnessOutcomeRow = {
        "schema_version": HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
        "task_descriptor": dict(task_descriptor),
        "allowed_models": list(route_context.allowed_models),
        "selected_models": {
            "coder": route_context.selected_model,
            "reviewer": route_context.selected_model,
        },
        "completion_result": resolved_completion_result,
        "harness": harness,
        "observed_at": observed_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "harness_metadata": {
            "harness": harness,
            "sdk_version": sdk_version,
        },
    }

    normalized_budget = _coerce_cost(budget_usd)
    if normalized_budget is not None:
        row["budget_usd"] = normalized_budget

    normalized_cost = _coerce_cost(metrics.actual_cost_usd)
    if normalized_cost is not None:
        row["actual_cost_usd"] = normalized_cost

    if metrics.latency_seconds is not None and metrics.latency_seconds >= 0:
        row["wall_clock_seconds"] = float(metrics.latency_seconds)

    if resolved_completion_result != "success":
        row["success_under_budget"] = False
    elif normalized_budget is not None and normalized_cost is not None:
        row["success_under_budget"] = normalized_cost <= normalized_budget

    if task_id:
        row["task_id"] = task_id

    if route_context.route_id:
        row["inference_log_id"] = route_context.route_id

    _ = metrics.prompt_tokens, metrics.completion_tokens, metrics.total_tokens
    assert_safe_contribution_row(row)
    return row


def build_contribution_request(row: Mapping[str, Any], *, idempotency_key: str) -> dict[str, Any]:
    return {
        "rows": [dict(row)],
        "metadata": {"idempotency_key": idempotency_key},
    }
