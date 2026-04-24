# Technical Design Record — Time-Off Microservice

Living document. Updated alongside every architectural decision.
Companion to `INSTRUCTIONS.md` (process rules). The original challenge
brief is kept private under `notes/` (see §8 decision 2026-04-24); the
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
distinct balances across locations; dimensions beyond `employeeId` and
`locationId` are not yet confirmed (see §9).

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

## 3. Data model

> TBD: entities, state machines, invariants.

## 4. HCM integration strategy

> TBD: realtime, batch, idempotency, failure handling.

## 5. Concurrency & consistency strategy

> TBD: transactions, locking, reprocessing.

## 6. Error taxonomy

> TBD: validation, business, external, conflict, inconsistency.

## 7. Testing strategy

> TBD: unit / integration / e2e split, critical scenarios.

## 8. Decision log

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

## 9. Open questions

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
