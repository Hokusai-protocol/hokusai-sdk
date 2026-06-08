# Payload Schemas

`@hokusai/core` exposes TypeScript-first payload contracts for:

- task input
- dispatch payload
- outcome payload
- consent snapshots
- correlation records
- model definitions

## Route and outcome wire schemas

For live API calls, `@hokusai/core` also exports typed request/response schemas
with local runtime validators:

| Type | Validator | Description |
|---|---|---|
| `RouteRequest` | `validateRouteRequest` | POST to `/v1/route` |
| `RouteResponse` | `validateRouteResponse` | Response from `/v1/route` |
| `OutcomeRequest` | `validateOutcomeRequest` | POST to `/v1/outcomes` |
| `OutcomeResponse` | `validateOutcomeResponse` | Response from `/v1/outcomes` |

Validators return the typed value on success, or an array of `HokusaiValidationIssue`
objects on failure. `HokusaiClient` applies these validators before every network call
and after every response parse.
