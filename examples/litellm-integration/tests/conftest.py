from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES_DIR / name).read_text("utf8"))


def collect_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            keys.add(str(key))
            keys.update(collect_keys(child))
    elif isinstance(value, list):
        for item in value:
            keys.update(collect_keys(item))
    return keys


class TrackingTransport(httpx.MockTransport):
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content.decode("utf8"))
            self.requests.append(
                {
                    "path": request.url.path,
                    "headers": dict(request.headers),
                    "body": body,
                }
            )
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
                        "metadata": {"route_id": "route-1"},
                    },
                )
            if request.url.path.endswith("/contributions"):
                return httpx.Response(
                    200,
                    json={"accepted": True, "rowFidelityTiers": ["training_eligible"]},
                )
            raise AssertionError(f"Unexpected request path: {request.url.path}")

        super().__init__(handler)


@pytest.fixture
def litellm_kwargs() -> dict[str, Any]:
    return load_fixture("litellm_kwargs.json")


@pytest.fixture
def litellm_response() -> dict[str, Any]:
    return load_fixture("litellm_response.json")


@pytest.fixture
def schema_fixture() -> dict[str, Any]:
    return load_fixture("harness_outcome_row_schema.json")


@pytest.fixture
def tracking_transport() -> Iterator[TrackingTransport]:
    yield TrackingTransport()
