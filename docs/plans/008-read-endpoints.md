# Plan 008 — Read endpoints (`GET /requests/:id` + `GET /balance`)

## Context

The write lifecycle is complete (create, approve, reject, cancel)
but the service has zero read endpoints. The brief's Employee
persona explicitly wants to "see an accurate balance"; the
reconciliation pattern set up in TRD §7 (409 with `currentStatus`)
assumes clients can confirm server state after a conflict but has
no GET to call. This slice closes both gaps in one plan.

Both endpoints are pure reads over existing machinery:

- `GET /requests/:id` — thin wrapper around `requestsRepo.findById`.
- `GET /balance?employeeId=X&locationId=Y&leaveType=Z` — composes
  the three existing repo sums and the existing pure `availableBalance`
  domain function (TRD §3.4 overlay projection).

No new schema, no migration, no HCM touch. One small TRD update
(add `BALANCE_NOT_FOUND` to the §7 error taxonomy) and one new
`BalanceModule` matching the TRD §2 architecture diagram.

## Architect briefing

Full output preserved as Appendix A. Positions taken:

- **`GET /balance` returns the full breakdown** (`hcmBalance`,
  `pendingDays`, `approvedNotYetPushedDays`, `availableDays`), not
  a single `available` number. TRD §3.4 is explicit that the
  overlay is three components; surfacing them makes reconciliation
  after a 409 possible in one round-trip.
- **Both endpoints get their own use case.** Even though the shape
  is thin, the "if missing → raise domain error" decision is a
  business rule, not HTTP plumbing (INSTRUCTIONS.md §12).
- **`GET /balance` missing-dimension → `404 BALANCE_NOT_FOUND`,
  not `422 INVALID_DIMENSION`.** REST semantics for "the resource
  you asked for does not exist" fit 404 cleanly; reusing
  `INVALID_DIMENSION` would overload a code the create/approve
  flows already use for request-time validation. Additive entry
  in TRD §7; no conflict with existing 404 `REQUEST_NOT_FOUND`.
- **Balance reads are not transactional.** Three independent
  SQLite reads under WAL mode; the inter-read window is accepted
  (best-current-view, not serializable snapshot). Making them
  transactional would be ceremony without a failure scenario to
  defend.
- **New `BalanceController` in a new `BalanceModule`** — matches
  the TRD §2 architecture diagram that already names it. Adds one
  module file; `TimeOffModule` exports the three repositories
  `BalanceModule` consumes, no duplicate provider instances.

## Decisions locked before planning

1. **Response shape for `GET /balance`: four-field breakdown.**
   See architect §2. Registered as a new §9 decision entry in the
   TRD during Phase A.
2. **Error code `BALANCE_NOT_FOUND` (404) is new and additive to
   TRD §7.** Rationale and precedent in architect §4.
3. **`GET /requests/:id` exposes the full `TimeOffRequest`
   entity**, including `hcmSyncStatus` and `clientRequestId`. Both
   are client-relevant (reconciliation + dedup); outbox internals
   (`idempotencyKey`, `attempts`, `hcmMutationId`) are never on
   the domain entity so no filtering is needed.
4. **Both use cases live in the time-off module for
   `GetRequestUseCase` and a new balance module for
   `GetBalanceUseCase`.** Per TRD §2 module layout.
5. **Reads are non-transactional.** Architect risk 1 accepted.

## Phase A — Implementation (7 commits)

Architect's ordered TDD steps, with the failing-first convention:

### A1. `test(e2e): add failing GET /requests/:id happy-path and 404 specs`
`test/e2e/requests-read.e2e-spec.ts` (new). Seed balance, create
pending via slice-1 endpoint, then `GET /requests/:id` — expect 200
with the full entity matching the POST response shape. Second spec:
unknown UUID → 404 with `{ code: 'REQUEST_NOT_FOUND', message }`.
Fails because the endpoint does not exist.

### A2. `feat(time-off): implement GetRequestUseCase with unit specs`
`src/time-off/get-request.use-case.ts` (new). Calls
`requestsRepo.findById`; raises `RequestNotFoundError` (already in
`src/time-off/errors.ts`) when `undefined`. Unit spec covers both
branches. Minimal: no transaction, no HCM.

### A3. `feat(time-off): wire GET /requests/:id controller`
Add `@Get(':id') get(@Param('id', ParseUUIDPipe))` to
`TimeOffController`. Exception mapping: `RequestNotFoundError →
404 REQUEST_NOT_FOUND`. Register `GetRequestUseCase` in
`TimeOffModule` providers. A1's failing specs go green.

### A4. `test(e2e): add failing GET /balance happy-path and edge-case specs`
`test/e2e/balance-read.e2e-spec.ts` (new). Three specs:
1. Happy path: seed a balance, create a pending request (building
   a hold) and an approved one (building an approved_deduction) —
   `GET /balance?...` returns the correct four-field breakdown with
   the math verified.
2. Unknown dimension → 404 `{ code: 'BALANCE_NOT_FOUND' }`.
3. Missing query param → 400 (Nest ValidationPipe default envelope).

### A5. `feat(balance): GetBalanceQueryDto, BalanceNotFoundError, GetBalanceUseCase`
- `src/balance/dto/get-balance-query.dto.ts` — `@IsString()
  @IsNotEmpty()` on `employeeId`, `locationId`, `leaveType`.
- `src/balance/errors.ts` — `BalanceNotFoundError` class.
- `src/balance/get-balance.use-case.ts` — calls
  `BalancesRepository.findByDimension` (→ raise
  `BalanceNotFoundError` if absent),
  `HoldsRepository.sumActiveHoldDaysForDimension`,
  `ApprovedDeductionsRepository.sumNotYetPushedDaysForDimension`,
  and the pure `availableBalance` from `src/domain/balance.ts`.
- Unit specs: happy breakdown, missing dimension → throw, arithmetic
  correctness.

### A6. `feat(balance): BalanceController + BalanceModule wiring`
- `src/balance/balance.controller.ts` — `@Controller('balance')`,
  single `@Get()` handler. Maps `BalanceNotFoundError → 404
  BALANCE_NOT_FOUND`.
- `src/balance/balance.module.ts` — registers `GetBalanceUseCase`
  and the controller; imports `TimeOffModule` (which we export
  the three repositories from).
- `src/time-off/time-off.module.ts` — add `exports: [...]` for
  `BalancesRepository`, `HoldsRepository`,
  `ApprovedDeductionsRepository`.
- `src/app.module.ts` — add `BalanceModule` to imports.
- A4's failing specs go green.

### A7. `docs(trd): add BALANCE_NOT_FOUND to §7 and GET-balance response shape to §9`
- Add row to §7 error taxonomy: `BALANCE_NOT_FOUND | 404 | GET
  /balance finds no balance row for the queried dimension`.
- Add §9 decision entry `2026-04-24 — GET /balance returns the
  full overlay breakdown`, with rationale (TRD §3.4 surfaces three
  components; single-number responses prevent reconciliation
  without extra round-trips) and alternatives considered
  (single-available-number, rejected).

## Phase B — Reviewer pre-push + followups (0-N commits)

Invoke `reviewer` subagent. Expectation: minimal findings; the
pattern follows the existing use-case/controller conventions and
adds one small new module. Any findings triaged; applied or
deferred with devlog note.

## Phase C — Wrap (1-2 commits)

1. `docs(devlog): session 9 — read endpoints`.
2. `docs(plans): archive plan 008`.

May bundle into one commit if nothing else accumulates.

## Files to touch

```
NEW
  src/time-off/get-request.use-case.ts
  src/time-off/get-request.use-case.spec.ts
  src/balance/balance.module.ts
  src/balance/balance.controller.ts
  src/balance/get-balance.use-case.ts
  src/balance/get-balance.use-case.spec.ts
  src/balance/errors.ts
  src/balance/dto/get-balance-query.dto.ts
  test/e2e/requests-read.e2e-spec.ts
  test/e2e/balance-read.e2e-spec.ts
  docs/plans/008-read-endpoints.md (Phase C)

MODIFIED
  src/time-off/time-off.controller.ts     (add GET /requests/:id)
  src/time-off/time-off.module.ts         (register GetRequestUseCase; export repos)
  src/app.module.ts                        (import BalanceModule)
  TRD.md                                   (§7 row, §9 new decision)
  docs/plans/README.md                     (list 008)
  docs/devlog.md                           (session 9 entry)
```

No schema, no migration, no changes to HCM client / mock / outbox.

## Verification

### After Phase A (per commit)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`
  green on every commit claiming green.
- A1 fails at A1, A2; passes at A3.
- A4 fails at A4, A5; passes at A6.

### After Phase A (totals)
- ~40 unit/integration tests (35 existing + 2-3 new use-case specs).
- 22+ e2e tests (19 existing + ~4 new).
- TRD: 10 sections unchanged; 12 decision entries (11 existing + 1
  new for GET /balance response shape); §7 table gains one row.

### After Phase B
- Reviewer verdict captured in the devlog.
- Pre-push audience-language audit clean.

### After Phase C
- `docs/plans/008-read-endpoints.md` exists with Appendix A.
- `docs/plans/README.md` lists 008.
- `docs/devlog.md` has a session-9 entry.

## Out of scope

- `GET /requests` (list with filters / pagination) — deferred.
- Multi-dimension balance summaries (e.g. all balances for an
  employee) — deferred.
- History / audit endpoint on requests — deferred.
- Any HCM read-through (reads hit local `balances`, not the HCM
  realtime API). Architect §1.
- Ownership / auth — still deferred.

## Pre-push checklist

- [ ] Architect brief captured (Appendix A).
- [ ] All Phase A commits green on typecheck / lint / test / test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 9 written.
- [ ] Plan 008 archived to `docs/plans/`.
- [ ] Pre-push audience-language audit passes.

---

# Appendix A — Architect brief (verbatim)

> Output of the `architect` subagent (sonnet) on 2026-04-24.
> Read-only first-principles analysis; the plan body synthesises
> it with existing decisions.

## 1. Scope Boundary

Both endpoints are pure reads that compose existing repo methods
and the existing `availableBalance` domain function. Nothing in
the write lifecycle changes. The `GET /balance` endpoint accepts
a query-string dimension triple `(employeeId, locationId,
leaveType)`, validates it via Nest's `ValidationPipe`, runs the
three repo sums, and returns the projected breakdown. The
`GET /requests/:id` endpoint accepts a UUID path parameter, calls
`requestsRepo.findById`, and returns the full `TimeOffRequest`
entity minus any internal ledger/outbox fields.

What stays out of scope: list/pagination of requests,
per-employee multi-dimension summaries, history or audit trail,
any write behavior, and any HCM call (reads are projection-only
against local tables per TRD §3.4). The balance endpoint reads
the local `balances` table, not the HCM realtime API; reaching
out to HCM on a read path would introduce a network dependency
that adds latency and no accuracy gain, because the batch/inline
sync already keeps `balances.hcmBalance` current.

## 2. Response Shapes

### `GET /balance?employeeId=X&locationId=Y&leaveType=Z`

Position: return the full breakdown, not just `available`.

TRD §3.4 defines the overlay model explicitly as three components:
`hcmBalance`, `pendingReservations`, and `approvedNotYetPushed`.
The Employee persona needs "instant feedback" — a single opaque
number prevents the UI from explaining why balance is lower than
the HCM shows (e.g., "you have 3 days on pending requests"). The
three-number breakdown also makes the service's reconciliation
story legible: when a client receives a 409 from `POST /requests`
and wants to confirm the server's view, seeing all three
components lets it understand the exact constraint without a
second round-trip.

Happy-path `200 OK`:
```
{
  "employeeId": "emp-1",
  "locationId": "loc-1",
  "leaveType": "PTO",
  "hcmBalance": 10,
  "pendingDays": 3,
  "approvedNotYetPushedDays": 2,
  "availableDays": 5
}
```

`404 Not Found` (no `balances` row for that dimension):
```
{ "code": "BALANCE_NOT_FOUND", "message": "..." }
```

`400 Bad Request`: Nest's default `ValidationPipe` envelope.

### `GET /requests/:id`

Happy-path `200 OK`: the full `TimeOffRequest` entity as already
serialized by the write endpoints. `clientRequestId` and
`hcmSyncStatus` belong in the response (client-facing per
§9 dual-idempotency and §7 respectively). Internal outbox fields
are not on `TimeOffRequest` so no active filtering needed.

`404 Not Found`:
```
{ "code": "REQUEST_NOT_FOUND", "message": "..." }
```

`400`: `ParseUUIDPipe` rejects malformed path params.

## 3. Use Cases

Both endpoints get their own use case, not inline controller
logic. TRD §2 mandates thin controllers; the "if missing → raise
domain error" decision is a business rule, not HTTP wiring.
`GetBalanceUseCase` orchestrates three repo calls + one domain
function + a conditional error raise; `GetRequestUseCase` wraps
`findById` with the same guard pattern used by approve/reject/
cancel.

## 4. Error Taxonomy

- `GET /balance` with no `balances` row: **404 BALANCE_NOT_FOUND**.
  Not `422 INVALID_DIMENSION` — that code is used on the write
  paths for request-time validation; `GET /balance` has identical
  semantics to any other "resource not found" read. Additive to
  TRD §7, no conflict with the existing `REQUEST_NOT_FOUND` (also
  404, different resource).
- `GET /requests/:id` unknown: **404 REQUEST_NOT_FOUND** —
  existing code.
- Validation: **400** via Nest pipes.

## 5. Risks

**R1 Read-time snapshot consistency.** Three independent reads;
inter-read window could see partial state. Accepted — reads are
"best current view" not serializable snapshot. SQLite WAL
provides non-blocking reads; transactional wrapping would be
ceremony without a concrete failure case.

**R2 Stale `approvedNotYetPushedDays` from outbox lag.** Window
between HCM push succeeding (`outbox.status = 'synced'` drops
the deduction from the projection) and the next batch landing
(which updates `hcmBalance`). By design per TRD §3.4 / §5; closing
it would require per-read HCM calls. Accepted.

**R3 `hcmSyncStatus: 'failed'` confusing on GET.** Client might
misinterpret a permanent failure as a retryable error. Mitigation
is documentation (API contract), not code — filtering the field
would remove the only reconciliation signal the client has.

## 6. Ordered TDD Implementation Steps

(See the plan body for the condensed 7-step ordering.)

## 7. Open Questions

**Route placement for `GET /balance`.** Option (a) new
`BalanceController` in `BalanceModule` (matches TRD §2 architecture
diagram); option (b) `@Get('balance')` in `TimeOffController`.
Position chosen in the plan body: (a), matching TRD §2. Costs
one module file + a repo export from `TimeOffModule`; clean and
aligned with the documented architecture.
