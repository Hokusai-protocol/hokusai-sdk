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
    """Records outbound requests and answers with canonical fixture responses.

    Route responses default to a valid recommendation with ``route_id``; use
    ``queue_route_response`` to override on a per-call basis.
    """

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._queued_routes: list[dict[str, Any]] = []

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
                payload: dict[str, Any]
                if self._queued_routes:
                    payload = self._queued_routes.pop(0)
                else:
                    payload = {
                        "predictions": {
                            "recommended_strategy": {
                                "coder_model": "gpt-4o-mini",
                                "confidence": 0.82,
                            }
                        },
                        "metadata": {"route_id": "route-openhands-1"},
                    }
                return httpx.Response(200, json=payload)
            if request.url.path.endswith("/contributions"):
                return httpx.Response(
                    200,
                    json={"accepted": True, "rowFidelityTiers": ["training_eligible"]},
                )
            raise AssertionError(f"Unexpected request path: {request.url.path}")

        super().__init__(handler)

    def queue_route_response(self, payload: dict[str, Any]) -> None:
        self._queued_routes.append(payload)


@pytest.fixture
def route_fixture() -> dict[str, Any]:
    return load_fixture("route_response.json")


@pytest.fixture
def metrics_fixture() -> dict[str, Any]:
    return load_fixture("openhands_metrics.json")


@pytest.fixture
def schema_fixture() -> dict[str, Any]:
    return load_fixture("harness_outcome_row_schema.json")


@pytest.fixture
def tracking_transport() -> Iterator[TrackingTransport]:
    yield TrackingTransport()
