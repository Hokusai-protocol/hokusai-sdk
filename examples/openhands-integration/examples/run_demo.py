from __future__ import annotations

import json
import os
import sys
from types import SimpleNamespace
from typing import Any

import httpx


class DemoLLM:
    def __init__(self, *, model: str, usage_id: str) -> None:
        self.model = model
        self.usage_id = usage_id
        self.metrics = None

    def completion(self, messages: list[Any], **_: Any) -> dict[str, str]:
        _ = messages
        return {"model": self.model, "text": f"completed on {self.model}"}


class DemoConversationStats:
    def __init__(self, metrics: Any) -> None:
        self._metrics = metrics

    def get_metrics_for_usage(self, usage_id: str) -> Any:
        _ = usage_id
        return self._metrics


def build_demo_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf8"))
        if request.url.path.endswith("/predict"):
            return httpx.Response(
                200,
                json={
                    "routeId": "route-demo-1",
                    "predictions": {
                        "recommended_strategy": {
                            "model": "openhands/devstral-small-2507",
                            "confidence": 0.91,
                        }
                    },
                    "echo": body,
                },
            )
        if request.url.path.endswith("/contributions"):
            return httpx.Response(200, json={"accepted": True, "body": body})
        raise AssertionError(f"Unexpected request path: {request.url.path}")

    return httpx.MockTransport(handler)


def main() -> int:
    project_root = os.path.dirname(os.path.dirname(__file__))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    from hokusai_openhands import (
        OPENHANDS_SDK_AVAILABLE,
        HokusaiHttpClient,
        HokusaiRouterLLM,
        build_harness_outcome_row,
        extract_metrics,
    )

    require_real_sdk = os.getenv("OPENHANDS_DEMO_REQUIRE_REAL_SDK") == "1"
    if require_real_sdk and not OPENHANDS_SDK_AVAILABLE:
        sys.stderr.write(
            "The real OpenHands SDK is not installed. "
            "Unset OPENHANDS_DEMO_REQUIRE_REAL_SDK or install OpenHands first.\n"
        )
        return 1

    transport = build_demo_transport()
    client = HokusaiHttpClient(
        api_key=os.getenv("HOKUSAI_API_KEY", "k_test"),
        base_url=os.getenv("HOKUSAI_API_BASE_URL", "https://api.hokus.ai"),
        transport=transport,
    )

    fast_llm = DemoLLM(
        model="openhands/devstral-small-2507",
        usage_id="agent-fast",
    )
    expensive_llm = DemoLLM(
        model="openhands/claude-sonnet-4-5-20250929",
        usage_id="agent-quality",
    )

    router = HokusaiRouterLLM(
        client=client,
        llms_for_routing={
            "fast": fast_llm,
            "quality": expensive_llm,
        },
        metadata_provider=lambda _: {
            "task_type": "bugfix",
            "estimated_output_tokens": 320,
            "quality_tier": "speed",
            "requires_tools": True,
        },
        fallback_model="fast",
    )

    response = router.completion(messages=[{"role": "user", "content": "ignored locally"}])
    route_context = router.last_route_context
    if route_context is None:
        raise RuntimeError("Router did not persist route context")

    token_usage = SimpleNamespace(prompt_tokens=120, completion_tokens=340)
    metrics = SimpleNamespace(
        accumulated_cost=0.0042,
        accumulated_token_usage=token_usage,
        wall_clock_seconds=1.25,
        response_latencies=[SimpleNamespace(latency=1.25)],
    )
    conversation = SimpleNamespace(
        state=SimpleNamespace(
            execution_status=SimpleNamespace(value="finished"),
            stats=DemoConversationStats(metrics),
        )
    )

    extracted = extract_metrics(
        llm=router.active_llm,
        conversation=conversation,
        usage_id=route_context.selected_usage_id,
    )
    row = build_harness_outcome_row(
        task_descriptor={"task_type": "bugfix"},
        route_context=route_context,
        metrics=extracted.as_contribution_metrics(),
        task_id="demo-task-1",
    )
    submission = client.submit_contribution(
        row,
        idempotency_key=route_context.idempotency_key,
    )

    print(f"Selected model: {route_context.selected_model}")
    print(f"Completion response: {response['text']}")
    print(json.dumps(row, indent=2, sort_keys=True))
    print(json.dumps(submission, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
