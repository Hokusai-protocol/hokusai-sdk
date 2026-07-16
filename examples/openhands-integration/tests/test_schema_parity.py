from __future__ import annotations

from pathlib import Path
from typing import Any

from hokusai_openhands.contribution import (
    HARNESS_OUTCOME_ROW_FIELDS_PY,
    HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
)

LITELLM_SCHEMA = (
    Path(__file__).resolve().parents[3]
    / "litellm-integration"
    / "tests"
    / "fixtures"
    / "harness_outcome_row_schema.json"
)


def test_schema_parity(schema_fixture: dict[str, Any]) -> None:
    assert set(HARNESS_OUTCOME_ROW_FIELDS_PY) == set(schema_fixture["fields"])
    assert HARNESS_OUTCOME_ROW_SCHEMA_VERSION == schema_fixture["schemaVersion"]


def test_schema_parity_matches_canonical_litellm_fixture(
    schema_fixture: dict[str, Any],
) -> None:
    import json

    if not LITELLM_SCHEMA.exists():
        return
    canonical = json.loads(LITELLM_SCHEMA.read_text("utf8"))
    assert set(canonical["fields"]) == set(schema_fixture["fields"])
    assert canonical["schemaVersion"] == schema_fixture["schemaVersion"]
    assert set(canonical["forbiddenKeys"]) == set(schema_fixture["forbiddenKeys"])
