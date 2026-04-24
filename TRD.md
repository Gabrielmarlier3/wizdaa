# Technical Design Record — Time-Off Microservice

Living document. Updated alongside every architectural decision.
Companion to `INSTRUCTIONS.md` (process rules). The original challenge
brief is kept private under `notes/` (see §9 decision 2026-04-24); the
context below is this service's public problem statement in our own
words.

## 1. Context

This service is the backend of a time-off request module. The
authoritative source of truth for employment data and balances is an
external **HCM system** (Workday / SAP-class). Balances can change
outside of this service — work anniversary bonuses, start-of-year
refreshes, direct HR edits.

**Actors.**
- **Employee** — creates time-off requests, sees their balance, gets
  instant feedback.
- **Manager** — approves or rejects requests, relying on the balance
  being valid at the moment of decision.

**Balance scope.** Per-employee per-location. A given employee can have
distinct balances across locations; additional dimensions are
addressed in §3 and §10.

**HCM sync surfaces.**
- **Realtime API** — query or mutate a single
  `(employeeId, locationId, value)` record.
- **Batch endpoint** — HCM delivers the full balance corpus to this
  service (direction: HCM → us).

**Defensive stance.** The HCM usually rejects invalid combinations and
insufficient-balance requests, but this is not guaranteed. Every
balance-changing operation must validate locally, even when the HCM
would also reject.

**Deliverables driving the design.**
- A TRD with challenges, a suggested solution, and analysis of
  alternatives considered.
- REST (or GraphQL) endpoints for request lifecycle and balance queries.
- A test suite rigorous enough to guard against regressions, including
  mock HCM endpoints (realistic servers, not just in-process doubles).
- Code on GitHub, proof of coverage.

## 2. Architecture overview

The service is a single NestJS process with four internal layers and
one external integration point. Dependencies point inward:
controllers know services, services know domain and repos, domain
knows nothing downstream.

```
┌────────────────────────────────────────────────────────┐
│                   HTTP API (Nest)                      │
│   Controllers — validation, HTTP contract; no logic    │
└────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│                    Use cases / services                │
│   Orchestrate domain + persistence + HCM client        │
└────────────────────────────────────────────────────────┘
             │               │               │
             ▼               ▼               ▼
┌──────────────────┐  ┌─────────────┐  ┌─────────────────┐
│ Domain           │  │ Persistence │  │ HCM integration │
│ Entities,        │  │ Drizzle     │  │ Client + outbox │
│ state machine,   │  │ schema,     │  │ + push worker   │
│ invariants       │  │ repos,      │  │ + batch intake  │
│                  │  │ migrations  │  │                 │
└──────────────────┘  └─────────────┘  └─────────────────┘
                             │
                             ▼
                       ┌───────────────┐
                       │ SQLite (WAL)  │
                       └───────────────┘
```

**Nest modules.**

- `TimeOffModule` — request lifecycle (create, approve, reject,
  cancel).
- `BalanceModule` — projection
  (`hcm − pendingReservations − approvedNotYetPushed`).
- `HcmModule` — client, outbox, push worker, batch intake.
- `DatabaseModule` — Drizzle setup, migration runner, connection.

**Boundary rules.**

- Controllers delegate to services immediately; no branching logic
  (§12).
- Domain is framework-free (pure TypeScript), imported by services.
- Persistence is behind repo interfaces; services never import
  Drizzle directly.
- HCM calls go through one client class; retry and idempotency live
  in the outbox worker (see §9 *Approval commits locally; HCM push
  via outbox* and §9 *Dual idempotency*).

## 3. HCM contract (as assumed)

The challenge brief intentionally leaves the HCM's interface open.
This service is built against the following assumed contract, written
as a testable specification. The standalone mock under
`scripts/hcm-mock/` (see §9 *"Mock HCM is a standalone Express app"*)
is the executable realization of these assumptions and is the first
thing to update if the real HCM diverges.

### 3.1 Transport

- All endpoints are HTTP.
- Realtime: this service calls the HCM.
- Batch: the HCM **pushes** the full balance corpus to this service
  (direction: HCM → us). Our endpoint accepts the push idempotently
  since the batch may be replayed.

### 3.2 Realtime API (this service → HCM)

**Read the balance for a dimension.**

- `GET /balance?employeeId=<id>&locationId=<id>&leaveType=<type>`
- `200 OK` with
  `{ employeeId, locationId, leaveType, balance }`.
- `404 Not Found` for invalid dimension combinations.

**Apply an approved balance mutation.**

- `POST /balance/mutations`
- Body:
  `{ employeeId, locationId, leaveType, days, reason, clientMutationId }`.
- Header: `Idempotency-Key: <uuid>`. The same key must be honored as a
  replay; the response must be deterministic across retries.
- `2xx` on success with an `hcmMutationId` for audit linkage.
- `409 Conflict` on insufficient balance — our service also validates
  locally, since HCM may fail to reject (§8.3).
- `422 Unprocessable Entity` on invalid dimension combinations.
- `5xx` and network timeouts are retryable with the same
  `Idempotency-Key`.

### 3.3 Batch push (HCM → this service)

- `POST /hcm/balances/batch`
- Body:
  `{ generatedAt, balances: [{ employeeId, locationId, leaveType, balance }] }`.
- Assumed to carry the full balance corpus on each call. Partial
  batches would require separate signaling and are out of scope until
  the real HCM indicates otherwise.
- Idempotent: a replay of the same batch produces the same end state.

### 3.4 Balance semantics

- The HCM value is the authoritative raw balance per
  `(employeeId, locationId, leaveType)`.
- Local **pending reservations** and **approved-not-yet-pushed
  deductions** are overlays on top of the HCM value — neither
  modifies the HCM's reported figure.
- Effective available balance visible to the Employee:
  `hcmBalance − pendingReservations − approvedNotYetPushed`.

### 3.5 Failure modes

- **HCM unreachable / 5xx / slow.** The outbox retains the mutation;
  the push worker retries with bounded backoff. Retries reuse the same
  `Idempotency-Key`.
- **Batch conflicts with local state.** If the new HCM value would
  make `hcmBalance − approvedNotYetPushed` negative for a dimension,
  the record is flagged as an `inconsistency` and further approvals on
  that dimension are halted until manual resolution.
- **HCM accepts what we would reject** (or vice versa). Our local
  validation is authoritative. We never forward a mutation we believe
  to be invalid (§8.3 defense rule).

### 3.6 Authority boundaries

- **HCM owns:** the raw balance value; the outcome of a mutation once
  accepted.
- **This service owns:** the request lifecycle (`pending`, `approved`,
  `rejected`, `cancelled`), local pending reservations, the idempotent
  outbox, and the mapping between local requests and HCM mutations.

> **Interpretation note.** The brief states *"assume balances are
> per-employee per-location"*. This service reads that statement as
> defining the *grain* of a balance record, not prohibiting other
> attributes. `leaveType` is added as a balance-record attribute
> (default `PTO`) to keep the batch payload's *"necessary dimensions"*
> hook extensible without speculation. See §9 decision *"Balance
> dimension includes leaveType"*.

### 3.7 Time and timezone

- All timestamps exchanged with the HCM are UTC.
- Date-bounded fields on time-off requests (`startDate`, `endDate`)
  are `YYYY-MM-DD` calendar strings with no time component and no
  offset, interpreted as UTC dates.
- This service normalizes anything it receives to UTC on ingress and
  serializes UTC on egress; the mock HCM implements and asserts the
  same. See §9 decision *"HCM and this service operate in UTC"*.

## 4. Data model

> TBD: entities, state machines, invariants.

## 5. HCM integration strategy

> TBD: realtime, batch, idempotency, failure handling.

## 6. Concurrency & consistency strategy

> TBD: transactions, locking, reprocessing.

## 7. Error taxonomy

> TBD: validation, business, external, conflict, inconsistency.

## 8. Testing strategy

Tests are the primary deliverable alongside the TRD and the code;
every test protects a rule, a flow, or a real risk (§15).

**Test pyramid.**

- **Unit (`*.spec.ts` next to source).** Pure domain — state machine
  transitions, balance-projection math, idempotency key comparison,
  custom validators. No Nest, no DB.
- **Integration (`test/integration/`).** Service + repos + real
  SQLite (temp-file DB, migrations run once per suite, tables
  truncated or rolled back per test). No HTTP, no HCM mock. Proves
  transactional correctness at the use-case boundary.
- **E2E (`test/e2e/`).** Full Nest app via `supertest` + real SQLite
  + standalone mock HCM (Express app under `scripts/hcm-mock/`
  started by a global Jest setup). Proves HTTP contract, retry
  loops, HCM failure handling, batch intake.

**Coverage targets.**

- Domain layer: **≥ 95 %** (lines and branches).
- Services / use cases: **≥ 90 %**.
- Controllers and DTOs: sampled, not targeted — types carry most of
  their correctness.
- Reported via `npm run test:cov`; targets noted in the README.

**Mock HCM lifecycle.**

- One process per e2e suite via Jest `globalSetup` / `globalTeardown`.
- `POST /test/reset` clears state at the start of each test.
- `POST /test/scenario` injects failure modes (force 500, force
  timeout, set balance, set inconsistency).

**TDD ordering per feature.**

1. Red: e2e test describing the user-observable outcome.
2. Red: unit tests for the domain invariants the feature protects.
3. Green: migration, entity, repo, service, controller — minimum to
   pass.
4. Red-green: edge cases (insufficient balance, duplicate, invalid
   input).
5. Refactor.

**Conventions.**

- Test names read as specifications: `it('rejects POST /requests
  when balance is insufficient')` — not `it('works')`.
- Determinism: time frozen with `jest.useFakeTimers` or an injected
  clock port; UUIDs seeded.
- Fixtures: factory functions under `test/fixtures/`, not magic JSON.
- Concurrency tests actually interleave (parallel promises against
  the same row), not call a function twice in sequence.

**Critical scenarios guarded (from `INSTRUCTIONS.md` §15).**

- Sufficient / insufficient balance.
- Duplicated request (same `clientRequestId`).
- Approval / rejection / cancellation transitions.
- HCM error, HCM timeout, retry-after-crash.
- Batch sync altering balance; conflict halting approvals on the
  affected dimension.
- Two concurrent operations on the same balance.
- Invalid `(employeeId, locationId, leaveType)` combination.
- Safe reprocessing of any outbox row.

## 9. Decision log

Entry template:

> **YYYY-MM-DD — \<decision title\>**
> - **Decision:** what was chosen.
> - **Reason:** why.
> - **Alternatives considered:** briefly.
> - **Impact:** what this affects (modules, tests, docs).

---

> **2026-04-24 — Challenge brief kept local-only**
> - **Decision:** the original challenge PDF and its markdown
>   transcription live under `notes/` (ignored via `.git/info/exclude`).
>   The public repo describes the problem in our own words via §1 above.
> - **Reason:** avoid publishing the verbatim brief on the public repo;
>   `notes/` is the local-only workspace we already set up for private
>   context.
> - **Alternatives considered:**
>   - Commit `CHALLENGE.md` at repo root — rejected to keep the
>     verbatim brief off the public repo.
>   - Absorb context entirely with no transcription — rejected because
>     keeping a verbatim local reference prevents drift when reasoning
>     from the original wording.
> - **Impact:** README drops the "Challenge brief" link; TRD §1 is the
>   single public context statement; `notes/CHALLENGE.md` exists locally
>   for faithful lookup.

> **2026-04-24 — Reserve balance at creation as pending hold**
> - **Decision:** a request is reserved on creation as a *pending hold*
>   ledger line, distinct from an *approved deduction*. Employee-visible
>   available balance =
>   `hcmBalance − pendingReservations − approvedNotYetPushed`.
>   On rejection or cancellation the hold is released; on approval it
>   converts to an approved deduction.
> - **Reason:** §8.4 (consistency rule) mandates designing against
>   concurrency and duplication; a local two-state ledger is the
>   simplest mechanism that closes the double-spend window where two
>   concurrent pending requests pass the approval-time check
>   independently. §8.2 prefers simpler correct designs; a two-state
>   ledger is easier to reason about than optimistic approval-time
>   locking. The employee-instant-feedback user need in the brief
>   requires the reservation to be visible immediately, not only after
>   manager action.
> - **Alternatives considered:**
>   - *Decrement only on approval.* Rejected: leaves the window between
>     pending and approval unprotected; two pending 8-day requests
>     against 10 days can both pass the approval-time check if
>     approvals interleave.
>   - *Single ledger column with rejection as a compensating credit.*
>     Rejected: conflates reservation and committed deduction; harder
>     to reason about during reconciliation.
> - **Impact:** Balance entity decomposes into `hcmBalance` + pending
>   overlays + approved overlays. Request state machine defines explicit
>   hold-creation and hold-release transitions on create / reject /
>   cancel. Every balance-consistency test must cover the overlay.

---

> **2026-04-24 — Approval commits locally; HCM push via outbox**
> - **Decision:** manager approval commits locally in a single
>   transaction; the HCM push is durable-async via an outbox table
>   polled by an in-process worker with bounded backoff. Each request
>   carries `hcmSyncStatus: pending | synced | failed`.
> - **Reason:** §13 explicitly names HCM unavailability and timeout as
>   scenarios to handle; synchronous coupling would block approvals
>   during HCM downtime, which is unacceptable for a manager workflow.
>   §8.3 (defense) and §8.4 (partial failure) point to decoupling:
>   local truth + async reconciliation is the standard defensive
>   pattern. The outbox is one table + one worker — not a queue broker
>   — and stays well below §10's infrastructure threshold.
> - **Alternatives considered:**
>   - *Synchronous call inside the approval transaction.* Rejected: a
>     30-second HCM timeout becomes 30 seconds of user-facing latency;
>     rollback of approval on HCM failure loses the domain event the
>     manager already made.
>   - *Fire-and-forget with no persistence.* Rejected: violates §8.4
>     (reprocessing, partial failure) — state is lost on crash.
> - **Impact:** adds an `hcm_outbox` table, a push worker module, and a
>   `hcmSyncStatus` column on requests. Touches approval use case, HCM
>   client, and tests for HCM-down / timeout / retry-after-crash.

---

> **2026-04-24 — Batch sync preserves local holds; conflicts halt approvals**
> - **Decision:** the HCM batch sets the raw balance authoritatively
>   per `(employeeId, locationId, leaveType)`. Local pending holds and
>   approved-not-yet-pushed deductions are **preserved as overlays**
>   on top of the new HCM value. If the new HCM value would make
>   `hcmBalance − approvedNotYetPushed` negative, the affected
>   dimension is flagged as an `inconsistency` event and further
>   approvals on that dimension are halted until resolved.
> - **Reason:** CHALLENGE.md names HCM as source of truth, so the raw
>   value must win on reads (§8.5). §8.3 prohibits blind trust; a pure
>   "HCM overwrites everything" policy would erase a just-approved-
>   not-yet-pushed manager decision. §8.4 requires preventing
>   compounding divergence, which halting on the affected dimension
>   accomplishes. §12's error taxonomy treats *detected inconsistency*
>   as its own category.
> - **Alternatives considered:**
>   - *HCM always wins; wipe and replay local state.* Rejected: an
>     in-flight approved push would be silently lost.
>   - *Local always wins; HCM advisory.* Rejected: contradicts the
>     brief's *"Source of Truth"* framing.
>   - *Last-write-wins by timestamp.* Rejected: requires trustworthy
>     clocks on both sides and silently loses data either way.
> - **Impact:** touches the batch ingestion use case, balance
>   projection logic, an `inconsistencies` table/endpoint, and tests
>   covering batch-during-pending, batch-during-approval-push, and
>   batch-reducing-below-approved.

---

> **2026-04-24 — Dual idempotency: client UUID on request, service UUID on outbox**
> - **Decision:** two distinct idempotency scopes.
>   - `clientRequestId` (UUID) is required on `POST /requests` and
>     deduplicates *request creation*. A duplicate POST returns the
>     same entity rather than creating two.
>   - `hcmIdempotencyKey` (UUID) is generated per HCM mutation intent,
>     stored on the outbox row, and sent as the `Idempotency-Key`
>     header. Retries of the same push reuse the key; a reversal is a
>     different intent with a different key.
> - **Reason:** §8.4 names reprocessing and duplication as first-class
>   concerns; §8.5 favors explicit per-intent keys for traceability.
>   The two scopes address different problems — request creation vs
>   HCM push — and conflating them would hide retry bugs. The outbox
>   row, indexed by the service UUID, is the local source of dedup
>   truth even if HCM ignores the header.
> - **Alternatives considered:**
>   - *`(employeeId, locationId, startDate, endDate)` tuple as the
>     idempotency key.* Rejected: conflates intent with state; a
>     reversal of the same tuple is a different intent.
>   - *HCM-returned id.* Rejected: unusable for the first call (no id
>     yet) and assumes HCM returns stable ids.
>   - *A single key serving both scopes.* Rejected: client-facing and
>     server-internal dedup are different problems; merging hides
>     failures.
> - **Impact:** `requests.client_request_id` (unique); `hcm_outbox.
>   idempotency_key`; HCM client injects the header; outbox worker is
>   safe under duplicate attempts.

---

> **2026-04-24 — Balance dimension includes leaveType (default PTO)**
> - **Decision:** balance is keyed by
>   `(employeeId, locationId, leaveType)` with `leaveType` as an
>   enumerated field. Initial single value: `PTO`. The brief's
>   *"per-employee per-location"* statement is read as defining the
>   *grain* of a balance record, not prohibiting other attributes.
> - **Reason:** the brief names vacation/sick as plausible distinctions
>   (*"10 days of leave"*) and uses *"with necessary dimensions"* for
>   the batch payload, signaling the dimension set is not frozen.
>   §8.7 (non-invention) is honored because the evidence is in the
>   brief; §8.1 (scope) is honored because no further dimension is
>   added beyond type. Adding the column later would migrate every
>   balance query — regret cost later is larger than marginal cost now.
> - **Alternatives considered:**
>   - *Employee + location only.* Rejected: real HCMs universally
>     separate leave categories; later addition would migrate every
>     balance query and every request DTO.
>   - *Full policy model with accrual windows.* Rejected outright under
>     §10 and §8.7 — no evidence this is needed.
> - **Impact:** balance primary key; all balance repository methods;
>   batch ingestion mapping; request DTO must specify type; balance
>   invariant tests. If the real HCM has no type distinction, the
>   column collapses to a single value with zero behavioral impact.

---

> **2026-04-24 — Mock HCM is a standalone Express app under scripts/hcm-mock/**
> - **Decision:** the mock HCM is a small Express (or Fastify) app
>   under `scripts/hcm-mock/`, started as a separate process during
>   integration and e2e test suites. It exposes a state-reset endpoint
>   and scenario-injection endpoints (force 500, force timeout, set
>   balance, set inconsistency). Integration and e2e tests talk to it
>   over real HTTP; unit tests may use in-process doubles for speed.
> - **Reason:** the brief explicitly favors *"real mock servers with
>   some basic logic to simulate balance changes"* (CHALLENGE.md). An
>   in-process double shortcuts the retry loop, timeout handling, and
>   serialization — exactly the code paths §13 names as critical. A
>   mock has no DI / module / guard need; §8.2 and §10 favor the
>   minimum ceremony that delivers the needed fidelity.
> - **Alternatives considered:**
>   - *In-process NestJS test module bound to a real port.* Rejected:
>     defeats what the brief explicitly favors and hides HTTP client
>     behavior.
>   - *Sibling NestJS app in a monorepo.* Rejected: Nest bootstrapping
>     cost with no DI / module benefit for a mock.
> - **Impact:** adds `scripts/hcm-mock/`; global Jest setup starts and
>   resets it once per suite; the HCM client contract is documented
>   against this mock. If the real HCM diverges, the mock is the first
>   thing updated.

---

> **2026-04-24 — Cancellation is a distinct terminal state from rejection**
> - **Decision:** employee-initiated cancellation of a `pending`
>   request transitions to a `cancelled` terminal state, distinct from
>   the manager-initiated `rejected` terminal state. Cancellation
>   releases the pending hold atomically in the same transaction that
>   flips the status. The request state machine is a four-state DAG:
>   `pending → approved | rejected | cancelled`.
> - **Reason:** cancellation and rejection are driven by different
>   actors (Employee vs Manager) and carry different audit semantics;
>   collapsing them would lose information. §8.4 requires atomic
>   release of the held balance to prevent stale reservations on
>   abandoned requests. The architect subagent surfaced this concern
>   during the open-questions analysis even though it was not in the
>   original §10.
> - **Alternatives considered:**
>   - *Single `terminated` state parameterized by an initiator field.*
>     Rejected: weakens compile-time guarantees by replacing a type
>     check with a string comparison in every downstream check.
>   - *No cancellation — employee waits for rejection.* Rejected:
>     indefinitely holds balance on abandoned requests; poor UX and
>     poor hygiene.
> - **Impact:** request state machine adds `cancelled` terminal state;
>   cancellation use case; balance-release test. Affects every
>   state-transition test.

---

> **2026-04-24 — HCM and this service operate in UTC**
> - **Decision:** both the HCM and this service treat all timestamps
>   and date-bounded fields as UTC. Time-off request `startDate` and
>   `endDate` are `YYYY-MM-DD` calendar strings interpreted as UTC
>   dates with no time component. The mock HCM implements and asserts
>   this behavior.
> - **Reason:** removes an entire class of day-boundary divergence
>   bugs — same-day request landing on different business dates
>   across systems — without adding a timezone-conversion layer. The
>   brief does not specify a timezone, so the safest default is the
>   one servers already share. Aligns with §8.2 (simplicity) and §8.3
>   (defensive).
> - **Alternatives considered:**
>   - *Per-location timezone with conversion layer.* Rejected: adds
>     a timezone database dependency and daylight-savings logic for
>     no evidence-based benefit. Can be layered on later if a real
>     location-specific behavior emerges.
>   - *Service-local timezone with HCM translation.* Rejected:
>     introduces implicit conversion at every boundary and makes
>     reasoning about day transitions ambiguous.
> - **Impact:** §3.7 pins UTC explicitly; all timestamp columns are
>   UTC; request DTOs accept date-only strings; tests assert UTC
>   serialization.

## 10. Open questions

All questions surfaced so far are closed; pointers into the §9
decision entries are kept here so the trajectory from *question* to
*decision* stays navigable.

1. **Balance reservation timing — creation vs approval.**
   → §9 *Reserve balance at creation as pending hold*.
2. **Approval-to-HCM propagation.**
   → §9 *Approval commits locally; HCM push via outbox*.
3. **Batch sync conflict resolution.**
   → §9 *Batch sync preserves local holds; conflicts halt approvals*.
4. **Idempotency identifier for HCM calls.**
   → §9 *Dual idempotency: client UUID on request, service UUID on outbox*.
5. **Dimensions beyond `(employeeId, locationId)`.**
   → §9 *Balance dimension includes leaveType (default PTO)*.
6. **Mock HCM shape — real server vs in-process double.**
   → §9 *Mock HCM is a standalone Express app under scripts/hcm-mock/*.
7. **Clock / timezone authority for `startDate` and `endDate`.**
   → §9 *HCM and this service operate in UTC*.
