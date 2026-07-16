from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from hokusai_litellm.callback import HokusaiContributionLogger
from hokusai_litellm.contribution import (
    HARNESS_OUTCOME_ROW_FIELDS_PY,
    build_harness_outcome_row,
)
from hokusai_litellm.hokusai_client import HokusaiHttpClient


def test_build_harness_outcome_row_success_case() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        allowed_models=["gpt-4o-mini", "gpt-4o"],
        selected_model="gpt-4o-mini",
        completion_result="success",
        cost_usd=0.0021,
        prompt_tokens=120,
        completion_tokens=340,
        latency_ms=320.0,
        budget_usd=0.01,
        inference_log_id="route-1",
        task_id="task-1",
        observed_at="2026-07-16T12:00:00Z",
    )

    assert set(row).issubset(HARNESS_OUTCOME_ROW_FIELDS_PY)
    assert row["selected_models"] == {"coder": "gpt-4o-mini", "reviewer": "gpt-4o-mini"}
    assert row["success_under_budget"] is True
    assert row["actual_cost_usd"] == 0.0021


def test_build_harness_outcome_row_failure_case_omits_missing_cost() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        allowed_models=["gpt-4o-mini"],
        selected_model="gpt-4o-mini",
        completion_result="failure",
        cost_usd=None,
        prompt_tokens=None,
        completion_tokens=None,
        latency_ms=-5.0,
    )

    assert row["completion_result"] == "failure"
    assert row["success_under_budget"] is False
    assert row["wall_clock_seconds"] == 0.0
    assert "actual_cost_usd" not in row


@pytest.mark.parametrize(
    ("hidden_cost", "top_level_cost", "expected"),
    [
        (0.0021, None, 0.0021),
        (None, 0.0042, 0.0042),
        (None, None, None),
        (0.0, None, 0.0),
    ],
)
def test_callback_uses_cost_fallbacks(
    hidden_cost: float | None,
    top_level_cost: float | None,
    expected: float | None,
) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"accepted": True}))
    client = HokusaiHttpClient("k_test", "https://api.hokus.ai", transport=transport)
    callback = HokusaiContributionLogger(client)
    kwargs = {
        "model": "gpt-4o-mini",
        "response_cost": top_level_cost,
        "metadata": {
            "task_type": "bugfix",
            "task_id": "task-1",
            "hokusai": {
                "selected_model_id": "gpt-4o-mini",
                "allowed_deployment_names": ["gpt-4o-mini", "gpt-4o"],
                "idempotency_key": "idem-1",
            },
        },
    }
    response = {
        "usage": {"prompt_tokens": 120, "completion_tokens": 340},
        "_hidden_params": {},
    }
    if hidden_cost is not None:
        response["_hidden_params"]["response_cost"] = hidden_cost

    callback.log_success_event(
        kwargs,
        response,
        datetime.now(timezone.utc),
        datetime.now(timezone.utc) + timedelta(milliseconds=200),
    )

    assert callback.last_row is not None
    assert callback.last_row.get("actual_cost_usd") == expected


def test_callback_failure_path_records_error_type_without_message() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"accepted": True}))
    client = HokusaiHttpClient("k_test", "https://api.hokus.ai", transport=transport)
    callback = HokusaiContributionLogger(client)
    kwargs = {
        "model": "gpt-4o-mini",
        "metadata": {
            "task_type": "bugfix",
            "task_id": "task-1",
            "hokusai": {
                "selected_model_id": "gpt-4o-mini",
                "allowed_deployment_names": ["gpt-4o-mini"],
                "idempotency_key": "idem-1",
            },
        },
    }
    error = RuntimeError("SECRET_PROMPT_TOKEN exploded")

    callback.log_failure_event(
        kwargs,
        error,
        datetime.now(timezone.utc),
        datetime.now(timezone.utc),
    )

    assert callback.last_row is not None
    assert callback.last_row["completion_result"] == "failure"
    assert callback.last_telemetry is not None
    assert callback.last_telemetry["error_type"] == "RuntimeError"
    assert "SECRET_PROMPT_TOKEN" not in json.dumps(callback.last_row)


def test_callback_swallows_submission_errors(caplog: pytest.LogCaptureFixture) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = HokusaiHttpClient(
        "k_test",
        "https://api.hokus.ai",
        transport=httpx.MockTransport(handler),
    )
    callback = HokusaiContributionLogger(client)
    kwargs = {
        "model": "gpt-4o-mini",
        "metadata": {
            "task_type": "bugfix",
            "task_id": "task-1",
            "hokusai": {
                "selected_model_id": "gpt-4o-mini",
                "allowed_deployment_names": ["gpt-4o-mini"],
                "idempotency_key": "idem-1",
            },
        },
    }

    callback.log_success_event(
        kwargs,
        {
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "_hidden_params": {"response_cost": 0.0},
        },
        datetime.now(timezone.utc),
        datetime.now(timezone.utc),
    )

    assert "submission failed" in caplog.text.lower()
