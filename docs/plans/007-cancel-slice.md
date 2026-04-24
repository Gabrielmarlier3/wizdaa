# Plan 007 — Cancel slice (`POST /requests/:id/cancel`)

## Context

The reject slice shipped in plan 006. Cancel is the mechanical twin:
same single-transaction flow, same concurrency fence, same error
taxonomy, no HCM interaction — only the terminal state differs
(`cancelled` instead of `rejected`) and the notional actor is the
Employee instead of the Manager.

The distinction between the two terminal states is already decided
in TRD §9 *Cancellation is a distinct terminal state from rejection*
(landed in plan 005 as part of the approve-driven §9 work); cancel
is the first executing path that exercises that decision.

No schema change, no TRD decision entry, no new machinery. The
architect brief (Appendix A) confirms the slice is almost literally
a rename of reject with adjusted status values.

## Architect briefing

Full output preserved as Appendix A. Key positions:

- **No body field.** Same as reject (empty). A `reason` string is
  §8.7 non-invention — the brief does not ask for it.
- **No ownership check.** The user explicitly ratified the no-auth
  position earlier. A body-level `employeeId` verifier that any
  caller can fabricate is invented enforcement against a risk the
  no-auth environment cannot close. The correct fix is an auth
  layer; deferred.
- **No DRY extraction.** `RejectRequestUseCase` and
  `CancelRequestUseCase` will be structurally identical after this
  slice. §10 says wait for a third use case or reviewer pressure
  before extracting a shared base. Two clear files beat one generic
  file with a mode parameter today.
- **`hcmSyncStatus` stays `not_required`.** Same reasoning as
  reject (TRD §3.6).
- **R5 (manager hitting cancel endpoint) is a stated constraint,
  not a code-level risk** — in the no-auth world the two actors are
  indistinguishable at the HTTP layer. Audit attribution
  imprecision is the accepted consequence.

## Decisions locked before planning

1. **Empty request body.** POST with no payload, mirroring reject.
2. **No ownership / identity check.** See architect A1.
3. **No DRY extraction now.** See architect A4.
4. **`hcmSyncStatus` untouched in `RequestsRepository.cancel`.**
   Mirrors the deliberate non-touch in `reject()`.
5. **Pattern adherence is the primary quality axis.** Any deviation
   from reject's structure needs an explicit justification; there
   should be none.

## Phase A — Implementation (7 commits)

Architect's TDD ordering, identical shape to plan 006 A-phase:

### A1. `test(e2e): add failing POST /requests/:id/cancel happy-path spec`
`test/e2e/time-off-cancel.e2e-spec.ts` (new). Seed balance, create
pending via slice-1 endpoint, cancel it. Expect 200 with
`status='cancelled'`, `hcmSyncStatus='not_required'`; assert the
hold row is gone.

### A2. `feat(domain): add cancelPendingRequest transition`
Pure function in `src/domain/request.ts` mirroring
`rejectPendingRequest` but setting `status: 'cancelled'`. Throws
`InvalidTransitionError` for non-pending inputs. Six unit specs
(happy path, rejection from each non-pending status, field
preservation, error payload).

### A3. `feat(time-off): add RequestsRepository.cancel(id, tx)`
Guarded UPDATE setting `status='cancelled' WHERE status='pending'`.
Returns the `changes` count for the concurrency fence. Does NOT
touch `hcmSyncStatus`.

### A4. `feat(time-off): implement CancelRequestUseCase`
`src/time-off/cancel-request.use-case.ts` (new). Single
`db.transaction` wrapping: `findById` (404 if missing), status guard
(409 InvalidTransitionError), guarded UPDATE (re-read on 0 changes
for honest `currentStatus`), hold DELETE, return
`cancelPendingRequest(existing)`. No HcmClient injection.

### A5. `feat(time-off): wire POST /requests/:id/cancel controller`
Extend `TimeOffController` with `@Post(':id/cancel') @HttpCode(200)
cancel(...)`. Exception mapping identical to reject
(`RequestNotFoundError → 404`, `InvalidTransitionError → 409 with
currentStatus`). `TimeOffModule` registers `CancelRequestUseCase`.
A1 goes green.

### A6. `test(e2e): cover cancel-after-approve returns 409 INVALID_TRANSITION`
Approve a request, attempt cancel; expect 409 with
`currentStatus: 'approved'`. Same R2 coverage pattern as reject.

### A7. `test(integration): cover concurrent cancel serialisation`
`test/integration/cancel-request.spec.ts` (new).
`Promise.allSettled` two cancel calls on the same pending id;
exactly one fulfilled, one rejected with `InvalidTransitionError`;
post-state is `cancelled` + hold gone. Guards R1.

## Phase B — Reviewer pre-push + followups (0-N commits)

1. Invoke `reviewer` subagent on the cancel slice diff.
2. Triage; apply fixes or defer with devlog note.

Expectation: zero findings. The pattern was just vetted two commits
ago in plan 006's reviewer pass.

## Phase C — Wrap (2 commits)

1. `docs(devlog): session 8 — cancel slice` — short narrative.
2. `docs(plans): archive plan 007` — copy to
   `docs/plans/007-cancel-slice.md` + update `docs/plans/README.md`.

## Files to touch

```
NEW
  src/time-off/cancel-request.use-case.ts
  test/e2e/time-off-cancel.e2e-spec.ts
  test/integration/cancel-request.spec.ts
  docs/plans/007-cancel-slice.md (Phase C)

MODIFIED
  src/domain/request.ts                         (add cancelPendingRequest)
  src/domain/request.spec.ts                    (new unit specs)
  src/time-off/repositories/requests.repository.ts  (add cancel())
  src/time-off/time-off.controller.ts           (add cancel method)
  src/time-off/time-off.module.ts               (register CancelRequestUseCase)
  docs/plans/README.md                          (list 007)
  docs/devlog.md                                (session 8 entry)
```

**No changes** to schema, migrations, HcmClient, mock HCM, outbox
repositories, existing use cases, or TRD §§1–10.

## Verification

### After each Phase A commit
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`
  green on every commit claiming green.
- A1's failing spec fails at A1–A4 and goes green at A5.

### After Phase A
- ~34 unit/integration tests (28 existing + 6 new unit from domain
  spec + 1 new integration = 35 expected).
- 18 e2e tests (16 existing + 2 new = 18).
- TRD unchanged: 10 sections, 11 decision entries.

### After Phase B
- No blocking findings.
- `git log --all --format='%B' | grep -iE ...` still zero matches
  across tracked files.

### After Phase C
- `docs/plans/007-cancel-slice.md` exists with Appendix A.
- `docs/plans/README.md` lists 007.
- `docs/devlog.md` has a session-8 entry.

## Out of scope

- **Auth / ownership verification** — deferred per user ratification
  and architect A1.
- **Cancellation reason** — §8.7 non-invention; defer to product
  spec.
- **DRY extraction of reject + cancel** — wait for a third use case
  or reviewer signal.
- **Any change to approve / create / reject** — cancel does not
  touch those paths.
- **TRD changes** — no new architectural decision, no new open
  question.

## Pre-push checklist

- [ ] Architect brief captured (Appendix A).
- [ ] All Phase A commits green on typecheck / lint / test / test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 8 written.
- [ ] Plan 007 archived to `docs/plans/`.
- [ ] Pre-push audience-language audit passes.

---

# Appendix A — Architect brief (verbatim)

> Output of the `architect` subagent (sonnet) on 2026-04-24. Read-only
> first-principles analysis; the plan body above synthesises this
> brief with user ratifications and existing decisions.

## 1. Scope Boundary

The cancel slice adds one endpoint — `POST /requests/:id/cancel` —
that transitions a `pending` request to `cancelled` and atomically
releases the pending balance hold. The `cancelled` terminal state is
already in the `RequestStatus` union and the schema enum (TRD §4);
no migration is needed. This service owns the request lifecycle
exclusively (TRD §3.6), and an employee-initiated cancellation of a
pending request has no HCM implication: the pending hold is
local-only, never communicated to HCM, and the HCM has nothing to
undo. No outbox row, no HCM push, no async phase. The slice is
mechanically a rename of the reject slice with a different target
status and a different nominal actor.

**Request body field (reason / confirmation flag).** No body field
is added. The reject endpoint accepts no body and this is the
established pattern. Adding an optional `reason` string would be
§8.7 non-invention — the brief does not mention it, nothing in the
TRD records it as a requirement, and the domain entity has no
`cancellationReason` column. Defer if the real product spec asks
for it.

**Ownership check (`employeeId` verifier in body).** No ownership
check is added to this slice. There is no auth layer (the user
explicitly ratified the no-auth position for this take-home), so
there is no token from which to extract an identity. Adding a
body-level `employeeId` verifier that any caller can fabricate
provides false security with no integrity guarantee — it is
invented enforcement (§8.7) against a risk that the no-auth
environment by definition cannot close. The correct fix is an auth
layer; that is explicitly deferred. The cancel endpoint is
therefore open to any caller who knows the request UUID, identical
to how reject and approve behave today. This assumption is logged
in section 6 below.

**What is out of scope:** HCM batch intake, outbox worker,
read/list endpoints, any changes to approve/create/reject, DRY
extraction of shared reject/cancel logic, the auth/ownership layer.

## 2. Primary Flow

The flow is identical to reject with `'rejected'` replaced by
`'cancelled'`. All writes execute inside a single `db.transaction`.
No second transaction needed.

1. `requestsRepo.findById(id, tx)` — if missing, throw
   `RequestNotFoundError`.
2. Guard `existing.status === 'pending'` — if not, throw
   `InvalidTransitionError(existing.status, 'cancelled')`.
3. Guarded `UPDATE requests SET status='cancelled' WHERE id=? AND
   status='pending'` — returns row count. If `changes !== 1`,
   re-read and throw `InvalidTransitionError(current.status,
   'cancelled')`.
4. `holdsRepo.deleteByRequestId(existing.id, tx)` — releases the
   balance reservation atomically.
5. Return the cancelled `TimeOffRequest` built by a new pure
   domain function `cancelPendingRequest(existing)`.

`hcmSyncStatus` stays `'not_required'` — same reasoning as reject
(TRD §3.6, §4). No column is touched on the `hcm_outbox` because
no outbox row was ever created for a pending request.

**Files that are strict s/reject/cancel/ copies.** Domain function,
repo method, use case class, controller method, module provider,
e2e spec, integration spec. None additional require thought —
`InvalidTransitionError` already accepts any `RequestStatus` for
`from` and `to`; no change needed.

**DRY extraction.** Deferred per prompt constraint and §10.

## 3. Schema Changes

None. `cancelled` is already a valid value in the `requests.status`
column definition (via `requestStatusValues` in
`src/domain/request.ts`). The existing Drizzle schema therefore
already accepts the value. No migration is generated.

## 4. Risks

**R1 — Concurrent cancel (or cancel racing approve/reject).** Same
concurrency fence as reject: `UPDATE ... WHERE status='pending'`
decides the winner; `changes=0` triggers a re-read and
`InvalidTransitionError` with honest `currentStatus`. Requires a
real `Promise.allSettled` concurrency test.

**R2 — Idempotent cancel replay (cancel-after-cancel).** Same R2
as reject: the caller retrying a successful cancel hits the
`pending` guard, gets `InvalidTransitionError` with
`currentStatus: 'cancelled'`, and can reconcile from the
`currentStatus` field in the 409 body (TRD §7 precedent).

**R3 — Hold leak on partial failure.** Identical to reject R3:
`better-sqlite3` transactions are atomic; there is no partial-
failure window inside `db.transaction`.

**R4 — Hold already absent at cancel time.** Same as reject R4:
`deleteByRequestId` is a no-op DELETE.

**R5 (new actor) — Manager hitting the cancel endpoint.** In the
no-auth world this is a policy non-issue: the endpoint does not
know who the caller is. A manager-initiated cancel is
indistinguishable from an employee-initiated cancel at the HTTP
layer. The distinction matters only for audit trail semantics,
and audit semantics are deferred with auth. This is not a
code-level risk, it is a stated constraint.

## 5. Ordered TDD Implementation Steps

1. `test(e2e): add failing POST /requests/:id/cancel happy-path
   spec`.
2. `feat(domain): add cancelPendingRequest transition`.
3. `feat(time-off): add RequestsRepository.cancel(id, tx)`.
4. `feat(time-off): implement CancelRequestUseCase`.
5. `feat(time-off): wire POST /requests/:id/cancel controller`.
6. `test(e2e): cover cancel-after-approve returns 409
   INVALID_TRANSITION`.
7. `test(integration): cover concurrent cancel serialisation`.

## 6. Open Questions / Assumptions

- **A1** No ownership check (no-auth world; invented enforcement
  rejected).
- **A2** No `reason` field (§8.7).
- **A3** `hcmSyncStatus` stays `'not_required'`.
- **A4** DRY extraction deferred until a third terminal transition
  or a reviewer finding actually motivates it.
