# Time-Off Microservice

NestJS + SQLite microservice for employee time-off requests. The HCM
(Workday / SAP-class) is the authoritative source of truth for
balances; this service owns the request lifecycle (create, approve,
reject, cancel), exposes an overlay balance view, and defends against
HCM drift via an outbox worker that retries failed pushes and a
batch-intake endpoint that detects and halts approvals on dimensions
where the new HCM corpus would contradict already-committed local
deductions. Balance integrity under concurrent writes and partial
failures is the central engineering concern — not CRUD.

## Stack

- Node.js 22+
- NestJS 11 (TypeScript 5.7 strict)
- SQLite via `better-sqlite3` (WAL journal mode)
- Drizzle ORM + `drizzle-kit` for schema + migrations
- `class-validator` + `class-transformer` for DTO contracts
- Jest 29 + `supertest` for unit / integration / e2e tests
- Standalone Express mock HCM for e2e scenario injection

## Quick start

```bash
npm install
npm run start:dev          # Nest with file watch on http://localhost:3000
```

Environment variables (all optional):

| Variable          | Default                    | Purpose                                                                                                                                                                                                       |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `3000`                     | HTTP port the Nest app binds to.                                                                                                                                                                              |
| `DB_PATH`         | `./wizdaa.db`              | SQLite file path.                                                                                                                                                                                             |
| `HCM_BASE_URL`    | falls back to `HCM_MOCK_URL` then `http://127.0.0.1:4100` | Base URL the `HcmClient` uses to reach the real or mocked HCM for the outbound realtime mutation endpoint.                                                                     |
| `HCM_MOCK_URL`    | _(unset)_                  | Used as the `HcmClient` base URL when `HCM_BASE_URL` is unset — convenient for local runs against the mock without touching prod env vars.                                                                    |
| `HCM_TIMEOUT_MS`  | `2000`                     | Bounded fetch timeout for each outbound HCM call. Exceeding it produces a `transient` result that flows into the outbox's `failed_retryable` state (TRD §5).                                                  |
| `HCM_MOCK_PORT`   | `4000`                     | Port the standalone mock HCM binds when started via `npm run hcm-mock`. The e2e globalSetup uses `4100` to avoid collisions with a manually-started mock.                                                      |
| `NODE_ENV`        | _(unset / `production`)_   | When set to `test` the `HcmOutboxWorker` does **not** auto-start its polling `setInterval` in `onModuleInit`. Jest sets this automatically; set it manually in any test harness that boots the real `AppModule`. |

Database workflow:

```bash
npm run db:generate        # drizzle-kit reads src/database/schema.ts,
                           # emits SQL migration files under ./drizzle
npm run db:migrate         # applies pending migrations to DB_PATH
```

Mock HCM (for manual testing or when running the service against a
stubbed external system):

```bash
npm run hcm-mock           # starts the Express mock on HCM_MOCK_PORT
```

## Project structure

```
src/
├── main.ts                      Nest bootstrap (global ValidationPipe)
├── app.module.ts                Root module
└── database/                    Drizzle schema, connection, migration runner,
                                 Nest DatabaseModule

test/
├── integration/                 Service + repo with a real temp-file SQLite
├── e2e/                         Full Nest app via supertest against mock HCM
└── jest-e2e.config.ts

scripts/
└── hcm-mock/                    Standalone Express mock HCM (TRD §3, §9)
```

Architecture boundaries, module responsibilities, and the assumed HCM
contract live in [TRD.md](./TRD.md) §2 and §3.

## Testing

The test pyramid is declared in [TRD.md](./TRD.md) §8. Summary:

- **Unit** (`*.spec.ts` co-located with source) — pure domain logic, no
  Nest, no DB.
- **Integration** (`test/integration/`) — service + repos against a
  temp-file SQLite with real migrations applied.
- **E2E** (`test/e2e/`) — full Nest app over HTTP, talking to the mock
  HCM server.

```bash
npm test                   # unit + integration
npm run test:watch
npm run test:cov           # with coverage report in ./coverage
npm run test:e2e           # e2e suite (starts mock HCM via globalSetup)
```

Coverage targets: domain layer ≥ 95 %, services ≥ 90 % (see
[TRD.md](./TRD.md) §8).

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
