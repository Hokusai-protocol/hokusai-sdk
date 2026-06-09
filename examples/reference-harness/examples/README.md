# Example Payloads

These JSON files are fake, safe-to-publish examples of the normalized payloads used in the Hokusai route/report loop.

- `task-packet.example.json` is a valid `TaskPacket`.
- `outcome-report.example.json` is a valid `OutcomeReport`.

The reference harness test suite validates both files with `validateTaskPacket` and `validateOutcomeReport` from `@hokusai/core`.
