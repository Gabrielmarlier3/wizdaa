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
npm run db:migrate         # apply Drizzle migrations to ./wizdaa.db
npm run start:dev          # Nest with file watch on http://localhost:3000
```

`db:migrate` must run before the first `start:dev` (or `start` /
`start:prod`). The schema is not auto-applied at boot — without
this step, the server starts but the `HcmOutboxWorker` and every
endpoint that touches the DB will fail with
`no such table: …`.

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
├── main.ts                      Nest bootstrap (global ValidationPipe, UTC).
├── app.module.ts                Root module — wires DatabaseModule,
│                                TimeOffModule, BalanceModule, HcmIngressModule.
├── domain/                      Pure TypeScript — state machine transitions
│                                and balance-projection math. No Nest, no DB.
├── database/                    Drizzle schema, better-sqlite3 connection,
│                                migration runner, DatabaseModule (DATABASE token).
├── time-off/                    Request lifecycle module.
│   ├── dto/                     DTOs for POST /requests.
│   ├── repositories/            balances, holds, approved-deductions, requests.
│   ├── *.use-case.ts            create / approve / reject / cancel / get-request.
│   ├── time-off.controller.ts   POST /requests + /:id/{approve,reject,cancel} + GET /:id.
│   └── errors.ts                RequestNotFoundError, DimensionInconsistentError.
├── balance/                     Overlay projection module.
│   ├── dto/                     Query DTO for GET /balance.
│   ├── get-balance.use-case.ts  Composes hcmBalance + pending + approved-not-yet-pushed.
│   ├── balance.controller.ts    GET /balance.
│   └── errors.ts                BalanceNotFoundError.
└── hcm/                         HCM integration (outbound + inbound).
    ├── repositories/            hcm-outbox + inconsistencies (both HCM concerns).
    ├── dto/                     DTO for POST /hcm/balances/batch.
    ├── hcm.client.ts            Thin fetch wrapper with bounded timeout + idempotency key.
    ├── hcm-outbox-worker.ts     Polling worker — drains failed_retryable rows.
    ├── batch-balance-intake.use-case.ts  Full-corpus replacement + conflict detection.
    ├── hcm-ingress.controller.ts         POST /hcm/balances/batch.
    ├── hcm.module.ts            Client + outbox repo + inconsistencies repo.
    └── hcm-ingress.module.ts    Third module to avoid TimeOff ↔ Hcm cycle (TRD §2).

test/
├── helpers/                     buildTestApp — real temp-file SQLite per test.
├── integration/                 Service + repos against SQLite, no HTTP.
├── e2e/                         Full Nest app via supertest + mock HCM.
│   ├── globalSetup.ts           Starts the mock HCM once per e2e run.
│   └── globalTeardown.ts
└── jest-e2e.config.ts

scripts/
└── hcm-mock/                    Standalone Express mock HCM (TRD §3, §9).

drizzle/                         Generated SQL migrations (0000_*, 0001_*, 0002_*).

docs/                            Process + design artefacts (see Agentic
                                 development process section below).
```

Architecture diagram, module responsibilities, and the assumed HCM
contract live in [TRD.md](./TRD.md) §2 and §3. Why `HcmIngressModule`
exists as a third module (instead of just folding into HcmModule) is
captured in the plan 010 archive under
[`docs/plans/010-batch-intake-and-inconsistency-halt.md`](./docs/plans/010-batch-intake-and-inconsistency-halt.md).

## API reference

Every endpoint is covered by an e2e spec under `test/e2e/`. Error
codes are defined in [TRD.md](./TRD.md) §7; the envelope is
`{ code: string, message: string, ...extras }` unless stated
otherwise.

### `POST /requests` — create a pending request

```http
POST /requests
Content-Type: application/json

{
  "employeeId": "emp-1",
  "locationId": "loc-BR",
  "leaveType": "PTO",
  "startDate": "2026-05-01",
  "endDate": "2026-05-02",
  "days": 2,
  "clientRequestId": "b9d4c1fa-..."   // client UUID for idempotency
}
```

`201 Created` with the full `TimeOffRequest` entity (id, status =
`"pending"`, `hcmSyncStatus = "not_required"`, createdAt, …).

Errors: `400` validation (Nest default envelope), `409
INSUFFICIENT_BALANCE` (overlay projection says no), `422
INVALID_DIMENSION` (no `balances` row for the triple). An idempotent
replay with the same `clientRequestId` returns the same entity rather
than creating a duplicate (TRD §9 *Dual idempotency*).

### `GET /requests/:id` — read one request

`200 OK` with the full `TimeOffRequest` entity.
Errors: `404 REQUEST_NOT_FOUND`, `400` on a non-UUID path param.

### `POST /requests/:id/approve` — pending → approved

No request body. `200 OK` with the updated `TimeOffRequest` whose
`hcmSyncStatus` reflects the inline HCM push outcome
(`"synced"` on happy path, `"pending"` if the push was transient
and the outbox worker will retry, `"failed"` if HCM returned 4xx).

Errors: `404 REQUEST_NOT_FOUND`, `409 INVALID_TRANSITION` (with
`currentStatus` extra so clients can reconcile), `409
INSUFFICIENT_BALANCE`, `422 INVALID_DIMENSION`, `409
DIMENSION_INCONSISTENT` (with `employeeId` / `locationId` /
`leaveType` extras when the dimension was halted by a batch — see
§9 decision 14).

### `POST /requests/:id/reject` — pending → rejected

No body. `200 OK`. Errors: `404 REQUEST_NOT_FOUND`, `409
INVALID_TRANSITION`. Releases the pending hold atomically in the
same transaction.

### `POST /requests/:id/cancel` — pending → cancelled

Same shape as reject. Distinct terminal state (§9 *Cancellation is
a distinct terminal state from rejection*).

### `GET /balance` — overlay breakdown

```
GET /balance?employeeId=emp-1&locationId=loc-BR&leaveType=PTO
```

`200 OK`:

```json
{
  "employeeId": "emp-1",
  "locationId": "loc-BR",
  "leaveType": "PTO",
  "hcmBalance": 10,
  "pendingDays": 2,
  "approvedNotYetPushedDays": 3,
  "availableDays": 5
}
```

All four numeric fields are always present so a client can
reconcile a `POST /requests` 409 in one round-trip (§9 decision
12). Errors: `404 BALANCE_NOT_FOUND`, `400` validation.

### `POST /hcm/balances/batch` — full-corpus balance replacement (HCM → service)

```http
POST /hcm/balances/batch
Content-Type: application/json

{
  "generatedAt": "2026-04-24T12:00:00.000Z",
  "balances": [
    { "employeeId": "emp-1", "locationId": "loc-BR", "leaveType": "PTO", "balance": 10 },
    { "employeeId": "emp-2", "locationId": "loc-BR", "leaveType": "PTO", "balance": 20 }
  ]
}
```

`201 Created` with `{ "replaced": <N>, "inconsistenciesDetected":
<M> }`. The payload replaces the local `balances` table for every
incoming dimension and deletes rows whose triple is absent from
the incoming set (full-corpus semantics, TRD §3.3). Dimensions
where `newBalance − approvedNotYetPushed < 0` are flagged in the
`inconsistencies` table and block subsequent approvals until a
later clean batch auto-clears the flag (§9 decision 14).

Errors: `400` validation (empty `balances`, missing `generatedAt`,
negative `balance`). `generatedAt` is validated ISO-8601 but
**not persisted** — see TRD §3.3.

### Note on `hcmSyncStatus`

HCM outcomes are surfaced in the response **body** as
`hcmSyncStatus` rather than translated into HTTP error codes. A
local approval commits regardless of the HCM push result (defence
rule, TRD §8.3); the four values `not_required | pending | synced
| failed` tell the client what happened on the outbound push. See
[TRD.md](./TRD.md) §7 "Design note" for the full rationale.

## Testing

The test pyramid is declared in [TRD.md](./TRD.md) §8. Summary:

- **Unit** (`*.spec.ts` co-located with source) — pure domain logic, no
  Nest, no DB.
- **Integration** (`test/integration/`) — service + repos against a
  temp-file SQLite with real migrations applied.
- **E2E** (`test/e2e/`) — full Nest app over HTTP, talking to the
  standalone mock HCM started once per run by `test/e2e/globalSetup.ts`.

```bash
npm test                   # unit + integration
npm run test:watch
npm run test:cov           # unit + integration coverage → ./coverage
npm run test:e2e           # e2e suite (starts mock HCM via globalSetup)
npm run test:cov:e2e       # e2e coverage → ./coverage-e2e
```

Coverage targets are declared in [TRD.md](./TRD.md) §8: domain layer
≥ 95 %, services ≥ 90 %. The proof-of-coverage artefact lives at
[`docs/coverage.md`](./docs/coverage.md) — that file holds both
runs' summary tables, a breakdown of which uncovered lines are
defensive code, and a regen recipe.

`npm run lint` is wired with the ESLint `--fix` flag, so it can
rewrite source files in-place when a formatting auto-fix is
available. That is the intent for development; if you want a
read-only check (e.g. inside CI), invoke ESLint directly:

```bash
npx eslint "{src,test,scripts}/**/*.ts"
```

### Critical scenarios (INSTRUCTIONS.md §15)

Every scenario §15 names is exercised by at least one spec. This
table is the link from the brief's checklist into the code so a
reviewer can audit each rule directly.

| §15 scenario                                       | Covered by |
| -------------------------------------------------- | ---------- |
| Sufficient balance (happy path)                    | `test/e2e/time-off-create.e2e-spec.ts`, `test/e2e/time-off-approve.e2e-spec.ts` |
| Insufficient balance — at create-time              | `test/e2e/time-off-create.e2e-spec.ts` |
| Insufficient balance — re-check at approve         | `test/integration/approve-request.spec.ts` |
| Duplicated request (same `clientRequestId`)        | `test/e2e/time-off-create.e2e-spec.ts` |
| Approval                                           | `test/e2e/time-off-approve.e2e-spec.ts` |
| Rejection                                          | `test/e2e/time-off-reject.e2e-spec.ts`, `test/integration/reject-request.spec.ts` |
| Cancellation                                       | `test/e2e/time-off-cancel.e2e-spec.ts`, `test/integration/cancel-request.spec.ts` |
| HCM error (5xx, 4xx, malformed 2xx)                | `test/e2e/time-off-approve.e2e-spec.ts`, `test/e2e/hcm-outbox-worker.e2e-spec.ts` |
| HCM timeout                                        | `test/e2e/time-off-approve.e2e-spec.ts` (`forceTimeout`) |
| Batch sync changing balance                        | `test/integration/batch-balance-intake.spec.ts`, `test/e2e/hcm-batch-intake.e2e-spec.ts` |
| Batch conflict halts further approvals             | `test/e2e/time-off-batch-inconsistency.e2e-spec.ts` |
| Two concurrent operations on the same balance      | `test/e2e/time-off-approve.e2e-spec.ts` (`Promise.all` interleave) |
| Invalid `(employee, location, leaveType)` triple   | `test/e2e/time-off-create.e2e-spec.ts`, `test/integration/approve-request.spec.ts` |
| Safe reprocessing — idempotent replay              | `test/e2e/time-off-approve.e2e-spec.ts`, `test/e2e/hcm-outbox-worker.e2e-spec.ts`, `test/e2e/hcm-mock-contract.e2e-spec.ts` |
| Outbox-row terminal-state guards                   | `test/integration/hcm-outbox-repository.spec.ts` |
| Inconsistencies repo lifecycle                     | `test/integration/inconsistencies-repository.spec.ts` |
| Worker drains failed_retryable rows                | `test/e2e/hcm-outbox-worker.e2e-spec.ts`, `test/e2e/time-off-outbox-worker.e2e-spec.ts` |

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

## Agentic development process

The challenge brief asks for agentic development; this repository
treats that as an engineering discipline, not a shortcut. Every
feature slice passes through a structured cycle:

1. **Architect brief** — a read-only subagent produces a
   first-principles scoping + risk analysis before planning.
   The output is preserved verbatim as Appendix A of the slice
   plan so future readers see the reasoning exactly as it was.
2. **Plan mode** — the plan body synthesises the architect
   brief with user-locked decisions, enumerates the commits
   (each red→green), names out-of-scope items, and lists the
   pre-push checklist.
3. **TDD loop** — failing spec first, then implementation,
   repeated per commit. `typecheck` / `lint` / `test` /
   `test:e2e` must be green on every commit claiming green.
4. **Reviewer pass** — a read-only subagent audits the full
   diff before push. Findings are triaged blocking / should
   fix / nit. Applied fixes become follow-up commits inside
   Phase B; deferrals are documented in the devlog.
5. **Wrap** — the devlog gets a session entry; the plan is
   archived under `docs/plans/` with a stable numeric prefix.

Artefacts:

- [`docs/plans/`](./docs/plans/) — one archived plan per slice.
  Plans 005–010 each preserve the architect brief verbatim as
  Appendix A; plans 001–004 predate that discipline (they are
  the early scaffolding + process-bootstrap work), and plan 011
  is documentation-only so the architect step was not load-
  bearing. See `docs/plans/README.md` for the index and the
  one-line summary of every slice.
- [`docs/devlog.md`](./docs/devlog.md) — chronological session
  log: what got done, what deviated from the plan, what the
  reviewer flagged, what got deferred and why.
- [`docs/process.md`](./docs/process.md) — the slice template
  + subagent discipline rules distilled from plan 005.
- [`docs/coverage.md`](./docs/coverage.md) — curated coverage
  snapshot (proof-of-coverage deliverable).
- [`.claude/agents/`](./.claude/agents/) — definitions for the
  six subagents named in [CLAUDE.md](./CLAUDE.md) (architect,
  reviewer, domain-data, api-contract, sync-integration,
  test-qa).
- [`CLAUDE.md`](./CLAUDE.md) — operational guardrails:
  subagent discipline, hard guardrails distilled from
  INSTRUCTIONS.md, language and tone rules.

## Security considerations

The submission email lists *"Security considerations and
architectural decisions"* among the evaluation criteria. The notes
below cover the explicit decisions; the corresponding TRD §9
entries hold the longer rationale.

### Defensive HCM integration (TRD §8.3 / §9 *Approval commits locally; HCM push via outbox*)

- The `HcmClient` collapses every transport / HTTP outcome into a
  three-branch discriminated union (`ok` / `permanent` / `transient`)
  before returning to the use case. A 2xx with a malformed body is
  treated as `transient`, not `ok` — the service never marks a
  request synced on a response it cannot validate.
- Local approval commits regardless of HCM availability. HCM-side
  failures surface in the response body as `hcmSyncStatus`, not as
  HTTP errors. This keeps the user-visible state consistent with
  what the service actually decided, independently of HCM weather.
- All idempotency keys are service-generated UUIDs sent in the
  `Idempotency-Key` header. Retries reuse the stored key (never
  freshly generate), so HCM's idempotent-replay contract is honoured
  even across worker tick boundaries.

### Input validation

- Every HTTP DTO is validated by the global `ValidationPipe`
  (`whitelist: true`, `forbidNonWhitelisted: true`,
  `transform: true`). Unknown properties are dropped; required
  properties are enforced; type coercion is explicit. Validation
  failures surface as `400 Bad Request` with the standard Nest
  envelope.
- Path-param UUIDs are parsed by `ParseUUIDPipe`, so malformed UUIDs
  return `400` before any handler runs.
- Date-bounded fields are restricted to `YYYY-MM-DD` strings via
  regex.

### SQL safety

- All persistence is mediated by Drizzle ORM. Every query in the
  repository layer uses Drizzle's typed query builder; values are
  passed as parameter bindings, never interpolated into SQL.
- Drizzle's published advisory `GHSA-gpj5-g38j-94v9`
  (*improper SQL identifier escaping*, fixed in `drizzle-orm@0.45.2`)
  is acknowledged: the codebase pins `drizzle-orm@^0.38.0`. The
  advisory concerns *identifiers* (column / table names) — this
  repository never derives an identifier from user input. Every
  identifier comes from `src/database/schema.ts`, which is
  authored at build time and never accepts runtime data. The
  advisory therefore has no exploitable surface here. A future
  major-version bump of Drizzle (e.g. when the rest of the stack
  is being upgraded) is the natural place to update the pin
  rather than rushing it now and risking unrelated regressions.
- `drizzle-kit` (a build-time-only CLI) inherits an `esbuild`
  dev-server CORS-bypass advisory; it is unreachable at runtime
  because `drizzle-kit` is only ever invoked manually for
  migration generation.

### Out-of-scope

- **Authentication / authorisation.** The service exposes no auth
  surface. The brief does not require it; an externally-fronted
  deployment would put authentication at an upstream layer (API
  gateway, mTLS, BFF) before this service. TRD §10 records this
  as an open boundary.
- **Rate limiting.** Same reasoning — out of scope for the
  microservice level; the upstream layer owns it.
- **Secret management.** No secrets ship in the repository. Env
  vars are documented in the env-var table; none are required at
  runtime against the mock HCM.

## Engineering principles

See [INSTRUCTIONS.md](./INSTRUCTIONS.md) for scope, decision rules,
priorities, and definition-of-done.
