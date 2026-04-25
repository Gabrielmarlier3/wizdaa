# Development log

Chronological narrative of working sessions. One entry per session,
intentionally brief — the detail lives in `docs/plans/`, `TRD.md`, and
the commit history.

---

## 2026-04-23 — Session 1: foundation

Started from an empty repo with only `INSTRUCTIONS.md` (Portuguese).
Planned and executed the AI-development foundation: translated
`INSTRUCTIONS.md` to English in place, preserving the 24-section
structure so subagent prompts can reference `§X` reliably. Created
`CLAUDE.md` as a concise operational briefing that *points to*
`INSTRUCTIONS.md` for rules (no duplication, no drift). Scaffolded six
subagents in `.claude/agents/` with `architect` and `reviewer` as
read-only roles, two slash commands in `.claude/commands/`, and a
permissions allowlist in `.claude/settings.json`.

Commits: `4b1e766`, `32bcb6b`. Plan archive:
`docs/plans/001-foundation-claude-multiagent-setup.md`.

## 2026-04-23 — Session 1b: local-only scratch space

Set up `notes/` as a local-only workspace excluded via
`.git/info/exclude` — not via `.gitignore` — so neither the ignored
folder nor the exclusion itself leaves any trace on the public repo.
Intended for private references, brainstorms, and unpublished drafts.

## 2026-04-24 — Session 2: pre-bootstrap scaffolding

Before any NestJS scaffolding could land, three gaps had to close:
`.gitignore` (Node + SQLite + IDE folders), `README.md` skeleton, and
`TRD.md` skeleton (ADR-lite with a Decision log as the traceability
anchor required by §8.5). The take-home PDF was placed in `notes/`
by the user — a signal that the brief should not surface on
the public repo. A faithful Markdown transcription was saved as
`notes/CHALLENGE.md`; the public `TRD.md` §1 describes the problem in
our own words. The first Decision log entry recorded this choice.

Commits: `8058534`, `76375d9`, `241ee69`. Plan archive:
`docs/plans/002-pre-bootstrap-scaffolding.md`.

## 2026-04-24 — Session 3: resolving open questions, agentic process as deliverable

Six open questions in `TRD.md` §9 blocked any further design. Since
AI-first mastery is the brief's primary measurement axis, the chosen
strategy was cross-validation: launch the `architect` subagent in the
background with a deliberately bias-free prompt so its first-principles
analysis would be independent of the lead's prior opinion. Both voices
were synthesized in the plan. The architect's positions prevailed on
five of six questions (reservation at creation as a two-state ledger;
async approval push via durable outbox; batch preserves local holds and
halts on conflict; `leaveType` as a third balance dimension; Express
mock under `scripts/hcm-mock/`); the sixth resolved as *both* since the
two proposals addressed different scopes (client UUID for request
dedup, service UUID for HCM push dedup). The architect also surfaced
three risks absent from §9: cancellation semantics, batch direction
confirmation, and clock/timezone authority.

The plan also formalized the agentic process itself as a deliverable:
`docs/plans/` with the full architect analysis as an appendix to plan
003, `docs/process.md` documenting the subagents and workflow, this
`docs/devlog.md` narrating the sessions, historical plans 001 and 002
ported in English (001 reconstructed from conversation memory since
the original plan file had been overwritten before archiving was a
practice).

Commits (Phase A): `01942ea`, `7ad5d11`. Phase B (TRD contract + seven
decision entries) and remaining Phase C follow. Plan archive:
`docs/plans/003-open-questions-and-agentic-process.md`.

## 2026-04-24 — Session 4: NestJS scaffolding and first TDD slice

Executed plan 004 end-to-end:

Phase A filled `TRD.md` §2 (architecture overview with ASCII
diagram, four Nest modules, boundary rules) and §8 (test pyramid,
coverage targets, mock HCM lifecycle, TDD ordering, critical
scenarios). Phase B hand-crafted the NestJS project without the CLI
hello-world: package.json, strict tsconfig (ES2022 for drizzle-kit
compatibility), Jest with unit + e2e configs, Drizzle + better-sqlite3
with a DatabaseModule and migration runner, and the mock HCM
skeleton under `scripts/hcm-mock/`. Phase C took the `POST /requests`
slice through a red-green-refactor loop:

1. Failing e2e spec drove the entire slice.
2. Schema + migration landed the three tables (`balances`, `requests`,
   `holds`).
3. Domain layer (pure functions: `createPendingRequest`, balance
   projection) landed with unit specs covering the happy path,
   domain rejections, and the exact-boundary projection cases.
4. Repositories and `CreateRequestUseCase` wired the transactional
   hold creation via `db.transaction(() => ...)` — synchronous by
   construction per the Drizzle-over-better-sqlite3 decision.
5. Controller + DTO + `TimeOffModule` made the e2e pass.
6. Two more e2e tests covered idempotency (duplicate
   `clientRequestId` returns the same request, no second hold) and
   insufficient balance (→ 409 with `{code, message}` body).

The plan reserved a final `refactor(domain)` commit for extracting
balance projection to a pure function; this was already done during
initial implementation, so the refactor commit was skipped rather
than manufactured for show.

TRD §9 gained the Drizzle ORM decision entry with TypeORM / Prisma /
raw alternatives explicitly rejected.

Commits (selected): `9fd9c71` (TRD §2/§8), `3040f8b`, `17cc746`,
`140ccc0`, `d905f4f`, `bf90176`, `db32f7c` (Phase B), `fa54d05`,
`3a566c8`, `0df2f4a`, `f5c7ad9`, `96d3ce1`, `d82a7ed`, `47c869b`
(Phase C). Plan archive:
`docs/plans/004-trd-completion-scaffolding-and-first-slice.md`.

## 2026-04-24 — Session 5: pre-push review and followups

Ran the `reviewer` subagent on the 17 local commits before pushing —
the first use of a subagent during plan 004's execution (the plan
itself ran as a monolith, contradicting the discipline documented in
`docs/process.md`). The review surfaced one silently-weakening bug
and one boundary rot that would have compounded, plus a handful of
smaller fixes.

Findings applied as four commits:

- `fix(time-off)`: the read-validate-insert sequence (idempotency
  lookup, balance read, hold sum, inserts) now runs inside one
  `db.transaction(...)`. Today this works because better-sqlite3
  is synchronous and the event loop serializes `execute()`, but any
  `await` inside the use case would silently break the balance
  check. The UNIQUE-constraint race on `client_request_id` is also
  caught and recovered idempotently instead of bubbling as 500.
- `refactor(domain)`: `RequestStatus` and `requestStatusValues`
  moved from `src/database/schema.ts` into `src/domain/request.ts`.
  Schema now imports from domain — the dependency direction matches
  TRD §2.
- `chore`: `app.enableShutdownHooks()` so the SQLite client closes
  on SIGTERM; `InvalidDimensionError` → 422 per TRD §3.2;
  speculative `BalancesRepository.upsert` removed (§8.7, §10);
  coverage-only `app.module.spec.ts` removed (§15); devlog softened
  the "100% unit coverage" claim that had no anchored snapshot.
- `chore(test)`: mock HCM started / stopped by Jest `globalSetup`
  and `globalTeardown`; `jest.config.ts` now splits unit and
  integration as projects, matching the pyramid in TRD §8.

Lesson: cross-review is load-bearing for this repo's evaluation
story. The next slice (`POST /requests/:id/approve`) invokes the
architect at plan time and the reviewer before push by default.

Commits: `dec27f1`, `9d949a3`, `1c2da27`, `299d850`.

## 2026-04-24 — Session 6: subagent discipline + approve slice

Plan 005 executed end-to-end under the discipline it formalises.

**Phase A (2 commits).** Moved the subagent rule into CLAUDE.md so
it is auto-loaded every turn, and added a Plan template section to
docs/process.md making the Architect briefing a required section
of every archived plan. The two documents now agree.

**Phase B (15 commits).** The approve slice (`POST /requests/:id/
approve`). Architect subagent ran first on `opus` with a bias-free
prompt; its brief is Appendix A of plan 005. TDD ordering followed
the brief: red e2e → schema + migration (hcm_outbox,
approved_deductions, requests.hcm_sync_status) → domain transition
+ InvalidTransitionError → repositories (approve with
UPDATE-WHERE-status fence, delete hold, insert deduction, insert
outbox) → HcmClient (fetch + 2s AbortController + discriminated
outcome) → mock HCM extended with /balance/mutations and
scenario-injection → ApproveRequestUseCase (one tx for commit, a
second tx for post-push resolution) → controller wiring (happy
path green) → e2e coverage of transient failure, permanent failure,
concurrent approve, idempotent replay → integration test for
approval-time balance re-check → mock-contract test for
Idempotency-Key dedup → TRD §4 / §5 / §7 filled, §9 decision #11
recorded, §10 reorganised with three new open questions.

**Phase C (5 commits).** Reviewer subagent ran on the full slice
diff. No blocking finding; six should-fix items applied as focused
followups:
- fix(time-off): concurrency-fence branches re-read the row to
  report the honest currentStatus instead of hard-coding
  'approved'; logger calls moved past the resolution tx so they
  cannot describe state a rollback undid.
- fix(hcm-mock): replays terminal 4xx outcomes idempotently, not
  just 2xx — contract test added to pin the behaviour.
- test(e2e): covers the `forceBadShape` path (R5) that had
  defensive code but no spec.
- test(integration): covers InvalidDimensionError at approval
  time (the TRD §7 entry previously documented without a backing
  spec).
- docs(time-off): pins the holds-lifecycle invariant in a JSDoc so
  a future slice that retains a hold post-transition surfaces the
  need to tighten the sum query instead of silently over-counting.

Two subagents used by design this session — architect pre-plan
and reviewer pre-push — matching the CLAUDE.md rule this same
session landed. 21 unit/integration + 13 e2e tests green.

Commits (selected): `842d719`, `22c8004` (Phase A); `8eb4370`
through `4ec127d` (Phase B, 15 commits); `65765cf`, `f126a1f`,
`8beca28`, `7955a6d`, `31d9eac` (Phase C followups). Plan archive:
`docs/plans/005-subagent-discipline-and-approve-slice.md`.

## 2026-04-24 — Session 7: reject slice

Plan 006 executed end-to-end under the formalised discipline.

**Phase A (7 commits, architect-briefed).** The architect subagent
(sonnet this time — smaller slice, smaller model) confirmed the
architectural picture: no HCM interaction on reject, no outbox, no
schema change, single-transaction flow, hcmSyncStatus stays
`not_required`. TDD order mirrored the approve slice structurally:
red e2e → domain transition + unit specs → repository method →
use case → controller wiring (happy path green) → reject-after-
approve + unknown-id e2e → concurrent-reject integration.

**Phase B (reviewer pre-push, 1 commit).** Reviewer (sonnet)
verdict: ship as-is. Zero blocking, zero should-fix, one nit —
`RequestNotFoundError` lived inside `approve-request.use-case.ts`
and was imported from there by reject, creating a soft coupling
that would compound with the next (cancel) slice. Lifted to
`src/time-off/errors.ts` as a single-commit refactor; three import
sites updated. The nit landing now instead of the next slice is a
deliberate micro-investment — prevents rework mid-cancel.

**Phase C (wrap).** This entry + plan 006 archive.

28 unit/integration + 16 e2e (out of 44 tests total) green. No TRD
changes — reject exercises existing §9 decisions without introducing
a new architectural choice. §10 open questions unchanged.

Commits: `f2f3bfb`, `f5fe41e`, `fb5629d`, `11516bb`, `b5b1676`,
`c36d2c0`, `d583717` (Phase A); `5a97bbf` (Phase B). Plan archive:
`docs/plans/006-reject-slice.md`.

## 2026-04-24 — Session 8: cancel slice

Plan 007 executed end-to-end. Cancel is the mechanical twin of
reject — same single-transaction flow, same concurrency fence, no
HCM interaction — with `cancelled` replacing `rejected` as the
terminal state and Employee replacing Manager as the nominal actor
(TRD §9 *Cancellation is a distinct terminal state from
rejection*).

**Phase A (7 commits, architect-briefed).** The architect (sonnet)
confirmed: no schema change, no TRD decision entry, no new
machinery. The slice exercises the §9 decision that had been
sitting in the TRD since plan 005 without an executing path. TDD
order mirrored plan 006 exactly: failing e2e → domain transition
with 6 unit specs → repo method → use case → controller + module
wire → cancel-after-approve + unknown-id e2e → concurrent-cancel
integration.

**Phase B (reviewer pre-push, 0 commits).** Reviewer (sonnet)
verdict: ship as-is. One finding started, then self-retracted
during the review itself — the reviewer wrote a "should fix" about
`cancel` controller method not being async, then corrected
themselves in the same entry after re-reading and confirming
parity with reject. Three nits landed, all documentation-quality
observations that do not warrant a commit. The DRY-pressure check
explicitly reaffirmed the deferral: `RejectRequestUseCase` and
`CancelRequestUseCase` are now byte-for-byte identical except for
the literal `'rejected'` / `'cancelled'`, but two clear files beat
one generic file with a mode parameter. Extraction waits for a
third genuinely-same-shape transition or reviewer pressure that
isn't defensively deferred.

**Phase C (wrap).** This entry + plan 007 archive.

35 unit/integration + 19 e2e (54 total) green. TRD unchanged
(§10 sections, 11 decision entries). No theater-language audit
regressions.

Lifecycle is now complete at the HTTP level: create, approve,
reject, cancel. The remaining slices in the brief are HCM batch
intake (the big one), read endpoints (GET /balance, GET
/requests/:id), and the outbox worker for resilience.

Commits: `889ef27`, `1134759`, `ee8a009`, `2090769`, `ccf0fb9`,
`3c77082`, `8f73941` (Phase A). Plan archive:
`docs/plans/007-cancel-slice.md`.

## 2026-04-24 — Session 9: read endpoints

Plan 008 executed end-to-end. Two GET endpoints closing the write
lifecycle's asymmetry — the Employee persona's "see accurate
balance" need and the reconciliation-after-409 pattern both now
have an HTTP surface.

**Phase A (7 commits, architect-briefed).** The architect (sonnet)
took defensible positions on every design point: the four-field
overlay breakdown (not a single `available` number), separate
use cases over inline controller logic, a new `BALANCE_NOT_FOUND`
(404) code instead of overloading `INVALID_DIMENSION` (422),
non-transactional reads (best-current-view, not snapshot), and a
new `BalanceModule` matching TRD §2. TDD order: failing e2e →
use case + unit specs → controller wire → e2e green, repeated per
endpoint, plus a TRD-update commit.

The one genuine structural decision was the BalanceModule vs
"BalanceController inside TimeOffModule" tradeoff. The user
explicitly preferred the separate module before execution started,
so `src/balance/` now exists and `TimeOffModule` exports the three
overlay-projection repos (`BalancesRepository`, `HoldsRepository`,
`ApprovedDeductionsRepository`) without duplicate provider
instances.

One mid-execution fix: the balance e2e originally drove its
`approvedNotYetPushedDays` fixture through the real approve flow
with the mock HCM's `force500` scenario. This raced with approve
specs running in parallel test files against the same singleton
mock. Refactored to seed the overlay ledger rows directly against
the DB — cleaner isolation and independent of any write path.

**Phase B (reviewer, 1 commit).** Reviewer (sonnet) verdict: ship
as-is. One should-fix (trivial: outbox seed row using
`failed_retryable` where `pending` was simpler and better
expressed the test's intent) + four nits (one applied: method
name `read` → `get` for consistency with TimeOffController; three
deferred as documented observations). Single followup commit
applied both.

**Phase C (wrap).** This entry + plan 008 archive.

43 unit/integration + 24 e2e (67 total) green. TRD: 10 sections
unchanged, 12 decision entries (+1: GET /balance response shape),
§7 error taxonomy gains `BALANCE_NOT_FOUND`.

Request lifecycle endpoints complete: create, approve, reject,
cancel, GET-by-id, GET-balance. Remaining named in plan 005 TRD
§10 / architect briefs: HCM batch intake (large), outbox worker
(medium), `inconsistency`-surface endpoint (small, paired with
batch).

Commits: `de79c59`, `4320a6f`, `1815309`, `38fcfcc`, `893f57b`,
`ecf157e`, `39bf508` (Phase A); `1b9e783` (Phase B). Plan archive:
`docs/plans/008-read-endpoints.md`.

## 2026-04-24 — Session 10: outbox worker

Plan 009 executed end-to-end. Closes TRD §10 open question 8 (the
outbox worker topology gap) by landing the in-process polling
worker that drains `hcm_outbox` rows left `failed_retryable` by a
transient HCM failure. Until this slice, the overlay projection
would under-count `availableDays` indefinitely for any request
whose inline push had hit a 5xx or malformed 2xx — the approve
use case scheduled a retry 30s out, but nothing ever picked it up.

**Phase A (8 commits, architect-briefed).** The architect (sonnet)
output a full first-principles brief: worker topology (in-process
over out-of-process), retry policy (exponential 30s base × 2, max
5 attempts, proposed 30-min cap), R5 race between late inline
push and worker tick (guard `WHERE status != 'synced'`), payload
read from stored `payloadJson` and idempotency key from the row
(never freshly generated), NODE_ENV-guarded auto-start so tests
drive `tick()` manually.

Mid-execution deviations from the original plan:

- **30-minute backoff cap dropped.** With `MAX_ATTEMPTS=5` and a
  30s base, the largest scheduled delay is 240s (`2^3 × 30s`) —
  the fifth failure exhausts immediately and never schedules. A
  30-min cap is unreachable code; INSTRUCTIONS.md §10 says don't
  write it until the constraint appears. The §9 decision entry
  explicitly records "no cap needed" with the arithmetic.
- **Worker file at `src/hcm/`, provider in `TimeOffModule`.** The
  worker needs `HcmClient` (HcmModule), `HcmOutboxRepository`
  (HcmModule after Phase B), and `RequestsRepository` (TimeOffModule).
  HcmModule importing TimeOffModule would create a cycle since
  TimeOffModule already imports HcmModule. The provider stays in
  TimeOffModule so the graph is acyclic.
- **Integration spec became e2e.** The mock HCM is started only by
  `test/jest-e2e.config.ts`'s `globalSetup`. Adding a second
  globalSetup to the unit+integration config would duplicate the
  mock lifecycle for no gain — putting the worker's mock-driven
  spec in `test/e2e/` is simpler.
- **`maxWorkers: 1` on the e2e config.** The mock HCM's scenario
  state is a module-level singleton shared across Jest workers.
  The approve specs had been latently racy for two slices; the
  outbox worker's aggressive scenario flipping pushed it past the
  breaking point. Serialising e2e at the worker level is the
  cheapest correct fix; per-worker mock instances would need port
  allocation and lifecycle rework for no real gain.

**Phase B (reviewer, 3 commits).** Reviewer (sonnet) verdict:
*ship with fixes*. Four should-fix:

1. **Terminal-state guard asymmetry.** The R5 mitigation only
   protected `synced` from overwrites; `failed_permanent` was
   equally terminal but unguarded. A late inline push landing
   `permanent` concurrent with a worker landing `transient` on
   the same row would have walked the permanent terminal
   backward. Applied: both `markFailedRetryable` and
   `markFailedPermanent` now use `status NOT IN ('synced',
   'failed_permanent')`, with two new integration specs covering
   `failed_permanent` alongside the two existing `synced` cases.
2. **Module boundary hidden coupling.** `HcmOutboxRepository`
   registered in TimeOffModule despite being an HCM-integration
   concern. Applied: file moved to `src/hcm/repositories/`,
   provider registered in `HcmModule`, `ApproveRequestUseCase`
   and `HcmOutboxWorker` imports updated. Pure rewiring; no
   behavioural delta.
3. **`JSON.parse(payloadJson)` unguarded.** A corrupted payload
   would throw synchronously out of `processRow`, propagate past
   the for-loop, and starve every row behind it in the batch.
   Applied: try/catch promotes the poison row to `failed_permanent`
   with a parse-error reason and continues. A new unit spec pairs
   a poison row with a healthy one and asserts the healthy row
   still gets pushed.
4. **`NODE_ENV === 'test'` fragility.** Reviewer suggested an
   explicit constructor argument or injected config. *Deferred.*
   Jest sets `NODE_ENV=test` by default per its own docs, so the
   guard is robust against the Jest lifecycle; the failure mode
   reviewer flagged (non-standard `NODE_ENV` in a deployed
   container) is observable quickly — every approval would stay
   `hcmSyncStatus='pending'` forever. The ceremony cost of DI
   wiring for a single boolean outweighs the gain under §8.2
   (simplicity) and §10 (no speculative abstraction).

Plus one small nit applied alongside the should-fix commits: the
comment on the backoff schedule was rephrased to track
`row.attempts ∈ {0,1,2,3}` explicitly (resolves ambiguity between
"attempts scheduled" and "attempts stored"). The `void`-return
stylistic nit was not applied (reviewer explicitly flagged it as
take-it-or-leave-it, and the current form is consistent with how
`ApproveRequestUseCase.resolveSyncStatus` writes the same
transaction pattern).

**Phase C (wrap).** This entry + plan 009 archive.

56 unit/integration + 34 e2e (90 total) green. TRD: 10 sections,
13 decision entries (+1: outbox worker), §10 Q8 moved to Closed.
§5 outbox paragraph rewritten from "future out-of-process worker"
to the now-implemented in-process cadence + retry policy. No
theater-language audit regressions.

The loop from approve to synced HCM mutation is now closed: inline
push handles the happy path and the first transient attempt;
worker takes over if the inline attempt failed, and promotes to
`failed_permanent` after 5 total attempts. Balance projection is
no longer stranded by a single transient outage.

Remaining slices named in TRD §10: HCM batch intake (large, Q9's
inconsistency-halt hook depends on it), inline push timeout budget
(Q10, wait for real timings), and — if we ever want it — removing
the inline push in favor of worker-only (UX tradeoff, separate
decision).

Commits: `d442d50`, `8b61644`, `2d7cbe1`, `28c7f6c`, `e8d9c22`,
`7517bbd`, `a94ee9f`, `35efe20` (Phase A); `81071a1`, `1fc6b0d`,
`dc4a942` (Phase B). Plan archive: `docs/plans/009-outbox-worker.md`.

## 2026-04-24 — Session 11: HCM batch intake + approve-time inconsistency halt

Plan 010 executed end-to-end. Closes TRD §10 Q9 (the flagged-
dimension halt hook) by landing both the ingress endpoint that
receives HCM's full-corpus balance snapshot and the approve-time
precondition check that honours the halt it writes. The §3.5
promise ("conflicts halt approvals") now has code on both sides
— detection AND enforcement in one slice so the `inconsistencies`
table is never a flag nobody reads.

**Phase A (10 commits, architect-briefed).** The architect
(sonnet) produced a full first-principles brief covering the
endpoint contract, replacement semantics, conflict predicate,
the new `inconsistencies` table shape, the `commitApproval` hook
placement, transaction boundaries, idempotency, concurrency,
error taxonomy, risks, and a 10-step ordered TDD plan. Two user
decisions were locked before the brief was translated into a plan:

- **Auto-clear on next clean batch** (vs manual-resolve only vs
  hybrid). The TRD treats HCM as source of truth; a batch that no
  longer triggers the predicate IS the authoritative "resolved"
  signal, so forcing a human acknowledgement every time would be
  friction without a safety gain at this scope.
- **Predicate excludes pending holds.** TRD §3.5 literal reading:
  `newHcmBalance − approvedNotYetPushed < 0`. Holds self-heal on
  reject/cancel, and including them would false-positive whenever
  many pendings are open.

Mid-execution deviations from the original plan:

- **Third module (`HcmIngressModule`) instead of registering in
  `HcmModule` or `TimeOffModule`.** The use case depends on
  `BalancesRepository` + `ApprovedDeductionsRepository` (time-off)
  and `InconsistenciesRepository` (HCM). Registering in `HcmModule`
  would require importing `TimeOffModule`, closing a cycle.
  Dedicated ingress module is acyclic, explicit, and matches the
  concern (HCM → service push).
- **Drizzle `excluded.*` UPSERT syntax for `BalancesRepository.upsertBatch`.**
  The initial attempt used `set: { col: (row) => row.col }` (not
  supported on SQLite); switched to `set: { col: sql\`excluded.col\` }`
  which is Drizzle's idiomatic escape hatch and matches SQLite's
  ON CONFLICT pseudo-table.
- **In-app diff for `deleteNotInSet`.** SQLite lacks tuple-aware
  NOT IN; a string-concatenation workaround would risk delimiter
  collision. Reading the existing key-set, diffing via a JS `Set`,
  and deleting per-stale-row is safe at the expected batch scale
  (low thousands of dimensions) and sidesteps both problems.

**Phase B (reviewer, 4 commits).** Reviewer (sonnet) verdict:
*ship with fixes*. Four should-fix:

1. **Composite-key collision in `deleteNotInSet`.** The initial
   encoding `\`${a}|${b}|${c}\`` collides for adversarial
   identifier values, and the accompanying comment claimed the
   risk was avoided while the code did the opposite. Applied:
   switched to `JSON.stringify([a, b, c])`, added an adversarial
   integration spec pinning the invariant.
2. **Ghost inconsistency rows when HCM drops a dimension.** The
   per-dimension loop only iterated over the incoming batch, so a
   dimension deleted by `deleteNotInSet` on balances left its
   inconsistency flag behind. Harmless in practice (subsequent
   approves fail `INVALID_DIMENSION` first) but the table would
   accumulate stale flags. Applied: new
   `InconsistenciesRepository.deleteNotInSet` paralleling the
   balances method, called before the per-dim loop in the same
   transaction. Two new integration specs.
3. **E2E halt spec coupled to mock's transient-failure path.**
   The original test used `force500` to keep the first approve's
   outbox non-synced so the deduction kept counting. A regression
   in the mock's 500-injection could have masked a halt
   regression. Applied: seeded the approved-not-yet-pushed state
   directly via `ctx.db`, removing the mock-scenario flip. Spec
   intent is now exactly "halt + auto-clear through HTTP".
4. **Empty-balances rejection policy was undocumented.** The DTO's
   `@ArrayMinSize(1)` rejects empty batches as 400, but the TRD
   did not explain why. Applied: added a short bullet to §3.3
   naming the reasoning — zero rows is ambiguous between "wipe"
   and "malfunction", and the destructive interpretation is too
   consequential to fire on an ambiguous payload.

Plus one nit applied (`HcmIngressModule` was exporting the use
case with no consumer, removed). Three nits deferred as
take-it-or-leave-it readability calls (duplicated dimension
message vs extras envelope, `async` on a sync-body use case, and
a one-line comment at the `generatedAt` discard point).

**Phase C (wrap).** This entry + plan 010 archive.

81 unit/integration + 41 e2e (122 total) green. TRD: 10 sections,
14 decision entries (+1: batch intake + auto-clear), §3.3 gains
the empty-batch rejection note, §5 outbox+batch paragraph
rewritten to the now-implemented flow, §6 promoted from TBD to a
full concurrency section with the three-way ordering analysis
(approve/reject/cancel + outbox worker + batch intake), §7 gains
`DIMENSION_INCONSISTENT`, §10 Q9 closed, new Q11 opens for
stranded pendings on deleted dimensions. No theater-language
audit regressions.

The integration story with HCM is now full loop: outbound pushes
(approve inline + outbox worker retries) AND inbound batches (full
corpus replacement + conflict detection + halt enforcement). The
only cross-cutting concern still open is auth, which remains
explicitly out of scope.

Remaining slices named in TRD §10: inline push timeout budget
(Q10, wait for real timings), stranded pending requests on deleted
dimensions (Q11, operator tooling once there is a workflow), and
— if ever needed — removing the inline push for worker-only sync
(UX tradeoff, separate decision).

Commits: `03b66be`, `898ac46`, `4d680af`, `4d86915`, `7470594`,
`77cddea`, `07e6818`, `9bedbc2`, `9d5f858`, `bd1d086` (Phase A);
`929c991`, `ba188b0`, `12f86a9`, `3a03ad8` (Phase B). Plan
archive: `docs/plans/010-batch-intake-and-inconsistency-halt.md`.

## 2026-04-24 — Session 12: README + proof of coverage polish

Plan 011 executed end-to-end. Documentation-heavy slice with two
explicit goals: ship the brief's named "proof of coverage"
deliverable as a curated artefact, and refresh the README so a
first-time reviewer landing cold sees an accurate picture of the
work. The slice doubled as a hygiene pass and surfaced one real
bug the reviewer subagent caught.

**Phase A (8 commits, no architect brief).** Documentation-only
slice — the architect step was not load-bearing per the
docs/process.md disciplined-exception clause. The reviewer step
still ran in Phase B because docs drift is exactly what the
reviewer's lens catches.

- A1 (`chore(tests): wire proof-of-coverage artefact and fix
  collectCoverageFrom`). The Jest `collectCoverageFrom` was
  missing `!src/**/*.spec.ts`, so spec files counted as 0 %
  source and dragged aggregates down (the `domain/` bucket read
  19 % even though both files are 100 % covered). Fixed,
  excluded the CLI `migrate.ts`, added a separate
  `coverageDirectory: 'coverage-e2e'` to the e2e config, added
  the `test:cov:e2e` script, and committed `docs/coverage.md` as
  the proof-of-coverage artefact.
- A2–A6 (one commit per topic): replaced the `TBD` placeholder
  with a real overview, refreshed the stack list, expanded the
  env-var table to every HCM_* and NODE_ENV, replaced the
  three-item project tree with the real eight-module layout,
  added a full API reference with example requests / responses /
  error codes for every endpoint, and surfaced the
  agentic-development artefacts (`docs/plans/`, `docs/devlog.md`,
  `docs/process.md`, `docs/coverage.md`, `.claude/agents/`).
- A7 (`docs(readme): testing section with coverage link and §15
  scenario map`). Restated TRD §8 targets, linked
  `docs/coverage.md`, added a table mapping every
  INSTRUCTIONS.md §15 critical scenario to its specific spec
  file. While building the table I noticed `forceTimeout` was a
  scenario type with no test driving it — added the missing
  forceTimeout e2e in a separate `test(e2e)` commit so the §15
  HCM-timeout claim was honest before it landed in the README.

The forceTimeout test surfaced an interesting Node 24 nuance:
the lastError captured in the outbox can be either `'timeout'`
or `'network'` depending on whether the AbortController abort
surfaces as `AbortError` cleanly through undici's fetch
implementation. The §15 invariant ("transient outcome, outbox
retryable") is what matters; the relaxed assertion
`/timeout|network/i` reflects this honestly. Tightening the
HcmClient classifier so the label is stable is a cheap future
slice but not load-bearing here.

**Phase B (reviewer, 3 commits).** Reviewer (sonnet) verdict:
*ship with fixes*. Three should-fix:

1. **`create-request.use-case.ts:87` placeholder.** The
   `approvedNotYetPushedDays = 0` placeholder with a comment
   promising "the approve slice" would replace it had been
   sitting there for eight slices. The approve slice never
   updated the create caller (TRD §9 *Approved deductions as a
   separate ledger table* explicitly committed to it). Effect:
   an employee whose only available balance had already been
   committed by a prior approval that had not yet synced could
   still POST /requests successfully — false-positive UX, §8.3
   defence-rule slip. Applied: injected
   ApprovedDeductionsRepository, replaced placeholder with the
   real `sumNotYetPushedDaysForDimension(...)` call, and added
   `test/integration/create-request.spec.ts` with two cases
   (overlay-blocks-create when outbox is non-synced; overlay-
   clears when outbox is synced).
2. **`docs/coverage.md` "≥ 83 % lines" claim was false.**
   `create-request.use-case.ts` was 78.57 % in both runs at the
   time (no complementary coverage). Applied: refreshed both
   coverage tables under the post-B1 SHA and replaced the
   aggregate claim with a per-file map that names each
   uncovered defensive-code path explicitly. The TRD §8 services
   target (≥ 90 %) is met on the e2e aggregate buckets; per-file
   shortfalls are all defensive code that §15 forbids inflating.
3. **README "001 through 011, each with Appendix A" overstated
   the architect discipline.** Plans 001–004 predate the
   architect-first cycle (formalised in plan 005); plan 011 is
   documentation-only. Applied: rewrote the sentence to "plans
   005–010 each have Appendix A; 001–004 are scaffolding; 011 is
   docs-only" and pointed at `docs/plans/README.md` for the
   per-slice summary.

Three nits: one (coverage.md SHA staleness) was implicitly
fixed by B2's refresh; one (README Appendix A claim) was the
should-fix above; one (forceTimeout assertion regex) was
acknowledged and explicitly deferred to a future HcmClient
hardening slice.

**Phase C (wrap).** This entry + plan 011 archive + plans
README update.

125 unit/integration + e2e tests green (83 + 42). TRD
unchanged. README rewritten section by section. `docs/coverage.md`
established as the proof-of-coverage artefact named in the
brief. Theater-language audit clean across every tracked
`.md` / `.ts` / `.json`.

The repo a first-time reviewer sees at `git clone` now reflects
the work: real overview, accurate project structure, full API
reference, every env var, every §15 scenario mapped to a spec
file, the agentic process artefacts surfaced, and a curated
coverage report. The B1 fix also closed a real correctness gap
that had been sitting in the create flow since plan 005.

Commits: `2efb318`, `b3b8fc8`, `eebdcd6`, `f2d1a9d`, `f898e92`,
`0cbbf82`, `d937973`, `19aa263` (Phase A); `6fbbf9c`, `ec54755`,
`9295055` (Phase B). Plan archive:
`docs/plans/011-readme-and-coverage-polish.md`.

## 2026-04-24 — Session 13: project-wide audit + submission fixes

After plan 011 wrapped, the user asked for one final pass with
the `reviewer` subagent at *whole-project* scope (not the usual
per-slice diff lens) before pushing for submission. The reviewer
read CHALLENGE.md, INSTRUCTIONS.md, TRD.md, the README, the
coverage artefact, and the docs/plans index, then audited every
§15 scenario and §12 error category against the actual specs +
controllers.

**Verdict: ship with fixes.** No blockers. Three should-fix and
four nits — applied four, deferred two.

**Applied** (4 commits, no plan / no architect because each is a
narrow targeted fix, not a slice):

1. **Audit-1 (`f688660`).** `markSynced` was the only mark*
   method without a terminal-state guard. The mirror risk
   (`markFailedPermanent` overwriting `synced`) was already
   covered; the worker-tick / permanent-failure race in the
   other direction (synced overwriting failed_permanent) was
   not. Added the parallel `WHERE status != 'failed_permanent'`
   guard and a new integration spec pinning the invariant.
2. **Audit-2 (`f08168b`).** `InvalidDimensionError` and
   `InsufficientBalanceError` had been declared inside
   `create-request.use-case.ts` and re-imported by the approve
   use case + the controller — exactly the leaky-abstraction
   shape `errors.ts` was created to prevent. Moved both classes
   to `src/time-off/errors.ts` (the existing home for
   module-shared errors) and updated four import sites. Pure
   rewiring; no behavioural change.
3. **Audit-3 (`2e94848`).** Comment on
   `ApproveRequestUseCase.nextAttemptAt` referenced "a future
   slice that adds the out-of-process worker" — but the worker
   landed in plan 009. Replaced with a precise statement of the
   deliberate inline-vs-worker schedule divergence (inline does
   one 30s retry, worker takes over with exponential backoff)
   and cross-referenced `BACKOFF_BASE_MS` as the single source
   of truth for the first-retry delay.
4. **Audit-4 (`80b70c3`).** Two nits bundled. (a) `express` was
   transitive via `@nestjs/platform-express` but the mock HCM
   imports it directly — added explicit `^5.0.0` devDependency
   so a future major bump of platform-express cannot silently
   drop the peer. (b) `migrate.ts`'s two `console.log` calls
   gained `eslint-disable-next-line no-console` markers
   matching the pattern already in `scripts/hcm-mock/server.ts`,
   so `npm run lint` is clean. The lint run itself
   auto-prettified seven previously-touched files (whitespace
   only) — bundled rather than fought.

**Deferred** (2 nits, with explicit reasons):

- **N2 — `clientRequestId` `@IsUUID()` enforcement.** TRD §9
  *Dual idempotency* refers to `clientRequestId` as a UUID; the
  DTO accepts any non-empty string. Tightening to `@IsUUID()`
  would break every existing test fixture that uses descriptive
  client IDs (`client-approve-01`, `client-flow-halt`, …) — a
  15-spec cascade to update test fixtures for a documentation-
  parity nit. The current behaviour is correct for any unique
  string; clients sending valid UUIDs get idempotency exactly as
  the TRD describes; non-UUID strings still dedupe via the
  UNIQUE constraint. Logged here so a future maintainer can
  pick it up if the prescriptive form becomes load-bearing.
- **N4 — `resolveSyncStatus` async / sync return type.** Pure
  readability nit; the use-case wrapper is correctly `async`
  for the `await hcmClient.postMutation`, and the inner
  `resolveSyncStatus` could have been typed sync since
  `db.transaction` on `better-sqlite3` is synchronous. Changing
  it now would touch a hot path for no functional gain. The
  reviewer explicitly flagged it as take-it-or-leave-it.

86 unit/integration + 42 e2e tests green (128 total). README,
TRD, coverage.md, and devlog all consistent. Theater-language
audit still clean across every tracked `.md` / `.ts` / `.json`.

**Submission readiness:** the project is ready to zip and ship.
`git archive --format=zip HEAD` produces a 307 KB submission
bundle (well under any plausible limit) containing the
canonical artefact set: code, tests, drizzle migrations, mock
HCM, TRD + INSTRUCTIONS + CLAUDE + README + coverage.md, the
eleven archived plans, the chronological devlog through this
entry, and the six subagent definitions under `.claude/agents/`.

Commits: `f688660`, `f08168b`, `2e94848`, `80b70c3`. No plan
archive (audit-driven cleanup, not a planned slice).
