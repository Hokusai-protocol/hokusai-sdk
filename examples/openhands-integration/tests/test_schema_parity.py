from __future__ import annotations

from hokusai_openhands.contribution import (
    HARNESS_OUTCOME_ROW_FIELDS_PY,
    HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
)


def test_schema_parity(schema_fixture: dict[str, object]) -> None:
    assert set(HARNESS_OUTCOME_ROW_FIELDS_PY) == set(schema_fixture["fields"])  # type: ignore[index]
    assert HARNESS_OUTCOME_ROW_SCHEMA_VERSION == schema_fixture["schemaVersion"]
