from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from math import isfinite
from typing import Any, TypedDict

from .errors import PromptLeakageError
from .metadata import FORBIDDEN_FIELDS

HARNESS_OUTCOME_ROW_SCHEMA_VERSION = "harness_outcome_row/v1"
INTEGRATION_VERSION = "hokusai-openhands-example/0.1.0"
HARNESS_NAME = "openhands"

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

_ALLOWED_HARNESS_METADATA_KEYS = frozenset(
    {
        "harness",
        "sdk_version",
        "openhands_sdk_version",
        "routing_key",
        "recommended_model",
        "fallback_used",
        "fallback_reason",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "error_type",
    }
)


class SelectedModels(TypedDict, total=False):
    coder: str
    reviewer: str


class HarnessMetadata(TypedDict, total=False):
    harness: str
    sdk_version: str
    openhands_sdk_version: str
    routing_key: str
    recommended_model: str
    fallback_used: bool
    fallback_reason: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    error_type: str


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


def _coerce_cost(value: float | None) -> float | None:
    if value is None:
        return None
    if not isfinite(value) or value < 0:
        return None
    return float(value)


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


def assert_safe_contribution_row(row: Mapping[str, Any]) -> None:
    keys = set(row)
    if not keys.issubset(HARNESS_OUTCOME_ROW_FIELDS_PY):
        extra = sorted(keys - set(HARNESS_OUTCOME_ROW_FIELDS_PY))
        raise PromptLeakageError(f"Contribution row contains unsupported keys: {extra}")

    forbidden = sorted(_deep_key_scan(row) & FORBIDDEN_FIELDS)
    if forbidden:
        raise PromptLeakageError(f"Contribution row contains forbidden keys: {forbidden}")

    harness_metadata = row.get("harness_metadata")
    if isinstance(harness_metadata, Mapping):
        extra_meta = sorted(set(harness_metadata) - _ALLOWED_HARNESS_METADATA_KEYS)
        if extra_meta:
            raise PromptLeakageError(
                f"harness_metadata contains disallowed keys: {extra_meta}"
            )


def build_harness_outcome_row(
    *,
    task_descriptor: Mapping[str, Any],
    allowed_models: list[str],
    selected_model: str,
    completion_result: str,
    cost_usd: float | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    wall_clock_seconds: float,
    budget_usd: float | None = None,
    inference_log_id: str | None = None,
    task_id: str | None = None,
    observed_at: str | None = None,
    reviewer_model: str | None = None,
    harness_metadata: Mapping[str, Any] | None = None,
    harness: str = HARNESS_NAME,
    sdk_version: str = INTEGRATION_VERSION,
) -> HarnessOutcomeRow:
    if not task_descriptor:
        raise ValueError("task_descriptor must not be empty")
    if not allowed_models:
        raise ValueError("allowed_models must not be empty")

    normalized_cost = _coerce_cost(cost_usd)
    normalized_budget = _coerce_cost(budget_usd)

    meta_payload: dict[str, Any] = {
        "harness": harness,
        "sdk_version": sdk_version,
    }
    if harness_metadata:
        for key, value in harness_metadata.items():
            if key in _ALLOWED_HARNESS_METADATA_KEYS and value is not None:
                meta_payload[key] = value

    if prompt_tokens is not None and "prompt_tokens" not in meta_payload:
        meta_payload["prompt_tokens"] = int(prompt_tokens)
    if completion_tokens is not None and "completion_tokens" not in meta_payload:
        meta_payload["completion_tokens"] = int(completion_tokens)
    if (
        prompt_tokens is not None
        and completion_tokens is not None
        and "total_tokens" not in meta_payload
    ):
        meta_payload["total_tokens"] = int(prompt_tokens) + int(completion_tokens)

    row: HarnessOutcomeRow = {
        "schema_version": HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
        "task_descriptor": dict(task_descriptor),
        "allowed_models": list(allowed_models),
        "selected_models": {
            "coder": selected_model,
            "reviewer": reviewer_model or selected_model,
        },
        "completion_result": completion_result,
        "wall_clock_seconds": max(0.0, float(wall_clock_seconds)),
        "harness": harness,
        "observed_at": observed_at
        or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "harness_metadata": meta_payload,  # type: ignore[typeddict-item]
    }

    if normalized_budget is not None:
        row["budget_usd"] = normalized_budget

    if normalized_cost is not None:
        row["actual_cost_usd"] = normalized_cost

    if completion_result != "success":
        row["success_under_budget"] = False
    elif normalized_budget is not None and normalized_cost is not None:
        row["success_under_budget"] = normalized_cost <= normalized_budget

    if inference_log_id:
        row["inference_log_id"] = inference_log_id
    if task_id:
        row["task_id"] = task_id

    assert_safe_contribution_row(row)
    return row


def build_contribution_request(row: Mapping[str, Any], *, idempotency_key: str) -> dict[str, Any]:
    return {
        "rows": [dict(row)],
        "metadata": {"idempotency_key": idempotency_key},
    }
