"""Minimal offline demo for the Hokusai OpenHands adapter.

Runs against a mocked Hokusai backend (no network) and either an installed
OpenHands ``RouterLLM`` or a fake router when the SDK is unavailable, and
prints the routing decision, cost/token snapshot, and submitted contribution
row.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta

import httpx

from hokusai_openhands import (
    HokusaiHttpClient,
    HokusaiOutcomeReporter,
    HokusaiRouteResolver,
    ModelBinding,
)


def create_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/predict"):
            return httpx.Response(
                200,
                json={
                    "predictions": {
                        "recommended_strategy": {
                            "coder_model": "gpt-4o-mini",
                            "confidence": 0.83,
                        }
                    },
                    "metadata": {"route_id": "demo-route-1"},
                },
            )
        if request.url.path.endswith("/contributions"):
            return httpx.Response(
                200,
                json={
                    "accepted": True,
                    "rowFidelityTiers": ["training_eligible"],
                },
            )
        raise AssertionError(f"Unhandled path: {request.url.path}")

    return httpx.MockTransport(handler)


async def main() -> None:
    transport = create_transport()
    client = HokusaiHttpClient(
        api_key=os.getenv("HOKUSAI_API_KEY", "k_demo"),
        base_url=os.getenv("HOKUSAI_API_BASE_URL", "https://api.hokus.ai"),
        transport=transport,
    )

    resolver = HokusaiRouteResolver(
        client=client,
        bindings=[
            ModelBinding(key="gpt-4o-mini", model_id="openai/gpt-4o-mini"),
            ModelBinding(key="claude-4", model_id="anthropic/claude-4"),
        ],
        latency_budget_ms=600,
        budget_usd=0.02,
        unavailable_policy="fallback",
        fallback_key="gpt-4o-mini",
        task_metadata_provider=lambda: {"task_type": "bugfix"},
    )

    decision = await resolver.route_call_async(message_count=4)
    print(
        json.dumps(
            {
                "routing_decision": {
                    "routing_key": decision.routing_key,
                    "model_id": decision.model_id,
                    "route_id": decision.route_id,
                    "fallback_used": decision.fallback_used,
                }
            },
            indent=2,
        )
    )

    reporter = HokusaiOutcomeReporter(client, resolver, openhands_sdk_version="1.36.1")
    started_at = datetime.now(UTC)
    ended_at = started_at + timedelta(milliseconds=420)

    row = await reporter.async_report(
        decision=decision,
        metrics={
            "accumulated_cost": 0.0021,
            "accumulated_token_usage": {"prompt_tokens": 128, "completion_tokens": 342},
            "response_latencies": [0.42],
        },
        started_at=started_at,
        ended_at=ended_at,
        completion_result="success",
        task_id="demo-task",
    )

    print(json.dumps({"contribution_row": row}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
