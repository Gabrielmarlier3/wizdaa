# Plan 005 — Subagent discipline formalization + approve slice (`POST /requests/:id/approve`)

## Context

Plan 004 shipped the first TDD slice but executed without any subagent
use — `reviewer` caught that gap at push time and surfaced two real
issues the monolithic execution would have shipped. The lesson is
recorded in `docs/devlog.md` session 5.

This plan does two things in one approved unit:

1. **Formalize subagent discipline structurally** so it is not a ritual
   the lead remembers. The rule moves into `CLAUDE.md` (auto-loaded
   every turn) and the plan template in `docs/process.md` gains an
   *Architect briefing* section that makes every archived plan either
   contain the brief or be demonstrably incomplete.

2. **Implement the approve slice** (`POST /requests/:id/approve`)
   under the new discipline, architect-briefed up front, reviewer-
   checked before push. The architect subagent has already been run
   against slice scope during planning; its output is Appendix A.

User ratifications (via `AskUserQuestion`):

- **Discipline scope:** CLAUDE.md rule + `docs/process.md` plan
  template. Slash commands (`/slice-brief`, `/slice-close`) deferred
  per §10 (no speculative tooling).
- **Manager identity on approve:** none. Empty body; no `approvedBy`
  column. Identity lands with the auth slice if ever scoped.

---

## Phase A — Discipline formalization (2 commits)

### A1. `docs(claude): add subagent discipline rule to CLAUDE.md`

Add a new section near the bottom of `CLAUDE.md`:

```
## Subagent discipline

Every feature slice must exercise at least two subagents:

- `architect` **before planning**. Its output (scope, flow, risks,
  ordered TDD steps) is inlined or appended to the archived plan;
  plans without it are incomplete.
- `reviewer` **before push**. Findings are triaged as
  blocking / should fix / nit and either resolved or explicitly
  deferred in the devlog.

Other subagents (`domain-data`, `api-contract`, `sync-integration`,
`test-qa`) are invoked when the slice touches their scope — as
specialized review, not ceremony.
```

### A2. `docs(process): require Architect briefing in the plan template`

Add a *Plan template* section to `docs/process.md`:

```
## Plan template

Every plan archived in `docs/plans/NNN-*.md` must include:

- **Context** — why the change is happening.
- **Architect briefing** — the output of the architect subagent run
  during planning, inlined or appended. Absent = plan incomplete.
- **Decisions locked** — what is decided before execution starts.
- **Phases** — each phase a commit-sized unit of work.
- **Files touched** — inventory with NEW / MODIFIED markers.
- **Verification** — how we will prove the plan succeeded.
- **Out of scope** — explicit boundaries for the next plan.
- **Pre-push checklist** — reviewer pass listed here; its completion
  and findings logged in `docs/devlog.md`.
```

Also update the existing *Plan → execute → commit cycle* section to
call out the two mandatory subagents explicitly at their positions in
the cycle (architect at step 1, reviewer at step 4 pre-commit).

---

## Phase B — Approve slice implementation

Follows the architect brief (Appendix A) step by step. One commit per
TDD unit; paths are from architect's *Files most relevant to the slice*.

### B1. `test(e2e): add failing POST /requests/:id/approve happy-path spec`
`test/e2e/time-off-approve.e2e-spec.ts` — seed balance, create pending
request via slice-1 endpoint, `POST /requests/:id/approve`, expect
`200` with `status: 'approved'`, `hcmSyncStatus: 'synced'`. Fails
because endpoint, schema, and mock endpoint all missing.

### B2. `feat(database): add hcm_outbox, approved_deductions and hcm_sync_status`
New `hcm_outbox` table (UNIQUE `request_id`, UNIQUE `idempotency_key`,
INDEX `(status, next_attempt_at)`). New `approved_deductions` table
(UNIQUE `request_id`). New `requests.hcm_sync_status` column defaulting
to `'not_required'`. Migration generated via `drizzle-kit generate`.
Schema comments cite the §9 decisions backing each.

### B3. `feat(domain): add approvePendingRequest transition`
Extend `src/domain/request.ts` with `approvePendingRequest(request):
TimeOffRequest` — enforces `status === 'pending'` precondition, returns
new entity with `status: 'approved'` and `hcmSyncStatus: 'pending'`.
New `InvalidTransitionError`. Unit specs: happy path, rejection for
every non-pending status.

### B4. `feat(time-off): extend repositories for approval flow`
- `RequestsRepository.findById(id, tx)`, `RequestsRepository.approve(id, tx)`
  — the latter is the guarded `UPDATE ... WHERE status='pending'` that
  acts as the concurrency fence; returns the changes count.
- `HoldsRepository.deleteByRequestId(id, tx)` and
  `HoldsRepository.sumActiveHoldDaysForDimensionExcludingRequest(...)`.
- New `ApprovedDeductionsRepository` with `insert`,
  `sumNotYetPushedDaysForDimension` (joins `hcm_outbox`).
- New `HcmOutboxRepository` with `insert`, `markSynced`,
  `markFailedRetryable`, `markFailedPermanent`.

### B5. `feat(hcm): add HcmClient with bounded timeout and typed outcomes`
`src/hcm/hcm.client.ts`. One method `postMutation(...)`; `fetch` with
2s timeout; returns a discriminated union
`{ kind: 'ok', hcmMutationId } | { kind: 'permanent', status, body } | { kind: 'transient', reason }`.
Base URL from `HCM_MOCK_URL` env var (already exported by e2e
`globalSetup`).

### B6. `feat(hcm-mock): add POST /balance/mutations and POST /test/scenario`
Extend `scripts/hcm-mock/server.ts`:
- `POST /balance/mutations` validates body + `Idempotency-Key` header,
  maps `key → response` in-memory so retries with the same key return
  the same `hcmMutationId` (TRD §3.2 requirement).
- `POST /test/scenario` accepts `{ mode }` with modes `force500`,
  `forceTimeout`, `forcePermanent` (409), `forceBadShape`.

### B7. `feat(time-off): implement ApproveRequestUseCase`
Orchestrator described in Appendix A §2. One transaction for the local
commit (load, re-check balance, UPDATE request, DELETE hold, INSERT
approved_deduction, INSERT outbox); post-commit inline push via
`HcmClient`; resolution in a tiny second transaction (markSynced /
markFailedRetryable / markFailedPermanent + update `hcm_sync_status`).
Uses `randomUUID` for `idempotencyKey`.

### B8. `feat(time-off): wire POST /requests/:id/approve controller`
`ParseUUIDPipe` on `:id`. Exception mapping:
- `RequestNotFoundError → 404`
- `InvalidTransitionError → 409 INVALID_TRANSITION` with body
  `{ code, message, currentStatus }` so retry clients can reconcile
  (risk R4 in Appendix A).
- `InsufficientBalanceError → 409 INSUFFICIENT_BALANCE`
- `InvalidDimensionError → 422 INVALID_DIMENSION`
B1's failing spec goes green.

### B9. `test(e2e): cover HCM transient failure keeps approval pending`
Scenario `force500`. Assert `200` with `hcmSyncStatus: 'pending'`,
outbox `status = 'failed_retryable'`, local approval stands.

### B10. `test(e2e): cover HCM permanent failure flags request as failed`
Scenario `forcePermanent`. Assert `200` with `hcmSyncStatus: 'failed'`,
outbox `status = 'failed_permanent'`, local approval stands
(§8.3 — our truth is authoritative locally).

### B11. `test(integration): cover approval-time re-check after HCM value change`
Risk R6 canary. Create pending 3-day request against 10-day balance.
Directly mutate `balances.hcmBalance` to 2. Call the use case.
Expect `InsufficientBalanceError`; assert request still `pending`,
hold intact, no outbox row, no approved_deduction. First real use
of non-zero `approvedNotYetPushedDays` in projection.

### B12. `test(integration): cover concurrent approve serialization`
Risk R1. `Promise.all` two approvals on the same id. Expect exactly
one success, exactly one `InvalidTransitionError`, exactly one outbox
row, `requests.status = 'approved'`, zero holds. Real interleaving —
§8 convention forbids calling sequentially.

### B13. `test(e2e): cover idempotent approve replay returns 409 with state`
Approve once (success). Approve same id again. Expect `409
INVALID_TRANSITION` with body containing the current approved request
resource. Assert no second outbox row, no second HCM call (mock
tracks call counts per `idempotencyKey`).

### B14. `test(e2e): cover mock HCM idempotency-key dedup`
Direct POST to `/balance/mutations` on the mock twice with the same
`Idempotency-Key`. Assert same `hcmMutationId` returned. Guards the
mock's contract fidelity for the deferred outbox worker slice.

### B15. `docs(trd): fill §4 Data model, §5 HCM integration, §7 Error taxonomy`
Now that the second slice landed real design, the TBD sections gain
real content (not speculative):
- **§4 Data model** — the five tables we now have; the ledger-overlay
  story; state machine diagram.
- **§5 HCM integration strategy** — outbox + inline-push + resolution
  transaction; assumption list (2s timeout, scenario-injection hooks).
- **§7 Error taxonomy** — the enum of error codes now backed by e2e
  tests: `INVALID_INPUT` (400, validation), `INVALID_DIMENSION` (422),
  `INSUFFICIENT_BALANCE` (409), `INVALID_TRANSITION` (409, includes
  current state), `REQUEST_NOT_FOUND` (404), HCM-side categories for
  audit.

Also adds one new §9 decision entry:

> **2026-04-24 — Approved deductions as a separate ledger table**
> - Decision: `approved_deductions` is a separate table from `holds`.
> - Reason: different lifecycles; the projection filters differently
>   on each; fusing via a `type` flag forces conditional queries and
>   blurs two clear concepts (§8.2 simplicity).
> - Alternatives: type-flagged `holds` (rejected); derive from
>   `requests ⨝ hcm_outbox.status` without a ledger table (rejected:
>   §14 coherent constraints favour explicit overlay tables).
> - Impact: new `ApprovedDeductionsRepository`; balance projection
>   joins on `hcm_outbox.status IN ('pending', 'failed_retryable')`.

And surfaces architect's open questions in §10 as new unresolved
items:
- Outbox worker topology (inline-only now; startup sweep + periodic
  worker deferred).
- `inconsistency`-flagged dimension interaction with pending approvals
  (deferred until batch intake slice).
- Inline push timeout budget (2s, assumption not load-tested).

---

## Phase C — Reviewer pre-push + followups (1–N commits)

1. Invoke `reviewer` subagent on the full local diff vs `origin/main`.
2. Triage findings into Blocking / Should fix / Nit.
3. Apply or defer explicitly (deferred items land in the devlog).
4. Commit fixes as `fix(...)` / `refactor(...)` / `chore: apply reviewer followups` as shape dictates.

---

## Phase D — Wrap (2 commits)

1. **`docs(devlog): session 6 — approve slice and discipline formalization`**
   Narrates Phase A + B + C. Records the architect invocation during
   planning and the reviewer invocation before push as evidence that
   the new rule is being exercised. Soft tone, no theater.

2. **`docs(plans): archive plan 005`**
   Copy this file to
   `docs/plans/005-subagent-discipline-and-approve-slice.md`. Update
   `docs/plans/README.md` with the new entry. Appendix A (architect
   brief) goes in verbatim.

---

## Files touched

```
CLAUDE.md                                                        MODIFIED
docs/process.md                                                  MODIFIED
docs/plans/README.md                                             MODIFIED
docs/plans/005-subagent-discipline-and-approve-slice.md          NEW
docs/devlog.md                                                   MODIFIED

TRD.md                                                           MODIFIED (§4, §5, §7 fill; §9 new entry; §10 new open items)

src/database/schema.ts                                           MODIFIED
drizzle/0001_*.sql                                               NEW

src/domain/request.ts                                            MODIFIED (approvePendingRequest, InvalidTransitionError)
src/domain/request.spec.ts                                       MODIFIED

src/time-off/repositories/requests.repository.ts                 MODIFIED
src/time-off/repositories/holds.repository.ts                    MODIFIED
src/time-off/repositories/approved-deductions.repository.ts      NEW
src/time-off/repositories/hcm-outbox.repository.ts               NEW
src/time-off/approve-request.use-case.ts                         NEW
src/time-off/time-off.controller.ts                              MODIFIED
src/time-off/time-off.module.ts                                  MODIFIED

src/hcm/hcm.client.ts                                            NEW
src/hcm/hcm.module.ts                                            NEW (wired into TimeOffModule or AppModule)

scripts/hcm-mock/server.ts                                       MODIFIED

test/e2e/time-off-approve.e2e-spec.ts                            NEW
test/integration/approve-request.integration-spec.ts             NEW
test/helpers/test-app.ts                                         MODIFIED (if any new seed/query helpers emerge)
```

---

## Verification

### After Phase A
- `grep -c '^## ' CLAUDE.md` increases by one.
- `grep -c '^## ' docs/process.md` increases by one.
- New sections readable and coherent with the rest of the doc.

### After Phase B (per commit, green at each step)
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`
  green on every commit that claims green.
- `grep -c '^> \*\*202' TRD.md` ends at 11 (one new decision entry).
- `grep -c '> TBD' TRD.md` drops to 1 (only §6 concurrency remains,
  to be filled when the concurrent-approve test body is written).
- New tables visible via
  `sqlite3 /tmp/wizdaa-*.db '.tables'` after `npm run db:migrate`.

### After Phase C
- Reviewer output captured in the devlog with each finding labelled
  resolved / deferred.
- No Blocking findings open.
- `git log --all --format='%B' | grep -iE '\bexaminer\b|\bgrader\b'`
  still zero matches.

### After Phase D
- `docs/plans/005-*.md` exists with Appendix A present.
- `docs/plans/README.md` lists 005.
- `docs/devlog.md` has a session-6 entry explicit about architect +
  reviewer invocations.

---

## Out of scope

- `POST /requests/:id/reject` and `POST /requests/:id/cancel` — next
  slices.
- HCM batch intake (`POST /hcm/balances/batch`) — later.
- Reconciliation / `inconsistency` surfacing — later.
- Out-of-process outbox worker, startup sweep, interval polling —
  architect recommends the startup sweep for the *next* slice; this
  slice is inline-only per Appendix A §6.1.
- Manager identity / auth — deferred by user ratification.
- Slash commands (`/slice-brief`, `/slice-close`) — deferred per §10.
- Unified coverage across unit + integration + e2e — noted as debt
  in the session-4 devlog entry; not blocking this slice.

---

# Appendix A — Architect brief (verbatim)

> The following is the full output of the `architect` subagent run
> during planning on 2026-04-24. Read-only analysis; the
> implementation plan above is the synthesis between this brief and
> the user's ratifications.

## 1. Scope boundary

**In this slice.** Manager-initiated approval of a single `pending`
request by id. The transition writes, atomically:
`requests.status = approved`, `requests.hcmSyncStatus = pending`, a
ledger row recording the `approved_deduction` overlay, a release of
the pending hold, and an `hcm_outbox` row carrying the mutation
intent with a generated `hcmIdempotencyKey`. After the transaction
commits, the use case triggers one inline push attempt against the
HCM mock via `POST /balance/mutations` (TRD §3.2); the response
resolves the outbox row to `synced`, `failed_retryable`, or
`failed_permanent`. HTTP response returns the updated request
(including `hcmSyncStatus`) the moment the commit lands — the inline
push result is not awaited by the HTTP path beyond observability.

**Deferred.** Rejection, cancellation, HCM batch intake,
reconciliation of `inconsistency` state, out-of-process outbox worker
and startup sweep, manager identity / authorization, multi-line
approval, `failed_permanent` resolution workflow, balance GET
endpoint.

## 2. Primary flow (end-to-end)

Actors: Manager (HTTP) → Nest controller → `ApproveRequestUseCase` →
SQLite (Drizzle tx) → HCM client → HCM mock.

**Step 1 — HTTP ingress.** `POST /requests/:id/approve` with empty
body. `ParseUUIDPipe` validates `:id`; controller delegates to the
use case. No body DTO.

**Step 2 — Transactional commit** (inside `db.transaction(tx => ...)`):
1. `findById` the request. Not found → `RequestNotFoundError` (404).
   Non-pending → `InvalidTransitionError` (409, body carries current
   status).
2. `findByDimension` the balance row. Absent → `InvalidDimensionError`
   (422) — a pending request whose dimension disappeared is a genuine
   inconsistency, not silent approval.
3. `pendingDays` = sum of holds for the dimension **excluding this
   request's own hold** (we are about to delete it).
   `approvedNotYetPushedDays` = sum of `approved_deductions` for the
   dimension where the linked request's `hcm_outbox.status IN
   ('pending', 'failed_retryable')`.
4. **Re-check balance** via `hasSufficientBalance`. A batch sync that
   shrank HCM balance between creation and approval, or a concurrent
   approval on the same dimension, is caught here. §8.3 — re-check
   even if creation passed.
5. State transition + ledger swap:
   - `UPDATE requests SET status='approved', hcmSyncStatus='pending'
     WHERE id=:id AND status='pending'`. The guard on `status` is the
     concurrency fence.
   - `DELETE FROM holds WHERE request_id=:id`.
   - `INSERT INTO approved_deductions(...)`.
   - `INSERT INTO hcm_outbox(id, request_id, idempotency_key,
     payload_json, status='pending', attempts=0, next_attempt_at=now,
     ...)`.
6. Commit.

**Step 3 — Inline HCM push** (post-commit, before HTTP response
returns): one best-effort call via `HcmClient.postMutation(...)` with
2s timeout and `Idempotency-Key: <idempotencyKey>`.
- 2xx with valid `hcmMutationId` → second small tx: outbox `synced`,
  `requests.hcmSyncStatus = 'synced'`.
- 4xx (409/422) → outbox `failed_permanent`,
  `requests.hcmSyncStatus = 'failed'`. Local approval stands
  (§8.3). Logged loudly.
- 5xx / network / timeout → outbox `failed_retryable`, attempts+=1,
  next_attempt_at set. `requests.hcmSyncStatus` stays `pending`.
- Unexpected shape / missing id → `failed_retryable`, distinct log.
  Never mark `synced` on malformed 2xx (§3.5 *HCM accepts what we
  would reject*).

**Step 4 — HTTP response.** `200 OK` with the updated request
including `hcmSyncStatus`. Manager sees immediate truth: approval is
committed locally regardless of HCM availability.

## 3. Schema changes

### 3.1 `hcm_outbox` (new)
```
id, request_id (UNIQUE, FK → requests), idempotency_key (UNIQUE),
payload_json, status (pending | synced | failed_retryable |
failed_permanent), attempts, next_attempt_at, last_error,
hcm_mutation_id, synced_at, created_at
```
Indexes: `UNIQUE(request_id)` is the secondary anti-dup fence;
`UNIQUE(idempotency_key)` is the §9 server-side dedup truth;
`INDEX(status, next_attempt_at)` readies a future worker's polling
query.

### 3.2 `approved_deductions` (new, **separate from `holds`**)
```
id, request_id (UNIQUE, FK → requests), employee_id, location_id,
leave_type, days, created_at
```

**Defensible position:** separate table, not a `type` column on
`holds`. Different lifecycles (hold is always deleted on
approve/reject/cancel; deduction is durable). Different projection
conditions (`pendingDays` excludes the current request during
approval; `approvedNotYetPushedDays` conditions on
`hcm_outbox.status`). §8.2 favours the split.

### 3.3 `requests.hcm_sync_status` (new column)
Enum `not_required | pending | synced | failed` with default
`'not_required'`. Denormalized projection of outbox state needed by
the HTTP read path so a GET does not join `hcm_outbox` every time.
Updated in the same tx that moves outbox state.

### 3.4 No changes to existing slice-1 tables
`balances`, `holds`, `requests` (other than the new column) intact.

## 4. Risks

**R1 Concurrent approvals on same request** — handled by
`UPDATE ... WHERE status='pending'` guard; losers see 0 rows and
raise `InvalidTransitionError`. `UNIQUE(request_id)` on `hcm_outbox`
is secondary fence. Test must actually interleave (§8 convention).

**R2 Partial failure: commit succeeds, inline push never runs** —
service crashes between COMMIT and HCM call. Outbox row exists;
request is `approved`/`syncStatus='pending'`. Deferred worker picks
it up with the same `idempotencyKey`. Risk in *this* slice: no worker
→ record sits until a manual retry. Startup sweep flagged for next
slice.

**R3 Outbox orphaning** — transient HCM 500, no worker →
`failed_retryable` indefinitely. Integration test covers the state;
TRD note required.

**R4 Idempotent replay after client timeout** — client times out at
5s, HCM call finishes at 10s. Client retries; second call sees
`status='approved'`, raises `InvalidTransitionError` → 409. Mitigation
(chosen): body includes current resource so client reconciles.

**R5 HCM semantics mismatch** — 2xx with malformed body. Guard: the
HCM client validates response shape; on mismatch, `failed_retryable`,
distinct log. Mock has scenario hook.

**R6 Batch-induced inconsistency mid-approve** — batch shrinks HCM
value between creation and approval. Step 2.4 re-check catches it;
without re-check we'd silently overdraw. Integration test with
direct balance mutation covers this today, even though batch
endpoint is deferred.

**R7 Unique-constraint race on outbox insert** — if R1's guard is
ever weakened, `UNIQUE(request_id)` is the belt-and-suspenders.
Worth asserting.

## 5. Ordered TDD implementation steps

15 steps, grouped in the body of this plan as commits B1–B15.

## 6. Open questions surfaced

1. Outbox worker topology. Recommendation for next slice: inline +
   startup-sweep. Periodic worker deferred until load evidence.
2. Manager identity on approve (confirmed deferred by user).
3. `inconsistency`-flagged dimension interaction with pending
   approvals (deferred to batch intake slice; hook point documented
   in TRD).
4. `approved_deductions` retention policy — kept indefinitely;
   projection filters on `hcm_outbox.status` naturally excludes
   synced rows.
5. Inline push timeout budget — 2s default. Documented assumption.
6. 409 `INVALID_TRANSITION` envelope shape — body carries current
   state. Precedent documented in TRD §7.

**Assumptions flagged:**
- 2s inline HCM timeout (not load-tested).
- Manager identity deferred.
- `approved_deductions` retained indefinitely post-sync.
- `hcmSyncStatus` four-value enum with `failed` collapsing
  `failed_permanent` at the HTTP layer.
