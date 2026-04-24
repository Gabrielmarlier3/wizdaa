# Plan 010 — HCM batch intake + approve-time inconsistency halt

## Context

The reverse direction of the HCM integration is still missing.
Today this service pushes mutations to HCM (approve → inline push
→ outbox worker) but has no way to ingest the nightly/periodic
full-corpus balance refresh that TRD §3.3 describes. Without it
the local `balances.hcm_balance` column only ever reflects what
the service was seeded with — any HR-side edit, anniversary
bonus, or year refresh is invisible.

The other open thread is TRD §10 Q9: §9 *Batch sync preserves
local holds; conflicts halt approvals* commits the service to
halting approvals on a dimension where a fresh HCM balance would
make `newHcmBalance − approvedNotYetPushed < 0`, but no code
implements the halt because the batch intake slice was deferred.
Shipping the batch without the halt would write a flag nobody
reads; shipping the halt without the batch has nothing to flag.
Both belong in the same slice.

This slice covers everything needed to close Q9 in one move:

- `POST /hcm/balances/batch` — full-corpus replacement endpoint.
- `inconsistencies` table — current-state flag per dimension.
- Conflict detection — literal TRD §3.5 predicate
  (`newHcmBalance − approvedNotYetPushed < 0`, pending holds
  deliberately excluded per user decision).
- Auto-clear — next clean batch that no longer triggers the
  predicate deletes the flag (user-confirmed policy).
- Approve hook — `ApproveRequestUseCase.commitApproval` reads
  the inconsistency table before the balance re-check and raises
  a new `DIMENSION_INCONSISTENT` (409) error.

Out of scope (explicit user confirmation):

- No `GET /hcm/inconsistencies` read endpoint for operators.
- No auth.
- No manual-resolve endpoint (auto-clear is sufficient).
- No create-time inconsistency check (`POST /requests` still
  accepts new pendings on a flagged dimension; only the pending
  → approved transition is blocked).

## Architect briefing

Full output preserved as Appendix A. Positions taken:

- **Auto-clear on next clean batch** — the `inconsistencies`
  table is current-state, not an append-only log. A second batch
  where the predicate no longer fires deletes the row
  automatically. No manual resolve endpoint; no `resolvedBy` /
  `resolvedAt` columns. User-locked.
- **Predicate excludes pending holds** — TRD §3.5 literal reading:
  `newHcmBalance − approvedNotYetPushed < 0`. Holds self-heal on
  rejection/cancellation, so including them would produce false
  positives whenever many pendings are open. User-locked.
- **One transaction for the whole batch.** SQLite+better-sqlite3
  handles O(10k) upserts synchronously; partial batches would
  leave `balances` in a hybrid state worse than a clean retry.
- **Full-corpus means delete-and-replace.** Dimensions not in the
  incoming set are removed. Stranded pending requests on removed
  dimensions surface as `INVALID_DIMENSION` at their next approve
  attempt — documented as R5 and flagged as open Q11 for a future
  operator-tooling slice.
- **`generatedAt` accept-and-ignore.** Honours the contract;
  nothing in scope uses it for ordering or dedup. If the real HCM
  ever signals last-write-wins-by-timestamp, a `received_at`
  column can be added non-breakingly.
- **New error code `DIMENSION_INCONSISTENT` (409).** Matches the
  semantics of `INVALID_TRANSITION`: a server-state conflict that
  a retry cannot resolve without operator action. Carries
  `{ employeeId, locationId, leaveType }` extras following the
  `INVALID_TRANSITION.currentStatus` precedent.
- **Approve hook placement: step 3 of `commitApproval`.** After
  `findById` + `InvalidTransitionError` guard and after
  `findByDimension`, but before the `sumActiveHoldDays` /
  `sumNotYetPushedDays` / `hasSufficientBalance` re-check.
- **`inconsistencies` PK = composite dimension.** One row per
  `(employeeId, locationId, leaveType)` at any instant. No
  surrogate UUID (no history; if audit history is needed later it
  is a separate table).

## Decisions locked before planning

1. **Scope: batch intake + approve hook only.** User selected (b)
   over (a) narrow and (c) full with surface endpoint.
2. **Auto-clear resolution policy.** User-locked.
3. **Predicate excludes pending holds.** User-locked.
4. **One tx for the full batch.** Atomic-or-nothing.
5. **`generatedAt` accept-and-ignore.** Accepted for validation,
   not persisted. Flagged as architect assumption A1 in Appendix
   A; a §9 decision entry records the accept-and-ignore stance.
6. **Full-corpus means deletes outside the incoming set.**
   Stranded-pending risk documented; surfaces on next approve
   attempt.
7. **Error code: `DIMENSION_INCONSISTENT` (409).** New row in
   TRD §7; error carries the queried dimension.
8. **Hook placement: after dimension check, before balance
   re-check** inside `commitApproval`.
9. **`inconsistencies` table is current-state, composite PK.**
10. **No new HCM mock changes.** The endpoint is receive-only
    (this service is the server). Tests drive the endpoint via
    `supertest` directly.

## Phase A — Implementation (10 commits)

### A1. `feat(hcm): add inconsistencies table schema and migration 0002`

- `src/database/schema.ts`: add `inconsistencies` table. Columns
  `employee_id`, `location_id`, `leave_type`, `detected_at`,
  `updated_at`. Composite PK on the three dimension columns.
- `drizzle-kit generate` produces `drizzle/0002_<slug>.sql`.
- No logic; `npm run typecheck` green.

### A2. `feat(hcm): add InconsistenciesRepository with findByDimension/upsert/deleteByDimension`

- `src/hcm/repositories/inconsistencies.repository.ts` — mirrors
  the `HcmOutboxRepository` style (constructor-injected `db`,
  every method accepts an optional `executor: Db = this.db`).
- Methods:
  - `findByDimension(employeeId, locationId, leaveType): InconsistencyRow | undefined`
  - `upsert(employeeId, locationId, leaveType, detectedAt, updatedAt)` — `ON CONFLICT DO UPDATE SET updated_at = ?`.
  - `deleteByDimension(employeeId, locationId, leaveType)`.
- Integration spec (`test/integration/inconsistencies-repository.spec.ts`): covers each method against a real SQLite DB via `buildTestApp`.

### A3. `feat(time-off): add BalancesRepository.upsertBatch and deleteNotInSet`

- `src/time-off/repositories/balances.repository.ts` gains two
  methods:
  - `upsertBatch(rows: BalanceInsert[], executor?)` — `INSERT OR REPLACE` over the composite PK.
  - `deleteNotInSet(dimensions: Dimension[], executor?)` — deletes every row whose PK is not in the provided set. Implementation uses a parametrised `NOT IN` with a tuple-of-tuples or a subquery; if Drizzle/SQLite cannot express composite tuple comparisons cleanly, build the IN list via string concatenation of quoted keys as a single composite string and compare a derived expression. Decide during implementation — architect flagged this as a detail not worth pre-picking.
- Integration spec (`test/integration/balances-repository.spec.ts`): `upsertBatch` is idempotent; `deleteNotInSet` removes only rows outside the set; combined call reproduces full-corpus replacement.

### A4. `test(hcm): failing integration spec for BatchBalanceIntakeUseCase`

`test/integration/batch-balance-intake.spec.ts` (new). Three failing cases:

1. **Replacement semantics.** Seed 3 balances; call use case with a corpus that replaces 2 values and drops the 3rd; assert final `balances` table has exactly the 2 rows with new values.
2. **Conflict detection.** Seed a balance of 10 with an `approvedDeductions` sum of 6 for the same dimension; call use case with a corpus setting that dimension to 4 (4 − 6 = −2). Assert an `inconsistencies` row was written.
3. **Auto-clear.** Seed an `inconsistencies` row; call use case with a corpus that does not trigger the predicate for that dimension; assert the row is gone.

Fails because `BatchBalanceIntakeUseCase` does not exist.

### A5. `feat(hcm): implement BatchBalanceIntakeUseCase`

- `src/hcm/batch-balance-intake.use-case.ts`:
  - Single `db.transaction(tx => ...)` around everything.
  - Build the `dimensions` set from the incoming batch.
  - Call `balancesRepo.upsertBatch(rows, tx)`.
  - Call `balancesRepo.deleteNotInSet(dimensions, tx)`.
  - For each incoming dimension, read
    `approvedDeductionsRepo.sumNotYetPushedDaysForDimension(...)`
    and evaluate the predicate
    `newHcmBalance − approvedNotYetPushed < 0`.
  - Branch:
    - Predicate fires → `inconsistenciesRepo.upsert(...)`.
    - Predicate does not fire → `inconsistenciesRepo.deleteByDimension(...)` (auto-clear). Safe to call even if no row exists (UPDATE/DELETE returning zero changes is a no-op).
  - Return `{ replaced: rows.length, inconsistenciesDetected: N }`.
- A4 specs go green.

### A6. `feat(hcm): HcmIngressController + POST /hcm/balances/batch`

- `src/hcm/dto/batch-balance-payload.dto.ts`:
  - `BatchBalanceItemDto` with `@IsString()`, `@IsNotEmpty()` on
    `employeeId`/`locationId`/`leaveType`, `@IsInt()`, `@Min(0)`
    on `balance`.
  - `BatchBalancePayloadDto` with `@IsISO8601()` on `generatedAt`,
    `@IsArray()`, `@ArrayMinSize(1)`, `@ValidateNested({ each: true })`, `@Type(() => BatchBalanceItemDto)` on `balances`.
- `src/hcm/hcm-ingress.controller.ts`:
  - `@Controller('hcm/balances')` with `@Post('batch')`.
  - Delegates to `BatchBalanceIntakeUseCase.execute(payload)`.
  - Returns the `{ replaced, inconsistenciesDetected }` object.
- `src/hcm/hcm.module.ts`:
  - Register `InconsistenciesRepository`, `BatchBalanceIntakeUseCase`, and `HcmIngressController`.
  - Export `InconsistenciesRepository` for `TimeOffModule` (approve hook needs it).
- E2E spec (`test/e2e/hcm-batch-intake.e2e-spec.ts`):
  - 200 happy path returns `{ replaced: N, inconsistenciesDetected: M }` and `balances` table reflects the new corpus.
  - 400 on missing `generatedAt`, empty `balances`, negative `balance`.
  - 200 on a replayed identical batch leaves the state unchanged (idempotency).

### A7. `test(time-off): failing integration spec for DimensionInconsistentError on approve`

`test/integration/approve-request.spec.ts` gains a new case (or a sibling spec if readability demands):

1. Seed a balance + a pending request + an `inconsistencies` row
   for the same dimension. Call `ApproveRequestUseCase.execute`.
   Assert the use case throws `DimensionInconsistentError` with
   the right dimension fields. Assert the request stayed
   `pending`, no `approvedDeductions` / `outbox` rows were
   written, and the hold is intact.

Fails because the error class and the precondition do not exist.

### A8. `feat(time-off): add DimensionInconsistentError + precondition in commitApproval`

- `src/time-off/errors.ts`: add `DimensionInconsistentError`
  carrying `{ employeeId, locationId, leaveType }` on the
  instance (mirror the shape of `BalanceNotFoundError`).
- `src/time-off/approve-request.use-case.ts`:
  - Inject `InconsistenciesRepository`.
  - Inside `commitApproval`, after `findByDimension`, before the
    sum queries, call `inconsistenciesRepo.findByDimension` and
    throw `DimensionInconsistentError` if the row exists.
- `src/time-off/time-off.controller.ts`:
  - Map `DimensionInconsistentError → 409` with body
    `{ code: 'DIMENSION_INCONSISTENT', message, employeeId, locationId, leaveType }`.
- `src/time-off/time-off.module.ts`:
  - Ensure the module has access to `InconsistenciesRepository`
    (via `HcmModule` export already added in A6). No additional
    imports expected.
- A7 spec goes green.

### A9. `test(e2e): batch intake + inconsistency halt + auto-clear recovery`

`test/e2e/time-off-batch-inconsistency.e2e-spec.ts` (new). One
long-form user-journey spec:

1. Seed `balances` = 10 for `(emp-1, loc-BR, PTO)`.
2. POST `/requests` for 6 days (pending), approve it (uses 6 of
   10; hcmSyncStatus=synced).
3. POST `/requests` for 2 days (pending).
4. POST `/hcm/balances/batch` with `balances=[{emp-1, loc-BR, PTO, 4}, ...]` — HCM shrunk the balance. Assert `inconsistenciesDetected: 1` and DB has an `inconsistencies` row for the dimension.
5. POST `/requests/:id/approve` on the 2-day pending → 409
   `DIMENSION_INCONSISTENT` with dimension echoed back.
6. POST `/hcm/balances/batch` with `balances=[{emp-1, loc-BR, PTO, 10}, ...]` — HCM restored. Assert `inconsistenciesDetected: 0` and DB has no `inconsistencies` row.
7. Retry the 2-day approve → 200, `hcmSyncStatus=synced`.

### A10. `docs(trd): record batch intake, DIMENSION_INCONSISTENT, close §10 Q9`

- §3.3: no change — contract was already written.
- §5: add a short paragraph describing the batch-intake path (in,
  not out) and the `inconsistencies` halt.
- §6: add a note on batch-vs-approve ordering under
  better-sqlite3 serialization (R1 from the architect brief).
- §7 error taxonomy: add row
  `DIMENSION_INCONSISTENT | 409 | Approve targets a dimension flagged by the last HCM batch | employeeId, locationId, leaveType`.
- §9: add decision 14
  `2026-04-24 — HCM batch intake replaces full corpus; inconsistencies auto-clear on next clean batch`, with rationale, the predicate-excludes-holds reading of §3.5, and the manual-resolve alternative explicitly rejected.
- §10: move Q9 to the Closed block with a pointer. Add new Q11
  `Stranded pending requests on deleted dimensions` (operator
  tooling not in scope).

## Phase B — Reviewer pre-push + followups (0-N commits)

Invoke `reviewer` subagent on the full diff. Anticipated focus
areas:

- The `deleteNotInSet` implementation (SQL correctness against
  composite PK; possible performance gotchas).
- Whether the precondition check in `commitApproval` holds up
  under the R3 race (flag auto-clears while an approve is
  in-flight).
- Whether the architect's stranded-pending-request R5 note
  deserves a §9 clarification or stays at §10.
- Placement of `BatchBalanceIntakeUseCase` in `src/hcm/` vs
  `src/hcm/use-cases/` (file layout nit).

Findings triaged as blocking / should fix / nit. Applied or
deferred with a devlog note.

## Phase C — Wrap (1-2 commits)

1. `docs(devlog): session 11 — batch intake + inconsistency halt`.
2. `docs(plans): archive plan 010`.

May bundle into one commit if nothing else accumulates.

## Files to touch

```
NEW
  src/hcm/repositories/inconsistencies.repository.ts
  src/hcm/batch-balance-intake.use-case.ts
  src/hcm/hcm-ingress.controller.ts
  src/hcm/dto/batch-balance-payload.dto.ts
  src/time-off/errors.ts                             (add DimensionInconsistentError)
  drizzle/0002_<slug>.sql                            (migration)
  test/integration/inconsistencies-repository.spec.ts
  test/integration/balances-repository.spec.ts
  test/integration/batch-balance-intake.spec.ts
  test/e2e/hcm-batch-intake.e2e-spec.ts
  test/e2e/time-off-batch-inconsistency.e2e-spec.ts
  docs/plans/010-batch-intake-and-inconsistency-halt.md (Phase C)

MODIFIED
  src/database/schema.ts                             (inconsistencies table)
  src/time-off/repositories/balances.repository.ts   (upsertBatch, deleteNotInSet)
  src/time-off/approve-request.use-case.ts           (precondition check)
  src/time-off/time-off.controller.ts                (409 mapping)
  src/time-off/time-off.module.ts                    (pulls InconsistenciesRepository via HcmModule export)
  src/hcm/hcm.module.ts                              (controller + use case + repo registered/exported)
  TRD.md                                             (§5, §6, §7, §9 #14, §10 Q9 closed + new Q11)
  docs/plans/README.md                               (list 010)
  docs/devlog.md                                     (session 11)
  test/integration/approve-request.spec.ts           (new halt case)
```

## Verification

### After Phase A (per commit)

- `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:e2e` green on every commit claiming green.
- A4's three failing specs go green at A5.
- A7's failing spec goes green at A8.
- A6 e2e (400/200/idempotency) green at A6.
- A9 end-to-end user-journey green at A9.

### After Phase A (totals)

- ~64 unit/integration tests (56 existing + ~8 new: 3 on the
  inconsistencies repo, 2 on balances repo, 3 on batch intake
  use case, 1 on approve hook).
- ~36 e2e tests (34 existing + ~4 new: 3 on batch-intake
  endpoint, 1 on end-to-end halt flow).
- TRD: 10 sections. §5/§6/§7 gain rows/paragraphs. 14 decisions.
  §10 Q9 closed; new Q11 open.

### After Phase B

- Reviewer verdict captured in the devlog.
- Pre-push audience-language audit passes.

### After Phase C

- `docs/plans/010-batch-intake-and-inconsistency-halt.md` exists
  with Appendix A.
- `docs/plans/README.md` lists 010.
- `docs/devlog.md` has a session-11 entry.

## Out of scope

- `GET /hcm/inconsistencies` operator read endpoint — tiny
  follow-up slice when there is a need.
- Manual-resolve endpoint — user chose auto-clear.
- Create-time inconsistency check (blocking `POST /requests`) —
  only the approve transition is guarded.
- Auth (batch endpoint currently wide open).
- `GET /balance` surfacing an `inconsistent` flag field — read
  shape unchanged.
- Last-write-wins-by-`generatedAt` — not requested; accept and
  ignore.
- Cleanup of stranded pending requests on deleted dimensions —
  new open Q11 for a future operator-tooling slice.
- Rate limiting / payload size caps on the batch endpoint.
- Any change to the mock HCM.

## Pre-push checklist

- [ ] Architect brief captured (Appendix A).
- [ ] All Phase A commits green on typecheck / lint / test / test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 11 written.
- [ ] Plan 010 archived to `docs/plans/`.
- [ ] Pre-push audience-language audit passes.

---

# Appendix A — Architect brief (verbatim)

> Output of the `architect` subagent (sonnet) on 2026-04-24.
> Read-only first-principles analysis; the plan body synthesises
> it with user-locked decisions (auto-clear, predicate-excludes-
> holds).

## 1. Scope Boundary

**In-slice.**

- `POST /hcm/balances/batch` — full-corpus balance replacement
  with conflict detection.
- `inconsistencies` table — stores one current-state flag per
  dimension.
- `BalancesRepository.upsertBatch` — batch-capable write method.
- `InconsistenciesRepository` — insert/upsert + read-by-dimension.
- `BatchBalanceIntakeUseCase` — orchestrates replacement,
  conflict detection, inconsistency write.
- `HcmIngressController` — thin HTTP adapter for the above,
  lives in `HcmModule`.
- Precondition check in `ApproveRequestUseCase.commitApproval`
  — reads inconsistency before the balance re-check and throws
  a new `DimensionInconsistentError`.
- New error code `DIMENSION_INCONSISTENT` (409) in TRD §7.
- Migration `0002_*.sql` — adds `inconsistencies` table.
- Integration tests for the use case; e2e test for the HTTP
  endpoint and the halt-on-approval path.

**Out-of-slice (confirmed).**

- No `GET /hcm/inconsistencies` list endpoint.
- No auth.
- No notification to HCM about detected inconsistencies.
- No changes to the mock HCM — this endpoint is HCM-driven;
  tests call it via supertest directly.
- No changes to `GET /balance` shape.
- No create-time inconsistency check — only the transition from
  `pending` to `approved` is blocked. TRD §3.5 halts
  "approvals", not "creations"; blocking creation would
  overshoot the stated rule.

## 2. Endpoint Contract

**Route.** `POST /hcm/balances/batch`.

**Request DTO.**

```
{
  generatedAt: string,            // ISO-8601 UTC — validated but not persisted
  balances: [
    {
      employeeId: string,
      locationId: string,
      leaveType: string,
      balance: number             // non-negative integer
    }
  ]
}
```

Validation enforced by class-validator at the global
`ValidationPipe`:

- `generatedAt`: `@IsISO8601()`.
- `balances`: `@IsArray()`, `@ArrayMinSize(1)`,
  `@ValidateNested({ each: true })`.
- Per-item: non-empty strings, non-negative integer.
- Any failure → `400 Bad Request`.

**`generatedAt`**: accept-and-ignore for this slice. No scope
concern needs it.

**Response.** `200 OK` with
`{ replaced: number, inconsistenciesDetected: number }`.

No 422 at the use-case level — the ingress direction creates
dimensions on the fly; there is no invalid-dimension concept here.

## 3. Replacement Semantics

"Full balance corpus" → delete-and-replace scoped to dimensions
present, plus delete rows not in the incoming set, all in one
transaction.

Stranded pending requests on deleted dimensions surface as
`INVALID_DIMENSION` at next approve attempt. Documented; no
cleanup in scope (new Q11 in §10).

## 4. Conflict Detection

`hcmBalance − approvedNotYetPushed < 0` — literal §3.5. Pending
holds excluded: they self-heal on rejection/cancellation;
including them would false-positive whenever many pendings are
open.

## 5. `inconsistencies` Table Schema

```
inconsistencies
  employee_id   TEXT  NOT NULL
  location_id   TEXT  NOT NULL
  leave_type    TEXT  NOT NULL
  detected_at   TEXT  NOT NULL   -- UTC ISO-8601
  updated_at    TEXT  NOT NULL
  PK (employee_id, location_id, leave_type)
```

Current-state table. Each batch run: upsert if predicate fires;
delete if predicate does not fire. Auto-clear on next clean
batch. No `resolvedAt` / `resolvedBy` — read-surface territory,
deferred.

## 6. Approve Hook — Exact Placement

Inside `commitApproval`:

1. `findById` + `InvalidTransitionError` guard.
2. `findByDimension`.
3. **NEW: `InconsistenciesRepository.findByDimension` — throw
   `DimensionInconsistentError` if present.**
4. `sumActiveHoldDays`, `sumNotYetPushedDays`,
   `hasSufficientBalance`.
5. `requestsRepo.approve` (guarded UPDATE) + ledger swap +
   outbox insert.

Error code: `DIMENSION_INCONSISTENT` (409). Extras:
`{ employeeId, locationId, leaveType }`.

## 7. Transaction Boundaries

One transaction for the entire batch. Atomic-or-nothing. SQLite
handles the scale. Partial progress would be a worse state than
a clean retry.

## 8. Idempotency

Natural UPSERT + current-state `inconsistencies` give full
idempotency. No `batchId` dedup.

## 9. Concurrency

better-sqlite3 serializes all writers. Batch vs approve on the
same dimension: either ordering correctly reflects the conflict
(approve fails with `INSUFFICIENT_BALANCE` or
`DIMENSION_INCONSISTENT`; or approve commits first and the
subsequent batch flags post-hoc).

Batch vs outbox worker tick: no shared tables → no conflict.

## 10. Error Taxonomy

New row in TRD §7:

| Code | Status | When | Extras |
|---|---|---|---|
| `DIMENSION_INCONSISTENT` | 409 | Approve targets a dimension with an unresolved inconsistency row. | `{ employeeId, locationId, leaveType }` |

## 11. Risks

- **R1** — Batch vs outbox worker on the same dimension.
  Serialized by the driver; no special handling.
- **R2** — Dimension re-flagged by consecutive bad batches.
  `updated_at` advances; halt stays in force. Correct.
- **R3** — Auto-clear vs in-flight approve. Either ordering is
  safe; no lost write (different tables).
- **R4** — Enormous batch payload. SQLite handles O(10k) inserts
  synchronously. Speculative `@ArrayMaxSize` deferred.
- **R5** — Pending requests stranded on deleted dimensions.
  Holds stay; future approves fail with `INVALID_DIMENSION`.
  Documented as open Q11.
- **R6** — Endpoint is unauthenticated. Accepted; auth is a
  deferred cross-cutting concern.

## 12. Ordered TDD Steps

```
feat(hcm): add inconsistencies table migration (0002)
feat(hcm): add inconsistencies schema + InconsistenciesRepository
feat(hcm): add BalancesRepository.upsertBatch + deleteNotInSet
feat(hcm): BatchBalanceIntakeUseCase with replacement semantics
feat(hcm): conflict detection + auto-clear in BatchBalanceIntakeUseCase
feat(hcm): HcmIngressController + POST /hcm/balances/batch
feat(time-off): DimensionInconsistentError + precondition in commitApproval
feat(hcm): wire controller + use case + repo into HcmModule
test(e2e): batch intake alters balance; inconsistency halts approval
docs(trd): batch intake + DIMENSION_INCONSISTENT; close §10 Q9
```

(The plan body refines this into 10 commits with failing-spec
commits split out for A4 and A7.)

## 13. Open Questions

- **Q9 — CLOSED by this slice.** Pointer added to §10's Closed
  block.
- **Q10 — remains open.** Inline push timeout budget.
- **New Q11 — Stranded pending requests on deleted dimensions.**
  Operator-tooling slice.
- **Q12 — Manual vs auto-clear.** Resolved before this plan was
  written: user chose auto-clear. No §10 entry needed.
- **A1 (assumption)** — `generatedAt` accept-and-ignore. Safe
  default; revisit if real HCM needs timestamp ordering.
- **A2 (assumption)** — predicate excludes holds. User-locked.
