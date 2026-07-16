from __future__ import annotations

from hokusai_openhands.contribution import (
    HARNESS_OUTCOME_ROW_FIELDS_PY,
    ContributionMetrics,
    RouteContext,
    build_contribution_request,
    build_harness_outcome_row,
)

ROUTE_CONTEXT = RouteContext(
    route_id="route-1",
    selected_model="openhands/devstral-small-2507",
    selected_key="fast",
    selected_usage_id="agent-fast",
    allowed_models=[
        "openhands/devstral-small-2507",
        "openhands/claude-sonnet-4-5-20250929",
    ],
    fallback_used=False,
    recommended_model="openhands/devstral-small-2507",
    idempotency_key="idem-1",
    routing_metadata={"task_type": "bugfix"},
)


def test_build_harness_outcome_row_success_case() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        route_context=ROUTE_CONTEXT,
        metrics=ContributionMetrics(
            actual_cost_usd=0.0042,
            prompt_tokens=120,
            completion_tokens=340,
            total_tokens=460,
            latency_seconds=1.4,
            completion_result="success",
        ),
        budget_usd=0.02,
        task_id="task-1",
        observed_at="2026-07-16T12:00:00Z",
    )

    assert set(row).issubset(HARNESS_OUTCOME_ROW_FIELDS_PY)
    assert row["selected_models"] == {
        "coder": "openhands/devstral-small-2507",
        "reviewer": "openhands/devstral-small-2507",
    }
    assert row["actual_cost_usd"] == 0.0042
    assert row["success_under_budget"] is True
    assert row["inference_log_id"] == "route-1"


def test_build_harness_outcome_row_failure_omits_missing_cost() -> None:
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        route_context=ROUTE_CONTEXT,
        metrics=ContributionMetrics(
            actual_cost_usd=None,
            latency_seconds=None,
            completion_result="failure",
        ),
    )

    assert row["completion_result"] == "failure"
    assert row["success_under_budget"] is False
    assert "actual_cost_usd" not in row
    assert "wall_clock_seconds" not in row


def test_build_contribution_request_uses_shared_metadata_shape() -> None:
    request = build_contribution_request(
        {"schema_version": "harness_outcome_row/v1"},
        idempotency_key="idem-1",
    )

    assert request == {
        "rows": [{"schema_version": "harness_outcome_row/v1"}],
        "metadata": {"idempotency_key": "idem-1"},
    }
