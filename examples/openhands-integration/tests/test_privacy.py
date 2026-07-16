from __future__ import annotations

import json
from types import SimpleNamespace

from hokusai_openhands import (
    ALLOWED_ROUTING_FIELDS,
    FORBIDDEN_FIELDS,
    HokusaiHttpClient,
    HokusaiRouterLLM,
    build_harness_outcome_row,
    extract_metrics,
)
from tests.conftest import collect_keys

SECRETS = {
    "SECRET_PROMPT_TOKEN",
    "SECRET_SYSTEM_TOKEN",
    "SECRET_TOOL_ARG",
    "SECRET_COMPLETION_TOKEN",
}


class FakeLLM:
    def __init__(self, *, model: str, usage_id: str) -> None:
        self.model = model
        self.usage_id = usage_id

    def completion(self, messages: list[object], **_: object) -> dict[str, str]:
        _ = messages
        return {"text": "SECRET_COMPLETION_TOKEN never leaves the host"}


class FakeConversationStats:
    def __init__(self, metrics: object) -> None:
        self._metrics = metrics

    def get_metrics_for_usage(self, usage_id: str) -> object:
        _ = usage_id
        return self._metrics


def test_end_to_end_requests_never_send_prompt_or_completion_content(
    tracking_transport,
) -> None:
    client = HokusaiHttpClient(
        api_key="k_test",
        base_url="https://api.hokus.ai",
        transport=tracking_transport,
    )
    router = HokusaiRouterLLM(
        client=client,
        llms_for_routing={
            "fast": FakeLLM(
                model="openhands/devstral-small-2507",
                usage_id="agent-fast",
            )
        },
        metadata_provider=lambda _: {
            "task_type": "bugfix",
            "requires_tools": True,
        },
    )

    router.completion(
        messages=[
            {"role": "user", "content": "SECRET_PROMPT_TOKEN"},
            {"role": "system", "content": "SECRET_SYSTEM_TOKEN"},
        ]
    )
    assert router.last_route_context is not None

    metrics = SimpleNamespace(
        accumulated_cost=0.0021,
        accumulated_token_usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        wall_clock_seconds=0.4,
        response_latencies=[SimpleNamespace(latency=0.4)],
    )
    conversation = SimpleNamespace(
        state=SimpleNamespace(
            execution_status=SimpleNamespace(value="finished"),
            stats=FakeConversationStats(metrics),
        )
    )
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        route_context=router.last_route_context,
        metrics=extract_metrics(
            llm=router.active_llm,
            conversation=conversation,
            usage_id=router.last_route_context.selected_usage_id,
        ).as_contribution_metrics(),
    )
    client.submit_contribution(
        row,
        idempotency_key=router.last_route_context.idempotency_key,
    )

    assert len(tracking_transport.requests) == 2

    for captured in tracking_transport.requests:
        serialized = json.dumps(captured["body"])
        for secret in SECRETS:
            assert secret not in serialized
        assert not (collect_keys(captured["body"]) & FORBIDDEN_FIELDS)

    routing_body = tracking_transport.requests[0]["body"]
    contribution_body = tracking_transport.requests[1]["body"]
    assert set(routing_body["safe_metadata"]).issubset(ALLOWED_ROUTING_FIELDS)
    assert "SECRET_PROMPT_TOKEN" not in json.dumps(contribution_body)
