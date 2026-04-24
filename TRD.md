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

> TBD.

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

## 4. Data model

> TBD: entities, state machines, invariants.

## 5. HCM integration strategy

> TBD: realtime, batch, idempotency, failure handling.

## 6. Concurrency & consistency strategy

> TBD: transactions, locking, reprocessing.

## 7. Error taxonomy

> TBD: validation, business, external, conflict, inconsistency.

## 8. Testing strategy

> TBD: unit / integration / e2e split, critical scenarios.

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

## 10. Open questions

Ambiguities surfaced by reading the challenge brief against
`INSTRUCTIONS.md`. Each must be resolved (or explicitly deferred with a
recorded assumption) before the corresponding design section freezes.

1. **Balance reservation timing — creation vs approval.**
   Is the balance decremented (or reserved) when the Employee submits
   the request (`pending`), or only when the Manager approves? Both are
   defensible; the choice reshapes concurrency semantics, duplicate
   detection, and what "cancel a pending request" means.

2. **Approval-to-HCM propagation.**
   When the Manager approves, does this service call the HCM
   immediately (and hold the approval transactionally pending HCM's
   response), or does approval commit locally and a separate job pushes
   to the HCM asynchronously? Affects perceived latency, failure
   handling, and idempotency guarantees.

3. **Batch sync conflict resolution.**
   When the HCM batch delivers a balance that contradicts a locally
   pending reservation or an approved-but-not-yet-pushed request, what
   wins? Silent HCM overwrite, flag-as-inconsistency-for-manager,
   or reconcile by re-applying local pending operations?

4. **Idempotency identifier for HCM calls.**
   What makes a realtime HCM call safely retryable? Client-supplied
   request UUID, `(employeeId, locationId, startDate, endDate)` tuple,
   or the HCM's own returned id? Must be defined before the HCM client
   module lands.

5. **Dimensions beyond `(employeeId, locationId)`.**
   The brief says "with necessary dimensions" for the batch payload.
   Beyond employee and location, do we need a leave type
   (vacation / sick / personal), accrual period, or other axis? This
   stays open until the mock HCM's schema is specified.

6. **Mock HCM shape — real server vs in-process double.**
   The brief favors "real mock servers with some basic logic to
   simulate balance changes". Options: standalone Nest app in the
   monorepo, Express mini-service under `scripts/hcm-mock/`, or an
   in-process NestJS test module bound to a real HTTP port via
   `supertest`. Decision affects test runtime, CI complexity, and
   fidelity to production HCM behavior.
