from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from hokusai_litellm.callback import HokusaiContributionLogger
from hokusai_litellm.contribution import HARNESS_OUTCOME_ROW_FIELDS_PY
from hokusai_litellm.hokusai_client import HokusaiHttpClient
from hokusai_litellm.metadata import ALLOWED_ROUTING_FIELDS, FORBIDDEN_FIELDS
from hokusai_litellm.router_strategy import HokusaiRoutingStrategy
from tests.conftest import collect_keys

SECRETS = {
    "SECRET_PROMPT_TOKEN",
    "SECRET_SYSTEM_TOKEN",
    "SECRET_TOOL_ARG",
    "SECRET_COMPLETION_TOKEN",
    "SECRET_BACKDOOR",
}


@pytest.mark.asyncio
async def test_end_to_end_requests_never_send_prompt_or_completion_content(
    litellm_kwargs: dict[str, object],
    litellm_response: dict[str, object],
    tracking_transport,
) -> None:
    client = HokusaiHttpClient(
        api_key="k_test",
        base_url="https://api.hokus.ai",
        transport=tracking_transport,
    )
    strategy = HokusaiRoutingStrategy(
        client,
        [
            {
                "model_name": "gpt-4o-mini",
                "litellm_params": {"model": "openai/gpt-4o-mini"},
            }
        ],
    )
    callback = HokusaiContributionLogger(client)

    await strategy.async_get_available_deployment(
        model="router-group",
        messages=litellm_kwargs["messages"],  # type: ignore[index]
        request_kwargs=litellm_kwargs,
    )
    await callback.async_log_success_event(
        litellm_kwargs,
        litellm_response,
        datetime.now(timezone.utc),
        datetime.now(timezone.utc) + timedelta(milliseconds=180),
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
    assert set(contribution_body["rows"][0]).issubset(HARNESS_OUTCOME_ROW_FIELDS_PY)
    assert "custom_prompt_backdoor" not in json.dumps(routing_body)
