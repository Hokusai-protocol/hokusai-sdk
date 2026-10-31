/**
 * TypeScript mirror of `packages/core/schemas/task-attempt.v1.schema.json` so
 * npm consumers can use the schema without the repo checkout. The JSON file is
 * canonical; a contract test asserts the two are deep-equal.
 */

type JsonSchema = Readonly<Record<string, unknown>>;

export const TASK_ATTEMPT_V1_JSON_SCHEMA = Object.freeze(
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "task-attempt.v1.schema.json",
    "title": "TaskAttemptLogEntryV1",
    "description": "Attempt identity for the task-cost contract (task_attempt/v1, contract 1.1.0, HOK-3372). One schema, four record types discriminated by record_type: attempt (the launch of a minted pair, arm, run or stage attempt), control (a write that changes execution state; accepted only for the current, unsettled attempt), evidence (a write that describes an attempt; always accepted against its own identity) and derived (a result computed from evidence versions). IDs are minted UUIDs or ULIDs, never derived. Single-record shape only: currency, settlement and edge targets are reducer rules (reduceTaskAttemptLog). Rules: packages/core/src/task-cost/attempt-identity.md. Readers ignore unknown fields.",
    "oneOf": [
      {
        "$ref": "#/$defs/attempt"
      },
      {
        "$ref": "#/$defs/control"
      },
      {
        "$ref": "#/$defs/evidence"
      },
      {
        "$ref": "#/$defs/derived"
      }
    ],
    "$defs": {
      "schemaVersion": {
        "const": "task_attempt/v1"
      },
      "mintedId": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25})$",
        "description": "Lowercase RFC 9562 UUID (v7 recommended) or ULID, minted before the launch. Never computed from a head, timestamp or session."
      },
      "identifier": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_-]{0,63}$"
      },
      "utcTimestamp": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$"
      },
      "gitSha": {
        "type": "string",
        "pattern": "^(?:[0-9a-f]{40}|[0-9a-f]{64})$"
      },
      "evidenceKind": {
        "enum": [
          "executed_model",
          "session_resolution",
          "cost",
          "review_findings",
          "check_run",
          "code_identity"
        ]
      },
      "evidenceVersion": {
        "type": "integer",
        "minimum": 1
      },
      "codeIdentity": {
        "type": "object",
        "description": "The code an attempt saw. Associated with the attempt, never part of its identity.",
        "properties": {
          "head_sha": {
            "$ref": "#/$defs/gitSha"
          },
          "base_sha": {
            "$ref": "#/$defs/gitSha"
          },
          "change_id": {
            "type": "string",
            "pattern": "^[a-z0-9-]{1,16}:[0-9a-f]{16,128}$"
          }
        }
      },
      "sessionRef": {
        "type": "object",
        "required": [
          "harness",
          "session_id"
        ],
        "properties": {
          "harness": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9-]{0,31}$"
          },
          "session_id": {
            "$ref": "#/$defs/identifier"
          },
          "resolves": {
            "type": "string",
            "pattern": "^pending:[A-Za-z0-9._-]{1,120}$"
          }
        },
        "if": {
          "required": [
            "resolves"
          ]
        },
        "then": {
          "properties": {
            "session_id": {
              "not": {
                "pattern": "^pending:"
              }
            }
          }
        }
      },
      "sessionRefs": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/sessionRef"
        }
      },
      "attemptRef": {
        "type": "object",
        "description": "How any record names the attempt it belongs to. Downstream records embed this instead of defining their own run or attempt id.",
        "required": [
          "task_id",
          "run_id"
        ],
        "properties": {
          "task_id": {
            "$ref": "#/$defs/identifier"
          },
          "run_id": {
            "$ref": "#/$defs/mintedId"
          },
          "stage_attempt_id": {
            "$ref": "#/$defs/mintedId"
          }
        }
      },
      "attempt": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "kind",
          "id",
          "task_id",
          "parent_id"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "attempt"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "kind": {
            "enum": [
              "pair",
              "arm",
              "run",
              "stage_attempt"
            ]
          },
          "id": {
            "$ref": "#/$defs/mintedId"
          },
          "task_id": {
            "$ref": "#/$defs/identifier"
          },
          "parent_id": {
            "$ref": "#/$defs/identifier"
          },
          "stage": {
            "$ref": "#/$defs/slug"
          },
          "role": {
            "enum": [
              "primary",
              "challenger"
            ]
          },
          "retry_of": {
            "$ref": "#/$defs/mintedId"
          },
          "code_identity": {
            "$ref": "#/$defs/codeIdentity"
          },
          "session_refs": {
            "$ref": "#/$defs/sessionRefs"
          },
          "legacy_ids": {
            "type": "array",
            "description": "Producer-local labels (e.g. Wavemill's kind@head7#epoch). Not unique; never a key.",
            "items": {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:@#-]{0,127}$",
              "not": {
                "pattern": "@[^@]*\\.[A-Za-z]{2,}$"
              }
            }
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "kind": {
                  "const": "stage_attempt"
                }
              }
            },
            "then": {
              "required": [
                "stage"
              ],
              "properties": {
                "parent_id": {
                  "$ref": "#/$defs/mintedId"
                }
              }
            },
            "else": {
              "not": {
                "required": [
                  "stage"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "kind": {
                  "const": "arm"
                }
              }
            },
            "then": {
              "required": [
                "role"
              ],
              "properties": {
                "parent_id": {
                  "$ref": "#/$defs/mintedId"
                }
              }
            },
            "else": {
              "not": {
                "required": [
                  "role"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "kind": {
                  "enum": [
                    "pair",
                    "arm"
                  ]
                }
              }
            },
            "then": {
              "not": {
                "required": [
                  "retry_of"
                ]
              }
            }
          }
        ]
      },
      "control": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "write_id",
          "attempt",
          "action"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "control"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "write_id": {
            "$ref": "#/$defs/mintedId"
          },
          "attempt": {
            "$ref": "#/$defs/attemptRef"
          },
          "action": {
            "enum": [
              "outcome",
              "phase",
              "next_action",
              "linear_transition",
              "merge_decision"
            ]
          },
          "outcome": {
            "enum": [
              "succeeded",
              "failed",
              "aborted",
              "abandoned"
            ]
          },
          "value": {
            "$ref": "#/$defs/slug"
          }
        },
        "if": {
          "properties": {
            "action": {
              "const": "outcome"
            }
          }
        },
        "then": {
          "required": [
            "outcome"
          ],
          "not": {
            "required": [
              "value"
            ]
          }
        },
        "else": {
          "required": [
            "value"
          ],
          "not": {
            "required": [
              "outcome"
            ]
          }
        }
      },
      "evidence": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "write_id",
          "attempt",
          "evidence_kind",
          "evidence_version"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "evidence"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "write_id": {
            "$ref": "#/$defs/mintedId"
          },
          "attempt": {
            "$ref": "#/$defs/attemptRef"
          },
          "evidence_kind": {
            "$ref": "#/$defs/evidenceKind"
          },
          "evidence_version": {
            "$ref": "#/$defs/evidenceVersion"
          },
          "executed_model": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$"
          },
          "session_refs": {
            "$ref": "#/$defs/sessionRefs"
          },
          "code_identity": {
            "$ref": "#/$defs/codeIdentity"
          },
          "cost_event_ids": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/identifier"
            }
          }
        }
      },
      "derived": {
        "type": "object",
        "required": [
          "schema_version",
          "record_type",
          "observed_at",
          "derived_id",
          "derived_kind",
          "inputs"
        ],
        "properties": {
          "schema_version": {
            "$ref": "#/$defs/schemaVersion"
          },
          "record_type": {
            "const": "derived"
          },
          "observed_at": {
            "$ref": "#/$defs/utcTimestamp"
          },
          "derived_id": {
            "$ref": "#/$defs/mintedId"
          },
          "derived_kind": {
            "$ref": "#/$defs/slug"
          },
          "inputs": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": [
                "attempt",
                "evidence_kind",
                "evidence_version"
              ],
              "properties": {
                "attempt": {
                  "$ref": "#/$defs/attemptRef"
                },
                "evidence_kind": {
                  "$ref": "#/$defs/evidenceKind"
                },
                "evidence_version": {
                  "$ref": "#/$defs/evidenceVersion"
                }
              }
            }
          },
          "supersedes": {
            "$ref": "#/$defs/mintedId"
          }
        }
      }
    }
  } as Record<string, unknown>,
) satisfies JsonSchema;
