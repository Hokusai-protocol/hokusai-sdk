from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import httpx

from hokusai_litellm import HokusaiContributionLogger, HokusaiHttpClient, HokusaiRoutingStrategy


def create_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/predict"):
            return httpx.Response(
                200,
                json={
                    "predictions": {
                        "recommended_strategy": {
                            "coder_model": "gpt-4o-mini",
                            "confidence": 0.8,
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
    deployments = [
        {"model_name": "gpt-4o-mini", "litellm_params": {"model": "openai/gpt-4o-mini"}},
        {"model_name": "gpt-4o", "litellm_params": {"model": "openai/gpt-4o"}},
    ]
    strategy = HokusaiRoutingStrategy(client, deployments, latency_budget_ms=600, budget_usd=0.02)
    callback = HokusaiContributionLogger(client)

    request_kwargs = {
        "model": "router-group",
        "messages": [{"role": "user", "content": "SECRET_PROMPT_TOKEN"}],
        "metadata": {"task_type": "bugfix", "task_id": "demo-task", "estimated_input_tokens": 120},
    }
    deployment = await strategy.async_get_available_deployment(
        model="router-group",
        messages=request_kwargs["messages"],
        request_kwargs=request_kwargs,
    )

    response = {
        "model": deployment["litellm_params"]["model"],
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 240,
        },
        "_hidden_params": {"response_cost": 0.0021},
    }
    start_time = datetime.now(timezone.utc)
    end_time = start_time + timedelta(milliseconds=180)
    await callback.async_log_success_event(request_kwargs, response, start_time, end_time)

    print(json.dumps({"routing_decision": deployment}, indent=2))
    print(json.dumps({"contribution_row": callback.last_row}, indent=2))
    print(json.dumps({"telemetry": callback.last_telemetry, "response": response}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
