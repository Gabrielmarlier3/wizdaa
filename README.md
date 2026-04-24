# Time-Off Microservice

> TBD: one-paragraph overview once the first slice lands.

NestJS + SQLite microservice for time-off requests, with defensive sync
against an external HCM system. Core engineering concern: balance
consistency, concurrency, idempotency, and resilience to external changes.

## Stack

- Node.js (LTS)
- NestJS
- SQLite
- Jest

## Quick start

> TBD: fill once the project is bootstrapped.

```bash
# npm install
# npm run start:dev
```

## Project structure

> TBD: fill as modules land.

## Testing

> TBD.

```bash
# npm test
# npm run test:e2e
```

## Problem space

Time-off requests live in a system where an external HCM (Workday /
SAP-class) is the authoritative source of truth for employment data and
balances. Balances can change outside this service — work anniversary
bonuses, start-of-year refreshes, direct HR edits. The HCM exposes a
realtime API per `(employeeId, locationId)` and a batch endpoint that
ships the full balance corpus. Its error responses on invalid dimensions
or insufficient balance are helpful but not guaranteed — this service
must validate defensively.

See [TRD.md](./TRD.md) for the full design record, decision log, and
open questions.

## Architecture

See [TRD.md](./TRD.md).

## Engineering principles

See [INSTRUCTIONS.md](./INSTRUCTIONS.md) for scope, decision rules,
priorities, and definition-of-done.
