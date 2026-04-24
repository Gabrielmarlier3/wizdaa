# Plan 006 — Reject slice (`POST /requests/:id/reject`)

## Context

The approve slice (plan 005) landed the bulk of the lifecycle machinery:
transactional state transitions with a guarded concurrency fence, the
pending-hold / approved-deduction ledger split, the HCM outbox and
inline push, the error taxonomy with `INVALID_TRANSITION` carrying
`currentStatus`, and the e2e + integration testing patterns.

Reject is the smallest remaining lifecycle transition. It reuses every
piece of machinery above — it adds no schema, no HCM interaction, no
new subagent invocations beyond the mandatory architect / reviewer
pass. One transaction, two writes: `UPDATE requests SET status='rejected'
WHERE id=? AND status='pending'` and `DELETE FROM holds WHERE
request_id=?`. That is the entire feature.

Cancel is the natural next slice (employee-initiated, same mechanics,
different audit) and is explicitly **out of scope** here per the user's
scope decision.

## Architect briefing

Full architect output is Appendix A. Key commitments from it:

- **No HCM push, no outbox row.** A rejected request was never told
  to the HCM; there is nothing to undo. Inventing an outbox row would
  violate §8.7 (non-invention).
- **`hcmSyncStatus` stays `'not_required'`.** No schema change; the
  enum already has this value from plan 005.
- **No new decision log entry.** The slice exercises existing
  decisions (§9 *Reserve balance at creation as pending hold*, §9
  *Cancellation is a distinct terminal state from rejection*) without
  introducing a new architectural choice.
- **Error taxonomy identical to approve minus `InsufficientBalanceError`
  and `InvalidDimensionError`** — neither can fire on reject.
- **Concurrency fence is the same pattern** — guarded `UPDATE WHERE
  status='pending'`, re-read on `changes=0` to surface the honest
  `currentStatus`.

## Decisions locked before planning

1. **No HCM interaction on reject.** Justified above; matches §3.6
   authority boundaries ("this service owns the request lifecycle;
   HCM only hears about approved deductions").
2. **Single transaction, no resolution phase.** Reject is synchronous
   end-to-end — no async branch, no second tx. Simpler than approve by
   design.
3. **No new domain error type.** `RequestNotFoundError` and
   `InvalidTransitionError` (both from the approve slice) are
   sufficient. The architect's error analysis confirms no reject-
   specific error is needed.
4. **Minimal e2e coverage** — the architect's 7-step ordering is
   tight. A reject-after-approve e2e guards R2 (terminal-state
   replay); a concurrent reject integration test guards R1. That is
   enough; adding reject-after-reject would exercise the same code
   path as reject-after-approve.
5. **No changes to architect or reviewer subagent prompts.** The
   slice is small enough that the existing subagent definitions are
   right-sized.

## Phase A — Implementation (7 commits)

Following the architect's TDD ordering:

### A1. `test(e2e): add failing POST /requests/:id/reject happy-path spec`
`test/e2e/time-off-reject.e2e-spec.ts` (new). Seed balance, create
pending request via slice-1 endpoint, reject it. Expect 200 with
`status='rejected'`, `hcmSyncStatus='not_required'`; assert the hold
row is gone. Fails because endpoint and use case are missing.

### A2. `feat(domain): add rejectPendingRequest transition`
Pure function in `src/domain/request.ts` mirroring
`approvePendingRequest` but setting `status: 'rejected'` and leaving
`hcmSyncStatus` at `'not_required'`. Throws `InvalidTransitionError`
for non-pending inputs. Unit specs: happy path, rejection from each
non-pending status, error carries the from/to statuses.

### A3. `feat(time-off): add RequestsRepository.reject(id, tx)`
Guarded UPDATE identical in shape to `approve()` but sets
`status='rejected'` and does not touch `hcmSyncStatus`. Returns the
`changes` count for the concurrency fence.

### A4. `feat(time-off): implement RejectRequestUseCase`
`src/time-off/reject-request.use-case.ts` (new). Single
`db.transaction` wraps:
1. `findById`; throw `RequestNotFoundError` if missing.
2. Guard `existing.status === 'pending'`; throw
   `InvalidTransitionError(existing.status, 'rejected')`.
3. Call `requestsRepo.reject(id, tx)`; on `changes !== 1`, re-read
   and throw `InvalidTransitionError(current.status, 'rejected')`
   (mirrors the honest-currentStatus fix from plan 005 C1).
4. `holdsRepo.deleteByRequestId(id, tx)` — no-op if the hold is
   absent for any reason.
5. Return `rejectPendingRequest(existing)`.

No HcmClient injection, no outbox repo injection.

### A5. `feat(time-off): wire POST /requests/:id/reject controller`
Extend `TimeOffController` with a new method:
`@Post(':id/reject') @HttpCode(200) async reject(@Param('id',
ParseUUIDPipe) id: string)`. Exception mapping:
`RequestNotFoundError → 404 REQUEST_NOT_FOUND`,
`InvalidTransitionError → 409 INVALID_TRANSITION` with
`currentStatus` in the body. `TimeOffModule` registers
`RejectRequestUseCase` as a provider. A1's failing spec goes green.

### A6. `test(e2e): cover reject-after-approve returns 409 INVALID_TRANSITION`
Approve a request first, then attempt reject; expect 409 with
`currentStatus: 'approved'`. Guards R2 (terminal-state replay, same
code path as reject-after-reject).

### A7. `test(integration): cover concurrent reject serialisation`
`test/integration/reject-request.spec.ts` (new).
`Promise.all` two reject calls on the same pending id; expect one
success, one `InvalidTransitionError`. Assert the request is
`rejected`, hold is gone, no unintended side effects.

## Phase B — Reviewer pre-push + followups (1–N commits)

1. Invoke `reviewer` subagent on the slice diff.
2. Triage findings into *blocking* / *should fix* / *nit*.
3. Apply fixes or defer explicitly in the devlog.

Expectation: the slice is small and mirrors a pattern the reviewer
already vetted in plan 005, so findings should be minimal (0-2
should-fix items, some nits).

## Phase C — Wrap (2 commits)

1. **`docs(devlog): session 7 — reject slice`** — short entry
   narrating the architect invocation, TDD cycle, reviewer outcome.
2. **`docs(plans): archive plan 006`** — copy this plan to
   `docs/plans/006-reject-slice.md` with architect brief as
   Appendix A; update `docs/plans/README.md`.

## Files to touch

```
NEW
  src/time-off/reject-request.use-case.ts
  test/e2e/time-off-reject.e2e-spec.ts
  test/integration/reject-request.spec.ts
  docs/plans/006-reject-slice.md (Phase C)

MODIFIED
  src/domain/request.ts                    (add rejectPendingRequest)
  src/domain/request.spec.ts               (unit specs for the new fn)
  src/time-off/repositories/requests.repository.ts  (add reject())
  src/time-off/time-off.controller.ts      (add approve method)
  src/time-off/time-off.module.ts          (register RejectRequestUseCase)
  docs/plans/README.md                     (list 006)
  docs/devlog.md                           (session 7 entry)
```

**No changes** to schema, migrations, HcmClient, mock HCM, outbox
repositories, or TRD §§1–9. §10 open questions stays as-is (no new
unresolved items). TRD §6 Concurrency stays TBD.

## Verification

### After each Phase A commit
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`
  green on every commit claiming green.
- The failing spec from A1 fails *only* at A1–A4 and goes green at
  A5.

### After Phase A
- 22+ unit / integration tests (21 existing + 1 new integration +
  6 new unit from the domain spec ≈ 28 unit/integration).
- 15+ e2e tests (13 existing + 2 new ≈ 15 e2e).
- TRD section count unchanged (10); decision entry count unchanged
  (11).

### After Phase B
- No blocking findings; deferred items logged in devlog.
- `grep -iE '\b(examiner|grader)\b'` still zero across tracked
  files.

### After Phase C
- `docs/plans/006-reject-slice.md` exists with Appendix A.
- `docs/plans/README.md` lists 006.
- `docs/devlog.md` has a session-7 entry.

## Out of scope

- **Cancel** (`POST /requests/:id/cancel`) — next slice.
- **HCM batch intake**, **outbox worker**, **read endpoints**,
  **list endpoints** — later slices.
- **Any change to approve / create** — reject does not touch those
  paths.
- **`INVALID_DIMENSION` or `INSUFFICIENT_BALANCE` on reject** —
  neither can fire; not mapped in the controller.

## Pre-push checklist

- [ ] Architect brief captured (Appendix A).
- [ ] All A-phase commits green on typecheck / lint / test / test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 7 written.
- [ ] Plan 006 archived to `docs/plans/`.
- [ ] Theater-language audit passes (`examiner` / `grader` / `evaluator`
      all zero matches on tracked files).

---

# Appendix A — Architect brief (verbatim)

> Output of the `architect` subagent (sonnet) run during planning on
> 2026-04-24. Read-only first-principles analysis; the plan body
> synthesises the brief with user ratifications.

## 1. Scope Boundary

The reject slice adds a single endpoint — `POST /requests/:id/reject` —
that transitions a `pending` request to `rejected` and atomically
releases the pending balance hold. It mirrors the approve slice
structurally but is simpler: there is no HCM push, no outbox row, no
approved deduction, and no async phase. Cancel
(`POST /requests/:id/cancel`) is the next slice and is explicitly out
of scope here; the distinction between the two terminal states is
already decided in TRD §9 ("Cancellation is a distinct terminal
state from rejection") and requires no revisiting.

## 2. Primary Flow

All writes execute inside a single `db.transaction` call. No second
transaction is needed because there is no HCM push.

1. `requestsRepo.findById(id, tx)` — if missing, throw
   `RequestNotFoundError`.
2. Guard `existing.status === 'pending'` — if not, throw
   `InvalidTransitionError(existing.status, 'rejected')`.
3. Guarded `UPDATE requests SET status='rejected' WHERE id=? AND
   status='pending'` — returns row count. If `changes !== 1`,
   re-read and throw `InvalidTransitionError` with the current
   status (same concurrency fence pattern as approve).
4. `holdsRepo.deleteByRequestId(existing.id, tx)` — releases the
   balance reservation atomically.
5. Return the rejected `TimeOffRequest` built by a new domain
   function `rejectPendingRequest(existing)`.

**Does reject touch HCM?** No. Rejection is a lifecycle decision
made entirely within this service. The HCM was never told a pending
request existed (the hold is local-only). There is nothing to undo
on the HCM side. Creating an outbox row for a rejection would be
invented behavior with no basis in TRD §3 or the brief.

**What does `hcmSyncStatus` stay at for a rejected request?** It
remains `not_required`. The rejected request never had an HCM
interaction and never will. The `not_required` value is already in
the `HcmSyncStatus` enum; no schema change is needed. This is
consistent with TRD §3.6 — this service owns the request lifecycle;
the HCM only hears about approved deductions.

## 3. Schema Changes

None. All five tables, every column, and every constraint already
exist. The `rejected` status is already a valid enum value in
`requests.status` (TRD §4). No migration is generated.

## 4. Risks

**R1 — Concurrent reject-after-approve (or approve-after-reject).**
Two concurrent actors (or one actor sending parallel requests)
might race. The guarded `UPDATE ... WHERE status='pending'` is the
primary fence: the loser sees `changes = 0`, re-reads the row, and
surfaces `InvalidTransitionError` with `currentStatus`. This is
identical to approve's R1. The test must use actual `Promise.all`,
not sequential calls (per TRD §8 convention).

**R2 — Idempotent reject replay (reject-after-reject).** A caller
retrying a successful rejection hits a terminal state. The guard on
`status === 'pending'` in both the pre-check and the guarded UPDATE
will fire; `InvalidTransitionError` with `currentStatus: 'rejected'`
is returned, and the caller can reconcile. The `currentStatus`
field in the 409 body is load-bearing here for the same reason it
is on approve (TRD §7).

**R3 — Hold leak on partial failure.** If the transaction aborts
after the status UPDATE but before the hold DELETE, SQLite rolls
the entire transaction back — the status stays `pending` and the
hold remains intact. There is no partial-failure window inside a
`db.transaction` with `better-sqlite3`. No additional fence needed.

**R4 — Hold already absent at reject time.** If for any reason the
hold row is missing when rejection runs (a bug in a prior slice),
`deleteByRequestId` is a no-op DELETE — it does not throw. This is
safe: the balance projection reads the hold table directly, so a
missing row means the reservation is already absent. No guard
needed; the behavior is correct by construction.

## 5. Ordered TDD Implementation Steps

1. `test(e2e): add failing POST /requests/:id/reject happy-path
   spec`.
2. `feat(domain): add rejectPendingRequest transition`.
3. `feat(time-off): add RequestsRepository.reject(id, tx)`.
4. `feat(time-off): implement RejectRequestUseCase`.
5. `feat(time-off): wire POST /requests/:id/reject controller`.
6. `test(e2e): cover reject-after-approve returns 409
   INVALID_TRANSITION`.
7. `test(integration): cover concurrent reject serialisation`.

## 6. Open Questions

None. The slice is fully bounded by existing decisions. The
`hcmSyncStatus` value for rejection (`not_required`) follows
directly from TRD §3.6 and §4. No new infrastructure, no new
tables, no new enum values are needed.
