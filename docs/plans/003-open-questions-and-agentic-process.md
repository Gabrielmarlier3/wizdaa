# Plan 003 — Resolve open questions and formalize agentic process as deliverable

> Approved plan archived from `~/.claude/plans/` with the full architect
> analysis appended. Corresponding commits land across Phase A
> (`docs(plans):` + `docs(process):`), Phase C (`docs: add devlog`), and
> Phase B (`docs(trd): ...` × 2).

---

## Context

The TRD has six open questions in §9 — left ambiguous by the challenge
brief on purpose. The brief identifies three measurement criteria:

1. A TRD with suggested solution and **analysis of alternatives considered**.
2. A rigorous test suite — *"since you are using Agentic Development, the
   value of your work lies in the rigor of your tests"*.
3. Deliverables: TRD, GitHub repo, test cases, proof of coverage.

This plan serves two goals at once:

- **Resolve the six open questions** with explicit assumptions,
  alternatives, and blast-radius analysis — converting `TRD §9` into a
  set of closed `TRD §9 Decision log` entries (numbering updated after
  the new HCM contract section lands), and adding a new *"HCM contract
  (as assumed)"* section to the TRD.
- **Make the agentic development process itself a first-class
  deliverable**, so the method is documented alongside the output:
  preserved plans, cross-reviewed analyses, process documentation,
  chronological devlog.

The architect subagent produced an independent first-principles analysis
of the six questions. It was prompted without exposure to the lead's
prior recommendations, so the two form genuinely independent voices.
Full analysis appended below.

---

## Architect vs lead: synthesis of the six questions

The architect ran on `opus`, read `INSTRUCTIONS.md`, `TRD.md`,
`notes/CHALLENGE.md`, and `CLAUDE.md` with no prior-conversation bias,
then produced prose analysis per question (Recommendation / Rationale /
Alternatives considered / Blast radius).

### #1 Balance reservation timing (creation vs approval)

- **Lead:** decrement on approval.
- **Architect:** reserve at creation as a *pending hold* distinct from
  *approved deduction* — two-state ledger.
- **Resolved → architect.** Lead's position leaves a double-spend
  window across concurrent pending requests (two 8-day requests against
  10 days, approvals interleave, both pass the check). The two-state
  local ledger is the simplest structure that closes the window (§8.4)
  and also gives the Employee an accurate available-balance display.

### #2 Approval-to-HCM propagation (sync vs async)

- **Lead:** synchronous primary + async retry for transient failures.
- **Architect:** always async — local commit first, push via durable
  outbox row and retry worker.
- **Resolved → architect.** Sync coupling blocks approvals during HCM
  downtime, which §13 explicitly calls out as a scenario. Single code
  path simpler than a sync/async hybrid; outbox is one table + one
  worker, well below §10's infrastructure threshold.

### #3 Batch sync conflict resolution

- **Lead:** HCM wins on read; flag-as-inconsistency on conflict.
- **Architect:** HCM wins *raw balance*; local pending holds and
  unsynced-approved lines are **preserved on top**; contradictions emit
  `inconsistency` events and **halt approvals** on the affected
  `(employeeId, locationId)` until resolved.
- **Resolved → architect (refinement of same policy).** Halting on the
  affected dimension prevents compounding divergence — a concern the
  lead had not fully articulated.

### #4 Idempotency identifier

- **Lead:** client-supplied UUID on POST `/requests`.
- **Architect:** service-generated UUID per HCM mutation intent, stored
  on the outbox row.
- **Resolved → both, distinct scopes.** Client UUID
  (`clientRequestId`) deduplicates *request creation*. Service UUID on
  outbox deduplicates *HCM push attempts*. Each has its own column and
  scope.

### #5 Dimensions beyond `(employeeId, locationId)`

- **Lead:** start with employee + location only.
- **Architect:** add `leaveType` enum (default single value `PTO`).
- **Resolved → architect.** The brief's *"per-employee per-location"*
  describes grain, not exhaustive schema; *"with necessary dimensions"*
  for the batch payload and *"10 days of leave"* imply a type marker.
  Column costs nothing now; adding later migrates every balance query.

### #6 Mock HCM shape

- **Lead:** standalone NestJS app (stack consistency).
- **Architect:** Express/Fastify under `scripts/hcm-mock/`.
- **Resolved → architect.** A mock has no DI/modules/guards need;
  ~100 lines of Express delivers real HTTP fidelity (§8.2, §10). Must
  expose a state-reset endpoint and scenario-injection (force 500,
  force timeout, set balance). Single global Jest setup starts it once
  per suite.

### Additional risks surfaced by the architect (not in §9)

1. **Cancellation semantics.** Employee-initiated cancellation of a
   `pending` request must release the hold atomically. `cancelled` is
   a distinct terminal state from `rejected`. Lands as its own Decision
   log entry in Phase B.
2. **Batch direction confirmation.** `HCM → us` is consistent across
   `TRD §1` and `notes/CHALLENGE.md`, but push-vs-pull distinction
   matters for failure handling. Pinned explicitly in the new
   *"HCM contract (as assumed)"* section.
3. **Clock / timezone authority.** Same-day requests can land on
   different business dates if HCM and the service disagree on
   timezone. Stays in §10 as an unresolved open question.

---

## Approach: three-phase execution

### Phase A — Executable immediately

1. Create `docs/plans/` with `README.md`.
2. Port plan 001 (reconstructed) and plan 002 (translated).
3. Archive this plan as `docs/plans/003-...md` with architect analysis
   appendix.
4. Create `docs/process.md` describing the agentic workflow.
5. Commit as two focused commits:
   - `docs(plans): archive historical plans and current plan with architect analysis`
   - `docs(process): document agentic development workflow`

### Phase B — TRD updates

6. Add new section *"HCM contract (as assumed)"* as `TRD.md` §3, with
   existing §3–§9 bumped down by one slot. Final order:
   §1 Context → §2 Architecture overview → **§3 HCM contract (as assumed)**
   → §4 Data model → §5 HCM integration strategy → §6 Concurrency &
   consistency → §7 Error taxonomy → §8 Testing strategy →
   §9 Decision log → §10 Open questions.
7. Add **seven Decision log entries** to §9 (one per resolved topic):
   - `2026-04-24 — Reserve balance at creation as pending hold`
   - `2026-04-24 — Approval commits locally; HCM push via outbox`
   - `2026-04-24 — Batch sync preserves local holds; conflicts halt approvals`
   - `2026-04-24 — Dual idempotency: client UUID on request, service UUID on outbox`
   - `2026-04-24 — Balance dimension includes leaveType (default PTO)`
   - `2026-04-24 — Mock HCM is a standalone Express app under scripts/hcm-mock/`
   - `2026-04-24 — Cancellation is a distinct terminal state from rejection`
8. Update §10 Open questions: six questions reformatted as closed
   references pointing into §9; keep one genuinely-unresolved:
   clock/timezone authority.
9. Commit Phase B as two commits:
   - `docs(trd): add assumed HCM contract section`
   - `docs(trd): resolve six open questions via seven decision entries`

### Phase C — Gated additions

10. `docs/devlog.md` — chronological session log, back-filled for every
    session since 2026-04-23.
11. Domain-specific slash commands **not** added (per §10, no
    speculative tooling — revisit when a concrete reuse case appears).

---

## Plan-level decisions

1. **Architect's positions adopted on 5 of 6 questions; dual resolution on 1.**
   The whole point of cross-validation is exercising a bias-free second
   voice; adopting its output when the rationale is stronger is the
   discipline.
2. **Plans archive includes the architect analysis.** Without the
   analysis, the synthesis above is unverifiable on its own.
3. **Historical plans ported despite being executed.** `docs/plans/`
   preserves the journey, not just the current horizon.
4. **Devlog default yes, slash commands default no.** Per §10; user
   ratified via `AskUserQuestion`.
5. **Decision log entries use our own language, not architect prose
   verbatim.** The architect's output informs the decision; the TRD
   authorship remains ours. Lift rationale, compress, add
   `INSTRUCTIONS.md` citations.

## Verification

### After Phase A
- `ls docs/plans/` shows `README.md` + three numbered plans.
- `ls docs/` shows `process.md`.
- Plan 001 file contains the *Reconstructed from conversation memory*
  note.
- Plan 003 file contains the *Architect analysis appendix* section.

### After Phase B
- `grep -c '^## ' TRD.md` increased by one.
- Eight `Decision log` entries present (existing *Challenge brief kept
  local-only* + seven new).
- Every new entry cites at least one `§X` from `INSTRUCTIONS.md`.
- §10 contains one genuinely-open item (clock/timezone) plus six
  closed pointers.

### After Phase C
- `docs/devlog.md` has an entry per session from 2026-04-23 onward.

## Out of scope

- NestJS scaffolding — next plan.
- Mock HCM implementation — shape decided here, code next plan.
- Data model migrations and entities — next plan (`domain-data` subagent).
- Any production code.

---

# Appendix A — Architect analysis (verbatim)

> The following is the full output of the `architect` subagent run in
> background on 2026-04-24 against the six questions in `TRD §9`, with
> access only to `INSTRUCTIONS.md`, `TRD.md`, `notes/CHALLENGE.md`, and
> `CLAUDE.md`. It was produced *before* the lead's recommendations were
> shared with the subagent.

## 1. Balance reservation timing — creation vs approval

**Question restated.** When a time-off request is created in `pending`
state, should the balance already be reserved/decremented locally, or
should the balance only move on manager approval?

**Recommended resolution.** Reserve the balance **at creation time** as
a local hold (a "pending reservation"), distinct from an "approved
deduction". The available-to-employee balance is
`hcmBalance − pending − approvedNotYetPushed`. On rejection or
cancellation, the reservation is released; on approval, it converts to
an approved deduction.

**Rationale.** The Employee persona in the brief explicitly wants
*"instant feedback on requests"* (CHALLENGE.md), which means the second
concurrent request from the same employee must see that 2 of their 10
days are already taken — even before a manager acts. Not reserving at
creation opens a classic double-spend window: Employee submits two
pending 8-day requests against a 10-day balance, manager approves both.
§8.4 (Consistency rule) requires designing against concurrency and
duplication; a local reservation is the simplest mechanism that closes
the window. §8.2 prefers the simpler correct design, and a two-state
local ledger (`pending_hold`, `approved_deduction`) is simpler to
explain and test than optimistic approval-time checks under load.

**Alternatives considered.** *Decrement only on approval*: matches
naive mental models and simplifies cancellation (no rollback). Rejected
because it leaves the window between "pending exists" and "approved"
unprotected — two pending requests can each pass the approval-time
check independently if approvals interleave, and the manager persona
*"needs to approve requests knowing the data is valid"* which is weaker
if the check happens only at decision time against an un-reserved
balance. *Decrement on creation and treat rejection as a compensating
credit*: equivalent in effect to the recommendation but conflates two
concepts into one column; the explicit split between `pending` and
`approved` ledger lines is easier to reason about during reconciliation.

**Blast radius.** Touches the balance entity (needs pending vs approved
decomposition), request state machine, the create/approve/reject/cancel
use cases, and every balance-consistency test. If the real HCM turns
out to expect reservations mirrored externally (a "hold" API), we'd
need to extend HCM sync to push holds — but that is additive, not a
rewrite.

## 2. Approval-to-HCM propagation — synchronous vs asynchronous

**Question restated.** When a manager approves, does the service call
HCM inline (commit depends on HCM), or commit locally first and push
to HCM out-of-band?

**Recommended resolution.** **Commit the approval locally first, then
push to HCM as a separate step** with a durable outbox row
(`hcm_push_tasks` or equivalent) driven by a retry worker. The request
transitions to `approved` on local commit; a second flag
(`hcmSyncStatus: pending|synced|failed`) tracks HCM state.

**Rationale.** The brief frames HCM as potentially faulty and lists
HCM unavailability and timeout as scenarios to handle (INSTRUCTIONS.md
§13). A synchronous coupling means HCM downtime blocks approvals —
unacceptable for a manager workflow — and a transactional rollback of
approval on HCM failure loses the domain event the manager already
made. §8.3 (Defense rule) and §8.4 (partial failure) point to
decoupling: local truth + async reconciliation is the standard
defensive pattern. The outbox adds one table and one worker, which is
far below the overengineering threshold in §10; it is not a
queue/event-bus, just a durable TODO list the service already owns.

**Alternatives considered.** *Synchronous call inside the approval
transaction*: simplest to reason about for a happy path and gives the
manager immediate confirmation HCM accepted it. Rejected because a 30s
HCM timeout becomes a 30s user-facing latency, and retries would
require re-entering an approval flow that already side-effected.
*Fire-and-forget with no persistence*: minimal code but silently drops
state on crash — violates §8.4 (reprocessing, partial failure). The
outbox is the minimum viable persistent retry mechanism.

**Uncertainty note.** "Async" here does not mean we need a message
broker. It means a row in SQLite polled by an in-process worker at a
modest cadence. If the reviewer finds this too close to queue-
infrastructure, the fallback is to trigger the worker inline after
commit and accept that a crash between commit and worker tick leaves
the row for the next startup to pick up — still correct.

**Blast radius.** Adds an outbox table, a push worker module, and a
`hcmSyncStatus` column on requests. Touches approval use case, HCM
client, and tests for HCM-down / timeout / retry-after-crash. If the
HCM turns out to require synchronous validation before we tell the
manager "approved", we'd need a pre-approval probe call, which is
additive.

## 3. Batch sync conflict resolution

**Question restated.** When the HCM batch arrives with a balance that
contradicts pending reservations or approved-but-not-yet-pushed
deductions locally, what wins and how do we report it?

**Recommended resolution.** **HCM batch wins for the raw balance
value**, but local pending reservations and unsynced approved
deductions are **preserved on top** of the new HCM value. Mismatches
where the HCM balance would result in negative available-balance after
applying local holds are flagged as an **`inconsistency` event** on
the affected records, surfaced to a manager-facing endpoint, and halt
further approvals against that `(employeeId, locationId)` until
resolved.

**Rationale.** The brief names HCM as "Source of Truth" (CHALLENGE.md)
for balance values, so silently overriding HCM with our local view
contradicts the problem statement. But §8.3 forbids blind trust: a
pure "HCM overwrites everything" policy would erase a just-approved-
not-yet-pushed decision the manager already made. The middle path —
HCM sets the ceiling, local ledger lines survive, conflicts become
explicit events — respects both constraints and aligns with §12's
error taxonomy distinction ("detected inconsistency" is its own
category). Halting the blocked dimension prevents compounding the
divergence, which §8.4 requires.

**Alternatives considered.** *HCM always wins; wipe and replay local
state*: simplest, matches a naive "source of truth" reading. Rejected
because an approved request whose HCM push is in-flight would be lost,
and the manager sees no signal anything happened. *Local always wins;
HCM is advisory*: rejected on first principles — the brief explicitly
says HCM is SoT. *Last-write-wins by timestamp*: requires trustworthy
clocks on both sides and silently loses data either way; worst of both
worlds.

**Blast radius.** Touches the batch ingestion use case, the balance
projection logic, an `inconsistencies` table/endpoint, and tests
covering batch-during-pending, batch-during-approval-push, and
batch-reducing-below-approved. If the real HCM includes the in-flight
reservations in its batch (i.e., our approved push is already
reflected), our detection logic needs tuning but the architecture does
not change.

## 4. Idempotency identifier for HCM calls

**Question restated.** What key makes a realtime HCM call safely
retryable without double-applying the mutation?

**Recommended resolution.** **A service-generated UUID per logical
mutation intent**, stored on the outbox row and sent to HCM as an
`Idempotency-Key` header (or equivalent field). The key is stable
across retries of the same push, distinct for a compensating reversal,
and never derived from domain tuples.

**Rationale.** §8.4 explicitly lists reprocessing and duplication as
first-class concerns. A UUID generated once at outbox-write time is
the standard, minimally-invasive mechanism that works regardless of
whether HCM supports idempotency natively — if HCM ignores the header,
we still have a local record of "this exact attempt was made" for
audit and reconciliation. Deriving the key from
`(employeeId, locationId, startDate, endDate)` looks elegant but
breaks on legitimate re-submissions (employee cancels, reopens a
request with the same dates) and collapses a reversal into the same
key as its original. §8.5 (Traceability) favors an explicit per-intent
key that maps 1:1 to a domain action in logs.

**Alternatives considered.** *Use
`(employeeId, locationId, startDate, endDate)` tuple as the
idempotency key*: appealing because it reflects the business meaning.
Rejected because it conflates intent with state — a reversal of the
same tuple is a different intent. *Use HCM-returned id*: unusable for
the first call (no id yet to deduplicate against) and assumes HCM even
returns stable ids. *No idempotency key, rely on HCM's internal dedup*:
violates §8.3 (never trust HCM blindly).

**Uncertainty note.** We do not know whether the real HCM honors an
idempotency header. The design must be safe even if it does not: the
outbox row itself, indexed by the UUID, is the local source of dedup
truth — before dispatching a retry, check whether a prior attempt
recorded a success response, regardless of what HCM's own bookkeeping
says.

**Blast radius.** Adds a `hcm_idempotency_key` column on the outbox
(or on requests directly), and a response-capture table/column to
record outcomes of prior attempts. Touches the HCM client (header
injection, retry loop) and the push worker. If the real HCM requires
a different key shape (say, their own ticket id), we swap the header
name; the concept holds.

## 5. Dimensions beyond `(employeeId, locationId)`

**Question restated.** Does the balance model need any dimensions
beyond employee and location — e.g. leave type, accrual period,
policy?

**Recommended resolution.** **Model balance as
`(employeeId, locationId, leaveType)`** with `leaveType` as a required
enumerated field, defaulting to a single `PTO` entry for initial
seeding. Do not add accrual period, policy, or tenancy dimensions
unless the HCM mock's schema forces them.

**Rationale.** §8.7 (Non-invention rule) forbids inventing
requirements; §8.1 (Scope rule) forbids solving a larger imaginary
problem. But the challenge brief names vacation/sick as plausible
distinctions (*"10 days of leave and requests 2 days"* implies a type
exists even if only one), and the brief itself uses the phrase
*"with necessary dimensions"* for the batch payload — this is a
deliberate hook. A single optional leave-type field is the minimum
extension that preserves a defensible story if challenged with
"what if sick leave is separate?", while adding near-zero complexity:
one enum column, one index extension. Adding accrual period or policy
is speculative and blocked by §10.

**Alternatives considered.** *Keep only
`(employeeId, locationId)`*: maximally simple, aligns with the brief's
one explicit "Assume" statement (*"balances are per-employee
per-location"*). Rejected because a real HCM almost universally
separates leave categories, and adding the column later touches every
balance query — the marginal cost now is less than the regret later.
*Full policy model with accrual windows*: rejected outright under §10
and §8.7 — no evidence this is needed.

**Uncertainty note.** The brief's single explicit "Assume" is
*"balances are per-employee per-location"*. The addition of leave
type could be read as violating that assumption. Defensible
framing: leave type is an attribute of a balance record, not a
replacement for the per-employee per-location grain. This should be
called out explicitly in the TRD.

**Blast radius.** Touches the balance entity's primary key, every
balance repository method, batch ingestion mapping, request DTO
(request must specify type), and balance invariant tests. If the real
HCM has no leave type distinction, the column collapses to a single
value with no behavioral impact — cheap to carry.

## 6. Mock HCM shape — real server vs in-process double

**Question restated.** Is the HCM mock a standalone HTTP server
(separate process or sibling Nest app), an Express mini-service under
`scripts/`, or an in-process NestJS module bound to a real port via
`supertest`?

**Recommended resolution.** **A standalone lightweight HTTP server**
(small Express or Fastify app) under `scripts/hcm-mock/`, started as a
separate process for integration and e2e tests, with an explicit HTTP
contract. Unit tests may use in-process doubles where appropriate, but
every test that exercises the HCM client layer talks HTTP to the mock.

**Rationale.** The brief says verbatim: *"you may want to deploy real
mock servers for them with some basic logic to simulate balance
changes"* (CHALLENGE.md). This is the strongest signal in the entire
brief about test fidelity — the brief calls for HTTP client code
exercised against a real socket, including timeouts,
slow responses, and server errors. An in-process double shortcuts the
client's retry loop, timeout handling, and serialization — exactly the
code paths §13 names as critical. A standalone mock is the simplest
structure that provides that fidelity: it is just a JS file with
routes; no container, no docker-compose required for the minimum
viable version.

**Alternatives considered.** *In-process NestJS module*: fastest test
runtime, zero port management. Rejected because it defeats what the
brief explicitly favors and hides real HTTP client behavior from
tests. *Sibling Nest app in a monorepo*: higher fidelity but drags in
Nest bootstrapping costs and monorepo tooling for a mock that does
not need DI, modules, or guards. Under §8.2 (simplicity) and §10 (no
infrastructure without need), a tiny Express app is the right level of
ceremony.

**Uncertainty note.** Test runtime can become painful if every test
boots the mock. Mitigation: start the mock once per test suite (global
setup), expose a state-reset endpoint, and share it across tests. This
is standard practice and does not require infrastructure beyond the
mock itself.

**Blast radius.** Adds `scripts/hcm-mock/` with its own minimal
`package.json` scope (or sharing the root), a global Jest setup hook,
and the HCM client contract is documented against this mock. Touches
integration and e2e test configuration. If the real HCM contract turns
out different, the mock is the first thing we update — it is designed
to be cheap to change.

## Assumption Contract

The service will be built against an HCM that exposes an HTTP realtime
API and an HTTP batch push (HCM → us), identified in tests by a
standalone Express mock under `scripts/hcm-mock/`. Balance is keyed by
`(employeeId, locationId, leaveType)` with HCM treated as source of
truth for raw values, overlaid locally with pending reservations
(created at request submission) and approved deductions (created at
manager approval). Approvals commit locally first and are pushed to
HCM asynchronously via a durable outbox, each push tagged with a
service-generated UUID idempotency key. Batch sync overwrites the raw
HCM value but preserves local pending and unsynced-approved lines;
contradictions are flagged as explicit `inconsistency` events and
block further approvals on the affected dimension until resolved.
Every balance mutation validates locally even when the HCM would also
reject.

## Risk surface ranking (highest to lowest regret cost if wrong)

1. **#3 Batch sync conflict resolution** — a wrong policy here can
   silently destroy approved time off or let balances go negative; the
   blast touches every reconciliation path and the manager's trust in
   the system.
2. **#1 Balance reservation timing** — wrong choice creates a
   double-spend window that is invisible in single-user testing but
   surfaces under load; reversing later means migrating existing
   request data.
3. **#2 Approval-to-HCM propagation** — sync vs async changes the
   failure contract users see and the whole retry/outbox machinery;
   switching later is a large refactor of approval flow and tests.
4. **#4 Idempotency identifier** — a wrong key leads to duplicated or
   lost HCM writes under retry; damage is contained to the HCM client
   layer but hard to detect without targeted tests.
5. **#6 Mock HCM shape** — a wrong choice compromises test realism;
   fixable later by rewriting the mock, but the test suite's claim to
   rigor is degraded in the interim, which directly affects the
   primary deliverable grading.
6. **#5 Dimensions beyond `(employeeId, locationId)`** — adding a
   column later is mechanical; under-modeling is recoverable. The
   regret is mostly narrative (defending the TRD) rather than
   technical.

## Additional risks surfaced

- **Cancellation semantics for pending requests.** The six questions
  touch approval/rejection but not employee-initiated cancellation of
  a `pending` request. If reservation happens at creation (per #1),
  cancellation must release the hold atomically, and the state machine
  needs a `cancelled` terminal state distinct from `rejected`.
- **Authoritative direction of the batch endpoint.** TRD §1 says
  "HCM → us", but CHALLENGE.md literally reads
  *"HCM provides a batch end point that would send the whole corpus
  ... to ExampleHR"* — this is consistent but worth re-confirming,
  because if it turns out the batch is us-pulling-from-HCM vs
  HCM-pushing-to-us, the failure semantics differ.
- **Clock / timezone authority for `startDate` / `endDate`.** Leave
  requests are date-bounded; if HCM operates in a different timezone
  than our service, a same-day request can land on different business
  dates across systems.
