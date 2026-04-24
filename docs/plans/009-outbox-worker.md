# Plan 009 — HCM outbox worker

## Context

The approve slice's inline HCM push covers the fast path, but a
`failed_retryable` outbox row sits in the table forever until a
new approve call happens to land. TRD §10 open question 8
explicitly names this gap ("Outbox worker topology — slice 2 runs
inline-only … a `failed_retryable` outbox row therefore sits
until the next manual action"). Worse, the balance projection's
`approvedNotYetPushedDays` keeps the deduction in the overlay as
long as the outbox row is not `synced`, so any stuck row
artificially under-counts available balance indefinitely.

This slice closes §10 Q8 by adding an in-process polling worker
that drains `hcm_outbox` rows whose `next_attempt_at` is due,
pushes them via the existing `HcmClient`, and updates the outbox
row + `requests.hcmSyncStatus` atomically — the same resolution
shape the approve use case already runs post-commit.

No new HTTP endpoint, no new error code, no new schema. One new
Nest provider (`HcmOutboxWorker`), one new repository method
(`claimDueBatch`), two defensive guards on existing repo writes,
one TRD §9 decision entry for the retry policy, and §10 Q8 moves
to "Closed".

## Architect briefing

Full output preserved as Appendix A. Positions taken:

- **Worker topology: in-process, single worker, `setInterval` in
  `onModuleInit` / cleared in `onModuleDestroy`.** No
  `@nestjs/schedule` dependency — a 5-line interval is enough, and
  INSTRUCTIONS.md §10 prohibits dependencies without concrete need.
- **Inline push in `ApproveRequestUseCase` stays unchanged.** The
  worker is additive. Removing inline push would turn the approve
  response's immediate `hcmSyncStatus='synced'` into a
  poll-interval-delayed `'synced'` — a user-visible UX shift that
  deserves its own deliberate slice.
- **Poll query: `SELECT … WHERE status IN ('pending','failed_retryable')
  AND next_attempt_at <= now() ORDER BY next_attempt_at ASC LIMIT N`.**
  Single-process, single-worker — no `SKIP LOCKED` needed (SQLite
  does not support it). The `(status, next_attempt_at)` index
  already exists in the schema exactly for this query.
- **Retry policy: exponential `30s × 2^attempts`, cap 30min, max
  5 attempts before promotion to `failed_permanent`.** New §9
  decision entry. The numbers are a proposal; the decision records
  rationale so future evidence can change them.
- **`requests.hcmSyncStatus` flips to `'failed'` only on
  `failed_permanent`** (either HCM 4xx, or attempt-exhaustion on a
  transient failure). `'pending'` stays truthful while retries are
  in flight.
- **R5 guard: `markFailedRetryable` / `markFailedPermanent` gain
  `WHERE status != 'synced'`.** Prevents a late inline-push-completion
  and a worker tick from racing to downgrade an already-synced row.
- **Test-mode guard: interval is not started when
  `process.env.NODE_ENV === 'test'`.** Integration and e2e tests
  retrieve the worker via `app.get(HcmOutboxWorker)` and call
  `tick()` manually. No fake timers, no race with teardown.
- **Payload on retry is deserialized from `hcm_outbox.payloadJson`** —
  the outbox row is the intent record and already carries
  everything needed. Worker never joins back to `requests`.

## Decisions locked before planning

1. **Worker is additive to inline push.** `ApproveRequestUseCase`
   unchanged. (Architect §1 assumption.)
2. **Retry schedule: `nextAttemptAt = now + min(30_000 × 2^attempts,
   30 × 60_000)`. `MAX_ATTEMPTS = 5`.** Recorded as TRD §9 decision
   13 in step A8.
3. **`requests.hcmSyncStatus → 'failed'` only when the outbox row
   writes `failed_permanent`**, never on each `failed_retryable`.
4. **New repo method `claimDueBatch(limit, nowIso)` returns rows
   ordered by `next_attempt_at ASC`.** No row-lock semantics — the
   single-process contract is the architecture.
5. **`markFailedRetryable` / `markFailedPermanent` gain `AND status
   != 'synced'`.** Covers architect R5.
6. **Interval disabled when `NODE_ENV === 'test'`**; tests drive
   `tick()` manually via `app.get(HcmOutboxWorker).tick()`.
7. **Minimal observability: per-outcome `log`/`warn`/`error`; no
   per-tick log when zero rows are due** (avoid steady-state spam).
8. **Retry payload comes from `outbox.payloadJson`** — parsed once,
   re-sent with the stored `idempotencyKey`. Worker never generates
   a new key on retry (double-deduct risk; covered by architect §6).
9. **No config via env for `MAX_ATTEMPTS`, `BACKOFF_BASE_MS`,
   `BACKOFF_CAP_MS`, `POLL_MS`.** Module-level constants. §10
   (no speculative abstraction) until a real operational ask
   appears. `BATCH_SIZE` and `POLL_MS` also constants.
10. **No new error codes.** The worker is not an HTTP endpoint.

## Phase A — Implementation (8 commits)

### A1. `test(hcm): add failing unit specs for HcmOutboxWorker tick()`

`src/hcm/hcm-outbox-worker.spec.ts` (new). Jest mocks for
`HcmOutboxRepository.claimDueBatch`, `RequestsRepository.updateHcmSyncStatus`,
`HcmClient.postMutation`. Initial specs:

- Zero due rows → no HCM calls, no repo writes.
- One `pending` row + `ok` result → `markSynced(id, hcmMutationId,
  syncedAt)`; `updateHcmSyncStatus(requestId, 'synced')`.
- The `idempotencyKey` passed to `HcmClient` is read from the row,
  not freshly generated.

Fails because `HcmOutboxWorker` does not exist.

### A2. `feat(hcm): implement HcmOutboxWorker + claimDueBatch repo method`

- `src/time-off/repositories/hcm-outbox.repository.ts`:
  - Add `HcmOutboxRow` export (the row shape `claimDueBatch` returns).
  - Add `claimDueBatch(limit: number, nowIso: string): HcmOutboxRow[]`
    returning `pending | failed_retryable` rows with `next_attempt_at
    <= nowIso`, ordered `next_attempt_at ASC`, limited by `limit`.
- `src/hcm/hcm-outbox-worker.ts` (new). Module-level constants
  `MAX_ATTEMPTS = 5`, `BACKOFF_BASE_MS = 30_000`,
  `BACKOFF_CAP_MS = 30 * 60_000`, `BATCH_SIZE = 10`, `POLL_MS = 5_000`.
  `@Injectable()` class with a public `tick(): Promise<void>`:
  1. `const now = new Date().toISOString(); const rows = repo.claimDueBatch(BATCH_SIZE, now);`
  2. For each row, sequentially:
     - Parse `payloadJson` into the `HcmMutationInput` shape.
     - Await `hcmClient.postMutation({ ...payload, idempotencyKey: row.idempotencyKey })`.
     - Resolve in a single `db.transaction(tx => …)`:
       - `ok` → `markSynced` + `updateHcmSyncStatus('synced')`.
       - `permanent` → `markFailedPermanent` + `updateHcmSyncStatus('failed')`.
       - `transient`:
         - If `row.attempts + 1 >= MAX_ATTEMPTS` → `markFailedPermanent`
           with a distinctive error like `"exhausted: <reason>"` +
           `updateHcmSyncStatus('failed')`.
         - Else → `markFailedRetryable(id, reason, nextAttemptAt(row.attempts))`.
- No interval wiring yet (A4 adds it).

Unit specs from A1 go green.

### A3. `test(hcm): extend worker specs for transient, permanent, exhaustion, ordering`

Add specs:

- Transient with `attempts=0` → `markFailedRetryable` called with
  `nextAttemptAt = now + 30_000` (exponent = 0). `updateHcmSyncStatus`
  **not** called.
- Transient with `attempts=2` → `nextAttemptAt = now + 120_000`.
- Transient with `attempts=10` → capped at `now + 30 * 60_000`.
- Permanent (HTTP 409 from mock) → `markFailedPermanent` +
  `updateHcmSyncStatus('failed')`.
- Transient at `attempts=4` (last retry) → `markFailedPermanent` +
  `updateHcmSyncStatus('failed')` (attempt-exhaustion promotion).
- Two due rows returned from `claimDueBatch` → processed in the
  order returned (test asserts `HcmClient.postMutation` call order).

### A4. `feat(hcm): wire HcmOutboxWorker auto-tick in HcmModule`

- `src/hcm/hcm-outbox-worker.ts`:
  - Implement `OnModuleInit` and `OnModuleDestroy`.
  - `onModuleInit()`: if `process.env.NODE_ENV !== 'test'`, start a
    `setInterval(() => { void this.tick().catch(err =>
    this.logger.error(…)); }, POLL_MS)`.
  - `onModuleDestroy()`: `clearInterval` if set.
- `src/hcm/hcm.module.ts`:
  - Add `imports: [TimeOffModule]` (worker needs `HcmOutboxRepository`
    and `RequestsRepository`, both already exported from
    `TimeOffModule` since plan 008).
  - Add `HcmOutboxWorker` to providers.
  - Export `HcmOutboxWorker` so tests can `app.get()` it.

### A5. `feat(outbox): guard retry/permanent marks against downgrading a synced row`

- `HcmOutboxRepository.markFailedRetryable` and `markFailedPermanent`:
  extend the `.where()` with `and(eq(id,…), ne(status, 'synced'))`.
  Use Drizzle's `and` + `ne` imports.
- Add a unit or integration spec (prefer integration, real DB) that
  seeds a `synced` row and calls both mark methods — both are no-ops
  (zero rows changed, no throw, row stays `synced`).
- Covers architect R5.

### A6. `test(integration): worker drains outbox against real DB + mock HCM`

`test/integration/hcm-outbox-worker.spec.ts` (new). Build the Nest
app via the existing `test/helpers/test-app.ts`, retrieve the
worker via `ctx.app.get(HcmOutboxWorker)`, seed outbox rows
directly, flip mock scenario via `/test/scenario`, call
`worker.tick()`, assert DB state.

Cases (matched to architect §11):

- `pending` row + mock `normal` → `synced`, `hcmSyncStatus='synced'`.
- `failed_retryable` row with `attempts=1` + mock `normal` →
  `synced` (idempotency-key replay works because the mock stored
  no prior outcome for this key yet, i.e. different key).
- `pending` row + `force500` → `failed_retryable`, `attempts=1`,
  `nextAttemptAt` is ~30s in the future (±slack).
- `pending` row + `forcePermanent` → `failed_permanent`,
  `hcmSyncStatus='failed'`.
- `pending` row + `forceBadShape` → `failed_retryable` (not `synced`).
- Row with `attempts=4` + `force500` → `failed_permanent` with
  "exhausted" error, `hcmSyncStatus='failed'`.
- Row with `next_attempt_at` 1 hour in the future → not claimed.
- Row with `status='synced'` → not claimed.

### A7. `test(e2e): approve-then-tick recovery for transient failures`

`test/e2e/time-off-outbox-worker.e2e-spec.ts` (new):

- Set mock `force500` → approve a request → response body shows
  `hcmSyncStatus='pending'`. Reset mock to `normal` via
  `POST /test/scenario`. `await ctx.app.get(HcmOutboxWorker).tick()`.
  `GET /requests/:id` → `hcmSyncStatus='synced'`.
- Set mock `forceBadShape` → approve → `hcmSyncStatus='pending'`.
  Reset to `normal`. Tick. `GET /requests/:id` → `synced`. Verify
  `GET /test/state` on the mock to confirm exactly one entry in
  `mutationsLog` (the replay did not create a duplicate mutation
  — the second request to the mock is the worker's retry; the
  first `force500` call never hit the accept path).

### A8. `docs(trd): record outbox worker decision; close §10 Q8`

- TRD §5: replace the current paragraph that ends "resolved by the
  post-commit inline push, **or by a future out-of-process worker**…"
  with text describing the now-implemented worker (in-process,
  polling cadence, retry schedule, promotion rule). Keep the
  paragraph short — the decision log carries the rationale.
- TRD §9: add decision 13 `2026-04-24 — Outbox worker polls every
  5s with exponential backoff (30s × 2, cap 30min, max 5 attempts)`.
  Rationale + alternatives (synchronous retry loop in the request
  handler rejected; `@nestjs/schedule` rejected; circuit breaker
  deferred).
- TRD §10: move item 8 (`Outbox worker topology`) to the "Closed"
  block with a pointer to §9 decision 13.

## Phase B — Reviewer pre-push + followups (0-N commits)

Invoke `reviewer` subagent. Expectation: the worker is a new
concern but follows existing use-case/repo/resolution patterns
cleanly. Any findings triaged; applied or deferred with a devlog
note.

## Phase C — Wrap (1-2 commits)

1. `docs(devlog): session 10 — outbox worker`.
2. `docs(plans): archive plan 009`.

May bundle.

## Files to touch

```
NEW
  src/hcm/hcm-outbox-worker.ts
  src/hcm/hcm-outbox-worker.spec.ts
  test/integration/hcm-outbox-worker.spec.ts
  test/e2e/time-off-outbox-worker.e2e-spec.ts
  docs/plans/009-outbox-worker.md                      (Phase C)

MODIFIED
  src/hcm/hcm.module.ts                                (imports TimeOffModule; registers + exports worker)
  src/time-off/repositories/hcm-outbox.repository.ts   (claimDueBatch + HcmOutboxRow; guards on mark methods)
  TRD.md                                               (§5 paragraph replaced; §9 decision 13; §10 Q8 closed)
  docs/plans/README.md                                 (list 009)
  docs/devlog.md                                       (session 10)
```

No schema change. No migration. No new error codes. No changes to
`ApproveRequestUseCase`, `HcmClient`, or the mock HCM.

## Verification

### After Phase A (per commit)

- `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:e2e` green on every commit claiming green.
- A1 red at A1; green at A2.
- A3 adds red specs that go green as part of A2's implementation
  already (A3 only adds spec coverage; no new prod code).
- A5's guard spec red at A5 check-in, green after the `.where()`
  update.
- A6 red before A5's guard is in place (synced-row case); green after.
- A7 red at A7; green because A2-A5 cover the behaviour.

### After Phase A (totals)

- ~48 unit/integration tests (43 existing + ~5 new: 3 worker-unit
  extensions, 1 repo-guard, 1 `claimDueBatch` if unit-tested; the
  main coverage lives in the integration spec).
- ~28 e2e tests (24 existing + ~4 new).
- TRD: 10 sections. §5 updated. 13 decisions. §10 Q8 closed (Q9
  and Q10 remain open).

### After Phase B

- Reviewer verdict captured in the devlog.
- Pre-push audience-language audit passes (zero matches on the
  standard pattern — see the plan 006 archive for the exact grep).

### After Phase C

- `docs/plans/009-outbox-worker.md` exists with Appendix A.
- `docs/plans/README.md` lists 009.
- `docs/devlog.md` has a session-10 entry.

## Out of scope

- Removing inline push from `ApproveRequestUseCase` — separate UX
  decision.
- `@nestjs/schedule` or any cron library — rejected.
- Circuit breaker / failure-rate metrics — no evidence, §10 YAGNI.
- Admin endpoint / API to list or retry `failed_permanent` rows.
- Multi-process safety (row locking, `SKIP LOCKED`) — single-process
  is the architecture.
- Batch intake `POST /hcm/balances/batch` — separate slice.
- Consolidating the `nextAttemptAt` helper between the worker and
  `ApproveRequestUseCase` (inline push stays at constant 30s;
  worker uses exponential; policies are deliberately distinct).
- Env-configurable retry knobs — module constants for this slice.
- Ownership / auth.

## Pre-push checklist

- [ ] Architect brief captured (Appendix A).
- [ ] All Phase A commits green on typecheck / lint / test / test:e2e.
- [ ] Reviewer pass run on the diff; findings triaged.
- [ ] Devlog session 10 written.
- [ ] Plan 009 archived to `docs/plans/`.
- [ ] Pre-push audience-language audit passes.

---

# Appendix A — Architect brief (verbatim)

> Output of the `architect` subagent (sonnet) on 2026-04-24.
> Read-only first-principles analysis; the plan body synthesises
> it with existing decisions and verified repository state.

## 1. Scope boundary

### In this slice

- A `HcmOutboxWorker` class that polls `hcm_outbox` for rows whose
  `status IN ('pending', 'failed_retryable')` and `next_attempt_at
  <= now()`, issues the HCM push via the existing `HcmClient`, and
  writes the resolution back to the outbox row and to
  `requests.hcmSyncStatus` in one small transaction — the exact
  same resolution logic the approve use case already performs
  post-commit.
- A `claimDueBatch` query method on `HcmOutboxRepository` that
  returns at most N rows due for processing.
- A `tick()` public method on the worker for deterministic test
  driving. A simple `setInterval` wired in `onModuleInit` and
  cleared in `onModuleDestroy`. No `@nestjs/schedule` dependency.
- Batch size default 10. Retry interval wired by `next_attempt_at`
  at claim time. Poll cadence 5s in production.
- **Assumption flagged:** the inline push from
  `ApproveRequestUseCase` survives unchanged.

### Out of scope

- `@nestjs/schedule` / cron libs — `setInterval` is enough.
- Circuit breaker — no load data, no TRD ask, §10.
- HCM batch intake — separate slice.
- Resolution of `failed_permanent` rows — terminal.
- Dead-letter admin API — out of scope.
- Multi-process deployment.

## 2. State machine for `hcm_outbox.status`

Schema confirms four statuses: `pending`, `synced`,
`failed_retryable`, `failed_permanent`. The repository already
implements all four write transitions; the worker reuses them.

```
                  insert (approve tx)
                       │
                       ▼
                   [pending]
                  /          \
      inline push            worker pick-up
         │                         │
   ┌─────┴──────┐          ┌───────┴──────┐
   ▼            ▼          ▼              ▼
[synced]  [failed_     [synced]    [failed_
          permanent]               retryable]
                                       │
                             attempts < MAX_ATTEMPTS
                                       │
                              next_attempt_at = now + backoff
                                       │
                              ◀── worker re-polls ──
                                       │
                            attempts >= MAX_ATTEMPTS
                                       ▼
                                [failed_permanent]
```

Worker reads: `status IN ('pending', 'failed_retryable') AND
next_attempt_at <= now()`.

Worker writes:
- `ok` → `markSynced` + `updateHcmSyncStatus('synced')`.
- `permanent` → `markFailedPermanent` + `updateHcmSyncStatus('failed')`.
- `transient` (not at max) → `markFailedRetryable` + retries.
- `transient` (at max) → `markFailedPermanent` + `'failed'`.

## 3. Retry and backoff

TRD §5 names retryable outcomes and `next_attempt_at` but is silent
on exact numbers. Proposal:

- Base 30s (matches the current inline `nextAttemptAt()` constant).
- Multiplier 2x per attempt.
- Cap 30 minutes.
- Max attempts 5.

Formula: `nextAttemptAt = now + min(30_000 × 2^attempts, 30 ×
60_000)`. Total window until permanent ≈ 30s + 60 + 120 + 240 + 480
= ~15min. Flag as §9 decision candidate.

## 4. Concurrency

Single-process, single-worker, single Node event loop. `better-sqlite3`
serializes writes. `setInterval` does not re-enter while `tick()`
is awaited. No row locking needed.

Within a tick, rows are processed sequentially to avoid concurrent
HCM calls from the same tick. Order: `next_attempt_at ASC` (oldest
first, no starvation).

## 5. Defensive posture (INSTRUCTIONS.md §8.3)

`HcmClient.postMutation()` already performs all defensive response
validation (shape check, status-code mapping, bad-shape 2xx →
`transient`). Worker calls the same client; no extra validation.
`forceBadShape` is handled at the client layer.

## 6. Ordering and idempotency

`idempotency_key` is on every outbox row (UNIQUE). On retry, the
worker reads the stored key and passes it as `Idempotency-Key`
header, exactly per TRD §3.2 and §9. The mock's replay contract
(stored 2xx/4xx replayed; 5xx/timeout not stored) is safe for this
pattern.

**Critical constraint:** the worker must never generate a new key
on retry. Double-deduct risk.

## 7. Observability

- Per-tick debug log only when `rows.length > 0` (no steady-state spam).
- Per-row success: `log` with `requestId` + `hcmMutationId`.
- Per-row permanent: `error` with `requestId` + `lastError`.
- Per-row transient: `warn` with `requestId`, attempt count, next
  attempt time, reason.

## 8. Transition of `requests.hcmSyncStatus`

Worker follows the same mapping as the inline push:
- `ok` → `'synced'`.
- `permanent` → `'failed'`.
- `transient` → stays `'pending'`.

**Proposal:** `'failed'` only when the outbox row moves to
`failed_permanent`, which includes attempt-exhaustion promotions.
`'pending'` accurately means "we are still trying".
`approved_deductions` stays in the overlay while the outbox row is
`failed_retryable`, preserving the conservative balance projection.

## 9. Risks

**R1 Drift between `hcm_outbox.status` and `requests.hcmSyncStatus`.**
Resolved in a single Drizzle transaction. If the tx fails after HCM
returned `ok`, the outbox row stays `failed_retryable`; retry
replays 200; tx is reattempted. Idempotent replay closes the
window.

**R2 Worker ticking during test teardown.** Mitigation: interval
not started when `NODE_ENV === 'test'`. Tests drive `tick()`
manually. `onModuleDestroy` also clears the interval.

**R3 Long-running HCM call in event loop.** `fetch` is async; only
the SQLite writes are synchronous, and they are fast. Worst-case
tick time at `BATCH_SIZE=10` × 2s timeout = 20s; at 5s poll this
means ticks delay rather than overlap. Acceptable.

**R4 Balance projection staleness window.** Between HCM accept and
worker's resolution tx. Accepted — conservative (under-count).
Bounded to one tx duration.

**R5 Late inline-push completion racing worker tick.** Both could
try to resolve the same row. Second writer could downgrade a
`synced` row to `failed_retryable`. **Mitigation: guard
`markFailedRetryable` and `markFailedPermanent` with `WHERE status
!= 'synced'`.** Landed as commit A5.

## 10. Error taxonomy additions

None. Worker is not an HTTP endpoint.

## 11. Testing strategy

### Unit (`src/hcm/hcm-outbox-worker.spec.ts`)

Mocks for repos + client. Covers: zero-rows, ok/permanent/transient
branches, exhaustion promotion, ordering, idempotency-key from
row.

### Integration (`test/integration/hcm-outbox-worker.spec.ts`)

Worker + real SQLite + real mock HCM (already running under Jest
globalSetup). Seed rows directly; `tick()` manually. Covers every
mock scenario + due-filtering edge cases.

### E2E (`test/e2e/time-off-outbox-worker.e2e-spec.ts`)

Full Nest app. Approve with `force500` → reset mock → `tick()` →
`GET /requests/:id` shows `synced`. Also `forceBadShape`. Assert
exactly one mock mutation recorded.

### Driving the worker in tests

`ctx.app.get(HcmOutboxWorker).tick()`. Interval auto-start disabled
when `NODE_ENV === 'test'`. No fake timers.

## 12. Ordered TDD steps

See plan body (A1–A8).

## 13. Open questions and assumptions

**Q1 — Scheduler mechanism.** `setInterval` chosen over
`@nestjs/schedule`. §9 decision candidate.

**Q2 — `hcm_outbox.last_error` column.** Already exists in schema.
No migration needed.

**Q3 — Circuit breaker.** Rejected. `MAX_ATTEMPTS` + permanent
promotion is the stopping mechanism. §10 (no speculative abstraction).

**Q4 — Removing the inline push.** Out of scope. UX shift requires
its own decision.

**Q5 — `MAX_ATTEMPTS = 5`.** Proposal. Total window ~15 min. Flag
as §9 decision candidate.

**Q6 — `payloadJson` on the outbox row.** Already stored at approve
time. Worker deserializes this directly; no join back to `requests`.

---

**Files most relevant to the slice:**

- `/home/gabriel/repositorios/wizdaa/src/database/schema.ts`
- `/home/gabriel/repositorios/wizdaa/src/hcm/hcm.client.ts`
- `/home/gabriel/repositorios/wizdaa/src/hcm/hcm.module.ts`
- `/home/gabriel/repositorios/wizdaa/src/time-off/repositories/hcm-outbox.repository.ts`
- `/home/gabriel/repositorios/wizdaa/src/time-off/repositories/requests.repository.ts`
- `/home/gabriel/repositorios/wizdaa/src/time-off/approve-request.use-case.ts` (reference pattern)
- `/home/gabriel/repositorios/wizdaa/scripts/hcm-mock/server.ts`
- `/home/gabriel/repositorios/wizdaa/test/helpers/test-app.ts`
